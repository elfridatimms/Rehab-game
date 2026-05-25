import type { HolisticResults, Landmark } from '../types';
import type {
  DetectorHistory,
  DetectorHistoryFrame,
  DetectorId,
  DetectorInput,
  FailureDetector,
  FailureDetectorOutput,
  HandednessScore,
} from '../detectors/detectorTypes';
import { DualHandOcclusion } from '../detectors/DualHandOcclusion';
import { HandObjectOcclusion } from '../detectors/HandObjectOcclusion';
import { MultiAxisMotion } from '../detectors/MultiAxisMotion';
import { createAxialRotation } from '../detectors/AxialRotation';
import { PoseDiscrimination } from '../detectors/PoseDiscrimination';
import { ForceRequired } from '../detectors/ForceRequired';

// ─── Detector lookup / factory ───────────────────────────────
/** Build a FailureDetector instance for the given id. AxialRotation is
 *  stateful (calibration) so we instantiate via a factory; the others are
 *  pure singletons. */
export function createDetector(id: DetectorId): FailureDetector {
  switch (id) {
    case 'DualHandOcclusion':
      return DualHandOcclusion;
    case 'HandObjectOcclusion':
      return HandObjectOcclusion;
    case 'MultiAxisMotion':
      return MultiAxisMotion;
    case 'AxialRotation':
      return createAxialRotation();
    case 'PoseDiscrimination':
      return PoseDiscrimination;
    case 'ForceRequired':
      return ForceRequired;
  }
}

// ─── Handedness scoring ──────────────────────────────────────
/** v1.5: MediaPipe Hands emits a real per-hand confidence score. Prefer
 *  it when present; fall back to the v1.3 landmark-completeness proxy
 *  when the active model is Pose (no hand detection at all) or when the
 *  hand was not classified. */
function handednessFor(
  landmarks: readonly Landmark[] | undefined,
  realScore: number | null | undefined
): HandednessScore | null {
  if (!landmarks || landmarks.length === 0) return null;
  if (typeof realScore === 'number' && Number.isFinite(realScore)) {
    return { score: realScore };
  }
  let n = 0;
  for (const lm of landmarks) {
    if (Number.isFinite(lm.x) && Number.isFinite(lm.y)) n++;
  }
  return { score: n / 21 };
}

// ─── History ring buffer ─────────────────────────────────────
export const HISTORY_CAPACITY = 30;

export interface MutableDetectorHistory {
  frames: DetectorHistoryFrame[];
  capacity: number;
}

export function createHistory(): MutableDetectorHistory {
  return { frames: [], capacity: HISTORY_CAPACITY };
}

export function pushHistory(
  history: MutableDetectorHistory,
  frame: DetectorHistoryFrame
): void {
  history.frames.push(frame);
  if (history.frames.length > history.capacity) {
    history.frames.shift();
  }
}

export function resetHistory(history: MutableDetectorHistory): void {
  history.frames.length = 0;
}

function asReadonlyHistory(h: MutableDetectorHistory): DetectorHistory {
  return { frames: h.frames, capacity: h.capacity };
}

// ─── Per-frame runner ────────────────────────────────────────
/** Run every detector in the supplied list against the current frame.
 *  Returns a map from detector id → output. The history buffer is updated
 *  AFTER detectors run, so the buffer represents "frames up to and
 *  including the previous one" — consistent with how the spec describes
 *  time-based detectors using prior context. */
export function runDetectors(
  detectors: readonly FailureDetector[],
  results: HolisticResults | null,
  timestamp_ms: number,
  history: MutableDetectorHistory
): Partial<Record<DetectorId, FailureDetectorOutput>> {
  const pose = results?.poseLandmarks ?? null;
  const leftHand = results?.leftHandLandmarks ?? null;
  const rightHand = results?.rightHandLandmarks ?? null;

  const input: DetectorInput = {
    pose,
    leftHand,
    rightHand,
    handednessLeft: handednessFor(leftHand ?? undefined, results?.handednessLeft),
    handednessRight: handednessFor(rightHand ?? undefined, results?.handednessRight),
    timestamp_ms,
    history: asReadonlyHistory(history),
  };

  const out: Partial<Record<DetectorId, FailureDetectorOutput>> = {};
  for (const d of detectors) {
    out[d.id] = d.run(input);
  }

  // Update history AFTER reading; next frame's detectors will see this one.
  pushHistory(history, {
    timestamp_ms,
    pose: pose ?? null,
    leftHand: leftHand ?? null,
    rightHand: rightHand ?? null,
  });

  return out;
}

// ─── Summary aggregation ─────────────────────────────────────
export interface DetectorPerTrialSummary {
  trigger_rate: number;        // 0–1
  mean_confidence: number;     // 0–1
  evidence_examples: string[]; // [first, middle, last] compact JSON strings
}

export type DetectorSummaryMap = Record<string, DetectorPerTrialSummary>;

/** Compute trigger-rate / mean-confidence / evidence-examples per detector
 *  across an entire trial. Called once at trial stop. */
export function summariseDetectorOutputs(
  perFrame: ReadonlyArray<Partial<Record<DetectorId, FailureDetectorOutput>>>,
  activeDetectorIds: readonly DetectorId[]
): DetectorSummaryMap {
  const result: DetectorSummaryMap = {};
  if (perFrame.length === 0 || activeDetectorIds.length === 0) return result;

  for (const id of activeDetectorIds) {
    let nTrig = 0;
    let confSum = 0;
    let nWithOutput = 0;
    const evidences: string[] = [];

    for (let i = 0; i < perFrame.length; i++) {
      const o = perFrame[i][id];
      if (!o) continue;
      nWithOutput++;
      if (o.detected) nTrig++;
      confSum += o.confidence;
    }

    if (nWithOutput === 0) {
      result[id] = {
        trigger_rate: 0,
        mean_confidence: 0,
        evidence_examples: [],
      };
      continue;
    }

    // Evidence examples: first, middle, last frame that produced an output.
    const idxs = [0, Math.floor(perFrame.length / 2), perFrame.length - 1];
    for (const idx of idxs) {
      const o = perFrame[idx]?.[id];
      if (o) evidences.push(JSON.stringify(o.evidence));
    }

    result[id] = {
      trigger_rate: nTrig / nWithOutput,
      mean_confidence: confSum / nWithOutput,
      evidence_examples: evidences,
    };
  }

  return result;
}
