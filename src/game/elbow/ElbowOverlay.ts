import type { HolisticResults, ElbowState, Landmark } from '../../types';
import { VISIBILITY_TRACK_THRESHOLD } from '../../tracking/constants';

// Elbow overlay — raw MediaPipe Pose skeleton as a grey underlay, the
// angle reference + active line + numeric label drawn on top for the
// active arm. No fallback message: if the angle can't be computed we
// just leave the skeleton visible and skip the angle layer.

const COLORS = {
  skeleton: 'rgba(180, 180, 180, 0.45)',
  reference: 'rgba(180, 180, 180, 0.85)',
  activeLeft: '#22d3ee',
  activeRight: '#f472b6',
  text: '#ffffff',
  textBg: 'rgba(0, 0, 0, 0.65)',
};

// MediaPipe POSE_CONNECTIONS upper-body subset — enough to show
// shoulders / arms / torso without lighting up every leg landmark.
const POSE_EDGES: ReadonlyArray<readonly [number, number]> = [
  [11, 12],                         // shoulders
  [11, 13], [13, 15],               // left arm
  [12, 14], [14, 16],               // right arm
  [11, 23], [12, 24], [23, 24],     // shoulders → hips → hips
  [15, 17], [15, 19], [15, 21],     // left hand stubs from Pose
  [16, 18], [16, 20], [16, 22],     // right hand stubs from Pose
];

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

function drawRawPoseSkeleton(
  ctx: CanvasRenderingContext2D,
  pose: Landmark[],
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.strokeStyle = COLORS.skeleton;
  ctx.fillStyle = COLORS.skeleton;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [a, b] of POSE_EDGES) {
    if (!pose[a] || !pose[b]) continue;
    const [ax, ay] = toCanvas(pose[a], w, h);
    const [bx, by] = toCanvas(pose[b], w, h);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();
  for (let i = 0; i < Math.min(pose.length, 33); i++) {
    if (!pose[i]) continue;
    const [x, y] = toCanvas(pose[i], w, h);
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
  if (!pose || pose.length < 17) return;

  // Always draw the raw Pose skeleton underlay.
  drawRawPoseSkeleton(ctx, pose, w, h);

  ctx.lineCap = 'round';

  // Draw the angle layer for BOTH arms independently — whichever side
  // passes the visibility / in-frame gate gets its own ref line,
  // active line and degree label. The tracker already smooths and
  // stores them separately (leftSmoothed / rightSmoothed); the
  // `activeSide` field is only used to pick a "primary" reading for
  // the CSV `active_side` column.
  const sides: Array<{
    label: 'L' | 'R';
    shoulderIdx: number;
    elbowIdx: number;
    wristIdx: number;
    smoothed: number | null;
    color: string;
  }> = [
    {
      label: 'L',
      shoulderIdx: 11, elbowIdx: 13, wristIdx: 15,
      smoothed: elbow.leftSmoothed,
      color: COLORS.activeLeft,
    },
    {
      label: 'R',
      shoulderIdx: 12, elbowIdx: 14, wristIdx: 16,
      smoothed: elbow.rightSmoothed,
      color: COLORS.activeRight,
    },
  ];

  for (const side of sides) {
    const shoulder = pose[side.shoulderIdx];
    const elbowLm  = pose[side.elbowIdx];
    const wristLm  = pose[side.wristIdx];
    if (!isUsable(shoulder) || !isUsable(elbowLm) || !isUsable(wristLm)) continue;
    if (side.smoothed === null) continue;

    const interiorDeg = 180 - side.smoothed;

    const [sx, sy] = toCanvas(shoulder, w, h);
    const [ex, ey] = toCanvas(elbowLm, w, h);
    const [wx, wy] = toCanvas(wristLm, w, h);

    // Reference: elbow → shoulder (slightly brighter grey than skeleton).
    ctx.strokeStyle = COLORS.reference;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(sx, sy);
    ctx.stroke();

    // Active: elbow → wrist (thicker, side colour).
    ctx.strokeStyle = side.color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(wx, wy);
    ctx.stroke();

    ctx.fillStyle = side.color;
    ctx.beginPath();
    ctx.arc(ex, ey, 6, 0, Math.PI * 2);
    ctx.fill();

    drawLabel(ctx, `${Math.round(interiorDeg)}°`, ex, ey - 18);
  }
}
