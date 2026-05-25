import React, { useEffect, useRef } from 'react';
import type { TrackingState } from '../../types';
import { getActiveArmStats } from '../../tracking/elbowTracker';
import { ProgressBar } from '../../ui/ProgressBar';
import { ScoreCard } from '../../ui/ScoreCard';
import { playChime } from '../effects/SoundManager';
import type { Exercise } from '../../exercises/exerciseTypes';
import type {
  DetectorId,
  FailureDetectorOutput,
} from '../../detectors/detectorTypes';
import { DetectorStatusBlock } from '../../exercises/DetectorStatusBlock';

interface ElbowPanelProps {
  state: TrackingState;
  exercise: Exercise | null;
  liveDetectorOutputs: Partial<Record<DetectorId, FailureDetectorOutput>>;
  onCalibrateAxialRotation: (side: 'left' | 'right') => void;
  /** Accepted but unused since v1.10 (picker moved to right rail). */
  onPickExercise?: (ex: Exercise) => void;
  /** Accepted but unused since v1.10. */
  disabled?: boolean;
}

export const ElbowPanel: React.FC<ElbowPanelProps> = ({
  state,
  exercise,
  liveDetectorOutputs,
  onCalibrateAxialRotation,
}) => {
  const { elbow } = state;
  const stats = getActiveArmStats(elbow);
  const prevMaxRef = useRef<number | null>(null);

  // Sound on new record
  useEffect(() => {
    if (stats.maxDeg != null && prevMaxRef.current != null && stats.maxDeg > prevMaxRef.current + 2) {
      playChime(1.0);
    }
    prevMaxRef.current = stats.maxDeg;
  }, [stats.maxDeg]);

  const angle = elbow.smoothedAngle;
  const progressValue = angle != null ? (angle / 180) * 100 : 0;
  const peakValue = stats.maxDeg != null ? (stats.maxDeg / 180) * 100 : null;
  const rom = stats.minDeg != null && stats.maxDeg != null ? stats.maxDeg - stats.minDeg : null;
  const sideLabel = stats.activeSide === 'L' ? 'Left arm' : stats.activeSide === 'R' ? 'Right arm' : '—';

  return (
    <div className="game-panel elbow-panel">
      <div className="panel-header">
        <h2>Elbow tracking</h2>
      </div>

      {/* v1.10: picker + instructions live exclusively in the right rail
          (ExerciseSideMenu). Mode panels only show measurements. */}

      {/* v1.6/v1.7: show both arms, plus the 2D vs 3D delta so the user
          can SEE when their arm is off-camera-plane. Large delta = arm is
          flexing toward/away from the camera and 2D is foreshortened. */}
      <div className="metrics-row">
        <ScoreCard
          label="Active arm (CSV)"
          value={sideLabel}
          accent="#a78bfa"
          size="sm"
        />
        <ElbowAngleCard
          label="L · elbow"
          smoothed3d={elbow.leftSmoothed3D ?? elbow.leftSmoothed}
          smoothed2d={elbow.leftSmoothed2D}
          accent="#22d3ee"
        />
        <ElbowAngleCard
          label="R · elbow"
          smoothed3d={elbow.rightSmoothed3D ?? elbow.rightSmoothed}
          smoothed2d={elbow.rightSmoothed2D}
          accent="#f472b6"
        />
      </div>
      <div className="metrics-row">
        <ScoreCard
          label="L · forearm roll"
          value={
            elbow.leftForearmRotSmoothed != null
              ? `${elbow.leftForearmRotSmoothed >= 0 ? '+' : '−'}${Math.abs(Math.round(elbow.leftForearmRotSmoothed))}`
              : '—'
          }
          unit="°"
          accent="#34d399"
          size="sm"
        />
        <ScoreCard
          label="R · forearm roll"
          value={
            elbow.rightForearmRotSmoothed != null
              ? `${elbow.rightForearmRotSmoothed >= 0 ? '+' : '−'}${Math.abs(Math.round(elbow.rightForearmRotSmoothed))}`
              : '—'
          }
          unit="°"
          accent="#34d399"
          size="sm"
        />
        <ScoreCard
          label="Active ROM"
          value={rom != null ? Math.round(rom) : '—'}
          unit="°"
          accent="#ec4899"
          size="sm"
        />
      </div>

      <div className="progress-section">
        <ProgressBar
          value={progressValue}
          peak={peakValue}
          color="#a78bfa"
          colorEnd="#ec4899"
          label="Power"
          sublabel={angle != null ? `${Math.round(angle)}° / 180°` : 'Waiting...'}
          height={32}
        />
      </div>

      <div className="session-stats-row">
        <div className="stat-mini">
          <span className="stat-mini-label">Session low</span>
          <span className="stat-mini-value">
            {stats.minDeg != null ? `${Math.round(stats.minDeg)}°` : '—'}
          </span>
        </div>
        <div className="stat-mini">
          <span className="stat-mini-label">Session high</span>
          <span className="stat-mini-value best">
            {stats.maxDeg != null ? `${Math.round(stats.maxDeg)}°` : '—'}
          </span>
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

/** Combined 3D + 2D angle display. The big number is the canonical (3D,
 *  viewpoint-invariant) value; the small parenthetical is the 2D value
 *  for direct comparison. When the delta is large the arm is flexing
 *  off the camera plane — we surface that with a coloured chip. */
const ElbowAngleCard: React.FC<{
  label: string;
  smoothed3d: number | null;
  smoothed2d: number | null;
  accent: string;
}> = ({ label, smoothed3d, smoothed2d, accent }) => {
  const main = smoothed3d != null ? Math.round(smoothed3d) : null;
  const sec = smoothed2d != null ? Math.round(smoothed2d) : null;
  const delta = main != null && sec != null ? Math.abs(main - sec) : null;
  const offPlane = delta != null && delta > 15;
  return (
    <div className="score-card md" style={{ position: 'relative' }}>
      <span className="score-label">{label}</span>
      <span className="score-value" style={{ color: accent }}>
        {main != null ? main : '—'}
        <span className="score-unit">°</span>
      </span>
      <div
        style={{
          fontSize: 10,
          color: offPlane ? '#fbbf24' : 'rgba(255,255,255,0.45)',
          marginTop: 2,
        }}
      >
        2D: {sec != null ? `${sec}°` : '—'}
        {delta != null && <> · Δ {delta}°</>}
        {offPlane && <> · off-plane</>}
      </div>
    </div>
  );
};
