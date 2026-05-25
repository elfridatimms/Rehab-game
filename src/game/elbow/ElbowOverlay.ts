import type { HolisticResults, ElbowState, Landmark } from '../../types';

// ─── Elbow overlay — angle arc anchored at the elbow joint ───
// The goniometer rotates WITH the arm. Two lines emanate from each
// elbow vertex (along the upper arm and along the forearm), and a
// coloured arc fills the angle between them. The arc grows as the
// user flexes the elbow and shrinks as they extend.
//
// Clinical convention:
//   0°   = arm fully extended (interior angle 180° between vectors)
//   ~150° = full anatomical flexion (interior angle ~30°)
// The arc visualises the FLEXION angle (180° − interior).

function mirror(x: number): number {
  return 1 - x;
}

function toCanvas(l: Landmark, w: number, h: number): [number, number] {
  return [mirror(l.x) * w, l.y * h];
}

function mirrorLandmarks(landmarks: Landmark[]): Landmark[] {
  const out: Landmark[] = new Array(landmarks.length);
  for (let i = 0; i < landmarks.length; i++) {
    const l = landmarks[i];
    out[i] = { x: 1 - l.x, y: l.y, z: l.z, visibility: l.visibility };
  }
  return out;
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font = 'bold 16px "Inter", system-ui, sans-serif',
  fg = '#ffffff',
  bg = 'rgba(0, 0, 0, 0.65)',
) {
  ctx.font = font;
  const m = ctx.measureText(text);
  const padX = 5;
  const padY = 3;
  const tw = m.width + padX * 2;
  const th = parseInt(font, 10) + padY * 2;
  ctx.fillStyle = bg;
  ctx.fillRect(x - tw / 2, y - th, tw, th);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y - padY - 1);
}

/** Draw the angle arc at one elbow.
 *
 *  Reference axis (0° flexion) = the direction the forearm would point
 *  if the arm were fully extended = OPPOSITE of the upper-arm direction.
 *  The arc sweeps from this reference to where the forearm actually is.
 *  The sweep size IS the flexion angle. */
function drawElbowArc(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number,    // shoulder
  ex: number, ey: number,    // elbow (vertex)
  wx: number, wy: number,    // wrist
  flexionDeg: number,
  color: string,
  sideLabel: 'L' | 'R',
) {
  // Upper arm direction (from elbow toward shoulder), in canvas radians.
  const upperArmAngle = Math.atan2(sy - ey, sx - ex);
  // Reference axis (extended forearm direction) = opposite.
  const refAngle = upperArmAngle + Math.PI;
  // Actual forearm direction (from elbow toward wrist).
  const foreAngle = Math.atan2(wy - ey, wx - ex);

  // Signed angular delta from reference to forearm, in [-π, π].
  let delta = foreAngle - refAngle;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  // |delta| in degrees equals the flexion value when the math is right.
  const isCCW = delta < 0;
  const absDelta = Math.abs(delta);

  // Arc radius scales with the shorter of the two limb lengths.
  const arcR =
    Math.min(
      Math.hypot(sx - ex, sy - ey),
      Math.hypot(wx - ex, wy - ey),
    ) * 0.4;

  // ── Dashed reference axis ("extended forearm" position).
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex + Math.cos(refAngle) * arcR * 1.25, ey + Math.sin(refAngle) * arcR * 1.25);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // ── Filled wedge from reference to current forearm direction.
  if (absDelta > 0.01) {
    ctx.save();
    ctx.fillStyle = `${color}33`;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.arc(ex, ey, arcR, refAngle, refAngle + delta, isCCW);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ex, ey, arcR, refAngle, refAngle + delta, isCCW);
    ctx.stroke();
    ctx.restore();
  }

  // ── Numeric label at the midpoint of the arc.
  const midA = refAngle + delta / 2;
  const labelR = arcR + 18;
  const lx = ex + Math.cos(midA) * labelR;
  const ly = ey + Math.sin(midA) * labelR;
  drawLabel(ctx, `${sideLabel} ${Math.round(flexionDeg)}°`, lx, ly);
}

export function drawElbowOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  results: HolisticResults,
  elbow: ElbowState,
) {
  const pose = results.poseLandmarks;
  if (!pose) return;
  const w = canvas.width;
  const h = canvas.height;
  const drawConnectors = window.drawConnectors;
  const drawLandmarks = window.drawLandmarks;
  const POSE_CONNECTIONS = window.POSE_CONNECTIONS;

  // Skeleton in MediaPipe-demo colours.
  if (drawConnectors && drawLandmarks && POSE_CONNECTIONS) {
    const mirrored = mirrorLandmarks(pose);
    drawConnectors(ctx, mirrored, POSE_CONNECTIONS, {
      color: '#00FF00',
      lineWidth: 3,
    });
    drawLandmarks(ctx, mirrored, {
      color: '#FF0000',
      lineWidth: 1,
      radius: 3,
    });
  }

  // Arc at each elbow that has a measurement.
  const drawArm = (
    shoulderIdx: number, elbowIdx: number, wristIdx: number,
    smoothed: number | null,
    color: string, sideLabel: 'L' | 'R',
  ) => {
    if (smoothed == null) return;
    const sLm = pose[shoulderIdx];
    const eLm = pose[elbowIdx];
    const wLm = pose[wristIdx];
    if (!sLm || !eLm || !wLm) return;
    const [sx, sy] = toCanvas(sLm, w, h);
    const [ex, ey] = toCanvas(eLm, w, h);
    const [wx, wy] = toCanvas(wLm, w, h);
    drawElbowArc(ctx, sx, sy, ex, ey, wx, wy, smoothed, color, sideLabel);
  };

  drawArm(11, 13, 15, elbow.leftSmoothed, '#22d3ee', 'L');
  drawArm(12, 14, 16, elbow.rightSmoothed, '#f472b6', 'R');

  // Forearm-roll label near the wrist (pronation/supination proxy).
  const annotateRoll = (wristIdx: number, roll: number | null, side: 'L' | 'R') => {
    if (roll == null) return;
    const lm = pose[wristIdx];
    if (!lm) return;
    const [x, y] = toCanvas(lm, w, h);
    const sign = roll >= 0 ? '+' : '−';
    drawLabel(
      ctx,
      `${side} roll ${sign}${Math.abs(Math.round(roll))}°`,
      x,
      y + 26,
      'bold 12px "Inter", system-ui, sans-serif',
      '#34d399',
    );
  };
  annotateRoll(15, elbow.leftForearmRotSmoothed, 'L');
  annotateRoll(16, elbow.rightForearmRotSmoothed, 'R');
}
