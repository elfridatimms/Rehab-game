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
underestimates the true 3D angle.

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

### Landmarks (MediaPipe Hands)

| Joint | Index |
|---|---|
| Wrist root | `0` |
| Middle-finger MCP | `9` |

Both hands are handled independently; the same formula applies to left
and right.

### Reference

`0°` is the **vertical neutral direction** through the wrist landmark
(lm0) — where a hand in line with a vertical forearm sits. The angle
is the deflection of the hand vector AWAY from that neutral, regardless
of which side the bend is on.

The wrist exercise assumes the **forearm is held vertical and in the
plane of the camera** (no lean toward/away). In that pose:

- Hand in line with forearm (upright) → **0°** (neutral)
- Wrist bent sideways → number rises above 0
- Hand reaches horizontal (full ~90° flex/ext) → **~90°**
- Hand past horizontal (rare hyperextension) → >90°

This matches the standard clinical convention: ROM = degrees of bend
from neutral. PDF target Extension 70–90° and Flexion 80–90° both fall
within the 0..90 readout range.

### Formula

Hand vector goes from the wrist landmark to the middle-finger MCP:

```
n = mcp.x   − wrist.x          // horizontal component (signed)
i = wrist.y − mcp.y            // vertical component (screen y inverted)
from_horizontal = atan2(i, |n|) * 180 / π    // intermediate, range −90…+90
angle_deg       = 90 − from_horizontal       // final, 0 at upright, 90 at horizontal
```

Taking the absolute value of the horizontal component collapses
left-vs-right and the canvas mirror (`scale(-1, 1)`) into the same
case, so the formula behaves identically regardless of which hand is
tracked or how the canvas is displayed.

Range: **0° … ~180°** (typical use stays in 0..90).
- `0`     = hand upright in line with vertical forearm
- `~45`   = hand tilted halfway to horizontal
- `~90`   = hand horizontal (~max anatomical flex or ext)
- `>90`   = hyperextension past horizontal

### 2D / model limitation (literal, do not change)

The forearm is NOT tracked by the Hands model. Neutral=90 is a fixed
assumption that holds **only while the forearm is vertical and in the
plane of the camera**. A tilted forearm or motion toward/away from the
camera will not be detected — the formula will still return a number,
but its interpretation as "wrist flexion/extension" is no longer valid.

### Visibility / framing

- Wrist (lm0) and middle MCP (lm9) must be present.
- If either is missing the per-hand smoothed value is set to `null` and
  the overlay does not draw for that hand.
- Hand visibility from MediaPipe Hands is binary (no per-landmark
  visibility score), so the gate is simply "are the landmarks there?".

### Overlay drawing (game/wrist/WristOverlay.ts)

- **Reference line:** a thin grey **horizontal** line through the
  canvas position of the wrist (lm0). This is the visible `0°` axis.
- **Active line:** the hand vector wrist → MCP, drawn thicker and in a
  side colour. Rotates as the wrist bends.
- **Numeric label:** the angle in degrees, drawn near the wrist.
- Both lines and the number derive from the **same** Hands landmark
  indices (lm0 and lm9) that feed the angle computation, so the visual
  lines and the number cannot disagree.
