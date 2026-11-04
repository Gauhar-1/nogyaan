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

export type WriterPitchStyle = 'Heartfelt' | 'Viral' | 'Offbeat';

export interface ScriptPitch {
  id: string; // e.g., "A", "B", "C"
  style: WriterPitchStyle;
  txt: string; // The human-readable narrative block. NO camera terms.
}

export const ScriptPitchSchema = z.object({
  id: z.string().min(1),
  style: z.enum(['Heartfelt', 'Viral', 'Offbeat']),
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
  writer_persona: 'Heartfelt Nostalgist' | 'Viral Disruptor' | 'Offbeat Eccentric';
  narrative_block: string;
  audio_stem: {
    dialogue: string | null;
    sfx: string;
  };
}

export const ScriptOptionSchema = z.object({
  option_id: z.string().min(1),
  writer_persona: z.enum([
    'Heartfelt Nostalgist',
    'Viral Disruptor',
    'Offbeat Eccentric'
  ]),
  narrative_block: z.string().min(1),
  audio_stem: z.object({
    dialogue: z.string().nullable(),
    sfx: z.string()
  })
});

export type LockedScript = ScriptPitch | ScriptOption;
export type LockedShot = ShotPitch | ShotOption;

export const AnyLockedScriptSchema = z.union([ScriptPitchSchema, ScriptOptionSchema]);
export const AnyLockedShotSchema = z.union([ShotPitchSchema, ShotOptionSchema]);

export interface Scene {
  scene_id: string;
  locked_script: LockedScript | null;
  active_refs?: string[]; // e.g., ["@CHAR_01", "@BG_02"]
  spatial_memory?: string[]; // Compressed rolling array of physical facts (e.g., ["Sharma is seated at table 4", "Phone is on table"])
  shots: Record<string, { locked_shot: LockedShot | null }>; // Sequential spatial memory
}

export const SceneSchema = z.object({
  scene_id: z.string().min(1),
  locked_script: AnyLockedScriptSchema.nullable(),
  active_refs: z.array(z.string()).default([]),
  spatial_memory: z.array(z.string()).default([]),
  shots: z.record(
    z.object({
      locked_shot: AnyLockedShotSchema.nullable()
    })
  )
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
});

export interface AssetExtractionResult {
  assets: AssetBible;
  scene_tagging: Record<string, string[]>; // e.g., { "SCENE_01": ["@CHAR_01", "@BG_01"] }
}

export const AssetExtractionResultSchema = z.object({
  assets: AssetBibleSchema,
  scene_tagging: z.record(z.array(z.string()))
});
