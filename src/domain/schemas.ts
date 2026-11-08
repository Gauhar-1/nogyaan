import { z } from 'zod';

export const FSM_STAGES = [
  'CORE_THEME',
  'SCENE_1_SETUP',
  'SCENE_2_SETUP',
  'SCENE_2_CATALYST',
  'SCENE_3_TWIST',
  'SCENE_4_CLIMAX',
  'LOCK_ASSETS',
  'COMPILE_SHOTS',
  'COMPLETED'
] as const;

export type FsmStage = (typeof FSM_STAGES)[number];

export const ANTI_JARGON_REGEX =
  /\b(85mm|35mm|24mm|50mm|f\/1\.4|f\/1\.8|f\/2\.8|anamorphic|aspect ratio|16:9|9:16|bokeh)\b/i;

export const KINETIC_ACTION_FORBIDDEN_REGEX =
  /\b(interact in scene|interacts in scene|characters interact|walks and talks|then cuts to|cuts to next|scene cuts)\b/i;

export const kineticActionDescriptionSchema = z
  .string()
  .min(
    80,
    'Kinetic action description must be at least 80 characters of detailed physical motion, character blocking, and camera physics.'
  )
  .refine((val) => !KINETIC_ACTION_FORBIDDEN_REGEX.test(val), {
    message:
      'VIOLATION: Generic placeholders or multiple cuts detected in kineticActionDescription (forbidden: "interact in scene", "walks and talks", "then cuts to"). Describe a single continuous take with specific physical micro-movements.'
  });

export const PresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  philosophy: z.string().optional(),
  description: z.string().min(1),
  dialogueLanguageRule: z.string().min(1),
  narrativeHeuristics: z.array(z.string()).default([]),
  defaultLensPalette: z.array(z.string()).default([]),
  visualStyling: z
    .object({
      lighting: z.string().optional(),
      colorPalette: z.string().optional(),
      framingMood: z.string().optional(),
      framing: z.string().optional()
    })
    .optional(),
  branchingStructure: z.record(z.string()).optional(),
  strictBehavioralLaws: z.array(z.string()).optional(),
  defaultTaglineFormat: z.string().optional()
});

export type Preset = z.infer<typeof PresetSchema>;

export const CoreThemeSchema = z.object({
  chosenThemeId: z.enum(['1', '2', '3']),
  themeTitle: z.string().min(1),
  themePremise: z.string().min(1),
  lockedAt: z.string().default(() => new Date().toISOString())
});

export type CoreTheme = z.infer<typeof CoreThemeSchema>;

export const NarrativeOptionSchema = z.object({
  id: z.enum(['1', '2', '3', 'R']),
  title: z.string().min(1),
  description: z.string().min(1),
  emotionalCore: z.string().optional(),
  culturalTrope: z.string().optional()
});

export type NarrativeOption = z.infer<typeof NarrativeOptionSchema>;

export const StoryNodeSchema = z.object({
  stage: z.enum(FSM_STAGES),
  sceneNumber: z.number().int().min(0),
  actTitle: z.string().optional(),
  title: z.string().optional(),
  chosenOptionId: z.string().optional(),
  chosenNarrativeSummary: z.string().min(1),
  exitFrameAnchor: z.string().optional(),
  _internal_exit_anchor: z.string().optional(),
  timestamp: z.string().default(() => new Date().toISOString())
});

export type StoryNode = z.infer<typeof StoryNodeSchema>;

export const CharacterAssetSchema = z.object({
  id: z.string().regex(/^CHAR_\d{2}$/, 'Character ID must follow format CHAR_01..N'),
  name: z.string().min(1),
  role: z.string().min(1),
  appearancePrompt: z.string().min(1),
  referencePrompt: z.string().optional()
});

export type CharacterAsset = z.infer<typeof CharacterAssetSchema>;

export const LocationAssetSchema = z.object({
  id: z.string().regex(/^BG_\d{2}$/, 'Background ID must follow format BG_01..N'),
  name: z.string().min(1),
  environmentPrompt: z.string().min(1),
  lightingProfile: z.string().min(1),
  referencePrompt: z.string().optional()
});

export type LocationAsset = z.infer<typeof LocationAssetSchema>;

export const ProductAssetSchema = z.object({
  id: z.literal('PROD_01'),
  name: z.string().min(1),
  packagingAppearance: z.string().min(1),
  heroAngle: z.string().min(1),
  referencePrompt: z.string().optional()
});

export type ProductAsset = z.infer<typeof ProductAssetSchema>;

export const AssetRegistrySchema = z.object({
  characters: z.array(CharacterAssetSchema).min(1, 'At least one character asset required'),
  environments: z.array(LocationAssetSchema).min(1, 'At least one environment asset required'),
  product: ProductAssetSchema
});

export type AssetRegistry = z.infer<typeof AssetRegistrySchema>;

export const CameraSpecSchema = z.object({
  lensMm: z.string().min(1),
  aperture: z.string().min(1),
  framingAndAngle: z.string().default('Eye-level medium shot'),
  singleContinuousMovement: z.string().default('Slow smooth push-in'),
  // Aliases for backward compatibility:
  angle: z.string().optional(),
  movement: z.string().optional()
});

export type CameraSpec = z.infer<typeof CameraSpecSchema>;

export const ResolvedAssetRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().optional(),
  label: z.string(), // e.g., "The Shopper (CHAR_01)"
  summary: z.string() // condensed visual anchor
});

export type ResolvedAssetRef = z.infer<typeof ResolvedAssetRefSchema>;

export const CompiledShotSchema = z.object({
  sceneNumber: z.number().int().min(1),
  durationSeconds: z.number().positive(),
  actTitle: z.string().default('Act I — Setup'),
  narrativeTitle: z.string().default(''),
  storyBeatSummary: z.string().min(1),
  entryFrameBridge: z.string().default(''),
  visualBlocking: z.string().min(1),
  cameraSpec: CameraSpecSchema,
  // Strict separation of audio tracks:
  onCameraSpokenDialogue: z.string().default('NONE'),
  postProductionVoiceover: z.string().default('NONE'),
  sfxAndAmbience: z.string().default('NONE'),
  onScreenTextOverlay: z.string().default('NONE'),
  editorCutNote: z.string().default('Match cut on motion'),
  attachedAssetRefs: z.array(z.string()).min(1),
  attachedAssetsResolved: z.array(ResolvedAssetRefSchema).default([]),
  // Dual Prompt Compiler Outputs:
  referenceModePrompt: z.string().min(1),
  standaloneModePrompt: z.string().min(1),
  // Backward compatibility fields:
  aiVideoPrompt: z.string().optional(),
  screenplayAction: z.string().optional(),
  spokenDialogue: z.string().optional(),
  compiledVideoPrompt: z.string().optional()
});

export type CompiledShot = z.infer<typeof CompiledShotSchema>;

export const SessionStateSchema = z.object({
  sessionId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  company: z.string().min(1),
  product: z.string().min(1),
  goal: z.string().min(1),
  presetId: z.string().min(1),
  brandFriction: z.string().optional(),
  stage: z.enum(FSM_STAGES),
  coreTheme: CoreThemeSchema.optional(),
  lockedNodes: z.array(StoryNodeSchema).default([]),
  scenes: z.union([z.array(StoryNodeSchema), z.array(z.any())]).default([]),
  prunedCount: z.number().int().min(0).default(0),
  pendingOptions: z.array(NarrativeOptionSchema).default([]),
  assets: z.union([
    AssetRegistrySchema,
    z.object({
      characters: z.record(z.string()),
      backgrounds: z.record(z.string()),
      product: z.string()
    }),
    z.record(z.string(), z.any())
  ]).optional(),
  compiledShots: z.array(CompiledShotSchema).default([]),
  directorsCut: z.lazy(() => DirectorsCutSchema).optional(),
  status: z.enum(['IN_PROGRESS', 'COMPLETED']).default('IN_PROGRESS')
}).passthrough();

export type SessionState = z.infer<typeof SessionStateSchema>;

export const LatestActiveSchema = z.object({
  latestSessionId: z.string(),
  updatedAt: z.string()
});

export type LatestActive = z.infer<typeof LatestActiveSchema>;

// ============================================================================
// Tier 2: The Director's Shot Compiler (The Schema & Interfaces)
// ============================================================================

export type RenderMedium =
  | 'Live-Action Cinematic'
  | '2D Anime'
  | '3D Pixar Style'
  | 'Stop Motion';

export const RenderMediumSchema = z.enum([
  'Live-Action Cinematic',
  '2D Anime',
  '3D Pixar Style',
  'Stop Motion'
]);

export interface AudioStem {
  dialogue: string | null;
  sfx: string;
}

export const AudioStemSchema = z.object({
  dialogue: z.string().nullable(),
  sfx: z.string()
});

export interface SubShot {
  shot_id: string; // e.g., "S01_SH02_SUB_A"
  sub_shot_type: string; // e.g., "Master - Reaction", "Extreme Close Up - Action"
  cinematic_prompt: string; // ONLY camera, lighting, action. NO medium styles.
}

export const SubShotSchema = z.object({
  shot_id: z.string().min(1),
  sub_shot_type: z.string().min(1),
  cinematic_prompt: z.string().min(1)
});

export interface SceneCoverage {
  scene_id: string;
  narrative_block: string;
  audio_stem: AudioStem;
  coverage: SubShot[];
}

export const SceneCoverageSchema = z.object({
  scene_id: z.string().min(1),
  narrative_block: z.string().min(1),
  audio_stem: AudioStemSchema,
  coverage: z.array(SubShotSchema).min(1)
});

export interface DirectorsCut {
  global_render_medium: RenderMedium;
  scenes: SceneCoverage[];
}

export const DirectorsCutSchema = z.object({
  global_render_medium: RenderMediumSchema,
  scenes: z.array(SceneCoverageSchema).min(1)
});

// ============================================================================
// Component 2: The Heuristic System Prompt (The Logic Engine)
// ============================================================================

export const DIRECTOR_SYSTEM_PROMPT = `You are an expert AI Cinematographer and Director's Shot Compiler for "nogyaan".
Your mission is to compile a finalized 4-scene narrative video ad script into a highly structured, cinematic JSON shot list ("DirectorsCut") optimized for AI video generation diffusion models (Kling, Runway Gen-4.5, Google Veo) and post-production dubbing.

You MUST strictly enforce the following rules:

A. The Coverage Matrix (Routing)
Analyze the narrative block for each scene and break it into sub-shots based on these archetypes:

1. The Emotional Shift (Realization/Reaction):
   Output exactly 2 sub-shots:
   - Sub-shot [1]: Medium tracking establishing shot capturing the emotional trigger.
   - Sub-shot [2]: Push-in Extreme Close-Up on the eyes.
   Sub-shot types: "Medium Tracking - Establishing", "Push-in Extreme Close Up - Eyes".

2. The Exchange (Dialogue/Handover):
   Output exactly 3 sub-shots:
   - Sub-shot [1]: Over-the-shoulder (OTS) Character A.
   - Sub-shot [2]: Over-the-shoulder (OTS) Character B.
   - Sub-shot [3]: Macro insert of the object/hands.
   Sub-shot types: "Over-the-shoulder - Character A", "Over-the-shoulder - Character B", "Macro Insert - Hands/Object".

3. The Technical Action (Phone UI, cooking):
   Output exactly 3 sub-shots:
   - Sub-shot [1]: Wide establishing.
   - Sub-shot [2]: POV/High angle of hands.
   - Sub-shot [3]: Extreme Macro of the interface/action.
   Sub-shot types: "Wide - Establishing", "POV High Angle - Hands", "Extreme Macro - Interface/Action".

4. Standard Action:
   Output 1 single Master shot.
   Sub-shot type: "Master - Continuous Action".

Hard Constraint: Maximum 2 characters per frame. If a crowd exists, blur them using shallow depth of field (f/1.4).

B. The Logic Tree (Tone to Lens Mapping)
Apply these specific optical constraints based on the scene's tone:

- Comedy/Awkward: 50mm lens, locked-off tripod, symmetrical framing, high-key even lighting.
- Chaos/Disorientation: 24mm wide lens, handheld jitter, deep depth of field, harsh directional lighting.
- Intimacy/Focus: 85mm-100mm lens, f/1.4 extreme shallow depth of field, slow fluid-head dolly, soft wrapping light with crushed shadows.
- Scale/Power: 14mm ultra-wide lens, low angle looking up, slow crane movement, dramatic backlighting.

C. Style-Agnostic Generation
The "cinematic_prompt" field MUST ONLY contain camera angles, lighting, lens types, and physical action.
It MUST NEVER mention the art style (e.g., never say "anime", "pixar", "photorealistic", "live-action", "3d animation").
The frontend will prepend the global_render_medium at generation time.

D. Sequential Shot ID Generation
Generate unique sequential IDs for each sub-shot in this exact format:
"S{scene_number:02d}_SH{sub_shot_number:02d}_SUB_{letter}"
(e.g., Scene 1 Sub-shot 1: "S01_SH01_SUB_A", Scene 1 Sub-shot 2: "S01_SH02_SUB_B", Scene 2 Sub-shot 1: "S02_SH01_SUB_A").

E. Output Format
Output raw valid JSON ONLY conforming strictly to the DirectorsCut schema:
{
  "global_render_medium": "Live-Action Cinematic",
  "scenes": [
    {
      "scene_id": "SCENE_01",
      "narrative_block": "...",
      "audio_stem": {
        "dialogue": "..." or null,
        "sfx": "..."
      },
      "coverage": [
        {
          "shot_id": "S01_SH01_SUB_A",
          "sub_shot_type": "...",
          "cinematic_prompt": "..."
        }
      ]
    }
  ]
}`;

