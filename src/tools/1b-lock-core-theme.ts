/**
 * @file src/tools/1b-lock-core-theme.ts
 * @description MCP Tool: Locks the overarching Core Campaign Premise.
 * A Core Theme is an abstract narrative concept, NOT a physical scene.
 */

import { z } from 'zod';
import { DAGStore, validateNoCameraJargon, narrativeOptionSchema } from '../state/dag-store.js';

export const lockCoreThemeSchema = z.object({
  session_id: z.string().optional().describe('Target session ID'),
  chosen_theme_id: z.enum(['1', '2', '3']).describe('Selected core theme route ("1", "2", or "3")'),
  theme_title: z.string().min(1, 'Theme title is required'),
  theme_premise: z.string().min(1, 'Theme premise is required'),
  nextOptions: z.array(narrativeOptionSchema).optional().describe('Proposed 3 opening visual scenarios for Scene 1 (Act I — Setup)')
});

export type LockCoreThemeInput = z.infer<typeof lockCoreThemeSchema>;

export async function executeLockCoreTheme(
  input: LockCoreThemeInput,
  store: DAGStore = new DAGStore()
) {
  const validated = lockCoreThemeSchema.parse(input);

  validateNoCameraJargon([
    validated.theme_title,
    validated.theme_premise,
    validated.nextOptions
  ]);

  const updatedGraph = store.lockCoreTheme({
    sessionId: validated.session_id,
    chosenThemeId: validated.chosen_theme_id,
    themeTitle: validated.theme_title,
    themePremise: validated.theme_premise,
    nextOptions: validated.nextOptions
  });

  return {
    success: true,
    message: `Core theme "${validated.theme_title}" locked. Transitioned to SCENE_1_SETUP.`,
    currentStage: updatedGraph.currentStage,
    workspaceDir: store.getWorkspaceDir(),
    storagePath: store.getFilePath(),
    _systemDirective: {
      instruction: `Core theme locked: "${validated.theme_title}". Now propose 3 opening visual scenarios for SCENE 1 (Act I — Setup) that establish this premise from scratch. Scene 1 has NO previous exit frame.`,
      currentStage: updatedGraph.currentStage,
      nextStage: 'SCENE_1_SETUP'
    }
  };
}

