#!/usr/bin/env -S npx tsx
/* eslint-disable no-console */
/**
 * Generator for docs/EXERCISE_LOGIC.md.
 *
 * Pulls live data from src/exercises/exerciseRegistry.ts, and parses @-tag
 * blocks out of the TSDoc comments in src/detectors/ and src/tracking/.
 * Intentionally uses regex (not a TypeScript AST) — the input is small,
 * the @tag grammar is rigid, and we want zero runtime deps beyond what
 * tsx already ships.
 *
 * Run:   npx tsx scripts/generateExerciseDocs.ts
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXERCISES } from '../src/exercises/exerciseRegistry';
import type { DetectorId } from '../src/detectors/detectorTypes';
import type { GameMode } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// ─── Tag parsing ─────────────────────────────────────────────
const REQUIRED_DETECTOR_TAGS = [
  '@detector',
  '@purpose',
  '@triggers',
  '@inputs',
  '@thresholds',
  '@evidence',
  '@limitations',
  '@stateful',
] as const;

const REQUIRED_TRACKER_TAGS = [
  '@tracker',
  '@measures',
  '@inputs',
  '@formula',
  '@range',
  '@smoothing',
  '@failsafes',
  '@limitations',
] as const;

type ParsedTags = Record<string, string>;

/** Find the first TSDoc block containing the given @tag and return a
 *  flat map of all @tag → text inside it. Stops at the next @tag or the
 *  end of the block. */
function parseTsDocBlock(source: string, anchorTag: string): ParsedTags | null {
  // Match /** ... */ blocks containing the anchor tag.
  const blockRe = /\/\*\*([\s\S]*?)\*\//g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(source)) !== null) {
    const body = match[1];
    if (!body.includes(anchorTag)) continue;
    return extractTags(body);
  }
  return null;
}

/** Given the inside of a TSDoc block, return a map of tag → text. */
function extractTags(body: string): ParsedTags {
  // Strip leading "*" off each line.
  const lines = body
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').replace(/\s+$/, ''));

  const out: ParsedTags = {};
  let currentTag: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (currentTag !== null) {
      out[currentTag] = buf.join('\n').trim();
    }
    buf = [];
  };

  for (const line of lines) {
    const tagMatch = line.match(/^(@[A-Za-z][A-Za-z0-9_]*)\s*(.*)$/);
    if (tagMatch) {
      flush();
      currentTag = tagMatch[1];
      if (tagMatch[2]) buf.push(tagMatch[2]);
    } else if (currentTag) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

function ensureTags(
  parsed: ParsedTags | null,
  required: readonly string[],
  context: string
): ParsedTags {
  if (!parsed) {
    throw new Error(`Missing TSDoc block for ${context}`);
  }
  const missing = required.filter((t) => !(t in parsed));
  if (missing.length > 0) {
    throw new Error(
      `${context}: missing required TSDoc tag(s): ${missing.join(', ')}`
    );
  }
  return parsed;
}

// ─── Load detector TSDoc blocks ──────────────────────────────
/** Map detector id → parsed TSDoc tag map. */
function loadDetectorDocs(): Map<DetectorId, ParsedTags> {
  const dir = resolve(REPO_ROOT, 'src/detectors');
  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.ts') && f !== 'detectorTypes.ts'
  );
  const out = new Map<DetectorId, ParsedTags>();

  for (const file of files) {
    const src = readFileSync(resolve(dir, file), 'utf8');
    const parsed = parseTsDocBlock(src, '@detector');
    if (!parsed) {
      throw new Error(`No @detector TSDoc block in src/detectors/${file}`);
    }
    const id = parsed['@detector'].trim() as DetectorId;
    if (!id) {
      throw new Error(`Empty @detector id in src/detectors/${file}`);
    }
    ensureTags(parsed, REQUIRED_DETECTOR_TAGS, `detector ${id}`);
    out.set(id, parsed);
  }
  return out;
}

// ─── Structured @limitations parser ──────────────────────────
/** One bullet under @limitations, optionally with an applies-when scope. */
interface LimitationItem {
  bullet: string;
  appliesWhen: Set<string>; // exercise ids, or contains 'all'
}

/** Walk the body of a tracker TSDoc block, find the @limitations section,
 *  and return each bullet paired with its scope (the next
 *  @limitations-applies-when line). Bullets with no scope line default to
 *  an empty set — they will not appear under any exercise. */
function parseTrackerLimitations(body: string): LimitationItem[] {
  const rawLines = body.split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trimEnd());
  // Regex MUST accept hyphens so `@limitations-applies-when` is its own tag.
  const tagRe = /^(@[A-Za-z][A-Za-z0-9_-]*)\s*(.*)$/;

  let inLimitations = false;
  const items: LimitationItem[] = [];
  let current: LimitationItem | null = null;

  const finalize = () => {
    if (current) items.push(current);
    current = null;
  };

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;

    const tagMatch = line.match(tagRe);
    if (tagMatch) {
      const tag = tagMatch[1];
      const rest = tagMatch[2];

      if (tag === '@limitations') {
        finalize();
        inLimitations = true;
        continue;
      }
      if (tag === '@limitations-applies-when') {
        if (current) {
          for (const id of rest.split(',').map((s) => s.trim()).filter(Boolean)) {
            current.appliesWhen.add(id);
          }
        }
        continue;
      }
      // Any other tag closes the limitations section.
      if (inLimitations) {
        finalize();
        inLimitations = false;
      }
      continue;
    }

    if (!inLimitations) continue;

    if (line.startsWith('-')) {
      finalize();
      current = { bullet: line.replace(/^-\s*/, ''), appliesWhen: new Set() };
    } else if (current) {
      // Continuation of the prior bullet.
      current.bullet += ' ' + line;
    }
  }
  finalize();
  return items;
}

/** Same outer scan as parseTsDocBlock — return the raw body of the first
 *  block containing the anchor tag, so the structured parser can run on it. */
function findBlockBody(source: string, anchorTag: string): string | null {
  const blockRe = /\/\*\*([\s\S]*?)\*\//g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(source)) !== null) {
    if (match[1].includes(anchorTag)) return match[1];
  }
  return null;
}

// ─── Load tracker TSDoc blocks ───────────────────────────────
// Note: filenames are `<mode>Tracker.ts` in src/tracking/.
interface TrackerDoc {
  tags: ParsedTags;
  limitations: LimitationItem[];
}

function loadTrackerDocs(): Map<GameMode, TrackerDoc> {
  const dir = resolve(REPO_ROOT, 'src/tracking');
  const modes: GameMode[] = ['elbow', 'wrist', 'fingers'];
  const filenameForMode: Record<GameMode, string> = {
    elbow: 'elbowTracker.ts',
    wrist: 'wristTracker.ts',
    fingers: 'fingerTracker.ts',
  };
  const out = new Map<GameMode, TrackerDoc>();

  for (const mode of modes) {
    const src = readFileSync(resolve(dir, filenameForMode[mode]), 'utf8');
    const parsed = parseTsDocBlock(src, '@tracker');
    ensureTags(parsed, REQUIRED_TRACKER_TAGS, `tracker ${mode}`);
    const body = findBlockBody(src, '@tracker');
    if (!body) {
      throw new Error(`Could not re-read TSDoc body for tracker ${mode}`);
    }
    const limitations = parseTrackerLimitations(body);
    out.set(mode, { tags: parsed!, limitations });
  }
  return out;
}

// ─── Markdown helpers ────────────────────────────────────────
function header(): string {
  return `<!--
This file is AUTO-GENERATED by scripts/generateExerciseDocs.ts.
Do NOT edit by hand — every regenerate will overwrite your changes.

Sources of truth:
  - Exercise metadata:        src/exercises/exerciseRegistry.ts
  - Detector documentation:   TSDoc blocks in src/detectors/*.ts
  - Tracker documentation:    TSDoc blocks in src/tracking/*.ts

Regenerate:  npx tsx scripts/generateExerciseDocs.ts
-->

# Exercise logic — auto-generated reference

`;
}

function summaryTable(): string {
  const rows = EXERCISES.map((e, i) => {
    const detectors = e.activeDetectors.length === 0
      ? '—'
      : e.activeDetectors.join(', ');
    return `| ${i + 1} | \`${e.id}\` | ${e.mode} | ${e.expectedSuitability} | ${detectors} |`;
  }).join('\n');
  return [
    '| # | Exercise | Mode | Suitability | Active detectors |',
    '|---|---|---|---|---|',
    rows,
    '',
  ].join('\n');
}

/** Merge bullet continuations (lines that don't start with `-`) into the
 *  preceding bullet, then dedupe. TSDoc bullets in this repo are written
 *  with the leading `-` on the first line and indented continuation lines
 *  beneath; those continuations belong to the same bullet. */
function dedupeBullets(input: string): string[] {
  const bullets: string[] = [];
  for (const raw of input.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[-•*]\s/.test(line)) {
      bullets.push(line.replace(/^[-•*]\s+/, ''));
    } else if (bullets.length > 0) {
      bullets[bullets.length - 1] += ' ' + line;
    } else {
      // Non-bullet leading text (rare); treat as its own bullet.
      bullets.push(line);
    }
  }
  // Dedupe whole bullets.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of bullets) {
    if (!seen.has(b)) {
      seen.add(b);
      out.push(b);
    }
  }
  return out;
}

// ─── Build one exercise section ──────────────────────────────
function buildExerciseSection(
  ex: typeof EXERCISES[number],
  trackerDocs: Map<GameMode, TrackerDoc>,
  detectorDocs: Map<DetectorId, ParsedTags>
): string {
  const trackerDoc = trackerDocs.get(ex.mode)!;
  const tracker = trackerDoc.tags;
  const lines: string[] = [];

  lines.push(`## \`${ex.id}\` — ${ex.nameEn}`);
  lines.push('');
  lines.push(`**Suitability:** ${ex.expectedSuitability}  `);
  lines.push(`**Mode:** ${ex.mode}  `);
  lines.push(`**Camera setup:** ${ex.cameraSetupEn}  `);
  lines.push(`**Visibility:** ${ex.visibilityEn}  `);
  const meta: string[] = [];
  meta.push(`**Hold:** ${ex.holdSeconds ?? '—'}`);
  meta.push(`**Reps:** ${ex.repetitions ?? '—'}`);
  meta.push(`**Joint constraints:** ${ex.jointConstraints}`);
  lines.push(meta.join(' · '));
  lines.push('');

  // FIX 1: NO exercises that have detectors get a re-titled section with a
  // callout — the tracker still runs but its output is not the clinical
  // signal of interest. YES, PARTIAL, and NO-without-detectors keep the
  // plain heading.
  const trackerIsIncidental =
    ex.expectedSuitability === 'NO' && ex.activeDetectors.length > 0;

  if (trackerIsIncidental) {
    lines.push('### Primary measurement (not the clinically relevant signal)');
    lines.push('');
    lines.push(
      `> The ${ex.mode} tracker runs in this mode but its output is not directly meaningful for this exercise — see the active failure detector(s) below for the actual phenomenon being observed.`
    );
    lines.push('');
  } else {
    lines.push('### Primary measurement');
    lines.push('');
  }
  lines.push(`**Measures:** ${tracker['@measures']}`);
  lines.push('');
  lines.push(`**Range:** ${tracker['@range']}`);
  lines.push('');
  lines.push('**Formula:**');
  lines.push('');
  lines.push('```');
  lines.push(tracker['@formula']);
  lines.push('```');
  lines.push('');

  // Active detectors
  lines.push('### Active failure detectors');
  lines.push('');
  if (ex.activeDetectors.length === 0) {
    lines.push(
      '_None — exercise is fully suitable; no failure detection runs in parallel._'
    );
    lines.push('');
  } else {
    for (const id of ex.activeDetectors) {
      const d = detectorDocs.get(id);
      if (!d) {
        throw new Error(
          `Exercise ${ex.id} references detector ${id} that has no TSDoc block`
        );
      }
      lines.push(`#### ${id}`);
      lines.push('');
      lines.push(`**Purpose:** ${d['@purpose']}`);
      lines.push('');
      lines.push('**Triggers when:**');
      lines.push('');
      lines.push(d['@triggers']);
      lines.push('');
      lines.push('**Thresholds:**');
      lines.push('');
      lines.push(d['@thresholds']);
      lines.push('');
      lines.push('**Evidence keys:**');
      lines.push('');
      lines.push(d['@evidence']);
      lines.push('');
    }
  }

  // Rationale
  lines.push('### Rationale');
  lines.push('');
  lines.push(ex.rationale);
  lines.push('');

  // FIX 3: filter tracker limitations by exercise scope. A tracker bullet
  // is included only if its @limitations-applies-when contains the
  // exercise id or the literal 'all'. Detector limitations are always
  // included (each detector is scoped by being assigned to an exercise).
  const scopedTrackerBullets = trackerDoc.limitations
    .filter((item) => item.appliesWhen.has('all') || item.appliesWhen.has(ex.id))
    .map((item) => item.bullet);

  const detectorBulletText: string[] = [];
  for (const id of ex.activeDetectors) {
    const d = detectorDocs.get(id);
    if (d) detectorBulletText.push(d['@limitations']);
  }
  // Detector text still passes through dedupeBullets to merge multiline
  // bullets and dedupe across detectors. Then concat with tracker bullets
  // and dedupe once more so identical phrasing across sources collapses.
  const detectorBullets = dedupeBullets(detectorBulletText.join('\n'));

  const seen = new Set<string>();
  const finalBullets: string[] = [];
  for (const b of [...scopedTrackerBullets, ...detectorBullets]) {
    if (!seen.has(b)) {
      seen.add(b);
      finalBullets.push(b);
    }
  }

  lines.push('### Known limitations');
  lines.push('');
  if (finalBullets.length === 0) {
    lines.push('_(none recorded)_');
  } else {
    for (const l of finalBullets) {
      lines.push(`- ${l}`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────
function main(): void {
  let trackerDocs: Map<GameMode, TrackerDoc>;
  let detectorDocs: Map<DetectorId, ParsedTags>;
  try {
    trackerDocs = loadTrackerDocs();
    detectorDocs = loadDetectorDocs();
  } catch (err) {
    console.error('[generateExerciseDocs] FATAL:', (err as Error).message);
    process.exit(1);
  }

  const parts: string[] = [header(), summaryTable()];
  for (const ex of EXERCISES) {
    parts.push(buildExerciseSection(ex, trackerDocs, detectorDocs));
  }
  const outPath = resolve(REPO_ROOT, 'docs/EXERCISE_LOGIC.md');
  writeFileSync(outPath, parts.join('\n'), 'utf8');
  console.log(
    `[generateExerciseDocs] Wrote ${EXERCISES.length} exercises to ${outPath}`
  );
}

main();
