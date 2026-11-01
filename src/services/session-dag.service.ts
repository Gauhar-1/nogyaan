import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ANTI_JARGON_REGEX,
  AssetRegistry,
  CompiledShot,
  FsmStage,
  LatestActive,
  NarrativeOption,
  Preset,
  SessionState,
  SessionStateSchema,
  StoryNode
} from '../domain/schemas.js';
import { PromptCompilerService, ShotCompilationInput } from './prompt-compiler.service.js';

export const ANTI_JARGON_VIOLATION_MESSAGE =
  'VIOLATION: Do not include technical camera specs during narrative branching. Rewrite options focusing purely on emotion, cultural tropes, and storytelling.';

export class SessionDagService {
  private workspaceDir: string;
  private promptCompiler: PromptCompilerService;

  constructor(customWorkspaceDir?: string, promptCompiler?: PromptCompilerService) {
    this.workspaceDir = customWorkspaceDir || this.resolveWorkspaceDir();
    this.promptCompiler = promptCompiler || new PromptCompilerService();
    this.ensureDirectories();
  }

  public getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  public getStorageDir(): string {
    return path.resolve(this.workspaceDir, '.ad-director');
  }

  public getSessionsDir(): string {
    return path.resolve(this.getStorageDir(), 'sessions');
  }

  public getLatestActivePath(): string {
    return path.resolve(this.getStorageDir(), 'latest-active.json');
  }

  public getStoryGraphPath(): string {
    return path.resolve(this.getStorageDir(), 'story_graph.json');
  }

  private isDirectoryWritable(dirPath: string): boolean {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      const testFile = path.join(dirPath, `.write-test-${Date.now()}-${Math.random().toString(36).substring(2, 6)}.tmp`);
      fs.writeFileSync(testFile, 'ok', 'utf-8');
      fs.unlinkSync(testFile);
      return true;
    } catch {
      return false;
    }
  }

  private resolveWorkspaceDir(): string {
    // 1. Check environment variable override
    if (process.env.AD_DIRECTOR_WORKSPACE && process.env.AD_DIRECTOR_WORKSPACE.trim().length > 0) {
      const customWs = path.resolve(process.env.AD_DIRECTOR_WORKSPACE.trim());
      try {
        fs.mkdirSync(customWs, { recursive: true });
        if (this.isDirectoryWritable(customWs)) {
          return customWs;
        }
      } catch {}
    }

    // 2. Check process.cwd() safety
    const cwd = process.cwd();
    const normalizedCwd = cwd.replace(/\\/g, '/').toLowerCase();
    const isProtectedSystemDir =
      normalizedCwd.includes('windows/system32') ||
      normalizedCwd.includes('windows\\system32') ||
      normalizedCwd.includes('/applications') ||
      normalizedCwd === '/' ||
      normalizedCwd === 'c:/' ||
      normalizedCwd === 'c:\\' ||
      normalizedCwd === 'c:/windows';

    if (!isProtectedSystemDir && this.isDirectoryWritable(cwd)) {
      return cwd;
    }

    // 3. Fallback to user home directory
    const fallback = path.join(os.homedir(), '.ad-director-workspace');
    try {
      fs.mkdirSync(fallback, { recursive: true });
    } catch {}
    return fallback;
  }

  public ensureDirectories(): void {
    const storageDir = this.getStorageDir();
    const sessionsDir = this.getSessionsDir();
    try {
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }
      if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
      }
    } catch (err: any) {
      console.error('[SessionDagService] Failed to create directories:', err.message);
    }
  }

  public sanitizeSlug(name: string): string {
    if (!name) return 'brand';
    const cleaned = name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return cleaned || 'brand';
  }

  public validateNoCameraJargon(texts: unknown[]): void {
    for (const item of texts) {
      if (typeof item === 'string' && ANTI_JARGON_REGEX.test(item)) {
        throw new Error(ANTI_JARGON_VIOLATION_MESSAGE);
      } else if (item && typeof item === 'object') {
        for (const val of Object.values(item)) {
          if (typeof val === 'string' && ANTI_JARGON_REGEX.test(val)) {
            throw new Error(ANTI_JARGON_VIOLATION_MESSAGE);
          }
        }
      }
    }
  }

  public createSession(params: {
    company: string;
    product: string;
    goal: string;
    presetId: string;
    brandFriction?: string;
    options?: NarrativeOption[];
  }): SessionState {
    this.ensureDirectories();

    this.validateNoCameraJargon([
      params.company,
      params.product,
      params.goal,
      params.brandFriction,
      params.options
    ]);

    const slug = this.sanitizeSlug(params.company);
    const shortId = Math.random().toString(36).substring(2, 6);
    const sessionId = `${slug}-${shortId}`;
    const now = new Date().toISOString();

    const session: SessionState = {
      sessionId,
      createdAt: now,
      updatedAt: now,
      company: params.company,
      product: params.product,
      goal: params.goal,
      presetId: params.presetId,
      stage: 'CORE_THEME',
      lockedNodes: [],
      prunedCount: 0,
      pendingOptions: params.options || [],
      status: 'IN_PROGRESS'
    };

    this.saveSession(session);
    return session;
  }

  public saveSession(session: SessionState): void {
    this.ensureDirectories();
    session.updatedAt = new Date().toISOString();
    const validated = SessionStateSchema.parse(session);

    // Save isolated session JSON (raw UTF-8, zero HTML escaping)
    const sessionFilePath = path.join(this.getSessionsDir(), `${validated.sessionId}.json`);
    fs.writeFileSync(sessionFilePath, JSON.stringify(validated, null, 2), 'utf-8');

    // Update latest active pointer
    const latestActive: LatestActive = {
      latestSessionId: validated.sessionId,
      updatedAt: validated.updatedAt
    };
    fs.writeFileSync(this.getLatestActivePath(), JSON.stringify(latestActive, null, 2), 'utf-8');

    // Mirror to story_graph.json for studio UI and backward compatibility
    fs.writeFileSync(this.getStoryGraphPath(), JSON.stringify(validated, null, 2), 'utf-8');
  }

  public loadSession(sessionId?: string): SessionState | null {
    this.ensureDirectories();

    let targetSessionId = sessionId;
    if (!targetSessionId) {
      const latestPath = this.getLatestActivePath();
      if (fs.existsSync(latestPath)) {
        try {
          const raw = fs.readFileSync(latestPath, 'utf-8');
          const parsed = JSON.parse(raw);
          targetSessionId = parsed.latestSessionId;
        } catch {}
      }
    }

    if (targetSessionId) {
      const sessionPath = path.join(this.getSessionsDir(), `${targetSessionId}.json`);
      if (fs.existsSync(sessionPath)) {
        try {
          const raw = fs.readFileSync(sessionPath, 'utf-8');
          return SessionStateSchema.parse(JSON.parse(raw));
        } catch (err: any) {
          console.error(`[SessionDagService] Error parsing session ${sessionPath}:`, err.message);
        }
      }
    }

    // Fallback: check story_graph.json
    const storyGraphPath = this.getStoryGraphPath();
    if (fs.existsSync(storyGraphPath)) {
      try {
        const raw = fs.readFileSync(storyGraphPath, 'utf-8');
        return SessionStateSchema.parse(JSON.parse(raw));
      } catch {}
    }

    return null;
  }

  public getLatestSession(): SessionState | null {
    return this.loadSession();
  }

  public branchScene(params: {
    sessionId?: string;
    action: 'commit' | 'regenerate';
    sceneNumber?: number;
    chosenOptionId?: '1' | '2' | '3';
    chosenNarrativeSummary?: string;
    title?: string;
    description?: string;
    treatmentProse?: string;
    exitFrameAnchor?: string;
    nextOptions?: NarrativeOption[];
    pruningConfirmation?: string[];
    presetLanguageRule?: string;
  }): { session: SessionState; continuityBridge?: string; directive: Record<string, any> } {
    const session = this.loadSession(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId || 'latest'}. Run init_brief first.`);
    }

    // Anti-jargon check on all incoming narrative content
    this.validateNoCameraJargon([
      params.chosenNarrativeSummary,
      params.title,
      params.description,
      params.treatmentProse,
      params.exitFrameAnchor,
      params.nextOptions
    ]);

    // Handle Regenerate ('R')
    if (params.action === 'regenerate') {
      session.prunedCount += 3;
      if (params.nextOptions && params.nextOptions.length > 0) {
        session.pendingOptions = params.nextOptions;
      }
      this.saveSession(session);
      return {
        session,
        directive: {
          instruction: 'REGENERATED: Overwrote options for current stage. Incremented prunedCount by 3. Preserved stage.',
          currentStage: session.stage,
          prunedCount: session.prunedCount
        }
      };
    }

    // Handle Commit
    const currentStage = session.stage;
    const stageOrder: Record<FsmStage, FsmStage | null> = {
      CORE_THEME: 'SCENE_1_SETUP',
      SCENE_1_SETUP: 'SCENE_2_CATALYST',
      SCENE_2_CATALYST: 'SCENE_3_TWIST',
      SCENE_3_TWIST: 'SCENE_4_CLIMAX',
      SCENE_4_CLIMAX: 'LOCK_ASSETS',
      LOCK_ASSETS: null,
      COMPILE_SHOTS: null,
      COMPLETED: null
    };

    const nextStage = stageOrder[currentStage];
    if (!nextStage) {
      throw new Error(
        `FSM STAGE VIOLATION: Cannot branch scene during stage ${currentStage}. The narrative phase is complete.`
      );
    }

    const sceneNum =
      params.sceneNumber !== undefined
        ? params.sceneNumber
        : session.lockedNodes.length + 1;

    const summary =
      params.chosenNarrativeSummary ||
      params.treatmentProse ||
      params.description ||
      params.title ||
      'Approved scene beat';

    const exitAnchor =
      params.exitFrameAnchor ||
      `End of Scene ${sceneNum}: Character holds quiet reaction frame as moment settles.`;

    const node: StoryNode = {
      stage: currentStage,
      sceneNumber: sceneNum,
      chosenOptionId: params.chosenOptionId || '1',
      chosenNarrativeSummary: summary,
      exitFrameAnchor: exitAnchor,
      timestamp: new Date().toISOString()
    };

    session.lockedNodes.push(node);
    session.prunedCount += 2;
    session.stage = nextStage;
    session.pendingOptions = params.nextOptions || [];

    const languageRule =
      params.presetLanguageRule ||
      'Keep directions in 100% English. Spoken lines according to preset.';

    let continuityBridge: string | undefined;
    if (nextStage !== 'LOCK_ASSETS') {
      continuityBridge =
        `[🎛️ Preset: ${session.presetId} | Session: ${session.sessionId} | Pruned: 2 rejected branches wiped]\n` +
        `[🔗 MANDATORY CONTINUITY BRIDGE]: Scene ${sceneNum} ended at this exact physical frame: "${exitAnchor}".\n` +
        `Every single one of your 3 options for Scene ${sceneNum + 1} MUST physically and visually connect to this exact state.\n` +
        `[🗣️ LANGUAGE RULE]: ${languageRule}`;
    }

    this.saveSession(session);

    return {
      session,
      continuityBridge,
      directive: {
        instruction:
          'IGNORE ALL REJECTED OPTIONS. Only the locked node is canonical. Present 3 new branching options for next stage.',
        currentStage: session.stage,
        prunedCount: session.prunedCount,
        lockedNodes: session.lockedNodes,
        continuityBridge
      }
    };
  }

  public lockAssets(params: {
    sessionId?: string;
    characters: any[];
    environments: any[];
    product?: any;
    presetLanguageRule?: string;
  }): { session: SessionState; directive: Record<string, any> } {
    const session = this.loadSession(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId || 'latest'}. Run init_brief first.`);
    }

    if (session.stage !== 'LOCK_ASSETS') {
      throw new Error(
        `FSM STAGE VIOLATION: lock_assets can only be called during stage LOCK_ASSETS (current stage: ${session.stage}).`
      );
    }

    // Validate characters
    if (!params.characters || !Array.isArray(params.characters) || params.characters.length === 0) {
      throw new Error('At least one character asset is required');
    }

    const validatedChars = params.characters.map((c, idx) => {
      const assetId = c.id || c.assetId;
      if (!assetId || !/^CHAR_\d+$/i.test(assetId)) {
        throw new Error(
          `Character ID "${assetId || ''}" violates naming convention. Must match CHAR_01..N (e.g. 'CHAR_01').`
        );
      }
      return {
        id: assetId.toUpperCase(),
        name: c.name || `Character ${idx + 1}`,
        role: c.role || 'Lead',
        appearancePrompt: c.appearancePrompt || c.prompt || '',
        referencePrompt: this.promptCompiler.generateCharacterImagePrompt({
          id: assetId.toUpperCase(),
          name: c.name || `Character ${idx + 1}`,
          role: c.role || 'Lead',
          appearancePrompt: c.appearancePrompt || c.prompt || ''
        })
      };
    });

    // Validate environments
    if (!params.environments || !Array.isArray(params.environments) || params.environments.length === 0) {
      throw new Error('At least one environment asset is required');
    }

    const validatedEnvs = params.environments.map((b, idx) => {
      const assetId = b.id || b.assetId;
      if (!assetId || !/^BG_\d+$/i.test(assetId)) {
        throw new Error(
          `Background ID "${assetId || ''}" violates naming convention. Must match BG_01..N (e.g. 'BG_01').`
        );
      }
      return {
        id: assetId.toUpperCase(),
        name: b.name || `Environment ${idx + 1}`,
        environmentPrompt: b.environmentPrompt || b.prompt || '',
        lightingProfile: b.lightingProfile || 'Cinematic atmospheric lighting',
        referencePrompt: this.promptCompiler.generateLocationImagePrompt({
          id: assetId.toUpperCase(),
          name: b.name || `Environment ${idx + 1}`,
          environmentPrompt: b.environmentPrompt || b.prompt || '',
          lightingProfile: b.lightingProfile || 'Cinematic atmospheric lighting'
        })
      };
    });

    // Validate product
    const rawProd = params.product || { assetId: 'PROD_01', name: session.product, productPrompt: 'Hero product' };
    const prodId = rawProd.id || rawProd.assetId;
    if (prodId !== 'PROD_01') {
      throw new Error(
        `Product ID "${prodId}" violates naming convention. Must strictly be 'PROD_01'.`
      );
    }

    const validatedProd = {
      id: 'PROD_01' as const,
      name: rawProd.name || session.product,
      packagingAppearance: rawProd.packagingAppearance || rawProd.productPrompt || rawProd.appearance || 'Hero product packaging',
      heroAngle: rawProd.heroAngle || 'Front 45-degree hero angle',
      referencePrompt: this.promptCompiler.generateProductImagePrompt({
        id: 'PROD_01',
        name: rawProd.name || session.product,
        packagingAppearance: rawProd.packagingAppearance || rawProd.productPrompt || rawProd.appearance || 'Hero product packaging',
        heroAngle: rawProd.heroAngle || 'Front 45-degree hero angle'
      })
    };

    const registry: AssetRegistry = {
      characters: validatedChars,
      environments: validatedEnvs,
      product: validatedProd
    };

    session.assets = registry;
    session.stage = 'COMPILE_SHOTS';
    this.saveSession(session);

    return {
      session,
      directive: {
        instruction: 'Assets locked. Proceed to compile_shots with referential integrity (@CHAR_01, @BG_01, @PROD_01).',
        currentStage: 'COMPILE_SHOTS',
        lockedAssets: registry
      }
    };
  }

  public compileShots(params: {
    sessionId?: string;
    shots: any[];
    openStudioUi?: boolean;
    presetLanguageRule?: string;
  }): { session: SessionState; compiledShots: CompiledShot[]; directive: Record<string, any> } {
    const session = this.loadSession(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId || 'latest'}. Run init_brief first.`);
    }

    if (session.stage !== 'COMPILE_SHOTS') {
      throw new Error(
        `FSM STAGE VIOLATION: compile_shots can only be called during stage COMPILE_SHOTS (current stage: ${session.stage}). Lock assets first.`
      );
    }

    if (!session.assets) {
      throw new Error('No assets locked for this session. Run lock_assets first.');
    }

    const compiledShots: CompiledShot[] = [];

    for (let i = 0; i < params.shots.length; i++) {
      const s = params.shots[i];
      const sceneNum = s.sceneNumber || s.order || i + 1;
      const lockedBeat = session.lockedNodes.find((n) => n.sceneNumber === sceneNum);

      // Collect attached asset references
      let assetRefs: string[] = [];
      if (Array.isArray(s.attachedAssetRefs)) {
        assetRefs = s.attachedAssetRefs;
      } else {
        if (s.characterId) assetRefs.push(s.characterId);
        if (s.backgroundId) assetRefs.push(s.backgroundId);
        if (s.productId) assetRefs.push(s.productId);
      }

      // Default camera specs if legacy or partial
      const cameraSpec = s.cameraSpec || {
        lensMm: s.lens?.includes('mm') ? s.lens.split(' ')[0] : '50mm',
        aperture: s.aperture || 'f/1.8',
        angle: s.angle || s.cameraAngle || 'MEDIUM_SHOT',
        movement: s.movement || s.cameraMovement || 'STATIC'
      };

      const shotInput: ShotCompilationInput = {
        sceneNumber: sceneNum,
        durationSeconds: s.durationSeconds || s.duration || 5,
        storyBeatSummary: s.storyBeatSummary || lockedBeat?.chosenNarrativeSummary || s.title || `Scene ${sceneNum}`,
        entryFrameBridge: s.entryFrameBridge || (lockedBeat?.exitFrameAnchor ? `Connecting from: ${lockedBeat.exitFrameAnchor}` : 'Opening establishing frame'),
        screenplayAction: s.screenplayAction || s.action || 'Characters interact in scene',
        spokenDialogue: s.spokenDialogue || s.dialogue || 'NONE (SFX only)',
        sfxAndAmbience: s.sfxAndAmbience || s.audio || 'Atmospheric ambient sound',
        editorCutNote: s.editorCutNote || s.cutNote || 'Match cut on motion',
        cameraSpec,
        attachedAssetRefs: assetRefs,
        kineticMotion: s.kineticMotion
      };

      const compiled = this.promptCompiler.compileShot(shotInput, session.assets);
      compiledShots.push(compiled);
    }

    session.compiledShots = compiledShots;
    session.stage = 'COMPLETED';
    session.status = 'COMPLETED';
    this.saveSession(session);

    return {
      session,
      compiledShots,
      directive: {
        instruction: 'PRODUCTION COMPLETED: Full 3-Zone storyboard compiled and saved. Canvas ready at http://localhost:4321',
        currentStage: 'COMPLETED',
        sessionSummary: {
          sessionId: session.sessionId,
          company: session.company,
          product: session.product,
          shotsCompiled: compiledShots.length,
          prunedCount: session.prunedCount
        }
      }
    };
  }
}
