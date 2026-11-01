/**
 * @file src/tools/1-init-brief.ts
 * @description MCP Tool 1: Initializes the campaign brief and sets state to CORE_THEME.
 * Enforces Anti-Jargon validation and returns a strict _systemDirective block.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  DAGStore,
  validateNoCameraJargon,
  narrativeOptionSchema,
  type NarrativeOption,
} from "../state/dag-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const initBriefSchema = z.object({
  company: z.string().min(1, "Company name is required").describe("Company or brand name (e.g., 'ChaiWaale', 'DevScale', 'GlowBotanics')"),
  product: z.string().min(1, "Product is required").describe("Specific product or service being promoted"),
  goal: z.string().min(1, "Campaign goal is required").describe("Core business objective or conversion goal for this campaign"),
  audience: z.string().optional().describe("Target demographic or cultural segment"),
  preset: z
    .enum(["indian-d2c-story", "dev-product-launch", "tiktok-ugc-hook"])
    .default("indian-d2c-story")
    .describe("Narrative framework preset. Defaults to 'indian-d2c-story'"),
  brandFriction: z
    .string()
    .optional()
    .describe("The deep emotional or everyday human friction this brand resolves"),
  initialOptions: z
    .array(narrativeOptionSchema)
    .optional()
    .describe("Optional initial narrative options 1, 2, 3 for CORE_THEME"),
});

export type InitBriefInput = z.infer<typeof initBriefSchema>;

/**
 * Resolves the package root directory relative to import.meta.url by searching upwards.
 */
function getPackageRoot(): string {
  let curr = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(curr, "package.json"))) {
      return curr;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * Loads a preset JSON file safely from the package root (never process.cwd()).
 */
function loadPreset(presetId: string): Record<string, any> {
  const packageRoot = getPackageRoot();
  const possiblePaths = [
    path.join(packageRoot, "presets", `${presetId}.json`),
    path.resolve(__dirname, "../../presets", `${presetId}.json`),
    path.resolve(__dirname, "../presets", `${presetId}.json`),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, "utf-8"));
      } catch (err) {
        console.warn(`[init_brief] Failed to parse preset at ${p}:`, err);
      }
    }
  }

  return { id: presetId, name: presetId, philosophy: "Standard Cinematic Direction" };
}

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
    validated.brandFriction,
  ]);
  if (validated.initialOptions) {
    for (const opt of validated.initialOptions) {
      validateNoCameraJargon([opt.title, opt.description, opt.treatmentProse]);
    }
  }

  const presetConfig = loadPreset(validated.preset);
  const isIndianD2C = validated.preset === "indian-d2c-story";

  const friction =
    validated.brandFriction ||
    `Generational transition and modern rush challenging authentic human connection for ${validated.product}.`;

  const lockedBriefText = `### BRAND BRIEF: ${validated.company.toUpperCase()}
* **Product:** ${validated.product}
* **Goal:** ${validated.goal}
* **Target Audience:** ${validated.audience || "Indian Consumers / Global"}
* **Storytelling Framework:** ${presetConfig.name || validated.preset}
* **Core Human Friction:** ${friction}`;

  const updatedGraph = store.initBrief(
    {
      company: validated.company,
      product: validated.product,
      goal: validated.goal,
      audience: validated.audience || "Indian Consumers / Global",
      preset: validated.preset,
      brandFriction: friction,
      lockedBrief: lockedBriefText,
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
    preset: presetConfig,
    _systemDirective: {
      languageRule: isIndianD2C
        ? "MANDATORY: Speak in warm, nostalgic, conversational Hinglish (e.g., 'Arre kya baat hai!', 'Ekdum badhiya choice!', 'Chaliye Step 2 par aate hain'). Maintain this conversational tone even if the user speaks English."
        : "Conduct chat banter in the authentic directorial tone of the chosen preset.",
      optionsRule: "Show ONLY Option 1, Option 2, and Option 3. Do NOT create unapproved options or extra variants.",
      endingRule: "End your response STRICTLY with: 'Reply 1, 2, 3, or R (regenerate).'",
      antiJargonRule: "VIOLATION: Do not include technical camera specs during narrative branching. Rewrite options focusing purely on emotion, cultural tropes, and storytelling.",
      workflowRule: "STOP and wait for user selection. NEVER simulate or proceed past CORE_THEME without calling 'branch_scene'.",
    },
    instructionsForAgent: [
      "The brief is now immutably locked in .ad-director/story_graph.json.",
      "The state machine is set to stage: CORE_THEME.",
      isIndianD2C
        ? "Speak in Hinglish with a warm, nostalgic, Piyush Pandey-style storytelling lens."
        : "Adopt the directorial voice of the selected preset.",
      "Present exactly 3 narrative options: Option 1, Option 2, and Option 3.",
      "End your chat turn STRICTLY with: 'Reply 1, 2, 3, or R (regenerate).'",
      "DO NOT include technical camera specs (e.g. 35mm, 85mm, anamorphic, aspect ratio).",
      "Wait for the creator's decision before proceeding.",
    ],
  };
}
