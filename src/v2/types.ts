import { z } from 'zod';

// ============================================================================
// Core State Schemas (Strictly Conforming to nogyaan V2 & JIT Slicing Specification)
// ============================================================================

export type Medium = 'Live-Action Cinematic' | '2D Anime' | '3D Pixar Style';

export const MediumSchema = z.enum([
  'Live-Action Cinematic',
  '2D Anime',
  '3D Pixar Style'
]);

export interface AssetBible {
  characters: Record<string, string>; // e.g., "CHAR_01": "Sharma ji, 50s..."
  backgrounds: Record<string, string>;
  product: string;
}

export const AssetBibleSchema = z.object({
  characters: z.record(z.string()),
  backgrounds: z.record(z.string()),
  product: z.string()
});

// ============================================================================
// Minified Schemas (Just-In-Time Context Slicing)
// ============================================================================

export type WriterPitchStyle = 'Heartfelt' | 'Viral' | 'Offbeat' | string;

export interface ScriptPitch {
  id: string; // e.g., "A", "B", "C"
  style: WriterPitchStyle;
  txt: string; // The human-readable narrative block. NO camera terms.
}

export const ScriptPitchSchema = z.object({
  id: z.string().min(1),
  style: z.string().min(1),
  txt: z.string().min(1)
});

export type DpPitchStyle = 'Auteur' | 'Kinetic' | 'Theatrical';

export interface ShotPitch {
  id: string; // e.g., "A", "B", "C"
  style: DpPitchStyle;
  txt: string; // Beautiful, human-readable visual intent
  prmpt: string; // Dense AI payload: Ref tags + Lens/Lighting only
  spatial_facts?: string[]; // Optional spatial positions established in this shot
}

export const ShotPitchSchema = z.object({
  id: z.string().min(1),
  style: z.enum(['Auteur', 'Kinetic', 'Theatrical']),
  txt: z.string().min(1),
  prmpt: z.string().min(1),
  spatial_facts: z.array(z.string()).optional()
});

// Backward-compatible verbose options
export interface ShotOption {
  option_id: string;
  director_persona: 'Intimate Auteur' | 'Kinetic Documentarian' | 'Theatrical Stylist';
  visual_intent: string; // Human-readable description
  ai_payload: string; // Dense technical prompt for video models
}

export const ShotOptionSchema = z.object({
  option_id: z.string().min(1),
  director_persona: z.enum([
    'Intimate Auteur',
    'Kinetic Documentarian',
    'Theatrical Stylist'
  ]),
  visual_intent: z.string().min(1),
  ai_payload: z.string().min(1)
});

export interface ScriptOption {
  option_id: string;
  writer_persona?: string;
  style?: string;
  narrative_block: string;
  audio_stem?: {
    dialogue: string | null;
    sfx: string;
  };
}

export const ScriptOptionSchema = z.object({
  option_id: z.string().min(1),
  writer_persona: z.string().optional().default('Heartfelt Nostalgist'),
  style: z.string().optional(),
  narrative_block: z.string().min(1),
  audio_stem: z.object({
    dialogue: z.string().nullable(),
    sfx: z.string()
  }).optional()
});

export type LockedScript = ScriptPitch | ScriptOption;
export type LockedShot = ShotPitch | ShotOption | ShotNode;

// Forward declaration support: AnyLockedShotSchema defined below after ShotNodeSchema
export const AnyLockedScriptSchema = z.union([ScriptPitchSchema, ScriptOptionSchema]);

// ============================================================================
// SOTA DP Suite Interfaces (Deferred Payload & Temporal Ingress/Egress)
// ============================================================================

export interface ShotNode {
  id?: string;
  style?: string;
  visual_intent: string; // From Tool A (pitch_shot_concepts)
  sota_payload: string; // From Tool B (compile_sota_prompt)
}

export const ShotNodeSchema = z.union([
  z.object({
    id: z.string().optional(),
    style: z.string().optional(),
    visual_intent: z.string().default(''),
    sota_payload: z.string().default('')
  }),
  z.object({
    locked_shot: z.any()
  }).transform((obj) => ({
    id: obj.locked_shot?.id || obj.locked_shot?.option_id,
    style: obj.locked_shot?.style || obj.locked_shot?.director_persona,
    visual_intent: obj.locked_shot?.visual_intent || obj.locked_shot?.txt || '',
    sota_payload: obj.locked_shot?.sota_payload || obj.locked_shot?.prmpt || obj.locked_shot?.ai_payload || ''
  }))
]);

export const AnyLockedShotSchema = z.union([ShotPitchSchema, ShotOptionSchema, ShotNodeSchema]);

export interface ShotConcept {
  option: '1' | '2' | '3';
  persona: 'Auteur' | 'Kinetic' | 'Theatrical';
  visual_intent: string;
}

export const ShotConceptSchema = z.object({
  option: z.enum(['1', '2', '3']),
  persona: z.enum(['Auteur', 'Kinetic', 'Theatrical']),
  visual_intent: z.string().min(1)
});

export interface ShotConceptsPitch {
  scene_id: string;
  shot_id: string;
  concepts: Record<'1' | '2' | '3', ShotConcept>;
  spatial_memory: string[];
  last_shot_egress: string;
}

export interface Scene {
  scene_id: string;
  locked_script?: LockedScript | null;
  active_refs?: string[]; // e.g., ["@CHAR_01", "@BG_02"]
  spatial_memory: string[]; // Auto-updates with physical facts
  last_shot_egress: string; // E.g., "Hand rests on table" - passes to the next shot's Ingress
  shots: Record<string, ShotNode>;
}

export const SceneSchema = z.object({
  scene_id: z.string().min(1),
  locked_script: AnyLockedScriptSchema.nullable().default(null),
  active_refs: z.array(z.string()).default([]),
  spatial_memory: z.array(z.string()).default([]),
  last_shot_egress: z.string().default(''),
  shots: z.record(ShotNodeSchema).default({})
});

export interface NogyaanState {
  project_id: string;
  core_premise?: string;
  global_director_notes?: string; // Persistent cinematic rules (e.g., "Scene 4 must visually mirror Scene 1")
  global_medium: Medium;
  assets: AssetBible;
  scenes: Scene[];
}

export const NogyaanStateSchema = z.object({
  project_id: z.string().min(1),
  core_premise: z.string().optional(),
  global_director_notes: z.string().default(''),
  global_medium: MediumSchema,
  assets: AssetBibleSchema,
  scenes: z.array(SceneSchema)
}).passthrough();

export interface AssetExtractionResult {
  assets: AssetBible;
  scene_tagging: Record<string, string[]>; // e.g., { "SCENE_01": ["@CHAR_01", "@BG_01"] }
}

export const AssetExtractionResultSchema = z.object({
  assets: AssetBibleSchema,
  scene_tagging: z.record(z.array(z.string()))
});
