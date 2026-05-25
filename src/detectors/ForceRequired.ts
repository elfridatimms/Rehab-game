import type {
  FailureDetector,
  FailureDetectorOutput,
} from './detectorTypes';

/**
 * @detector ForceRequired
 *
 * @purpose
 * Declarative annotation that the exercise is fundamentally force-based,
 * not kinematic, so any value the trackers emit is irrelevant to the
 * clinical question being asked. Wears the same FailureDetector interface
 * as the analytical detectors so downstream CSV analysis can filter on a
 * single `detector_<id>_detected` column.
 *
 * @triggers
 * - Always; the detector is unconditional
 *
 * @inputs
 * - none read — ignores all DetectorInput fields
 *
 * @thresholds
 * - none
 *
 * @evidence
 * - reason: string — fixed message
 *   "exercise requires force measurement, kinematics insufficient"
 *
 * @limitations
 * - emits an output every frame regardless of what is happening in front
 *   of the camera; downstream code should not treat the per-frame trigger
 *   rate (always 100%) as informative — only the presence of this
 *   detector in `detectors_active` matters
 *
 * @stateful
 * no
 */
export const ForceRequired: FailureDetector = {
  id: 'ForceRequired',
  label: 'Force-based exercise',
  run(): FailureDetectorOutput {
    return {
      detected: true,
      confidence: 1,
      evidence: {
        reason: 'exercise requires force measurement, kinematics insufficient',
      },
    };
  },
};
