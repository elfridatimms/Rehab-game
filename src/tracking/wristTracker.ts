import type { Landmark, HandTrackingState } from '../types';
import {
  WRIST_SMOOTHING_FACTOR,
  CAMERA_ASPECT_W_OVER_H,
} from './constants';

// ─── EMA helper ────────────────────────────────────────────────
function ema(raw: number, prev: number | null): number {
  if (prev === null) return raw;
  return raw * WRIST_SMOOTHING_FACTOR + prev * (1 - WRIST_SMOOTHING_FACTOR);
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
    // Legacy fields — kept in HandTrackingState for CSV schema stability;
    // wrist mode no longer computes anything for them (Pose dropped).
    rawWrist3DDeg: null,
    smoothedWrist3DDeg: null,
    spreadThumbIndex: null,
    spreadIndexMiddle: null,
    spreadMiddleRing: null,
    spreadRingPinky: null,
  };
}

/**
 * Wrist flexion / extension — HANDS-ONLY (no Pose, no forearm tracking).
 *
 * Assumption: the user holds the forearm roughly HORIZONTAL in the camera
 * plane and bends the hand up or down. (Prayer-stretch / vertical-forearm
 * poses are not supported by this formula — the app's wrist mode is for
 * sideways flex/extend exercises.)
 *
 *   wrist = handLandmarks[0]      (vertex)
 *   mcp   = handLandmarks[9]      (middle-finger MCP — represents the hand)
 *
 *   n  = (mcp.x - wrist.x) * aspect          // horizontal component
 *   i  =  wrist.y - mcp.y                    // vertical (image-y is flipped)
 *
 *   angle = 90 + atan2(i, |n|) * 180/π       // 0..180
 *
 *   0°   = hand pointing fully DOWN  (max flexion)
 *  90°   = hand pointing HORIZONTAL  (neutral / aligned with forearm)
 * 180°   = hand pointing fully UP    (max extension)
 *
 * Using `|n|` collapses left/right orientation so the same formula works
 * for both hands AND for a hand seen mirrored — only the vertical bend
 * (the thing we actually want to measure) drives the output.
 *
 * Works on a single hand: the other hand can be entirely out of frame.
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
  if (!wrist || !middleMCP) {
    state.smoothedWristExtensionDeg = null;
    state.rawWristExtensionDeg = null;
    state.visibility = null;
    return state;
  }

  const n = (middleMCP.x - wrist.x) * CAMERA_ASPECT_W_OVER_H;
  const i = wrist.y - middleMCP.y;

  // Degenerate (wrist and MCP coincident) — skip update.
  if (n === 0 && i === 0) {
    state.smoothedWristExtensionDeg = null;
    state.rawWristExtensionDeg = null;
    state.visibility = null;
    return state;
  }

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
