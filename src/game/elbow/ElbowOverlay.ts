import type { HolisticResults, ElbowState, Landmark } from '../../types';
import { VISIBILITY_TRACK_THRESHOLD } from '../../tracking/constants';

// Minimal elbow overlay — see docs/SPEC.md.
//
// Two lines + one number, drawn from the SAME Pose landmark indices
// (11/13/15 or 12/14/16) that feed updateElbow → the displayed lines
// and the displayed number can never disagree.

const COLORS = {
  reference: 'rgba(180, 180, 180, 0.75)', // upper-arm reference (grey)
  activeLeft: '#22d3ee',                   // forearm (left arm)
  activeRight: '#f472b6',                  // forearm (right arm)
  text: '#ffffff',
  textBg: 'rgba(0, 0, 0, 0.65)',
};

function mirror(x: number): number {
  return 1 - x;
}

function toCanvas(l: Landmark, w: number, h: number): [number, number] {
  return [mirror(l.x) * w, l.y * h];
}

/** Same gate the tracker uses: present AND visible enough AND in frame. */
function isUsable(lm: Landmark | undefined): boolean {
  if (!lm) return false;
  if ((lm.visibility ?? 0) < VISIBILITY_TRACK_THRESHOLD) return false;
  if (lm.x < 0 || lm.x > 1 || lm.y < 0 || lm.y > 1) return false;
  return true;
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize = 22,
): void {
  const font = `bold ${fontSize}px "Inter", system-ui, sans-serif`;
  ctx.font = font;
  const m = ctx.measureText(text);
  const padX = 10;
  const padY = 5;
  const tw = m.width + padX * 2;
  const th = fontSize + padY * 2;
  ctx.fillStyle = COLORS.textBg;
  ctx.fillRect(x - tw / 2, y - th, tw, th);
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y - padY - 1);
}

export function drawElbowOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  results: HolisticResults,
  elbow: ElbowState,
): void {
  const pose = results.poseLandmarks;
  const w = canvas.width;
  const h = canvas.height;

  // Helper to draw the "not visible" message at a stable position.
  const showNotVisible = () =>
    drawLabel(ctx, 'nije vidljivo', w / 2, h - 24, 18);

  if (!pose || pose.length < 17) {
    showNotVisible();
    return;
  }

  // Sticky active arm comes from the tracker — single source of truth.
  const side = elbow.activeSide;
  const shoulderIdx = side === 'L' ? 11 : side === 'R' ? 12 : null;
  const elbowIdx    = side === 'L' ? 13 : side === 'R' ? 14 : null;
  const wristIdx    = side === 'L' ? 15 : side === 'R' ? 16 : null;
  if (shoulderIdx === null || elbowIdx === null || wristIdx === null) {
    showNotVisible();
    return;
  }

  const shoulder = pose[shoulderIdx];
  const elbowLm  = pose[elbowIdx];
  const wrist    = pose[wristIdx];

  if (!isUsable(shoulder) || !isUsable(elbowLm) || !isUsable(wrist)) {
    showNotVisible();
    return;
  }

  // Reuse existing math: the tracker stores the smoothed angle per side
  // in flexion convention (extended ≈ 0, max-folded ≈ 150). The SPEC
  // convention is interior (extended ≈ 180), so we transform once for
  // display. NO new math here — just a sign flip on the value the
  // tracker already produced from the SAME landmarks we're about to
  // draw.
  const smoothedFlexion =
    side === 'L' ? elbow.leftSmoothed : elbow.rightSmoothed;
  if (smoothedFlexion === null) {
    showNotVisible();
    return;
  }
  const interiorDeg = 180 - smoothedFlexion;

  const [sx, sy] = toCanvas(shoulder, w, h);
  const [ex, ey] = toCanvas(elbowLm, w, h);
  const [wx, wy] = toCanvas(wrist, w, h);

  const activeColor = side === 'L' ? COLORS.activeLeft : COLORS.activeRight;

  ctx.lineCap = 'round';

  // Reference: elbow → shoulder (thin grey, upper arm).
  ctx.strokeStyle = COLORS.reference;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(sx, sy);
  ctx.stroke();

  // Active: elbow → wrist (thicker, side-coloured, forearm).
  ctx.strokeStyle = activeColor;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(wx, wy);
  ctx.stroke();

  // Small dot at the elbow vertex so the user sees where the angle
  // pivot is.
  ctx.fillStyle = activeColor;
  ctx.beginPath();
  ctx.arc(ex, ey, 6, 0, Math.PI * 2);
  ctx.fill();

  // Numeric label near the elbow (above it).
  drawLabel(ctx, `${Math.round(interiorDeg)}°`, ex, ey - 14);
}
