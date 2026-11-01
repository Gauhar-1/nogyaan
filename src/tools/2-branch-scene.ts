/**
 * @file src/tools/2-branch-scene.ts
 * @description MCP Tool 2: Manages narrative branching decisions.
 * Supports 'commit' and 'regenerate' (R) actions, enforces Anti-Jargon validation,
 * returns ONLY the pruned lockedNodes array, and instructs LLM to ignore rejected branches.
 */

import { z } from "zod";
import {
  DAGStore,
  validateNoCameraJargon,
  narrativeOptionSchema,
  type NarrativeOption,
} from "../state/dag-store.js";

export const branchSceneSchema = z.object({
  action: z
    .enum(["commit", "regenerate"])
    .describe("Action type: 'commit' to lock in an option (1, 2, or 3), or 'regenerate' (R) to request new options"),
  selectedOptionId: z
    .enum(["1", "2", "3"])
    .optional()
    .describe("Selected option identifier ('1', '2', or '3'). Required when action is 'commit'"),
  nextOptions: z
    .array(narrativeOptionSchema)
    .optional()
    .describe("The 3 proposed narrative options for the current stage (if regenerating) or next stage (if committing)"),
  title: z
    .string()
    .optional()
    .describe("Optional title for the committed option (if overriding or providing directly)"),
  description: z
    .string()
    .optional()
    .describe("Optional description for the committed option"),
  treatmentProse: z
    .string()
    .optional()
    .describe("Screenplay treatment paragraph for the locked choice"),
});

export type BranchSceneInput = z.infer<typeof branchSceneSchema>;

export async function executeBranchScene(
  input: BranchSceneInput,
  store: DAGStore = new DAGStore()
) {
  const validated = branchSceneSchema.parse(input);

  // Anti-Jargon Gate: Scan all incoming narrative text for technical camera terms
  const textsToCheck: (string | undefined | null)[] = [
    validated.title,
    validated.description,
    validated.treatmentProse,
  ];
  if (validated.nextOptions) {
    for (const opt of validated.nextOptions) {
      textsToCheck.push(opt.title, opt.description, opt.treatmentProse);
    }
  }
  validateNoCameraJargon(textsToCheck);

  if (validated.action === "commit" && !validated.selectedOptionId) {
    throw new Error(
      "VIOLATION: selectedOptionId ('1', '2', or '3') is strictly required when action is 'commit'."
    );
  }

  const updatedGraph = store.branchScene({
    action: validated.action,
    selectedOptionId: validated.selectedOptionId,
    nextOptions: validated.nextOptions,
    title: validated.title,
    description: validated.description,
    treatmentProse: validated.treatmentProse,
  });

  const isNarrativeComplete = updatedGraph.currentStage === "LOCK_ASSETS";

  // Returns ONLY the pruned lockedNodes array
  return {
    success: true,
    action: validated.action,
    currentStage: updatedGraph.currentStage,
    workspaceDir: store.getWorkspaceDir(),
    storagePath: store.getFilePath(),
    prunedCount: updatedGraph.prunedCount,
    lockedNodes: updatedGraph.lockedNodes, // ONLY the authoritative locked nodes
    treatment: updatedGraph.treatment,
    isNarrativeComplete,
    _systemDirective: {
      instruction:
        "CRITICAL: IGNORE ALL REJECTED OPTIONS IN PRIOR CHAT TURNS. Only the choices in `lockedNodes` exist in the canon narrative. Do NOT revive, mix, or reference discarded alternatives.",
      nextStepRule: isNarrativeComplete
        ? "All narrative scenes (Setup, Catalyst, Twist, Climax) are locked! Now proceed to Phase 4: Call 'lock_assets' with characters (CHAR_01..N), backgrounds (BG_01..N), and product (PROD_01)."
        : `Present Option 1, Option 2, and Option 3 for stage '${updatedGraph.currentStage}' and end strictly with: 'Reply 1, 2, 3, or R (regenerate).'`,
      antiJargonRule:
        "VIOLATION: Do not include technical camera specs during narrative branching. Rewrite options focusing purely on emotion, cultural tropes, and storytelling.",
    },
    instructionsForAgent: isNarrativeComplete
      ? [
          "All narrative scenes (Setup, Catalyst, Twist, Climax) are locked into DAG state!",
          "Next step: Call 'lock_assets' to define lead character appearance prompts (CHAR_01..N), background environments (BG_01..N), and hero product (PROD_01).",
        ]
      : [
          `Active stage is now: ${updatedGraph.currentStage}.`,
          "CRITICAL: Ignore all rejected options in previous chat turns. Treat lockedNodes as the ONLY canon.",
          "Present ONLY Option 1, Option 2, and Option 3 for this stage.",
          "DO NOT include technical camera specs (e.g., focal lengths, lenses, aspect ratios).",
          "End your response STRICTLY with: 'Reply 1, 2, 3, or R (regenerate).'",
          "STOP and wait for the creator's reply.",
        ],
  };
}
