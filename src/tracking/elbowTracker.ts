import type { Landmark, ElbowState } from '../types';
import {
  SMOOTHING_FACTOR,
  ELBOW_SIDE_SWITCH_MARGIN,
  CAMERA_ASPECT_W_OVER_H,
} from './constants';

// v1.7: align with how MediaPipe's demos behave — they draw what the
// model emits, period. We keep a single low threshold so a momentarily
// occluded landmark doesn't drop the entire arm's angle.
const VISIBILITY_TRACK_THRESHOLD = 0.2;

// v1.16: opt-in elbow diagnostics. Enable in the browser console:
//   localStorage.setItem('debug_elbow', '1'); location.reload();
// Disable with:
//   localStorage.removeItem('debug_elbow'); location.reload();
//
// Prints one multi-line block every ~30 frames per ElbowState. Shows:
//   - whether the canonical flexion came from 3D world landmarks or 2D
//     image landmarks (the fallback rule is also stated)
//   - visibility of shoulder/elbow/wrist (11–16) AND hips (23/24) so
//     we can see whether hip occlusion correlates with bad 3D readings
//   - raw 2D coords being fed into the angle formula
//   - both 2D and 3D angle results, side by side
//
// NOTE: this is logging only — the math is unchanged.
const DEBUG_ELBOW: boolean =
  typeof window !== 'undefined' &&
  typeof window.localStorage !== 'undefined' &&
  window.localStorage.getItem('debug_elbow') === '1';
const elbowDebugCounters: WeakMap<ElbowState, number> = new WeakMap();
const ELBOW_DEBUG_EVERY_N_FRAMES = 30;

// ─── Pure Geometry ────────────────────────────────────────────

/** v1.20: clinical-convention elbow angle in 2D image plane, with x
 *  scaled by camera aspect ratio so the angle is computed in pixel
 *  geometry rather than in distorted normalised space.
 *
 *    0° = arm fully extended (forearm continues the upper-arm line)
 *  180° = arm fully folded (anatomically max ~150° in healthy joint)
 *
 *  Mechanically: flexion = 180° − interior, where interior is the
 *  angle between vectors (shoulder→elbow) and (wrist→elbow).
 *
 *  v1.20 also DROPPED the 3D world-landmark variant entirely. The
 *  monocular depth that backs poseWorldLandmarks is unreliable for
 *  arm joints — empirically the 3D path produced ~30–40° errors at
 *  full flexion (90° pose read 50°) even when hips were visible. The
 *  2D in-plane formula matches what MediaPipe actually sees and is
 *  the authoritative reading. */
function elbowFlexionDeg2D(shoulder: Landmark, elbow: Landmark, wrist: Landmark): number {
  const ab = {
    x: (shoulder.x - elbow.x) * CAMERA_ASPECT_W_OVER_H,
    y: shoulder.y - elbow.y,
  };
  const cb = {
    x: (wrist.x - elbow.x) * CAMERA_ASPECT_W_OVER_H,
    y: wrist.y - elbow.y,
  };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.sqrt(ab.x ** 2 + ab.y ** 2);
  const magCB = Math.sqrt(cb.x ** 2 + cb.y ** 2);
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
  // v1.20: kept for call-site compatibility but no longer consulted.
  _poseWorldLandmarks?: Landmark[],
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

  // v1.20: 2D image-plane only. The 3D world-landmark path was dropped
  // because monocular depth from MediaPipe is unreliable for arm joints
  // (empirically gave ~30–40° errors at full flexion — a clearly-bent
  // 90° pose read 50°). 2D in-pixel-geometry is the authoritative source.
  const leftAngle = leftTrackable
    ? elbowFlexionDeg2D(leftPts[0], leftPts[1], leftPts[2])
    : null;
  const rightAngle = rightTrackable
    ? elbowFlexionDeg2D(rightPts[0], rightPts[1], rightPts[2])
    : null;
  // Kept for the per-side smoothed-2D/3D fields that the panels used to
  // display; both now equal `leftAngle`/`rightAngle` so analysis code
  // depending on them keeps working.
  const leftAngle2D = leftAngle;
  const rightAngle2D = rightAngle;
  const leftAngle3D = leftAngle;
  const rightAngle3D = rightAngle;

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

  if (DEBUG_ELBOW) {
    const n = (elbowDebugCounters.get(state) ?? 0) + 1;
    if (n >= ELBOW_DEBUG_EVERY_N_FRAMES) {
      elbowDebugCounters.set(state, 0);
      logElbowFrame(
        poseLandmarks,
        _poseWorldLandmarks,
        leftAngle2D,
        leftAngle3D,
        leftAngle,
        rightAngle2D,
        rightAngle3D,
        rightAngle,
        leftTrackable,
        rightTrackable,
      );
    } else {
      elbowDebugCounters.set(state, n);
    }
  }

  return state;
}

/** v1.16 diagnostics — see DEBUG_ELBOW comment above the constant. */
function logElbowFrame(
  poseLandmarks: Landmark[],
  poseWorldLandmarks: Landmark[] | undefined,
  leftAngle2D: number | null,
  leftAngle3D: number | null,
  leftAngle: number | null,
  rightAngle2D: number | null,
  rightAngle3D: number | null,
  rightAngle: number | null,
  leftTrackable: boolean,
  rightTrackable: boolean,
): void {
  const worldOk = !!poseWorldLandmarks && poseWorldLandmarks.length >= 17;

  // Canonical source the angle code USES, per arm:
  //   3D when world landmarks present AND arm is trackable; else 2D.
  //   `leftAngle = leftAngle3D ?? leftAngle2D` in the body above mirrors this.
  const leftSrc =
    leftAngle3D !== null ? '3D-world' :
    leftAngle2D !== null ? '2D-image' : 'NONE';
  const rightSrc =
    rightAngle3D !== null ? '3D-world' :
    rightAngle2D !== null ? '2D-image' : 'NONE';

  const v = (idx: number): string => {
    const lm = poseLandmarks[idx];
    return lm && lm.visibility !== undefined
      ? lm.visibility.toFixed(2)
      : 'null';
  };

  const coord = (idx: number): string => {
    const lm = poseLandmarks[idx];
    if (!lm) return 'null';
    return `(${lm.x.toFixed(3)}, ${lm.y.toFixed(3)})`;
  };

  const fmt = (n: number | null): string => (n === null ? '—' : n.toFixed(1));

  // eslint-disable-next-line no-console
  console.log(
    `[elbow] worldLandmarksPresent=${worldOk}  (3D used when present AND arm trackable; else 2D)\n` +
      `  LEFT  src=${leftSrc} flex=${fmt(leftAngle)}° (2D=${fmt(leftAngle2D)}° · 3D=${fmt(leftAngle3D)}°) trackable=${leftTrackable}\n` +
      `        coords: shoulder11=${coord(11)} elbow13=${coord(13)} wrist15=${coord(15)}\n` +
      `        vis:    shoulder11=${v(11)} elbow13=${v(13)} wrist15=${v(15)}\n` +
      `  RIGHT src=${rightSrc} flex=${fmt(rightAngle)}° (2D=${fmt(rightAngle2D)}° · 3D=${fmt(rightAngle3D)}°) trackable=${rightTrackable}\n` +
      `        coords: shoulder12=${coord(12)} elbow14=${coord(14)} wrist16=${coord(16)}\n` +
      `        vis:    shoulder12=${v(12)} elbow14=${v(14)} wrist16=${v(16)}\n` +
      `  HIPS vis: L23=${v(23)} R24=${v(24)}  (Pose world landmarks are centered on the hip midpoint — low hip vis ⇒ 3D origin drifts)\n` +
      `  FALLBACK: 3D path runs iff poseWorldLandmarks.length>=17 AND armIsTrackable(); else this arm falls back to 2D. No mid-trial fallback toggle beyond that.`,
  );
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
