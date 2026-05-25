import type { Landmark, ElbowState } from '../types';
import {
  SMOOTHING_FACTOR,
  ELBOW_SIDE_SWITCH_MARGIN,
} from './constants';

// v1.7: align with how MediaPipe's demos behave — they draw what the
// model emits, period. We keep a single low threshold so a momentarily
// occluded landmark doesn't drop the entire arm's angle.
const VISIBILITY_TRACK_THRESHOLD = 0.2;

// ─── Pure Geometry ────────────────────────────────────────────

/** v1.7: clinical-convention elbow angle in 2D image plane.
 *  0° = arm fully extended (forearm continues the upper-arm line)
 *  180° = arm fully folded (anatomically max ~150° in healthy joint)
 *
 *  Mechanically: subtract the interior angle at the elbow from 180°.
 *  Interior angle is the angle between vectors (shoulder→elbow) and
 *  (wrist→elbow), but for the clinical convention we want the angle
 *  between (extended-arm-axis = away-from-shoulder) and (forearm). The
 *  identity:  flexion = 180° − interior
 */
function elbowFlexionDeg2D(shoulder: Landmark, elbow: Landmark, wrist: Landmark): number {
  const ab = { x: shoulder.x - elbow.x, y: shoulder.y - elbow.y };
  const cb = { x: wrist.x - elbow.x, y: wrist.y - elbow.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.sqrt(ab.x ** 2 + ab.y ** 2);
  const magCB = Math.sqrt(cb.x ** 2 + cb.y ** 2);
  if (magAB === 0 || magCB === 0) return 0;
  const cosAngle = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
  const interior = (Math.acos(cosAngle) * 180) / Math.PI;
  return 180 - interior;
}

/** v1.7: clinical-convention elbow angle in 3D (world landmarks). Same
 *  convention as the 2D version: 0° extended, 180° folded. Independent
 *  of camera viewpoint. */
function elbowFlexionDeg3D(shoulder: Landmark, elbow: Landmark, wrist: Landmark): number {
  const ab = { x: shoulder.x - elbow.x, y: shoulder.y - elbow.y, z: shoulder.z - elbow.z };
  const cb = { x: wrist.x - elbow.x, y: wrist.y - elbow.y, z: wrist.z - elbow.z };
  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
  const magAB = Math.sqrt(ab.x ** 2 + ab.y ** 2 + ab.z ** 2);
  const magCB = Math.sqrt(cb.x ** 2 + cb.y ** 2 + cb.z ** 2);
  if (magAB === 0 || magCB === 0) return 0;
  const cosAngle = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
  const interior = (Math.acos(cosAngle) * 180) / Math.PI;
  return 180 - interior;
}

/** v1.6: signed in-plane angle of the pinky→index segment, used as the
 *  forearm-rotation proxy. The hand "rolls" as the radius rotates around
 *  the ulna; the pinky↔index axis rolls with it. */
function handRollDeg(pinky: Landmark, index: Landmark): number {
  // atan2(dy, dx) gives a value in (−180°, 180°]. dy is in screen-y
  // (downward positive), so we negate it so "palm-up" reads as a
  // positive rotation.
  const dx = index.x - pinky.x;
  const dy = pinky.y - index.y;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** Average visibility of an array of landmarks. */
function avgVisibility(landmarks: Landmark[]): number {
  return landmarks.reduce((s, l) => s + (l.visibility ?? 0), 0) / landmarks.length;
}

/** v1.7: single low gate. If all three landmarks have ANY meaningful
 *  visibility (≥ 0.2), trust MediaPipe and compute the angle. The model
 *  is the authority on whether the landmark exists; double-filtering
 *  produces the flicker the user observed. */
function armIsTrackable(pts: Landmark[]): boolean {
  for (const p of pts) {
    if ((p.visibility ?? 0) < VISIBILITY_TRACK_THRESHOLD) return false;
  }
  return true;
}

// ─── EMA helper ───────────────────────────────────────────────
function ema(raw: number, prev: number | null): number {
  if (prev === null) return raw;
  return raw * SMOOTHING_FACTOR + prev * (1 - SMOOTHING_FACTOR);
}

// ─── Elbow Tracker ────────────────────────────────────────────

export function createElbowState(): ElbowState {
  return {
    smoothedAngle: null,
    activeSide: null,
    leftSmoothed: null,
    rightSmoothed: null,
    left: { minDeg: null, maxDeg: null },
    right: { minDeg: null, maxDeg: null },
    leftRaw: null,
    rightRaw: null,
    leftVisibility: null,
    rightVisibility: null,
    leftSmoothed2D: null,
    rightSmoothed2D: null,
    leftSmoothed3D: null,
    rightSmoothed3D: null,
    leftForearmRotRaw: null,
    rightForearmRotRaw: null,
    leftForearmRotSmoothed: null,
    rightForearmRotSmoothed: null,
  };
}

/**
 * @tracker elbow
 *
 * @measures
 * Interior angle at the elbow joint, in degrees. v1.6: computed in 3D
 * from MediaPipe Pose world landmarks when available — the value is then
 * invariant to camera viewpoint (frontal vs side). Falls back to the 2D
 * image-plane angle if world landmarks are missing. The 2D value is also
 * kept separately so the two can be compared in analysis.
 *
 * v1.6 also exposes both arms' angles continuously. The "activeSide" is
 * still tracked for the per-trial CSV column but the overlay shows
 * whichever side(s) pass the visibility gate.
 *
 * @inputs
 * - poseLandmarks[11/12] (shoulders), [13/14] (elbows), [15/16] (wrists)
 * - poseWorldLandmarks (same indices) — 3D positions in metres
 *
 * @formula
 * For each arm (shoulder=A, elbow=B, wrist=C):
 *   ab = A − B,  cb = C − B   (3D when world landmarks present, else 2D)
 *   cos_theta = clamp((ab · cb) / (|ab| * |cb|), -1, 1)
 *   theta_deg = acos(cos_theta) * 180 / π
 *
 * v1.6 visibility gate: arm is trackable if at least 2 of 3 image-plane
 * landmarks are ≥ VISIBILITY_THRESHOLD (0.5) AND all 3 are ≥
 * VISIBILITY_TRACK_THRESHOLD (0.35). This prevents the binary flicker
 * the old strict gate caused near borderline visibilities.
 *
 * @range
 * 0° to 180°, CLINICAL CONVENTION. 0° = arm fully extended (straight),
 * 145–150° = anatomical max flexion, 180° = theoretical hyperfold
 * (geometrically reachable, not physiologically normal).
 *
 * @smoothing
 * EMA with SMOOTHING_FACTOR = 0.3 on the per-arm angle value. MediaPipe
 * Pose also applies its own landmark-level Kalman smoothing
 * (smoothLandmarks: true) before the angle is computed.
 *
 * @failsafes
 * - Missing pose → smoothedAngle/leftRaw/rightRaw cleared, EMA history
 *   retained
 * - Arm fails visibility gate → that side's raw is null, smoothing
 *   paused for it
 *
 * @limitations
 * - 2D fallback still suffers from foreshortening when the arm bends
 *   toward the camera
 * @limitations-applies-when forearm_pron_sup
 * - active-side hysteresis is per-frame visibility based; rapid camera
 *   pans where both arms briefly drop below threshold can produce a
 *   spurious side switch on recovery
 * @limitations-applies-when all
 * - geometric degeneracy near 0° / 180° makes raw angle noisy at the
 *   extremes even before smoothing
 * @limitations-applies-when all
 */
export function updateElbow(
  state: ElbowState,
  poseLandmarks: Landmark[] | undefined,
  poseWorldLandmarks?: Landmark[],
): ElbowState {
  if (!poseLandmarks || poseLandmarks.length < 17) {
    state.smoothedAngle = null;
    state.activeSide = null;
    state.leftRaw = null;
    state.rightRaw = null;
    state.leftVisibility = null;
    state.rightVisibility = null;
    return state;
  }

  // Image-plane (2D) landmarks for visibility + 2D angle.
  const leftPts = [poseLandmarks[11], poseLandmarks[13], poseLandmarks[15]];
  const rightPts = [poseLandmarks[12], poseLandmarks[14], poseLandmarks[16]];

  const leftTrackable = armIsTrackable(leftPts);
  const rightTrackable = armIsTrackable(rightPts);

  // 2D angles (clinical convention: 0° extended, 180° folded).
  const leftAngle2D = leftTrackable
    ? elbowFlexionDeg2D(leftPts[0], leftPts[1], leftPts[2])
    : null;
  const rightAngle2D = rightTrackable
    ? elbowFlexionDeg2D(rightPts[0], rightPts[1], rightPts[2])
    : null;

  // 3D angles when world landmarks are present (same convention).
  let leftAngle3D: number | null = null;
  let rightAngle3D: number | null = null;
  if (poseWorldLandmarks && poseWorldLandmarks.length >= 17) {
    if (leftTrackable) {
      leftAngle3D = elbowFlexionDeg3D(
        poseWorldLandmarks[11],
        poseWorldLandmarks[13],
        poseWorldLandmarks[15],
      );
    }
    if (rightTrackable) {
      rightAngle3D = elbowFlexionDeg3D(
        poseWorldLandmarks[12],
        poseWorldLandmarks[14],
        poseWorldLandmarks[16],
      );
    }
  }

  // Canonical raw = 3D when available, else 2D. This is what the CSV
  // and downstream analysis see.
  const leftAngle = leftAngle3D ?? leftAngle2D;
  const rightAngle = rightAngle3D ?? rightAngle2D;

  const leftVis = leftTrackable ? avgVisibility(leftPts) : 0;
  const rightVis = rightTrackable ? avgVisibility(rightPts) : 0;

  state.leftRaw = leftAngle;
  state.rightRaw = rightAngle;
  state.leftVisibility = avgVisibility(leftPts);
  state.rightVisibility = avgVisibility(rightPts);

  // Smooth each side independently.
  if (leftAngle !== null) {
    state.leftSmoothed = ema(leftAngle, state.leftSmoothed);
    state.left.minDeg =
      state.left.minDeg === null
        ? state.leftSmoothed
        : Math.min(state.left.minDeg, state.leftSmoothed);
    state.left.maxDeg =
      state.left.maxDeg === null
        ? state.leftSmoothed
        : Math.max(state.left.maxDeg, state.leftSmoothed);
  }
  if (leftAngle2D !== null) {
    state.leftSmoothed2D = ema(leftAngle2D, state.leftSmoothed2D);
  }
  if (leftAngle3D !== null) {
    state.leftSmoothed3D = ema(leftAngle3D, state.leftSmoothed3D);
  }

  if (rightAngle !== null) {
    state.rightSmoothed = ema(rightAngle, state.rightSmoothed);
    state.right.minDeg =
      state.right.minDeg === null
        ? state.rightSmoothed
        : Math.min(state.right.minDeg, state.rightSmoothed);
    state.right.maxDeg =
      state.right.maxDeg === null
        ? state.rightSmoothed
        : Math.max(state.right.maxDeg, state.rightSmoothed);
  }
  if (rightAngle2D !== null) {
    state.rightSmoothed2D = ema(rightAngle2D, state.rightSmoothed2D);
  }
  if (rightAngle3D !== null) {
    state.rightSmoothed3D = ema(rightAngle3D, state.rightSmoothed3D);
  }

  // Sticky active side (used by CSV's `active_side` column).
  if (leftTrackable && rightTrackable) {
    if (state.activeSide === null) {
      state.activeSide = leftVis >= rightVis ? 'L' : 'R';
    } else {
      const currentVis = state.activeSide === 'L' ? leftVis : rightVis;
      const otherVis = state.activeSide === 'L' ? rightVis : leftVis;
      if (otherVis > currentVis + ELBOW_SIDE_SWITCH_MARGIN) {
        state.activeSide = state.activeSide === 'L' ? 'R' : 'L';
      }
    }
  } else if (leftTrackable) {
    state.activeSide = 'L';
  } else if (rightTrackable) {
    state.activeSide = 'R';
  } else {
    state.activeSide = null;
  }

  state.smoothedAngle =
    state.activeSide === 'L'
      ? state.leftSmoothed
      : state.activeSide === 'R'
        ? state.rightSmoothed
        : null;

  return state;
}

/** v1.6: continuous forearm-rotation measurement. Uses MediaPipe Pose's
 *  per-hand pinky/index landmarks (17/19 left, 18/20 right) — they roll
 *  with the radius as it rotates around the ulna.
 *
 *  Output is a signed angle in (−180°, 180°]. The reading is RELATIVE in
 *  the sense that there's no anatomical zero — but ROM across a trial is
 *  the difference (max − min), which is exactly what pron/sup asks. */
export function updateForearmRotation(
  state: ElbowState,
  poseLandmarks: Landmark[] | undefined,
): ElbowState {
  if (!poseLandmarks || poseLandmarks.length < 21) {
    state.leftForearmRotRaw = null;
    state.rightForearmRotRaw = null;
    return state;
  }

  // Left: pinky 17, index 19. Visibility-gated to avoid garbage from
  // out-of-frame fingers.
  const lp = poseLandmarks[17];
  const li = poseLandmarks[19];
  if (
    lp && li &&
    (lp.visibility ?? 0) >= VISIBILITY_TRACK_THRESHOLD &&
    (li.visibility ?? 0) >= VISIBILITY_TRACK_THRESHOLD
  ) {
    const raw = handRollDeg(lp, li);
    state.leftForearmRotRaw = raw;
    state.leftForearmRotSmoothed = ema(raw, state.leftForearmRotSmoothed);
  } else {
    state.leftForearmRotRaw = null;
  }

  // Right: pinky 18, index 20.
  const rp = poseLandmarks[18];
  const ri = poseLandmarks[20];
  if (
    rp && ri &&
    (rp.visibility ?? 0) >= VISIBILITY_TRACK_THRESHOLD &&
    (ri.visibility ?? 0) >= VISIBILITY_TRACK_THRESHOLD
  ) {
    const raw = handRollDeg(rp, ri);
    state.rightForearmRotRaw = raw;
    state.rightForearmRotSmoothed = ema(raw, state.rightForearmRotSmoothed);
  } else {
    state.rightForearmRotRaw = null;
  }

  return state;
}

/** Get session low/high for the active arm. */
export function getActiveArmStats(state: ElbowState) {
  const side = state.activeSide === 'L' ? state.left : state.activeSide === 'R' ? state.right : null;
  return {
    activeSide: state.activeSide,
    minDeg: side?.minDeg ?? null,
    maxDeg: side?.maxDeg ?? null,
  };
}
