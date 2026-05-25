import React, { useEffect, useRef } from 'react';
import type { TrackingState } from '../../types';
import { ProgressBar } from '../../ui/ProgressBar';
import { ScoreCard } from '../../ui/ScoreCard';
import { playChime } from '../effects/SoundManager';
import type { Exercise } from '../../exercises/exerciseTypes';
import type {
  DetectorId,
  FailureDetectorOutput,
} from '../../detectors/detectorTypes';
import { DetectorStatusBlock } from '../../exercises/DetectorStatusBlock';

interface FingersPanelProps {
  state: TrackingState;
  exercise: Exercise | null;
  liveDetectorOutputs: Partial<Record<DetectorId, FailureDetectorOutput>>;
  onCalibrateAxialRotation: (side: 'left' | 'right') => void;
  /** Accepted but unused since v1.10. */
  onPickExercise?: (ex: Exercise) => void;
  /** Accepted but unused since v1.10. */
  disabled?: boolean;
}

export const FingersPanel: React.FC<FingersPanelProps> = ({
  state,
  exercise,
  liveDetectorOutputs,
  onCalibrateAxialRotation,
}) => {
  const { leftHand, rightHand } = state;
  const prevLeftPeak = useRef<number | null>(null);
  const prevRightPeak = useRef<number | null>(null);

  useEffect(() => {
    if (leftHand.peakOpenHandScore != null && prevLeftPeak.current != null
        && leftHand.peakOpenHandScore > prevLeftPeak.current + 2) {
      playChime(1.2);
    }
    prevLeftPeak.current = leftHand.peakOpenHandScore;
  }, [leftHand.peakOpenHandScore]);

  useEffect(() => {
    if (rightHand.peakOpenHandScore != null && prevRightPeak.current != null
        && rightHand.peakOpenHandScore > prevRightPeak.current + 2) {
      playChime(0.8);
    }
    prevRightPeak.current = rightHand.peakOpenHandScore;
  }, [rightHand.peakOpenHandScore]);

  const leftScore = leftHand.smoothedOpenHandScore;
  const rightScore = rightHand.smoothedOpenHandScore;
  const leftPeak = leftHand.peakOpenHandScore;
  const rightPeak = rightHand.peakOpenHandScore;

  return (
    <div className="game-panel fingers-panel">
      <div className="panel-header">
        <h2>Finger tracking</h2>
      </div>

      {/* v1.10: picker + instructions moved to the right-rail ExerciseSideMenu. */}

      <div className="hand-metrics-grid">
        {/* Left hand */}
        <div className="hand-column left">
          <div className="hand-label-row">
            <span className="hand-dot left-green" />
            <span>Left hand</span>
          </div>
          <ScoreCard
            label="Openness"
            value={leftScore != null ? Math.round(leftScore) : '—'}
            unit="%"
            accent="#34d399"
            size="md"
          />
          <ProgressBar
            value={leftScore ?? 0}
            peak={leftPeak}
            color="#10b981"
            colorEnd="#34d399"
            label="Bloom"
            sublabel={leftScore != null ? `${Math.round(leftScore)}%` : 'Waiting...'}
          />
          <div className="stat-mini">
            <span className="stat-mini-label">Best bloom</span>
            <span className="stat-mini-value best">
              {leftPeak != null ? `${Math.round(leftPeak)}%` : '—'}
            </span>
          </div>
          {/* v1.10: per-finger spread angles. Each is the angle at the
              wrist between adjacent fingertip vectors. */}
          <FingerSpreads state={leftHand} />
        </div>

        {/* Right hand */}
        <div className="hand-column right">
          <div className="hand-label-row">
            <span className="hand-dot right-orange" />
            <span>Right hand</span>
          </div>
          <ScoreCard
            label="Openness"
            value={rightScore != null ? Math.round(rightScore) : '—'}
            unit="%"
            accent="#fb923c"
            size="md"
          />
          <ProgressBar
            value={rightScore ?? 0}
            peak={rightPeak}
            color="#f97316"
            colorEnd="#fb923c"
            label="Bloom"
            sublabel={rightScore != null ? `${Math.round(rightScore)}%` : 'Waiting...'}
          />
          <div className="stat-mini">
            <span className="stat-mini-label">Best bloom</span>
            <span className="stat-mini-value best">
              {rightPeak != null ? `${Math.round(rightPeak)}%` : '—'}
            </span>
          </div>
          <FingerSpreads state={rightHand} />
        </div>
      </div>

      {exercise && (
        <DetectorStatusBlock
          exercise={exercise}
          liveOutputs={liveDetectorOutputs}
          onCalibrateAxialRotation={onCalibrateAxialRotation}
        />
      )}
    </div>
  );
};

/** v1.10: small block showing the four spread angles between adjacent
 *  fingertips. Useful for fist-making (all near 0°) vs finger-stretch
 *  (much larger), where the openness % alone doesn't tell the full story. */
const FingerSpreads: React.FC<{
  state: { spreadThumbIndex: number | null; spreadIndexMiddle: number | null; spreadMiddleRing: number | null; spreadRingPinky: number | null };
}> = ({ state }) => {
  const row = (label: string, v: number | null) => (
    <div className="stat-mini">
      <span className="stat-mini-label">{label}</span>
      <span className="stat-mini-value">{v != null ? `${Math.round(v)}°` : '—'}</span>
    </div>
  );
  return (
    <>
      {row('T↔I spread', state.spreadThumbIndex)}
      {row('I↔M spread', state.spreadIndexMiddle)}
      {row('M↔R spread', state.spreadMiddleRing)}
      {row('R↔P spread', state.spreadRingPinky)}
    </>
  );
};
