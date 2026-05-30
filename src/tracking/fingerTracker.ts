import type { Landmark, HandTrackingState, HandOpenState } from '../types';
import {
  FINGER_RATIO_CLOSED,
  FINGER_RATIO_OPEN,
  FINGER_SMOOTHING_FACTOR,
  HAND_OPENNESS_SMOOTHING_FACTOR,
  HAND_OPEN_THRESHOLD,
  HAND_CLOSED_THRESHOLD,
  PALM_SIZE_MIN,
  CAMERA_ASPECT_W_OVER_H,
} from './constants';

// ─── EMA helper ───────────────────────────────────────────────
function ema(raw: number, prev: number | null): number {
  if (prev === null) return raw;
  return raw * FINGER_SMOOTHING_FACTOR + prev * (1 - FINGER_SMOOTHING_FACTOR);
}

function emaOpenness(raw: number, prev: number | null): number {
  if (prev === null) return raw;
  return (
    raw * HAND_OPENNESS_SMOOTHING_FACTOR +
    prev * (1 - HAND_OPENNESS_SMOOTHING_FACTOR)
  );
}

// ─── Distance / angle helpers ─────────────────────────────────
// v1.21: x scaled by camera aspect so the distance is in true pixel
// units. Matters most when palm and tip vectors point in different
// directions (e.g. thumb horizontal, fingers vertical).
function dist(a: Landmark, b: Landmark): number {
  const dx = (a.x - b.x) * CAMERA_ASPECT_W_OVER_H;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function angleAt(v: Landmark, a: Landmark, b: Landmark): number {
  const ax = a.x - v.x;
  const ay = a.y - v.y;
  const bx = b.x - v.x;
  const by = b.y - v.y;
  const dot = ax * bx + ay * by;
  const ma = Math.sqrt(ax * ax + ay * ay);
  const mb = Math.sqrt(bx * bx + by * by);
  if (ma === 0 || mb === 0) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (ma * mb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

const FINGERTIPS = [4, 8, 12, 16, 20];

// Palm center is the average of the four finger MCP joints; the openness
// metric uses the four (non-thumb) fingertips. Thumb is intentionally
// excluded — its different anatomy skews the simple average.
const PALM_MCPS = [5, 9, 13, 17];
const OPENNESS_TIPS = [8, 12, 16, 20];

/** Classify the hand-openness percent into a coarse state with hysteresis
 *  thresholds. */
function classifyHandState(percent: number | null): HandOpenState | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  if (percent > HAND_OPEN_THRESHOLD) return 'open';
  if (percent < HAND_CLOSED_THRESHOLD) return 'closed';
  return 'transition';
}

/**
 * Hand openness — exact restore of the deployed formula
 * (deploy 6a11b4504e219cdcb50d1107, bundle index-vpkjw17t.js).
 *
 * Score is 0–100 derived from the average (fingertip → wrist) distance
 * normalised by palm length, mapped between FINGER_RATIO_CLOSED and
 * FINGER_RATIO_OPEN and clamped.
 *
 * @inputs
 * - handLandmarks[0]   (wrist)
 * - handLandmarks[9]   (middle-finger MCP — palm-length reference)
 * - handLandmarks[4, 8, 12, 16, 20] (five fingertips)
 *
 * @formula
 *   palmLength = dist(wrist, handLandmarks[9])
 *   for tip in FINGERTIPS:
 *     ratio_i = dist(wrist, handLandmarks[tip]) / palmLength
 *   mean = average(ratio_i)
 *   score = clamp(((mean − CLOSED) / (OPEN − CLOSED)) * 100, 0, 100)
 *
 * Constants: CLOSED = 1.4, OPEN = 2.6.
 *
 * @failsafes
 * - Fewer than 21 landmarks → smoothed and raw cleared, peak retained.
 * - Any required landmark missing → smoothed and raw cleared.
 * - palm_length below 0.001 → smoothed and raw cleared.
 *
 * @smoothing  EMA with FINGER_SMOOTHING_FACTOR on the score.
 */
export function updateFingerOpenness(
  state: HandTrackingState,
  handLandmarks: Landmark[] | undefined,
): HandTrackingState {
  if (!handLandmarks || handLandmarks.length < 21) {
    state.smoothedOpenHandScore = null;
    state.rawOpenHandScore = null;
    return state;
  }

  const wrist = handLandmarks[0];
  const middleMCP = handLandmarks[9];

  for (const idx of [0, 9, ...FINGERTIPS]) {
    if (!handLandmarks[idx]) {
      state.smoothedOpenHandScore = null;
      state.rawOpenHandScore = null;
      return state;
    }
  }

  const palmLength = dist(wrist, middleMCP);
  if (palmLength < 0.001) {
    state.smoothedOpenHandScore = null;
    state.rawOpenHandScore = null;
    return state;
  }

  let sum = 0;
  for (const tip of FINGERTIPS) {
    sum += dist(wrist, handLandmarks[tip]) / palmLength;
  }
  const mean = sum / FINGERTIPS.length;

  const t = (mean - FINGER_RATIO_CLOSED) / (FINGER_RATIO_OPEN - FINGER_RATIO_CLOSED);
  const score = Math.max(0, Math.min(100, t * 100));

  state.rawOpenHandScore = score;
  state.smoothedOpenHandScore = ema(score, state.smoothedOpenHandScore);

  if (
    state.peakOpenHandScore === null ||
    state.smoothedOpenHandScore > state.peakOpenHandScore
  ) {
    state.peakOpenHandScore = state.smoothedOpenHandScore;
  }

  updateFingerSpreads(state, handLandmarks);
  return state;
}

/**
 * Functional hand-openness (fist making / finger extension).
 *
 * This is a FUNCTIONAL openness metric, NOT a precise anatomical
 * measurement of individual finger joints. It measures how open or
 * closed the whole hand is, normalised by palm size so it is roughly
 * invariant to camera distance.
 *
 *   palmCenter = average(MCP 5, 9, 13, 17)        // x,y only (no z)
 *   palmSize   = dist(wrist 0, middle-MCP 9)
 *   raw        = mean over tips {8,12,16,20} of
 *                  dist(tip, palmCenter) / palmSize
 *
 * The thumb (tip 4) is intentionally excluded — its different anatomy
 * would distort the simple average.
 *
 * `raw` grows as the hand opens and shrinks as it closes. We EMA-smooth
 * it, track the running min/max observed since this state was created,
 * and derive a DYNAMIC percent: 0 % = the most-closed value seen so far,
 * 100 % = the most-open. State is then open / closed / transition.
 *
 * Invalid frame (returns with raw/smoothed null, running stats untouched):
 *   - fewer than 21 landmarks
 *   - any required landmark (0,5,8,9,12,13,16,17,20) missing
 *   - palmSize below PALM_SIZE_MIN (hand too small / collapsed)
 */
export function updateHandOpenness(
  state: HandTrackingState,
  handLandmarks: Landmark[] | undefined,
): HandTrackingState {
  const invalid = () => {
    state.handOpennessRaw = null;
    state.handOpennessSmoothed = null;
    state.handOpennessPercent = null;
    state.handState = null;
    return state;
  };

  if (!handLandmarks || handLandmarks.length < 21) return invalid();
  for (const idx of [0, ...PALM_MCPS, ...OPENNESS_TIPS]) {
    if (!handLandmarks[idx]) return invalid();
  }

  const wrist = handLandmarks[0];
  const middleMCP = handLandmarks[9];
  const palmSize = dist(wrist, middleMCP);
  if (!Number.isFinite(palmSize) || palmSize < PALM_SIZE_MIN) return invalid();

  // Palm center = mean of the four MCP joints (x,y only).
  let cx = 0;
  let cy = 0;
  for (const idx of PALM_MCPS) {
    cx += handLandmarks[idx].x;
    cy += handLandmarks[idx].y;
  }
  const palmCenter: Landmark = {
    x: cx / PALM_MCPS.length,
    y: cy / PALM_MCPS.length,
    z: 0,
  };

  let sum = 0;
  for (const tip of OPENNESS_TIPS) {
    sum += dist(handLandmarks[tip], palmCenter) / palmSize;
  }
  const raw = sum / OPENNESS_TIPS.length;

  state.handOpennessRaw = raw;
  const smoothed = emaOpenness(raw, state.handOpennessSmoothed);
  state.handOpennessSmoothed = smoothed;

  // Running observed extremes (since state creation: mode switch / reset).
  state.handOpennessMin =
    state.handOpennessMin === null ? smoothed : Math.min(state.handOpennessMin, smoothed);
  state.handOpennessMax =
    state.handOpennessMax === null ? smoothed : Math.max(state.handOpennessMax, smoothed);

  // Dynamic percent against the observed range. Null until the range opens
  // up (avoids divide-by-zero on the first / constant frames).
  const span = (state.handOpennessMax ?? 0) - (state.handOpennessMin ?? 0);
  if (span > 1e-6) {
    const pct = ((smoothed - (state.handOpennessMin as number)) / span) * 100;
    state.handOpennessPercent = Math.max(0, Math.min(100, pct));
  } else {
    state.handOpennessPercent = null;
  }
  state.handState = classifyHandState(state.handOpennessPercent);

  return state;
}

// Adjacent fingertip pairs whose normalised gaps measure spread. Thumb
// tip (4) → index (8) is included so thumb abduction counts toward
// "how far apart are the fingers spread".
const SPREAD_TIP_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [4, 8],
  [8, 12],
  [12, 16],
  [16, 20],
];

/**
 * Finger SPREAD / separation (finger extension exercise).
 *
 * Measures how far apart the fingers are spread — distinct from the
 * openness metric (which is tip-to-palm-center). Here we average the
 * gaps between adjacent fingertips and normalise by palm size:
 *
 *   palmSize = dist(wrist 0, middle-MCP 9)
 *   raw      = mean over pairs {(4,8),(8,12),(12,16),(16,20)} of
 *                dist(tipA, tipB) / palmSize
 *
 * Larger raw = fingers more separated. EMA-smoothed, with running
 * min/max and a DYNAMIC percent (0 = least spread seen this session,
 * 100 = most spread). Same invalid-frame rules as openness.
 */
export function updateFingerSpread(
  state: HandTrackingState,
  handLandmarks: Landmark[] | undefined,
): HandTrackingState {
  const invalid = () => {
    state.fingerSpreadRaw = null;
    state.fingerSpreadSmoothed = null;
    state.fingerSpreadPercent = null;
    return state;
  };

  if (!handLandmarks || handLandmarks.length < 21) return invalid();
  for (const idx of [0, 9, 4, 8, 12, 16, 20]) {
    if (!handLandmarks[idx]) return invalid();
  }

  const palmSize = dist(handLandmarks[0], handLandmarks[9]);
  if (!Number.isFinite(palmSize) || palmSize < PALM_SIZE_MIN) return invalid();

  let sum = 0;
  for (const [a, b] of SPREAD_TIP_PAIRS) {
    sum += dist(handLandmarks[a], handLandmarks[b]) / palmSize;
  }
  const raw = sum / SPREAD_TIP_PAIRS.length;

  state.fingerSpreadRaw = raw;
  const smoothed = emaOpenness(raw, state.fingerSpreadSmoothed);
  state.fingerSpreadSmoothed = smoothed;

  state.fingerSpreadMin =
    state.fingerSpreadMin === null ? smoothed : Math.min(state.fingerSpreadMin, smoothed);
  state.fingerSpreadMax =
    state.fingerSpreadMax === null ? smoothed : Math.max(state.fingerSpreadMax, smoothed);

  const span = (state.fingerSpreadMax ?? 0) - (state.fingerSpreadMin ?? 0);
  if (span > 1e-6) {
    const pct = ((smoothed - (state.fingerSpreadMin as number)) / span) * 100;
    state.fingerSpreadPercent = Math.max(0, Math.min(100, pct));
  } else {
    state.fingerSpreadPercent = null;
  }

  return state;
}

/** Per-finger spread angles (orthogonal feature, not in the deployed
 *  bundle but kept because the UI still exposes them). */
function updateFingerSpreads(
  state: HandTrackingState,
  hand: Landmark[],
): void {
  const wrist = hand[0];
  const thumbTip = hand[4];
  const indexTip = hand[8];
  const middleTip = hand[12];
  const ringTip = hand[16];
  const pinkyTip = hand[20];
  if (!wrist) return;

  const setSpread = (
    key: 'spreadThumbIndex' | 'spreadIndexMiddle' | 'spreadMiddleRing' | 'spreadRingPinky',
    a: Landmark | undefined,
    b: Landmark | undefined,
  ) => {
    if (!a || !b) {
      state[key] = null;
      return;
    }
    const raw = angleAt(wrist, a, b);
    const prev = state[key];
    state[key] = prev === null
      ? raw
      : raw * FINGER_SMOOTHING_FACTOR + prev * (1 - FINGER_SMOOTHING_FACTOR);
  };

  setSpread('spreadThumbIndex', thumbTip, indexTip);
  setSpread('spreadIndexMiddle', indexTip, middleTip);
  setSpread('spreadMiddleRing', middleTip, ringTip);
  setSpread('spreadRingPinky', ringTip, pinkyTip);
}
