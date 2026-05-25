import type { GameMode } from '../types';
import type { Exercise } from './exerciseTypes';

// Source for descriptions and target-ROM values: CommonConditionResearch
// Sheet2 PDF. Values are reproduced verbatim where present; entries whose
// PDF cell is "?" use `targetROM: null` (no value invented).
//
// Suitability values are kept in the registry (and the CSV metadata) but
// are NOT surfaced in the UI any more.
export const EXERCISES: readonly Exercise[] = [
  // ═══ ELBOW ═══════════════════════════════════════════════
  {
    id: 'elbow_flex_ext',
    mode: 'elbow',
    nameEn: 'Elbow flexion and extension',
    nameHr: 'Pregib i istezanje lakta',
    instructionsEn:
      'Perform a full extension and flexion of the arm.',
    instructionsHr:
      'Izvedi punu ekstenziju i fleksiju ruke.',
    cameraSetupEn:
      'Sit facing the camera with the working arm slightly to the side, not in front of the torso. Whole arm visible from shoulder to fingertips.',
    cameraSetupHr:
      'Sjedni okrenuta prema kameri, radna ruka malo u stranu (ne ispred trupa). Cijela ruka vidljiva od ramena do vrhova prstiju.',
    visibilityEn:
      'Shoulder, elbow, and wrist must all be visible. Tracking the whole forearm can be problematic due to FoV and position required.',
    visibilityHr:
      'Rame, lakat i zapešće moraju biti vidljivi. Praćenje cijele podlaktice može biti problematično zbog vidnog polja i potrebne pozicije.',
    holdSeconds: null,
    repetitions: null,
    jointConstraints: 'Upper arm still; only elbow moves.',
    targetROM: '0° to 145–150°',
    expectedSuitability: 'YES',
    activeDetectors: [],
    rationale:
      'Single-plane frontal motion of shoulder–elbow–wrist; 2D angle is well-defined.',
  },
  {
    id: 'forearm_pron_sup',
    mode: 'elbow',
    nameEn: 'Forearm pronation / supination',
    nameHr: 'Pronacija / supinacija podlaktice',
    instructionsEn:
      "Twist the forearm along its axis.",
    instructionsHr:
      'Rotiraj podlakticu duž njezine osi.',
    cameraSetupEn:
      'Sit facing the camera. Hold the forearm horizontally in front of you, hand at chest height, elbow tucked in.',
    cameraSetupHr:
      'Sjedni okrenuta prema kameri. Drži podlakticu vodoravno ispred sebe, šaka u visini grudi, lakat uz tijelo.',
    visibilityEn:
      'Whole hand and forearm must remain in frame throughout the rotation. Tracking the whole forearm can be problematic due to FoV and position required.',
    visibilityHr:
      'Cijela šaka i podlaktica moraju ostati u kadru tijekom rotacije. Praćenje cijele podlaktice može biti problematično zbog vidnog polja i potrebne pozicije.',
    holdSeconds: null,
    repetitions: null,
    jointConstraints: 'Elbow tucked at 90°; only forearm rotates around its long axis.',
    targetROM: '80–85° each direction (160–170° full range)',
    expectedSuitability: 'NO',
    activeDetectors: ['AxialRotation'],
    rationale:
      'Rotation around the forearm long axis is not observable from 2D pose landmarks; only hand-orientation drift gives evidence.',
  },

  // ═══ WRIST ═══════════════════════════════════════════════
  {
    id: 'wrist_flex_ext',
    mode: 'wrist',
    nameEn: 'Wrist flexion and extension',
    nameHr: 'Fleksija i ekstenzija zapešća',
    instructionsEn:
      'Bend the wrist forward and backwards.',
    instructionsHr:
      'Savijaj zapešće naprijed i natrag.',
    cameraSetupEn:
      "Sit facing the camera. Hold your forearm in front of you. Choose the orientation that fits the movement: forearm horizontal across the frame (side view) or pointing toward the camera (front view).",
    cameraSetupHr:
      'Sjedni okrenuta prema kameri. Drži podlakticu ispred sebe. Odaberi orijentaciju: podlaktica vodoravno kroz kadar (bočni pogled) ili prema kameri (frontalni pogled).',
    visibilityEn:
      'Elbow, wrist, and hand (fingers) must be visible. Do not rest the forearm on a desk.',
    visibilityHr:
      'Lakat, zapešće i šaka (prsti) moraju biti vidljivi. Ne naslanjaj podlakticu na stol.',
    holdSeconds: null,
    repetitions: null,
    jointConstraints: 'Forearm still; movement only at the wrist.',
    targetROM: 'Extension 70–90°, Flexion 80–90°',
    bidirectional: true,
    expectedSuitability: 'YES',
    activeDetectors: [],
    rationale:
      'Single-plane motion; wrist-to-MCP axis stays in the chosen plane and the angle is well-defined.',
  },
  {
    id: 'wrist_flex_ext_stretches',
    mode: 'wrist',
    nameEn: 'Wrist flexor / extensor stretches',
    nameHr: 'Rastezanje fleksora i ekstenzora zapešća',
    instructionsEn:
      'Similar to the wrist stretch, but in both directions: stretch the wrist into extension and into flexion.',
    instructionsHr:
      'Slično rastezanju zapešća, ali u oba smjera: rastegni zapešće u ekstenziju i u fleksiju.',
    cameraSetupEn:
      'Sit facing the camera with both arms in view. Prefer the side orientation so the stretched wrist is not occluded by the helping hand.',
    cameraSetupHr:
      'Sjedni okrenuta prema kameri tako da su obje ruke u kadru. Preferiraj bočnu orijentaciju kako rastegnuto zapešće ne bi bilo zaklonjeno rukom koja pomaže.',
    visibilityEn:
      'Both hands in frame; the helping hand may obscure the wrist of the stretched arm.',
    visibilityHr:
      'Obje ruke u kadru; ruka koja pomaže može zaklanjati zapešće rastegnute ruke.',
    holdSeconds: null,
    repetitions: null,
    jointConstraints: 'One hand applies passive force to the other; the targeted wrist is the one being held.',
    targetROM: 'Extension 70–90°, Flexion 80–90°',
    bidirectional: true,
    expectedSuitability: 'PARTIAL',
    activeDetectors: ['DualHandOcclusion'],
    rationale:
      'Both hands are in frame and one occludes parts of the other; angle is measurable but reliability is intermittent.',
  },
  {
    id: 'wrist_stretch_other_hand',
    mode: 'wrist',
    nameEn: 'Wrist stretch',
    nameHr: 'Istezanje zapešća',
    instructionsEn:
      'Pull the wrist backwards with the other hand, against a table, wall, etc.',
    instructionsHr:
      'Povuci zapešće unatrag drugom rukom, ili o stol, zid itd.',
    cameraSetupEn:
      'Sit facing the camera with both arms in view. Side orientation is preferred for measurement; usually done with both hands, which can be problematic.',
    cameraSetupHr:
      'Sjedni okrenuta prema kameri tako da su obje ruke u kadru. Bočna orijentacija je poželjna za mjerenje; obično se izvodi s obje ruke, što može biti problematično.',
    visibilityEn:
      'Both hands in the frame; the helping hand covers parts of the stretched hand.',
    visibilityHr:
      'Obje ruke u kadru; ruka koja pomaže prekriva dijelove rastegnute ruke.',
    holdSeconds: null,
    repetitions: null,
    jointConstraints: 'Stretch is held at end-range; the targeted wrist is passive.',
    targetROM: 'Extension 70–90°, Flexion 80–90°',
    bidirectional: true,
    expectedSuitability: 'NO',
    activeDetectors: ['DualHandOcclusion'],
    rationale:
      'The two hands overlap heavily for most of the stretch; landmark tracking on the target hand is unreliable.',
  },
  {
    id: 'prayer_stretch',
    mode: 'wrist',
    nameEn: 'Prayer stretch',
    nameHr: 'Molitveno istezanje',
    instructionsEn:
      'Put the palms of both hands together and push against each other, forcing the flexion of the wrists.',
    instructionsHr:
      'Spoji dlanove obje ruke i pritisni ih jedan o drugi, prisiljavajući fleksiju zapešća.',
    cameraSetupEn:
      'Sit facing the camera. The joined hands are in front of the chest; both elbows out so the forearm-to-hand angle is observable.',
    cameraSetupHr:
      'Sjedni okrenuta prema kameri. Spojene ruke su ispred prsa; oba lakta razmaknuta tako da je kut između podlaktice i šake vidljiv.',
    visibilityEn:
      'Both hands in frame and pressed together; tracking the whole forearm can be problematic due to FoV and position required.',
    visibilityHr:
      'Obje ruke u kadru i spojene; praćenje cijele podlaktice može biti problematično zbog vidnog polja i potrebne pozicije.',
    holdSeconds: null,
    repetitions: null,
    jointConstraints: 'Palms remain pressed together; both elbows kept at the same reference position. Measure how each wrist–forearm angle changes as the stretch deepens.',
    // PDF lists no target ROM for prayer stretch.
    targetROM: null,
    expectedSuitability: 'NO',
    activeDetectors: ['DualHandOcclusion'],
    rationale:
      'Hands are joined for the entire movement; per-hand landmark sets fuse or swap and 2D angles become unreliable.',
  },
  {
    id: 'wrist_curls_supine',
    mode: 'wrist',
    nameEn: 'Wrist curls',
    nameHr: 'Pregib zapešća',
    instructionsEn:
      'With the arm in supine position (palm up), flex the wrist up.',
    instructionsHr:
      'S rukom u supinaciji (dlan prema gore), savij zapešće prema gore.',
    cameraSetupEn:
      'Sit facing the camera. Hold the forearm in front of you, palm up. Tracking the whole forearm can be problematic due to FoV and position required.',
    cameraSetupHr:
      'Sjedni okrenuta prema kameri. Drži podlakticu ispred sebe, dlan prema gore. Praćenje cijele podlaktice može biti problematično zbog vidnog polja i potrebne pozicije.',
    visibilityEn:
      'Forearm, wrist, and hand visible. If a weight is held it will partially cover the fingers.',
    visibilityHr:
      'Podlaktica, zapešće i šaka vidljivi. Ako se drži uteg, djelomično će prekriti prste.',
    holdSeconds: null,
    repetitions: null,
    jointConstraints: 'Forearm immobilised; only wrist moves.',
    // PDF: target ROM is "?" — no defined value.
    targetROM: null,
    bidirectional: true,
    expectedSuitability: 'NO',
    activeDetectors: ['HandObjectOcclusion'],
    rationale:
      'The dumbbell occludes finger landmarks and forces the hand into a closed-fist grip the model cannot fully resolve.',
  },
  {
    id: 'wrist_rotations_circular',
    mode: 'wrist',
    nameEn: 'Wrist rotations',
    nameHr: 'Rotacije zapešća',
    instructionsEn:
      'With arms extended, make slow, circular motions.',
    instructionsHr:
      'S ispruženim rukama, izvodi spore, kružne pokrete.',
    cameraSetupEn:
      'Sit facing the camera. Extend one or both arms in front of you, forearms horizontal, hands at chest height.',
    cameraSetupHr:
      'Sjedni okrenuta prema kameri. Ispruži jednu ili obje ruke ispred sebe, podlaktice vodoravno, šake u visini grudi.',
    visibilityEn:
      'Hand and forearm fully visible. The hand must trace a circular path, not a single axis.',
    visibilityHr:
      'Šaka i podlaktica potpuno vidljive. Šaka mora crtati kružni put, ne jednu os.',
    holdSeconds: null,
    repetitions: null,
    jointConstraints: 'Forearm and shoulder still; circular path traced by the hand.',
    targetROM: 'Flexion 80–90°, Extension 70–90°, Ulnar deviation 30–45°, Radial deviation 15–30°',
    expectedSuitability: 'PARTIAL',
    activeDetectors: ['MultiAxisMotion'],
    rationale:
      'Circular motion mixes flexion/extension with ulnar/radial deviation; the single-axis angle alone cannot capture it.',
  },

  // ═══ FINGERS ═════════════════════════════════════════════
  {
    id: 'finger_stretch_onehanded',
    mode: 'fingers',
    nameEn: 'Finger stretch',
    nameHr: 'Istezanje prstiju',
    instructionsEn:
      "Push the finger of one hand backwards with another hand or a solid surface. Bonus: stretch the fingers back without help (a kind of hand-opening 'hyperextension').",
    instructionsHr:
      "Potisni prste jedne šake unatrag drugom rukom ili o čvrstu površinu. Bonus: rastegni prste unatrag bez pomoći (vrsta 'hiperekstenzije' otvaranja šake).",
    cameraSetupEn:
      'Sit facing the camera. Hold your hand in front of you at chest height, palm facing the camera, fingers pointing up.',
    cameraSetupHr:
      'Sjedni okrenuta prema kameri. Drži šaku ispred sebe u visini grudi, dlan prema kameri, prsti prema gore.',
    visibilityEn:
      'Whole hand visible with palm facing camera. If done with one hand it can be tracked, but if two hands are needed it can be complicated.',
    visibilityHr:
      'Cijela šaka vidljiva s dlanom prema kameri. Ako se izvodi jednom rukom može se pratiti, no ako su potrebne dvije ruke može biti komplicirano.',
    holdSeconds: null,
    repetitions: null,
    jointConstraints: 'Hand stays in frame; the stretched hand is the one being pushed back.',
    // PDF lists no target ROM for finger stretch.
    targetROM: null,
    expectedSuitability: 'YES',
    activeDetectors: [],
    rationale:
      'Open vs flat-extended is exactly what the openness score is calibrated for; the single hand is fully visible.',
  },
  {
    id: 'fist_making',
    mode: 'fingers',
    nameEn: 'Fist making',
    nameHr: 'Stezanje pesnice',
    instructionsEn:
      'Starting with the fingers fully extended, roll them into the palm.',
    instructionsHr:
      'Krenuvši od potpuno ispruženih prstiju, savij ih u dlan.',
    cameraSetupEn:
      'Sit facing the camera. Hold the hand in front of you at chest height, palm facing the camera, fingers pointing up.',
    cameraSetupHr:
      'Sjedni okrenuta prema kameri. Drži šaku ispred sebe u visini grudi, dlan prema kameri, prsti prema gore.',
    visibilityEn:
      'Whole hand visible, palm toward camera, throughout the open and closed positions.',
    visibilityHr:
      'Cijela šaka vidljiva, dlan prema kameri, kroz cijelu otvorenu i zatvorenu poziciju.',
    holdSeconds: null,
    repetitions: null,
    jointConstraints: 'Single hand, fully visible; thumb wraps over fingers at the end.',
    targetROM: '~90° flexion at every finger joint',
    expectedSuitability: 'YES',
    activeDetectors: [],
    rationale:
      'Closed vs open fist spans the openness score range cleanly; no occlusion.',
  },
  {
    id: 'finger_extension',
    mode: 'fingers',
    nameEn: 'Finger extension',
    nameHr: 'Ekstenzija prstiju',
    instructionsEn:
      'Actively straighten or open the fingers against resistance (e.g. using a rubber band) to engage the extensor muscles on the top of the hand and forearm.',
    instructionsHr:
      'Aktivno ispravljaj ili otvaraj prste protiv otpora (npr. gumicom) kako bi aktivirala ekstenzore na vrhu šake i podlaktice.',
    cameraSetupEn:
      'Sit facing the camera. Hold the hand in front of you at chest height, palm facing the camera, fingers pointing up.',
    cameraSetupHr:
      'Sjedni okrenuta prema kameri. Drži šaku ispred sebe u visini grudi, dlan prema kameri, prsti prema gore.',
    visibilityEn:
      'Whole hand visible with palm toward camera. The fingers spread within the image plane.',
    visibilityHr:
      'Cijela šaka vidljiva s dlanom prema kameri. Prsti se rastvaraju u ravnini slike.',
    holdSeconds: null,
    repetitions: null,
    jointConstraints: 'Palm flat; fingers extend against resistance.',
    // PDF lists no target ROM for finger extension.
    targetROM: null,
    expectedSuitability: 'PARTIAL',
    activeDetectors: ['PoseDiscrimination'],
    rationale:
      'Score reaches the high end but individual-finger discrimination falls inside the ambiguous band of the global openness average.',
  },
  {
    id: 'tendon_glides',
    mode: 'fingers',
    nameEn: 'Active finger flexor tendon glides',
    nameHr: 'Aktivno glajdanje fleksornih tetiva',
    instructionsEn:
      'Move through 5 positions in order: (1) straight hand, (2) hook fist, (3) tabletop, (4) straight fist, (5) full fist.',
    instructionsHr:
      'Prođi kroz 5 pozicija po redu: (1) ravna šaka, (2) kuka, (3) tabletop, (4) ravna pesnica, (5) puna pesnica.',
    cameraSetupEn:
      'Sit facing the camera. Hold the hand in front of you at chest height, palm facing the camera, fingers pointing up.',
    cameraSetupHr:
      'Sjedni okrenuta prema kameri. Drži šaku ispred sebe u visini grudi, dlan prema kameri, prsti prema gore.',
    visibilityEn:
      'Whole hand visible, palm toward camera. The specific finger joint configuration must be visible.',
    visibilityHr:
      'Cijela šaka vidljiva, dlan prema kameri. Konkretna konfiguracija zglobova prstiju mora biti vidljiva.',
    holdSeconds: null,
    repetitions: null,
    jointConstraints: 'Each joint must reach a target individually; not a single fist motion.',
    targetROM: '~90° flexion at every finger joint',
    expectedSuitability: 'NO',
    activeDetectors: ['PoseDiscrimination'],
    rationale:
      'Hook fist, flat fist, and full fist all map to similar mid-range openness values; the score cannot separate them.',
  },
  {
    id: 'passive_finger_flexion',
    mode: 'fingers',
    nameEn: 'Passive finger flexion',
    nameHr: 'Pasivna fleksija prstiju',
    instructionsEn:
      'Flex the affected finger(s) with the unaffected hand to achieve different positions.',
    instructionsHr:
      'Drugom (zdravom) rukom savijaj prste pogođene šake u različite pozicije.',
    cameraSetupEn:
      'Sit facing the camera with both hands in view. The affected hand is in front of you; the unaffected hand reaches over.',
    cameraSetupHr:
      'Sjedni okrenuta prema kameri tako da su obje ruke u kadru. Pogođena šaka je ispred tebe; zdrava ruka prelazi preko.',
    visibilityEn:
      'Both hands in frame; the affected hand can be totally occluded by the unaffected one.',
    visibilityHr:
      'Obje ruke u kadru; pogođena šaka može biti potpuno prekrivena zdravom.',
    holdSeconds: null,
    repetitions: null,
    jointConstraints: 'Affected hand passive; the unaffected hand applies pressure.',
    targetROM: '~90° flexion at every finger joint',
    expectedSuitability: 'NO',
    activeDetectors: ['DualHandOcclusion'],
    rationale:
      'The helper hand covers the target hand for most of the movement; landmark tracking on the target is intermittent at best.',
  },
  {
    id: 'grip_strengthening',
    mode: 'fingers',
    nameEn: 'Grip strengthening',
    nameHr: 'Jačanje stiska',
    instructionsEn:
      'Different exercises aimed at improving gripping strength.',
    instructionsHr:
      'Različite vježbe za poboljšanje snage stiska.',
    cameraSetupEn:
      'Sit facing the camera. Hold the hand with the gripped object in front of you at chest height.',
    cameraSetupHr:
      'Sjedni okrenuta prema kameri. Drži šaku s predmetom ispred sebe u visini grudi.',
    visibilityEn:
      'Hand visible holding the object; the object partially occludes the fingers. Without weights it is basically fist making; force cannot be estimated from joint angles.',
    visibilityHr:
      'Šaka vidljiva dok drži predmet; predmet djelomično zaklanja prste. Bez utega ovo je u biti stezanje pesnice; sila se ne može procijeniti iz kutova zglobova.',
    holdSeconds: null,
    repetitions: null,
    jointConstraints: 'Hand grips an object; force is the dependent variable.',
    // PDF: target ROM depends on the object held, so left unspecified.
    targetROM: null,
    expectedSuitability: 'NO',
    activeDetectors: ['HandObjectOcclusion', 'ForceRequired'],
    rationale:
      'Force cannot be inferred from kinematics, and the object occludes the fingertip landmarks throughout.',
  },
];

// ─── Lookup helpers ──────────────────────────────────────────
export function getExercisesByMode(mode: GameMode): readonly Exercise[] {
  return EXERCISES.filter((e) => e.mode === mode);
}

export function getExerciseById(id: string): Exercise | undefined {
  return EXERCISES.find((e) => e.id === id);
}

/** Default selection for a mode: first YES exercise, else first available. */
export function getDefaultExerciseForMode(mode: GameMode): Exercise | null {
  const byMode = getExercisesByMode(mode);
  return byMode.find((e) => e.expectedSuitability === 'YES') ?? byMode[0] ?? null;
}
