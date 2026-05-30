# Rehab Tracker — measurement specification

## Elbow angle (active mode: `elbow`)

### Landmarks (MediaPipe Pose, image-plane normalised coords)

| Joint | Left side | Right side |
|---|---|---|
| Shoulder | `11` | `12` |
| Elbow | `13` | `14` |
| Wrist | `15` | `16` |

Vertex of the angle is the **elbow**.

### Formula

```
a = shoulder − elbow                     (vector along the upper arm)
b = wrist    − elbow                     (vector along the forearm)
cross = a.x * b.y − a.y * b.x
dot   = a.x * b.x + a.y * b.y
angle_deg = |atan2(cross, dot)| * 180 / π
```

Range: **0..180**. Fully extended arm reads **~180°**; fully folded arm
reads near **0°**.

### Coordinates

All landmark coordinates are converted from MediaPipe's normalised
(0..1) to pixels **before** the angle is computed:

```
ax = (shoulder.x − elbow.x) * width
ay = (shoulder.y − elbow.y) * height
bx = (wrist.x    − elbow.x) * width
by = (wrist.y    − elbow.y) * height
```

This matters because `width` and `height` are usually unequal — using
normalised coordinates with non-square canvases distorts the angle.

### 2D limitation (literal, do not change)

The angle is correct as long as the arm is parallel to the camera plane.
Motion towards or away from the camera projects onto the image plane and
underestimates the true 3D angle. The trackers and overlays do NOT
attempt to correct or flag this — the user keeps the limb in plane.

### Visibility / framing

- **Hips do NOT need to be visible.**
- **Shoulders MUST be visible** — without a reliable shoulder landmark
  the upper-arm reference vector is unusable.
- One **active arm at a time**, sticky by visibility. The arm with the
  higher cumulative landmark visibility wins; a small hysteresis margin
  prevents flicker between sides.
- If any of {shoulder, elbow, wrist} of the active arm has
  `visibility < VISIBILITY_TRACK_THRESHOLD` (= 0.2) **or** its
  normalised x/y leaves the [0, 1] frame, the overlay shows
  `nije vidljivo` instead of a fake number.

### Reuse of existing math

The angle is already computed every frame in
`src/tracking/elbowTracker.ts → updateElbow`. The overlay reads the
smoothed per-side value from `ElbowState`; it does NOT re-implement the
formula. The tracker stores the angle in its own flexion convention
(`flexion = 180 − interior`, so fully extended ≈ 0). The overlay
displays `180 − flexion` so the on-screen number follows the SPEC
convention above (fully extended ≈ 180).

### Overlay drawing (game/elbow/ElbowOverlay.ts)

- **Reference line:** elbow → shoulder, thin grey. Represents the
  upper-arm reference axis.
- **Active line:** elbow → wrist, thicker, side-coloured. Represents
  the forearm; rotates as the elbow flexes/extends.
- **Numeric label:** the angle in degrees, drawn next to the elbow
  vertex.
- Reference + active lines + the displayed number all derive from the
  **same** Pose landmark indices that feed the angle computation, so the
  visual lines and the number cannot disagree.
- No full skeleton, no goniometer disc, no other decoration.

---

## Wrist angle (active mode: `wrist`)

### Landmarks (per side)

| Joint | Source | Index |
|---|---|---|
| Elbow (forearm side) | MediaPipe Pose | `13` (L) / `14` (R) |
| Wrist (vertex) | MediaPipe Hands | `0` |
| Middle MCP (hand side) | MediaPipe Hands | `9` |

Both hands are handled **independently**: each hand has its own
state and either can be entirely out of frame without affecting the
other. A single visible hand works.

Vertex of the angle is the **wrist**.

### Formula — identical to elbow

```
A  = (elbow − wrist) * aspect-corrected   // forearm side
B  = (mcp   − wrist) * aspect-corrected   // hand side
dot      = A · B
interior = acos(dot / (|A| · |B|)) * 180 / π     // 0..180
flexion  = 180 − interior                        // clinical convention
```

`x` components scaled by `CAMERA_ASPECT_W_OVER_H` (= 4/3) so x and
y are in the same pixel unit. Exactly the same shape as the elbow
formula, just with `wrist → elbow` and `wrist → MCP` as the two
vectors instead of `elbow → shoulder` and `elbow → wrist`.

### Range

| Reading | Pose |
|---|---|
| **0°** | Wrist STRAIGHT — hand continues forearm (any orientation) |
| **~90°** | Wrist bent perpendicular to forearm |
| **180°** | Wrist folded back parallel to forearm (rare anatomically) |

Because the angle is measured against the **forearm direction**
(not against a fixed canvas axis), the user can hold the arm
sideways, vertical, diagonal — the neutral straight pose always
reads ~0.

### Visibility / framing

- Wrist (lm0) and middle-finger MCP (lm9) must be present.
- Elbow landmark (Pose) must be present.
- **No elbow visibility gate.** A low-visibility elbow is still used.
  Gating it out broke single-hand exercises whenever the body was
  partially occluded behind a desk or arm; the angle would null out
  every other frame. Trade-off: when the elbow is genuinely missing,
  the formula reads garbage rather than null — but that case is rare,
  and the alternative was strictly worse.
- If hand landmarks or Pose results are absent the per-hand smoothed
  value is set to `null` and the overlay does not draw for that hand.

### Smoothing

EMA with `WRIST_SMOOTHING_FACTOR = 0.7` on the per-hand value
(heavier than the elbow's 0.3 — the wrist signal is shorter-baseline
and noisier, so we trust the new sample less).

### Model loading

Wrist mode loads **Pose alongside Hands** (`pose+hands` model kind
in `useTracking.ts`). Fingers mode stays hands-only.

### Overlay drawing (game/wrist/WristOverlay.ts)

- **Underlay:** raw MediaPipe Hands skeleton, semi-transparent grey.
- **Active line:** wrist → middle-MCP, thicker, single side-neutral
  colour (cyan) — using one colour avoids the cyan/pink flicker we
  used to get when MediaPipe Hands' handedness label oscillated
  between L and R for the same physical hand (common when the two
  hands are close or only one is in frame).
- **Vertex dot:** wrist (cyan).
- **Numeric label:** the angle in degrees, drawn near the wrist.
