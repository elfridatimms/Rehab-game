import { useCallback, useEffect, useState } from 'react';

/** Persisted preferred camera deviceId. Cleared automatically if the
 *  saved device is no longer plugged in. */
const STORAGE_KEY = 'preferred_camera_id';

export interface CameraInfo {
  deviceId: string;
  label: string;
}

interface UseCamerasResult {
  cameras: readonly CameraInfo[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** Re-enumerate. Call this after first getUserMedia grant so the
   *  device labels (which require permission) become readable. */
  refresh: () => Promise<void>;
}

export function useCameras(): UseCamerasResult {
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [selectedId, setSelectedIdState] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY)
  );

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams: CameraInfo[] = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d) => ({
          deviceId: d.deviceId,
          // Before the user grants camera permission the browser hides
          // the actual device name — fall back to a short anonymous tag.
          label: d.label || `Camera (${d.deviceId.slice(0, 6)})`,
        }));
      setCameras(cams);
    } catch (err) {
      console.error('[useCameras] enumerate failed:', err);
    }
  }, []);

  // Drop the saved selection if the saved device disappeared.
  useEffect(() => {
    if (!selectedId) return;
    if (cameras.length === 0) return;
    if (!cameras.some((c) => c.deviceId === selectedId)) {
      setSelectedIdState(null);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [cameras, selectedId]);

  // Initial enumeration + refresh on device hotplug.
  useEffect(() => {
    void refresh();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => { void refresh(); };
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [refresh]);

  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { cameras, selectedId, setSelectedId, refresh };
}
