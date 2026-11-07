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
            lastEgress,
            contextSlice
          );
          if (llmResult) {
            sotaPayload = llmResult.sota_payload;
            egress = parseStrictEgress(llmResult.egress);
            spatialFacts = llmResult.spatial_facts || [];
          }
        } catch (err: any) {
          console.warn(`[DpPitch] LLM SOTA compilation failed (${err.message}). Using heuristic compiler.`);
        }
      }
    }

    if (!sotaPayload) {
      const heuristic = this.generateHeuristicSotaPayload(
        input.scene_id,
        resolvedShotId,
        visualIntent,
        lastEgress,
        contextSlice
      );
      sotaPayload = heuristic.sota_payload;
      if (!egress) egress = parseStrictEgress(heuristic.egress);
      if (spatialFacts.length === 0) spatialFacts = heuristic.spatial_facts;
    }

    // Ensure egress is strictly parsed and free of meta-notes
    if (!egress) {
      egress = parseStrictEgress(sotaPayload);
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
    const charKeys = Object.keys(slice.filtered_assets.characters || {});
    const charRef1 = charKeys[0] ? `@${charKeys[0]}` : '@CHAR_01';
    const bgKeys = Object.keys(slice.filtered_assets.backgrounds || {});
    const bgRef = bgKeys[0] ? `@${bgKeys[0]}` : '@BG_01';
    const prodRef = '@PROD_01';

    // 1. Ingress Handshake
    const ingressClause = lastEgress && lastEgress.trim().length > 0
      ? `Shot begins with ${lastEgress}, seamless image-loop continuity from previous shot`
      : `Shot begins with ${charRef1} positioned inside ${bgRef}, maintaining composed physical balance`;

    // 2. Single-Vector Camera (NO compound pan-tilts)
    const isKinetic = visualIntent.toLowerCase().includes('kinetic') || visualIntent.toLowerCase().includes('raw');
    const isTheatrical = visualIntent.toLowerCase().includes('symmetr') || visualIntent.toLowerCase().includes('theatrical');
    let cameraClause = 'Camera holds locked-off on static tripod at eye-level axis 4 feet from subject';
    if (isKinetic) {
      cameraClause = 'Camera glides along single continuous forward push-in vector on eye-level axis at moderate speed';
    } else if (isTheatrical) {
      cameraClause = 'Camera bolted on static locked-off tripod dead-center at eye-level height with symmetrical room alignment';
    }

    // 3. Spatial Anchoring (Camera axis & light origin)
    const lightOrigin = 'Primary key light originating from screen-left high window casting soft natural directional falloff, ambient warm fill from screen-right';

    // 4. Physical Posture & Eyeline
    const postureClause = `${charRef1} maintains upright posture, shoulders relaxed, hands positioned in foreground workspace, eyeline locked 10 degrees screen-left towards ${prodRef}`;

    // 5. Egress Handshake
    const egressClause = `${charRef1} holds steady resting posture beside ${prodRef}, eyes locked in calm focus`;

    const fullPayload = `${ingressClause}. ${cameraClause}. Spatial Anchor: ${lightOrigin}. Physical Posture: ${postureClause}. Action: Continuous subtle micro-movement and natural breathing. Shot ends with ${egressClause}.`;

    const spatialFacts = [
      `${charRef1} is positioned in ${bgRef}`,
      `${prodRef} is positioned screen-left of ${charRef1}`
    ];

    return {
      sota_payload: fullPayload,
      egress: egressClause,
      spatial_facts: spatialFacts
    };
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
