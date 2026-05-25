import type { Landmark } from '../types';

// ─── Detector IDs ────────────────────────────────────────────
/** Stable string identifiers used in CSV columns and the exercise registry. */
export type DetectorId =
  | 'DualHandOcclusion'
  | 'HandObjectOcclusion'
  | 'MultiAxisMotion'
  | 'AxialRotation'
  | 'PoseDiscrimination'
  | 'ForceRequired';

// ─── Per-frame inputs ────────────────────────────────────────
/** MediaPipe Pose landmark. Aliased from the shared Landmark type so
 *  detectors can talk in domain terms without depending on tracker code. */
export type PoseLandmark = Landmark;
/** MediaPipe Hand landmark (21 points, no per-point visibility). */
export type HandLandmark = Landmark;

/** Synthetic handedness wrapper. MediaPipe Holistic does NOT emit a real
 *  left-vs-right handedness score, so the enrichment layer fills this with
 *  a landmark-completeness proxy: score = n_finite_landmarks / 21. The
 *  detectors that branch on `< 0.5` thus effectively trigger when a chunk
 *  of the hand is missing (consistent with the spec's intent of detecting
 *  object-grip occlusion). */
export interface HandednessScore {
  score: number;
}

/** Rolling window of past frames; maintained by the enrichment layer,
 *  read-only from a detector's perspective. */
export interface DetectorHistoryFrame {
  timestamp_ms: number;
  pose: PoseLandmark[] | null;
  leftHand: HandLandmark[] | null;
  rightHand: HandLandmark[] | null;
}

export interface DetectorHistory {
  /** Frames in chronological order; oldest first, newest last. */
  frames: readonly DetectorHistoryFrame[];
  /** Maximum capacity; informational. */
  capacity: number;
}

export interface DetectorInput {
  pose: PoseLandmark[] | null;
  leftHand: HandLandmark[] | null;
  rightHand: HandLandmark[] | null;
  handednessLeft: HandednessScore | null;
  handednessRight: HandednessScore | null;
  timestamp_ms: number;
  history: DetectorHistory;
}

// ─── Per-frame output ────────────────────────────────────────
export type DetectorEvidence = Record<string, number | string | boolean>;

export interface FailureDetectorOutput {
  detected: boolean;
  /** 0–1; how confident the detector is that the failure mode is present. */
  confidence: number;
  evidence: DetectorEvidence;
}

// ─── Detector interface ──────────────────────────────────────
export interface FailureDetector {
  readonly id: DetectorId;
  readonly label: string;
  run(input: DetectorInput): FailureDetectorOutput;
  /** Optional: detectors with persistent state (e.g. AxialRotation
   *  calibration) override this. No-op default. */
  reset?(): void;
  /** Optional: only present on detectors that require user-provided
   *  calibration (AxialRotation). When present, the detector instance is
   *  stateful and tracks calibration per side. */
  calibrate?(side: 'left' | 'right', input: DetectorInput): void;
}
