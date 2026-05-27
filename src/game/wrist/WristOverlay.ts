import type { HolisticResults, TrackingState, Landmark } from '../../types';

// Minimal wrist overlay — just the deflection from neutral.
//
// Vertical reference line through the wrist (= 0° axis where a
// neutral upright hand sits) + colored line wrist → MCP (= hand
// vector that feeds the angle formula) + prominent number near
// the wrist. Per-hand.

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
    const angle = hand.handState.smoothedWristExtensionDeg;
    if (angle == null) continue;

    const wrist = hand.landmarks[0];
    const mcp = hand.landmarks[9];
    if (!wrist || !mcp) continue;

    const [wx, wy] = toCanvas(wrist, w, h);
    const [mx, my] = toCanvas(mcp, w, h);
    const handLen = Math.hypot(mx - wx, my - wy);
    const refHalf = Math.max(40, handLen);

    // Reference: VERTICAL grey line through wrist (= 0° / neutral).
    ctx.strokeStyle = COLORS.reference;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wx, wy - refHalf);
    ctx.lineTo(wx, wy + refHalf);
    ctx.stroke();

    // Active: thicker colored line wrist → MCP (the hand vector).
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

    // Big numeric label near the wrist.
    drawLabel(ctx, `${Math.round(angle)}°`, wx, wy - 18);
  }
}
