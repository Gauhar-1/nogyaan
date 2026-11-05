import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AssetBible,
  AssetExtractionResult,
  AnyLockedScriptSchema,
  AnyLockedShotSchema,
  LockedScript,
  LockedShot,
  Medium,
  NogyaanState,
  NogyaanStateSchema,
  Scene,
  ShotNode
} from './types.js';

export class StateManager {
  private filePath: string;
  private state: NogyaanState;
  private listeners: Set<(state: NogyaanState) => void> = new Set();

  constructor(customFilePath?: string) {
    this.filePath = customFilePath || this.resolveStateFilePath();
    this.state = this.loadFromFile();
  }

  public getFilePath(): string {
    return this.filePath;
  }

  private resolveStateFilePath(): string {
    const envWs =
      process.env.NOGYAAN_WORKSPACE ||
      process.env.NOSLOP_WORKSPACE ||
      process.env.AD_DIRECTOR_WORKSPACE;

    if (envWs && envWs.trim().length > 0) {
      const dir = path.resolve(envWs.trim());
      if (this.isDirectoryWritable(dir)) {
        return path.join(dir, 'nogyaan-state.json');
      }
    }

    const cwd = process.cwd();
    const normalizedCwd = cwd.replace(/\\/g, '/').toLowerCase();
    const isProtected =
      normalizedCwd.includes('windows/system32') ||
      normalizedCwd.includes('windows\\system32') ||
      normalizedCwd.includes('/applications') ||
      normalizedCwd === '/' ||
      normalizedCwd === 'c:/' ||
      normalizedCwd === 'c:\\';

    if (!isProtected && this.isDirectoryWritable(cwd)) {
      return path.resolve(cwd, 'nogyaan-state.json');
    }

    const fallbackDir = path.join(os.homedir(), '.nogyaan-workspace');
    try {
      fs.mkdirSync(fallbackDir, { recursive: true });
    } catch {}
    return path.join(fallbackDir, 'nogyaan-state.json');
  }

  private isDirectoryWritable(dirPath: string): boolean {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      const testFile = path.join(
        dirPath,
        `.write-test-${Date.now()}-${Math.random().toString(36).substring(2, 6)}.tmp`
      );
      fs.writeFileSync(testFile, 'ok', 'utf-8');
      fs.unlinkSync(testFile);
      return true;
    } catch {
      return false;
    }
  }

  public getDefaultState(): NogyaanState {
    return {
      project_id: 'proj-default',
      core_premise: 'Authentic high-conversion commercial',
      global_director_notes: '',
      global_medium: 'Live-Action Cinematic',
      assets: {
        characters: {},
        backgrounds: {},
        product: ''
      },
      scenes: []
    };
  }

  public loadFromFile(): NogyaanState {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return NogyaanStateSchema.parse(parsed);
      } catch (err: any) {
        console.warn(
          `[StateManager] Failed to parse existing state file at ${this.filePath} (${err.message}). Initializing default state.`
        );
      }
    }
    const defaultState = this.getDefaultState();
    this.saveToFile(defaultState);
    return defaultState;
  }

  public saveToFile(stateToSave?: NogyaanState): void {
    const targetState = stateToSave || this.state;
    const validated = NogyaanStateSchema.parse(targetState);
    this.state = validated;

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.filePath, JSON.stringify(validated, null, 2), 'utf-8');
    this.notifyListeners();
  }

  public getState(): NogyaanState {
    return JSON.parse(JSON.stringify(this.state));
  }

  public setState(newState: NogyaanState): NogyaanState {
    const validated = NogyaanStateSchema.parse(newState);
    this.state = validated;
    this.saveToFile(validated);
    return this.getState();
  }

  public subscribe(listener: (state: NogyaanState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const currentState = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(currentState);
      } catch (err) {
        console.error('[StateManager] Listener error:', err);
      }
    }
  }

  public initProject(params: {
    project_id?: string;
    core_premise?: string;
    global_director_notes?: string;
    global_medium?: Medium;
    assets?: AssetBible;
    scenes?: Scene[];
  }): NogyaanState {
    const newState: NogyaanState = {
      project_id: params.project_id || `proj-${Date.now()}`,
      core_premise: params.core_premise || 'Authentic high-conversion commercial',
      global_director_notes: params.global_director_notes || '',
      global_medium: params.global_medium || 'Live-Action Cinematic',
      assets: params.assets || {
        characters: {},
        backgrounds: {},
        product: ''
      },
      scenes: params.scenes || []
    };
    return this.setState(newState);
  }

  public setCorePremise(premise: string): NogyaanState {
    this.state.core_premise = premise;
    this.saveToFile();
    return this.getState();
  }

  public getCorePremise(): string {
    return this.state.core_premise || 'Authentic video commercial';
  }

  public setGlobalDirectorNotes(notes: string): NogyaanState {
    this.state.global_director_notes = notes;
    this.saveToFile();
    return this.getState();
  }

  public getGlobalDirectorNotes(): string {
    return this.state.global_director_notes || '';
  }

  public updateGlobalMedium(medium: Medium): NogyaanState {
    this.state.global_medium = medium;
    this.saveToFile();
    return this.getState();
  }

  public updateAssetBible(assets: AssetBible): NogyaanState {
    this.state.assets = assets;
    this.saveToFile();
    return this.getState();
  }

  public getScene(scene_id: string): Scene | undefined {
    return this.state.scenes.find((s) => s.scene_id === scene_id);
  }

  public lockScript(scene_id: string, script: LockedScript): NogyaanState {
    const validatedScript = AnyLockedScriptSchema.parse(script);
    let scene = this.state.scenes.find((s) => s.scene_id === scene_id);

    if (!scene) {
      scene = {
        scene_id,
        locked_script: validatedScript,
        active_refs: [],
        spatial_memory: [],
        last_shot_egress: '',
        shots: {}
      };
      this.state.scenes.push(scene);
    } else {
      scene.locked_script = validatedScript;
      if (!scene.spatial_memory) {
        scene.spatial_memory = [];
      }
      if (scene.last_shot_egress === undefined) {
        scene.last_shot_egress = '';
      }
    }

    this.saveToFile();
    return this.getState();
  }

  /**
   * Saves a finalized ShotNode (visual_intent + sota_payload) into the scene's shot record,
   * silently tracks the temporal last_shot_egress, and updates rolling spatial_memory.
   */
  public saveShotNode(
    scene_id: string,
    shot_id: string,
    node: ShotNode,
    explicitEgress?: string,
    explicitSpatialFacts?: string[]
  ): NogyaanState {
    let scene = this.state.scenes.find((s) => s.scene_id === scene_id);

    if (!scene) {
      scene = {
        scene_id,
        locked_script: null,
        active_refs: [],
        spatial_memory: [],
        last_shot_egress: '',
        shots: {}
      };
      this.state.scenes.push(scene);
    }

    if (!scene.shots) {
      scene.shots = {};
    }

    if (!scene.spatial_memory) {
      scene.spatial_memory = [];
    }

    if (scene.last_shot_egress === undefined) {
      scene.last_shot_egress = '';
    }

    // Save the ShotNode
    scene.shots[shot_id] = {
      id: (node as any).id,
      style: (node as any).style,
      visual_intent: node.visual_intent,
      sota_payload: node.sota_payload
    };

    // Extract or update temporal egress (passes to the next shot's Ingress)
    const egress = explicitEgress || this.extractEgressFromPayload(node.sota_payload);
    if (egress && egress.trim().length > 0) {
      scene.last_shot_egress = egress.trim();
    }

    // Silent spatial mutation: extract and append physical room geometry facts
    const facts = this.extractSpatialFactsFromPayload(node.sota_payload, explicitSpatialFacts);
    for (const fact of facts) {
      this.updateOrAppendSpatialFact(scene.spatial_memory, fact);
    }

    this.saveToFile();
    return this.getState();
  }

  public lockShot(
    scene_id: string,
    shot_id: string,
    shot: LockedShot,
    explicitSpatialFacts?: string[]
  ): NogyaanState {
    const anyShot = shot as any;
    const visual_intent = anyShot.visual_intent || anyShot.txt || '';
    const sota_payload = anyShot.sota_payload || anyShot.prmpt || anyShot.ai_payload || '';
    const node: ShotNode = {
      id: anyShot.id || anyShot.option_id,
      style: anyShot.style || anyShot.director_persona,
      visual_intent,
      sota_payload
    };

    return this.saveShotNode(scene_id, shot_id, node, anyShot.egress, explicitSpatialFacts);
  }

  /**
   * Extracts the terminating temporal egress state from a SOTA prompt payload.
   */
  public extractEgressFromPayload(payload: string): string {
    if (!payload) return '';
    const match = payload.match(/(?:Shot ends with|Ends with|Egress:?)\s+([^.]+(?:\.[^.]+)?)/i);
    if (match && match[1]) {
      return match[1].replace(/[.]+$/, '').trim();
    }
    const sentences = payload.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length > 0) {
      const last = sentences[sentences.length - 1];
      if (/rests|stands|seated|closed|freeze|holds|pauses|ends/i.test(last)) {
        return last.replace(/[.]+$/, '').trim();
      }
    }
    return '';
  }

  public appendSpatialMemory(scene_id: string, facts: string[]): NogyaanState {
    const scene = this.state.scenes.find((s) => s.scene_id === scene_id);
    if (scene) {
      if (!scene.spatial_memory) scene.spatial_memory = [];
      for (const fact of facts) {
        this.updateOrAppendSpatialFact(scene.spatial_memory, fact);
      }
      this.saveToFile();
    }
    return this.getState();
  }

  /**
   * Extracts physical room geometry, character coordinates, and object positions established in a shot.
   */
  public extractSpatialFactsFromShot(
    shot: LockedShot,
    explicitFacts?: string[]
  ): string[] {
    const results: string[] = [];

    // 1. Explicit facts if provided
    if (explicitFacts && Array.isArray(explicitFacts)) {
      results.push(...explicitFacts);
    }

    // 2. Shot object spatial annotations if present
    const anyShot = shot as any;
    if (Array.isArray(anyShot.spatial_facts)) {
      results.push(...anyShot.spatial_facts);
    }
    if (Array.isArray(anyShot.spatial_positions)) {
      results.push(...anyShot.spatial_positions);
    }

    // 3. Automated heuristic extraction from shot visual intent (txt) and prompt (prmpt / ai_payload)
    const textsToScan: string[] = [];
    if (anyShot.txt) textsToScan.push(anyShot.txt);
    if (anyShot.visual_intent) textsToScan.push(anyShot.visual_intent);
    if (anyShot.prmpt) textsToScan.push(anyShot.prmpt);
    if (anyShot.ai_payload) textsToScan.push(anyShot.ai_payload);

    const spatialIndicators = [
      /\b(?:is\s+|stands\s+|seated\s+|sitting\s+|lying\s+|placed\s+|positioned\s+|centered\s+|resting\s+|leaning\s+)(?:at|on|in|beside|near|by|behind|in front of|under|against|inside|opposite)\b/i,
      /\b(?:at the table|on the table|at table \d+|by the window|near the door|on the desk|in the kitchen|in front of the camera)\b/i,
      /\b(?:dead-center|geometric symmetry|centered inside)\b/i
    ];

    for (const text of textsToScan) {
      const clauses = text
        .split(/(?<=[.!?])\s+|\s*,\s*(?=(?:@?[A-Z][a-zA-Z0-9_-]*|\b(?:phone|laptop|cup|glass|bottle|door|table|chair|camera)\b)\s+(?:is|stands|seated|sitting|placed|lies|leaning|positioned|rests))/i)
        .map((s) => s.trim())
        .filter((s) => s.length > 5);

      for (const clause of clauses) {
        if (
          /\b(?:\d+mm|f\/\d|anamorphic|shutter|iso|fps|aspect ratio|chiaroscuro|key wrap)\b/i.test(
            clause
          ) &&
          !/\b(?:seated|sitting|stands|placed|on table|at table)\b/i.test(clause)
        ) {
          continue;
        }

        const matchesSpatial = spatialIndicators.some((regex) => regex.test(clause));
        if (matchesSpatial) {
          const cleaned = clause
            .replace(/^(?:Also|And|Then|Next|Meanwhile)\s+/i, '')
            .replace(/[.]+$/, '')
            .trim();
          if (cleaned.length > 8 && cleaned.length < 120 && !results.includes(cleaned)) {
            results.push(cleaned);
          }
        }
      }
    }

    return results;
  }

  public extractSpatialFactsFromPayload(
    payload: string,
    explicitFacts?: string[]
  ): string[] {
    return this.extractSpatialFactsFromShot(
      { txt: '', prmpt: payload } as any,
      explicitFacts
    );
  }

  /**
   * Rolling spatial memory updater: updates position if subject already exists, or appends.
   */
  private updateOrAppendSpatialFact(memory: string[], newFact: string): void {
    const trimmed = newFact.trim();
    if (!trimmed) return;

    const subjectMatch = trimmed.match(/^(@?[A-Za-z0-9_]+(?:\s+[A-Za-z0-9_]+)?)/);
    const subject = subjectMatch ? subjectMatch[1].toLowerCase() : null;

    if (subject) {
      const existingIdx = memory.findIndex((item) =>
        item.toLowerCase().startsWith(subject)
      );
      if (existingIdx !== -1) {
        memory[existingIdx] = trimmed;
        return;
      }
    }

    if (!memory.includes(trimmed)) {
      memory.push(trimmed);
    }
  }

  public tagSceneAssets(scene_id: string, active_refs: string[]): NogyaanState {
    const scene = this.state.scenes.find((s) => s.scene_id === scene_id);
    if (scene) {
      scene.active_refs = active_refs;
      this.saveToFile();
    }
    return this.getState();
  }

  public applyAssetExtraction(result: AssetExtractionResult): NogyaanState {
    this.state.assets = result.assets;
    for (const scene of this.state.scenes) {
      if (result.scene_tagging && result.scene_tagging[scene.scene_id]) {
        scene.active_refs = result.scene_tagging[scene.scene_id];
      }
    }
    this.saveToFile();
    return this.getState();
  }

  // ==========================================================================
  // JIT Context Slicers (Zero Global Context Drag)
  // ==========================================================================

  /**
   * Phase 1: Context slice for Writer's Room (Scene N).
   * Passes ONLY the core premise and Scene N-1 locked narrative.
   * Never passes Scene N-2, Scene N-3, camera data, or assets.
   */
  public getScriptContextSlice(scene_id: string): {
    core_premise: string;
    previous_scene_narrative: string | null;
  } {
    const sceneIndex = this.state.scenes.findIndex((s) => s.scene_id === scene_id);
    let prevNarrative: string | null = null;

    if (sceneIndex > 0) {
      const prevScene = this.state.scenes[sceneIndex - 1];
      if (prevScene && prevScene.locked_script) {
        const sc: any = prevScene.locked_script;
        prevNarrative = sc.txt || sc.narrative_block || null;
      }
    } else if (sceneIndex === -1 && this.state.scenes.length > 0) {
      const lastScene = this.state.scenes[this.state.scenes.length - 1];
      if (lastScene && lastScene.locked_script) {
        const sc: any = lastScene.locked_script;
        prevNarrative = sc.txt || sc.narrative_block || null;
      }
    }

    return {
      core_premise: this.state.core_premise || 'Authentic video commercial',
      previous_scene_narrative: prevNarrative
    };
  }

  /**
   * Phase 2: Context slice for Asset Locker.
   * Returns ONLY the locked 4-scene narratives for asset extraction and scene tagging.
   */
  public getSceneNarrativesForAssetExtraction(): Array<{
    scene_id: string;
    txt: string;
  }> {
    return this.state.scenes
      .filter((s) => s.locked_script !== null)
      .map((s) => {
        const sc: any = s.locked_script;
        return {
          scene_id: s.scene_id,
          txt: sc.txt || sc.narrative_block || ''
        };
      });
  }

  /**
   * Phase 3: Context slice for DP Suite (Scene N, Shot X).
   * Passes ONLY:
   * 1. The locked narrative txt for Scene N.
   * 2. The Filtered Asset Bible (only characters/backgrounds tagged in Scene N's active_refs).
   * 3. The current scene's spatial_memory array (room geometry, physical coordinates).
   * 4. Persistent global_director_notes (persistent cinematic rules).
   * Never passes Shot X-1 state, unused assets, or shots from other scenes.
   */
  public getShotContextSlice(
    scene_id: string,
    shot_id: string
  ): {
    scene_narrative: string;
    filtered_assets: AssetBible;
    spatial_memory: string[];
    last_shot_egress: string;
    global_director_notes: string;
  } {
    const scene = this.state.scenes.find((s) => s.scene_id === scene_id);
    const sc: any = scene?.locked_script;
    const scene_narrative = sc?.txt || sc?.narrative_block || '';

    // Filtered Asset Bible based on Scene N active_refs
    const activeRefs = scene?.active_refs || [];
    const filteredCharacters: Record<string, string> = {};
    const filteredBackgrounds: Record<string, string> = {};

    const charKeys = Object.keys(this.state.assets.characters || {});
    for (const k of charKeys) {
      const refTag = k.startsWith('@') ? k : `@${k}`;
      const rawKey = k.replace(/^@/, '');
      if (
        activeRefs.includes(refTag) ||
        activeRefs.includes(rawKey) ||
        activeRefs.some((r) => r.includes(rawKey))
      ) {
        filteredCharacters[rawKey] = this.state.assets.characters[k];
      }
    }

    // Fallback if not yet tagged: only include character if mentioned in narrative
    if (Object.keys(filteredCharacters).length === 0 && charKeys.length > 0) {
      for (const k of charKeys) {
        const rawKey = k.replace(/^@/, '');
        if (scene_narrative.includes(rawKey) || scene_narrative.includes(`@${rawKey}`)) {
          filteredCharacters[rawKey] = this.state.assets.characters[k];
        }
      }
      if (Object.keys(filteredCharacters).length === 0 && charKeys[0]) {
        const first = charKeys[0].replace(/^@/, '');
        filteredCharacters[first] = this.state.assets.characters[charKeys[0]];
      }
    }

    const bgKeys = Object.keys(this.state.assets.backgrounds || {});
    for (const k of bgKeys) {
      const refTag = k.startsWith('@') ? k : `@${k}`;
      const rawKey = k.replace(/^@/, '');
      if (
        activeRefs.includes(refTag) ||
        activeRefs.includes(rawKey) ||
        activeRefs.some((r) => r.includes(rawKey))
      ) {
        filteredBackgrounds[rawKey] = this.state.assets.backgrounds[k];
      }
    }

    if (Object.keys(filteredBackgrounds).length === 0 && bgKeys.length > 0) {
      for (const k of bgKeys) {
        const rawKey = k.replace(/^@/, '');
        if (scene_narrative.includes(rawKey) || scene_narrative.includes(`@${rawKey}`)) {
          filteredBackgrounds[rawKey] = this.state.assets.backgrounds[k];
        }
      }
      if (Object.keys(filteredBackgrounds).length === 0 && bgKeys[0]) {
        const first = bgKeys[0].replace(/^@/, '');
        filteredBackgrounds[first] = this.state.assets.backgrounds[bgKeys[0]];
      }
    }

    const filtered_assets: AssetBible = {
      characters: filteredCharacters,
      backgrounds: filteredBackgrounds,
      product: this.state.assets.product || ''
    };

    return {
      scene_narrative,
      filtered_assets,
      spatial_memory: scene?.spatial_memory || [],
      last_shot_egress: scene?.last_shot_egress || '',
      global_director_notes: this.state.global_director_notes || ''
    };
  }

  /**
   * Phase 5: Context slice for Targeted Re-Roll.
   * Returns ONLY the target node JSON object and its type.
   */
  public getNodeContextSlice(node_id: string): {
    node_id: string;
    type: 'scene' | 'shot';
    target_node: LockedScript | LockedShot;
  } {
    const found = this.findNode(node_id);
    if (!found) {
      throw new Error(`Node "${node_id}" was not found in NogyaanState.`);
    }

    if (found.type === 'scene') {
      if (!found.scene.locked_script) {
        throw new Error(`Scene "${found.scene.scene_id}" has no locked_script.`);
      }
      return {
        node_id,
        type: 'scene',
        target_node: found.scene.locked_script
      };
    } else {
      return {
        node_id,
        type: 'shot',
        target_node: found.shot
      };
    }
  }

  public findNode(node_id: string):
    | { type: 'scene'; scene: Scene }
    | { type: 'shot'; scene: Scene; shot_id: string; shot: LockedShot }
    | null {
    // 1. Check if node_id is a scene_id
    const sceneDirect = this.state.scenes.find((s) => s.scene_id === node_id);
    if (sceneDirect) {
      return { type: 'scene', scene: sceneDirect };
    }

    // 2. Check if node_id matches format "SCENE_ID:SHOT_ID"
    if (node_id.includes(':')) {
      const [sId, shId] = node_id.split(':');
      const sc = this.state.scenes.find((s) => s.scene_id === sId);
      if (sc && sc.shots && sc.shots[shId]) {
        const shVal = sc.shots[shId] as any;
        const shotObj = shVal.locked_shot || shVal;
        return {
          type: 'shot',
          scene: sc,
          shot_id: shId,
          shot: shotObj
        };
      }
    }

    // 3. Search across all scenes for matching shot_id or shot option_id / id
    for (const sc of this.state.scenes) {
      if (sc.shots) {
        for (const [sKey, sVal] of Object.entries(sc.shots)) {
          const lShot: any = (sVal as any)?.locked_shot || sVal;
          if (
            sKey === node_id ||
            lShot?.id === node_id ||
            lShot?.option_id === node_id
          ) {
            if (lShot) {
              return {
                type: 'shot',
                scene: sc,
                shot_id: sKey,
                shot: lShot
              };
            }
          }
        }
      }
    }

    return null;
  }

  public updateLockedScript(scene_id: string, updated: LockedScript): NogyaanState {
    const validated = AnyLockedScriptSchema.parse(updated);
    const scene = this.state.scenes.find((s) => s.scene_id === scene_id);
    if (!scene) {
      throw new Error(`Scene "${scene_id}" not found.`);
    }
    scene.locked_script = validated;
    this.saveToFile();
    return this.getState();
  }

  public updateLockedShot(
    scene_id: string,
    shot_id: string,
    updated: LockedShot | ShotNode
  ): NogyaanState {
    const scene = this.state.scenes.find((s) => s.scene_id === scene_id);
    if (!scene) {
      throw new Error(`Scene "${scene_id}" not found.`);
    }
    if (!scene.shots) scene.shots = {};
    const anyUp = updated as any;
    const existing = scene.shots[shot_id] as any;
    const node: ShotNode = {
      id: anyUp.id || anyUp.option_id || existing?.id,
      style: anyUp.style || anyUp.director_persona || existing?.style,
      visual_intent: anyUp.visual_intent || anyUp.txt || '',
      sota_payload: anyUp.sota_payload || anyUp.prmpt || anyUp.ai_payload || ''
    };
    scene.shots[shot_id] = node;
    const egress = this.extractEgressFromPayload(node.sota_payload);
    if (egress) {
      scene.last_shot_egress = egress;
    }
    this.saveToFile();
    return this.getState();
  }
}
