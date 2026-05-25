import type {
  DetectorInput,
  FailureDetector,
  FailureDetectorOutput,
  HandLandmark,
} from './detectorTypes';

// Empirically-derived ambiguous band on a 0–1 openness scale: hook fist,
// flat fist, and partial hyperextension all map into roughly the same
// average ratio.
const BAND_LOW = 0.15;
const BAND_HIGH = 0.4;
const BAND_CENTER = (BAND_LOW + BAND_HIGH) / 2;
const BAND_HALF_WIDTH = (BAND_HIGH - BAND_LOW) / 2;

// Mirror fingerTracker's mapping so we don't import it (decoupled).
// v1.14: restored to the old, stable values.
const FINGER_RATIO_CLOSED = 1.4;
const FINGER_RATIO_OPEN = 2.6;
const FINGERTIP_INDICES = [4, 8, 12, 16, 20] as const;

function isFiniteLandmark(lm: HandLandmark | undefined): lm is HandLandmark {
  return !!lm && Number.isFinite(lm.x) && Number.isFinite(lm.y);
}

function dist(a: HandLandmark, b: HandLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function localOpenness(landmarks: readonly HandLandmark[] | null): number | null {
  if (!landmarks || landmarks.length < 21) return null;
  const wrist = landmarks[0];
  const middleMCP = landmarks[9];
  if (!isFiniteLandmark(wrist) || !isFiniteLandmark(middleMCP)) return null;
  const palm = dist(wrist, middleMCP);
  if (palm < 0.001) return null;
  let n = 0;
  let total = 0;
  for (const idx of FINGERTIP_INDICES) {
    const tip = landmarks[idx];
    if (!isFiniteLandmark(tip)) continue;
    total += dist(wrist, tip) / palm;
    n++;
  }
  if (n === 0) return null;
  const avgRatio = total / n;
  const t = (avgRatio - FINGER_RATIO_CLOSED) / (FINGER_RATIO_OPEN - FINGER_RATIO_CLOSED);
  return Math.max(0, Math.min(1, t));
}

/**
 * @detector PoseDiscrimination
 *
 * @purpose
 * Flags frames where the openness score lands in the empirically
 * ambiguous band [0.15, 0.40] — a region of the fingerTracker's output
 * where multiple distinct anatomical poses (hook fist, flat fist, partial
 * hyperextension) all map to similar values. When the score sits here, it
 * cannot be used to discriminate the actual hand shape.
 *
 * @triggers
 * - For the hand whose openness is closest to the band centre (0.275):
 *   that openness falls within [0.15, 0.40]
 *
 * @inputs
 * - leftHand, rightHand (21 landmarks each); openness is recomputed
 *   locally to keep the detector decoupled from fingerTracker
 *
 * @thresholds
 * - BAND_LOW = 0.15, BAND_HIGH = 0.40 — pilot-data calibrated; below
 *   BAND_LOW is unambiguously a full fist, above BAND_HIGH is
 *   unambiguously an open hand
 * - confidence is 1.0 at the band centre and 0 at the edges (linear)
 *
 * @evidence
 * - side: 'left' | 'right'
 * - openness_score: number — 0–1, recomputed for the chosen hand
 * - ambiguous_range: string — literal "[0.15, 0.40]" for downstream
 *   parsing of the threshold used
 * - reason: string — present only when no openness was computable
 *
 * @limitations
 * - the band is calibrated against the fingerTracker's specific
 *   FINGER_RATIO_CLOSED / FINGER_RATIO_OPEN constants; recalibrating
 *   the tracker without updating this detector will misalign the band
 * - only signals ambiguity — does NOT tell you which pose is actually
 *   present; downstream code must treat any triggered frame as
 *   "openness is uninformative here"
 *
 * @stateful
 * no
 */
export const PoseDiscrimination: FailureDetector = {
  id: 'PoseDiscrimination',
  label: 'Ambiguous openness band',
  run(input: DetectorInput): FailureDetectorOutput {
    // Evaluate whichever hand is present; report the one that lands in
    // the band (or the most ambiguous).
    const candidates: { side: 'left' | 'right'; openness: number }[] = [];
    const leftO = localOpenness(input.leftHand);
    const rightO = localOpenness(input.rightHand);
    if (leftO !== null) candidates.push({ side: 'left', openness: leftO });
    if (rightO !== null) candidates.push({ side: 'right', openness: rightO });

    if (candidates.length === 0) {
      return {
        detected: false,
        confidence: 0,
        evidence: { reason: 'no_openness_available' },
      };
    }

    // Pick the hand with openness closest to the band centre.
    candidates.sort(
      (a, b) =>
        Math.abs(a.openness - BAND_CENTER) - Math.abs(b.openness - BAND_CENTER)
    );
    const pick = candidates[0];
    const detected = pick.openness >= BAND_LOW && pick.openness <= BAND_HIGH;
    // Confidence peaks at centre, drops to 0 at band edges, clamped.
    const confidence = Math.max(
      0,
      Math.min(1, 1 - Math.abs(pick.openness - BAND_CENTER) / BAND_HALF_WIDTH)
    );

    return {
      detected,
      confidence,
      evidence: {
        side: pick.side,
        openness_score: Number(pick.openness.toFixed(3)),
        ambiguous_range: `[${BAND_LOW}, ${BAND_HIGH}]`,
      },
    };
  },
};
