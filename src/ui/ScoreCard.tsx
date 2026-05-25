import React from 'react';

interface ScoreCardProps {
  label: string;
  value: string | number;
  unit?: string;
  accent?: string;
  isBest?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const ScoreCard: React.FC<ScoreCardProps> = ({
  label,
  value,
  unit = '',
  accent = '#a855f7',
  isBest = false,
  size = 'md',
}) => {
  return (
    <div className={`score-card ${size} ${isBest ? 'is-best' : ''}`}>
      <span className="score-label">{label}</span>
      <span className="score-value" style={{ color: accent }}>
        {value}
        {unit && <span className="score-unit">{unit}</span>}
      </span>
      {isBest && <span className="best-badge">★ BEST</span>}
    </div>
  );
};
