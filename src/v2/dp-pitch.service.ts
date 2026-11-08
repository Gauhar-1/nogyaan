import {
  AssetBible,
  NogyaanState,
  ShotConcept,
  ShotConceptsPitch,
  ShotNode,
  ShotPitch,
  ShotPitchSchema
} from './types.js';
import {
  DP_SYSTEM_PROMPT,
  SHOT_CONCEPTS_SYSTEM_PROMPT,
  COMPILE_SOTA_PROMPT_SYSTEM_PROMPT
} from './prompts.js';
import { StateManager, parseStrictEgress } from './state-manager.js';

export interface PitchShotInput {
  scene_id: string; // e.g. "SCENE_01"
  shot_id?: string; // e.g. "SHOT_01"
  options?: any[];
  pitches?: any[];
  state?: NogyaanState;
}

export interface PitchShotConceptsInput {
  scene_id: string;
  shot_id?: string;
  spatial_memory?: string[];
  concepts?: Record<'1' | '2' | '3', ShotConcept> | Record<string, any>;
  options?: any;
  state?: NogyaanState;
}

export interface CompileSotaPromptInput {
  scene_id: string;
  shot_id?: string;
  selected_option: string; // "1" | "2" | "3" | "Auteur" | "Kinetic" | "Theatrical" or visual intent text
  sota_payload?: string;
  visual_intent?: string;
  egress?: string;
  spatial_facts?: string[];
  spatial_memory?: string[];
  last_shot_egress?: string;
  state?: NogyaanState;
}

export class DpPitchService {
  private stateManager: StateManager;
  private cachedConcepts: Map<string, Record<'1' | '2' | '3', ShotConcept>> = new Map();

  constructor(stateManager?: StateManager) {
    this.stateManager = stateManager || new StateManager();
  }

  // ==========================================================================
  // Tool A: pitch_shot_concepts (Deferred Payload Generation)
  // Generates 3 human-readable paragraphs (visual_intent) using 3 Personas.
  // NO technical camera data. NO JSON bloat. Halts and yields for user selection.
  // ==========================================================================

  public async pitchShotConcepts(input: PitchShotConceptsInput): Promise<ShotConceptsPitch> {
    const sm = input.state ? new StateManager() : this.stateManager;
    if (input.state) {
      sm.setState(input.state);
    }

    const scene = sm.getScene(input.scene_id);
    const existingShots = Object.keys(scene?.shots || {});
    const resolvedShotId = input.shot_id || `SHOT_0${existingShots.length + 1}`;

    if (input.spatial_memory && input.spatial_memory.length > 0) {
      sm.appendSpatialMemory(input.scene_id, input.spatial_memory);
    }

    const contextSlice = sm.getShotContextSlice(input.scene_id, resolvedShotId);

    let concepts: Record<'1' | '2' | '3', ShotConcept> | null = null;

    // Direct dynamic pass-through if provided
    const directConcepts = input.concepts || input.options;
    if (directConcepts) {
      const c = directConcepts as any;
      if (Array.isArray(c) && c.length >= 3) {
        concepts = {
          '1': { option: '1', persona: c[0].persona || 'Auteur', visual_intent: c[0].visual_intent || c[0].txt || String(c[0]) },
          '2': { option: '2', persona: c[1].persona || 'Kinetic', visual_intent: c[1].visual_intent || c[1].txt || String(c[1]) },
          '3': { option: '3', persona: c[2].persona || 'Theatrical', visual_intent: c[2].visual_intent || c[2].txt || String(c[2]) }
        };
      } else if (c['1'] && c['2'] && c['3']) {
        concepts = {
          '1': { option: '1', persona: c['1'].persona || 'Auteur', visual_intent: c['1'].visual_intent || c['1'].txt || String(c['1']) },
          '2': { option: '2', persona: c['2'].persona || 'Kinetic', visual_intent: c['2'].visual_intent || c['2'].txt || String(c['2']) },
          '3': { option: '3', persona: c['3'].persona || 'Theatrical', visual_intent: c['3'].visual_intent || c['3'].txt || String(c['3']) }
        };
      }
    }

    if (!concepts && (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)) {
      try {
        concepts = await this.callLlmConcepts(input.scene_id, resolvedShotId, contextSlice);
      } catch (err: any) {
        console.warn(`[DpPitch] LLM concepts call failed (${err.message}). Using heuristic engine.`);
      }
    }

    if (!concepts) {
      concepts = this.generateHeuristicConcepts(input.scene_id, resolvedShotId, contextSlice);
    }

    // Cache concepts in memory for Tool B retrieval
    const cacheKey = `${input.scene_id}:${resolvedShotId}`;
    this.cachedConcepts.set(cacheKey, concepts);
    // Also cache by scene_id fallback
    this.cachedConcepts.set(input.scene_id, concepts);

    return {
      scene_id: input.scene_id,
      shot_id: resolvedShotId,
      concepts,
      spatial_memory: contextSlice.spatial_memory,
      last_shot_egress: contextSlice.last_shot_egress
    };
  }

  // ==========================================================================
  // Tool B: compile_sota_prompt (SOTA Video Physics & Ingress/Egress Handshake)
  // Single-vector camera, spatial anchoring, posture & eyeline, and temporal handshake.
  // Saves to local JSON state silently.
  // ==========================================================================

  public async compileSotaPrompt(input: CompileSotaPromptInput): Promise<{
    success: boolean;
    scene_id: string;
    shot_id: string;
    shot: ShotNode;
    last_shot_egress: string;
    spatial_memory: string[];
    sota_payload: string;
    visual_intent: string;
    workflow_complete?: boolean;
  }> {
    const sm = input.state ? new StateManager() : this.stateManager;
    if (input.state) {
      sm.setState(input.state);
    }

    const scene = sm.getScene(input.scene_id);
    const existingShots = Object.keys(scene?.shots || {});
    const resolvedShotId = input.shot_id || `SHOT_0${Math.max(1, existingShots.length || 1)}`;

    if (input.spatial_memory && input.spatial_memory.length > 0) {
      sm.appendSpatialMemory(input.scene_id, input.spatial_memory);
    }

    const contextSlice = sm.getShotContextSlice(input.scene_id, resolvedShotId);
    const lastEgress = input.last_shot_egress || contextSlice.last_shot_egress || '';

    const sceneMatch = input.scene_id.match(/(\d+)/);
    const sceneNumber = sceneMatch ? parseInt(sceneMatch[1], 10) : 1;
    const shotMatch = resolvedShotId.match(/(\d+)/);
    const shotNumber = shotMatch ? parseInt(shotMatch[1], 10) : 1;
    const isScene1Shot1 = sceneNumber === 1 && shotNumber === 1;

    // 1. Resolve visual_intent
    let visualIntent = input.visual_intent || '';
    if (!visualIntent) {
      const cacheKey = `${input.scene_id}:${resolvedShotId}`;
      const cached = this.cachedConcepts.get(cacheKey) || this.cachedConcepts.get(input.scene_id);

      const sel = (input.selected_option || '1').trim();
      if (sel === '1' || sel === 'A' || sel.toLowerCase() === 'auteur') {
        visualIntent = cached?.['1']?.visual_intent || this.generateHeuristicConcepts(input.scene_id, resolvedShotId, contextSlice)['1'].visual_intent;
      } else if (sel === '2' || sel === 'B' || sel.toLowerCase() === 'kinetic') {
        visualIntent = cached?.['2']?.visual_intent || this.generateHeuristicConcepts(input.scene_id, resolvedShotId, contextSlice)['2'].visual_intent;
      } else if (sel === '3' || sel === 'C' || sel.toLowerCase() === 'theatrical') {
        visualIntent = cached?.['3']?.visual_intent || this.generateHeuristicConcepts(input.scene_id, resolvedShotId, contextSlice)['3'].visual_intent;
      } else {
        visualIntent = input.selected_option;
      }
    }

    // 2. Generate SOTA Video Payload adhering to the 4 strict physics rules
    // If the caller / LLM directly provided a dynamic sota_payload, use it directly without template overrides!
    let sotaPayload = input.sota_payload ? input.sota_payload.trim() : '';
    let egress = input.egress ? parseStrictEgress(input.egress) : '';
    let spatialFacts: string[] = input.spatial_facts || [];

    if (!sotaPayload) {
      if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
        try {
          const llmResult = await this.callLlmSotaCompile(
            input.scene_id,
            resolvedShotId,
            visualIntent,
            isScene1Shot1 ? '' : lastEgress,
            contextSlice
          );
          if (llmResult) {
            sotaPayload = llmResult.sota_payload;
            egress = parseStrictEgress(llmResult.egress || sotaPayload);
            spatialFacts = llmResult.spatial_facts || [];
          }
        } catch (err: any) {
          console.warn(`[DpPitch] LLM SOTA compilation failed (${err.message}). Using dynamic compiler.`);
        }
      }
    }

    if (!sotaPayload) {
      const compiled = this.generateDynamicSotaPayload(
        input.scene_id,
        resolvedShotId,
        visualIntent,
        lastEgress,
        contextSlice
      );
      sotaPayload = compiled.sota_payload;
      egress = compiled.egress;
      if (spatialFacts.length === 0) spatialFacts = compiled.spatial_facts;
    }

    // Real Egress: compute the actual visual end-frame of the generated payload
    const realEgress = parseStrictEgress(sotaPayload);
    if (realEgress) {
      egress = realEgress;
    }

    // Strip any accidental art style buzzwords
    sotaPayload = sotaPayload
      .replace(/\b(live-action|live action|anime|pixar|3d|photorealistic|hyperrealistic)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const shotNode: ShotNode = {
      visual_intent: visualIntent,
      sota_payload: sotaPayload
    };

    // 3. Save silently to local state: updates scene.shots, scene.last_shot_egress, and spatial_memory
    const updatedState = sm.saveShotNode(
      input.scene_id,
      resolvedShotId,
      shotNode,
      egress,
      spatialFacts
    );

    const updatedScene = updatedState.scenes.find((s) => s.scene_id === input.scene_id);

    // Detect workflow completion: final shot of the final scene (e.g. Scene 4, Shot 3)
    const scenes = updatedState.scenes || [];
    const isScene4 =
      /scene[_-]?0?4\b/i.test(input.scene_id) ||
      input.scene_id.toLowerCase().includes('climax') ||
      input.scene_id.toLowerCase().includes('scene_4');
    const isLastScene =
      scenes.length > 0 &&
      (input.scene_id.toLowerCase() === scenes[scenes.length - 1].scene_id.toLowerCase() ||
        scenes.findIndex((s) => s.scene_id.toLowerCase() === input.scene_id.toLowerCase()) === scenes.length - 1);
    const isFinalScene = isScene4 || (scenes.length >= 4 && isLastScene);

    const shotCount = updatedScene ? Object.keys(updatedScene.shots || {}).length : 0;
    const isShot3OrHigher =
      /shot[_-]?0?[3-9]\b/i.test(resolvedShotId) ||
      resolvedShotId.toLowerCase().includes('shot_3') ||
      resolvedShotId.toLowerCase().includes('shot_03') ||
      resolvedShotId.toLowerCase().includes('final');
    const isFinalShot = isShot3OrHigher || shotCount >= 3;
    const isWorkflowComplete = isFinalScene && isFinalShot;

    return {
      success: true,
      scene_id: input.scene_id,
      shot_id: resolvedShotId,
      shot: shotNode,
      last_shot_egress: updatedScene?.last_shot_egress || egress,
      spatial_memory: updatedScene?.spatial_memory || [],
      sota_payload: sotaPayload,
      visual_intent: visualIntent,
      workflow_complete: isWorkflowComplete
    };
  }

  // ==========================================================================
  // Heuristic Generators (Adhering to Zero-Jargon Concepts & SOTA Physics)
  // ==========================================================================

  private generateHeuristicConcepts(
    scene_id: string,
    shot_id: string,
    slice: {
      scene_narrative: string;
      filtered_assets: AssetBible;
      spatial_memory: string[];
      last_shot_egress: string;
      global_director_notes: string;
    }
  ): Record<'1' | '2' | '3', ShotConcept> {
    const charKeys = Object.keys(slice.filtered_assets.characters || {});
    const charRef1 = charKeys[0] ? `@${charKeys[0]}` : '@CHAR_01';
    const bgKeys = Object.keys(slice.filtered_assets.backgrounds || {});
    const bgRef = bgKeys[0] ? `@${bgKeys[0]}` : '@BG_01';
    const prodRef = '@PROD_01';

    const ingressNote = slice.last_shot_egress
      ? `Picking up immediately from preceding shot: "${slice.last_shot_egress}".`
      : `Establishing physical presence inside ${bgRef}.`;

    return {
      '1': {
        option: '1',
        persona: 'Auteur',
        visual_intent: `${ingressNote} The camera glides with reverence into ${charRef1}'s emotional space. Soft wrapping chiaroscuro light sculpts their contemplative profile against ${bgRef}, pulling the viewer into the raw truth of the moment as they interact with ${prodRef}.`
      },
      '2': {
        option: '2',
        persona: 'Kinetic',
        visual_intent: `${ingressNote} Raw, immediate energy throws the audience directly into the physical motion. The frame trembles with spontaneous motion, capturing the grit and kinetic friction as ${charRef1} moves briskly through ${bgRef} handling ${prodRef}.`
      },
      '3': {
        option: '3',
        persona: 'Theatrical',
        visual_intent: `${ingressNote} An obsessive exercise in architectural symmetry. ${charRef1} is positioned dead-center in balanced framing, moving with dry clockwork precision under saturated, crisp practical lighting with ${prodRef} positioned on axis.`
      }
    };
  }

  public generateDynamicSotaPayload(
    scene_id: string,
    shot_id: string,
    visualIntent: string,
    lastEgress: string,
    slice: {
      scene_narrative: string;
      filtered_assets: AssetBible;
      spatial_memory: string[];
      last_shot_egress: string;
      global_director_notes: string;
    }
  ): { sota_payload: string; egress: string; spatial_facts: string[] } {
    const sceneMatch = scene_id.match(/(\d+)/);
    const sceneNumber = sceneMatch ? parseInt(sceneMatch[1], 10) : 1;
    const shotMatch = shot_id.match(/(\d+)/);
    const shotNumber = shotMatch ? parseInt(shotMatch[1], 10) : 1;
    const isScene1Shot1 = sceneNumber === 1 && shotNumber === 1;

    // 1. Handoff Logic: If shot_number === 1 && scene_number === 1, completely omit Temporal Handshake / Ingress
    let ingressClause = '';
    if (!isScene1Shot1) {
      if (lastEgress && lastEgress.trim().length > 0) {
        ingressClause = `Shot begins with ${lastEgress.trim()}, seamless image-loop continuity from previous shot.`;
      } else {
        ingressClause = `Shot begins establishing continuous physical action from preceding scene.`;
      }
    }

    // 2. User's explicit shot description
    const explicitShotDesc = (visualIntent || '')
      .replace(/\[(?:SYSTEM|Direction|Note|User Note)[^\]]*\]/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // 3. Specific @CHAR and @BG asset definitions from dag-store
    const assets = slice.filtered_assets || this.stateManager.getState().assets || { characters: {}, backgrounds: {}, product: '' };
    const charEntries = Object.entries(assets.characters || {});
    const bgEntries = Object.entries(assets.backgrounds || {});
    const prodDesc = typeof assets.product === 'string' ? assets.product : (assets.product as any)?.name || '';

    const assetClauses: string[] = [];
    if (charEntries.length > 0) {
      const charsText = charEntries
        .map(([k, desc]) => `@${k.replace(/^@/, '')} (${desc})`)
        .join(', ');
      assetClauses.push(`Subject: ${charsText}`);
    }
    if (bgEntries.length > 0) {
      const bgText = bgEntries
        .map(([k, desc]) => `@${k.replace(/^@/, '')} (${desc})`)
        .join(', ');
      assetClauses.push(`Setting: ${bgText}`);
    }
    if (prodDesc) {
      assetClauses.push(`Product: @PROD_01 (${prodDesc})`);
    }
    const assetSpec = assetClauses.length > 0 ? assetClauses.join('. ') + '.' : '';

    // 4. Computed camera physics derived from the chosen style (Auteur/Kinetic/Theatrical)
    const lowerIntent = explicitShotDesc.toLowerCase();
    let style: 'Auteur' | 'Kinetic' | 'Theatrical' = 'Auteur';
    if (lowerIntent.includes('kinetic') || lowerIntent.includes('dynamic') || lowerIntent.includes('fast') || lowerIntent.includes('friction') || lowerIntent.includes('grit') || lowerIntent.includes('motion')) {
      style = 'Kinetic';
    } else if (lowerIntent.includes('theatric') || lowerIntent.includes('symmetr') || lowerIntent.includes('architect') || lowerIntent.includes('dead-center') || lowerIntent.includes('precision') || lowerIntent.includes('order')) {
      style = 'Theatrical';
    } else {
      style = 'Auteur';
    }

    let cameraPhysics = '';
    if (style === 'Kinetic') {
      cameraPhysics = 'Camera Physics [Kinetic]: Dynamic continuous tracking vector matching subject momentum on wide 28mm optical axis at energetic pacing.';
    } else if (style === 'Theatrical') {
      cameraPhysics = 'Camera Physics [Theatrical]: Centered perpendicular camera alignment on balanced symmetrical axis with deep focus architectural staging.';
    } else {
      cameraPhysics = 'Camera Physics [Auteur]: Slow continuous push-in vector on 50mm eye-level axis with subtle pacing and shallow depth of field.';
    }

    // 5. Concluding visual frame (Real Egress)
    const primaryChar = charEntries[0] ? `@${charEntries[0][0].replace(/^@/, '')}` : '@CHAR_01';
    const primaryBg = bgEntries[0] ? `@${bgEntries[0][0].replace(/^@/, '')}` : '@BG_01';

    let terminalVisual = '';
    const sentences = explicitShotDesc.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    const lastSentence = sentences[sentences.length - 1] || '';
    if (lastSentence && lastSentence.length > 10 && !lastSentence.toLowerCase().includes('camera')) {
      terminalVisual = lastSentence.replace(/[.]+$/, '');
    } else {
      terminalVisual = `${primaryChar} in settled posture within ${primaryBg}, maintaining stable optical eyeline`;
    }

    const egressSentence = `Shot ends with ${terminalVisual}.`;

    // 6. Dynamic Assembly
    const parts: string[] = [];
    if (ingressClause) parts.push(ingressClause);
    if (explicitShotDesc) parts.push(explicitShotDesc.endsWith('.') ? explicitShotDesc : `${explicitShotDesc}.`);
    if (assetSpec) parts.push(assetSpec);
    if (cameraPhysics) parts.push(cameraPhysics);
    parts.push(egressSentence);

    const fullPayload = parts.join(' ').replace(/\s{2,}/g, ' ').trim();
    const realEgress = parseStrictEgress(fullPayload);

    const spatialFacts: string[] = [];
    if (charEntries[0]) {
      spatialFacts.push(`@${charEntries[0][0].replace(/^@/, '')} is positioned in ${bgEntries[0] ? `@${bgEntries[0][0].replace(/^@/, '')}` : 'scene'}`);
    }
    if (prodDesc) {
      spatialFacts.push(`@PROD_01 is staged in immediate foreground workspace`);
    }

    return {
      sota_payload: fullPayload,
      egress: realEgress,
      spatial_facts: spatialFacts
    };
  }

  private generateHeuristicSotaPayload(
    scene_id: string,
    shot_id: string,
    visualIntent: string,
    lastEgress: string,
    slice: {
      scene_narrative: string;
      filtered_assets: AssetBible;
      spatial_memory: string[];
      last_shot_egress: string;
      global_director_notes: string;
    }
  ): { sota_payload: string; egress: string; spatial_facts: string[] } {
    return this.generateDynamicSotaPayload(scene_id, shot_id, visualIntent, lastEgress, slice);
  }

  // ==========================================================================
  // LLM Call Implementations
  // ==========================================================================

  private async callLlmConcepts(
    scene_id: string,
    shot_id: string,
    slice: {
      scene_narrative: string;
      filtered_assets: AssetBible;
      spatial_memory: string[];
      last_shot_egress: string;
      global_director_notes: string;
    }
  ): Promise<Record<'1' | '2' | '3', ShotConcept> | null> {
    const userPrompt = `Target: ${scene_id} -> ${shot_id}
Locked Narrative: ${slice.scene_narrative}
Filtered Assets: ${JSON.stringify(slice.filtered_assets)}
Spatial Memory: ${JSON.stringify(slice.spatial_memory)}
Preceding Shot Egress: ${slice.last_shot_egress || 'None (Shot 1)'}
Director Notes: ${slice.global_director_notes || 'None'}

Output exactly 3 human-readable visual intent concepts in raw minified JSON:
{
  "1": { "persona": "Auteur", "visual_intent": "..." },
  "2": { "persona": "Kinetic", "visual_intent": "..." },
  "3": { "persona": "Theatrical", "visual_intent": "..." }
}`;

    if (process.env.ANTHROPIC_API_KEY) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          system: SHOT_CONCEPTS_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });
      if (res.ok) {
        const json: any = await res.json();
        const text = json.content?.[0]?.text || '';
        return this.parseConcepts(text);
      }
    }

    if (process.env.OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: SHOT_CONCEPTS_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' }
        })
      });
      if (res.ok) {
        const json: any = await res.json();
        const text = json.choices?.[0]?.message?.content || '';
        return this.parseConcepts(text);
      }
    }

    return null;
  }

  private async callLlmSotaCompile(
    scene_id: string,
    shot_id: string,
    visualIntent: string,
    lastEgress: string,
    slice: {
      scene_narrative: string;
      filtered_assets: AssetBible;
      spatial_memory: string[];
      last_shot_egress: string;
      global_director_notes: string;
    }
  ): Promise<{ sota_payload: string; egress: string; spatial_facts: string[] } | null> {
    const userPrompt = `Target: ${scene_id} -> ${shot_id}
Visual Intent Selected: ${visualIntent}
Locked Narrative: ${slice.scene_narrative}
Filtered Assets: ${JSON.stringify(slice.filtered_assets)}
Spatial Memory: ${JSON.stringify(slice.spatial_memory)}
Preceding Shot Egress: ${lastEgress || 'None (Shot 1)'}
Director Notes: ${slice.global_director_notes || 'None'}

Compile into raw minified JSON:
{
  "sota_payload": "Dense prompt strictly following 4 rules (INGRESS matching last_shot_egress, single-vector camera, spatial light anchor, physical posture/eyeline, and EGRESS)...",
  "egress": "Extracted terminating state from 'Shot ends with...'",
  "spatial_facts": ["...", "..."]
}`;

    if (process.env.ANTHROPIC_API_KEY) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          system: COMPILE_SOTA_PROMPT_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });
      if (res.ok) {
        const json: any = await res.json();
        const text = json.content?.[0]?.text || '';
        return this.parseSotaResponse(text);
      }
    }

    if (process.env.OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: COMPILE_SOTA_PROMPT_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' }
        })
      });
      if (res.ok) {
        const json: any = await res.json();
        const text = json.choices?.[0]?.message?.content || '';
        return this.parseSotaResponse(text);
      }
    }

    return null;
  }

  private parseConcepts(text: string): Record<'1' | '2' | '3', ShotConcept> | null {
    try {
      const clean = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const first = clean.indexOf('{');
      const last = clean.lastIndexOf('}');
      if (first !== -1 && last !== -1) {
        const parsed = JSON.parse(clean.substring(first, last + 1));
        if (parsed['1'] && parsed['2'] && parsed['3']) {
          return {
            '1': { option: '1', persona: parsed['1'].persona || 'Auteur', visual_intent: parsed['1'].visual_intent || parsed['1'].txt || '' },
            '2': { option: '2', persona: parsed['2'].persona || 'Kinetic', visual_intent: parsed['2'].visual_intent || parsed['2'].txt || '' },
            '3': { option: '3', persona: parsed['3'].persona || 'Theatrical', visual_intent: parsed['3'].visual_intent || parsed['3'].txt || '' }
          };
        }
      }
    } catch {}
    return null;
  }

  private parseSotaResponse(text: string): { sota_payload: string; egress: string; spatial_facts: string[] } | null {
    try {
      const clean = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const first = clean.indexOf('{');
      const last = clean.lastIndexOf('}');
      if (first !== -1 && last !== -1) {
        const parsed = JSON.parse(clean.substring(first, last + 1));
        if (parsed.sota_payload) {
          return {
            sota_payload: parsed.sota_payload,
            egress: parsed.egress || '',
            spatial_facts: parsed.spatial_facts || []
          };
        }
      }
    } catch {}
    return null;
  }

  // ==========================================================================
  // Backward-Compatible pitchShotOptions (Wraps Tool A for legacy tests)
  // ==========================================================================

  public async pitchShotOptions(input: PitchShotInput): Promise<ShotPitch[]> {
    const sm = input.state ? new StateManager() : this.stateManager;
    if (input.state) {
      sm.setState(input.state);
    }
    const shot_id = input.shot_id || 'SHOT_01';

    const dynamicPitches = input.options || input.pitches;
    if (Array.isArray(dynamicPitches) && dynamicPitches.length > 0) {
      return dynamicPitches.map((p, idx) => {
        const id = p.id || (idx === 0 ? 'A' : idx === 1 ? 'B' : 'C');
        const style = p.style || p.persona || (idx === 0 ? 'Auteur' : idx === 1 ? 'Kinetic' : 'Theatrical');
        const txt = p.txt || p.visual_intent || p.text || '';
        const prmpt = p.prmpt || p.sota_payload || p.prompt || '';
        return ShotPitchSchema.parse({
          id,
          style,
          txt,
          prmpt
        });
      });
    }

    const pitch = await this.pitchShotConcepts({
      scene_id: input.scene_id,
      shot_id,
      state: input.state
    });

    const c1 = pitch.concepts['1'];
    const c2 = pitch.concepts['2'];
    const c3 = pitch.concepts['3'];

    const h1 = this.generateHeuristicSotaPayload(input.scene_id, shot_id, c1.visual_intent, pitch.last_shot_egress, sm.getShotContextSlice(input.scene_id, shot_id));
    const h2 = this.generateHeuristicSotaPayload(input.scene_id, shot_id, c2.visual_intent, pitch.last_shot_egress, sm.getShotContextSlice(input.scene_id, shot_id));
    const h3 = this.generateHeuristicSotaPayload(input.scene_id, shot_id, c3.visual_intent, pitch.last_shot_egress, sm.getShotContextSlice(input.scene_id, shot_id));

    return [
      ShotPitchSchema.parse({
        id: 'A',
        style: 'Auteur',
        txt: c1.visual_intent,
        prmpt: h1.sota_payload
      }),
      ShotPitchSchema.parse({
        id: 'B',
        style: 'Kinetic',
        txt: c2.visual_intent,
        prmpt: h2.sota_payload
      }),
      ShotPitchSchema.parse({
        id: 'C',
        style: 'Theatrical',
        txt: c3.visual_intent,
        prmpt: h3.sota_payload
      })
    ];
  }
}
