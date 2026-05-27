import type { HolisticResults, TrackingState, Landmark } from '../../types';

// Minimal fingers overlay — just the openness % per hand.
//
// One palm-reference line (wrist → middle MCP, grey) so the user can
// see the tracked hand, and a prominent % number at the palm centre.
// No fingertip lines, no debug callouts.

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
  ctx.fillRect(x - tw / 2, y - th / 2, tw, th);
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
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
    const score = hand.handState.smoothedOpenHandScore;
    if (score == null) continue;

    const wrist = hand.landmarks[0];
    const mcp = hand.landmarks[9];
    if (!wrist || !mcp) continue;

    const [wx, wy] = toCanvas(wrist, w, h);
    const [mx, my] = toCanvas(mcp, w, h);

    // Palm reference (wrist → middle MCP, grey thin).
    ctx.strokeStyle = COLORS.reference;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(mx, my);
    ctx.stroke();

    // Wrist + MCP dots.
    ctx.fillStyle = hand.activeColor;
    ctx.beginPath();
    ctx.arc(wx, wy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx, my, 4, 0, Math.PI * 2);
    ctx.fill();

    // Prominent % at the palm centre.
    const cx = (wx + mx) / 2;
    const cy = (wy + my) / 2;
    drawLabel(ctx, `${Math.round(score)}%`, cx, cy);
  }
}
