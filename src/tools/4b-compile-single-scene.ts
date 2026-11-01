/**
 * @file src/tools/4b-compile-single-scene.ts
 * @description MCP Tool: Compiles ONE physical scene take sequentially.
 * Enforces 5-rules of real video diffusion models and rejects generic placeholders.
 */

import { z } from 'zod';
import { DAGStore } from '../state/dag-store.js';
import { SessionDagService } from '../services/session-dag.service.js';
import { kineticActionDescriptionSchema } from '../domain/schemas.js';

export const cameraSpecInputSchema = z.object({
  lensMm: z.string().min(1).default('35mm'),
  aperture: z.string().min(1).default('f/1.8'),
  framingAndAngle: z.string().min(1).default('Eye-level medium shot'),
  singleContinuousMovement: z.string().min(1).default('Slow smooth push-in')
});

export const compileSingleSceneSchema = z.object({
  session_id: z.string().optional().describe('Target session ID'),
  scene_number: z.number().int().positive().describe('Scene number (1 to 4)'),
  duration_seconds: z.number().positive().default(5).describe('Take duration in seconds (4-8s)'),
  act_title: z.string().optional().describe('Act title (e.g., "Act I — Setup")'),
  narrative_title: z.string().optional().describe('Scene title'),
  story_beat_summary: z.string().optional().describe('Narrative beat summary'),
  entry_frame_bridge: z.string().optional().describe('Continuous pickup from previous frame (or NONE for scene 1)'),
  kinetic_action_description: kineticActionDescriptionSchema,
  camera_spec: cameraSpecInputSchema,
  on_camera_spoken_dialogue: z.string().optional().default('NONE'),
  post_production_voiceover: z.string().optional().default('NONE'),
  sfx_and_ambience: z.string().optional().default('NONE'),
  on_screen_text_overlay: z.string().optional().default('NONE'),
  editor_cut_note: z.string().optional().default('Match cut on motion'),
  attached_asset_refs: z.array(z.string()).min(1).describe('Asset references (e.g. ["@CHAR_01", "@BG_01", "@PROD_01"])')
});

export type CompileSingleSceneInput = z.infer<typeof compileSingleSceneSchema>;

export async function executeCompileSingleScene(
  input: CompileSingleSceneInput,
  sessionService?: SessionDagService
) {
  const service = sessionService || new SessionDagService();
  const validated = compileSingleSceneSchema.parse(input);

  const result = service.compileSingleScene({
    sessionId: validated.session_id,
    sceneNumber: validated.scene_number,
    durationSeconds: validated.duration_seconds,
    actTitle: validated.act_title,
    narrativeTitle: validated.narrative_title,
    storyBeatSummary: validated.story_beat_summary,
    entryFrameBridge: validated.entry_frame_bridge,
    kineticActionDescription: validated.kinetic_action_description,
    cameraSpec: validated.camera_spec,
    onCameraSpokenDialogue: validated.on_camera_spoken_dialogue,
    postProductionVoiceover: validated.post_production_voiceover,
    sfxAndAmbience: validated.sfx_and_ambience,
    onScreenTextOverlay: validated.on_screen_text_overlay,
    editorCutNote: validated.editor_cut_note,
    attachedAssetRefs: validated.attached_asset_refs
  });

  return {
    success: true,
    message: `Compiled Scene ${validated.scene_number} successfully.`,
    currentStage: result.session.stage,
    compiledShot: result.compiledShot,
    _systemDirective: result.directive
  };
}

