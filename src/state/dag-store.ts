/**
 * @file src/state/dag-store.ts
 * @description Hardened local state machine and DAG store for Ad Director MCP.
 * Enforces strict FSM stage locking, anti-jargon gates, referential integrity,
 * path sanitization, and state pruning for creative narrative direction.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";

// ============================================================================
// 1. Path Safety & Sanitization Constants
// ============================================================================

/**
 * Tests if a given directory path is writable by creating and removing a transient test file.
 */
export function isDirectoryWritable(dirPath: string): boolean {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    const testFile = path.join(
      dirPath,
      `.write-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.writeFileSync(testFile, "ok", "utf-8");
    fs.unlinkSync(testFile);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resilient workspace directory resolver:
 * 1. Honors NOGYAAN_WORKSPACE if set and writable.
 * 2. Checks process.cwd(); if it is a protected system dir (like C:\WINDOWS\system32 in MSIX)
 *    or not writable, automatically falls back to ~/.nogyaan-workspace.
 * 3. Guarantees a safe, writable base directory for state persistence.
 */
export function getWorkspaceDir(): string {
  // 1. Explicit environment override takes precedence
  const envWs =
    process.env.NOGYAAN_WORKSPACE ||
    process.env.NOSLOP_WORKSPACE ||
    process.env.AD_DIRECTOR_WORKSPACE;
  if (envWs && envWs.trim()) {
    const custom = path.resolve(envWs.trim());
    if (isDirectoryWritable(custom)) {
      return custom;
    }
  }

  // 2. Check current working directory
  const cwd = process.cwd();
  const normalizedCwd = cwd.toLowerCase().replace(/\\/g, "/");

  const isProtectedSystemDir =
    normalizedCwd.includes("system32") ||
    normalizedCwd.includes("windows/system32") ||
    normalizedCwd.includes("/applications") ||
    normalizedCwd === "/" ||
    normalizedCwd === "c:/" ||
    normalizedCwd === "c:\\" ||
    normalizedCwd === "c:/windows";

  if (!isProtectedSystemDir && isDirectoryWritable(cwd)) {
    return cwd;
  }

  // 3. Fallback to user home directory
  const fallback = path.join(os.homedir(), ".nogyaan-workspace");
  try {
    fs.mkdirSync(fallback, { recursive: true });
  } catch {}
  return fallback;
}

export function getStorageDir(baseDir?: string): string {
  const ws = baseDir || getWorkspaceDir();
  const primary = path.resolve(ws, ".nogyaan");
  if (fs.existsSync(primary)) return primary;
  const legacyNoslop = path.resolve(ws, ".noslop");
  if (fs.existsSync(legacyNoslop)) return legacyNoslop;
  const legacy = path.resolve(ws, ".ad-director");
  if (fs.existsSync(legacy)) return legacy;
  return primary;
}

export function getStoryGraphPath(baseDir?: string): string {
  return path.resolve(getStorageDir(baseDir), "story_graph.json");
}

export const OUTPUT_DIR = getStorageDir();
export const STORY_GRAPH_PATH = getStoryGraphPath();

/**
 * Sanitizes brand and project names using /[^a-zA-Z0-9_-]/g to prevent path traversal
 * and invalid file/folder names.
 */
export function sanitizeBrandOrProjectName(name: string): string {
  if (!name) return "default";
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Returns a safe subfolder path within .nogyaan, ensuring no path traversal.
 */
export function getSafeSubfolder(subfolderName: string, baseDir?: string): string {
  const root = getStorageDir(baseDir);
  const sanitized = sanitizeBrandOrProjectName(subfolderName);
  const resolved = path.resolve(root, sanitized);
  if (!resolved.startsWith(root)) {
    throw new Error("SECURITY VIOLATION: Path traversal detected in project directory name.");
  }
  return resolved;
}

// ============================================================================
// 2. Anti-Jargon Gate Validator
// ============================================================================

export const ANTI_JARGON_REGEX =
  /\b(85mm|35mm|24mm|50mm|f\/1\.4|anamorphic|aspect ratio|16:9|9:16|bokeh)\b/i;

export const ANTI_JARGON_VIOLATION_MESSAGE =
  "VIOLATION: Do not include technical camera specs during narrative branching. Rewrite options focusing purely on emotion, cultural tropes, and storytelling.";

/**
 * Validates that narrative text does not contain forbidden camera specifications.
 * Throws the exact specified error if any forbidden token is found.
 */
export function validateNoCameraJargon(
  texts: (string | undefined | null | unknown)[]
): void {
  for (const item of texts) {
    if (typeof item === "string" && ANTI_JARGON_REGEX.test(item)) {
      throw new Error(ANTI_JARGON_VIOLATION_MESSAGE);
    } else if (item && typeof item === "object") {
      for (const val of Object.values(item)) {
        if (typeof val === "string" && ANTI_JARGON_REGEX.test(val)) {
          throw new Error(ANTI_JARGON_VIOLATION_MESSAGE);
        }
      }
    }
  }
}

// ============================================================================
// 3. FSM Stages and Sequence Definitions
// ============================================================================

export const FSM_STAGES = [
  "CORE_THEME",
  "SCENE_1_SETUP",
  "SCENE_2_SETUP",
  "SCENE_2_CATALYST",
  "SCENE_3_TWIST",
  "SCENE_4_CLIMAX",
  "LOCK_ASSETS",
  "COMPILE_SHOTS",
  "COMPLETED",
] as const;

export type FSMStage = (typeof FSM_STAGES)[number];

export const NARRATIVE_STAGES: readonly FSMStage[] = [
  "CORE_THEME",
  "SCENE_1_SETUP",
  "SCENE_2_SETUP",
  "SCENE_2_CATALYST",
  "SCENE_3_TWIST",
  "SCENE_4_CLIMAX",
] as const;

export const STAGE_TRANSITION_MAP: Record<FSMStage, FSMStage | null> = {
  CORE_THEME: "SCENE_1_SETUP",
  SCENE_1_SETUP: "SCENE_2_CATALYST",
  SCENE_2_SETUP: "SCENE_3_TWIST",
  SCENE_2_CATALYST: "SCENE_3_TWIST",
  SCENE_3_TWIST: "SCENE_4_CLIMAX",
  SCENE_4_CLIMAX: "LOCK_ASSETS",
  LOCK_ASSETS: "COMPILE_SHOTS",
  COMPILE_SHOTS: "COMPLETED",
  COMPLETED: null,
};

// ============================================================================
// 4. Zod Schemas for Assets, Decisions, Shots, and Graph
// ============================================================================

export const cameraAngleSchema = z.enum([
  "CAM_A_CENTER",
  "CAM_B_45_CLOSE",
  "CAM_C_OTS",
  "CLOSE_UP",
  "MEDIUM_SHOT",
  "WIDE_SHOT",
  "EXTREME_CLOSE_UP",
  "ESTABLISHING",
]);
export type CameraAngle = z.infer<typeof cameraAngleSchema>;

export const cameraMovementSchema = z.enum([
  "STATIC",
  "PUSH_IN",
  "PULL_OUT",
  "PAN_LEFT",
  "PAN_RIGHT",
  "TILT_UP",
  "TILT_DOWN",
  "TRACKING",
  "ORBIT",
]);
export type CameraMovement = z.infer<typeof cameraMovementSchema>;

// Asset schemas with strict ID conventions
export const characterAssetSchema = z.object({
  assetId: z
    .string()
    .regex(/^CHAR_\d+$/i, "characterId must match CHAR_01..N pattern (e.g. 'CHAR_01')"),
  name: z.string().min(1, "Character name is required"),
  role: z.string().default("Lead"),
  appearancePrompt: z.string().min(1, "appearancePrompt is required"),
  pulidSeed: z.number().int().default(42),
  imageUrl: z.string().default(""),
  metadata: z.record(z.string(), z.any()).optional().default({}),
});
export type CharacterAsset = z.infer<typeof characterAssetSchema>;

export const locationAssetSchema = z.object({
  assetId: z
    .string()
    .regex(/^BG_\d+$/i, "backgroundId must match BG_01..N pattern (e.g. 'BG_01')"),
  name: z.string().min(1, "Location name is required"),
  environmentPrompt: z.string().min(1, "environmentPrompt is required"),
  lightingProfile: z.string().default("Cinematic atmospheric lighting"),
  imageUrl: z.string().default(""),
  metadata: z.record(z.string(), z.any()).optional().default({}),
});
export type LocationAsset = z.infer<typeof locationAssetSchema>;

export const productAssetSchema = z.object({
  assetId: z
    .string()
    .regex(/^PROD_01$/i, "Product assetId must be 'PROD_01'"),
  name: z.string().min(1, "Product name is required"),
  productPrompt: z.string().min(1, "Product appearance prompt is required"),
  category: z.string().optional().default("D2C Hero Product"),
  metadata: z.record(z.string(), z.any()).optional().default({}),
});
export type ProductAsset = z.infer<typeof productAssetSchema>;

export const assetRegistrySchema = z.object({
  characters: z.record(z.string(), characterAssetSchema).default({}),
  environments: z.record(z.string(), locationAssetSchema).default({}),
  product: productAssetSchema.nullable().default(null),
});
export type AssetRegistry = z.infer<typeof assetRegistrySchema>;

export const narrativeOptionSchema = z.object({
  id: z.enum(["1", "2", "3"]).or(z.string()),
  title: z.string().min(1, "Option title is required"),
  description: z.string().min(1, "Option description is required"),
  treatmentProse: z.string().optional().default(""),
});
export type NarrativeOption = z.infer<typeof narrativeOptionSchema>;

export const lockedNodeSchema = z.object({
  id: z.string().min(1),
  step: z.number().int().positive(),
  stage: z.enum(FSM_STAGES),
  selectedOptionId: z.enum(["1", "2", "3"]).or(z.string()),
  title: z.string(),
  description: z.string(),
  treatmentProse: z.string().default(""),
  lockedAt: z.string().default(() => new Date().toISOString()),
});
export type LockedNode = z.infer<typeof lockedNodeSchema>;

export const storyBriefSchema = z.object({
  company: z.string().min(1, "Company name is required"),
  product: z.string().min(1, "Product description is required"),
  goal: z.string().min(1, "Campaign goal is required"),
  audience: z.string().optional(),
  preset: z.string().default("indian-d2c-story"),
  brandFriction: z.string().default(""),
  lockedBrief: z.string().default(""),
});
export type StoryBrief = z.infer<typeof storyBriefSchema>;

export const sceneShotSchema = z.object({
  sceneId: z.string().min(1, "sceneId is required"),
  order: z.number().int().positive().default(1),
  title: z.string().default(""),
  action: z.string().min(1, "Scene action is required"),
  dialogue: z.string().optional().default(""),
  characterId: z.string().optional(),
  characterIds: z.array(z.string()).default([]),
  backgroundId: z.string().optional(),
  locationId: z.string().optional().default(""),
  lens: z.string().default("35mm cinematic lens"),
  cameraAngle: cameraAngleSchema.default("CAM_A_CENTER"),
  cameraMovement: cameraMovementSchema.default("STATIC"),
  duration: z.number().positive().default(5),
  imagePrompt: z.string().default(""),
  motionPrompt: z.string().default(""),
  compiledVideoPrompt: z.string().default(""),
});
export type SceneShot = z.infer<typeof sceneShotSchema>;

export const storyGraphSchema = z.object({
  version: z.literal("1.0.0").default("1.0.0"),
  projectId: z.string().min(1, "projectId/session_id is required"),
  brand: z.string().default("brand-default"),
  currentStage: z.enum(FSM_STAGES).default("CORE_THEME"),
  current_stage: z.string().optional(),
  stage: z.string().optional(),
  brief: storyBriefSchema.nullable().default(null),
  lockedNodes: z.array(lockedNodeSchema).default([]),
  pendingOptions: z.array(narrativeOptionSchema).default([]),
  prunedCount: z.number().int().nonnegative().default(0),
  treatment: z.array(z.string()).default([]),
  assetRegistry: assetRegistrySchema.default({ characters: {}, environments: {}, product: null }),
  // Backwards compatibility mappings for UI and previous references
  activeNodeId: z.string().nullable().default(null),
  nodes: z.record(z.string(), z.any()).default({}),
  linearLineage: z.array(z.string()).default([]),
  characters: z.array(characterAssetSchema).default([]),
  environments: z.array(locationAssetSchema).default([]),
  shots: z.array(sceneShotSchema).default([]),
  updatedAt: z.string().default(() => new Date().toISOString()),
}).passthrough();
export type StoryGraph = z.infer<typeof storyGraphSchema>;

// ============================================================================
// 5. HTML Entity Sanitization Helpers
// ============================================================================

/**
 * Escapes all 5 standard HTML entities: <, >, &, ", '
 */
export function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Recursively escapes all string values in an object/array to protect HTML rendering.
 */
export function sanitizeObjectForHtml<T>(val: T): T {
  if (typeof val === "string") {
    return escapeHtml(val) as unknown as T;
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeObjectForHtml) as unknown as T;
  }
  if (val !== null && typeof val === "object") {
    const copy: any = {};
    for (const [k, v] of Object.entries(val)) {
      copy[k] = sanitizeObjectForHtml(v);
    }
    return copy as T;
  }
  return val;
}

// ============================================================================
// 6. Hardened DAGStore Implementation
// ============================================================================

export class DAGStore {
  private baseDir: string;
  private storageDir: string;
  private sessionsDir: string;
  private sessionId?: string;
  private filePath: string;

  constructor(baseDir?: string, sessionId?: string) {
    this.baseDir = baseDir ? path.resolve(baseDir) : getWorkspaceDir();
    this.storageDir = getStorageDir(this.baseDir);
    this.sessionsDir = path.resolve(this.storageDir, "sessions");
    if (!fs.existsSync(this.sessionsDir)) {
      try {
        fs.mkdirSync(this.sessionsDir, { recursive: true });
      } catch {}
    }
    this.sessionId = sessionId;
    if (this.sessionId) {
      this.filePath = path.resolve(this.sessionsDir, `${this.sessionId}.json`);
    } else {
      this.filePath = path.resolve(this.storageDir, "story_graph.json");
    }
  }

  public getWorkspaceDir(): string {
    return this.baseDir;
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public getStorageDir(): string {
    return this.storageDir;
  }

  public getSessionsDir(): string {
    return this.sessionsDir;
  }

  public setSessionId(sessionId: string): void {
    if (!sessionId || !sessionId.trim()) {
      throw new Error("session_id is required. No session_id was provided.");
    }
    this.sessionId = sessionId.trim();
    this.filePath = path.resolve(this.sessionsDir, `${this.sessionId}.json`);
  }

  /**
   * Loads session graph from .nogyaan/sessions/${session_id}.json.
   * Throws an error if session_id is missing or file does not exist.
   */
  public load(sessionId?: string): StoryGraph {
    const targetSessionId = (sessionId || this.sessionId)?.trim();
    if (!targetSessionId) {
      throw new Error("session_id is required. No session_id was provided.");
    }

    const sessionPath = path.resolve(this.sessionsDir, `${targetSessionId}.json`);
    if (!fs.existsSync(sessionPath)) {
      throw new Error(
        `Session not found: "${targetSessionId}". Expected file at ${sessionPath}. Run init_brief first.`
      );
    }

    try {
      const raw = fs.readFileSync(sessionPath, "utf-8");
      const parsed = JSON.parse(raw);
      const graph = storyGraphSchema.parse(parsed);
      if (!graph.current_stage) {
        graph.current_stage = graph.currentStage === "SCENE_2_CATALYST" ? "SCENE_2_SETUP" : graph.currentStage;
      }
      if (!graph.stage) {
        graph.stage = graph.currentStage;
      }
      return graph;
    } catch (err) {
      console.error(`[DAGStore] Error reading graph from ${sessionPath}:`, err);
      throw err;
    }
  }

  /**
   * Checks if all four scenes have their shots locked.
   */
  public isAllShotsLocked(graph: StoryGraph): boolean {
    if (graph.shots && graph.shots.length >= 4) {
      const sceneIds = new Set(
        graph.shots.map((s) => (s.sceneId || (s as any).scene_id || '').toUpperCase()).filter(Boolean)
      );
      if (sceneIds.size >= 4) return true;
    }
    const anyGraph = graph as any;
    if (anyGraph.scenes && Array.isArray(anyGraph.scenes) && anyGraph.scenes.length >= 4) {
      const allFour = anyGraph.scenes.slice(0, 4).every(
        (sc: any) =>
          (sc.shots && Object.keys(sc.shots).length > 0) ||
          (Array.isArray(sc.shots) && sc.shots.length > 0)
      );
      if (allFour) return true;
    }
    return false;
  }

  /**
   * Persists the story graph strictly to .nogyaan/sessions/${session_id}.json.
   */
  public save(graph: StoryGraph): void {
    if (!graph.projectId || !graph.projectId.trim()) {
      throw new Error("session_id / projectId is required to save graph.");
    }
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
    if (this.isAllShotsLocked(graph)) {
      graph.currentStage = "COMPLETED";
      graph.current_stage = "COMPLETED";
      graph.stage = "COMPLETED";
    }
    if (!graph.current_stage) {
      graph.current_stage = graph.currentStage === "SCENE_2_CATALYST" ? "SCENE_2_SETUP" : graph.currentStage;
    }
    graph.stage = graph.currentStage;
    graph.updatedAt = new Date().toISOString();
    const sessionPath = path.resolve(this.sessionsDir, `${graph.projectId.trim()}.json`);
    fs.writeFileSync(sessionPath, JSON.stringify(graph, null, 2), "utf-8");
    this.sessionId = graph.projectId.trim();
    this.filePath = sessionPath;

    try {
      const latestPath = path.resolve(this.storageDir, "latest-active.json");
      fs.writeFileSync(
        latestPath,
        JSON.stringify({ latestSessionId: graph.projectId, updatedAt: graph.updatedAt }, null, 2),
        "utf-8"
      );
    } catch {}
  }

  /**
   * Task 1.1 & 1.2: Initializes brief and resets state machine to CORE_THEME.
   * Scans inputs for premature technical camera terms.
   */
  public initBrief(brief: StoryBrief, initialOptions?: NarrativeOption[], sessionId?: string): StoryGraph {
    // Anti-Jargon Gate on brief inputs
    validateNoCameraJargon([
      brief.company,
      brief.product,
      brief.goal,
      brief.audience,
      brief.brandFriction,
      brief.lockedBrief,
    ]);

    if (initialOptions) {
      for (const opt of initialOptions) {
        validateNoCameraJargon([opt.title, opt.description, opt.treatmentProse]);
      }
    }

    const sanitizedBrand = sanitizeBrandOrProjectName(brief.company);
    const parsedBrief = storyBriefSchema.parse(brief);
    const finalSessionId = (sessionId || `proj-${sanitizedBrand}-${Date.now().toString(36)}`).trim();
    this.sessionId = finalSessionId;
    this.filePath = path.resolve(this.sessionsDir, `${finalSessionId}.json`);

    const freshGraph: StoryGraph = {
      version: "1.0.0",
      projectId: finalSessionId,
      brand: sanitizedBrand,
      currentStage: "CORE_THEME",
      current_stage: "CORE_THEME",
      stage: "CORE_THEME",
      brief: parsedBrief,
      lockedNodes: [],
      pendingOptions: initialOptions || [],
      prunedCount: 0,
      treatment: [],
      assetRegistry: {
        characters: {},
        environments: {},
        product: null,
      },
      activeNodeId: null,
      nodes: {},
      linearLineage: [],
      characters: [],
      environments: [],
      shots: [],
      updatedAt: new Date().toISOString(),
    };

    this.save(freshGraph);
    return freshGraph;
  }

  /**
   * Locks the overarching Core Campaign Premise and advances CORE_THEME -> SCENE_1_SETUP.
   */
  public lockCoreTheme(input: {
    sessionId?: string;
    chosenThemeId: "1" | "2" | "3" | string;
    themeTitle: string;
    themePremise: string;
    nextOptions?: NarrativeOption[];
  }): StoryGraph {
    validateNoCameraJargon([input.themeTitle, input.themePremise, input.nextOptions]);
    const graph = this.load(input.sessionId);
    if (graph.currentStage !== "CORE_THEME") {
      throw new Error(
        `FSM STAGE VIOLATION: lock_core_theme can only be called during CORE_THEME stage (current: ${graph.currentStage}).`
      );
    }
    graph.currentStage = "SCENE_1_SETUP";
    graph.current_stage = "SCENE_1_SETUP";
    graph.stage = "SCENE_1_SETUP";
    graph.prunedCount += 2;
    graph.pendingOptions = input.nextOptions || [];
    this.save(graph);
    return graph;
  }

  /**
   * Task 1.2, 1.3, 1.4: Strict Branch Scene execution.
   * Handles 'commit' and 'regenerate' modes with state pruning and FSM stage locking.
   */
  public branchScene(input: {
    sessionId?: string;
    action: "commit" | "regenerate";
    selectedOptionId?: "1" | "2" | "3" | string;
    nextOptions?: NarrativeOption[];
    title?: string;
    description?: string;
    treatmentProse?: string;
  }): StoryGraph {
    const graph = this.load(input.sessionId);

    // 1. FSM Stage Lock: Must be in a narrative branching stage
    if (!NARRATIVE_STAGES.includes(graph.currentStage)) {
      throw new Error(
        `FSM STAGE VIOLATION: Cannot call branch_scene in stage '${graph.currentStage}'. Narrative branching is completed. Required stage: '${graph.currentStage}'.`
      );
    }

    // 2. Anti-Jargon Gate: Validate all narrative options and texts
    const narrativeTexts: (string | undefined | null)[] = [
      input.title,
      input.description,
      input.treatmentProse,
    ];
    if (input.nextOptions) {
      for (const opt of input.nextOptions) {
        narrativeTexts.push(opt.title, opt.description, opt.treatmentProse);
      }
    }
    validateNoCameraJargon(narrativeTexts);

    // 3. Action Mode Handling
    if (input.action === "regenerate") {
      // Regenerate mode (R): overwrites pendingOptions for current stage, increments prunedCount by 3, stage stays same
      graph.pendingOptions = input.nextOptions || [];
      graph.prunedCount += 3;
      this.save(graph);
      return graph;
    }

    if (input.action === "commit") {
      if (!input.selectedOptionId || !["1", "2", "3"].includes(input.selectedOptionId)) {
        throw new Error(
          "VIOLATION: selectedOptionId ('1', '2', or '3') is strictly required when action is 'commit'."
        );
      }

      // Locate option data from pendingOptions or fallback to inputs
      const matchedOption = graph.pendingOptions.find(
        (opt) => opt.id === input.selectedOptionId
      );

      const title = input.title || matchedOption?.title || `Stage ${graph.currentStage} Choice ${input.selectedOptionId}`;
      const description = input.description || matchedOption?.description || title;
      const treatmentProse = input.treatmentProse || matchedOption?.treatmentProse || description;

      const stepNumber = graph.lockedNodes.length + 1;
      const nodeId = `node-${graph.currentStage.toLowerCase()}-${Date.now().toString(36)}`;

      const newNode: LockedNode = {
        id: nodeId,
        step: stepNumber,
        stage: graph.currentStage,
        selectedOptionId: input.selectedOptionId,
        title,
        description,
        treatmentProse,
        lockedAt: new Date().toISOString(),
      };

      // Promote ONLY that option to lockedNodes
      graph.lockedNodes.push(newNode);

      // Increment prunedCount by 2 (the 2 discarded options)
      graph.prunedCount += 2;

      // Wipe pendingOptions
      graph.pendingOptions = [];

      // Append treatment paragraph
      if (treatmentProse) {
        graph.treatment.push(treatmentProse);
      }

      // Sync compatibility fields
      graph.nodes[nodeId] = newNode;
      graph.linearLineage.push(nodeId);
      graph.activeNodeId = nodeId;

      // Advance stage to the next strict FSM transition
      const nextStage = STAGE_TRANSITION_MAP[graph.currentStage];
      if (nextStage) {
        graph.currentStage = nextStage;
        if (nextStage === "SCENE_2_CATALYST" || nextStage === "SCENE_2_SETUP") {
          graph.current_stage = "SCENE_2_SETUP";
        } else {
          graph.current_stage = nextStage;
        }
        graph.stage = graph.currentStage;
      }

      // If nextOptions provided and the new stage is still a narrative stage, populate pendingOptions
      if (
        input.nextOptions &&
        input.nextOptions.length > 0 &&
        NARRATIVE_STAGES.includes(graph.currentStage)
      ) {
        graph.pendingOptions = input.nextOptions;
      }

      this.save(graph);
      return graph;
    }

    throw new Error(`Unknown action: ${input.action}`);
  }

  /**
   * Task 2.3: Locks assets (characters, environments, and product).
   * Strictly enforces that current stage must be LOCK_ASSETS (after SCENE_4_CLIMAX).
   */
  public lockAssets(input: {
    sessionId?: string;
    characters: any[] | Record<string, any>;
    environments: any[] | Record<string, any>;
    product?: any;
  }): StoryGraph {
    const graph = this.load(input.sessionId);

    // Upsert support: Allow execution during LOCK_ASSETS, COMPILE_SHOTS, or COMPLETED
    const allowedStages = ["LOCK_ASSETS", "COMPILE_SHOTS", "COMPLETED"];
    if (!allowedStages.includes(graph.currentStage)) {
      throw new Error(
        `FSM STAGE VIOLATION: Cannot call lock_assets while in stage '${graph.currentStage}'. lock_assets can only be called after SCENE_4_CLIMAX is locked (expected stage: 'LOCK_ASSETS' or 'COMPILE_SHOTS').`
      );
    }

    // Normalize characters (allow array or record, arbitrary keys and descriptions)
    let charList: any[] = [];
    if (Array.isArray(input.characters)) {
      charList = input.characters;
    } else if (input.characters && typeof input.characters === 'object') {
      charList = Object.entries(input.characters).map(([k, v]) => {
        if (typeof v === 'string') return { assetId: k, name: k, appearancePrompt: v };
        return { assetId: k, ...(v as any) };
      });
    }

    const existingCharRecord = graph.assetRegistry?.characters || {};
    const charRecord: Record<string, CharacterAsset> = { ...existingCharRecord };
    const validatedCharacters: CharacterAsset[] = [];

    const effectiveChars = charList.length > 0 ? charList : Object.values(existingCharRecord);
    if (effectiveChars.length === 0) {
      throw new Error("VALIDATION ERROR: At least one character asset (CHAR_01..N) is required.");
    }

    for (let idx = 0; idx < effectiveChars.length; idx++) {
      const c = effectiveChars[idx];
      const rawId = c.assetId || c.id || `CHAR_0${idx + 1}`;
      const assetId = String(rawId).toUpperCase();
      const existing = existingCharRecord[assetId];
      const name = c.name || existing?.name || `Character ${idx + 1}`;
      const role = c.role || existing?.role || "Lead";
      const prompt = c.appearancePrompt || c.prompt || c.description || (typeof c === 'string' ? c : '') || existing?.appearancePrompt || "";
      const charObj: CharacterAsset = {
        assetId,
        name,
        role,
        appearancePrompt: prompt,
        pulidSeed: c.pulidSeed || existing?.pulidSeed || 42,
        imageUrl: c.imageUrl || existing?.imageUrl || "",
        metadata: { ...(existing?.metadata || {}), ...(c.metadata || {}), ...(c.category ? { category: c.category } : {}) }
      };
      charRecord[assetId] = charObj;
      validatedCharacters.push(charObj);
    }

    // Normalize environments (allow array or record, arbitrary keys and descriptions)
    let envList: any[] = [];
    if (Array.isArray(input.environments)) {
      envList = input.environments;
    } else if (input.environments && typeof input.environments === 'object') {
      envList = Object.entries(input.environments).map(([k, v]) => {
        if (typeof v === 'string') return { assetId: k, name: k, environmentPrompt: v };
        return { assetId: k, ...(v as any) };
      });
    }

    const existingEnvRecord = graph.assetRegistry?.environments || {};
    const envRecord: Record<string, LocationAsset> = { ...existingEnvRecord };
    const validatedEnvironments: LocationAsset[] = [];

    const effectiveEnvs = envList.length > 0 ? envList : Object.values(existingEnvRecord);
    if (effectiveEnvs.length === 0) {
      throw new Error("VALIDATION ERROR: At least one environment asset (BG_01..N) is required.");
    }

    for (let idx = 0; idx < effectiveEnvs.length; idx++) {
      const e = effectiveEnvs[idx];
      const rawId = e.assetId || e.id || `BG_0${idx + 1}`;
      const assetId = String(rawId).toUpperCase();
      const existing = existingEnvRecord[assetId];
      const name = e.name || existing?.name || `Environment ${idx + 1}`;
      const prompt = e.environmentPrompt || e.prompt || e.description || (typeof e === 'string' ? e : '') || existing?.environmentPrompt || "";
      const lighting = e.lightingProfile || e.lighting || existing?.lightingProfile || "Cinematic atmospheric lighting";
      const envObj: LocationAsset = {
        assetId,
        name,
        environmentPrompt: prompt,
        lightingProfile: lighting,
        imageUrl: e.imageUrl || existing?.imageUrl || "",
        metadata: { ...(existing?.metadata || {}), ...(e.metadata || {}), ...(e.category ? { category: e.category } : {}) }
      };
      envRecord[assetId] = envObj;
      validatedEnvironments.push(envObj);
    }

    // Validate product asset (PROD_01) with upsert
    let validatedProduct: ProductAsset;
    const rawProd = input.product !== undefined ? input.product : graph.assetRegistry?.product;
    if (rawProd) {
      const prodName = (typeof rawProd === 'object' && rawProd !== null ? rawProd.name : '') || graph.brief?.product || "Hero Product";
      const prodPrompt = typeof rawProd === 'string'
        ? rawProd
        : rawProd.productPrompt || rawProd.packagingAppearance || rawProd.appearance || rawProd.description || `Hero product presentation of ${prodName}`;
      validatedProduct = {
        assetId: "PROD_01",
        name: prodName,
        productPrompt: prodPrompt,
        category: (typeof rawProd === 'object' && rawProd !== null ? rawProd.category : '') || "Hero Product",
        metadata: (typeof rawProd === 'object' && rawProd !== null ? rawProd.metadata : {}) || {}
      };
    } else {
      validatedProduct = {
        assetId: "PROD_01",
        name: graph.brief?.product || "Hero Product",
        productPrompt: `High definition hero product commercial presentation of ${graph.brief?.product || "D2C Product"} with authentic packaging details.`,
        category: "Hero Product",
        metadata: {}
      };
    }

    graph.assetRegistry = {
      characters: charRecord,
      environments: envRecord,
      product: validatedProduct,
    };

    graph.characters = validatedCharacters;
    graph.environments = validatedEnvironments;

    // Advance stage to COMPILE_SHOTS if currently at LOCK_ASSETS
    if (graph.currentStage === "LOCK_ASSETS") {
      graph.currentStage = "COMPILE_SHOTS";
      graph.current_stage = "COMPILE_SHOTS";
      graph.stage = "COMPILE_SHOTS";
    }
    this.save(graph);
    return graph;
  }

  /**
   * Task 2.4: Compiles technical shots with referential integrity checks and server-side prompt synthesis.
   * Can only be called when stage is COMPILE_SHOTS (after LOCK_ASSETS) or COMPLETED.
   */
  public compileShots(shotsInput: SceneShot[], sessionId?: string): StoryGraph {
    const graph = this.load(sessionId);

    // 1. FSM Stage Lock: Must be in COMPILE_SHOTS or COMPLETED
    const allowed = ["COMPILE_SHOTS", "COMPLETED"];
    if (!allowed.includes(graph.currentStage)) {
      throw new Error(
        `FSM STAGE VIOLATION: Cannot call compile_shots while in stage '${graph.currentStage}'. compile_shots can only be called after LOCK_ASSETS (expected stage: 'COMPILE_SHOTS').`
      );
    }

    if (!shotsInput || shotsInput.length === 0) {
      throw new Error("VALIDATION ERROR: At least one shot is required to compile storyboard.");
    }

    const regChars = graph.assetRegistry.characters;
    const regBgs = graph.assetRegistry.environments;
    const availableCharIds = Object.keys(regChars);
    const availableBgIds = Object.keys(regBgs);

    // 2. Referential Integrity Check & Server-Side Auto-Compilation
    const compiledShots: SceneShot[] = shotsInput.map((s, idx) => {
      const order = s.order || idx + 1;
      const shotLabel = s.title || `Shot ${order}`;

      // Collect character references
      const referencedCharIds: string[] = [];
      if (s.characterId) referencedCharIds.push(s.characterId);
      if (s.characterIds && Array.isArray(s.characterIds)) {
        referencedCharIds.push(...s.characterIds);
      }

      if (referencedCharIds.length === 0) {
        throw new Error(
          `REFERENTIAL INTEGRITY VIOLATION: ${shotLabel} does not reference any characterId. Available characters: ${availableCharIds.join(", ")}.`
        );
      }

      // Verify each referenced character exists in locked AssetRegistry
      for (const cid of referencedCharIds) {
        const norm = cid.toUpperCase();
        if (!regChars[norm]) {
          throw new Error(
            `REFERENTIAL INTEGRITY VIOLATION: ${shotLabel} references unlisted characterId '${cid}'. It does not exist in locked AssetRegistry. Available characters: ${availableCharIds.join(", ")}.`
          );
        }
      }

      // Collect background reference
      const bgId = (s.backgroundId || s.locationId || "").toUpperCase();
      if (!bgId) {
        throw new Error(
          `REFERENTIAL INTEGRITY VIOLATION: ${shotLabel} does not reference a backgroundId. Available backgrounds: ${availableBgIds.join(", ")}.`
        );
      }
      if (!regBgs[bgId]) {
        throw new Error(
          `REFERENTIAL INTEGRITY VIOLATION: ${shotLabel} references unlisted backgroundId '${bgId}'. It does not exist in locked AssetRegistry. Available backgrounds: ${availableBgIds.join(", ")}.`
        );
      }

      // Server-Side Auto-Compilation:
      // Concatenate locked appearancePrompt + environmentPrompt + lightingProfile + lens + cameraMovement
      const uniqueCharIds = Array.from(new Set(referencedCharIds.map((c) => c.toUpperCase())));
      const appearancePrompt = uniqueCharIds
        .map((cid) => regChars[cid].appearancePrompt)
        .join("; ");

      const bg = regBgs[bgId];
      const environmentPrompt = bg.environmentPrompt;
      const lightingProfile = bg.lightingProfile || "Cinematic atmospheric lighting";
      const lens = s.lens || "35mm cinematic lens";
      const cameraMovement = s.cameraMovement || "STATIC";

      const promptParts = [
        appearancePrompt ? `Subject: ${appearancePrompt}` : "",
        environmentPrompt ? `Environment: ${environmentPrompt}` : "",
        lightingProfile ? `Lighting: ${lightingProfile}` : "",
        lens ? `Lens: ${lens}` : "",
        cameraMovement ? `Camera Movement: ${cameraMovement}` : "",
        s.action ? `Action: ${s.action}` : "",
      ].filter(Boolean);

      const compiledVideoPrompt = promptParts.join(". ") + ".";

      return sceneShotSchema.parse({
        ...s,
        order,
        characterId: uniqueCharIds[0],
        characterIds: uniqueCharIds,
        backgroundId: bgId,
        locationId: bgId,
        lens,
        cameraMovement,
        compiledVideoPrompt,
        imagePrompt: compiledVideoPrompt, // backwards compatibility
      });
    });

    graph.shots = compiledShots;
    graph.currentStage = "COMPLETED";
    graph.current_stage = "COMPLETED";
    graph.stage = "COMPLETED";
    this.save(graph);
    return graph;
  }

  /**
   * Locks an individual shot into graph.shots, advancing current_stage to COMPLETED
   * once all four scenes have their shots locked.
   */
  public lockShot(input: {
    sessionId?: string;
    sceneId: string;
    shot: SceneShot | any;
    shotId?: string;
  }): StoryGraph {
    const graph = this.load(input.sessionId);

    // Validate stage bounds: must be in COMPILE_SHOTS or COMPLETED
    const allowed = ["COMPILE_SHOTS", "COMPLETED"];
    if (!allowed.includes(graph.currentStage)) {
      throw new Error(
        `FSM STAGE VIOLATION: Cannot call lock_shot while in stage '${graph.currentStage}'. Expected stage: 'COMPILE_SHOTS'.`
      );
    }

    const regChars = graph.assetRegistry.characters;
    const regBgs = graph.assetRegistry.environments;
    const availableCharIds = Object.keys(regChars);
    const availableBgIds = Object.keys(regBgs);

    const shot = sceneShotSchema.parse({
      ...input.shot,
      sceneId: input.sceneId,
      order: input.shot.order || graph.shots.length + 1,
      characterId: input.shot.characterId || availableCharIds[0] || "CHAR_01",
      backgroundId: input.shot.backgroundId || availableBgIds[0] || "BG_01",
      action: input.shot.action || input.shot.visual_intent || input.shot.txt || "Cinematic shot action",
      compiledVideoPrompt: input.shot.compiledVideoPrompt || input.shot.sota_payload || input.shot.prmpt || "Cinematic video prompt"
    });

    // Replace if order / scene matches or append
    const existingIdx = graph.shots.findIndex(
      (s) => s.sceneId.toUpperCase() === input.sceneId.toUpperCase() && s.order === shot.order
    );
    if (existingIdx >= 0) {
      graph.shots[existingIdx] = shot;
    } else {
      graph.shots.push(shot);
    }

    // Advance to COMPLETED if all four scenes have shots locked
    if (this.isAllShotsLocked(graph)) {
      graph.currentStage = "COMPLETED";
      graph.current_stage = "COMPLETED";
      graph.stage = "COMPLETED";
    }

    this.save(graph);
    return graph;
  }

  /**
   * Advances the FSM stage to COMPLETED once all four scenes have their shots locked.
   */
  public advanceToCompletedIfShotsLocked(sessionId?: string): StoryGraph {
    const graph = this.load(sessionId);
    if (this.isAllShotsLocked(graph)) {
      graph.currentStage = "COMPLETED";
      graph.current_stage = "COMPLETED";
      graph.stage = "COMPLETED";
      this.save(graph);
    }
    return graph;
  }

  /**
   * Resets the entire graph to fresh state.
   */
  public reset(sessionId?: string): StoryGraph {
    const targetSessionId = (sessionId || this.sessionId || `session-${Date.now().toString(36)}`).trim();
    this.sessionId = targetSessionId;
    this.filePath = path.resolve(this.sessionsDir, `${targetSessionId}.json`);
    const fresh: StoryGraph = {
      version: "1.0.0",
      projectId: targetSessionId,
      brand: "default",
      currentStage: "CORE_THEME",
      brief: null,
      lockedNodes: [],
      pendingOptions: [],
      prunedCount: 0,
      treatment: [],
      assetRegistry: {
        characters: {},
        environments: {},
        product: null,
      },
      activeNodeId: null,
      nodes: {},
      linearLineage: [],
      characters: [],
      environments: [],
      shots: [],
      updatedAt: new Date().toISOString(),
    };
    this.save(fresh);
    return fresh;
  }
}

// Singleton helper for default process working directory
export const defaultDAGStore = new DAGStore();
