import type { GameMode } from '../types';
import type { DetectorId } from '../detectors/detectorTypes';

/** Spec uses uppercase YES/PARTIAL/NO; matches the labels shown in UI
 *  badges and the new `exercise_suitability` CSV column. */
export type ExerciseSuitability = 'YES' | 'PARTIAL' | 'NO';

export interface Exercise {
  /** Stable id; matches the CSV `exercise_id` column. */
  id: string;
  mode: GameMode;
  nameEn: string;
  nameHr: string;
  /** Camera-adapted instructions on how to perform the movement. */
  instructionsEn: string;
  instructionsHr: string;
  /** v1.4: How to physically set up so the camera can see the movement.
   *  Distinct from `instructionsEn` (which is the motion itself). */
  cameraSetupEn: string;
  cameraSetupHr: string;
  /** v1.4: What landmarks must remain visible during the movement, and
   *  any expected occlusions the system will encounter. */
  visibilityEn: string;
  visibilityHr: string;
  /** Human-readable hold duration e.g. "1-2", "15-30", or null. */
  holdSeconds: string | null;
  /** Human-readable rep count e.g. "4", "10-15", or null. */
  repetitions: string | null;
  /** What must stay still / move-only; one line, used verbatim in UI. */
  jointConstraints: string;
  /** v1.10: clinical target ROM string per source PDF
   *  (CommonConditionResearch Sheet2). Shown in the toolbar next to the
   *  exercise dropdown. `null` when the literature doesn't specify. */
  targetROM?: string | null;
  /** v1.10: exercise can be performed both from the side (forearm
   *  horizontal, sagittal) AND with forearm pointing toward the camera
   *  (frontal). When true the trial metadata gets a `view_orientation`
   *  toggle so the CSV records which one was used. */
  bidirectional?: boolean;
  expectedSuitability: ExerciseSuitability;
  /** Detectors that run on every frame while this exercise is active. */
  activeDetectors: readonly DetectorId[];
  /** Why this exercise is YES/PARTIAL/NO. Used in CSV exports and tooltips. */
  rationale: string;
}

// ─── App version ─────────────────────────────────────────────
/** Bump this whenever the recording schema changes. Written into the
 *  summary CSV column `app_version`. */
export const APP_VERSION = 'v1.15a-angle-min-max-rom';
