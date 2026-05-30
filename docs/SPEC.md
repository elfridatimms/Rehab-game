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

### Landmarks (MediaPipe Hands only — no Pose)

| Joint | Index |
|---|---|
| Wrist root | `0` |
| Middle-finger MCP | `9` |

Both hands are handled **independently**: each hand has its own
state and either can be entirely out of frame without affecting the
other. A single visible hand works.

Vertex of the angle is the **wrist**.

### Pose / camera setup

Side view, forearm held **UPRIGHT (vertical)**, hand pointing up.
Bending the wrist tilts the hand left or right in the image. The
reading is the angle of the hand vector measured from the
**horizontal axis**.

### Formula — hands-only, angle from horizontal

```
vert  =  wrist.y − mcp.y                       // +ve when hand is above wrist
horiz = (wrist.x − mcp.x) * CAMERA_ASPECT_W_OVER_H
angle =  atan2(vert, horiz) * 180 / π          // hand-up = +90
```

`x` is scaled by `CAMERA_ASPECT_W_OVER_H` (= 4/3) so the two
components are in the same pixel unit. Below-horizontal positions
(`angle < 0`) are clamped to the nearer end of the 0..180 sweep.

The value is computed so the on-screen number matches the drawn
line exactly: the overlay draws wrist→MCP in mirrored canvas space,
and the angle of that line above the horizontal reference equals
this number.

### Range

| Reading | Pose |
|---|---|
| **0°** | Hand tilted fully to one side (horizontal) |
| **90°** | Hand straight UP — neutral, in line with the upright forearm |
| **180°** | Hand tilted fully to the other side (horizontal) |

### Model / pose limitation (literal, do not change)

- Hands-only. No forearm is tracked — the reference is the canvas
  horizontal, not the user's forearm.
- Neutral = 90 holds **only while the forearm is held upright** in
  the camera plane. A tilted or horizontal forearm will still
  produce a number, but its interpretation as wrist flex/extend is
  no longer valid.

### Visibility / framing

- Wrist (lm0) and middle-finger MCP (lm9) must be present.
- If either is missing the per-hand smoothed value is set to `null`
  and the overlay does not draw for that hand.
- MediaPipe Hands has no per-landmark visibility score, so the gate
  is simply "are the landmarks there?".

### Smoothing

EMA with `WRIST_SMOOTHING_FACTOR = 0.7` on the per-hand value
(heavier than the elbow's 0.3 — the wrist signal is shorter-baseline
and noisier, so we trust the new sample less).

### Model loading

Wrist mode runs **hands-only** (`hands` model kind in
`useTracking.ts`). Fingers mode is also hands-only.

### Overlay drawing (game/wrist/WristOverlay.ts)

- **Underlay:** raw MediaPipe Hands skeleton, semi-transparent grey.
- **Reference line:** a thin grey **horizontal** line through the
  wrist (lm0). This is the visible `0°↔180°` axis; the hand's angle
  above it is the reading (straight up = 90).
- **Active line:** wrist → middle-MCP, thicker, single side-neutral
  colour (cyan) — using one colour avoids the cyan/pink flicker we
  used to get when MediaPipe Hands' handedness label oscillated
  between L and R for the same physical hand.
- **Vertex dot:** wrist (cyan).
- **Numeric label:** the angle in degrees, drawn near the wrist.

---

## Functional finger metrics (active mode: `fingers`)

Two **different** functional metrics, chosen per exercise:

| Exercise | Metric | Question it answers |
|---|---|---|
| `fist_making` | hand **openness** | is the hand open or closed? |
| `finger_extension` | finger **spread** | how far apart are the fingers? |

Both are **functional** whole-hand metrics, **NOT** precise anatomical
measurements of individual finger joints. Both are computed every frame;
the UI overlay + panel pick the one matching the active exercise
(`App.tsx` → `fingersMetric`; `FingersPanel` → `isSpread`).

### Hand openness (fist making)

### Landmarks (MediaPipe Hands only)

| Joint | Index |
|---|---|
| Wrist root | `0` |
| Finger MCPs (palm center) | `5, 9, 13, 17` |
| Middle MCP (palm size) | `9` |
| Fingertips (no thumb) | `8, 12, 16, 20` |

The thumb tip (`4`) is intentionally excluded — its different anatomy
distorts the simple average.

### Formula

```
palmCenter = average(landmark[5], 9, 13, 17)      // x,y only (no z)
palmSize   = dist(landmark[0], landmark[9])        // aspect-corrected
raw        = mean over tips {8,12,16,20} of
               dist(tip, palmCenter) / palmSize
```

`raw` grows as the hand opens, shrinks as it closes. `x` distances are
scaled by `CAMERA_ASPECT_W_OVER_H` (= 4/3). Frame is invalid (metric
null) if fewer than 21 landmarks, any of {0,5,8,9,12,13,16,17,20}
missing, or `palmSize < PALM_SIZE_MIN`.

### Smoothing & dynamic percent

- EMA with `HAND_OPENNESS_SMOOTHING_FACTOR = 0.3` → `hand_openness_filtered`.
- Running min/max of the smoothed ratio are tracked since state reset.
- `hand_openness_percent = (filtered − min)/(max − min) × 100`, clamped
  0–100. **Dynamic / self-calibrating**: 0 % = most-closed seen, 100 % =
  most-open seen. Null until the range opens up.
- `fist_closure_percent = 100 − hand_openness_percent`.

### Hand state (hysteresis)

| State | Condition |
|---|---|
| `open` | percent > `HAND_OPEN_THRESHOLD` (75) |
| `closed` | percent < `HAND_CLOSED_THRESHOLD` (35) |
| `transition` | otherwise |

### Functional ROM

`functional_hand_rom = hand_openness_max − hand_openness_min` over the
trial's clean frames (anomaly_flag = 0). It is a **ratio**, not a
degree value — never displayed with `°`.

### Finger spread (finger extension)

Measures **how far apart the fingers are spread** — distinct from
openness (tip-to-palm). Uses the same Hands landmarks plus the thumb
tip (`4`).

```
palmSize = dist(landmark[0], landmark[9])            // aspect-corrected
raw      = mean over pairs {(4,8),(8,12),(12,16),(16,20)} of
             dist(tipA, tipB) / palmSize
```

Larger `raw` = fingers more separated. Same EMA (`0.3`), running
min/max, and **dynamic percent** (0 = least spread seen, 100 = most)
as openness. `finger_spread_rom = max − min` over clean frames. No
open/closed state — spread has no binary classification.

Overlay (finger_extension): a fan connecting the fingertips
(4→8→12→16→20) + the big spread % + ROM caption. Selected via
`fingersMetric === 'spread'`.

### Rep counting

Not yet implemented. `rep_count` = 0 and `mean_rom_per_rep` = empty in
the CSV until it lands.

### Relationship to the legacy openness score

The older deploy openness score (fingertip → **wrist** over 5 tips,
fixed 1.4/2.6 calibration, 0–100) is still computed and written to the
legacy `left_raw`/`left_filtered` frame columns for backward
compatibility, and shown as a small "Score (legacy)" stat. The new
functional metric is the headline UI value and lives in the dedicated
`hand_openness_*` columns.

### Overlay (game/fingers/FingersOverlay.ts)

- Raw MediaPipe Hands skeleton, grey underlay.
- Palm-center dot (side colour).
- Lines from palm center to the four fingertips (8,12,16,20) — the
  exact segments that feed the metric.
- Big `hand_openness_percent` label + caption (`state · ROM`).
