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

Both hands are handled **independently**: each hand has its own state
and either can be entirely out of frame without affecting the other.
A single visible hand works — there is no requirement to have both
hands in the picture.

Vertex of the angle is the **wrist**.

### Formula — hands-only, horizontal-forearm assumption

```
n = (mcp.x − wrist.x) * CAMERA_ASPECT_W_OVER_H    // horizontal component
i =  wrist.y − mcp.y                              // vertical (image-y is flipped,
                                                   //  so larger raw y = lower on screen)

angle = 90 + atan2(i, |n|) * 180 / π              // 0..180
```

`x` is scaled by `CAMERA_ASPECT_W_OVER_H` (= 4/3) so the two
components are in the same pixel unit. Using `|n|` collapses the
hand's left/right orientation so the formula works the same for
either hand and for either screen position — only the vertical
bend drives the output.

### Range

| Reading | Pose |
|---|---|
| **0°** | Hand pointing fully DOWN — max flexion |
| **90°** | Hand pointing HORIZONTAL — neutral (aligned with forearm) |
| **180°** | Hand pointing fully UP — max extension |

### Model / pose limitation (literal, do not change)

- Hands-only formula. There is NO forearm tracking — `n` and `i` are
  measured against the canvas axes, not against the user's forearm.
- Valid only while the forearm is held roughly **horizontal in the
  camera plane** (sideways flex/extend exercises). A tilted or
  vertical forearm (e.g. prayer stretch) will still produce a
  number, but its interpretation as wrist flex/extend is wrong.
- Prayer-stretch / vertical-forearm exercises are intentionally
  unsupported by this mode.

### Smoothing

EMA with `WRIST_SMOOTHING_FACTOR = 0.7` on the per-hand value
(heavier than the elbow's 0.3 — the wrist signal is shorter-baseline
and noisier, so we trust the new sample less).

### Visibility / framing

- Wrist (lm0) and middle-finger MCP (lm9) must be present.
- If either is missing the per-hand smoothed value is set to `null`
  and the overlay does not draw for that hand.
- MediaPipe Hands has no per-landmark visibility score, so the gate
  is simply "are the landmarks there?".

### Overlay drawing (game/wrist/WristOverlay.ts)

- **Underlay:** raw MediaPipe Hands skeleton, semi-transparent grey.
- **Active line:** wrist → middle-MCP, thicker, single side-neutral
  colour (cyan) — using one colour avoids the cyan/pink flicker we
  used to get when MediaPipe Hands' handedness label oscillated
  between L and R for the same physical hand (common when the two
  hands are close or only one is in frame).
- **Vertex dot:** wrist (cyan).
- **Numeric label:** the angle in degrees, drawn near the wrist.
- The active line and the number derive from the **same** Hands
  landmark indices (lm0 and lm9) that feed the angle formula, so
  the visual line and the number cannot disagree.
