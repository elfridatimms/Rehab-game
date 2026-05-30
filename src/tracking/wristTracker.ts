import type { Landmark, HandTrackingState } from '../types';
import {
  SMOOTHING_FACTOR,
  WRIST_SMOOTHING_FACTOR,
  CAMERA_ASPECT_W_OVER_H,
} from './constants';

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

/** v1.25: 2D forearm ↔ hand interior angle at the wrist, using Pose's
 *  image-plane elbow + Hands wrist + Hands middle-MCP. Computed in
 *  aspect-corrected pixel space so it doesn't share the depth-error
 *  problem the older worldLandmarks version had.
 *
 *  Stored on the legacy `rawWrist3DDeg` / `smoothedWrist3DDeg` fields
 *  (kept under those names so the CSV schema doesn't have to change
 *  again — the value is now a 2D interior, not a 3D magnitude).
 *
 *  Convention (for the prayer-stretch exercise where this is most
 *  useful): forearm vector wrist → elbow, hand vector wrist → MCP.
 *
 *    Straight neutral (forearm and hand collinear, both pointing the
 *    same way from the wrist — typical prayer-stretch starting pose):
 *      vectors parallel   → interior ≈ 0°
 *    As the wrist bends:    interior grows toward 90°
 *    Anti-parallel (hand doubles back to forearm direction):
 *      interior → 180°  (anatomically unreachable)
 *
 *  Returns null if Pose / Hands landmarks are missing. */
export function computeWristForearmInterior2D(
  handLandmarks: Landmark[] | undefined,
  poseLandmarks: Landmark[] | undefined,
  side: 'left' | 'right',
): number | null {
  if (!handLandmarks || handLandmarks.length < 10) return null;
  if (!poseLandmarks || poseLandmarks.length < 17) return null;

  const wrist = handLandmarks[0];
  const mcp = handLandmarks[9];
  const elbow = poseLandmarks[side === 'left' ? 13 : 14];
  if (!wrist || !mcp || !elbow) return null;

  // forearm: wrist → elbow, hand: wrist → MCP. Aspect-correct x so the
  // two vectors are in the same pixel unit.
  const fx = (elbow.x - wrist.x) * CAMERA_ASPECT_W_OVER_H;
  const fy = elbow.y - wrist.y;
  const hx = (mcp.x - wrist.x) * CAMERA_ASPECT_W_OVER_H;
  const hy = mcp.y - wrist.y;

  const magF = Math.hypot(fx, fy);
  const magH = Math.hypot(hx, hy);
  if (magF === 0 || magH === 0) return null;

  const cos = Math.max(-1, Math.min(1, (fx * hx + fy * hy) / (magF * magH)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function updateWristForearmInterior(
  state: HandTrackingState,
  handLandmarks: Landmark[] | undefined,
  poseLandmarks: Landmark[] | undefined,
  side: 'left' | 'right',
): HandTrackingState {
  const raw = computeWristForearmInterior2D(handLandmarks, poseLandmarks, side);
  state.rawWrist3DDeg = raw;
  if (raw !== null && Number.isFinite(raw)) {
    state.smoothedWrist3DDeg = ema3D(raw, state.smoothedWrist3DDeg);
  }
  return state;
}

/**
 * Wrist angle — sideways flex/ext on a continuous 0..180 scale.
 *
 * Assumes the forearm is HORIZONTAL across the image plane (the user
 * is doing the exercise to the side: arm extended, palm down or up,
 * bending the hand up = extension and down = flexion).
 *
 *   n = mcp.x   − wrist.x          // horizontal component
 *   i = wrist.y − mcp.y            // vertical component (screen-y inverted)
 *   angle_deg = 90 + atan2(i, |n|) * 180 / π
 *
 *   90  = neutral (hand in line with the horizontal forearm)
 *  →180 = hand bent UP   (extension when palm down)
 *   →0  = hand bent DOWN (flexion when palm down)
 *  range 0…180, continuous through 90 (no reset / fold at the boundary)
 *
 * abs(n) collapses left-vs-right and the canvas mirror — no per-hand
 * sign flip needed. The forearm itself isn't tracked; the "horizontal
 * forearm" assumption is the user's responsibility (camera setup).
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

  // x scaled by camera aspect (4/3) so x and y are in the same pixel
  // unit. Without this the angle is computed in distorted normalised
  // space.
  const n = (middleMCP.x - wrist.x) * CAMERA_ASPECT_W_OVER_H;
  const i = wrist.y - middleMCP.y;
  const angleDeg = 90 + (Math.atan2(i, Math.abs(n)) * 180) / Math.PI;

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
