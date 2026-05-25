import type { GameMode } from '../types';
import type { Exercise } from '../exercises/exerciseTypes';
import type { DetectorId } from '../detectors/detectorTypes';
import {
  ARM_LABELS,
  BACKGROUND_LABELS,
  CAMERA_ANGLE_LABELS,
  LIGHTING_LABELS,
  OCCLUSION_LABELS,
  SPEED_LABELS,
  type EnrichedFrameRow,
  type TrialMetadata,
  type TrialSummary,
} from './types';

// ─── CSV primitives ──────────────────────────────────────────
/** RFC-4180-style escape: wrap in quotes if the value contains comma/quote/newline. */
function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function fmtNum(n: number | null, digits = 3): string {
  if (n === null || !Number.isFinite(n)) return '';
  return n.toFixed(digits);
}

function fmtCell(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    // Integers stay clean; floats trimmed to 3 decimals.
    return Number.isInteger(v) ? String(v) : v.toFixed(3);
  }
  return csvEscape(v);
}

function rowsToCsv(header: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
  const lines = [header.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(row.map(fmtCell).join(','));
  }
  return lines.join('\n');
}

// ─── Filenames / timestamps ──────────────────────────────────
export function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function buildFrameCsvFilename(
  trialIdx: number,
  mode: GameMode,
  exerciseId: string,
  subjectId: string,
  date: Date
): string {
  const idx = String(trialIdx).padStart(3, '0');
  const ts = formatTimestamp(date);
  const safeSubject = subjectId.replace(/[^A-Za-z0-9_-]/g, '_');
  return `trial_${idx}_${mode}_${exerciseId}_${safeSubject}_${ts}.csv`;
}

// ─── Per-frame CSV ───────────────────────────────────────────
// Base columns (always present). v1.3 detector columns are appended after
// these on a per-trial basis based on the exercise's active detectors.
const FRAME_HEADER_BASE = [
  'frame_idx',
  'timestamp_ms',
  'active_side',
  'left_raw',
  'left_filtered',
  'left_visibility',
  'left_frame_status',
  'left_anomaly_flag',
  'right_raw',
  'right_filtered',
  'right_visibility',
  'right_frame_status',
  'right_anomaly_flag',
] as const;

function metadataCommentLines(
  exercise: Exercise,
  meta: TrialMetadata
): string[] {
  const notes = meta.notes.trim() || '(none)';
  return [
    `# exercise: ${exercise.nameEn} (suitability=${exercise.expectedSuitability})`,
    `# arm=${ARM_LABELS[meta.arm]}; distance=${meta.distanceCm}cm; ` +
      `angle=${CAMERA_ANGLE_LABELS[meta.cameraAngle]}; ` +
      `lighting=${LIGHTING_LABELS[meta.lighting]}; ` +
      `occlusion=${OCCLUSION_LABELS[meta.occlusion]}; ` +
      `background=${BACKGROUND_LABELS[meta.background]}; ` +
      `speed=${SPEED_LABELS[meta.speed]}; ` +
      `notes=${notes}`,
  ];
}

/** Per-frame detector triple plus the trial-wide `failure_detectors_active`
 *  column. Headers are trial-dependent: each trial's CSV carries exactly
 *  the columns matching its exercise's active detectors. YES exercises
 *  emit only the `failure_detectors_active` column (with an empty value)
 *  and no detector triples. */
function buildDetectorHeader(activeDetectors: readonly DetectorId[]): string[] {
  const out: string[] = ['failure_detectors_active'];
  for (const id of activeDetectors) {
    out.push(
      `detector_${id}_detected`,
      `detector_${id}_confidence`,
      `detector_${id}_evidence_json`
    );
  }
  return out;
}

function buildDetectorRow(
  f: EnrichedFrameRow,
  activeDetectors: readonly DetectorId[]
): (string | number | null)[] {
  // `failure_detectors_active` is the same on every row of a trial but we
  // emit it per-row for the simplest possible downstream parsing.
  const out: (string | number | null)[] = [activeDetectors.join(',')];
  for (const id of activeDetectors) {
    const o = f.detector_outputs?.[id];
    if (!o) {
      out.push('', '', '');
      continue;
    }
    out.push(
      o.detected ? 1 : 0,
      Number(o.confidence.toFixed(3)),
      JSON.stringify(o.evidence)
    );
  }
  return out;
}

export function buildFrameCsv(
  exercise: Exercise,
  meta: TrialMetadata,
  frames: readonly EnrichedFrameRow[]
): string {
  const commentLines = metadataCommentLines(exercise, meta);
  const header = [...FRAME_HEADER_BASE, ...buildDetectorHeader(exercise.activeDetectors)];
  const rows = frames.map((f) => [
    f.frame_idx,
    f.timestamp_ms,
    f.active_side ?? '',
    fmtNum(f.left_raw),
    fmtNum(f.left_filtered),
    fmtNum(f.left_visibility),
    f.left_frame_status,
    f.left_anomaly_flag,
    fmtNum(f.right_raw),
    fmtNum(f.right_filtered),
    fmtNum(f.right_visibility),
    f.right_frame_status,
    f.right_anomaly_flag,
    ...buildDetectorRow(f, exercise.activeDetectors),
  ]);
  const body = rowsToCsv(header, rows);
  return `${commentLines.join('\n')}\n${body}\n`;
}

// ─── Summary CSV ─────────────────────────────────────────────
const SUMMARY_HEADER = [
  'trial_idx',
  'timestamp_iso',
  'trial_start_iso',
  'subject_id',
  'mode',
  'exercise_id',
  'exercise_label',
  'suitability',
  'arm',
  'distance_cm',
  'camera_angle',
  'lighting',
  'occlusion',
  'background',
  'speed',
  'notes',
  'duration_s',
  'n_frames',
  'fps_mean',
  'fps_min',
  'fps_max',
  'n_dropped_frames',
  'left_raw_min',
  'left_raw_max',
  'left_raw_rom',
  'left_raw_peak',
  'left_raw_peak_clean',
  'left_filt_min',
  'left_filt_max',
  'left_filt_rom',
  'left_filt_std',
  'left_low_visibility_pct',
  'n_anomaly_frames_left',
  'right_raw_min',
  'right_raw_max',
  'right_raw_rom',
  'right_raw_peak',
  'right_raw_peak_clean',
  'right_filt_min',
  'right_filt_max',
  'right_filt_rom',
  'right_filt_std',
  'right_low_visibility_pct',
  'n_anomaly_frames_right',
  'validity',
  'filename',
  // v1.3 additive columns (do NOT reorder anything above).
  'exercise_suitability',
  'detectors_active',
  'detector_summary_json',
  'camera_label',
  'app_version',
  'view_orientation',
  'target_rom',
] as const;

function summaryToRow(s: TrialSummary): readonly (string | number | null)[] {
  return [
    s.trial_idx,
    s.timestamp_iso,
    s.trial_start_iso,
    s.subject_id,
    s.mode,
    s.exercise_id,
    s.exercise_label,
    s.suitability,
    s.arm,
    s.distance_cm,
    s.camera_angle,
    s.lighting,
    s.occlusion,
    s.background,
    s.speed,
    s.notes,
    s.duration_s,
    s.n_frames,
    s.fps_mean,
    s.fps_min,
    s.fps_max,
    s.n_dropped_frames,
    s.left_raw_min,
    s.left_raw_max,
    s.left_raw_rom,
    s.left_raw_peak,
    s.left_raw_peak_clean,
    s.left_filt_min,
    s.left_filt_max,
    s.left_filt_rom,
    s.left_filt_std,
    s.left_low_visibility_pct,
    s.n_anomaly_frames_left,
    s.right_raw_min,
    s.right_raw_max,
    s.right_raw_rom,
    s.right_raw_peak,
    s.right_raw_peak_clean,
    s.right_filt_min,
    s.right_filt_max,
    s.right_filt_rom,
    s.right_filt_std,
    s.right_low_visibility_pct,
    s.n_anomaly_frames_right,
    s.validity,
    s.filename,
    s.exercise_suitability,
    s.detectors_active,
    s.detector_summary_json,
    s.camera_label,
    s.app_version,
    s.view_orientation,
    s.target_rom,
  ];
}

export function buildSummaryCsv(summaries: readonly TrialSummary[]): string {
  const rows = summaries.map(summaryToRow);
  return rowsToCsv(SUMMARY_HEADER, rows) + '\n';
}

// ─── Download trigger ────────────────────────────────────────
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Small delay before revoke so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
