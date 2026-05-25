import type { HolisticResults, TrackingState, Landmark } from '../../types';

// ─── Fingers overlay — exact restore of deployed `Oy` function ──
// (deploy 6a11b4504e219cdcb50d1107, bundle index-vpkjw17t.js)
//
// Draws: grey hand skeleton, golden palm-length reference (wrist → MCP),
// one line per fingertip to wrist with the per-tip ratio label
// ("I 2.34"), and the overall openness % at the palm centre.

const COLORS = {
  skeleton: 'rgba(180, 180, 180, 0.45)',
  palmRef: '#fbbf24',
  axisLeft: '#22d3ee',
  axisRight: '#f472b6',
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

const FINGERTIPS = [4, 8, 12, 16, 20];
const FINGERTIP_LABELS: Record<number, string> = {
  4: 'T', 8: 'I', 12: 'M', 16: 'R', 20: 'P',
};

function mirror(x: number): number {
  return 1 - x;
}

function toCanvas(l: Landmark, w: number, h: number): [number, number] {
  return [mirror(l.x) * w, l.y * h];
}

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font = 'bold 14px "Inter", system-ui, sans-serif',
): void {
  ctx.font = font;
  const m = ctx.measureText(text);
  const padX = 5;
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

export function drawFingersOverlay(
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
    if (!hand.landmarks || hand.landmarks.length < 21) continue;

    // Grey skeleton underlay.
    ctx.strokeStyle = COLORS.skeleton;
    ctx.fillStyle = COLORS.skeleton;
    ctx.lineWidth = 1.5;
    drawHandSkeleton(ctx, hand.landmarks, w, h);

    const wrist = hand.landmarks[0];
    const mcp = hand.landmarks[9];
    const palmLength = dist(wrist, mcp);
    if (palmLength < 0.001) continue;

    const [wx, wy] = toCanvas(wrist, w, h);
    const [mx, my] = toCanvas(mcp, w, h);

    // Golden palm-length reference (wrist → middle MCP) with end dots.
    ctx.strokeStyle = COLORS.palmRef;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(mx, my);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.palmRef;
    ctx.beginPath();
    ctx.arc(wx, wy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx, my, 4, 0, Math.PI * 2);
    ctx.fill();

    // One line per fingertip with ratio label.
    ctx.lineWidth = 2;
    for (const tip of FINGERTIPS) {
      const tipLm = hand.landmarks[tip];
      if (!tipLm) continue;
      const ratio = dist(wrist, tipLm) / palmLength;
      const [tx, ty] = toCanvas(tipLm, w, h);
      ctx.strokeStyle = hand.axisColor;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.fillStyle = hand.axisColor;
      ctx.beginPath();
      ctx.arc(tx, ty, 4, 0, Math.PI * 2);
      ctx.fill();
      drawLabel(
        ctx,
        `${FINGERTIP_LABELS[tip]} ${ratio.toFixed(2)}`,
        tx,
        ty - 4,
        '11px "Inter", system-ui, sans-serif',
      );
    }

    // Openness % at the palm centre.
    const score = hand.handState.smoothedOpenHandScore;
    const [cx, cy] = toCanvas(
      { x: (wrist.x + mcp.x) / 2, y: (wrist.y + mcp.y) / 2, z: 0 },
      w, h,
    );
    if (score != null) {
      drawLabel(ctx, `${Math.round(score)}%`, cx, cy);
    }

    // Hand label "L"/"R" near MCP.
    drawLabel(
      ctx,
      hand.label,
      mx + 10,
      my - 4,
      'bold 12px "Inter", system-ui, sans-serif',
    );
  }
}
