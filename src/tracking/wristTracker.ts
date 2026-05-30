import type { Landmark, HandTrackingState } from '../types';
import {
  SMOOTHING_FACTOR,
  WRIST_SMOOTHING_FACTOR,
  CAMERA_ASPECT_W_OVER_H,
  VISIBILITY_TRACK_THRESHOLD,
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
 * Wrist angle — identical formula to the elbow tracker, just with the
 * vertex at the wrist instead of at the elbow.
 *
 * Vertex      = wrist (Hands landmark 0)
 * Vector A    = wrist → elbow (Pose landmark 13/14)   [forearm side]
 * Vector B    = wrist → middle MCP (Hands landmark 9) [hand side]
 *
 *   dot   = A · B
 *   interior = acos(dot / (|A| · |B|)) * 180 / π        // 0..180
 *   flexion  = 180 − interior                           // clinical conv
 *
 *   0°   = wrist STRAIGHT (hand continues forearm — vectors anti-parallel)
 *   90°  = wrist bent perpendicular to forearm
 *   180° = wrist folded back parallel to forearm (anatomically rare)
 *
 * Same convention as elbow:
 *   elbow 0 = extended    | wrist 0 = straight
 *   elbow ~150 = max fold | wrist ~80-90 = anatomical max bend
 *
 * x components scaled by CAMERA_ASPECT_W_OVER_H (4/3) so x and y are
 * in the same pixel unit — matches the elbow tracker exactly.
 *
 * NOTE on prayer-stretch pose (forearm vertical, hand vertical up):
 * because forearm goes wrist→elbow UP and hand also goes wrist→MCP UP,
 * the two vectors are PARALLEL, so interior ≈ 0 and flexion ≈ 180.
 * That is geometrically what's happening — the wrist is fully
 * back-folded relative to its anatomical neutral. The secondary
 * "p:Y°" overlay value also reports this interior directly.
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

  // Reject occluded / hallucinated elbow (prayer stretch tends to hide
  // it behind the body). Without this, a low-vis elbow would still feed
  // the forearm vector and the angle would jump frame to frame.
  if (
    (elbow.visibility ?? 0) < VISIBILITY_TRACK_THRESHOLD ||
    elbow.x < 0 || elbow.x > 1 || elbow.y < 0 || elbow.y > 1
  ) {
    state.smoothedWristExtensionDeg = null;
    state.rawWristExtensionDeg = null;
    state.visibility = null;
    return state;
  }

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
  const magAB = Math.sqrt(ab.x ** 2 + ab.y ** 2);
  const magCB = Math.sqrt(cb.x ** 2 + cb.y ** 2);
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
