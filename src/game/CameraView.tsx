import React, { useRef, useEffect } from 'react';
import type { GameMode, HolisticResults, TrackingState } from '../types';
import { drawElbowOverlay } from './elbow/ElbowOverlay';
import { drawWristOverlay } from './wrist/WristOverlay';
import { drawFingersOverlay } from './fingers/FingersOverlay';

/** Which functional finger metric the overlay should visualise. Picked
 *  per exercise: finger_extension → spread, everything else → openness. */
export type FingersMetric = 'openness' | 'spread';

interface CameraViewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  rawResultsRef: React.RefObject<HolisticResults | null>;
  trackingStateRef: React.RefObject<TrackingState>;
  activeMode: GameMode;
  isRunning: boolean;
  /** Fingers-mode overlay metric. Defaults to openness. */
  fingersMetric?: FingersMetric;
}

const CameraViewImpl: React.FC<CameraViewProps> = ({
  videoRef,
  rawResultsRef,
  trackingStateRef,
  activeMode,
  isRunning,
  fingersMetric = 'openness',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  // Mirror mutating props into refs so the draw loop can read the latest
  // value without being re-installed on every change.
  const activeModeRef = useRef(activeMode);
  const isRunningRef = useRef(isRunning);
  const fingersMetricRef = useRef(fingersMetric);
  useEffect(() => {
    activeModeRef.current = activeMode;
  }, [activeMode]);
  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);
  useEffect(() => {
    fingersMetricRef.current = fingersMetric;
  }, [fingersMetric]);

  // Install the draw loop ONCE. It reads everything via refs, so it does not
  // need to be torn down when results / state / mode update. This avoids the
  // ~30 Hz "cancel + reschedule" churn from the previous implementation.
  useEffect(() => {
    let running = true;

    const draw = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Resize canvas only when needed. Writing canvas.width/height *clears
      // the bitmap and reallocates a buffer*, so doing it per-frame is
      // expensive and pointless when dimensions are stable.
      const targetW = video.videoWidth || 640;
      const targetH = video.videoHeight || 480;
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Mirrored video.
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      const rawResults = rawResultsRef.current;
      const trackingState = trackingStateRef.current;
      if (!rawResults || !isRunningRef.current || !trackingState) return;

      switch (activeModeRef.current) {
        case 'elbow':
          drawElbowOverlay(ctx, canvas, rawResults, trackingState.elbow);
          break;
        case 'wrist':
          drawWristOverlay(ctx, canvas, rawResults, trackingState);
          break;
        case 'fingers':
          drawFingersOverlay(ctx, canvas, rawResults, trackingState, fingersMetricRef.current);
          break;
      }
    };

    const loop = () => {
      if (!running) return;
      draw();
      animRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
    // All deps are stable React refs — effect installs once on mount.
  }, [videoRef, rawResultsRef, trackingStateRef]);

  return (
    <div className="camera-view">
      <video
        ref={videoRef}
        className="camera-video"
        playsInline
        muted
        style={{ display: 'none' }}
      />
      <canvas ref={canvasRef} className="camera-canvas" />
      {!isRunning && (
        <div className="camera-placeholder">
          <div className="placeholder-text">Camera off</div>
        </div>
      )}
    </div>
  );
};

export const CameraView = React.memo(CameraViewImpl);
