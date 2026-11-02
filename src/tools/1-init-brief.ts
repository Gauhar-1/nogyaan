/**
 * @file src/tools/1-init-brief.ts
 * @description MCP Tool 1: Initializes the campaign brief and sets state to CORE_THEME.
 * Enforces Anti-Jargon validation and returns a strict _systemDirective block.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  DAGStore,
  validateNoCameraJargon,
  narrativeOptionSchema
} from '../state/dag-store.js';
import { PresetRegistryService } from '../services/preset-registry.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const initBriefSchema = z.object({
  company: z.string().min(1, 'Company name is required').describe('Company or brand name'),
  product: z.string().min(1, 'Product is required').describe('Specific product or service being promoted'),
  goal: z.string().min(1, 'Campaign goal is required').describe('Core business objective or conversion goal for this campaign'),
  audience: z.string().optional().describe('Target demographic or cultural segment'),
  preset: z.string().default('indian-d2c-story').describe('Narrative framework preset (e.g. indian-d2c-story, dev-product-launch, tiktok-ugc-hook)'),
  preset_id: z.string().optional().describe('Alias for preset'),
  brandFriction: z.string().optional().describe('The deep emotional or everyday human friction this brand resolves'),
  initialOptions: z.array(narrativeOptionSchema).optional().describe('Optional initial narrative options 1, 2, 3 for CORE_THEME')
});

export type InitBriefInput = z.infer<typeof initBriefSchema>;

const presetRegistry = new PresetRegistryService();

export async function executeInitBrief(
  input: InitBriefInput,
  store: DAGStore = new DAGStore()
) {
  const validated = initBriefSchema.parse(input);

  // Anti-Jargon Gate: Reject any premature camera specs
  validateNoCameraJargon([
    validated.company,
    validated.product,
    validated.goal,
    validated.audience,
    validated.brandFriction
  ]);
  if (validated.initialOptions) {
    for (const opt of validated.initialOptions) {
      validateNoCameraJargon([opt.title, opt.description, opt.treatmentProse]);
    }
  }

  const presetId = validated.preset_id || validated.preset;
  const activePreset = presetRegistry.getPresetById(presetId) || {
    id: presetId,
    name: presetId,
    description: 'Ad Director Storytelling Preset',
    dialogueLanguageRule: presetId === 'indian-d2c-story'
      ? 'Write spoken character dialogue and emotional idioms in natural conversational Hinglish (Romanized Hindi + English). Keep all camera, lens, and action directions in 100% English.'
      : 'STRICTLY 100% English for all dialogue, voiceover, and directions. ZERO Hinglish, Hindi words, or regional Indian slang allowed.'
  };

  const friction =
    validated.brandFriction ||
    `Generational transition and modern rush challenging authentic human connection for ${validated.product}.`;

  const lockedBriefText = `### BRAND BRIEF: ${validated.company.toUpperCase()}
* **Product:** ${validated.product}
* **Goal:** ${validated.goal}
* **Target Audience:** ${validated.audience || 'Target Consumers'}
* **Storytelling Framework:** ${activePreset.name || presetId}
* **Core Human Friction:** ${friction}`;

  const updatedGraph = store.initBrief(
    {
      company: validated.company,
      product: validated.product,
      goal: validated.goal,
      audience: validated.audience || 'Target Consumers',
      preset: presetId,
      brandFriction: friction,
      lockedBrief: lockedBriefText
    },
    validated.initialOptions
  );

  return {
    success: true,
    message: `Brand brief locked into DAG state for ${validated.company}. State initialized to CORE_THEME.`,
    projectId: updatedGraph.projectId,
    currentStage: updatedGraph.currentStage,
    workspaceDir: store.getWorkspaceDir(),
    storagePath: store.getFilePath(),
    lockedBrief: lockedBriefText,
    preset: activePreset,
    _systemDirective: {
      languageRule: activePreset.dialogueLanguageRule,
      optionsRule: 'Show ONLY Option 1, Option 2, and Option 3. Do NOT create unapproved options or extra variants.',
      endingRule: "End your response STRICTLY with: 'Reply 1, 2, 3, or R (regenerate).'",
      antiJargonRule:
        'VIOLATION: Do not include technical camera specs during narrative branching. Rewrite options focusing purely on emotion, cultural tropes, and storytelling.',
      workflowRule: "STOP and wait for user selection. NEVER simulate or proceed past CORE_THEME without calling 'branch_scene'."
    },
    instructionsForAgent: [
      'The brief is now immutably locked in state storage (.nogyaan/ or legacy state directories).',
      'The state machine is set to stage: CORE_THEME.',
      `Language rule: ${activePreset.dialogueLanguageRule}`,
      'Present exactly 3 narrative options: Option 1, Option 2, and Option 3.',
      "End your chat turn STRICTLY with: 'Reply 1, 2, 3, or R (regenerate).'",
      'DO NOT include technical camera specs (e.g. 35mm, 85mm, anamorphic, aspect ratio).',
      "Wait for the creator's decision before proceeding."
    ]
  };
}
