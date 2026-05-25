import React from 'react';
import {
  ARM_LABELS,
  BACKGROUND_LABELS,
  CAMERA_ANGLE_LABELS,
  LIGHTING_LABELS,
  OCCLUSION_LABELS,
  SPEED_LABELS,
  VIEW_ORIENTATION_LABELS,
  type ArmUnderTest,
  type Background,
  type CameraAngle,
  type Lighting,
  type MovementSpeed,
  type Occlusion,
  type TrialMetadata,
  type ViewOrientation,
} from './types';

export type MetadataField =
  | 'viewOrientation'
  | 'arm'
  | 'distance'
  | 'cameraAngle'
  | 'lighting'
  | 'occlusion'
  | 'background'
  | 'speed'
  | 'notes';

const ALL_FIELDS: MetadataField[] = [
  'viewOrientation',
  'arm',
  'distance',
  'cameraAngle',
  'lighting',
  'occlusion',
  'background',
  'speed',
  'notes',
];

interface Props {
  value: TrialMetadata;
  onChange: (m: TrialMetadata) => void;
  disabled?: boolean;
  /** v1.10: when true, show the side/front orientation control. Honoured
   *  only for fields that include `viewOrientation` in `fieldsToShow`. */
  showViewOrientation?: boolean;
  /** v1.12: which fields to render. Defaults to all. Used by the recorder
   *  to split the orientation toggle (always visible) from the rest
   *  (behind a "More options" collapser). */
  fieldsToShow?: MetadataField[];
}

function entries<K extends string>(rec: Record<K, string>): [K, string][] {
  return Object.entries(rec) as [K, string][];
}

const TrialMetadataFormImpl: React.FC<Props> = ({
  value,
  onChange,
  disabled = false,
  showViewOrientation = false,
  fieldsToShow = ALL_FIELDS,
}) => {
  const set = <K extends keyof TrialMetadata>(key: K, v: TrialMetadata[K]) =>
    onChange({ ...value, [key]: v });

  const show = (f: MetadataField) => fieldsToShow.includes(f);

  return (
    <div className="rec-meta-grid">
      {showViewOrientation && show('viewOrientation') && (
        <div className="rec-field rec-field-orientation">
          <label className="rec-label">Camera orientation</label>
          <select
            className="rec-select"
            value={value.viewOrientation}
            disabled={disabled}
            onChange={(e) => set('viewOrientation', e.target.value as ViewOrientation)}
          >
            <option value="side">{VIEW_ORIENTATION_LABELS.side}</option>
            <option value="front">{VIEW_ORIENTATION_LABELS.front}</option>
          </select>
        </div>
      )}

      {show('arm') && (
        <div className="rec-field">
          <label className="rec-label">Arm under test</label>
          <select
            className="rec-select"
            value={value.arm}
            disabled={disabled}
            onChange={(e) => set('arm', e.target.value as ArmUnderTest)}
          >
            {entries(ARM_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      {show('distance') && (
        <div className="rec-field">
          <label className="rec-label">Camera distance (cm)</label>
          <input
            type="number"
            className="rec-input"
            min={0}
            step={5}
            value={Number.isFinite(value.distanceCm) ? value.distanceCm : ''}
            disabled={disabled}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              set('distanceCm', Number.isFinite(n) ? n : NaN);
            }}
          />
        </div>
      )}

      {show('cameraAngle') && (
        <div className="rec-field">
          <label className="rec-label">Camera angle</label>
          <select
            className="rec-select"
            value={value.cameraAngle}
            disabled={disabled}
            onChange={(e) => set('cameraAngle', e.target.value as CameraAngle)}
          >
            {entries(CAMERA_ANGLE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      {show('lighting') && (
        <div className="rec-field">
          <label className="rec-label">Lighting</label>
          <select
            className="rec-select"
            value={value.lighting}
            disabled={disabled}
            onChange={(e) => set('lighting', e.target.value as Lighting)}
          >
            {entries(LIGHTING_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      {show('occlusion') && (
        <div className="rec-field">
          <label className="rec-label">Occlusion</label>
          <select
            className="rec-select"
            value={value.occlusion}
            disabled={disabled}
            onChange={(e) => set('occlusion', e.target.value as Occlusion)}
          >
            {entries(OCCLUSION_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      {show('background') && (
        <div className="rec-field">
          <label className="rec-label">Background</label>
          <select
            className="rec-select"
            value={value.background}
            disabled={disabled}
            onChange={(e) => set('background', e.target.value as Background)}
          >
            {entries(BACKGROUND_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      {show('speed') && (
        <div className="rec-field">
          <label className="rec-label">Movement speed</label>
          <select
            className="rec-select"
            value={value.speed}
            disabled={disabled}
            onChange={(e) => set('speed', e.target.value as MovementSpeed)}
          >
            {entries(SPEED_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      {show('notes') && (
        <div className="rec-field rec-field-wide">
          <label className="rec-label">Notes (optional)</label>
          <input
            type="text"
            className="rec-input"
            value={value.notes}
            disabled={disabled}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Free text…"
          />
        </div>
      )}
    </div>
  );
};

export const TrialMetadataForm = React.memo(TrialMetadataFormImpl);
