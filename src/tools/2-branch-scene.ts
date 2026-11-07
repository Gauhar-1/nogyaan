/**
 * @file src/tools/2-branch-scene.ts
 * @description MCP Tool 2: Manages narrative branching decisions.
 * Supports 'commit' and 'regenerate' (R) actions, enforces Anti-Jargon validation,
 * returns ONLY the pruned lockedNodes array, and enforces the physical continuity lock (exit_frame_anchor).
 */

import { z } from 'zod';
import {
  DAGStore,
  validateNoCameraJargon,
  narrativeOptionSchema
} from '../state/dag-store.js';
import { PresetRegistryService } from '../services/preset-registry.service.js';

export const branchSceneSchema = z.object({
  action: z
    .enum(['commit', 'regenerate'])
    .describe("Action type: 'commit' to lock in an option (1, 2, or 3), or 'regenerate' (R) to request new options"),
  session_id: z.string().optional().describe('Target session identifier'),
  scene_number: z.number().int().optional().describe('Scene number (1 to 4)'),
  chosen_option_id: z
    .enum(['1', '2', '3'])
    .optional()
    .describe("Selected option identifier ('1', '2', or '3'). Required when action is 'commit'"),
  selectedOptionId: z
    .enum(['1', '2', '3'])
    .optional()
    .describe("Alias for chosen_option_id"),
  chosen_narrative_summary: z
    .string()
    .optional()
    .describe('Full narrative beat so no story details are dropped'),
  title: z.string().optional().describe('Title for the committed option'),
  description: z.string().optional().describe('Description for the committed option'),
  treatmentProse: z.string().optional().describe('Screenplay treatment paragraph for the locked choice'),
  exit_frame_anchor: z
    .string()
    .optional()
    .describe('Exact physical state, character posture, and location at the final millisecond of this scene'),
  nextOptions: z
    .array(narrativeOptionSchema)
    .optional()
    .describe('The 3 proposed narrative options for the current stage (if regenerating) or next stage (if committing)'),
  pruning_confirmation: z
    .array(z.string())
    .optional()
    .describe('IDs of rejected branches purged')
});

export type BranchSceneInput = z.infer<typeof branchSceneSchema>;

const presetRegistry = new PresetRegistryService();

export async function executeBranchScene(
  input: BranchSceneInput,
  store: DAGStore = new DAGStore()
) {
  const validated = branchSceneSchema.parse(input);

  const selectedOption = validated.chosen_option_id || validated.selectedOptionId;
  const summary =
    validated.chosen_narrative_summary ||
    validated.treatmentProse ||
    validated.description ||
    validated.title ||
    '';

  // Anti-Jargon Gate: Scan all incoming narrative text for technical camera terms
  const textsToCheck: (string | undefined | null)[] = [
    validated.title,
    validated.description,
    validated.treatmentProse,
    validated.chosen_narrative_summary,
    validated.exit_frame_anchor
  ];
  if (validated.nextOptions) {
    for (const opt of validated.nextOptions) {
      textsToCheck.push(opt.title, opt.description, opt.treatmentProse);
    }
  }
  validateNoCameraJargon(textsToCheck);

  if (validated.action === 'commit' && !selectedOption) {
    throw new Error(
      "VIOLATION: selectedOptionId ('1', '2', or '3') is strictly required when action is 'commit'."
    );
  }

  const updatedGraph = store.branchScene({
    sessionId: validated.session_id,
    action: validated.action,
    selectedOptionId: selectedOption,
    nextOptions: validated.nextOptions,
    title: validated.title,
    description: validated.description,
    treatmentProse: summary || validated.treatmentProse
  });

  const isNarrativeComplete = updatedGraph.currentStage === 'LOCK_ASSETS';

  const presetId = updatedGraph.brief?.preset || 'indian-d2c-story';
  const activePreset = presetRegistry.getPresetById(presetId);
  const languageRule = activePreset?.dialogueLanguageRule || 'Strictly adhere to preset language rules.';

  const currentLockedCount = updatedGraph.lockedNodes.length;
  const sceneNum = validated.scene_number || currentLockedCount;
  const exitAnchor =
    validated.exit_frame_anchor ||
    `Scene ${sceneNum} ends on character reaction frame.`;

  let continuityBridge: string | undefined;
  if (!isNarrativeComplete && validated.action === 'commit') {
    continuityBridge =
      `[🎛️ Preset: ${presetId} | Session: ${updatedGraph.projectId} | Pruned: 2 rejected branches wiped]\n` +
      `[🔗 MANDATORY CONTINUITY BRIDGE]: Scene ${sceneNum} ended at this exact physical frame: "${exitAnchor}".\n` +
      `Every single one of your 3 options for Scene ${sceneNum + 1} MUST physically and visually connect to this exact state.\n` +
      `[🗣️ LANGUAGE RULE]: ${languageRule}`;
  }

  return {
    success: true,
    action: validated.action,
    currentStage: updatedGraph.currentStage,
    workspaceDir: store.getWorkspaceDir(),
    storagePath: store.getFilePath(),
    prunedCount: updatedGraph.prunedCount,
    lockedNodes: updatedGraph.lockedNodes,
    treatment: updatedGraph.treatment,
    isNarrativeComplete,
    continuityBridge,
    dialogueLanguageRule: languageRule,
    _systemDirective: {
      instruction:
        'CRITICAL: IGNORE ALL REJECTED OPTIONS IN PRIOR CHAT TURNS. Only the choices in `lockedNodes` exist in the canon narrative. Do NOT revive, mix, or reference discarded alternatives.',
      nextStepRule: isNarrativeComplete
        ? "All narrative scenes (Setup, Catalyst, Twist, Climax) are locked! Now proceed to Phase 4: Call 'lock_assets' with characters (CHAR_01..N), backgrounds (BG_01..N), and product (PROD_01)."
        : `Present Option 1, Option 2, and Option 3 for stage '${updatedGraph.currentStage}' and end strictly with: 'Reply 1, 2, 3, or R (regenerate).'`,
      antiJargonRule:
        'VIOLATION: Do not include technical camera specs during narrative branching. Rewrite options focusing purely on emotion, cultural tropes, and storytelling.',
      languageRule,
      continuityBridge
    },
    instructionsForAgent: isNarrativeComplete
      ? [
          'All narrative scenes (Setup, Catalyst, Twist, Climax) are locked into DAG state!',
          "Next step: Call 'lock_assets' to define lead character appearance prompts (CHAR_01..N), background environments (BG_01..N), and hero product (PROD_01)."
        ]
      : [
          `Active stage is now: ${updatedGraph.currentStage}.`,
          'CRITICAL: Ignore all rejected options in previous chat turns. Treat lockedNodes as the ONLY canon.',
          continuityBridge || '',
          'Present ONLY Option 1, Option 2, and Option 3 for this stage.',
          'DO NOT include technical camera specs (e.g., focal lengths, lenses, aspect ratios).',
          "End your response STRICTLY with: 'Reply 1, 2, 3, or R (regenerate).'",
          "STOP and wait for the creator's reply."
        ]
  };
}
