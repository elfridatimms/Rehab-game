import type { HolisticResults, TrackingState, Landmark } from '../../types';

// Minimal wrist overlay — see docs/SPEC.md "Wrist angle".
//
// One horizontal grey reference line through the wrist (= 0°), one
// colored line wrist → MCP (= hand vector), and the angle in degrees
// near the wrist. All three derive from the SAME landmarks (lm0 and
// lm9) that feed updateWristExtension — the visual geometry and the
// displayed number cannot diverge.

const COLORS = {
  reference: 'rgba(180, 180, 180, 0.75)', // horizontal 0° axis (grey)
  activeLeft: '#22d3ee',                    // hand vector (left hand)
  activeRight: '#f472b6',                   // hand vector (right hand)
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
  fontSize = 20,
): void {
  const font = `bold ${fontSize}px "Inter", system-ui, sans-serif`;
  ctx.font = font;
  const m = ctx.measureText(text);
  const padX = 8;
  const padY = 4;
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
    // Visibility gate: need both landmarks the tracker uses (0 + 9).
    // If either is missing or the tracker couldn't produce an angle
    // this frame, draw nothing for this hand.
    if (!hand.landmarks || hand.landmarks.length < 10) continue;
    const angle = hand.handState.smoothedWristExtensionDeg;
    if (angle == null) continue;

    const wrist = hand.landmarks[0];
    const mcp = hand.landmarks[9];
    if (!wrist || !mcp) continue;

    const [wx, wy] = toCanvas(wrist, w, h);
    const [mx, my] = toCanvas(mcp, w, h);

    // Hand length on screen → use as the half-length of the horizontal
    // reference so the reference is visually proportional to the hand.
    const handLen = Math.hypot(mx - wx, my - wy);
    const refHalf = Math.max(40, handLen);

    // Reference: thin grey HORIZONTAL line through the wrist (= 0° axis).
    ctx.strokeStyle = COLORS.reference;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wx - refHalf, wy);
    ctx.lineTo(wx + refHalf, wy);
    ctx.stroke();

    // Active: thicker coloured line wrist → MCP (the hand vector that
    // feeds the angle formula).
    ctx.strokeStyle = hand.activeColor;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(mx, my);
    ctx.stroke();

    // Pivot dot at the wrist.
    ctx.fillStyle = hand.activeColor;
    ctx.beginPath();
    ctx.arc(wx, wy, 6, 0, Math.PI * 2);
    ctx.fill();

    // Numeric label near the wrist (above-and-offset so it doesn't sit
    // on the lines).
    drawLabel(ctx, `${Math.round(angle)}°`, wx, wy - 14);
  }
}
