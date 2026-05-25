import type { HolisticResults, TrackingState, Landmark } from '../../types';

// ─── Wrist overlay — exact restore of deployed `My` function ──
// (deploy 6a11b4504e219cdcb50d1107, bundle index-vpkjw17t.js)
//
// One arc per hand, drawn from a horizontal reference axis through the
// wrist to the actual hand direction (wrist → middle MCP). Label is
// "+X°" for extension and "−X°" for flexion. Signed range −90…+90 from
// updateWristExtension. No tick marks, no fancy goniometer.

const COLORS = {
  skeleton: 'rgba(180, 180, 180, 0.55)',
  axisLeft: '#22d3ee',
  axisRight: '#f472b6',
  reference: 'rgba(255, 255, 255, 0.5)',
  arc: '#fbbf24',
  text: '#ffffff',
  textBg: 'rgba(0, 0, 0, 0.55)',
};

const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

function mirror(x: number): number {
  return 1 - x;
}

function toCanvas(l: Landmark, w: number, h: number): [number, number] {
  return [mirror(l.x) * w, l.y * h];
}

function drawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  w: number,
  h: number,
): void {
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    if (!landmarks[a] || !landmarks[b]) continue;
    const [ax, ay] = toCanvas(landmarks[a], w, h);
    const [bx, by] = toCanvas(landmarks[b], w, h);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();
  for (let i = 0; i < Math.min(landmarks.length, 21); i++) {
    if (!landmarks[i]) continue;
    const [x, y] = toCanvas(landmarks[i], w, h);
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font = 'bold 16px "Inter", system-ui, sans-serif',
): void {
  ctx.font = font;
  const m = ctx.measureText(text);
  const padX = 6;
  const padY = 3;
  const tw = m.width + padX * 2;
  const th = parseInt(font, 10) + padY * 2;
  ctx.fillStyle = COLORS.textBg;
  ctx.fillRect(x - tw / 2, y - th, tw, th);
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y - padY - 1);
}

export function drawWristOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  results: HolisticResults,
  state: TrackingState,
): void {
  const w = canvas.width;
  const h = canvas.height;

  const hands = [
    {
      landmarks: results.leftHandLandmarks,
      handState: state.leftHand,
      label: 'L' as const,
      axisColor: COLORS.axisLeft,
    },
    {
      landmarks: results.rightHandLandmarks,
      handState: state.rightHand,
      label: 'R' as const,
      axisColor: COLORS.axisRight,
    },
  ];

  ctx.lineCap = 'round';

  for (const hand of hands) {
    if (!hand.landmarks || hand.landmarks.length < 10) continue;

    // Grey hand skeleton.
    ctx.strokeStyle = COLORS.skeleton;
    ctx.fillStyle = COLORS.skeleton;
    ctx.lineWidth = 1.5;
    drawHandSkeleton(ctx, hand.landmarks, w, h);

    const wrist = hand.landmarks[0];
    const mcp = hand.landmarks[9];
    const [wx, wy] = toCanvas(wrist, w, h);
    const [mx, my] = toCanvas(mcp, w, h);

    // Wrist→MCP axis line in side colour with end dots.
    ctx.strokeStyle = hand.axisColor;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(mx, my);
    ctx.stroke();
    ctx.fillStyle = hand.axisColor;
    ctx.beginPath();
    ctx.arc(wx, wy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx, my, 4, 0, Math.PI * 2);
    ctx.fill();

    // Horizontal reference line (dashed white) on the side the hand
    // points to, length = hand length.
    const dirX = mx >= wx ? 1 : -1;
    const handLen = Math.hypot(mx - wx, my - wy);
    ctx.strokeStyle = COLORS.reference;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(wx + dirX * handLen, wy);
    ctx.stroke();
    ctx.setLineDash([]);

    const D = hand.handState.smoothedWristExtensionDeg;
    if (D == null) continue;

    // Arc from horizontal reference to actual hand direction.
    const handAngleCanvas = Math.atan2(my - wy, mx - wx);
    const refAngle = dirX > 0 ? 0 : Math.PI;
    const arcR = Math.max(20, handLen * 0.45);

    ctx.strokeStyle = COLORS.arc;
    ctx.lineWidth = 3;
    ctx.beginPath();
    let p = refAngle;
    let delta = handAngleCanvas - p;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    ctx.arc(wx, wy, arcR, p, p + delta, delta < 0);
    ctx.stroke();

    // "+45°" / "−45°" label at midpoint of arc, pushed outward.
    const midA = p + delta / 2;
    const labelR = arcR + 24;
    const lx = wx + Math.cos(midA) * labelR;
    const ly = wy + Math.sin(midA) * labelR;
    const sign = D >= 0 ? '+' : '−';
    drawLabel(ctx, `${sign}${Math.abs(Math.round(D))}°`, lx, ly);

    // Hand label "L" / "R" near the MCP.
    drawLabel(
      ctx,
      hand.label,
      mx,
      my - 6,
      'bold 12px "Inter", system-ui, sans-serif',
    );
  }
}
