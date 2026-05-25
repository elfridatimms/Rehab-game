import type {
  DetectorInput,
  FailureDetector,
  FailureDetectorOutput,
  HandLandmark,
} from './detectorTypes';

// Hand-orientation vector goes from landmark 5 (index MCP) to landmark 17
// (pinky MCP). When the forearm rotates around its long axis (pronation /
// supination), this vector swings even though the pose landmarks (elbow,
// wrist on the pose stream) stay still.

const ANGLE_THRESHOLD_DEG = 25;

function isFiniteLandmark(lm: HandLandmark | undefined): lm is HandLandmark {
  return !!lm && Number.isFinite(lm.x) && Number.isFinite(lm.y);
}

function handOrientationDeg(landmarks: readonly HandLandmark[] | null): number | null {
  if (!landmarks || landmarks.length < 18) return null;
  const a = landmarks[5];
  const b = landmarks[17];
  if (!isFiniteLandmark(a) || !isFiniteLandmark(b)) return null;
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function angularDelta(a: number, b: number): number {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

interface CalibrationState {
  /** Reference hand-orientation angle in degrees, captured at calibrate time. */
  refAngleDeg: number;
  /** Wall-clock ms when calibrated. */
  capturedAtMs: number;
}

/**
 * @detector AxialRotation
 *
 * @purpose
 * Detects rotation around the forearm long axis (pronation/supination) by
 * tracking the orientation of the index-MCP → pinky-MCP vector against a
 * user-calibrated neutral reference. The pose-landmark trackers cannot
 * observe this rotation directly because shoulder/elbow/wrist landmark
 * positions are nearly invariant under axial spin.
 *
 * @triggers
 * - After calibrate(side) has been called for at least one side: that
 *   side's |angle from neutral| exceeds 25°
 *
 * @inputs
 * - leftHand[5], leftHand[17] and rightHand[5], rightHand[17] — index
 *   MCP and pinky MCP landmarks; the cross-palm vector
 *
 * @thresholds
 * - ANGLE_THRESHOLD_DEG = 25 — meaningful pronation/supination is
 *   typically ≥30°; 25° gives a small safety margin against EMA-free
 *   per-frame jitter
 * - confidence saturates at 90° rotation
 *
 * @evidence
 * - side: 'left' | 'right'
 * - angle_from_neutral_deg: number — absolute angular delta against the
 *   calibrated reference
 * - calibrated: boolean
 * - calibration_age_ms: number — how long ago the reference was captured
 * - reason: string — present only when no decision is possible
 *
 * @limitations
 * - requires explicit user calibration; before that the detector is
 *   silent (detected=false, evidence.calibrated=false)
 * - the index-MCP → pinky-MCP vector projection is 2D; if the user tilts
 *   the forearm out of the camera plane the vector also rotates for
 *   non-axial reasons
 * - calibration is per detector instance — a new trial that reuses the
 *   same detector keeps the calibration, but a new instance starts fresh
 *
 * @stateful
 * yes — holds a Record<'left' | 'right', { refAngleDeg, capturedAtMs }>
 * inside the closure. calibrate(side, input) seeds it; reset() clears
 * both sides. Built via the createAxialRotation() factory because each
 * trial/exercise needs an independent reference.
 */
export function createAxialRotation(): FailureDetector {
  const calibration: Record<'left' | 'right', CalibrationState | null> = {
    left: null,
    right: null,
  };

  function evaluate(
    input: DetectorInput,
    side: 'left' | 'right'
  ): { hasHand: boolean; output: FailureDetectorOutput } {
    const hand = side === 'left' ? input.leftHand : input.rightHand;
    const angle = handOrientationDeg(hand);
    const ref = calibration[side];

    if (angle === null) {
      return {
        hasHand: false,
        output: {
          detected: false,
          confidence: 0,
          evidence: { side, calibrated: !!ref, reason: 'no_hand_landmark' },
        },
      };
    }

    if (!ref) {
      return {
        hasHand: true,
        output: {
          detected: false,
          confidence: 0,
          evidence: { side, calibrated: false },
        },
      };
    }

    const delta = Math.abs(angularDelta(angle, ref.refAngleDeg));
    const detected = delta > ANGLE_THRESHOLD_DEG;
    const confidence = Math.max(0, Math.min(1, delta / 90));

    return {
      hasHand: true,
      output: {
        detected,
        confidence,
        evidence: {
          side,
          angle_from_neutral_deg: Number(delta.toFixed(2)),
          calibrated: true,
          calibration_age_ms: Math.round(performance.now() - ref.capturedAtMs),
        },
      },
    };
  }

  return {
    id: 'AxialRotation',
    label: 'Axial (forearm) rotation',
    run(input) {
      const left = evaluate(input, 'left');
      const right = evaluate(input, 'right');
      // Prefer the side that has a hand AND is calibrated; among those,
      // pick the worse (higher confidence) one.
      const candidates: FailureDetectorOutput[] = [];
      if (left.hasHand) candidates.push(left.output);
      if (right.hasHand) candidates.push(right.output);
      if (candidates.length === 0) {
        return {
          detected: false,
          confidence: 0,
          evidence: { reason: 'no_hand_landmarks_either_side' },
        };
      }
      candidates.sort((a, b) => b.confidence - a.confidence);
      return candidates[0];
    },
    reset() {
      calibration.left = null;
      calibration.right = null;
    },
    calibrate(side, input) {
      const hand = side === 'left' ? input.leftHand : input.rightHand;
      const angle = handOrientationDeg(hand);
      if (angle === null) return;
      calibration[side] = {
        refAngleDeg: angle,
        capturedAtMs: performance.now(),
      };
    },
  };
}
