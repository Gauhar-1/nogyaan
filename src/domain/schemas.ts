import { z } from 'zod';

export const FSM_STAGES = [
  'CORE_THEME',
  'SCENE_1_SETUP',
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
  chosenOptionId: z.string().optional(),
  chosenNarrativeSummary: z.string().min(1),
  exitFrameAnchor: z.string().optional(),
  timestamp: z.string()
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
  angle: z.string().min(1),
  movement: z.string().min(1)
});

export type CameraSpec = z.infer<typeof CameraSpecSchema>;

export const CompiledShotSchema = z.object({
  sceneNumber: z.number().int().min(1),
  durationSeconds: z.number().positive(),
  storyBeatSummary: z.string().min(1),
  entryFrameBridge: z.string().min(1),
  screenplayAction: z.string().min(1),
  spokenDialogue: z.string().min(1),
  sfxAndAmbience: z.string().min(1),
  editorCutNote: z.string().min(1),
  cameraSpec: CameraSpecSchema,
  attachedAssetRefs: z.array(z.string()).min(1),
  aiVideoPrompt: z.string().min(1)
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
  stage: z.enum(FSM_STAGES),
  lockedNodes: z.array(StoryNodeSchema).default([]),
  prunedCount: z.number().int().min(0).default(0),
  pendingOptions: z.array(NarrativeOptionSchema).default([]),
  assets: AssetRegistrySchema.optional(),
  compiledShots: z.array(CompiledShotSchema).optional(),
  status: z.enum(['IN_PROGRESS', 'COMPLETED']).default('IN_PROGRESS')
});

export type SessionState = z.infer<typeof SessionStateSchema>;

export const LatestActiveSchema = z.object({
  latestSessionId: z.string(),
  updatedAt: z.string()
});

export type LatestActive = z.infer<typeof LatestActiveSchema>;

