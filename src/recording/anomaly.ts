// Post-hoc anomaly detection over a recorded trial stream.
//
// IMPORTANT: nothing in here feeds back into elbowTracker / wristTracker /
// fingerTracker or the live UI. The trackers' raw + filtered outputs are
// captured as-is during recording and only annotated here, after Stop.

import type { GameMode } from '../types';
import { VISIBILITY_THRESHOLD } from '../tracking/constants';
import type { EnrichedFrameRow, FrameRow, FrameStatus, SideKey } from './types';

/** Anatomically plausible range per mode (inclusive). */
export const PLAUSIBLE_RANGE: Record<GameMode, { min: number; max: number }> = {
  elbow: { min: 0, max: 180 },
  // v1.18: wrist is the deploy formula atan2(i, |n|) — signed range
  // −90…+90 (deflection from a fixed horizontal reference). Margin
  // to ±100 absorbs occasional out-of-bounds reads at the singularity.
  wrist: { min: -100, max: 100 },
  fingers: { min: 0, max: 100 },
};

/** Frame-to-frame jump threshold in the same units as `raw` for that mode. */
export const JUMP_THRESHOLD: Record<GameMode, number> = {
  elbow: 30, // degrees
  wrist: 30, // degrees
  fingers: 30, // percentage points
};

interface SideFrame {
  raw: number | null;
  visibility: number | null;
}

function readSide(row: FrameRow, side: SideKey): SideFrame {
  return side === 'left'
    ? { raw: row.left_raw, visibility: row.left_visibility }
    : { raw: row.right_raw, visibility: row.right_visibility };
}

/** Classify a single frame for one side. Does not consider previous frames. */
function classifyBase(mode: GameMode, side: SideFrame): FrameStatus {
  const rawFinite = side.raw !== null && Number.isFinite(side.raw);
  const visFinite = side.visibility !== null && Number.isFinite(side.visibility);

  // No landmark this frame: tracker produced no usable value.
  // (Either visibility is null/NaN, or raw is null/NaN with no visibility.)
  if (!rawFinite && (!visFinite || (side.visibility as number) <= 0)) {
    return 'no_landmark';
  }

  // Visibility present but below threshold.
  if (visFinite && (side.visibility as number) < VISIBILITY_THRESHOLD) {
    return 'low_visibility';
  }

  // Out of plausible range (only meaningful when we actually have a value).
  if (rawFinite) {
    const { min, max } = PLAUSIBLE_RANGE[mode];
    const v = side.raw as number;
    if (v < min || v > max) return 'out_of_range';
  } else {
    // visibility is fine but raw not produced — treat as no landmark too.
    return 'no_landmark';
  }

  return 'ok';
}

/** Append "|jump" if frame is plausible but jumps >threshold from previous raw. */
function appendJump(
  mode: GameMode,
  baseStatus: FrameStatus,
  currRaw: number | null,
  prevRaw: number | null
): FrameStatus {
  // Jump only meaningful when value is plausible (status starts with ok).
  // Spec: "For modes where the value is plausible but the frame-to-frame
  // delta exceeds 30°/pp, append |jump".
  if (baseStatus !== 'ok') return baseStatus;
  if (
    currRaw === null ||
    prevRaw === null ||
    !Number.isFinite(currRaw) ||
    !Number.isFinite(prevRaw)
  ) {
    return baseStatus;
  }
  const delta = Math.abs(currRaw - prevRaw);
  if (delta > JUMP_THRESHOLD[mode]) return 'ok|jump';
  return baseStatus;
}

/** Walk the frame list and annotate per-side status + anomaly flag. */
export function annotateFrames(
  mode: GameMode,
  frames: readonly FrameRow[]
): EnrichedFrameRow[] {
  const out: EnrichedFrameRow[] = [];
  // Track previous frame's raw (immediate previous, regardless of status) per side.
  let prevLeftRaw: number | null = null;
  let prevRightRaw: number | null = null;

  for (const f of frames) {
    const leftSide = readSide(f, 'left');
    const rightSide = readSide(f, 'right');

    const leftBase = classifyBase(mode, leftSide);
    const rightBase = classifyBase(mode, rightSide);

    const leftStatus = appendJump(mode, leftBase, leftSide.raw, prevLeftRaw);
    const rightStatus = appendJump(mode, rightBase, rightSide.raw, prevRightRaw);

    out.push({
      ...f,
      left_frame_status: leftStatus,
      right_frame_status: rightStatus,
      left_anomaly_flag: leftStatus === 'ok' ? 0 : 1,
      right_anomaly_flag: rightStatus === 'ok' ? 0 : 1,
    });

    // For jump detection we look at the immediate previous raw — keep most
    // recent finite raw value so a long no_landmark run doesn't immediately
    // trip "jump" on resumption (we want to compare to the last actual sample).
    if (leftSide.raw !== null && Number.isFinite(leftSide.raw)) {
      prevLeftRaw = leftSide.raw;
    }
    if (rightSide.raw !== null && Number.isFinite(rightSide.raw)) {
      prevRightRaw = rightSide.raw;
    }
  }
  return out;
}

// ─── FPS / dt stats ────────────────────────────────────────────
export interface FpsStats {
  fpsMean: number | null;
  fpsMin: number | null;
  fpsMax: number | null;
  nDroppedFrames: number;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

export function computeFpsStats(frames: readonly FrameRow[]): FpsStats {
  if (frames.length < 2) {
    return { fpsMean: null, fpsMin: null, fpsMax: null, nDroppedFrames: 0 };
  }
  const dts: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const dt = frames[i].timestamp_ms - frames[i - 1].timestamp_ms;
    if (Number.isFinite(dt) && dt > 0) dts.push(dt);
  }
  if (dts.length === 0) {
    return { fpsMean: null, fpsMin: null, fpsMax: null, nDroppedFrames: 0 };
  }
  const sorted = [...dts].sort((a, b) => a - b);
  const medDt = median(sorted) ?? 0;

  // Single pass: mean + min + max of FPS, count of dropped dts.
  // (Avoids both `Math.min(...arr)`/`Math.max(...arr)` — which can blow the
  // argument-stack limit on long recordings — and the extra allocation of
  // `dts.map(...)`.)
  let fpsSum = 0;
  let fpsMin = Infinity;
  let fpsMax = -Infinity;
  let nDropped = 0;
  const dropThreshold = medDt > 0 ? 1.5 * medDt : Infinity;
  for (const dt of dts) {
    const f = 1000 / dt;
    fpsSum += f;
    if (f < fpsMin) fpsMin = f;
    if (f > fpsMax) fpsMax = f;
    if (dt > dropThreshold) nDropped++;
  }
  return {
    fpsMean: fpsSum / dts.length,
    fpsMin,
    fpsMax,
    nDroppedFrames: nDropped,
  };
}

// ─── Capture rate ──────────────────────────────────────────────
export interface CaptureRates {
  totalFrames: number;
  leftCaptured: number;
  rightCaptured: number;
  leftPct: number; // 0..100
  rightPct: number; // 0..100
}

/** A frame "captures" a side if anomaly_flag is 0 (status === 'ok'). */
export function computeCaptureRates(
  enriched: readonly EnrichedFrameRow[]
): CaptureRates {
  const total = enriched.length;
  let l = 0;
  let r = 0;
  for (const f of enriched) {
    if (f.left_anomaly_flag === 0) l++;
    if (f.right_anomaly_flag === 0) r++;
  }
  return {
    totalFrames: total,
    leftCaptured: l,
    rightCaptured: r,
    leftPct: total > 0 ? (l / total) * 100 : 0,
    rightPct: total > 0 ? (r / total) * 100 : 0,
  };
}

// ─── Mismatch decision ─────────────────────────────────────────
export type Validity = 'valid' | 'partial' | 'invalid' | 'save_anyway';

export interface MismatchResult {
  /** True when the user must be prompted (modal). */
  hasMismatch: boolean;
  /** Short human description for the modal subtitle, when mismatched. */
  reason?: string;
}

/**
 * Decide whether the captured rates contradict the declared `arm` metadata.
 *
 *   - arm="both":      mismatch if either side <50%
 *   - arm="left only": mismatch if right side >10%
 *   - arm="right only":mismatch if left side >10%
 */
export function evaluateMismatch(
  arm: 'left' | 'right' | 'both',
  rates: CaptureRates
): MismatchResult {
  if (arm === 'both') {
    if (rates.leftPct < 50 || rates.rightPct < 50) {
      return {
        hasMismatch: true,
        reason: `Declared "both arms" but capture <50% on at least one side.`,
      };
    }
    return { hasMismatch: false };
  }
  if (arm === 'left') {
    if (rates.rightPct > 10) {
      return {
        hasMismatch: true,
        reason: `Declared "left only" but right side captured >10%.`,
      };
    }
    return { hasMismatch: false };
  }
  // arm === 'right'
  if (rates.leftPct > 10) {
    return {
      hasMismatch: true,
      reason: `Declared "right only" but left side captured >10%.`,
    };
  }
  return { hasMismatch: false };
}

// ─── Peaks (clean vs. all) ─────────────────────────────────────
export interface SideRawPeaks {
  /** Max abs/value across all rows where raw is finite. */
  peakAll: number | null;
  /** Same but excluding rows with anomaly_flag = 1 (anything other than ok). */
  peakClean: number | null;
}

/**
 * "Peak" of the raw signal.
 *   elbow / fingers: unsigned, peak = max(raw).
 *   wrist: signed deflection from horizontal (range −90…+90). Peak =
 *          frame with the largest |raw| — i.e. furthest from horizontal.
 *          The reported value is the signed reading at that frame so
 *          "hand-up" vs "hand-down" can be told apart post-hoc.
 *
 * Single pass computes both `peakAll` and `peakClean` simultaneously.
 */
export function computeRawPeak(
  mode: GameMode,
  enriched: readonly EnrichedFrameRow[],
  side: SideKey
): SideRawPeaks {
  let peakAll: number | null = null;
  let peakAllRef = -Infinity;
  let peakClean: number | null = null;
  let peakCleanRef = -Infinity;

  const signedMag = mode === 'wrist';

  for (const f of enriched) {
    const raw = side === 'left' ? f.left_raw : f.right_raw;
    if (raw === null || !Number.isFinite(raw)) continue;
    const flag = side === 'left' ? f.left_anomaly_flag : f.right_anomaly_flag;
    const cmp = signedMag ? Math.abs(raw) : raw;

    if (cmp > peakAllRef) {
      peakAllRef = cmp;
      peakAll = raw;
    }
    if (flag === 0 && cmp > peakCleanRef) {
      peakCleanRef = cmp;
      peakClean = raw;
    }
  }
  return { peakAll, peakClean };
}

/** Count anomaly frames per side (anomaly_flag === 1). */
export function countAnomalies(enriched: readonly EnrichedFrameRow[]): {
  left: number;
  right: number;
} {
  let l = 0;
  let r = 0;
  for (const f of enriched) {
    if (f.left_anomaly_flag === 1) l++;
    if (f.right_anomaly_flag === 1) r++;
  }
  return { left: l, right: r };
}
