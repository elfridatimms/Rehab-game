// ─── Tunable Tracking Constants ───────────────────────────────
// These match the architecture reference exactly.

/** EMA smoothing blend factor (0–1). Higher = more responsive, more jittery.
 *  Used by elbowTracker (`updateElbow`, `updateForearmRotation`). */
export const SMOOTHING_FACTOR = 0.3;

/** v1.19: wrist-specific EMA factor. Bumped from the global 0.3 to 0.7
 *  to cut the perceived latency in the wrist mode overlay; the trade-off
 *  is slightly more jitter in the readout, which is acceptable for the
 *  flexion/extension exercise where rapid response matters more than
 *  rock-steady stillness at neutral. */
export const WRIST_SMOOTHING_FACTOR = 0.7;

/** Minimum landmark visibility to consider valid (used by post-hoc
 *  anomaly classification — frames below this become `low_visibility`). */
export const VISIBILITY_THRESHOLD = 0.5;

/** Lower per-landmark visibility gate used by live trackers to reject
 *  hallucinated / out-of-frame landmarks. Trackers compute nothing when a
 *  required landmark falls below this — same value the elbow tracker
 *  uses internally for its own arm-trackability check. */
export const VISIBILITY_TRACK_THRESHOLD = 0.2;

/** Hysteresis margin before switching active elbow side. */
export const ELBOW_SIDE_SWITCH_MARGIN = 0.08;

/** Hand openness mapping: average (fingertip→wrist)/palm-length ratio
 *  when the fist is fully closed. v1.14: restored to the older stable
 *  value 1.4 — paired with palm-length normalisation a tight fist now
 *  reads ~0 % and the previously-observed underread no longer occurs. */
export const FINGER_RATIO_CLOSED = 1.4;

/** Hand openness mapping: same ratio when the hand is fully open. v1.14:
 *  restored to the older stable value 2.6 paired with palm-length
 *  normalisation. With these constants a flat, fully-spread hand reads
 *  ~100 %. */
export const FINGER_RATIO_OPEN = 2.6;

/** Finger-specific smoothing factor. v1.14: kept at 0.18 — heavier than
 *  the global EMA because fingertip landmarks jitter more, but light
 *  enough that the readout still tracks rapid motion. */
export const FINGER_SMOOTHING_FACTOR = 0.18;

// ─── Drawing Constants ────────────────────────────────────────
export const REF_LINE_LEN = 80;
export const ARC_RADIUS = 40;

// ─── Game Thresholds ──────────────────────────────────────────
/** Elbow angle targets for star lighting (degrees). */
export const STAR_TARGETS = [45, 60, 75, 90, 105, 120, 135, 150, 165, 180];

/** Wrist extension considered "good" for beam brightness. */
export const WRIST_GOOD_THRESHOLD = 30; // degrees

/** Ghost line threshold: show peak marker when peak > current + this. */
export const GHOST_THRESHOLD_DEG = 0.5;
