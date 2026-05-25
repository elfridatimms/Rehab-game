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

interface WristPanelProps {
  state: TrackingState;
  exercise: Exercise | null;
  liveDetectorOutputs: Partial<Record<DetectorId, FailureDetectorOutput>>;
  onCalibrateAxialRotation: (side: 'left' | 'right') => void;
  /** Accepted but unused since v1.10. */
  onPickExercise?: (ex: Exercise) => void;
  /** Accepted but unused since v1.10. */
  disabled?: boolean;
}

export const WristPanel: React.FC<WristPanelProps> = ({
  state,
  exercise,
  liveDetectorOutputs,
  onCalibrateAxialRotation,
}) => {
  const { leftHand, rightHand } = state;
  const prevLeftPeak = useRef<number | null>(null);
  const prevRightPeak = useRef<number | null>(null);

  // Sound on new peak
  useEffect(() => {
    if (leftHand.peakWristExtensionDeg != null && prevLeftPeak.current != null
        && leftHand.peakWristExtensionDeg > prevLeftPeak.current + 1) {
      playChime(1.1);
    }
    prevLeftPeak.current = leftHand.peakWristExtensionDeg;
  }, [leftHand.peakWristExtensionDeg]);

  useEffect(() => {
    if (rightHand.peakWristExtensionDeg != null && prevRightPeak.current != null
        && rightHand.peakWristExtensionDeg > prevRightPeak.current + 1) {
      playChime(0.9);
    }
    prevRightPeak.current = rightHand.peakWristExtensionDeg;
  }, [rightHand.peakWristExtensionDeg]);

  const leftAngle = leftHand.smoothedWristExtensionDeg;
  const rightAngle = rightHand.smoothedWristExtensionDeg;
  const leftPeak = leftHand.peakWristExtensionDeg;
  const rightPeak = rightHand.peakWristExtensionDeg;

  return (
    <div className="game-panel wrist-panel">
      <div className="panel-header">
        <h2>Wrist tracking</h2>
      </div>

      {/* v1.10: picker + instructions moved to the right-rail ExerciseSideMenu. */}

      <div className="hand-metrics-grid">
        {/* Left hand */}
        <div className="hand-column left">
          <div className="hand-label-row">
            <span className="hand-dot left" />
            <span>Left hand</span>
          </div>
          <ScoreCard
            label="Wrist angle"
            value={leftAngle != null ? Math.round(leftAngle) : '—'}
            unit="°"
            accent="#60a5fa"
            size="md"
          />
          <ProgressBar
            value={leftAngle != null ? (leftAngle / 180) * 100 : 0}
            peak={leftPeak != null ? (leftPeak / 180) * 100 : null}
            color="#3b82f6"
            colorEnd="#60a5fa"
            label="0 → 180°"
            sublabel={
              leftAngle != null
                ? `${Math.round(leftAngle)}° / 180° (neutral=90°)`
                : 'Waiting…'
            }
          />
          <div className="stat-mini">
            <span className="stat-mini-label">Best beam</span>
            <span className="stat-mini-value best">
              {leftPeak != null ? `${Math.round(leftPeak)}°` : '—'}
            </span>
          </div>
          {/* v1.8: 3D camera-invariant magnitude (works when forearm
              points toward camera). Shown alongside the 2D signed value. */}
          <div className="stat-mini">
            <span className="stat-mini-label">3D deviation</span>
            <span className="stat-mini-value">
              {leftHand.smoothedWrist3DDeg != null
                ? `${Math.round(leftHand.smoothedWrist3DDeg)}°`
                : '—'}
            </span>
          </div>
        </div>

        {/* Right hand */}
        <div className="hand-column right">
          <div className="hand-label-row">
            <span className="hand-dot right" />
            <span>Right hand</span>
          </div>
          <ScoreCard
            label="Wrist angle"
            value={rightAngle != null ? Math.round(rightAngle) : '—'}
            unit="°"
            accent="#f472b6"
            size="md"
          />
          <ProgressBar
            value={rightAngle != null ? (rightAngle / 180) * 100 : 0}
            peak={rightPeak != null ? (rightPeak / 180) * 100 : null}
            color="#ec4899"
            colorEnd="#f472b6"
            label="0 → 180°"
            sublabel={
              rightAngle != null
                ? `${Math.round(rightAngle)}° / 180° (neutral=90°)`
                : 'Waiting…'
            }
          />
          <div className="stat-mini">
            <span className="stat-mini-label">Best beam</span>
            <span className="stat-mini-value best">
              {rightPeak != null ? `${Math.round(rightPeak)}°` : '—'}
            </span>
          </div>
          <div className="stat-mini">
            <span className="stat-mini-label">3D deviation</span>
            <span className="stat-mini-value">
              {rightHand.smoothedWrist3DDeg != null
                ? `${Math.round(rightHand.smoothedWrist3DDeg)}°`
                : '—'}
            </span>
          </div>
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
