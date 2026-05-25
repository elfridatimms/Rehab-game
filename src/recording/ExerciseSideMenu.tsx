import React from 'react';
import type { GameMode } from '../types';
import { getExercisesByMode } from '../exercises/exerciseRegistry';
import type { Exercise } from '../exercises/exerciseTypes';
import { ExerciseInstructions } from '../exercises/ExerciseInstructions';

interface ExerciseSideMenuProps {
  mode: GameMode;
  selectedId: string | null;
  onChange: (exercise: Exercise) => void;
  disabled?: boolean;
}

/** v1.10: this is now the SINGLE place where the user picks an exercise
 *  and reads its instructions. The mode-panel inline picker + instructions
 *  block were removed to eliminate duplication. */
const ExerciseSideMenuImpl: React.FC<ExerciseSideMenuProps> = ({
  mode,
  selectedId,
  onChange,
  disabled = false,
}) => {
  const exercises = getExercisesByMode(mode);
  const selected = exercises.find((e) => e.id === selectedId) ?? exercises[0] ?? null;

  return (
    <nav className="exercise-side-menu" aria-label="Choose exercise">
      <ul className="exercise-side-menu-list">
        {exercises.map((ex) => {
          const isActive = selected?.id === ex.id;
          return (
            <li key={ex.id}>
              <button
                type="button"
                className={`exercise-side-item ${isActive ? 'is-active' : ''}`}
                disabled={disabled}
                onClick={() => onChange(ex)}
              >
                <span className="exercise-side-item-label">{ex.nameEn}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {/* Full instructions (camera setup + movement + visibility +
          target ROM) for the selected exercise. */}
      {selected && <ExerciseInstructions exercise={selected} />}
    </nav>
  );
};

// Memoised: only re-renders when mode/selectedId/disabled/onChange change,
// not on per-frame tracking updates from the parent.
export const ExerciseSideMenu = React.memo(ExerciseSideMenuImpl);
