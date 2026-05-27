import type { Landmark, HandTrackingState } from '../types';
import {
  FINGER_RATIO_CLOSED,
  FINGER_RATIO_OPEN,
  FINGER_SMOOTHING_FACTOR,
  CAMERA_ASPECT_W_OVER_H,
} from './constants';

// ─── EMA helper ───────────────────────────────────────────────
function ema(raw: number, prev: number | null): number {
  if (prev === null) return raw;
  return raw * FINGER_SMOOTHING_FACTOR + prev * (1 - FINGER_SMOOTHING_FACTOR);
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
