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
 * Wrist flexion / extension — same elbow-style formula as before, but
 * with NO elbow visibility gate. The angle is computed against the
 * forearm direction (wrist → elbow), so neutral reads 0 regardless of
 * which way the forearm is pointing (sideways, vertical, diagonal).
 *
 *   wrist     = handLandmarks[0]                  (vertex)
 *   middleMCP = handLandmarks[9]                  (hand direction)
 *   elbow     = poseLandmarks[13|14]              (forearm direction)
 *
 *   A  = (elbow − wrist) * aspect       // forearm side
 *   B  = (mcp   − wrist) * aspect       // hand side
 *   interior = acos(A·B / (|A|·|B|))    // 0..180
 *   flexion  = 180 − interior           // clinical convention
 *
 *   0°   = wrist STRAIGHT (hand continues forearm — vectors anti-parallel)
 *   ~90° = wrist bent perpendicular to forearm
 *   180° = wrist folded back parallel to forearm (rare anatomically)
 *
 * Pose is REQUIRED to know where the elbow is, but a missing or
 * low-visibility elbow no longer nulls the angle for the whole frame:
 *   - hand landmarks missing  → angle = null (hand isn't visible)
 *   - pose landmarks missing  → angle = null (forearm unknown)
 *   - elbow with low vis      → still computed (better degraded than nothing)
 *
 * Single hand works: the formula reads per-side, so the other hand can
 * be entirely out of frame.
 */
export function updateWristExtension(
  state: HandTrackingState,
  handLandmarks: Landmark[] | undefined,
  poseLandmarks: Landmark[] | undefined,
  side: 'left' | 'right',
): HandTrackingState {
  if (!handLandmarks || handLandmarks.length < 10) {
    state.smoothedWristExtensionDeg = null;
    state.rawWristExtensionDeg = null;
    state.visibility = null;
    return state;
  }
  if (!poseLandmarks || poseLandmarks.length < 17) {
    state.smoothedWristExtensionDeg = null;
    state.rawWristExtensionDeg = null;
    state.visibility = null;
    return state;
  }

  const elbow = poseLandmarks[side === 'left' ? 13 : 14];
  if (!elbow) {
    state.smoothedWristExtensionDeg = null;
    state.rawWristExtensionDeg = null;
    state.visibility = null;
    return state;
  }
  // NOTE: no visibility / in-frame gate on the elbow. A low-vis elbow
  // can still give a usable direction; gating it out was what broke the
  // single-hand experience (whole arm hidden behind body → angle null).
  // We only bail when the landmark is missing outright (handled above).

  const wrist = handLandmarks[0];
  const middleMCP = handLandmarks[9];

  // Forearm side: wrist → elbow. Hand side: wrist → MCP. Aspect-corrected.
  const ab = {
    x: (elbow.x - wrist.x) * CAMERA_ASPECT_W_OVER_H,
    y: elbow.y - wrist.y,
  };
  const cb = {
    x: (middleMCP.x - wrist.x) * CAMERA_ASPECT_W_OVER_H,
    y: middleMCP.y - wrist.y,
  };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.hypot(ab.x, ab.y);
  const magCB = Math.hypot(cb.x, cb.y);
  if (magAB === 0 || magCB === 0) {
    state.smoothedWristExtensionDeg = null;
    state.rawWristExtensionDeg = null;
    state.visibility = null;
    return state;
  }
  const cosAngle = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
  const interior = (Math.acos(cosAngle) * 180) / Math.PI;
  const angleDeg = 180 - interior;

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
