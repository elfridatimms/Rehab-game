import type {
  DetectorInput,
  FailureDetector,
  FailureDetectorOutput,
  HandLandmark,
} from './detectorTypes';

// IOU threshold above which we consider the hand bboxes "overlapping".
const IOU_THRESHOLD = 0.3;
// Centroid-distance threshold (fraction of frame width).
const CENTROID_DIST_THRESHOLD = 0.05;

interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function landmarkBbox(landmarks: readonly HandLandmark[]): Bbox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let anyFinite = false;
  for (const lm of landmarks) {
    if (!Number.isFinite(lm.x) || !Number.isFinite(lm.y)) continue;
    anyFinite = true;
    if (lm.x < minX) minX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y > maxY) maxY = lm.y;
  }
  if (!anyFinite) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function iou(a: Bbox, b: Bbox): number {
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.w, b.x + b.w);
  const iy2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function centroidDist(a: Bbox, b: Bbox): number {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  return Math.hypot(ax - bx, ay - by);
}

/**
 * @detector DualHandOcclusion
 *
 * @purpose
 * Detects when the two MediaPipe hand bounding boxes overlap or coincide,
 * indicating that one hand is physically covering the other. The score the
 * tracker produces for the target hand becomes unreliable while the
 * detector is triggered.
 *
 * @triggers
 * - Both leftHand and rightHand landmark sets are present in the frame
 * - bbox IOU > 0.3, OR centroid distance < 0.05 of the frame width
 *
 * @inputs
 * - leftHand, rightHand (21 landmarks each, normalised image coords)
 *
 * @thresholds
 * - IOU_THRESHOLD = 0.3 — empirical cutoff above which the two bboxes share
 *   enough area that landmark sets begin to confuse
 * - CENTROID_DIST_THRESHOLD = 0.05 (5% of frame width) — catches the case
 *   where bboxes are similar size but centred on top of each other (IOU
 *   misses some near-coincident configurations)
 *
 * @evidence
 * - iou: number — overlap ratio, 0–1
 * - left_bbox: string "[x,y,w,h]" of the left-hand landmark bbox in
 *   normalised coords
 * - right_bbox: string "[x,y,w,h]" of the right-hand landmark bbox
 * - centroid_dist_norm: number — centre-to-centre distance, normalised
 * - reason: string — present only when no decision is possible
 *   ("only_one_hand_visible", "no_finite_landmarks")
 *
 * @limitations
 * - bbox-only metric ignores actual hand orientation; two crossed but
 *   non-overlapping hands held in the same area can register low IOU
 * - assumes 1:1 normalised coords; on heavily non-square frames the
 *   centroid threshold is slightly biased
 *
 * @stateful
 * no
 */
export const DualHandOcclusion: FailureDetector = {
  id: 'DualHandOcclusion',
  label: 'Dual-hand occlusion',
  run(input: DetectorInput): FailureDetectorOutput {
    const { leftHand, rightHand } = input;

    if (!leftHand || !rightHand) {
      return {
        detected: false,
        confidence: 0,
        evidence: { iou: 0, reason: 'only_one_hand_visible' },
      };
    }
    const lbb = landmarkBbox(leftHand);
    const rbb = landmarkBbox(rightHand);
    if (!lbb || !rbb) {
      return {
        detected: false,
        confidence: 0,
        evidence: { iou: 0, reason: 'no_finite_landmarks' },
      };
    }

    const overlapIou = iou(lbb, rbb);
    // Landmarks are in normalized 0–1 image coords, so frame width = 1.
    const cDist = centroidDist(lbb, rbb);

    const detected = overlapIou > IOU_THRESHOLD || cDist < CENTROID_DIST_THRESHOLD;
    const confidence = Math.max(0, Math.min(1, overlapIou));

    return {
      detected,
      confidence,
      evidence: {
        iou: Number(overlapIou.toFixed(3)),
        left_bbox: `[${lbb.x.toFixed(3)},${lbb.y.toFixed(3)},${lbb.w.toFixed(3)},${lbb.h.toFixed(3)}]`,
        right_bbox: `[${rbb.x.toFixed(3)},${rbb.y.toFixed(3)},${rbb.w.toFixed(3)},${rbb.h.toFixed(3)}]`,
        centroid_dist_norm: Number(cDist.toFixed(4)),
      },
    };
  },
};
