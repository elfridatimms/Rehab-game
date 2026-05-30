import type { HolisticResults, TrackingState, Landmark } from '../../types';

// Wrist overlay — raw MediaPipe Hands skeleton as a grey underlay,
// then the vertical 0° reference + active wrist→MCP line + prominent
// angle label per hand. No fallback message: if no value, the
// skeleton stays and the angle layer is just skipped.

const COLORS = {
  skeleton: 'rgba(180, 180, 180, 0.45)',
  reference: 'rgba(180, 180, 180, 0.85)',
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
  ctx.fillRect(x - tw / 2, y - th, tw, th);
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y - padY - 1);
}

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
    if (!hand.landmarks || hand.landmarks.length < 10) continue;

    // Always draw the raw hand skeleton underlay.
    drawRawHandSkeleton(ctx, hand.landmarks, w, h);

    const angle = hand.handState.smoothedWristExtensionDeg;
    if (angle == null) continue;

    const wrist = hand.landmarks[0];
    const mcp = hand.landmarks[9];
    if (!wrist || !mcp) continue;

    const [wx, wy] = toCanvas(wrist, w, h);
    const [mx, my] = toCanvas(mcp, w, h);
    const handLen = Math.hypot(mx - wx, my - wy);
    const refHalf = Math.max(40, handLen);

    // HORIZONTAL reference through wrist = 0° / neutral axis (sideways
    // forearm convention: neutral hand sits horizontal along the
    // forearm).
    ctx.strokeStyle = COLORS.reference;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wx - refHalf, wy);
    ctx.lineTo(wx + refHalf, wy);
    ctx.stroke();

    // Active wrist→MCP (the hand vector that feeds the angle formula).
    ctx.strokeStyle = hand.activeColor;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(mx, my);
    ctx.stroke();

    ctx.fillStyle = hand.activeColor;
    ctx.beginPath();
    ctx.arc(wx, wy, 6, 0, Math.PI * 2);
    ctx.fill();

    // Main number: 0..180 scale, neutral horizontal = 90,
    // bent UP → 180, bent DOWN → 0.
    drawLabel(ctx, `${Math.round(angle)}°`, wx, wy - 18);

    // Secondary: forearm ↔ hand interior at the wrist (uses Pose
    // elbow + Hands wrist & MCP). Useful for prayer stretch where
    // the forearm is vertical and the value reflects how much the
    // wrist has bent from "straight" (0 at straight, grows with bend).
    const interior = hand.handState.smoothedWrist3DDeg;
    if (interior != null) {
      drawLabel(ctx, `p:${Math.round(interior)}°`, wx, wy + 30, 14);
    }
  }
}
