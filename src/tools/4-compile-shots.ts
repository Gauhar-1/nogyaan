/**
 * @file src/tools/4-compile-shots.ts
 * @description MCP Tool 4: Compiles technical shots with reference-tagged kinetic video prompts.
 * Enforces stage restriction (only after LOCK_ASSETS), referential integrity check against AssetRegistry,
 * server-side auto-compilation via PromptCompilerService, and studio UI opening.
 */

import { z } from 'zod';
import open from 'open';
import {
  DAGStore,
  sceneShotSchema,
  type SceneShot
} from '../state/dag-store.js';
import { PromptCompilerService } from '../services/prompt-compiler.service.js';
import { PresetRegistryService } from '../services/preset-registry.service.js';

export const cameraSpecInputSchema = z.object({
  lensMm: z.string().default('50mm'),
  aperture: z.string().default('f/1.8'),
  angle: z.string().default('MEDIUM_SHOT'),
  movement: z.string().default('STATIC')
});

export const compileShotItemSchema = z.object({
  // Fix 5 Modern Schema
  sceneNumber: z.number().int().positive().optional(),
  durationSeconds: z.number().positive().optional(),
  storyBeatSummary: z.string().optional(),
  entryFrameBridge: z.string().optional(),
  screenplayAction: z.string().optional(),
  spokenDialogue: z.string().optional(),
  sfxAndAmbience: z.string().optional(),
  editorCutNote: z.string().optional(),
  cameraSpec: cameraSpecInputSchema.optional(),
  attachedAssetRefs: z.array(z.string()).optional(),

  // Legacy Schema Backwards Compatibility
  sceneId: z.string().optional(),
  order: z.number().int().positive().optional(),
  title: z.string().optional(),
  action: z.string().optional(),
  dialogue: z.string().optional(),
  characterId: z.string().optional(),
  characterIds: z.array(z.string()).optional(),
  backgroundId: z.string().optional(),
  locationId: z.string().optional(),
  lens: z.string().optional(),
  cameraAngle: z.enum([
    'CAM_A_CENTER',
    'CAM_B_45_CLOSE',
    'CAM_C_OTS',
    'CLOSE_UP',
    'MEDIUM_SHOT',
    'WIDE_SHOT',
    'EXTREME_CLOSE_UP',
    'ESTABLISHING'
  ]).optional(),
  cameraMovement: z.enum([
    'STATIC',
    'PUSH_IN',
    'PULL_OUT',
    'PAN_LEFT',
    'PAN_RIGHT',
    'TILT_UP',
    'TILT_DOWN',
    'TRACKING',
    'ORBIT'
  ]).optional(),
  duration: z.number().positive().optional(),
  imagePrompt: z.string().optional(),
  motionPrompt: z.string().optional()
});

export const compileShotsSchema = z.object({
  session_id: z.string().optional().describe('Target session ID'),
  shots: z
    .array(compileShotItemSchema)
    .min(1, 'At least one shot is required to compile a storyboard'),
  openStudioUi: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether to automatically open the visual studio UI at http://localhost:4321')
});

export type CompileShotsInput = z.infer<typeof compileShotsSchema>;

const promptCompiler = new PromptCompilerService();
const presetRegistry = new PresetRegistryService();

export async function executeCompileShots(
  input: CompileShotsInput,
  store: DAGStore = new DAGStore()
) {
  const validated = compileShotsSchema.parse(input);

  // FSM Stage Lock Check: Can only be called after LOCK_ASSETS
  const currentGraph = store.load();
  if (currentGraph.currentStage !== 'COMPILE_SHOTS') {
    throw new Error(
      `FSM STAGE VIOLATION: Cannot call compile_shots while in stage '${currentGraph.currentStage}'. compile_shots can only be called after LOCK_ASSETS (expected stage: 'COMPILE_SHOTS').`
    );
  }

  const regChars = currentGraph.assetRegistry.characters;
  const regBgs = currentGraph.assetRegistry.environments;
  const availableCharIds = Object.keys(regChars);
  const availableBgIds = Object.keys(regBgs);

  // Convert input items to standard sceneShot format for store.compileShots
  const rawShots: SceneShot[] = validated.shots.map((s, idx) => {
    const order = s.sceneNumber || s.order || idx + 1;
    const sceneId = s.sceneId || `SCENE_${String(order).padStart(2, '0')}`;
    const action = s.screenplayAction || s.action || 'Characters interact in scene';
    const dialogue = s.spokenDialogue || s.dialogue || '';

    // Extract attached assets
    let charId = s.characterId;
    let bgId = s.backgroundId || s.locationId;
    const charIds: string[] = s.characterIds ? [...s.characterIds] : [];

    if (s.attachedAssetRefs && Array.isArray(s.attachedAssetRefs)) {
      for (const ref of s.attachedAssetRefs) {
        const cleanRef = ref.replace(/^@/, '').toUpperCase();
        if (/^CHAR_\d+$/.test(cleanRef)) {
          if (!charId) charId = cleanRef;
          if (!charIds.includes(cleanRef)) charIds.push(cleanRef);
        } else if (/^BG_\d+$/.test(cleanRef)) {
          if (!bgId) bgId = cleanRef;
        }
      }
    }

    if (charId && !charIds.includes(charId)) {
      charIds.push(charId);
    }

    // Default lens / camera spec
    const lensMm = s.cameraSpec?.lensMm || (s.lens?.includes('mm') ? s.lens.split(' ')[0] : '50mm');
    const aperture = s.cameraSpec?.aperture || 'f/1.8';
    const angle = (s.cameraSpec?.angle || s.cameraAngle || 'MEDIUM_SHOT') as any;
    const movement = (s.cameraSpec?.movement || s.cameraMovement || 'STATIC') as any;

    const lens = s.lens || `${lensMm} ${aperture} cinematic lens`;

    return {
      sceneId,
      order,
      title: s.title || s.storyBeatSummary || `Scene ${order}`,
      action,
      dialogue,
      characterId: charId,
      characterIds: charIds.length > 0 ? charIds : charId ? [charId] : [],
      backgroundId: bgId,
      locationId: bgId || '',
      lens,
      cameraAngle: angle,
      cameraMovement: movement,
      duration: s.durationSeconds || s.duration || 5,
      imagePrompt: s.imagePrompt || '',
      motionPrompt: s.sfxAndAmbience || s.motionPrompt || '',
      compiledVideoPrompt: ''
    };
  });

  // Store executes referential integrity check and server-side auto-compilation
  const updatedGraph = store.compileShots(rawShots);

  // Also compile reference-tagged kinetic video prompts via PromptCompilerService
  const modernCompiledShots = validated.shots.map((s, idx) => {
    const sceneNum = s.sceneNumber || s.order || idx + 1;
    const rawShot = updatedGraph.shots[idx] || updatedGraph.shots[0];

    const refs = s.attachedAssetRefs || [
      ...(rawShot.characterIds?.map((c) => `@${c}`) || []),
      rawShot.backgroundId ? `@${rawShot.backgroundId}` : '@BG_01',
      '@PROD_01'
    ];

    const cameraSpec = s.cameraSpec || {
      lensMm: s.lens?.includes('mm') ? s.lens.split(' ')[0] : '50mm',
      aperture: 'f/1.8',
      angle: rawShot.cameraAngle || 'MEDIUM_SHOT',
      movement: rawShot.cameraMovement || 'STATIC'
    };

    const lockedBeat = updatedGraph.lockedNodes.find((n) => n.step === sceneNum);

    const kineticPrompt = promptCompiler.compileVideoPrompt({
      cameraSpec,
      attachedAssetRefs: refs,
      kineticMotion: s.screenplayAction || rawShot.action,
      spokenDialogue: s.spokenDialogue || rawShot.dialogue || 'NONE (SFX only)',
      sfxAndAmbience: s.sfxAndAmbience || rawShot.motionPrompt || 'Atmospheric audio'
    });

    return {
      sceneNumber: sceneNum,
      durationSeconds: s.durationSeconds || rawShot.duration || 5,
      storyBeatSummary: s.storyBeatSummary || lockedBeat?.title || rawShot.title,
      entryFrameBridge: s.entryFrameBridge || (lockedBeat?.treatmentProse ? `Connecting from: ${lockedBeat.treatmentProse}` : 'Opening scene frame'),
      screenplayAction: s.screenplayAction || rawShot.action,
      spokenDialogue: s.spokenDialogue || rawShot.dialogue || 'NONE (SFX only)',
      sfxAndAmbience: s.sfxAndAmbience || rawShot.motionPrompt || 'Atmospheric audio',
      editorCutNote: s.editorCutNote || 'Cut on physical movement',
      cameraSpec,
      attachedAssetRefs: refs.map((r) => r.startsWith('@') ? r : `@${r}`),
      aiVideoPrompt: kineticPrompt,
      compiledVideoPrompt: rawShot.compiledVideoPrompt // Backwards compatibility for tests
    };
  });

  const totalRuntimeSeconds = updatedGraph.shots.reduce(
    (acc, shot) => acc + (shot.duration || 5),
    0
  );

  let openedUi = false;
  if (validated.openStudioUi) {
    try {
      await open('http://localhost:4321');
      openedUi = true;
    } catch (err) {
      console.warn('[compile_shots] Could not open browser automatically:', err);
    }
  }

  const presetId = updatedGraph.brief?.preset || 'indian-d2c-story';
  const activePreset = presetRegistry.getPresetById(presetId);
  const languageRule = activePreset?.dialogueLanguageRule || 'Strictly adhere to preset language rules.';

  return {
    success: true,
    message: `Compiled ${updatedGraph.shots.length} shots (${totalRuntimeSeconds}s total runtime) into storyboard state. Server-side prompt auto-compilation complete.`,
    currentStage: updatedGraph.currentStage,
    workspaceDir: store.getWorkspaceDir(),
    storagePath: store.getFilePath(),
    totalRuntimeSeconds,
    shotsCount: updatedGraph.shots.length,
    shots: updatedGraph.shots,
    modernCompiledShots,
    studioUrl: 'http://localhost:4321',
    openedUi,
    dialogueLanguageRule: languageRule,
    instructionsForAgent: [
      'Storyboard pipeline compilation is complete! Current stage: COMPLETED.',
      'All video prompts were compiled server-side strictly from locked character and environment prompts.',
      'The user can inspect the live visual graph, character anchors, and shot matrix at http://localhost:4321.',
      'Summarize the final cinematic narrative, shot count, and celebrate the completed campaign film.'
    ]
  };
}
