/**
 * @file src/tools/3-lock-assets.ts
 * @description MCP Tool 3: Locks visual assets (characters, environments, and product).
 * Enforces stage restriction (only after SCENE_4_CLIMAX) and strict ID patterns:
 * CHAR_01..N, BG_01..N, and PROD_01.
 */

import { z } from "zod";
import {
  DAGStore,
  characterAssetSchema,
  locationAssetSchema,
  productAssetSchema,
  type CharacterAsset,
  type LocationAsset,
  type ProductAsset,
} from "../state/dag-store.js";

export const lockAssetsSchema = z.object({
  characters: z
    .array(characterAssetSchema)
    .min(1, "At least one character asset (CHAR_01..N) is required")
    .describe("List of character asset definitions with appearance prompts (e.g., CHAR_01, CHAR_02)"),
  environments: z
    .array(locationAssetSchema)
    .min(1, "At least one environment asset (BG_01..N) is required")
    .describe("List of location asset definitions with environment prompts (e.g., BG_01, BG_02)"),
  product: productAssetSchema
    .optional()
    .describe("Hero product asset definition (must have assetId 'PROD_01')"),
});

export type LockAssetsInput = z.infer<typeof lockAssetsSchema>;

export async function executeLockAssets(
  input: LockAssetsInput,
  store: DAGStore = new DAGStore()
) {
  const validated = lockAssetsSchema.parse(input);

  // FSM Stage Lock Check: Can only be called after SCENE_4_CLIMAX is locked
  const currentGraph = store.load();
  if (currentGraph.currentStage !== "LOCK_ASSETS") {
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
        `VALIDATION ERROR: Location assetId '${e.assetId}' violates naming convention. Must match BG_01..N (e.g. 'BG_01').`
      );
    }
  }

  if (validated.product && !/^PROD_01$/i.test(validated.product.assetId)) {
    throw new Error(
      `VALIDATION ERROR: Product assetId '${validated.product.assetId}' violates naming convention. Product assetId must be strictly 'PROD_01'.`
    );
  }

  const updatedGraph = store.lockAssets({
    characters: validated.characters,
    environments: validated.environments,
    product: validated.product,
  });

  return {
    success: true,
    message: `Locked ${updatedGraph.characters.length} characters, ${updatedGraph.environments.length} environments, and product PROD_01 into DAG AssetRegistry.`,
    currentStage: updatedGraph.currentStage,
    workspaceDir: store.getWorkspaceDir(),
    storagePath: store.getFilePath(),
    assetRegistry: updatedGraph.assetRegistry,
    characters: updatedGraph.characters,
    environments: updatedGraph.environments,
    product: updatedGraph.assetRegistry.product,
    instructionsForAgent: [
      "Visual assets are immutably locked in AssetRegistry.",
      "The state machine is now at stage: COMPILE_SHOTS.",
      "Now call 'compile_shots' with the breakdown of technical camera shots.",
      "CRITICAL: Every shot MUST reference only existing characterIds (CHAR_01..N) and backgroundIds (BG_01..N) from the locked AssetRegistry.",
    ],
  };
}
