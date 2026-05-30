// ─── Core Types ───────────────────────────────────────────────
export type GameMode = 'elbow' | 'wrist' | 'fingers';
export type ElbowSide = 'L' | 'R' | null;

/** Coarse hand state for fist-making / finger-extension, derived from the
 *  functional hand-openness percent via hysteresis thresholds. */
export type HandOpenState = 'open' | 'closed' | 'transition';

// ─── Tracking State ───────────────────────────────────────────
export interface ElbowState {
  smoothedAngle: number | null;
  activeSide: ElbowSide;
  leftSmoothed: number | null;
  rightSmoothed: number | null;
  left: { minDeg: number | null; maxDeg: number | null };
  right: { minDeg: number | null; maxDeg: number | null };
  // Research-only: raw pre-EMA value + avg keypoint visibility (this frame).
  // NOT used by UI or session-peak logic.
  leftRaw: number | null;
  rightRaw: number | null;
  leftVisibility: number | null;
  rightVisibility: number | null;
  // v1.6: per-arm 2D vs 3D angle distinction. `leftSmoothed`/`rightSmoothed`
  // (above) now prefer the 3D world-landmark value when it's available, so
  // existing CSV consumers transparently get the depth-corrected number.
  // The image-plane 2D angle is kept too for direct comparison.
  leftSmoothed2D: number | null;
  rightSmoothed2D: number | null;
  leftSmoothed3D: number | null;
  rightSmoothed3D: number | null;
  // v1.6: forearm rotation (proxied via the pinky→index hand-segment angle
  // emitted by MediaPipe Pose). Continuous degree value; no calibration.
  leftForearmRotRaw: number | null;
  rightForearmRotRaw: number | null;
  leftForearmRotSmoothed: number | null;
  rightForearmRotSmoothed: number | null;
}

export interface HandTrackingState {
  smoothedWristExtensionDeg: number | null;
  peakWristExtensionDeg: number | null;
  /** v1.32: running min of the smoothed wrist angle (since state reset).
   *  Paired with peak (= max) to show live wrist ROM = peak − min. */
  minWristExtensionDeg: number | null;
  smoothedOpenHandScore: number | null;
  peakOpenHandScore: number | null;
  // Research-only: raw pre-EMA values + presence indicator (this frame).
  rawWristExtensionDeg: number | null;
  rawOpenHandScore: number | null;
  visibility: number | null;
  // v1.8: 3D wrist deviation magnitude in degrees, from Pose's
  // elbow→wrist→hand-midpoint world landmarks. UNSIGNED — captures the
  // magnitude of bend regardless of direction (flexion or extension).
  // Camera-viewpoint invariant: forward-flexing the wrist toward the
  // camera produces a real reading here, where the 2D signed angle
  // collapses.
  rawWrist3DDeg: number | null;
  smoothedWrist3DDeg: number | null;
  // v1.10: per-finger spread angles (between adjacent fingertip vectors
  // from the wrist). Useful for measuring abduction independent of the
  // overall openness score. All in degrees; null when landmarks missing.
  spreadThumbIndex: number | null;
  spreadIndexMiddle: number | null;
  spreadMiddleRing: number | null;
  spreadRingPinky: number | null;
  // ─── v1.32: functional hand-openness (fist making / finger extension) ──
  // FUNCTIONAL openness metric (not a precise anatomical finger-joint
  // measurement). palmCenter = avg(MCP 5,9,13,17); palmSize = dist(0,9);
  // raw = mean over tips {8,12,16,20} of dist(tip,palmCenter)/palmSize.
  /** Raw palm-center openness ratio (unsmoothed). Larger = more open. */
  handOpennessRaw: number | null;
  /** EMA-smoothed openness ratio. */
  handOpennessSmoothed: number | null;
  /** Running min/max of the smoothed ratio observed since this state was
   *  created (mode switch / session reset). Drives the live percent. */
  handOpennessMin: number | null;
  handOpennessMax: number | null;
  /** Live dynamic percent: (smoothed − min)/(max − min) × 100, clamped
   *  0–100. Null until at least two distinct values seen. */
  handOpennessPercent: number | null;
  /** open / closed / transition from the percent (hysteresis thresholds). */
  handState: HandOpenState | null;
}

export interface TrackingState {
  elbow: ElbowState;
  leftHand: HandTrackingState;
  rightHand: HandTrackingState;
  poseValid: boolean;
  leftHandValid: boolean;
  rightHandValid: boolean;
}

// ─── Landmark Types ───────────────────────────────────────────
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface HolisticResults {
  poseLandmarks?: Landmark[];
  /** v1.6: 3D world-space landmarks emitted by MediaPipe Pose. Origin is
   *  the body centre; units are metres; z is meaningful depth (not just
   *  the model's image-relative z that `poseLandmarks` carries). Used to
   *  compute viewpoint-invariant joint angles. */
  poseWorldLandmarks?: Landmark[];
  leftHandLandmarks?: Landmark[];
  rightHandLandmarks?: Landmark[];
  /** v1.5: real handedness confidence from MediaPipe Hands (null when the
   *  active model is Pose, or when the hand wasn't detected). */
  handednessLeft?: number | null;
  handednessRight?: number | null;
}

// ─── Game Events ──────────────────────────────────────────────
export interface GameEvent {
  type: 'star_lit' | 'beam_peak' | 'bloom_peak' | 'milestone';
  value: number;
  side?: 'left' | 'right';
  timestamp: number;
}

// ─── Session Stats ────────────────────────────────────────────
export interface SessionStats {
  starsLit: number;
  bestElbowROM: number;
  bestWristExtLeft: number;
  bestWristExtRight: number;
  bestBloomLeft: number;
  bestBloomRight: number;
  totalExerciseTime: number;
}
