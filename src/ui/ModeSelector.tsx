import React from 'react';
import type { GameMode } from '../types';

interface ModeSelectorProps {
  activeMode: GameMode;
  onModeChange: (mode: GameMode) => void;
  /** Vertical rail for sidebars; grid for compact horizontal layout */
  variant?: 'grid' | 'rail';
}

const MODES: { key: GameMode; label: string; desc: string }[] = [
  { key: 'elbow', label: 'Elbow', desc: 'Pose model' },
  { key: 'wrist', label: 'Wrist', desc: 'Hands model' },
  { key: 'fingers', label: 'Fingers', desc: 'Hands model' },
];

const ModeSelectorImpl: React.FC<ModeSelectorProps> = ({
  activeMode,
  onModeChange,
  variant = 'grid',
}) => {
  return (
    <div className={`mode-selector ${variant === 'rail' ? 'mode-selector--rail' : ''}`}>
      {MODES.map((mode) => (
        <button
          key={mode.key}
          className={`mode-btn ${variant === 'rail' ? 'mode-btn--rail' : ''} ${activeMode === mode.key ? 'active' : ''}`}
          onClick={() => onModeChange(mode.key)}
        >
          <span className="mode-text-stack">
            <span className="mode-label">{mode.label}</span>
            <span className="mode-desc">{mode.desc}</span>
          </span>
        </button>
      ))}
    </div>
  );
};

// Memoised: this component takes only stable props (mode + callback +
// variant) so it should never re-render on the App's per-frame trackingState
// churn.
export const ModeSelector = React.memo(ModeSelectorImpl);
