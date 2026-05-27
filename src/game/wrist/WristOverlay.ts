import type { HolisticResults, TrackingState, Landmark } from '../../types';

// DEBUG overlay for wrist mode. Three layers, bottom-up:
//   1) raw MediaPipe Hands skeleton (semi-transparent grey)
//   2) horizontal reference (= 0°) + hand vector wrist → MCP + angle
//   3) lm0 / lm9 highlights + coord readouts + dx/dy/kut_raw inspection
//
// "kut_raw" recomputes the formula on the CURRENT FRAME landmarks so
// the displayed number (smoothed) and the live geometry are visible
// side-by-side. Coords are shown in both norm and px so we can tell
// which the tracker is using.

const COLORS = {
  rawSkeleton: 'rgba(180, 180, 180, 0.35)',
  rawDot: 'rgba(180, 180, 180, 0.6)',
  reference: 'rgba(180, 180, 180, 0.85)',
  activeLeft: '#22d3ee',
  activeRight: '#f472b6',
  jointHi: '#fbbf24',
  text: '#ffffff',
  textBg: 'rgba(0, 0, 0, 0.72)',
};

const HAND_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],         // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],         // index
  [0, 9], [9, 10], [10, 11], [11, 12],    // middle
  [0, 13], [13, 14], [14, 15], [15, 16],  // ring
  [0, 17], [17, 18], [18, 19], [19, 20],  // pinky
  [5, 9], [9, 13], [13, 17],              // palm crossbars
];

function mirror(x: number): number {
  return 1 - x;
}

function toCanvas(l: Landmark, w: number, h: number): [number, number] {
  return [mirror(l.x) * w, l.y * h];
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

function drawRawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  hand: Landmark[],
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.strokeStyle = COLORS.rawSkeleton;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [a, b] of HAND_EDGES) {
    if (!hand[a] || !hand[b]) continue;
    const [ax, ay] = toCanvas(hand[a], w, h);
    const [bx, by] = toCanvas(hand[b], w, h);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();
  ctx.fillStyle = COLORS.rawDot;
  for (let i = 0; i < Math.min(hand.length, 21); i++) {
    if (!hand[i]) continue;
    const [px, py] = toCanvas(hand[i], w, h);
    ctx.beginPath();
    ctx.arc(px, py, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

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
  const tx = cx + 12;
  const ty = cy - 14;
  drawTextLines(
    ctx,
    [
      `[${index}] ${shortLabel}`,
      `norm: (${lm.x.toFixed(3)}, ${lm.y.toFixed(3)})`,
      `px:   (${px}, ${py})`,
    ],
    tx,
    ty,
    11,
  );
}

/** Recompute the wrist formula on the current frame so we can see what
 *  the tracker SHOULD be reading right now (vs the smoothed displayed
 *  value). Same convention as the tracker: atan2(i, |n|) where
 *  n = mcp.x − wrist.x, i = wrist.y − mcp.y (screen-y inverted). */
function computeWristDebug(
  wrist: Landmark,
  mcp: Landmark,
  w: number,
  h: number,
): {
  n_norm: number;
  i_norm: number;
  kut_norm: number;
  n_px: number;
  i_px: number;
  kut_px: number;
  hand_dx_px: number;
  hand_dy_px: number;
} {
  const n_norm = mcp.x - wrist.x;
  const i_norm = wrist.y - mcp.y;
  const kut_norm = (Math.atan2(i_norm, Math.abs(n_norm)) * 180) / Math.PI;

  const n_px = n_norm * w;
  const i_px = i_norm * h;
  const kut_px = (Math.atan2(i_px, Math.abs(n_px)) * 180) / Math.PI;

  return {
    n_norm,
    i_norm,
    kut_norm,
    n_px,
    i_px,
    kut_px,
    hand_dx_px: (mcp.x - wrist.x) * w,
    hand_dy_px: (mcp.y - wrist.y) * h,
  };
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
      label: 'L' as const,
      landmarks: results.leftHandLandmarks,
      handState: state.leftHand,
      activeColor: COLORS.activeLeft,
    },
    {
      label: 'R' as const,
      landmarks: results.rightHandLandmarks,
      handState: state.rightHand,
      activeColor: COLORS.activeRight,
    },
  ];

  ctx.lineCap = 'round';

  for (const hand of hands) {
    if (!hand.landmarks || hand.landmarks.length < 10) continue;

    // ── 1) Raw hand skeleton (all 21 landmarks + edges, semi-transparent)
    drawRawHandSkeleton(ctx, hand.landmarks, w, h);

    const wrist = hand.landmarks[0];
    const mcp = hand.landmarks[9];
    if (!wrist || !mcp) continue;

    const [wx, wy] = toCanvas(wrist, w, h);
    const [mx, my] = toCanvas(mcp, w, h);
    const handLen = Math.hypot(mx - wx, my - wy);
    const refHalf = Math.max(40, handLen);

    // ── 2) Reference (horizontal grey through wrist) + active line wrist→MCP
    ctx.strokeStyle = COLORS.reference;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wx - refHalf, wy);
    ctx.lineTo(wx + refHalf, wy);
    ctx.stroke();

    ctx.strokeStyle = hand.activeColor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(mx, my);
    ctx.stroke();
    ctx.fillStyle = hand.activeColor;
    ctx.beginPath();
    ctx.arc(wx, wy, 6, 0, Math.PI * 2);
    ctx.fill();

    // ── 3) Joint highlights on lm0 and lm9 + coord readouts
    drawJointInspection(ctx, wrist, 0, `${hand.label} wrist`, w, h, COLORS.jointHi);
    drawJointInspection(ctx, mcp, 9, `${hand.label} mcp9`, w, h, COLORS.jointHi);

    // Debug callout near the wrist with the live calc
    const dbg = computeWristDebug(wrist, mcp, w, h);
    const displayed = hand.handState.smoothedWristExtensionDeg;
    const lines = [
      `── ${hand.label} wrist calc ──`,
      `n_norm  = ${dbg.n_norm.toFixed(4)}   i_norm = ${dbg.i_norm.toFixed(4)}`,
      `n_px    = ${dbg.n_px.toFixed(1)}    i_px   = ${dbg.i_px.toFixed(1)}`,
      `hand vec (px) dx=${dbg.hand_dx_px.toFixed(1)} dy=${dbg.hand_dy_px.toFixed(1)}`,
      `kut_raw(norm) = ${dbg.kut_norm.toFixed(1)}°`,
      `kut_raw(px)   = ${dbg.kut_px.toFixed(1)}°`,
      `displayed     = ${displayed != null ? displayed.toFixed(1) + '°' : '—'}`,
    ];
    drawTextLines(ctx, lines, wx + 16, wy + 12, 11);
  }
}
