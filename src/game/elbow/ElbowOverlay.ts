import type { HolisticResults, ElbowState, Landmark } from '../../types';
import { VISIBILITY_TRACK_THRESHOLD } from '../../tracking/constants';

// Minimal elbow overlay — just the angle, see docs/SPEC.md.
//
// Reference line elbow → shoulder (grey) + active line elbow → wrist
// (side-coloured) + numeric angle in degrees near the elbow.
// Lines and number come from the SAME Pose landmark indices the
// tracker reads, so they can't disagree.

const COLORS = {
  reference: 'rgba(180, 180, 180, 0.75)',
  activeLeft: '#22d3ee',
  activeRight: '#f472b6',
  text: '#ffffff',
  textBg: 'rgba(0, 0, 0, 0.65)',
};

function mirror(x: number): number {
  return 1 - x;
}

function toCanvas(l: Landmark, w: number, h: number): [number, number] {
  return [mirror(l.x) * w, l.y * h];
}

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
  fontSize = 28,
): void {
  const font = `bold ${fontSize}px "Inter", system-ui, sans-serif`;
  ctx.font = font;
  const m = ctx.measureText(text);
  const padX = 12;
  const padY = 6;
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
  const w = canvas.width;
  const h = canvas.height;
  const pose = results.poseLandmarks;

  const showNotVisible = () =>
    drawLabel(ctx, 'nije vidljivo', w / 2, h - 30, 20);

  if (!pose || pose.length < 17) {
    showNotVisible();
    return;
  }

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
  const wristLm  = pose[wristIdx];

  if (!isUsable(shoulder) || !isUsable(elbowLm) || !isUsable(wristLm)) {
    showNotVisible();
    return;
  }

  // SPEC convention is interior (extended ≈ 180); tracker stores flexion
  // (extended ≈ 0). Convert once for display.
  const smoothedFlexion =
    side === 'L' ? elbow.leftSmoothed : elbow.rightSmoothed;
  if (smoothedFlexion === null) {
    showNotVisible();
    return;
  }
  const interiorDeg = 180 - smoothedFlexion;

  const [sx, sy] = toCanvas(shoulder, w, h);
  const [ex, ey] = toCanvas(elbowLm, w, h);
  const [wx, wy] = toCanvas(wristLm, w, h);

  const activeColor = side === 'L' ? COLORS.activeLeft : COLORS.activeRight;

  ctx.lineCap = 'round';

  // Reference: elbow → shoulder (thin grey).
  ctx.strokeStyle = COLORS.reference;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(sx, sy);
  ctx.stroke();

  // Active: elbow → wrist (thicker, side-coloured).
  ctx.strokeStyle = activeColor;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(wx, wy);
  ctx.stroke();

  ctx.fillStyle = activeColor;
  ctx.beginPath();
  ctx.arc(ex, ey, 6, 0, Math.PI * 2);
  ctx.fill();

  // Big numeric label above the elbow.
  drawLabel(ctx, `${Math.round(interiorDeg)}°`, ex, ey - 18);
}
