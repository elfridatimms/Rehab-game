import type { Landmark, HandTrackingState } from '../types';
import { SMOOTHING_FACTOR } from './constants';

// ─── EMA helper ───────────────────────────────────────────────
function ema(raw: number, prev: number | null): number {
  if (prev === null) return raw;
  return raw * SMOOTHING_FACTOR + prev * (1 - SMOOTHING_FACTOR);
}

export function createHandState(): HandTrackingState {
  return {
    smoothedWristExtensionDeg: null,
    peakWristExtensionDeg: null,
    smoothedOpenHandScore: null,
    peakOpenHandScore: null,
    rawWristExtensionDeg: null,
    rawOpenHandScore: null,
    visibility: null,
    rawWrist3DDeg: null,
    smoothedWrist3DDeg: null,
    spreadThumbIndex: null,
    spreadIndexMiddle: null,
    spreadMiddleRing: null,
    spreadRingPinky: null,
  };
}

/** 3D wrist deviation magnitude in degrees, computed entirely from Pose
 *  world landmarks.
 *
 *   forearm  = elbow → wrist
 *   hand     = wrist → midpoint(pinky_knuckle, index_knuckle)
 *   interior = angle(forearm, hand)
 *   deviation = |180° − interior|     // 0° at neutral, 90° at full bend
 *
 *  Returns null if any required landmark is missing. UNSIGNED — captures
 *  the magnitude of wrist bend regardless of direction. */
export function computeWrist3DDeg(
  poseWorldLandmarks: Landmark[] | undefined,
  side: 'left' | 'right',
): number | null {
  if (!poseWorldLandmarks || poseWorldLandmarks.length < 21) return null;
  const elbowIdx = side === 'left' ? 13 : 14;
  const wristIdx = side === 'left' ? 15 : 16;
  const pinkyIdx = side === 'left' ? 17 : 18;
  const indexIdx = side === 'left' ? 19 : 20;

  const elbow = poseWorldLandmarks[elbowIdx];
  const wrist = poseWorldLandmarks[wristIdx];
  const pinky = poseWorldLandmarks[pinkyIdx];
  const indexFinger = poseWorldLandmarks[indexIdx];
  if (!elbow || !wrist || !pinky || !indexFinger) return null;

  const hand = {
    x: (pinky.x + indexFinger.x) / 2,
    y: (pinky.y + indexFinger.y) / 2,
    z: (pinky.z + indexFinger.z) / 2,
  };

  const v1x = elbow.x - wrist.x;
  const v1y = elbow.y - wrist.y;
  const v1z = elbow.z - wrist.z;
  const v2x = hand.x - wrist.x;
  const v2y = hand.y - wrist.y;
  const v2z = hand.z - wrist.z;

  const m1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z);
  const m2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z);
  if (m1 === 0 || m2 === 0) return null;

  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y + v1z * v2z) / (m1 * m2)));
  const interior = (Math.acos(cos) * 180) / Math.PI;
  return Math.abs(180 - interior);
}

export function updateWrist3D(
  state: HandTrackingState,
  poseWorldLandmarks: Landmark[] | undefined,
  side: 'left' | 'right',
): HandTrackingState {
  const raw = computeWrist3DDeg(poseWorldLandmarks, side);
  state.rawWrist3DDeg = raw;
  if (raw !== null && Number.isFinite(raw)) {
    state.smoothedWrist3DDeg = ema(raw, state.smoothedWrist3DDeg);
  }
  return state;
}

/**
 * Wrist flexion / extension — exact restore of the deployed formula
 * (deploy 6a11b4504e219cdcb50d1107, bundle index-vpkjw17t.js).
 *
 * CONVENTION:
 *   0    = neutral (hand in line with the forearm, horizontal)
 *   +    = extension (hand bent up / backward), up to ~+90
 *   −    = flexion  (hand bent down / forward), down to ~−90
 *
 * The key trick is taking the ABSOLUTE VALUE of the horizontal component
 * before atan2. That collapses left vs right and the mirrored display
 * (scale(-1,1)) into the same case — the formula behaves identically
 * regardless of which hand is being tracked or how the canvas is
 * mirrored. Do NOT add any per-hand negation on top: abs() already
 * handles it. Future edits must preserve neutral = 0, extension > 0,
 * flexion < 0.
 *
 * @inputs
 * - handLandmarks[0]  (wrist root)
 * - handLandmarks[9]  (middle-finger MCP)
 *
 * @formula
 *   n = middleMCP.x − wrist.x          // horizontal component
 *   i = wrist.y − middleMCP.y          // vertical component (screen y inverted)
 *   angle_deg = atan2(i, |n|) * 180 / π
 *
 * @range  −90° … +90°
 *
 * @smoothing  EMA, factor SMOOTHING_FACTOR. Peak tracked on the smoothed
 *             value (max extension reading observed).
 */
export function updateWristExtension(
  state: HandTrackingState,
  handLandmarks: Landmark[] | undefined,
): HandTrackingState {
  if (!handLandmarks || handLandmarks.length < 10) {
    state.smoothedWristExtensionDeg = null;
    state.rawWristExtensionDeg = null;
    state.visibility = null;
    return state;
  }

  const wrist = handLandmarks[0];
  const middleMCP = handLandmarks[9];

  const n = middleMCP.x - wrist.x;           // horizontal component
  const i = wrist.y - middleMCP.y;           // vertical component (screen-y inverted)
  const angleDeg = (Math.atan2(i, Math.abs(n)) * 180) / Math.PI;

  state.rawWristExtensionDeg = angleDeg;
  state.visibility = 1;
  state.smoothedWristExtensionDeg = ema(angleDeg, state.smoothedWristExtensionDeg);

  if (
    state.peakWristExtensionDeg === null ||
    state.smoothedWristExtensionDeg > state.peakWristExtensionDeg
  ) {
    state.peakWristExtensionDeg = state.smoothedWristExtensionDeg;
  }

  return state;
}
