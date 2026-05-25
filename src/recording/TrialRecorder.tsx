import React, { useCallback, useEffect, useImperativeHandle, useState } from 'react';
import type { GameMode } from '../types';
import type { Exercise } from '../exercises/exerciseTypes';
import { TrialMetadataForm } from './TrialMetadataForm';
import { readSubjectId, writeSubjectId, type useTrialRecorder } from './useTrialRecorder';
import type {
  EnrichedFrameRow,
  TrialMetadata,
  TrialSummary,
  Validity,
} from './types';
import { CaptureMismatchModal } from './CaptureMismatchModal';
import { TrialPlot } from './TrialPlot';

export interface TrialRecorderHandle {
  stopIfRecording: () => void;
}

/** The recorder hook's return type. TrialRecorder receives the full object
 *  from App, which now owns the hook. */
export type TrialRecorderApi = ReturnType<typeof useTrialRecorder>;

interface TrialRecorderProps {
  activeMode: GameMode;
  cameraIsRunning: boolean;
  recorder: TrialRecorderApi;
  handleRef?: React.RefObject<TrialRecorderHandle | null>;
  /** Current exercise (chosen in sidebar); required for trial start */
  exercise: Exercise | null;
  /** Optional: sync parent UI (e.g. disable exercise rail) while recording */
  onRecordingChange?: (isRecording: boolean) => void;
}

function isMetadataComplete(m: TrialMetadata): boolean {
  return Number.isFinite(m.distanceCm) && m.distanceCm > 0;
}

const DEFAULT_META: TrialMetadata = {
  arm: 'both',
  distanceCm: 150,
  cameraAngle: 'frontal',
  lighting: 'good',
  occlusion: 'none',
  background: 'plain',
  speed: 'normal1s',
  notes: '',
  viewOrientation: 'na',
};

function unitFor(mode: GameMode): string {
  return mode === 'fingers' ? '%' : '°';
}

function fmt(n: number | null | undefined, unit: string, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}${unit}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

const VALIDITY_LABEL: Record<Validity, string> = {
  valid: 'valid',
  partial: 'partial',
  invalid: 'invalid',
  save_anyway: 'save anyway',
};

const TrialRecorderImpl: React.FC<TrialRecorderProps> = ({
  activeMode,
  cameraIsRunning,
  recorder,
  handleRef,
  exercise,
  onRecordingChange,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [metaCollapsed, setMetaCollapsed] = useState(true);
  const [subjectId, setSubjectId] = useState<string>(() => readSubjectId());
  const [meta, setMeta] = useState<TrialMetadata>(DEFAULT_META);

  // Expose an imperative stop() so App can auto-stop on mode-switch without
  // re-rendering this component just to read the recorder state.
  // `recorder.stopTrial` internally no-ops when not recording, so we can use
  // it directly; depending on the stable callback (not the whole recorder
  // object) keeps the handle from being rebuilt every render.
  useImperativeHandle(
    handleRef,
    () => ({
      stopIfRecording: recorder.stopTrial,
    }),
    [recorder.stopTrial]
  );

  useEffect(() => {
    onRecordingChange?.(recorder.status.isRecording);
  }, [recorder.status.isRecording, onRecordingChange]);

  // v1.10: keep meta.viewOrientation consistent with the active
  // exercise's `bidirectional` flag. When the exercise IS bidirectional
  // we initialise to 'side' (or preserve user's prior choice); otherwise
  // force 'na' so the CSV is clean.
  useEffect(() => {
    if (!exercise) return;
    const isBidir = exercise.bidirectional === true;
    setMeta((prev) => {
      if (isBidir && prev.viewOrientation === 'na') {
        return { ...prev, viewOrientation: 'side' };
      }
      if (!isBidir && prev.viewOrientation !== 'na') {
        return { ...prev, viewOrientation: 'na' };
      }
      return prev;
    });
  }, [exercise]);

  const handleSubjectChange = useCallback((id: string) => {
    setSubjectId(id);
    writeSubjectId(id);
  }, []);

  const handleStart = useCallback(() => {
    if (!exercise) return;
    if (!isMetadataComplete(meta)) return;
    if (!cameraIsRunning) return;
    recorder.startTrial(exercise, meta, subjectId.trim() || 'S01');
  }, [exercise, meta, subjectId, cameraIsRunning, recorder]);

  const handleStop = useCallback(() => {
    recorder.stopTrial();
  }, [recorder]);

  const handleClear = useCallback(() => {
    const ok = window.confirm(
      `Clear all ${recorder.summaries.length} trial summaries from local storage? This cannot be undone.`
    );
    if (ok) recorder.clearSummaries();
  }, [recorder]);

  const startDisabled =
    recorder.status.isRecording ||
    !cameraIsRunning ||
    !exercise ||
    !isMetadataComplete(meta) ||
    !subjectId.trim();

  return (
    <section className={`recorder-panel ${collapsed ? 'is-collapsed' : ''}`}>
      <header
        className="recorder-header"
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed((c) => !c);
          }
        }}
      >
        <span className="recorder-toggle">{collapsed ? '▸' : '▾'}</span>
        <h3 className="recorder-title">Trial Recording</h3>
        <span className="recorder-mode-tag">{activeMode}</span>
        {recorder.status.isRecording && (
          <span className="recorder-rec-pill">● REC</span>
        )}
        <span className="recorder-trial-counter">
          Next trial: #{String(recorder.status.trialIdx).padStart(3, '0')}
        </span>
      </header>

      {!collapsed && (
        <div className="recorder-body">
          <div className="rec-field rec-field-narrow">
            <label className="rec-label" htmlFor="subject-id">
              Subject ID
            </label>
            <input
              id="subject-id"
              type="text"
              className="rec-input"
              value={subjectId}
              maxLength={32}
              disabled={recorder.status.isRecording}
              onChange={(e) => handleSubjectChange(e.target.value)}
            />
          </div>

          {/* The orientation toggle is always visible (when relevant) since
              it directly affects how the user must position the camera.
              The rest of the metadata sits behind a "More options" toggle
              so the side rail stays focused on the primary action. */}
          {exercise?.bidirectional === true && (
            <TrialMetadataForm
              value={meta}
              onChange={setMeta}
              disabled={recorder.status.isRecording}
              showViewOrientation
              fieldsToShow={['viewOrientation']}
            />
          )}
          <button
            type="button"
            className="recorder-meta-toggle"
            onClick={() => setMetaCollapsed((c) => !c)}
          >
            {metaCollapsed ? '▸ More options' : '▾ Hide options'}
          </button>
          {!metaCollapsed && (
            <TrialMetadataForm
              value={meta}
              onChange={setMeta}
              disabled={recorder.status.isRecording}
              showViewOrientation={false}
              fieldsToShow={[
                'arm',
                'distance',
                'cameraAngle',
                'lighting',
                'occlusion',
                'background',
                'speed',
                'notes',
              ]}
            />
          )}

          <div className="recorder-controls">
            {!recorder.status.isRecording ? (
              <button
                className="btn btn-rec-start"
                onClick={handleStart}
                disabled={startDisabled}
                title={
                  !cameraIsRunning
                    ? 'Start the camera first'
                    : !exercise
                      ? 'Select an exercise'
                      : !isMetadataComplete(meta)
                        ? 'Camera distance is required'
                        : ''
                }
              >
                ● Start Trial
              </button>
            ) : (
              <button className="btn btn-rec-stop" onClick={handleStop}>
                ■ Stop Trial
              </button>
            )}

            <button
              className="btn btn-rec-export"
              onClick={recorder.exportAllSummaries}
              disabled={recorder.summaries.length === 0}
            >
              ↓ Export all summaries ({recorder.summaries.length})
            </button>

            <button
              className="btn btn-rec-clear"
              onClick={handleClear}
              disabled={
                recorder.summaries.length === 0 || recorder.status.isRecording
              }
            >
              ✕ Clear summaries
            </button>
          </div>

          {recorder.status.isRecording && (
            <div className="recorder-live">
              <span>
                Recording trial #
                {String(recorder.status.trialIdx).padStart(3, '0')}
              </span>
              <span>{recorder.status.elapsedSec.toFixed(1)}s</span>
              <span>{recorder.status.frameCount} frames</span>
            </div>
          )}

          {!recorder.status.isRecording && recorder.status.lastSummary && (
            <PostTrialSummary
              summary={recorder.status.lastSummary}
              frames={recorder.status.lastFrames}
              unit={unitFor(recorder.status.lastSummary.mode)}
            />
          )}
        </div>
      )}

      <CaptureMismatchModal
        open={recorder.pendingTrial !== null}
        rates={
          recorder.pendingTrial?.captureRates ?? {
            totalFrames: 0,
            leftCaptured: 0,
            rightCaptured: 0,
            leftPct: 0,
            rightPct: 0,
          }
        }
        declaredArm={recorder.pendingTrial?.summary.arm ?? ''}
        reason={recorder.pendingTrial?.mismatchReason ?? ''}
        onChoose={recorder.commitPendingTrial}
        onDiscard={recorder.discardPendingTrial}
      />
    </section>
  );
};

// Memoised: parent App re-renders ~30×/s while tracking is live, but this
// component's props are all stable, so memo skips re-render except when
// activeMode / cameraIsRunning / exercise actually change.
export const TrialRecorder = React.memo(TrialRecorderImpl);

const PostTrialSummary: React.FC<{
  summary: TrialSummary;
  frames: readonly EnrichedFrameRow[] | null;
  unit: string;
}> = ({ summary, frames, unit }) => {
  const totalAnomaly =
    (summary.n_anomaly_frames_left ?? 0) + (summary.n_anomaly_frames_right ?? 0);
  const validity: Validity = summary.validity ?? 'valid';
  return (
    <div className="recorder-result">
      <div className="recorder-result-header">
        <span>
          Saved trial #{String(summary.trial_idx).padStart(3, '0')} —{' '}
          {summary.exercise_label}
        </span>
        <code className="recorder-filename">{summary.filename}</code>
      </div>

      {frames && frames.length > 0 && (
        <TrialPlot mode={summary.mode} frames={frames} height={180} />
      )}

      <dl className={`recorder-plot-stats validity-${validity}`}>
        <div>
          <dt>Min</dt>
          <dd>
            {fmt(summary.left_filt_min, unit)} / {fmt(summary.right_filt_min, unit)}
          </dd>
        </div>
        <div>
          <dt>Max</dt>
          <dd>
            {fmt(summary.left_filt_max, unit)} / {fmt(summary.right_filt_max, unit)}
          </dd>
        </div>
        <div>
          <dt>ROM</dt>
          <dd>
            {fmt(summary.left_filt_rom, unit)} / {fmt(summary.right_filt_rom, unit)}
          </dd>
        </div>
        <div>
          <dt>Std</dt>
          <dd>
            {fmt(summary.left_filt_std, unit, 2)} /{' '}
            {fmt(summary.right_filt_std, unit, 2)}
          </dd>
        </div>
        <div>
          <dt>FPS</dt>
          <dd>
            {fmtNum(summary.fps_mean, 1)} (min {fmtNum(summary.fps_min, 1)}, max{' '}
            {fmtNum(summary.fps_max, 1)})
          </dd>
        </div>
        <div>
          <dt>Validity</dt>
          <dd>
            <span className={`validity-pill validity-pill-${validity}`}>
              {VALIDITY_LABEL[validity]}
            </span>
          </dd>
        </div>
        <div>
          <dt>Anomalies</dt>
          <dd>
            {totalAnomaly} (L {summary.n_anomaly_frames_left ?? 0} / R{' '}
            {summary.n_anomaly_frames_right ?? 0})
          </dd>
        </div>
        <div>
          <dt>Dropped</dt>
          <dd>{summary.n_dropped_frames ?? 0} frames</dd>
        </div>
      </dl>

      <div className="recorder-result-grid">
        <ResultSide label="Left" unit={unit} side="left" summary={summary} />
        <ResultSide label="Right" unit={unit} side="right" summary={summary} />
      </div>
      <div className="recorder-result-meta">
        duration {summary.duration_s.toFixed(2)}s · {summary.n_frames} frames
      </div>
    </div>
  );
};

const ResultSide: React.FC<{
  label: string;
  unit: string;
  side: 'left' | 'right';
  summary: TrialSummary;
}> = ({ label, unit, side, summary }) => {
  const pick = (
    suffix:
      | 'raw_min'
      | 'raw_max'
      | 'raw_rom'
      | 'raw_peak'
      | 'raw_peak_clean'
      | 'filt_min'
      | 'filt_max'
      | 'filt_rom'
      | 'filt_std'
      | 'low_visibility_pct'
  ): number | null => {
    const k = `${side}_${suffix}` as keyof TrialSummary;
    const v = summary[k];
    return typeof v === 'number' ? v : null;
  };
  return (
    <div className="recorder-result-side">
      <div className="recorder-result-side-title">{label}</div>
      <dl>
        <dt>filt min</dt>
        <dd>{fmt(pick('filt_min'), unit)}</dd>
        <dt>filt max</dt>
        <dd>{fmt(pick('filt_max'), unit)}</dd>
        <dt>filt ROM</dt>
        <dd>{fmt(pick('filt_rom'), unit)}</dd>
        <dt>filt std</dt>
        <dd>{fmt(pick('filt_std'), unit, 2)}</dd>
        <dt>raw peak</dt>
        <dd>{fmt(pick('raw_peak'), unit)}</dd>
        <dt>raw peak (clean)</dt>
        <dd>{fmt(pick('raw_peak_clean'), unit)}</dd>
        <dt>low-vis %</dt>
        <dd>{fmtPct(pick('low_visibility_pct'))}</dd>
      </dl>
    </div>
  );
};
