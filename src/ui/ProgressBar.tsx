import React from 'react';

interface ProgressBarProps {
  value: number;         // 0–100
  peak?: number | null;  // 0–100 marker for session best
  color?: string;        // gradient start color
  colorEnd?: string;     // gradient end color
  label?: string;
  sublabel?: string;
  height?: number;
  showPeakGlow?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  peak,
  color = '#6366f1',
  colorEnd = '#a855f7',
  label,
  sublabel,
  height = 28,
  showPeakGlow = true,
}) => {
  const clampedValue = Math.max(0, Math.min(100, value));
  const clampedPeak = peak != null ? Math.max(0, Math.min(100, peak)) : null;
  const isNewRecord = clampedPeak != null && clampedValue >= clampedPeak - 0.5;

  return (
    <div className="progress-bar-container">
      {(label || sublabel) && (
        <div className="progress-bar-labels">
          {label && <span className="progress-bar-label">{label}</span>}
          {sublabel && <span className="progress-bar-sublabel">{sublabel}</span>}
        </div>
      )}
      <div
        className="progress-bar-track"
        style={{ height, borderRadius: height / 2 }}
      >
        {/* Fill */}
        <div
          className={`progress-bar-fill ${isNewRecord ? 'record-glow' : ''}`}
          style={{
            width: `${clampedValue}%`,
            background: `linear-gradient(90deg, ${color}, ${colorEnd})`,
            borderRadius: height / 2,
            height: '100%',
            transition: 'width 0.15s ease-out',
          }}
        />
        {/* Peak marker */}
        {clampedPeak != null && clampedPeak > 0.5 && showPeakGlow && (
          <div
            className="progress-bar-peak"
            style={{
              left: `${clampedPeak}%`,
              height: height + 8,
              top: -4,
            }}
          >
            <div className="peak-diamond" />
          </div>
        )}
      </div>
    </div>
  );
};
