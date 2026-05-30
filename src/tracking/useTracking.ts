import { useRef, useCallback, useState, useEffect } from 'react';
import type { TrackingState, GameMode, HolisticResults, Landmark } from '../types';
import { createElbowState, updateElbow, updateForearmRotation } from './elbowTracker';
import { createHandState, updateWristExtension } from './wristTracker';
import { updateFingerOpenness } from './fingerTracker';

/** Per-frame listener invoked after trackers update. Used by the research
 *  recorder; passed as a ref so the listener can change without re-creating
 *  the camera pipeline. */
export type FrameListener = (
  mode: GameMode,
  state: TrackingState,
  results: HolisticResults,
  timestamp_ms: number
) => void;
export type FrameListenerRef = React.RefObject<FrameListener | null>;

// ─── Result shape adapters ───────────────────────────────────
//
// We standardise on the HolisticResults shape internally so trackers,
// detectors, and overlays don't need to know which model produced the
// frame. Pose contributes `poseLandmarks`. Hands contributes
// `leftHandLandmarks` / `rightHandLandmarks` mapped from
// `multiHandLandmarks` via the per-hand handedness label.

interface RawPoseResults {
  poseLandmarks?: Landmark[];
  poseWorldLandmarks?: Landmark[];
}

interface RawHandsResults {
  multiHandLandmarks?: Landmark[][];
  multiHandedness?: { label: string; score: number; index: number }[];
}

function adaptPoseResults(r: RawPoseResults): HolisticResults {
  return {
    poseLandmarks: r.poseLandmarks,
    poseWorldLandmarks: r.poseWorldLandmarks,
  };
}

function adaptHandsResults(r: RawHandsResults): HolisticResults {
  const out: HolisticResults = {};
  const lms = r.multiHandLandmarks ?? [];
  const hands = r.multiHandedness ?? [];
  for (let i = 0; i < lms.length; i++) {
    // MediaPipe labels hands from the SUBJECT's perspective (not the
    // mirrored view the user sees). Since we send the raw unmirrored
    // video, "Left" = subject's left hand.
    const label = hands[i]?.label;
    if (label === 'Left') {
      out.leftHandLandmarks = lms[i];
    } else if (label === 'Right') {
      out.rightHandLandmarks = lms[i];
    }
  }
  // Expose handedness scores via a side-channel so detectors can use
  // real model confidence instead of the landmark-completeness proxy.
  out.handednessLeft = hands.find((h) => h.label === 'Left')?.score ?? null;
  out.handednessRight = hands.find((h) => h.label === 'Right')?.score ?? null;
  return out;
}

// ─── MediaPipe globals ───────────────────────────────────────
declare global {
  interface Window {
    Pose: any;
    Hands: any;
    // From @mediapipe/drawing_utils — used by overlay code so it matches
    // the look of MediaPipe's own demo pages.
    drawConnectors: any;
    drawLandmarks: any;
    POSE_CONNECTIONS: any;
    HAND_CONNECTIONS: any;
  }
}

// ─── Initial tracking state ───────────────────────────────────
function createInitialState(): TrackingState {
  return {
    elbow: createElbowState(),
    leftHand: createHandState(),
    rightHand: createHandState(),
    poseValid: false,
    leftHandValid: false,
    rightHandValid: false,
  };
}

// ─── Per-mode model factories ────────────────────────────────
// v1.29: wrist mode back to HANDS-ONLY (Pose dropped). Running two
// models in parallel was slowing hand detection — especially with
// single-hand exercises, where the Pose pass added latency without
// giving information the simple horizontal-forearm wrist formula needs.
// Prayer-stretch / vertical-forearm exercises are not supported by
// this mode (intentionally — the wrist tracker now assumes a roughly
// horizontal forearm and measures pure flexion / extension).
type ModelKind = 'pose' | 'hands' | 'pose+hands';

function modelKindForMode(mode: GameMode): ModelKind {
  if (mode === 'elbow') return 'pose';
  // wrist + fingers both go through hands-only.
  return 'hands';
}

interface ModelHandle {
  kind: ModelKind;
  /** Calls model.send({ image }) under the hood. */
  send(image: HTMLVideoElement): Promise<void>;
  close(): Promise<void> | void;
  setOnResults(handler: (results: HolisticResults) => void): void;
}

function createPose(): ModelHandle {
  const pose = new window.Pose({
    locateFile: (file: string) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
  });
  pose.setOptions({
    // v1.6: full model (was lite). Pose now runs alone (no Holistic
    // overhead) so we can afford the better landmarks; the elbow angle
    // is too noisy on lite when computing 3D from world coords.
    modelComplexity: 1,
    // v1.6: re-enable MediaPipe's internal landmark smoothing. Our EMA is
    // value-level (post-angle); MP's is landmark-level (pre-angle) and
    // catches jitter the per-angle EMA cannot.
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  let currentHandler: ((r: HolisticResults) => void) | null = null;
  pose.onResults((raw: RawPoseResults) => {
    currentHandler?.(adaptPoseResults(raw));
  });
  return {
    kind: 'pose',
    send: (image) => pose.send({ image }),
    close: () => pose.close?.(),
    setOnResults: (h) => {
      currentHandler = h;
    },
  };
}

function createHands(): ModelHandle {
  const hands = new window.Hands({
    locateFile: (file: string) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });
  hands.setOptions({
    maxNumHands: 2,
    // v1.7: match MediaPipe's Hands demo — full model, not lite. Lite
    // misses landmarks on partial hand views and produces the noise the
    // user observed.
    modelComplexity: 1,
    // v1.28: lowered from 0.5 to 0.3 so MediaPipe Hands keeps detecting
    // the hand when two hands are pressed together (prayer stretch /
    // wrist stretch). At 0.5 the model rejected the partially-occluded
    // hand outright.
    minDetectionConfidence: 0.3,
    minTrackingConfidence: 0.3,
  });
  let currentHandler: ((r: HolisticResults) => void) | null = null;
  hands.onResults((raw: RawHandsResults) => {
    currentHandler?.(adaptHandsResults(raw));
  });
  return {
    kind: 'hands',
    send: (image) => hands.send({ image }),
    close: () => hands.close?.(),
    setOnResults: (h) => {
      currentHandler = h;
    },
  };
}

/** v1.8: Pose + Hands running side by side. Each frame is sent to both
 *  models; we dispatch a single combined HolisticResults to the consumer
 *  AFTER both onResults have fired (so pose & hand landmarks always
 *  belong to the same frame). Pose runs at modelComplexity 0 because we
 *  only need elbow/wrist position — fine landmark accuracy lives in the
 *  Hands model. */
function createPoseAndHands(): ModelHandle {
  const pose = new window.Pose({
    locateFile: (file: string) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
  });
  pose.setOptions({
    modelComplexity: 0,
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  const hands = new window.Hands({
    locateFile: (file: string) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });
  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    // v1.28: same lower confidences as hands-only setup so pressed-
    // together hands stay detected in prayer-stretch / wrist-stretch
    // poses.
    minDetectionConfidence: 0.3,
    minTrackingConfidence: 0.3,
  });

  let latestPose: HolisticResults = {};
  let latestHands: HolisticResults = {};
  let currentHandler: ((r: HolisticResults) => void) | null = null;

  pose.onResults((raw: RawPoseResults) => {
    latestPose = adaptPoseResults(raw);
  });
  hands.onResults((raw: RawHandsResults) => {
    latestHands = adaptHandsResults(raw);
  });

  return {
    kind: 'pose+hands',
    send: async (image: HTMLVideoElement) => {
      // v1.8.1: serial send (Pose first, then Hands). Parallel
      // Promise.all dispatch caused the wrist mode to hang on some
      // browsers — likely WebGL/WASM contention between two simultaneous
      // MediaPipe instances. Serial costs a few ms vs parallel but is
      // reliable.
      try {
        await pose.send({ image });
      } catch (err) {
        console.error('[useTracking] pose.send failed:', err);
      }
      try {
        await hands.send({ image });
      } catch (err) {
        console.error('[useTracking] hands.send failed:', err);
      }
      currentHandler?.({ ...latestPose, ...latestHands });
    },
    close: async () => {
      try { await pose.close?.(); } catch { /* ignore */ }
      try { await hands.close?.(); } catch { /* ignore */ }
    },
    setOnResults: (h) => {
      currentHandler = h;
    },
  };
}

function createModelFor(kind: ModelKind): ModelHandle {
  if (kind === 'pose') return createPose();
  if (kind === 'hands') return createHands();
  return createPoseAndHands();
}

// ─── Main hook ────────────────────────────────────────────────
export function useTracking(activeMode: GameMode, frameListenerRef?: FrameListenerRef) {
  const [isRunning, setIsRunning] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [trackingState, setTrackingState] = useState<TrackingState>(createInitialState);

  // Hot-path refs.
  const stateRef = useRef<TrackingState>(createInitialState());
  const rawResultsRef = useRef<HolisticResults | null>(null);

  // Model lifecycle.
  const modelRef = useRef<ModelHandle | null>(null);
  // v1.9: we manage the camera ourselves (instead of @mediapipe/camera_utils)
  // so we can pass a specific deviceId from the user's camera picker.
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activeModeRef = useRef(activeMode);
  const rafScheduledRef = useRef(false);

  useEffect(() => {
    activeModeRef.current = activeMode;
  }, [activeMode]);

  // Tear-down on unmount.
  useEffect(() => {
    return () => {
      stopLoopRef.current?.();
      stopLoopRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void modelRef.current?.close();
      modelRef.current = null;
    };
  }, []);

  /** Shared per-frame handler. Reads activeModeRef so it never goes stale
   *  even though the closure was captured at model-creation time. */
  const onResults = useCallback((results: HolisticResults) => {
    rawResultsRef.current = results;

    const s = stateRef.current;
    s.poseValid = !!results.poseLandmarks && results.poseLandmarks.length >= 17;
    s.leftHandValid = !!results.leftHandLandmarks && results.leftHandLandmarks.length >= 21;
    s.rightHandValid = !!results.rightHandLandmarks && results.rightHandLandmarks.length >= 21;

    // Only run the tracker that matches what the active model produced.
    // This keeps unused trackers from accumulating state on stale data.
    const mode = activeModeRef.current;
    if (mode === 'elbow') {
      updateElbow(s.elbow, results.poseLandmarks, results.poseWorldLandmarks);
      updateForearmRotation(s.elbow, results.poseLandmarks);
    } else {
      // wrist + fingers: hands-only. Wrist uses a horizontal-forearm
      // assumption (sideways flex/extend exercises) and works on a
      // single hand — the other hand may be entirely out of frame.
      updateWristExtension(s.leftHand, results.leftHandLandmarks);
      updateWristExtension(s.rightHand, results.rightHandLandmarks);
      updateFingerOpenness(s.leftHand, results.leftHandLandmarks);
      updateFingerOpenness(s.rightHand, results.rightHandLandmarks);
    }

    if (frameListenerRef?.current) {
      frameListenerRef.current(mode, s, results, performance.now());
    }

    if (!rafScheduledRef.current) {
      rafScheduledRef.current = true;
      requestAnimationFrame(() => {
        rafScheduledRef.current = false;
        setTrackingState({ ...stateRef.current });
      });
    }
  }, [frameListenerRef]);

  /** Build (or rebuild) the model for the current mode. */
  const ensureModel = useCallback(async (mode: GameMode) => {
    const desiredKind = modelKindForMode(mode);
    const current = modelRef.current;
    if (current && current.kind === desiredKind) return;

    setIsSwitching(true);
    try {
      if (current) {
        try { await current.close(); }
        catch (err) { console.error('[useTracking] previous model close failed:', err); }
      }
      console.log(`[useTracking] creating model: ${desiredKind}`);
      const next = createModelFor(desiredKind);
      next.setOnResults(onResults);
      modelRef.current = next;
      console.log(`[useTracking] model ready: ${desiredKind}`);
      // Reset tracking state so leftover values from the previous model
      // don't bleed into the new mode's UI.
      stateRef.current = createInitialState();
      setTrackingState(createInitialState());
      rawResultsRef.current = null;
    } catch (err) {
      console.error(`[useTracking] FAILED to create model ${desiredKind}:`, err);
      // Clear modelRef so the camera onFrame doesn't try to send to a
      // half-built handle.
      modelRef.current = null;
    } finally {
      setIsSwitching(false);
    }
  }, [onResults]);

  /** v1.9: home-grown camera pump (replaces @mediapipe/camera_utils).
   *  Accepts an optional deviceId to pick a specific camera; falls back
   *  to the browser default when omitted. */
  const startCamera = useCallback(
    async (video: HTMLVideoElement, deviceId?: string) => {
      videoRef.current = video;
      await ensureModel(activeModeRef.current);

      // Tear down any previous stream / loop. Important when the user
      // switches camera while one is already running.
      stopLoopRef.current?.();
      stopLoopRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: 640, height: 480 }
          : { width: 640, height: 480 },
        audio: false,
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        console.error('[useTracking] getUserMedia failed:', err);
        return;
      }
      streamRef.current = stream;
      video.srcObject = stream;
      // Wait for metadata so videoWidth/videoHeight are known before we
      // start sending frames to the model.
      await new Promise<void>((resolve) => {
        if (video.readyState >= 1) {
          resolve();
          return;
        }
        const onMeta = () => {
          video.removeEventListener('loadedmetadata', onMeta);
          resolve();
        };
        video.addEventListener('loadedmetadata', onMeta);
      });
      try {
        await video.play();
      } catch (err) {
        console.error('[useTracking] video.play failed:', err);
      }

      // Per-frame loop: feed the latest video frame to whichever model
      // is currently active. Reading modelRef.current means a mode
      // switch can swap the model under us with no restart.
      let stopped = false;
      stopLoopRef.current = () => {
        stopped = true;
      };
      const loop = async () => {
        if (stopped) return;
        const m = modelRef.current;
        if (m && video.videoWidth > 0 && !video.paused) {
          try {
            await m.send(video);
          } catch (err) {
            // Keep looping on transient errors (e.g. one model failed to
            // process a single frame); only stop on explicit teardown.
            console.error('[useTracking] model.send error:', err);
          }
        }
        if (!stopped) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      setIsRunning(true);
    },
    [ensureModel],
  );

  const stopCamera = useCallback(async () => {
    stopLoopRef.current?.();
    stopLoopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (modelRef.current) {
      await modelRef.current.close();
      modelRef.current = null;
    }
    stateRef.current = createInitialState();
    rawResultsRef.current = null;
    setTrackingState(createInitialState());
    setIsRunning(false);
  }, []);

  const resetSession = useCallback(() => {
    stateRef.current = createInitialState();
    setTrackingState(createInitialState());
  }, []);

  // Re-arm the model when the active mode changes WHILE the camera is
  // running. If the camera is off, the swap happens implicitly on next
  // startCamera (ensureModel is idempotent).
  useEffect(() => {
    if (!isRunning) return;
    void ensureModel(activeMode);
  }, [activeMode, isRunning, ensureModel]);

  return {
    trackingState,
    /** Always-fresh tracking state; read inside imperative loops. */
    trackingStateRef: stateRef,
    /** Always-fresh raw landmark results; read by the canvas draw loop. */
    rawResultsRef,
    isRunning,
    /** True while a model swap is in progress (mode change). UI can show a
     *  brief "loading…" state. */
    isSwitching,
    startCamera,
    stopCamera,
    resetSession,
  };
}
