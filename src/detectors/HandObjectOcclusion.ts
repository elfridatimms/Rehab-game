import type {
  DetectorInput,
  FailureDetector,
  FailureDetectorOutput,
  HandLandmark,
} from './detectorTypes';

// Same constants the fingerTracker uses for the closed/open ratio mapping.
// Replicated here so this detector does NOT import the tracker (decoupling).
// v1.14: restored to the old, stable values (1.4 / 2.6) — paired with
// palm-length normalisation in the tracker.
const FINGER_RATIO_CLOSED = 1.4;
const FINGER_RATIO_OPEN = 2.6;
const FINGERTIP_INDICES = [4, 8, 12, 16, 20] as const;

function dist(a: HandLandmark, b: HandLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isFiniteLandmark(lm: HandLandmark | undefined): lm is HandLandmark {
  return !!lm && Number.isFinite(lm.x) && Number.isFinite(lm.y);
}

/** Locally computed openness in 0–1 (not 0–100); mirrors fingerTracker math
 *  but is intentionally self-contained. Returns null when input is
 *  insufficient. */
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

function nFingertipsVisible(landmarks: readonly HandLandmark[] | null): number {
  if (!landmarks || landmarks.length < 21) return 0;
  let n = 0;
  for (const idx of FINGERTIP_INDICES) {
    if (isFiniteLandmark(landmarks[idx])) n++;
  }
  return n;
}

/**
 * @detector HandObjectOcclusion
 *
 * @purpose
 * Detects when a hand appears to be gripping an object — handedness
 * confidence drops while the openness score sits near the closed end of
 * the range. Used for exercises like wrist curls and grip strengthening
 * where the held object occludes the fingertip landmarks the tracker
 * relies on.
 *
 * @triggers
 * - For the worse of left/right: handedness_score < 0.5 AND
 *   locally-computed openness < 0.25
 *
 * @inputs
 * - leftHand, rightHand (21 landmarks each)
 * - handednessLeft.score, handednessRight.score (proxy = fraction of the
 *   21 landmarks with finite x,y, filled in by enrichFrameWithDetectors)
 *
 * @thresholds
 * - handedness threshold = 0.5 — below this the model has lost track of
 *   half the hand landmarks; a meaningful chunk of the hand is occluded
 * - openness threshold = 0.25 (on 0–1 scale) — empirical "closed grip"
 *   cutoff; matches the lower end of the fingerTracker's open/closed mapping
 *
 * @evidence
 * - side: 'left' | 'right' — which hand produced the decision
 * - handedness_score: number — landmark-completeness proxy, 0–1
 * - openness_score: number — locally recomputed, 0–1
 * - n_fingertips_visible: number — count of finite fingertip landmarks
 *   (4, 8, 12, 16, 20)
 * - reason: string — present only when no hand was usable
 *
 * @limitations
 * - Holistic does not emit real handedness confidence; the proxy is
 *   landmark completeness, so an unoccluded hand with one missing
 *   fingertip can spuriously dip the score
 * - openness mapping constants are replicated from fingerTracker to keep
 *   the detector decoupled; if the tracker mapping is recalibrated this
 *   detector must be updated too
 *
 * @stateful
 * no
 */
export const HandObjectOcclusion: FailureDetector = {
  id: 'HandObjectOcclusion',
  label: 'Hand-object occlusion',
  run(input: DetectorInput): FailureDetectorOutput {
    // We trigger if EITHER hand exhibits the pattern; report the worse side.
    const sides: ('left' | 'right')[] = ['left', 'right'];
    let best: { side: 'left' | 'right'; score: number; openness: number; tips: number } | null = null;
    for (const side of sides) {
      const hand = side === 'left' ? input.leftHand : input.rightHand;
      const handedness = side === 'left' ? input.handednessLeft : input.handednessRight;
      if (!hand) continue;
      const openness = localOpenness(hand);
      if (openness === null) continue;
      const score = handedness?.score ?? 1;
      const tips = nFingertipsVisible(hand);

      // Lower handedness score → less confident hand → score this side higher.
      const occlusionScore = (1 - score) + (1 - openness);
      if (!best || occlusionScore > (1 - best.score) + (1 - best.openness)) {
        best = { side, score, openness, tips };
      }
    }

    if (!best) {
      return {
        detected: false,
        confidence: 0,
        evidence: { reason: 'no_hand_landmarks' },
      };
    }

    const detected = best.score < 0.5 && best.openness < 0.25;
    const confidence = Math.max(0, Math.min(1, (0.5 - best.score) * 2));

    return {
      detected,
      confidence,
      evidence: {
        side: best.side,
        handedness_score: Number(best.score.toFixed(3)),
        openness_score: Number(best.openness.toFixed(3)),
        n_fingertips_visible: best.tips,
      },
    };
  },
};
