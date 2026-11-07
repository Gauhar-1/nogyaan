/**
 * @file src/tools/3-lock-assets.ts
 * @description MCP Tool 3: Locks visual assets (characters, environments, and product).
 * Enforces stage restriction (only after SCENE_4_CLIMAX) and strict ID patterns:
 * CHAR_01..N, BG_01..N, and PROD_01.
 */

import { z } from 'zod';
import {
  DAGStore,
  characterAssetSchema,
  locationAssetSchema,
  productAssetSchema
} from '../state/dag-store.js';
import { PromptCompilerService } from '../services/prompt-compiler.service.js';
import { PresetRegistryService } from '../services/preset-registry.service.js';

export const lockAssetsSchema = z.object({
  session_id: z.string().optional().describe('Target session ID'),
  characters: z
    .array(characterAssetSchema)
    .min(1, 'At least one character asset (CHAR_01..N) is required')
    .describe('List of character asset definitions with appearance prompts (e.g., CHAR_01, CHAR_02)'),
  environments: z
    .array(locationAssetSchema)
    .min(1, 'At least one environment asset (BG_01..N) is required')
    .describe('List of location asset definitions with environment prompts (e.g., BG_01, BG_02)'),
  product: productAssetSchema
    .optional()
    .describe("Hero product asset definition (must have assetId 'PROD_01')")
});

export type LockAssetsInput = z.infer<typeof lockAssetsSchema>;

const promptCompiler = new PromptCompilerService();
const presetRegistry = new PresetRegistryService();

export async function executeLockAssets(
  input: LockAssetsInput,
  store: DAGStore = new DAGStore()
) {
  const validated = lockAssetsSchema.parse(input);

  // FSM Stage Lock Check: Can only be called after SCENE_4_CLIMAX is locked
  const currentGraph = store.load(validated.session_id);
  if (currentGraph.currentStage !== 'LOCK_ASSETS') {
    throw new Error(
      `FSM STAGE VIOLATION: Cannot call lock_assets while in stage '${currentGraph.currentStage}'. lock_assets can only be called after SCENE_4_CLIMAX is locked (expected stage: 'LOCK_ASSETS').`
    );
  }

  // ID conventions check
  for (const c of validated.characters) {
    if (!/^CHAR_\d+$/i.test(c.assetId)) {
      throw new Error(
        `VALIDATION ERROR: Character assetId '${c.assetId}' violates naming convention. Must match CHAR_01..N (e.g. 'CHAR_01').`
      );
    }
  }

  for (const e of validated.environments) {
    if (!/^BG_\d+$/i.test(e.assetId)) {
      throw new Error(
        `VALIDATION ERROR: Environment assetId '${e.assetId}' violates naming convention. Must match BG_01..N (e.g. 'BG_01').`
      );
    }
  }

  if (validated.product && validated.product.assetId.toUpperCase() !== 'PROD_01') {
    throw new Error(
      `VALIDATION ERROR: Product assetId '${validated.product.assetId}' violates naming convention. Must strictly be 'PROD_01'.`
    );
  }

  // Enrich assets with image generation prompts for Midjourney / Flux
  const enrichedCharacters = validated.characters.map((c) => ({
    ...c,
    referencePrompt: promptCompiler.generateCharacterImagePrompt({
      id: c.assetId.toUpperCase(),
      name: c.name,
      role: c.role || 'Lead',
      appearancePrompt: c.appearancePrompt
    })
  }));

  const enrichedEnvironments = validated.environments.map((e) => ({
    ...e,
    referencePrompt: promptCompiler.generateLocationImagePrompt({
      id: e.assetId.toUpperCase(),
      name: e.name,
      environmentPrompt: e.environmentPrompt,
      lightingProfile: e.lightingProfile || 'Cinematic atmospheric lighting'
    })
  }));

  const enrichedProduct = validated.product
    ? {
        ...validated.product,
        referencePrompt: promptCompiler.generateProductImagePrompt({
          id: 'PROD_01',
          name: validated.product.name,
          packagingAppearance: validated.product.productPrompt,
          heroAngle: 'Front 45-degree hero angle'
        })
      }
    : undefined;

  const updatedGraph = store.lockAssets({
    sessionId: validated.session_id,
    characters: enrichedCharacters,
    environments: enrichedEnvironments,
    product: enrichedProduct
  });

  const presetId = updatedGraph.brief?.preset || 'indian-d2c-story';
  const activePreset = presetRegistry.getPresetById(presetId);
  const languageRule = activePreset?.dialogueLanguageRule || 'Strictly adhere to preset language rules.';

  return {
    success: true,
    message: `Locked ${validated.characters.length} characters, ${validated.environments.length} environments, and product asset into DAG state. Transitioned to COMPILE_SHOTS.`,
    currentStage: updatedGraph.currentStage,
    workspaceDir: store.getWorkspaceDir(),
    storagePath: store.getFilePath(),
    assetRegistry: updatedGraph.assetRegistry,
    dialogueLanguageRule: languageRule,
    _systemDirective: {
      instruction:
        'All visual assets are locked. Proceed to Phase 5: Call compile_shots with reference-tagged kinetic video prompts (@CHAR_01, @BG_01, @PROD_01).',
      nextStepRule: "Call 'compile_shots' to finalize camera geometry and open the Studio UI.",
      languageRule
    },
    instructionsForAgent: [
      'Visual asset references are now immutably locked in state.',
      'Active stage is now: COMPILE_SHOTS.',
      'Next step: Call `compile_shots` with the complete shot breakdown.',
      'Every shot must reference ONLY valid locked IDs: characters (@CHAR_01..N), backgrounds (@BG_01..N), and product (@PROD_01).',
      'Do not output bloated descriptions in shot prompts—the server will compile concise reference-tagged kinetic prompts.'
    ]
  };
}
