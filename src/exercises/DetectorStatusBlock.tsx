import React from 'react';
import type { Exercise } from './exerciseTypes';
import type {
  DetectorId,
  FailureDetectorOutput,
} from '../detectors/detectorTypes';

interface Props {
  exercise: Exercise;
  liveOutputs: Partial<Record<DetectorId, FailureDetectorOutput>>;
  onCalibrateAxialRotation?: (side: 'left' | 'right') => void;
}

const DETECTOR_LABEL: Record<DetectorId, string> = {
  DualHandOcclusion: 'Dual-hand occlusion',
  HandObjectOcclusion: 'Hand-object occlusion',
  MultiAxisMotion: 'Multi-axis motion',
  AxialRotation: 'Axial (forearm) rotation',
  PoseDiscrimination: 'Ambiguous openness band',
  ForceRequired: 'Force-based exercise',
};

/** Compact per-detector card. */
const DetectorCard: React.FC<{
  id: DetectorId;
  output?: FailureDetectorOutput;
  onCalibrate?: () => void;
}> = ({ id, output, onCalibrate }) => {
  const detected = output?.detected ?? false;
  const confidence = output?.confidence ?? 0;
  const evidence = output?.evidence ?? {};

  return (
    <div className={`detector-card ${detected ? 'is-detected' : 'is-ok'}`}>
      <div className="detector-card-header">
        <span className="detector-card-status">{detected ? '🚩' : '✓'}</span>
        <span className="detector-card-label">{DETECTOR_LABEL[id]}</span>
        {onCalibrate && (
          <button
            type="button"
            className="detector-calibrate-btn"
            onClick={onCalibrate}
          >
            Calibrate
          </button>
        )}
      </div>
      <div className="detector-card-bar" aria-label="confidence">
        <div
          className="detector-card-bar-fill"
          style={{ width: `${Math.round(confidence * 100)}%` }}
        />
        <span className="detector-card-bar-value">
          {Math.round(confidence * 100)}%
        </span>
      </div>
      <dl className="detector-card-evidence">
        {Object.entries(evidence).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{String(v)}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
};

/** Failure-detection block shown in mode panels for PARTIAL / NO exercises.
 *  YES exercises pass an empty `activeDetectors` array, in which case this
 *  component renders nothing. */
export const DetectorStatusBlock: React.FC<Props> = ({
  exercise,
  liveOutputs,
  onCalibrateAxialRotation,
}) => {
  if (exercise.activeDetectors.length === 0) return null;

  // AxialRotation is the only detector that takes a calibration button.
  // For simplicity we surface a left/right pair if either hand has data;
  // most exercises that use it only need one side, but the UI is symmetric.
  const usesAxial = exercise.activeDetectors.includes('AxialRotation');

  return (
    <section className="detector-status-block" aria-label="Failure detection">
      <h3 className="detector-status-title">Failure detection</h3>
      {usesAxial && onCalibrateAxialRotation && (
        <div className="detector-calibrate-row">
          <span>Calibrate neutral position:</span>
          <button
            type="button"
            className="detector-calibrate-side-btn"
            onClick={() => onCalibrateAxialRotation('left')}
          >
            Left hand
          </button>
          <button
            type="button"
            className="detector-calibrate-side-btn"
            onClick={() => onCalibrateAxialRotation('right')}
          >
            Right hand
          </button>
        </div>
      )}
      <div className="detector-cards">
        {exercise.activeDetectors.map((id) => (
          <DetectorCard key={id} id={id} output={liveOutputs[id]} />
        ))}
      </div>
    </section>
  );
};
