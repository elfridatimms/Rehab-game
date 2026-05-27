import type { HolisticResults, ElbowState, Landmark } from '../../types';
import { VISIBILITY_TRACK_THRESHOLD } from '../../tracking/constants';

// DEBUG overlay for elbow mode. Three layers, bottom-up:
//   1) raw MediaPipe Pose skeleton (semi-transparent grey)
//   2) the existing minimal kut overlay (reference + active line + number)
//   3) joint highlights + coord readouts + dot/cross/kut_raw inspection
//
// The displayed angle (top of debug box) is the tracker's smoothed value
// (= what was on screen before debug). The other values are recomputed
// from the CURRENT FRAME's landmarks so we can see if the smoothed
// value and the live geometry actually agree.
//
// Coordinate readouts show BOTH forms so we can immediately tell whether
// the tracker is using normalised or pixel coordinates internally.

const COLORS = {
  rawSkeleton: 'rgba(180, 180, 180, 0.35)',
  rawDot: 'rgba(180, 180, 180, 0.55)',
  reference: 'rgba(180, 180, 180, 0.85)',
  activeLeft: '#22d3ee',
  activeRight: '#f472b6',
  jointHi: '#fbbf24',
  text: '#ffffff',
  textBg: 'rgba(0, 0, 0, 0.72)',
  warn: '#f87171',
};

// MediaPipe POSE_CONNECTIONS subset for upper body so the raw skeleton
// underlay shows shoulders/elbows/wrists clearly even when the full
// MediaPipe drawing utility isn't ready.
const POSE_EDGES: ReadonlyArray<readonly [number, number]> = [
  [11, 12], // shoulders
  [11, 13], [13, 15], // left arm
  [12, 14], [14, 16], // right arm
  [11, 23], [12, 24], [23, 24], // shoulders → hips (so the user sees
                                 // whether hips are visible at all)
  [15, 17], [15, 19], [15, 21], [17, 19], // left hand wrist+fingers from Pose
  [16, 18], [16, 20], [16, 22], [18, 20], // right hand wrist+fingers from Pose
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

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize = 12,
  align: CanvasTextAlign = 'left',
  color = COLORS.text,
): void {
  const font = `${fontSize}px "Inter", system-ui, sans-serif`;
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const m = ctx.measureText(text);
  const padX = 4;
  const padY = 2;
  const tw = m.width + padX * 2;
  const th = fontSize + padY * 2;
  let bgX = x - padX;
  if (align === 'center') bgX = x - tw / 2;
  if (align === 'right') bgX = x - tw + padX;
  ctx.fillStyle = COLORS.textBg;
  ctx.fillRect(bgX, y - padY, tw, th);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawTextLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  fontSize = 12,
): void {
  for (let i = 0; i < lines.length; i++) {
    drawText(ctx, lines[i], x, y + i * (fontSize + 4), fontSize);
  }
}

function drawRawPoseSkeleton(
  ctx: CanvasRenderingContext2D,
  pose: Landmark[],
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.strokeStyle = COLORS.rawSkeleton;
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
  ctx.fillStyle = COLORS.rawDot;
  for (let i = 0; i < Math.min(pose.length, 33); i++) {
    if (!pose[i]) continue;
    const [px, py] = toCanvas(pose[i], w, h);
    ctx.beginPath();
    ctx.arc(px, py, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Highlight a single joint + put coord readouts next to it. */
function drawJointInspection(
  ctx: CanvasRenderingContext2D,
  lm: Landmark,
  index: number,
  shortLabel: string,
  w: number,
  h: number,
  colorRing: string,
): void {
  const [cx, cy] = toCanvas(lm, w, h);
  // Ring + index label
  ctx.save();
  ctx.strokeStyle = colorRing;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = colorRing;
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const px = Math.round(lm.x * w);
  const py = Math.round(lm.y * h);
  const visStr = lm.visibility != null ? lm.visibility.toFixed(2) : '—';
  // Side of the joint to place the label so it doesn't overlap the arm.
  // Default: to the right of the joint.
  const tx = cx + 12;
  const ty = cy - 14;
  drawTextLines(
    ctx,
    [
      `[${index}] ${shortLabel}  vis=${visStr}`,
      `norm: (${lm.x.toFixed(3)}, ${lm.y.toFixed(3)})`,
      `px:   (${px}, ${py})`,
    ],
    tx,
    ty,
    11,
  );
}

/** Recompute the elbow angle here in the overlay using EXACTLY the
 *  same formula the tracker's elbowFlexionDeg2D uses. Returns BOTH the
 *  "normalised-coords" result (= what the tracker actually computes)
 *  and the "pixel-coords" result (= what SPEC.md actually requires).
 *  If the two disagree, that's the bug. */
function computeElbowDebug(
  shoulder: Landmark,
  elbow: Landmark,
  wrist: Landmark,
  w: number,
  h: number,
): {
  dot_norm: number;
  cross_norm: number;
  interior_norm: number;
  flexion_norm: number;
  dot_px: number;
  cross_px: number;
  interior_px: number;
  flexion_px: number;
  aspect: number;
} {
  // Normalised (what the tracker does today): treats x and y as having
  // the same unit even though normalised x is "image-widths" and
  // normalised y is "image-heights".
  const an = { x: shoulder.x - elbow.x, y: shoulder.y - elbow.y };
  const bn = { x: wrist.x - elbow.x, y: wrist.y - elbow.y };
  const dot_norm = an.x * bn.x + an.y * bn.y;
  const cross_norm = an.x * bn.y - an.y * bn.x;
  const magAn = Math.hypot(an.x, an.y);
  const magBn = Math.hypot(bn.x, bn.y);
  const cos_norm = magAn && magBn
    ? Math.max(-1, Math.min(1, dot_norm / (magAn * magBn)))
    : 1;
  const interior_norm = (Math.acos(cos_norm) * 180) / Math.PI;
  const flexion_norm = 180 - interior_norm;

  // Pixel-scaled (what SPEC.md requires): each component scaled by the
  // matching canvas dimension so x and y are in the same real unit.
  const ap = { x: an.x * w, y: an.y * h };
  const bp = { x: bn.x * w, y: bn.y * h };
  const dot_px = ap.x * bp.x + ap.y * bp.y;
  const cross_px = ap.x * bp.y - ap.y * bp.x;
  const magAp = Math.hypot(ap.x, ap.y);
  const magBp = Math.hypot(bp.x, bp.y);
  const cos_px = magAp && magBp
    ? Math.max(-1, Math.min(1, dot_px / (magAp * magBp)))
    : 1;
  const interior_px = (Math.acos(cos_px) * 180) / Math.PI;
  const flexion_px = 180 - interior_px;

  return {
    dot_norm, cross_norm, interior_norm, flexion_norm,
    dot_px, cross_px, interior_px, flexion_px,
    aspect: w / h,
  };
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
  if (!pose || pose.length < 17) {
    drawText(ctx, 'POSE: nije vidljiv', w / 2, h - 30, 14, 'center', COLORS.warn);
    return;
  }

  // ── 1) Raw MediaPipe skeleton underlay
  drawRawPoseSkeleton(ctx, pose, w, h);

  // ── 2) Per-side inspection: highlight 11/13/15 and 12/14/16
  const sides = [
    { label: 'L', s: 11, e: 13, wr: 15, color: COLORS.activeLeft },
    { label: 'R', s: 12, e: 14, wr: 16, color: COLORS.activeRight },
  ];

  for (const side of sides) {
    const shoulder = pose[side.s];
    const elbowLm  = pose[side.e];
    const wristLm  = pose[side.wr];
    if (!shoulder || !elbowLm || !wristLm) continue;

    drawJointInspection(ctx, shoulder, side.s, `${side.label} shoulder`, w, h, COLORS.jointHi);
    drawJointInspection(ctx, elbowLm,  side.e, `${side.label} elbow`,    w, h, COLORS.jointHi);
    drawJointInspection(ctx, wristLm,  side.wr, `${side.label} wrist`,    w, h, COLORS.jointHi);

    // Existing minimal angle overlay for this side (reference + active line).
    const [sx, sy] = toCanvas(shoulder, w, h);
    const [ex, ey] = toCanvas(elbowLm,  w, h);
    const [wx, wy] = toCanvas(wristLm,  w, h);

    // Reference: elbow → shoulder (thin grey)
    ctx.save();
    ctx.strokeStyle = COLORS.reference;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    // Active: elbow → wrist (thicker, side colour)
    ctx.strokeStyle = side.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(wx, wy);
    ctx.stroke();
    ctx.fillStyle = side.color;
    ctx.beginPath();
    ctx.arc(ex, ey, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── 3) Debug callout near the elbow: dot/cross/kut_raw + displayed.
    const dbg = computeElbowDebug(shoulder, elbowLm, wristLm, w, h);
    const isActive = elbow.activeSide === (side.label as 'L' | 'R');
    const displayedFlexion = isActive
      ? (side.label === 'L' ? elbow.leftSmoothed : elbow.rightSmoothed)
      : null;
    const displayedInterior =
      displayedFlexion != null ? 180 - displayedFlexion : null;
    const usable =
      isUsable(shoulder) && isUsable(elbowLm) && isUsable(wristLm);

    const lines: string[] = [
      `── ${side.label} elbow calc ──`,
      `dot_norm  = ${dbg.dot_norm.toFixed(4)}`,
      `cross_norm= ${dbg.cross_norm.toFixed(4)}`,
      `kut_raw(norm) interior=${dbg.interior_norm.toFixed(1)}°  flex=${dbg.flexion_norm.toFixed(1)}°`,
      `kut_raw(px)   interior=${dbg.interior_px.toFixed(1)}°  flex=${dbg.flexion_px.toFixed(1)}°`,
      `aspect w/h    = ${dbg.aspect.toFixed(3)}`,
      `displayed     interior=${displayedInterior != null ? displayedInterior.toFixed(1) + '°' : '—'}  flex=${displayedFlexion != null ? displayedFlexion.toFixed(1) + '°' : '—'}`,
      `active side   = ${elbow.activeSide ?? '—'}   trackable=${usable ? 'yes' : 'NO (vis < ' + VISIBILITY_TRACK_THRESHOLD + ' or out of frame)'}`,
    ];

    // Place the callout box near the elbow but offset so the joint
    // labels don't collide with it.
    const calloutX = ex + 30;
    const calloutY = ey + 16;
    drawTextLines(ctx, lines, calloutX, calloutY, 11);
  }
}
