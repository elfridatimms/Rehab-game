import type {
  DetectorHistoryFrame,
  DetectorInput,
  FailureDetector,
  FailureDetectorOutput,
  HandLandmark,
} from './detectorTypes';

// History thresholds.
const MIN_FRAMES = 15;
const PATH_LENGTH_THRESHOLD = 0.08; // 8% of frame diagonal
const RESIDUAL_THRESHOLD = 0.04; // 4% of frame diagonal

// Window is the last second; the enrichment layer's 30-frame ring buffer
// gives roughly that at 30 FPS. We don't trim by time here — we just use
// however many frames sit in `history.frames`.

interface XY {
  x: number;
  y: number;
}

function wristFrom(frame: DetectorHistoryFrame, side: 'left' | 'right'): XY | null {
  const hand: HandLandmark[] | null = side === 'left' ? frame.leftHand : frame.rightHand;
  if (!hand || hand.length < 1) return null;
  const wrist = hand[0];
  if (!Number.isFinite(wrist.x) || !Number.isFinite(wrist.y)) return null;
  return { x: wrist.x, y: wrist.y };
}

function pathLength(points: readonly XY[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}

/** Standard deviation of the perpendicular distance from each point to the
 *  best-fit line through the cloud (total-least-squares). Returns 0 for
 *  fewer than 2 points. */
function lineFitResidualStd(points: readonly XY[]): number {
  const n = points.length;
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const mx = sumX / n;
  const my = sumY / n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  // Principal-axis angle.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // Perpendicular distance to that axis = projection onto the orthogonal.
  let sumPerpSq = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    // Perpendicular component: rotate by -theta, take the y-component.
    const perp = -dx * sinT + dy * cosT;
    sumPerpSq += perp * perp;
  }
  return Math.sqrt(sumPerpSq / n);
}

function evaluateSide(
  history: readonly DetectorHistoryFrame[],
  side: 'left' | 'right'
): FailureDetectorOutput | null {
  const points: XY[] = [];
  for (const f of history) {
    const p = wristFrom(f, side);
    if (p) points.push(p);
  }
  if (points.length < MIN_FRAMES) return null;

  const len = pathLength(points);
  const residual = lineFitResidualStd(points);
  // Frame diagonal in normalized coords = sqrt(1 + (h/w)^2). Assume 4:3
  // aspect (480 / 640 = 0.75) → diag = 1.25. Approximation; good enough
  // for a relative threshold.
  const diag = 1.25;
  const pathPct = len / diag;
  const residualPct = residual / diag;

  const detected = residualPct > RESIDUAL_THRESHOLD && pathPct > PATH_LENGTH_THRESHOLD;
  const confidence = Math.max(0, Math.min(1, residualPct / (RESIDUAL_THRESHOLD * 3)));

  return {
    detected,
    confidence,
    evidence: {
      side,
      path_length_pct: Number((pathPct * 100).toFixed(2)),
      line_fit_residual_pct: Number((residualPct * 100).toFixed(2)),
      n_frames_in_window: points.length,
    },
  };
}

/**
 * @detector MultiAxisMotion
 *
 * @purpose
 * Detects motion that does not fit a single-axis (line) model — circular
 * or spiral wrist trajectories. The active trackers compute a single
 * angle; if the wrist moves on a curve, that single angle is an
 * incomplete description of the movement.
 *
 * @triggers
 * - For the worse of left/right wrist trajectories over the last ≤30
 *   frames: total path length > 8% of frame diagonal AND total-least-
 *   squares line-fit residual std > 4% of frame diagonal
 *
 * @inputs
 * - history.frames[] — ring buffer of the last 30 frames'
 *   leftHand[0] and rightHand[0] wrist positions
 *
 * @thresholds
 * - MIN_FRAMES = 15 — below this the line fit is too noisy to interpret
 * - PATH_LENGTH_THRESHOLD = 0.08 (8% of frame diagonal) — gate against
 *   triggering on a stationary hand (residual is meaningless without
 *   motion)
 * - RESIDUAL_THRESHOLD = 0.04 (4% of frame diagonal) — empirical cutoff
 *   above which the trajectory clearly deviates from a straight line
 *
 * @evidence
 * - side: 'left' | 'right'
 * - path_length_pct: number — total trajectory length as percent of
 *   frame diagonal
 * - line_fit_residual_pct: number — perpendicular-distance std as percent
 *   of frame diagonal
 * - n_frames_in_window: number — how many frames had finite wrist coords
 * - reason: string — present only when no decision is possible
 *   ("insufficient_history", "no_side_has_enough_history")
 *
 * @limitations
 * - assumes 4:3 frame aspect (diag ≈ 1.25 in normalised coords)
 * - history window is frame-count based, not time based; slow recordings
 *   span a longer real-time window than fast ones
 * - cannot distinguish circular motion from a noisy straight line if the
 *   noise amplitude exceeds the curvature
 *
 * @stateful
 * no — reads but does not own the ring buffer (managed by the enrichment
 * layer)
 */
export const MultiAxisMotion: FailureDetector = {
  id: 'MultiAxisMotion',
  label: 'Multi-axis (non-planar) motion',
  run(input: DetectorInput): FailureDetectorOutput {
    const history = input.history.frames;
    if (history.length < MIN_FRAMES) {
      return {
        detected: false,
        confidence: 0,
        evidence: { reason: 'insufficient_history', n_frames: history.length },
      };
    }

    // Evaluate both sides, take the worse (higher residual) one.
    const left = evaluateSide(history, 'left');
    const right = evaluateSide(history, 'right');

    const candidates = [left, right].filter((x): x is FailureDetectorOutput => x !== null);
    if (candidates.length === 0) {
      return {
        detected: false,
        confidence: 0,
        evidence: { reason: 'no_side_has_enough_history' },
      };
    }

    // Pick the candidate with the highest confidence (worst case).
    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates[0];
  },
};
