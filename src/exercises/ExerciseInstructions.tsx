import React, { useState } from 'react';
import type { Exercise } from './exerciseTypes';

interface Props {
  exercise: Exercise;
}

const SECTION_LABELS = {
  en: { setup: 'Camera setup', visibility: 'Visibility' },
  hr: { setup: 'Postava kamere', visibility: 'Uvjeti vidljivosti' },
} as const;

/** Instruction display with an EN/HR toggle. Compact, fits inside a mode
 *  panel. Suitability badge is colour-coded green/yellow/red.
 *
 *  v1.4: surfaces three distinct sections — `cameraSetup` (positioning),
 *  the existing `instructions` (the movement), and `visibility` (what
 *  must stay in frame + expected occlusions). Camera-setup and visibility
 *  are rendered with a muted style to keep visual emphasis on the movement
 *  instructions, which are the user's primary read. */
export const ExerciseInstructions: React.FC<Props> = ({ exercise }) => {
  const [lang, setLang] = useState<'en' | 'hr'>('en');
  const labels = SECTION_LABELS[lang];
  const text = lang === 'en' ? exercise.instructionsEn : exercise.instructionsHr;
  const setup = lang === 'en' ? exercise.cameraSetupEn : exercise.cameraSetupHr;
  const visibility = lang === 'en' ? exercise.visibilityEn : exercise.visibilityHr;
  const name = lang === 'en' ? exercise.nameEn : exercise.nameHr;

  // v1.10: suitability badge removed from the UI — research-only field
  // kept in the registry for detector wiring but no longer surfaced to the
  // user (it was distracting during testing).

  return (
    <div className="exercise-instructions">
      <div className="exercise-instructions-row">
        <h3 className="exercise-instructions-name">{name}</h3>
        <button
          type="button"
          className="exercise-lang-toggle"
          onClick={() => setLang((l) => (l === 'en' ? 'hr' : 'en'))}
          aria-label="Toggle language"
        >
          {lang === 'en' ? 'HR' : 'EN'}
        </button>
      </div>

      <div className="exercise-section exercise-section--muted">
        <span className="exercise-section-label">{labels.setup}</span>
        <p className="exercise-section-text">{setup}</p>
      </div>

      <p className="exercise-instructions-text">{text}</p>

      <div className="exercise-section exercise-section--muted">
        <span className="exercise-section-label">{labels.visibility}</span>
        <p className="exercise-section-text">{visibility}</p>
      </div>

      <dl className="exercise-instructions-meta">
        {exercise.targetROM && (
          <>
            <dt>Target ROM</dt>
            <dd className="exercise-instructions-target-rom">{exercise.targetROM}</dd>
          </>
        )}
        <dt>Joint constraint</dt>
        <dd>{exercise.jointConstraints}</dd>
        {exercise.holdSeconds && (
          <>
            <dt>Hold</dt>
            {/* Values self-describe (e.g. "1-2 s at peak", "—"); no
                suffix appended. */}
            <dd>{exercise.holdSeconds}</dd>
          </>
        )}
        {exercise.repetitions && (
          <>
            <dt>Reps</dt>
            <dd>{exercise.repetitions}</dd>
          </>
        )}
      </dl>
    </div>
  );
};
