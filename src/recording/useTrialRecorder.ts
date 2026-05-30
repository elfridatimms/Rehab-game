import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameMode, HolisticResults, TrackingState } from '../types';
import type { FrameListenerRef } from '../tracking/useTracking';
import {
  ARM_LABELS,
  BACKGROUND_LABELS,
  CAMERA_ANGLE_LABELS,
  LIGHTING_LABELS,
  OCCLUSION_LABELS,
  SPEED_LABELS,
  type EnrichedFrameRow,
  type FrameRow,
  type RecorderStatus,
  type SideStats,
  type TrialMetadata,
  type TrialSummary,
  type Validity,
} from './types';
import { type Exercise, APP_VERSION } from '../exercises/exerciseTypes';
import {
  buildFrameCsv,
  buildFrameCsvFilename,
  buildSummaryCsv,
  downloadCsv,
} from './csvExport';
import { VISIBILITY_THRESHOLD } from '../tracking/constants';
import {
  annotateFrames,
  computeCaptureRates,
  computeFpsStats,
  computeRawPeak,
  countAnomalies,
  evaluateMismatch,
  type CaptureRates,
} from './anomaly';
import type {
  DetectorId,
  FailureDetector,
  FailureDetectorOutput,
} from '../detectors/detectorTypes';
import {
  createDetector,
  createHistory,
  resetHistory,
  runDetectors,
  summariseDetectorOutputs,
  type MutableDetectorHistory,
} from './enrichFrameWithDetectors';

const SUMMARIES_KEY = 'trial_summaries';
const TRIAL_IDX_KEY = 'trial_next_idx';
const SUBJECT_KEY = 'trial_subject_id';
const TICK_MS = 250;

// ─── localStorage helpers ────────────────────────────────────
function readSummaries(): TrialSummary[] {
  try {
    const raw = localStorage.getItem(SUMMARIES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as TrialSummary[];
  } catch {
    return [];
  }
}

function writeSummaries(rows: readonly TrialSummary[]): void {
  localStorage.setItem(SUMMARIES_KEY, JSON.stringify(rows));
}

function readNextTrialIdx(): number {
  const raw = localStorage.getItem(TRIAL_IDX_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function writeNextTrialIdx(n: number): void {
  localStorage.setItem(TRIAL_IDX_KEY, String(n));
}

export function readSubjectId(): string {
  return localStorage.getItem(SUBJECT_KEY) ?? 'S01';
}

export function writeSubjectId(id: string): void {
  localStorage.setItem(SUBJECT_KEY, id);
}

// ─── Per-mode frame extraction ───────────────────────────────
function extractFrame(mode: GameMode, s: TrackingState): Omit<FrameRow, 'frame_idx' | 'timestamp_ms'> {
  // Openness + spread fields are only populated in fingers mode.
  const noHandMetrics = {
    left_hand_openness_raw: null,
    left_hand_openness_filtered: null,
    right_hand_openness_raw: null,
    right_hand_openness_filtered: null,
    left_finger_spread_raw: null,
    left_finger_spread_filtered: null,
    right_finger_spread_raw: null,
    right_finger_spread_filtered: null,
  };
  if (mode === 'elbow') {
    const e = s.elbow;
    return {
      active_side:
        e.activeSide === 'L' ? 'left' : e.activeSide === 'R' ? 'right' : null,
      left_raw: e.leftRaw,
      left_filtered: e.leftSmoothed,
      left_visibility: e.leftVisibility,
      right_raw: e.rightRaw,
      right_filtered: e.rightSmoothed,
      right_visibility: e.rightVisibility,
      ...noHandMetrics,
    };
  }
  if (mode === 'wrist') {
    return {
      active_side: null,
      left_raw: s.leftHand.rawWristExtensionDeg,
      left_filtered: s.leftHand.smoothedWristExtensionDeg,
      left_visibility: s.leftHand.visibility,
      right_raw: s.rightHand.rawWristExtensionDeg,
      right_filtered: s.rightHand.smoothedWristExtensionDeg,
      right_visibility: s.rightHand.visibility,
      ...noHandMetrics,
    };
  }
  // fingers. left_raw/left_filtered keep the legacy deploy openness score
  // (0–100) for backward compatibility; the new functional palm-center
  // openness is carried separately in the hand_openness_* fields.
  return {
    active_side: null,
    left_raw: s.leftHand.rawOpenHandScore,
    left_filtered: s.leftHand.smoothedOpenHandScore,
    left_visibility: s.leftHand.visibility,
    right_raw: s.rightHand.rawOpenHandScore,
    right_filtered: s.rightHand.smoothedOpenHandScore,
    right_visibility: s.rightHand.visibility,
    left_hand_openness_raw: s.leftHand.handOpennessRaw,
    left_hand_openness_filtered: s.leftHand.handOpennessSmoothed,
    right_hand_openness_raw: s.rightHand.handOpennessRaw,
    right_hand_openness_filtered: s.rightHand.handOpennessSmoothed,
    left_finger_spread_raw: s.leftHand.fingerSpreadRaw,
    left_finger_spread_filtered: s.leftHand.fingerSpreadSmoothed,
    right_finger_spread_raw: s.rightHand.fingerSpreadRaw,
    right_finger_spread_filtered: s.rightHand.fingerSpreadSmoothed,
  };
}

/** Single-pass min/max over an array.
 *
 *  Used in preference to `Math.min(...arr)` / `Math.max(...arr)` because
 *  spreading large arrays can blow V8's argument-stack limit on long
 *  recordings (≥ 5 min × 30 FPS ≈ 9000 samples is in the risky zone) and
 *  costs ~2× more than a tight loop. */
function minMaxOf(values: readonly number[]): { min: number; max: number } | null {
  if (values.length === 0) return null;
  let min = values[0];
  let max = values[0];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (v < min) min = v;
    else if (v > max) max = v;
  }
  return { min, max };
}

function round1(n: number | null): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function round3(n: number | null): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 1000;
}

// ─── Functional hand-metric stats (fingers mode) ─────────────
/** Min/max/ROM of a smoothed functional hand metric over CLEAN frames
 *  (anomaly_flag === 0). Used for both palm-center openness (fist making)
 *  and finger spread (finger extension) — functional whole-hand metrics,
 *  not anatomical finger-joint angles. Returns nulls when no clean
 *  samples. */
function computeHandMetricStats(
  enriched: readonly EnrichedFrameRow[],
  side: 'left' | 'right',
  pick: (f: EnrichedFrameRow) => number | null,
): { min: number | null; max: number | null; rom: number | null } {
  let min: number | null = null;
  let max: number | null = null;
  for (const f of enriched) {
    const flag = side === 'left' ? f.left_anomaly_flag : f.right_anomaly_flag;
    const v = pick(f);
    if (flag !== 0 || v === null || !Number.isFinite(v)) continue;
    min = min === null ? v : Math.min(min, v);
    max = max === null ? v : Math.max(max, v);
  }
  const rom = min !== null && max !== null ? max - min : null;
  return { min: round3(min), max: round3(max), rom: round3(rom) };
}

// ─── Stats over a side's samples ─────────────────────────────
// v1.15: angle min/max/ROM are computed from `cleanFiltSamples` — the
// smoothed continuous-angle values collected ONLY from frames where the
// landmark was detected AND the post-hoc anomaly flag is 0. This is the
// signal the user actually cares about for ROM analysis; raw + all-frame
// filtered stats are kept alongside for sensitivity work.
function computeSideStats(
  rawSamples: number[],
  filtSamples: number[],
  cleanFiltSamples: number[],
  visSamples: number[],
): SideStats {
  const empty =
    rawSamples.length === 0 &&
    filtSamples.length === 0 &&
    cleanFiltSamples.length === 0 &&
    visSamples.length === 0;
  if (empty) {
    return {
      rawMin: null,
      rawMax: null,
      rawRom: null,
      angleMin: null,
      angleMax: null,
      rom: null,
      filtStd: null,
      lowVisibilityPct: null,
    };
  }

  const rawMM = minMaxOf(rawSamples);
  const rawMin = rawMM ? rawMM.min : null;
  const rawMax = rawMM ? rawMM.max : null;

  // Continuous angle min/max from CLEAN frames only (skip glitches so a
  // single bad frame can't become the min or max).
  const cleanMM = minMaxOf(cleanFiltSamples);
  const angleMin = cleanMM ? round1(cleanMM.min) : null;
  const angleMax = cleanMM ? round1(cleanMM.max) : null;
  const rom =
    angleMin !== null && angleMax !== null ? round1(angleMax - angleMin) : null;

  // Std-dev kept on ALL filtered samples (legacy variability metric).
  let filtStd: number | null = null;
  if (filtSamples.length >= 2) {
    let sum = 0;
    for (const v of filtSamples) sum += v;
    const mean = sum / filtSamples.length;
    let varSum = 0;
    for (const v of filtSamples) {
      const d = v - mean;
      varSum += d * d;
    }
    filtStd = Math.sqrt(varSum / (filtSamples.length - 1));
  }

  let lowVisibilityPct: number | null = null;
  if (visSamples.length > 0) {
    let low = 0;
    for (const v of visSamples) if (v < VISIBILITY_THRESHOLD) low++;
    lowVisibilityPct = (low / visSamples.length) * 100;
  }

  return {
    rawMin,
    rawMax,
    rawRom: rawMin !== null && rawMax !== null ? rawMax - rawMin : null,
    angleMin,
    angleMax,
    rom,
    filtStd,
    lowVisibilityPct,
  };
}

// ─── Pending trial (awaiting validity decision after Stop) ───
export interface PendingTrial {
  summary: TrialSummary; // validity is preliminary; modal will overwrite
  enrichedFrames: readonly EnrichedFrameRow[];
  exercise: Exercise;
  meta: TrialMetadata;
  filename: string;
  captureRates: CaptureRates;
  mismatchReason: string;
}

// ─── Hook ────────────────────────────────────────────────────
/** Live detector outputs published per frame for the active exercise.
 *  Read by mode panels; updated at React batch cadence via rAF coalescing.
 */
export type LiveDetectorOutputs = Partial<Record<DetectorId, FailureDetectorOutput>>;

/** Recorder hook. Writes its frame listener into the App-owned ref so the
 *  single useTracking instance (which binds MediaPipe.onResults once) can
 *  invoke it without needing to be reconstructed.
 *
 *  v1.3: also runs the active exercise's failure detectors on every frame
 *  (whether recording or not), so mode panels can show live detector
 *  status without coupling to the recording lifecycle. */
export function useTrialRecorder(frameListenerRef: FrameListenerRef): {
  status: RecorderStatus;
  summaries: readonly TrialSummary[];
  pendingTrial: PendingTrial | null;
  liveDetectorOutputs: LiveDetectorOutputs;
  /** Switch the currently-active exercise. Recreates detector instances
   *  (resets calibration on AxialRotation, etc.). Must be called whenever
   *  the user selects a different exercise; can be called with null when
   *  no exercise is selected. */
  setActiveExercise: (ex: Exercise | null) => void;
  /** Calibrate AxialRotation for a side. No-op if the active exercise
   *  doesn't use AxialRotation. Reads the most recent frame's landmarks. */
  calibrateAxialRotation: (side: 'left' | 'right') => void;
  startTrial: (exercise: Exercise, meta: TrialMetadata, subjectId: string) => void;
  stopTrial: () => void;
  commitPendingTrial: (validity: Validity) => void;
  discardPendingTrial: () => void;
  exportAllSummaries: () => void;
  clearSummaries: () => void;
} {

  // Trial recording is a hot path; keep transient state in refs to avoid
  // re-renders per frame. Status state updates on a slower tick.
  const isRecordingRef = useRef(false);
  const framesRef = useRef<FrameRow[]>([]);
  const frameDetectorOutputsRef = useRef<LiveDetectorOutputs[]>([]);
  const startMonotonicRef = useRef<number>(0);
  const startWallRef = useRef<Date | null>(null);
  const trialIdxRef = useRef<number>(readNextTrialIdx());
  const recordingModeRef = useRef<GameMode | null>(null);
  const exerciseRef = useRef<Exercise | null>(null);
  const metaRef = useRef<TrialMetadata | null>(null);
  const subjectIdRef = useRef<string>(readSubjectId());

  // ─── v1.3 detector state ───────────────────────────────────
  /** Currently active exercise for live detector evaluation. May differ
   *  from `exerciseRef` (which is the recording target). */
  const activeExerciseRef = useRef<Exercise | null>(null);
  /** Detector instances built for `activeExerciseRef.current`. Re-built
   *  whenever the active exercise changes. */
  const detectorsRef = useRef<FailureDetector[]>([]);
  const detectorHistoryRef = useRef<MutableDetectorHistory>(createHistory());
  const latestLiveOutputsRef = useRef<LiveDetectorOutputs>({});
  const livePublishScheduledRef = useRef(false);
  const [liveDetectorOutputs, setLiveDetectorOutputs] = useState<LiveDetectorOutputs>({});
  /** Snapshot of the most recent raw results — used by calibrateAxialRotation
   *  to seed AxialRotation's reference angle on demand. */
  const latestResultsRef = useRef<HolisticResults | null>(null);
  const latestTimestampRef = useRef<number>(0);
  /** Best-effort camera label captured at trial start. */
  const cameraLabelRef = useRef<string>('');

  const [summaries, setSummaries] = useState<TrialSummary[]>(() => readSummaries());
  const [pendingTrial, setPendingTrial] = useState<PendingTrial | null>(null);
  const [status, setStatus] = useState<RecorderStatus>(() => ({
    isRecording: false,
    trialIdx: readNextTrialIdx(),
    elapsedSec: 0,
    frameCount: 0,
    lastSummary: null,
    lastFrames: null,
  }));

  // Status tick: refresh elapsed + frame counters at ~4 Hz while recording.
  useEffect(() => {
    if (!status.isRecording) return;
    const id = window.setInterval(() => {
      setStatus((prev) => {
        if (!isRecordingRef.current) return prev;
        return {
          ...prev,
          elapsedSec: (performance.now() - startMonotonicRef.current) / 1000,
          frameCount: framesRef.current.length,
        };
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [status.isRecording]);

  // ─── Master frame listener (always installed) ───────────────
  // Owns both detector evaluation (live) and frame capture (when recording).
  // The function reference itself is stable — it reads everything it needs
  // from refs, so swapping detectors / starting a trial does not require
  // re-installing the listener.
  useEffect(() => {
    frameListenerRef.current = (mode, s, results, ts) => {
      latestResultsRef.current = results;
      latestTimestampRef.current = ts;

      // Live detector run (whether recording or not).
      const detectors = detectorsRef.current;
      let outputs: LiveDetectorOutputs = {};
      if (detectors.length > 0) {
        outputs = runDetectors(
          detectors,
          results,
          ts,
          detectorHistoryRef.current
        );
        latestLiveOutputsRef.current = outputs;
        // Coalesce React state updates to one per browser frame.
        if (!livePublishScheduledRef.current) {
          livePublishScheduledRef.current = true;
          requestAnimationFrame(() => {
            livePublishScheduledRef.current = false;
            setLiveDetectorOutputs(latestLiveOutputsRef.current);
          });
        }
      } else if (latestLiveOutputsRef.current && Object.keys(latestLiveOutputsRef.current).length > 0) {
        // Active exercise changed to a YES (no detectors) — clear live state.
        latestLiveOutputsRef.current = {};
        if (!livePublishScheduledRef.current) {
          livePublishScheduledRef.current = true;
          requestAnimationFrame(() => {
            livePublishScheduledRef.current = false;
            setLiveDetectorOutputs({});
          });
        }
      }

      // Recording capture (gated).
      if (!isRecordingRef.current) return;
      // Hard guard: only capture frames matching the trial's mode.
      if (mode !== recordingModeRef.current) return;
      const extracted = extractFrame(mode, s);
      framesRef.current.push({
        frame_idx: framesRef.current.length,
        timestamp_ms: performance.now() - startMonotonicRef.current,
        ...extracted,
      });
      frameDetectorOutputsRef.current.push(outputs);
    };
    return () => {
      frameListenerRef.current = null;
    };
  }, [frameListenerRef]);

  /** Rebuild detector instances for a new active exercise. Idempotent if
   *  the exercise hasn't changed. Resets the rolling history buffer because
   *  detectors like MultiAxisMotion read a window of past frames; mixing
   *  windows across exercises would be misleading. */
  const setActiveExercise = useCallback((ex: Exercise | null) => {
    const prev = activeExerciseRef.current;
    if (prev?.id === ex?.id) return;
    activeExerciseRef.current = ex;
    detectorsRef.current = ex
      ? ex.activeDetectors.map((id) => createDetector(id))
      : [];
    resetHistory(detectorHistoryRef.current);
    latestLiveOutputsRef.current = {};
    setLiveDetectorOutputs({});
  }, []);

  const calibrateAxialRotation = useCallback((side: 'left' | 'right') => {
    const det = detectorsRef.current.find((d) => d.id === 'AxialRotation');
    if (!det || !det.calibrate) return;
    const results = latestResultsRef.current;
    if (!results) return;
    det.calibrate(side, {
      pose: results.poseLandmarks ?? null,
      leftHand: results.leftHandLandmarks ?? null,
      rightHand: results.rightHandLandmarks ?? null,
      handednessLeft: null,
      handednessRight: null,
      timestamp_ms: latestTimestampRef.current,
      history: detectorHistoryRef.current,
    });
  }, []);

  /** Best-effort camera label snapshot via mediaDevices. Resolves to '' if
   *  no permission has been granted or the API is unavailable. */
  async function snapshotCameraLabel(): Promise<string> {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const cams = devs.filter((d) => d.kind === 'videoinput');
      // Prefer a device that's actually marked active by the OS; fall back
      // to the first one.
      return cams[0]?.label ?? '';
    } catch {
      return '';
    }
  }

  const startTrial = useCallback(
    (exercise: Exercise, meta: TrialMetadata, subjectId: string) => {
      if (isRecordingRef.current) return;
      framesRef.current = [];
      frameDetectorOutputsRef.current = [];
      startMonotonicRef.current = performance.now();
      startWallRef.current = new Date();
      recordingModeRef.current = exercise.mode;
      exerciseRef.current = exercise;
      metaRef.current = meta;
      subjectIdRef.current = subjectId;

      // Ensure the recording target exercise is the live-active one too;
      // re-arms detectors and clears history.
      setActiveExercise(exercise);

      isRecordingRef.current = true;

      // Clear any prior pending result when a new trial starts.
      setPendingTrial(null);

      // Camera label snapshot is async; we kick it off and fill in by stop.
      void snapshotCameraLabel().then((label) => {
        cameraLabelRef.current = label;
      });

      setStatus({
        isRecording: true,
        trialIdx: trialIdxRef.current,
        elapsedSec: 0,
        frameCount: 0,
        lastSummary: null,
        lastFrames: null,
      });
    },
    [setActiveExercise]
  );

  /** Build the (preliminary) summary + enriched frames for a captured stream.
   *  Validity is filled by the caller before the summary is persisted. */
  function buildPreliminarySummary(
    exercise: Exercise,
    meta: TrialMetadata,
    startWall: Date,
    frames: readonly FrameRow[],
    durationS: number
  ): { summary: TrialSummary; enriched: EnrichedFrameRow[]; filename: string; captureRates: CaptureRates } {
    const enriched = annotateFrames(exercise.mode, frames);

    // Aggregate per-side numeric samples.
    //   *Raw  / *Filt: all finite frames (legacy std + raw stats).
    //   *Clean: smoothed value from frames where anomaly_flag === 0 only
    //           — feeds angle_min / angle_max / rom (the user-facing ROM).
    const leftRaw: number[] = [];
    const leftFilt: number[] = [];
    const leftCleanFilt: number[] = [];
    const leftVis: number[] = [];
    const rightRaw: number[] = [];
    const rightFilt: number[] = [];
    const rightCleanFilt: number[] = [];
    const rightVis: number[] = [];
    for (const f of enriched) {
      if (f.left_raw !== null && Number.isFinite(f.left_raw)) leftRaw.push(f.left_raw);
      if (f.left_filtered !== null && Number.isFinite(f.left_filtered)) {
        leftFilt.push(f.left_filtered);
        if (f.left_anomaly_flag === 0) leftCleanFilt.push(f.left_filtered);
      }
      if (f.left_visibility !== null && Number.isFinite(f.left_visibility))
        leftVis.push(f.left_visibility);
      if (f.right_raw !== null && Number.isFinite(f.right_raw)) rightRaw.push(f.right_raw);
      if (f.right_filtered !== null && Number.isFinite(f.right_filtered)) {
        rightFilt.push(f.right_filtered);
        if (f.right_anomaly_flag === 0) rightCleanFilt.push(f.right_filtered);
      }
      if (f.right_visibility !== null && Number.isFinite(f.right_visibility))
        rightVis.push(f.right_visibility);
    }

    const leftStats = computeSideStats(leftRaw, leftFilt, leftCleanFilt, leftVis);
    const rightStats = computeSideStats(rightRaw, rightFilt, rightCleanFilt, rightVis);
    const fps = computeFpsStats(frames);
    const rates = computeCaptureRates(enriched);
    const anomalies = countAnomalies(enriched);
    const leftPeak = computeRawPeak(exercise.mode, enriched, 'left');
    const rightPeak = computeRawPeak(exercise.mode, enriched, 'right');
    // Functional hand-metric ROM (fingers mode only; null for angle modes).
    // Both openness (fist making) and spread (finger extension) are computed
    // so each fingers trial carries the column its exercise actually needs.
    const noStats = { min: null, max: null, rom: null };
    const isFingers = exercise.mode === 'fingers';
    const leftOpen = isFingers
      ? computeHandMetricStats(enriched, 'left', (f) => f.left_hand_openness_filtered)
      : noStats;
    const rightOpen = isFingers
      ? computeHandMetricStats(enriched, 'right', (f) => f.right_hand_openness_filtered)
      : noStats;
    const leftSpread = isFingers
      ? computeHandMetricStats(enriched, 'left', (f) => f.left_finger_spread_filtered)
      : noStats;
    const rightSpread = isFingers
      ? computeHandMetricStats(enriched, 'right', (f) => f.right_finger_spread_filtered)
      : noStats;

    const trialIdx = trialIdxRef.current;
    const filename = buildFrameCsvFilename(
      trialIdx,
      exercise.mode,
      exercise.id,
      subjectIdRef.current,
      startWall
    );

    const detectorSummary = summariseDetectorOutputs(
      frameDetectorOutputsRef.current,
      exercise.activeDetectors
    );

    const summary: TrialSummary = {
      trial_idx: trialIdx,
      timestamp_iso: startWall.toISOString(),
      trial_start_iso: startWall.toISOString(),
      subject_id: subjectIdRef.current,
      mode: exercise.mode,
      exercise_id: exercise.id,
      exercise_label: exercise.nameEn,
      // Legacy lowercase column kept for backward compatibility; new
      // v1.3 `exercise_suitability` column carries the canonical uppercase.
      suitability: exercise.expectedSuitability.toLowerCase(),
      arm: ARM_LABELS[meta.arm],
      distance_cm: meta.distanceCm,
      camera_angle: CAMERA_ANGLE_LABELS[meta.cameraAngle],
      lighting: LIGHTING_LABELS[meta.lighting],
      occlusion: OCCLUSION_LABELS[meta.occlusion],
      background: BACKGROUND_LABELS[meta.background],
      speed: SPEED_LABELS[meta.speed],
      notes: meta.notes,
      duration_s: Number(durationS.toFixed(3)),
      n_frames: frames.length,
      // Per-side stats. *_angle_min/max + *_rom are the user-facing
      // ROM (smoothed, continuous, glitch frames skipped, 1-decimal).
      left_raw_min: leftStats.rawMin,
      left_raw_max: leftStats.rawMax,
      left_raw_rom: leftStats.rawRom,
      left_angle_min: leftStats.angleMin,
      left_angle_max: leftStats.angleMax,
      left_rom: leftStats.rom,
      left_filt_std: leftStats.filtStd,
      left_low_visibility_pct: leftStats.lowVisibilityPct,
      right_raw_min: rightStats.rawMin,
      right_raw_max: rightStats.rawMax,
      right_raw_rom: rightStats.rawRom,
      right_angle_min: rightStats.angleMin,
      right_angle_max: rightStats.angleMax,
      right_rom: rightStats.rom,
      right_filt_std: rightStats.filtStd,
      right_low_visibility_pct: rightStats.lowVisibilityPct,
      // new anomaly + FPS columns
      fps_mean: fps.fpsMean,
      fps_min: fps.fpsMin,
      fps_max: fps.fpsMax,
      n_dropped_frames: fps.nDroppedFrames,
      left_raw_peak: leftPeak.peakAll,
      left_raw_peak_clean: leftPeak.peakClean,
      right_raw_peak: rightPeak.peakAll,
      right_raw_peak_clean: rightPeak.peakClean,
      n_anomaly_frames_left: anomalies.left,
      n_anomaly_frames_right: anomalies.right,
      // Placeholder validity — caller will overwrite before persisting.
      validity: 'valid',
      filename,
      // ─── v1.3 columns ──────────────────────────────────────
      exercise_suitability: exercise.expectedSuitability,
      detectors_active: exercise.activeDetectors.join(','),
      detector_summary_json: JSON.stringify(detectorSummary),
      camera_label: cameraLabelRef.current,
      app_version: APP_VERSION,
      view_orientation: meta.viewOrientation,
      target_rom: exercise.targetROM ?? '',
      // v1.32: functional hand-openness ROM (fingers only) + rep placeholders.
      left_hand_openness_min: leftOpen.min,
      left_hand_openness_max: leftOpen.max,
      left_functional_hand_rom: leftOpen.rom,
      right_hand_openness_min: rightOpen.min,
      right_hand_openness_max: rightOpen.max,
      right_functional_hand_rom: rightOpen.rom,
      left_finger_spread_min: leftSpread.min,
      left_finger_spread_max: leftSpread.max,
      left_finger_spread_rom: leftSpread.rom,
      right_finger_spread_min: rightSpread.min,
      right_finger_spread_max: rightSpread.max,
      right_finger_spread_rom: rightSpread.rom,
      rep_count: 0,
      mean_rom_per_rep: null,
    };

    // Splice detector outputs into the enriched frames by index.
    if (exercise.activeDetectors.length > 0) {
      const outputs = frameDetectorOutputsRef.current;
      for (let i = 0; i < enriched.length; i++) {
        enriched[i].detector_outputs = outputs[i];
      }
    }

    return { summary, enriched, filename, captureRates: rates };
  }

  /** Persist a finalised summary + download frame CSV. */
  function commitSummary(
    summary: TrialSummary,
    enriched: readonly EnrichedFrameRow[],
    exercise: Exercise,
    meta: TrialMetadata
  ): void {
    const frameCsv = buildFrameCsv(exercise, meta, enriched);
    downloadCsv(summary.filename, frameCsv);

    const nextSummaries = [...readSummaries(), summary];
    writeSummaries(nextSummaries);
    setSummaries(nextSummaries);

    trialIdxRef.current = summary.trial_idx + 1;
    writeNextTrialIdx(trialIdxRef.current);

    setStatus((prev) => ({
      ...prev,
      isRecording: false,
      trialIdx: trialIdxRef.current,
      elapsedSec: summary.duration_s,
      frameCount: summary.n_frames,
      lastSummary: summary,
      lastFrames: enriched,
    }));
    setPendingTrial(null);
  }

  const stopTrial = useCallback(() => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    // NOTE: do NOT clear frameListenerRef — the master listener stays
    // installed so the live detector display keeps working between
    // trials. Recording is gated by isRecordingRef inside the listener.

    const exercise = exerciseRef.current;
    const meta = metaRef.current;
    const startWall = startWallRef.current;
    if (!exercise || !meta || !startWall) {
      setStatus((s) => ({ ...s, isRecording: false }));
      return;
    }

    const frames = framesRef.current;
    const durationS = (performance.now() - startMonotonicRef.current) / 1000;

    // Edge case: no frames captured — skip save entirely, just reset UI.
    if (frames.length === 0) {
      setStatus({
        isRecording: false,
        trialIdx: trialIdxRef.current,
        elapsedSec: 0,
        frameCount: 0,
        lastSummary: null,
        lastFrames: null,
      });
      return;
    }

    const { summary, enriched, filename, captureRates } = buildPreliminarySummary(
      exercise,
      meta,
      startWall,
      frames,
      durationS
    );

    const mismatch = evaluateMismatch(meta.arm, captureRates);

    if (!mismatch.hasMismatch) {
      // Auto-commit as 'valid'.
      commitSummary({ ...summary, validity: 'valid' }, enriched, exercise, meta);
      return;
    }

    // Otherwise hold the trial in `pendingTrial` so the modal can ask the
    // user. Validity is filled when `commitPendingTrial` is called.
    setPendingTrial({
      summary,
      enrichedFrames: enriched,
      exercise,
      meta,
      filename,
      captureRates,
      mismatchReason: mismatch.reason ?? 'Capture rate mismatch.',
    });

    setStatus((s) => ({
      ...s,
      isRecording: false,
      elapsedSec: durationS,
      frameCount: frames.length,
    }));
  }, []);

  const commitPendingTrial = useCallback((validity: Validity) => {
    setPendingTrial((p) => {
      if (!p) return null;
      commitSummary(
        { ...p.summary, validity },
        p.enrichedFrames,
        p.exercise,
        p.meta
      );
      return null;
    });
  }, []);

  const discardPendingTrial = useCallback(() => {
    setPendingTrial(null);
    setStatus((prev) => ({
      ...prev,
      // Trial idx is NOT incremented on discard — the next attempt re-uses it.
      isRecording: false,
    }));
  }, []);

  const exportAllSummaries = useCallback(() => {
    const rows = readSummaries();
    if (rows.length === 0) return;
    const csv = buildSummaryCsv(rows);
    downloadCsv(`trial_summaries_${formatNow()}.csv`, csv);
  }, []);

  const clearSummaries = useCallback(() => {
    localStorage.removeItem(SUMMARIES_KEY);
    setSummaries([]);
  }, []);

  return {
    status,
    summaries,
    pendingTrial,
    liveDetectorOutputs,
    setActiveExercise,
    calibrateAxialRotation,
    startTrial,
    stopTrial,
    commitPendingTrial,
    discardPendingTrial,
    exportAllSummaries,
    clearSummaries,
  };
}

function formatNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}
