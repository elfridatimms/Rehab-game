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
    // Legacy fields kept on the state shape for CSV schema stability —
    // not populated by the current tracker.
    rawWrist3DDeg: null,
    smoothedWrist3DDeg: null,
    spreadThumbIndex: null,
    spreadIndexMiddle: null,
    spreadMiddleRing: null,
    spreadRingPinky: null,
  };
}

/**
 * Wrist flexion / extension — HANDS-ONLY, side view.
 *
 * The user holds the forearm UPRIGHT (vertical) and the hand pointing
 * up; bending the wrist tilts the hand left/right in the image. We
 * report the angle of the hand vector measured from the HORIZONTAL
 * axis, so:
 *
 *   wrist     = handLandmarks[0]   (vertex)
 *   middleMCP = handLandmarks[9]   (hand direction)
 *
 *   vert  =  wrist.y − mcp.y                    // +ve when hand is ABOVE wrist
 *   horiz = (wrist.x − mcp.x) * aspect          // signed left/right
 *   angle =  atan2(vert, horiz) * 180/π         // hand-up = +90
 *
 *   0°    = hand tilted fully to one side  (horizontal)
 *   90°   = hand pointing straight UP — neutral (in line with the
 *           upright forearm)
 *   180°  = hand tilted fully to the other side (horizontal)
 *
 * This is computed so the displayed number matches the on-screen line
 * EXACTLY: the overlay draws wrist→MCP in mirrored canvas space and the
 * angle of that line from the horizontal reference equals this value.
 *
 * Below-horizontal positions (outside the flex/extend range for an
 * upright forearm) are clamped to the nearer end of the 0..180 sweep.
 *
 * No Pose, no forearm tracking, no visibility gate. Works on a single
 * hand — the other can be entirely out of frame.
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

  const vert = wrist.y - middleMCP.y;
  const horiz = (wrist.x - middleMCP.x) * CAMERA_ASPECT_W_OVER_H;

  if (vert === 0 && horiz === 0) {
    state.smoothedWristExtensionDeg = null;
    state.rawWristExtensionDeg = null;
    state.visibility = null;
    return state;
  }

  let angleDeg = (Math.atan2(vert, horiz) * 180) / Math.PI; // -180..180, up = +90
  // Hand dipped below horizontal — outside the exercise range. Clamp to
  // the nearer extreme so the number doesn't wrap through negatives.
  if (angleDeg < 0) angleDeg = horiz >= 0 ? 0 : 180;

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
