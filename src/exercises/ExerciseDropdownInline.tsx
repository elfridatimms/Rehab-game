import React from 'react';
import type { GameMode } from '../types';
import { getExercisesByMode } from './exerciseRegistry';
import type { Exercise } from './exerciseTypes';

interface Props {
  mode: GameMode;
  selectedId: string | null;
  onChange: (ex: Exercise) => void;
  disabled?: boolean;
}

/** Compact in-panel exercise picker. Lives at the top of each mode panel
 *  per the v1.3 spec; mirrors the wider ExerciseSideMenu in the right rail
 *  (both write to the same App-level state). */
export const ExerciseDropdownInline: React.FC<Props> = ({
  mode,
  selectedId,
  onChange,
  disabled = false,
}) => {
  const exercises = getExercisesByMode(mode);
  const selected = exercises.find((x) => x.id === selectedId) ?? null;
  return (
    <div className="exercise-dropdown-inline">
      <label className="exercise-dropdown-label" htmlFor={`exercise-${mode}`}>
        Exercise
      </label>
      <select
        id={`exercise-${mode}`}
        className="exercise-dropdown-select"
        value={selectedId ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const ex = exercises.find((x) => x.id === e.target.value);
          if (ex) onChange(ex);
        }}
      >
        {exercises.map((ex) => (
          <option key={ex.id} value={ex.id}>
            {ex.nameEn}
          </option>
        ))}
      </select>
      {selected?.targetROM && (
        <div className="exercise-target-rom">
          <span className="exercise-target-rom-label">Target ROM:</span>{' '}
          <span className="exercise-target-rom-value">{selected.targetROM}</span>
        </div>
      )}
    </div>
  );
};
