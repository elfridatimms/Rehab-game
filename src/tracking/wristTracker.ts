import type { Landmark, HandTrackingState } from '../types';
import { SMOOTHING_FACTOR, WRIST_SMOOTHING_FACTOR } from './constants';

// ─── EMA helpers ──────────────────────────────────────────────
// v1.19: wrist uses its own (heavier) factor — 0.7 vs the elbow's 0.3.
// The 3D-deviation path (`updateWrist3D`, prayer-stretch only) keeps the
// global SMOOTHING_FACTOR because its data path is separate and the
// trade-offs there are different.
function ema(raw: number, prev: number | null): number {
  if (prev === null) return raw;
  return raw * WRIST_SMOOTHING_FACTOR + prev * (1 - WRIST_SMOOTHING_FACTOR);
}
function ema3D(raw: number, prev: number | null): number {
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
 *  world landmarks. UNSIGNED — captures the magnitude of wrist bend
 *  regardless of direction. Used for prayer-stretch analysis only;
 *  separate data path from updateWristExtension. */
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
    state.smoothedWrist3DDeg = ema3D(raw, state.smoothedWrist3DDeg);
  }
  return state;
}

/**
 * Wrist angle — restored deploy formula. See docs/SPEC.md "Wrist angle".
 *
 * Reference is a FIXED HORIZONTAL line through the wrist landmark.
 * The angle is the deviation of the hand vector (lm0 → lm9) from that
 * horizontal — NOT from vertical, NOT from the forearm direction.
 *
 *   n = mcp.x   − wrist.x          // horizontal component (signed)
 *   i = wrist.y − mcp.y            // vertical component (screen-y inverted)
 *   angle_deg = atan2(i, |n|) * 180 / π
 *
 * Range: −90° … +90°.
 *   +90 = hand straight up    (extended hand on a vertical forearm)
 *    0  = hand horizontal     (90° flex/ext from a vertical-forearm neutral)
 *   −90 = hand straight down  (hyperextension past horizontal)
 *
 * Taking the absolute value of the horizontal component collapses
 * left-vs-right and the canvas mirror into the same case, so the
 * formula behaves identically for both hands. Do NOT add a per-hand
 * sign flip on top — abs() already handles it.
 *
 * The forearm is NOT tracked. The "neutral=90" interpretation holds
 * only while the forearm is vertical and in the plane of the camera
 * (limitation documented in SPEC).
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

  const n = middleMCP.x - wrist.x;
  const i = wrist.y - middleMCP.y;
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
