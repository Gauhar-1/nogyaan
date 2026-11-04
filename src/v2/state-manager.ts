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
  Scene
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
    global_medium?: Medium;
    assets?: AssetBible;
    scenes?: Scene[];
  }): NogyaanState {
    const newState: NogyaanState = {
      project_id: params.project_id || `proj-${Date.now()}`,
      core_premise: params.core_premise || 'Authentic high-conversion commercial',
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
        shots: {}
      };
      this.state.scenes.push(scene);
    } else {
      scene.locked_script = validatedScript;
    }

    this.saveToFile();
    return this.getState();
  }

  public lockShot(scene_id: string, shot_id: string, shot: LockedShot): NogyaanState {
    const validatedShot = AnyLockedShotSchema.parse(shot);
    let scene = this.state.scenes.find((s) => s.scene_id === scene_id);

    if (!scene) {
      scene = {
        scene_id,
        locked_script: null,
        active_refs: [],
        shots: {}
      };
      this.state.scenes.push(scene);
    }

    if (!scene.shots) {
      scene.shots = {};
    }

    scene.shots[shot_id] = {
      locked_shot: validatedShot
    };

    this.saveToFile();
    return this.getState();
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
   * 3. The state of Shot X-1 (the immediately preceding locked shot in Scene N).
   * Never passes the rest of the script, unused assets, or shots from other scenes.
   */
  public getShotContextSlice(
    scene_id: string,
    shot_id: string
  ): {
    scene_narrative: string;
    filtered_assets: AssetBible;
    previous_shot: LockedShot | null;
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

    // Shot X-1: spatial continuity from preceding shot in this scene
    let previous_shot: LockedShot | null = null;
    if (scene && scene.shots) {
      const shotKeys = Object.keys(scene.shots);
      const currIdx = shotKeys.indexOf(shot_id);
      if (currIdx > 0) {
        previous_shot = scene.shots[shotKeys[currIdx - 1]]?.locked_shot || null;
      } else if (currIdx === -1 && shotKeys.length > 0) {
        // shot_id has not yet been locked in state (e.g. pitching SHOT_02 when SHOT_01 is locked)
        const lastKey = shotKeys[shotKeys.length - 1];
        previous_shot = scene.shots[lastKey]?.locked_shot || null;
      }
    }

    return {
      scene_narrative,
      filtered_assets,
      previous_shot
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
      if (sc && sc.shots && sc.shots[shId]?.locked_shot) {
        return {
          type: 'shot',
          scene: sc,
          shot_id: shId,
          shot: sc.shots[shId].locked_shot!
        };
      }
    }

    // 3. Search across all scenes for matching shot_id or shot option_id / id
    for (const sc of this.state.scenes) {
      if (sc.shots) {
        for (const [sKey, sVal] of Object.entries(sc.shots)) {
          const lShot: any = sVal?.locked_shot;
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
    updated: LockedShot
  ): NogyaanState {
    const validated = AnyLockedShotSchema.parse(updated);
    const scene = this.state.scenes.find((s) => s.scene_id === scene_id);
    if (!scene) {
      throw new Error(`Scene "${scene_id}" not found.`);
    }
    if (!scene.shots) scene.shots = {};
    scene.shots[shot_id] = { locked_shot: validated };
    this.saveToFile();
    return this.getState();
  }
}
