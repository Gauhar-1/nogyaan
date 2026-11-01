/**
 * @file src/tools/4-compile-shots.ts
 * @description MCP Tool 4: Compiles technical shots with camera geometry.
 * Enforces stage restriction (only after LOCK_ASSETS), referential integrity check against AssetRegistry,
 * server-side auto-compilation of compiledVideoPrompt, and studio UI opening.
 */

import { z } from "zod";
import open from "open";
import {
  DAGStore,
  sceneShotSchema,
  type SceneShot,
} from "../state/dag-store.js";

export const compileShotItemSchema = z.object({
  sceneId: z.string().min(1, "sceneId is required").describe("Identifier for the scene (e.g., 'SCENE_01', 'SHOT_01')"),
  order: z.number().int().positive().optional().describe("Sequential order of the shot (1, 2, 3...)"),
  title: z.string().optional().default("").describe("Short descriptive title for this shot"),
  action: z.string().min(1, "Scene action is required").describe("Physical action or movement taking place in the shot"),
  dialogue: z.string().optional().default("").describe("Spoken dialogue or voiceover script"),
  characterId: z.string().optional().describe("Primary character asset ID (must exist in AssetRegistry, e.g. 'CHAR_01')"),
  characterIds: z.array(z.string()).optional().describe("All character asset IDs present in this shot"),
  backgroundId: z.string().optional().describe("Environment asset ID (must exist in AssetRegistry, e.g. 'BG_01')"),
  locationId: z.string().optional().describe("Alternative field for environment asset ID (must exist in AssetRegistry, e.g. 'BG_01')"),
  lens: z.string().optional().default("35mm cinematic lens").describe("Camera lens specification (e.g. '35mm anamorphic', '50mm prime', '24mm wide')"),
  cameraAngle: z.enum([
    "CAM_A_CENTER",
    "CAM_B_45_CLOSE",
    "CAM_C_OTS",
    "CLOSE_UP",
    "MEDIUM_SHOT",
    "WIDE_SHOT",
    "EXTREME_CLOSE_UP",
    "ESTABLISHING",
  ]).optional().default("CAM_A_CENTER").describe("Framing angle for the camera"),
  cameraMovement: z.enum([
    "STATIC",
    "PUSH_IN",
    "PULL_OUT",
    "PAN_LEFT",
    "PAN_RIGHT",
    "TILT_UP",
    "TILT_DOWN",
    "TRACKING",
    "ORBIT",
  ]).optional().default("STATIC").describe("Camera movement type"),
  duration: z.number().positive().optional().default(5).describe("Duration in seconds"),
  imagePrompt: z.string().optional().default("").describe("Optional placeholder image prompt (overwritten by auto-compiler)"),
  motionPrompt: z.string().optional().default("").describe("Optional motion dynamics descriptor"),
});

export const compileShotsSchema = z.object({
  shots: z
    .array(compileShotItemSchema)
    .min(1, "At least one shot is required to compile a storyboard"),
  openStudioUi: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to automatically open the visual studio UI at http://localhost:4321"),
});

export type CompileShotsInput = z.infer<typeof compileShotsSchema>;

export async function executeCompileShots(
  input: CompileShotsInput,
  store: DAGStore = new DAGStore()
) {
  const validated = compileShotsSchema.parse(input);

  // FSM Stage Lock Check: Can only be called after LOCK_ASSETS (i.e. stage is COMPILE_SHOTS)
  const currentGraph = store.load();
  if (currentGraph.currentStage !== "COMPILE_SHOTS") {
    throw new Error(
      `FSM STAGE VIOLATION: Cannot call compile_shots while in stage '${currentGraph.currentStage}'. compile_shots can only be called after LOCK_ASSETS (expected stage: 'COMPILE_SHOTS').`
    );
  }

  // Convert input items to standard sceneShot format for store.compileShots
  const rawShots: SceneShot[] = validated.shots.map((s, idx) => ({
    sceneId: s.sceneId,
    order: s.order || idx + 1,
    title: s.title || `Shot ${s.order || idx + 1}`,
    action: s.action,
    dialogue: s.dialogue || "",
    characterId: s.characterId,
    characterIds: s.characterIds || (s.characterId ? [s.characterId] : []),
    backgroundId: s.backgroundId || s.locationId,
    locationId: s.locationId || s.backgroundId || "",
    lens: s.lens || "35mm cinematic lens",
    cameraAngle: s.cameraAngle || "CAM_A_CENTER",
    cameraMovement: s.cameraMovement || "STATIC",
    duration: s.duration || 5,
    imagePrompt: s.imagePrompt || "",
    motionPrompt: s.motionPrompt || "",
    compiledVideoPrompt: "",
  }));

  // Store executes referential integrity check and server-side auto-compilation
  const updatedGraph = store.compileShots(rawShots);

  const totalRuntimeSeconds = updatedGraph.shots.reduce(
    (acc, shot) => acc + (shot.duration || 5),
    0
  );

  let openedUi = false;
  if (validated.openStudioUi) {
    try {
      await open("http://localhost:4321");
      openedUi = true;
    } catch (err) {
      console.warn("[compile_shots] Could not open browser automatically:", err);
    }
  }

  return {
    success: true,
    message: `Compiled ${updatedGraph.shots.length} shots (${totalRuntimeSeconds}s total runtime) into storyboard state. Server-side prompt auto-compilation complete.`,
    currentStage: updatedGraph.currentStage,
    workspaceDir: store.getWorkspaceDir(),
    storagePath: store.getFilePath(),
    totalRuntimeSeconds,
    shotsCount: updatedGraph.shots.length,
    shots: updatedGraph.shots,
    studioUrl: "http://localhost:4321",
    openedUi,
    instructionsForAgent: [
      "Storyboard pipeline compilation is complete! Current stage: COMPLETED.",
      "All video prompts were compiled server-side strictly from locked character and environment prompts.",
      "The user can inspect the live visual graph, character anchors, and shot matrix at http://localhost:4321.",
      "Summarize the final cinematic narrative, shot count, and celebrate the completed campaign film.",
    ],
  };
}
