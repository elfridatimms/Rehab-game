import type { HolisticResults, TrackingState, Landmark } from '../../types';

// Fingers overlay — raw MediaPipe Hands skeleton as a grey underlay,
// plus a prominent openness % at the palm centre per hand. If no
// score is available we just leave the skeleton showing.

const COLORS = {
  skeleton: 'rgba(180, 180, 180, 0.45)',
  palmRef: 'rgba(180, 180, 180, 0.85)',
  activeLeft: '#22d3ee',
  activeRight: '#f472b6',
  text: '#ffffff',
  textBg: 'rgba(0, 0, 0, 0.65)',
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

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize = 24,
): void {
  const font = `bold ${fontSize}px "Inter", system-ui, sans-serif`;
  ctx.font = font;
  const m = ctx.measureText(text);
  const padX = 10;
  const padY = 5;
  const tw = m.width + padX * 2;
  const th = fontSize + padY * 2;
  ctx.fillStyle = COLORS.textBg;
  ctx.fillRect(x - tw / 2, y - th / 2, tw, th);
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/** Small caption line under the main % label (state / functional ROM). */
function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
): void {
  ctx.font = `600 14px "Inter", system-ui, sans-serif`;
  const m = ctx.measureText(text);
  const padX = 8;
  const padY = 3;
  const tw = m.width + padX * 2;
  const th = 14 + padY * 2;
  ctx.fillStyle = COLORS.textBg;
  ctx.fillRect(x - tw / 2, y - th / 2, tw, th);
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

// Palm center = average of the four finger MCP joints (5,9,13,17); the
// openness lines run from there to the four (non-thumb) fingertips.
const PALM_MCPS = [5, 9, 13, 17];
const OPENNESS_TIPS = [8, 12, 16, 20];

function drawRawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  hand: Landmark[],
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.strokeStyle = COLORS.skeleton;
  ctx.fillStyle = COLORS.skeleton;
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
  for (let i = 0; i < Math.min(hand.length, 21); i++) {
    if (!hand[i]) continue;
    const [x, y] = toCanvas(hand[i], w, h);
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Which functional finger metric to visualise. */
export type FingersMetric = 'openness' | 'spread';

// Fingertip fan for the spread overlay: thumb → index → … → pinky.
const SPREAD_TIP_CHAIN = [4, 8, 12, 16, 20];

/** OPENNESS overlay (fist making): palm-center dot + lines to the four
 *  fingertips + big openness % and state/ROM caption. */
function drawOpennessHand(
  ctx: CanvasRenderingContext2D,
  hand: Landmark[],
  hs: TrackingState['leftHand'],
  color: string,
  w: number,
  h: number,
): void {
  let cx = 0;
  let cy = 0;
  for (const idx of PALM_MCPS) {
    const [px, py] = toCanvas(hand[idx], w, h);
    cx += px;
    cy += py;
  }
  cx /= PALM_MCPS.length;
  cy /= PALM_MCPS.length;

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  for (const tip of OPENNESS_TIPS) {
    if (!hand[tip]) continue;
    const [tx, ty] = toCanvas(hand[tip], w, h);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fill();

  const pct = hs.handOpennessPercent;
  drawLabel(ctx, pct != null ? `${Math.round(pct)}%` : '—', cx, cy - 26);

  const fnRom =
    hs.handOpennessMax != null && hs.handOpennessMin != null
      ? hs.handOpennessMax - hs.handOpennessMin
      : null;
  const parts: string[] = [];
  if (hs.handState) parts.push(hs.handState);
  if (fnRom != null) parts.push(`ROM ${fnRom.toFixed(2)}`);
  if (parts.length > 0) drawCaption(ctx, parts.join(' · '), cx, cy + 16);
}

/** SPREAD overlay (finger extension): a fan connecting the fingertips
 *  (the gaps that feed the spread metric) + big spread % + ROM caption. */
function drawSpreadHand(
  ctx: CanvasRenderingContext2D,
  hand: Landmark[],
  hs: TrackingState['leftHand'],
  color: string,
  w: number,
  h: number,
): void {
  // Connect adjacent fingertips — the visible "separation" between them.
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  let started = false;
  for (const tip of SPREAD_TIP_CHAIN) {
    if (!hand[tip]) { started = false; continue; }
    const [tx, ty] = toCanvas(hand[tip], w, h);
    if (!started) { ctx.moveTo(tx, ty); started = true; }
    else ctx.lineTo(tx, ty);
  }
  ctx.stroke();

  // Tip dots + centroid for label placement (over the four fingers).
  let cx = 0;
  let cy = 0;
  let n = 0;
  ctx.fillStyle = color;
  for (const tip of OPENNESS_TIPS) {
    if (!hand[tip]) continue;
    const [tx, ty] = toCanvas(hand[tip], w, h);
    ctx.beginPath();
    ctx.arc(tx, ty, 5, 0, Math.PI * 2);
    ctx.fill();
    cx += tx;
    cy += ty;
    n++;
  }
  if (n === 0) return;
  cx /= n;
  cy /= n;

  const pct = hs.fingerSpreadPercent;
  drawLabel(ctx, pct != null ? `${Math.round(pct)}%` : '—', cx, cy - 30);

  const rom =
    hs.fingerSpreadMax != null && hs.fingerSpreadMin != null
      ? hs.fingerSpreadMax - hs.fingerSpreadMin
      : null;
  const parts = ['spread'];
  if (rom != null) parts.push(`ROM ${rom.toFixed(2)}`);
  drawCaption(ctx, parts.join(' · '), cx, cy + 14);
}

export function drawFingersOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  results: HolisticResults,
  state: TrackingState,
  metric: FingersMetric = 'openness',
): void {
  const w = canvas.width;
  const h = canvas.height;

  const hands = [
    {
      landmarks: results.leftHandLandmarks,
      handState: state.leftHand,
      activeColor: COLORS.activeLeft,
    },
    {
      landmarks: results.rightHandLandmarks,
      handState: state.rightHand,
      activeColor: COLORS.activeRight,
    },
  ];

  ctx.lineCap = 'round';

  for (const hand of hands) {
    if (!hand.landmarks || hand.landmarks.length < 21) continue;

    // Always draw the raw hand skeleton underlay.
    drawRawHandSkeleton(ctx, hand.landmarks, w, h);

    // Need the required landmarks for whichever metric we draw.
    const required = metric === 'spread' ? SPREAD_TIP_CHAIN : [...PALM_MCPS, ...OPENNESS_TIPS];
    if (required.some((idx) => !hand.landmarks![idx])) continue;

    if (metric === 'spread') {
      drawSpreadHand(ctx, hand.landmarks, hand.handState, hand.activeColor, w, h);
    } else {
      drawOpennessHand(ctx, hand.landmarks, hand.handState, hand.activeColor, w, h);
    }
  }
}
