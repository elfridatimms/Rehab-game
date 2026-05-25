import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameMode } from './types';
import {
  getDefaultExerciseForMode,
  getExerciseById,
} from './exercises/exerciseRegistry';
import type { Exercise } from './exercises/exerciseTypes';
import { useTracking, type FrameListener } from './tracking/useTracking';
import { ModeSelector } from './ui/ModeSelector';
import { CameraView } from './game/CameraView';
import { unlockAudio } from './game/effects/SoundManager';
import { TrialRecorder, type TrialRecorderHandle } from './recording/TrialRecorder';
import { useTrialRecorder } from './recording/useTrialRecorder';
import { ExerciseSideMenu } from './recording/ExerciseSideMenu';
import { useCameras } from './hooks/useCameras';
import './App.css';

// ─── localStorage keys for preferred exercise per mode ──────
const PREF_EXERCISE_KEY: Record<GameMode, string> = {
  elbow: 'preferred_exercise_elbow',
  wrist: 'preferred_exercise_wrist',
  fingers: 'preferred_exercise_fingers',
};

function readPreferredExercise(mode: GameMode): string | null {
  return localStorage.getItem(PREF_EXERCISE_KEY[mode]);
}

function writePreferredExercise(mode: GameMode, id: string): void {
  localStorage.setItem(PREF_EXERCISE_KEY[mode], id);
}

export default function App() {
  const [activeMode, setActiveMode] = useState<GameMode>('elbow');

  const [selectedExerciseByMode, setSelectedExerciseByMode] = useState<
    Record<GameMode, string | null>
  >(() => ({
    elbow: readPreferredExercise('elbow'),
    wrist: readPreferredExercise('wrist'),
    fingers: readPreferredExercise('fingers'),
  }));

  const [isTrialRecording, setIsTrialRecording] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const frameListenerRef = useRef<FrameListener | null>(null);
  const recorderHandleRef = useRef<TrialRecorderHandle | null>(null);

  const {
    trackingStateRef,
    rawResultsRef,
    isRunning,
    isSwitching,
    startCamera,
    stopCamera,
  } = useTracking(activeMode, frameListenerRef);

  const recorder = useTrialRecorder(frameListenerRef);

  const { cameras, selectedId: cameraId, setSelectedId: setCameraId, refresh: refreshCameras } =
    useCameras();

  const exercise: Exercise | null = useMemo(() => {
    const id = selectedExerciseByMode[activeMode];
    if (id) {
      const match = getExerciseById(id);
      if (match && match.mode === activeMode) return match;
    }
    return getDefaultExerciseForMode(activeMode);
  }, [activeMode, selectedExerciseByMode]);

  useEffect(() => {
    recorder.setActiveExercise(exercise);
  }, [exercise, recorder]);

  const handleExercisePick = useCallback((ex: Exercise) => {
    setSelectedExerciseByMode((prev) => ({ ...prev, [ex.mode]: ex.id }));
    writePreferredExercise(ex.mode, ex.id);
  }, []);

  const handleStart = useCallback(async () => {
    unlockAudio();
    if (videoRef.current) {
      await startCamera(videoRef.current, cameraId ?? undefined);
      void refreshCameras();
    }
  }, [startCamera, cameraId, refreshCameras]);

  const handleStop = useCallback(() => {
    recorderHandleRef.current?.stopIfRecording();
    stopCamera();
  }, [stopCamera]);

  const handleCameraChange = useCallback(
    async (nextId: string | null) => {
      setCameraId(nextId);
      if (isRunning && videoRef.current) {
        recorderHandleRef.current?.stopIfRecording();
        await startCamera(videoRef.current, nextId ?? undefined);
      }
    },
    [setCameraId, isRunning, startCamera],
  );

  // Mode-switch: auto-stop any active trial (mode/exercise is fixed at trial
  // start; switching mid-trial would mix frames).
  const handleModeChange = useCallback((next: GameMode) => {
    recorderHandleRef.current?.stopIfRecording();
    setActiveMode(next);
  }, []);

  useEffect(() => {
    const onBeforeUnload = () => recorderHandleRef.current?.stopIfRecording();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <div className="app app--minimal">
      <header className="app-header">
        <div className="logo">
          <h1>Rehab Tracker</h1>
        </div>
        <div className="header-controls">
          {cameras.length > 0 && (
            <select
              className="camera-select"
              value={cameraId ?? ''}
              onChange={(e) => void handleCameraChange(e.target.value || null)}
              title="Choose camera"
              aria-label="Camera"
            >
              <option value="">Default camera</option>
              {cameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
          {isSwitching && (
            <span className="model-switch-indicator">loading model…</span>
          )}
          {!isRunning ? (
            <button className="btn btn-start" onClick={handleStart}>
              Start camera
            </button>
          ) : (
            <button className="btn btn-stop" onClick={handleStop}>
              Stop
            </button>
          )}
        </div>
      </header>

      {/* Step 1: pick the joint. */}
      <div className="joint-strip">
        <span className="joint-strip-label">Joint</span>
        <ModeSelector
          activeMode={activeMode}
          onModeChange={handleModeChange}
        />
      </div>

      <div className="app-workspace">
        {/* Step 4: record (in the right rail, alongside step 2 + 3). */}
        <main className="center-column">
          <div className="camera-stage">
            <CameraView
              videoRef={videoRef}
              rawResultsRef={rawResultsRef}
              trackingStateRef={trackingStateRef}
              activeMode={activeMode}
              isRunning={isRunning}
            />
          </div>
        </main>

        <aside className="side-rail side-rail--right" aria-label="Exercise and recording">
          {/* Step 2: pick the exercise (filtered by the active joint). */}
          {/* Step 3: read the on-screen instructions (rendered inside the
              menu so reading and picking sit next to each other). */}
          <ExerciseSideMenu
            mode={activeMode}
            selectedId={exercise?.id ?? null}
            onChange={handleExercisePick}
            disabled={isTrialRecording}
          />
          <TrialRecorder
            activeMode={activeMode}
            cameraIsRunning={isRunning}
            recorder={recorder}
            handleRef={recorderHandleRef}
            exercise={exercise}
            onRecordingChange={setIsTrialRecording}
          />
        </aside>
      </div>
    </div>
  );
}
