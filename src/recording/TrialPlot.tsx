import React, { useEffect, useRef } from 'react';
import type { EnrichedFrameRow, SideKey } from './types';
import { PLAUSIBLE_RANGE } from './anomaly';
import type { GameMode } from '../types';

interface TrialPlotProps {
  mode: GameMode;
  frames: readonly EnrichedFrameRow[];
  /** Inline pixel height; width is responsive. */
  height?: number;
}

const COLORS = {
  bg: '#0b0a1c',
  grid: 'rgba(120, 100, 220, 0.18)',
  axis: 'rgba(200, 190, 230, 0.6)',
  leftRaw: 'rgba(96, 165, 250, 0.55)',   // accent-blue
  leftFilt: 'rgba(96, 165, 250, 1)',
  rightRaw: 'rgba(236, 72, 153, 0.55)',  // accent-pink
  rightFilt: 'rgba(236, 72, 153, 1)',
  anomaly: '#f87171',
  legendText: '#e8e4f0',
};

function unitFor(mode: GameMode): string {
  return mode === 'fingers' ? '%' : '°';
}

/** Map a value in plot coordinates → canvas Y. */
function toY(
  v: number,
  yMin: number,
  yMax: number,
  top: number,
  bottom: number
): number {
  const span = yMax - yMin || 1;
  const t = (v - yMin) / span;
  return bottom - t * (bottom - top);
}

function findValueRange(
  frames: readonly EnrichedFrameRow[],
  mode: GameMode
): { yMin: number; yMax: number } {
  // Start from the plausible range bounds so a constant value still shows
  // useful context, then tighten/expand based on actual data.
  const plausible = PLAUSIBLE_RANGE[mode];
  let lo = plausible.min;
  let hi = plausible.max;
  let any = false;
  for (const f of frames) {
    for (const v of [f.left_raw, f.left_filtered, f.right_raw, f.right_filtered]) {
      if (v === null || !Number.isFinite(v)) continue;
      any = true;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!any) return { yMin: plausible.min, yMax: plausible.max };
  // 5% margin
  const pad = (hi - lo) * 0.05 || 1;
  return { yMin: lo - pad, yMax: hi + pad };
}

/** Render the trial signals onto the given canvas at device-pixel quality. */
function render(canvas: HTMLCanvasElement, props: TrialPlotProps): void {
  const { mode, frames } = props;
  const ctx = canvas.getContext('2d');
  if (!ctx || frames.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW === 0 || cssH === 0) return;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background.
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, cssW, cssH);

  // Layout.
  const padL = 38;
  const padR = 10;
  const padT = 28; // legend
  const padB = 22; // x-axis labels
  const plotL = padL;
  const plotR = cssW - padR;
  const plotT = padT;
  const plotB = cssH - padB;

  const tMin = frames[0].timestamp_ms;
  const tMax = frames[frames.length - 1].timestamp_ms;
  const tSpan = tMax - tMin || 1;
  const { yMin, yMax } = findValueRange(frames, mode);

  // Grid + Y-axis labels.
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = COLORS.axis;
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + (i / yTicks) * (yMax - yMin);
    const y = toY(v, yMin, yMax, plotT, plotB);
    ctx.beginPath();
    ctx.moveTo(plotL, y);
    ctx.lineTo(plotR, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(0), 4, y);
  }

  // X-axis ticks: ~5 evenly spaced in seconds.
  ctx.textBaseline = 'top';
  const xTicks = 5;
  for (let i = 0; i <= xTicks; i++) {
    const t = tMin + (i / xTicks) * tSpan;
    const x = plotL + (i / xTicks) * (plotR - plotL);
    ctx.fillText(`${(t / 1000).toFixed(1)}s`, x - 12, plotB + 4);
  }

  // Draw signals.
  const toX = (t: number): number => plotL + ((t - tMin) / tSpan) * (plotR - plotL);

  function drawLine(
    pick: (f: EnrichedFrameRow) => number | null,
    color: string,
    width: number
  ) {
    ctx!.strokeStyle = color;
    ctx!.lineWidth = width;
    ctx!.beginPath();
    let drawing = false;
    for (const f of frames) {
      const v = pick(f);
      if (v === null || !Number.isFinite(v)) {
        drawing = false;
        continue;
      }
      const x = toX(f.timestamp_ms);
      const y = toY(v, yMin, yMax, plotT, plotB);
      if (drawing) {
        ctx!.lineTo(x, y);
      } else {
        ctx!.moveTo(x, y);
        drawing = true;
      }
    }
    ctx!.stroke();
  }

  // Raw is lighter, filtered is bold.
  drawLine((f) => f.left_raw, COLORS.leftRaw, 1);
  drawLine((f) => f.left_filtered, COLORS.leftFilt, 1.6);
  drawLine((f) => f.right_raw, COLORS.rightRaw, 1);
  drawLine((f) => f.right_filtered, COLORS.rightFilt, 1.6);

  // Anomaly dots — overlay on the filtered (or raw if filtered null) sample.
  ctx.fillStyle = COLORS.anomaly;
  const drawAnomalyDots = (
    side: SideKey,
    pickFlag: (f: EnrichedFrameRow) => 0 | 1,
    pickVal: (f: EnrichedFrameRow) => number | null
  ) => {
    for (const f of frames) {
      if (pickFlag(f) !== 1) continue;
      const v = pickVal(f);
      if (v === null || !Number.isFinite(v)) continue;
      const x = toX(f.timestamp_ms);
      const y = toY(v, yMin, yMax, plotT, plotB);
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // side is unused-but-meaningful for future per-side styling
    void side;
  };
  drawAnomalyDots('left', (f) => f.left_anomaly_flag, (f) => f.left_filtered ?? f.left_raw);
  drawAnomalyDots('right', (f) => f.right_anomaly_flag, (f) => f.right_filtered ?? f.right_raw);

  // Legend.
  ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const legendY = 12;
  let lx = plotL;
  const legendItems: { color: string; label: string }[] = [
    { color: COLORS.leftFilt, label: 'L filt' },
    { color: COLORS.leftRaw, label: 'L raw' },
    { color: COLORS.rightFilt, label: 'R filt' },
    { color: COLORS.rightRaw, label: 'R raw' },
    { color: COLORS.anomaly, label: 'anomaly' },
  ];
  for (const item of legendItems) {
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(lx + 4, legendY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.legendText;
    ctx.fillText(item.label, lx + 12, legendY);
    lx += ctx.measureText(item.label).width + 26;
  }

  // Y unit label
  ctx.fillStyle = COLORS.axis;
  ctx.textBaseline = 'bottom';
  ctx.fillText(unitFor(mode), 4, plotT);
}

const TrialPlotImpl: React.FC<TrialPlotProps> = (props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Keep a fresh ref to props so the (one-shot) ResizeObserver callback can
  // re-render with current data without us tearing the observer down on
  // every parent re-render.
  const propsRef = useRef(props);
  propsRef.current = props;

  // Re-paint whenever the data actually changes.
  useEffect(() => {
    if (!canvasRef.current) return;
    render(canvasRef.current, propsRef.current);
  }, [props.mode, props.frames, props.height]);

  // Install the ResizeObserver ONCE on mount.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      render(el, propsRef.current);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const h = props.height ?? 180;
  return (
    <div className="trial-plot" style={{ height: h }}>
      <canvas ref={canvasRef} className="trial-plot-canvas" />
    </div>
  );
};

export const TrialPlot = React.memo(TrialPlotImpl);
