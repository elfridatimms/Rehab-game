import type { GameMode } from '../types';
import type {
  DetectorId,
  FailureDetectorOutput,
} from '../detectors/detectorTypes';

// ─── Metadata ────────────────────────────────────────────────
export type ArmUnderTest = 'left' | 'right' | 'both';
export type CameraAngle = 'frontal' | 'oblique30' | 'other';
export type Lighting = 'good' | 'dim' | 'backlit' | 'other';
export type Occlusion = 'none' | 'sleeve' | 'crossing' | 'self';
export type Background = 'plain' | 'cluttered';
export type MovementSpeed = 'slow2s' | 'normal1s';

// v1.10: orientation flag for exercises that can be done either from the
// side (forearm horizontal, sagittal plane) OR with the forearm pointing
// toward the camera (frontal). Recorded so analysis can split trials.
export type ViewOrientation = 'side' | 'front' | 'na';

export interface TrialMetadata {
  arm: ArmUnderTest;
  distanceCm: number;
  cameraAngle: CameraAngle;
  lighting: Lighting;
  occlusion: Occlusion;
  background: Background;
  speed: MovementSpeed;
  notes: string;
  /** v1.10: only meaningful for `Exercise.bidirectional === true`.
   *  For other exercises always `'na'`. */
  viewOrientation: ViewOrientation;
}

// Human-readable labels for CSV/UI; centralised so dropdowns + export stay
// in sync.
export const ARM_LABELS: Record<ArmUnderTest, string> = {
  left: 'left only',
  right: 'right only',
  both: 'both',
};

export const CAMERA_ANGLE_LABELS: Record<CameraAngle, string> = {
  frontal: 'frontal',
  oblique30: 'oblique ~30°',
  other: 'other',
};

export const LIGHTING_LABELS: Record<Lighting, string> = {
  good: 'good ambient',
  dim: 'dim',
  backlit: 'backlit',
  other: 'other',
};

export const OCCLUSION_LABELS: Record<Occlusion, string> = {
  none: 'none',
  sleeve: 'sleeve',
  crossing: 'other hand crossing',
  self: 'self-occlusion',
};

export const BACKGROUND_LABELS: Record<Background, string> = {
  plain: 'plain',
  cluttered: 'cluttered',
};

export const SPEED_LABELS: Record<MovementSpeed, string> = {
  slow2s: 'slow ~2s/dir',
  normal1s: 'normal ~1s/dir',
};

export const VIEW_ORIENTATION_LABELS: Record<ViewOrientation, string> = {
  side: 'side (forearm horizontal)',
  front: 'front (forearm toward camera)',
  na: 'n/a',
};

// ─── Per-frame capture row ───────────────────────────────────
/** One captured frame. Mode determines which fields are populated;
 *  unrelated fields stay `null` and serialise to empty strings. */
export interface FrameRow {
  frame_idx: number;
  timestamp_ms: number;
  // ELBOW
  active_side: 'left' | 'right' | null;
  // Shared per-side (interpretation depends on mode: degrees for elbow/wrist,
  // percent for fingers).
  left_raw: number | null;
  left_filtered: number | null;
  left_visibility: number | null;
  right_raw: number | null;
  right_filtered: number | null;
  right_visibility: number | null;
}

export type SideKey = 'left' | 'right';

/** Per-side classification computed post-hoc (in `anomaly.ts`).
 *
 *   ok              — landmark detected, formula produced finite value in range
 *   no_landmark     — tracker was called but no landmark present this frame
 *   low_visibility  — landmark present but visibility < threshold
 *   out_of_range    — value outside anatomically plausible range for this mode
 *   ok|jump         — value plausible, but |Δ| from previous raw > threshold
 */
export type FrameStatus =
  | 'ok'
  | 'no_landmark'
  | 'low_visibility'
  | 'out_of_range'
  | 'ok|jump';

/** FrameRow augmented with per-side anomaly annotations (post-hoc). */
export interface EnrichedFrameRow extends FrameRow {
  left_frame_status: FrameStatus;
  right_frame_status: FrameStatus;
  /** 0 if frame_status === 'ok', else 1. */
  left_anomaly_flag: 0 | 1;
  right_anomaly_flag: 0 | 1;
  /** Per-detector outputs captured at this frame. Present only when the
   *  trial's active exercise has detectors. */
  detector_outputs?: Partial<Record<DetectorId, FailureDetectorOutput>>;
}

// ─── Per-trial side stats ────────────────────────────────────
export interface SideStats {
  rawMin: number | null;
  rawMax: number | null;
  rawRom: number | null;
  filtMin: number | null;
  filtMax: number | null;
  filtRom: number | null;
  filtStd: number | null;
  lowVisibilityPct: number | null;
}

/** Validity decision recorded with each trial summary. */
export type Validity = 'valid' | 'partial' | 'invalid' | 'save_anyway';

// ─── Summary row (one per trial) ─────────────────────────────
export interface TrialSummary {
  trial_idx: number;
  timestamp_iso: string;
  /** Trial start wall clock — same as timestamp_iso, kept as explicit column. */
  trial_start_iso: string;
  subject_id: string;
  mode: GameMode;
  exercise_id: string;
  exercise_label: string;
  suitability: string;
  arm: string;
  distance_cm: number;
  camera_angle: string;
  lighting: string;
  occlusion: string;
  background: string;
  speed: string;
  notes: string;
  duration_s: number;
  n_frames: number;
  // Side stats (filtered + low-vis %).
  left_raw_min: number | null;
  left_raw_max: number | null;
  left_raw_rom: number | null;
  left_filt_min: number | null;
  left_filt_max: number | null;
  left_filt_rom: number | null;
  left_filt_std: number | null;
  left_low_visibility_pct: number | null;
  right_raw_min: number | null;
  right_raw_max: number | null;
  right_raw_rom: number | null;
  right_filt_min: number | null;
  right_filt_max: number | null;
  right_filt_rom: number | null;
  right_filt_std: number | null;
  right_low_visibility_pct: number | null;
  // Post-hoc anomaly + sampling stats.
  fps_mean: number | null;
  fps_min: number | null;
  fps_max: number | null;
  n_dropped_frames: number;
  left_raw_peak: number | null;
  left_raw_peak_clean: number | null;
  right_raw_peak: number | null;
  right_raw_peak_clean: number | null;
  n_anomaly_frames_left: number;
  n_anomaly_frames_right: number;
  /** Validity decision: valid | partial | invalid | save_anyway. */
  validity: Validity;
  filename: string;

  // ─── v1.3 additions (exercise-detector framework) ─────────
  /** Uppercase YES / PARTIAL / NO (separate from the lowercase legacy
   *  `suitability` column, which is kept for backward compatibility). */
  exercise_suitability: 'YES' | 'PARTIAL' | 'NO';
  /** Comma-separated list of detector ids active for this trial. Empty
   *  string when the exercise is YES (no detectors). */
  detectors_active: string;
  /** Compact JSON: { "<detector_id>": { trigger_rate, mean_confidence,
   *  evidence_examples: [first, middle, last] } } */
  detector_summary_json: string;
  /** Label of the camera device used during the trial. Filled in by the
   *  recorder from the active video input device. */
  camera_label: string;
  /** App version string, e.g. "v1.3-exercise-detectors". */
  app_version: string;
  /** v1.10: side / front / na for ambidirectional wrist exercises. */
  view_orientation: string;
  /** v1.10: clinical target ROM as a string (carried verbatim from
   *  exercise registry, for analysis convenience). */
  target_rom: string;
}

// ─── Live recorder status ────────────────────────────────────
export interface RecorderStatus {
  isRecording: boolean;
  trialIdx: number;
  elapsedSec: number;
  frameCount: number;
  lastSummary: TrialSummary | null;
  /** Enriched frames from the most recently saved trial (for inline plot). */
  lastFrames: readonly EnrichedFrameRow[] | null;
}
