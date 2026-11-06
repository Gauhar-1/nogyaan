import {
  AnyLockedScriptSchema,
  AnyLockedShotSchema,
  LockedScript,
  LockedShot,
  NogyaanState
} from './types.js';
import { REROLL_SYSTEM_PROMPT } from './prompts.js';
import { StateManager } from './state-manager.js';

export interface RerollNodeInput {
  node_id: string; // scene_id (e.g. "SCENE_01") or shot_id (e.g. "SHOT_01" or "SCENE_01:SHOT_01")
  user_feedback: string;
}

export interface RerollNodeResult {
  node_id: string;
  type: 'scene' | 'shot';
  scene_id: string;
  shot_id?: string;
  updated_node: LockedScript | LockedShot;
  state: NogyaanState;
}

export class RerollService {
  private stateManager: StateManager;

  constructor(stateManager?: StateManager) {
    this.stateManager = stateManager || new StateManager();
  }

  /**
   * Performs an isolated, targeted re-roll of a single node in NogyaanState.
   * Context Slice: ONLY the exact JSON object of the target node and the user feedback.
   * Prevents burning tokens on re-generating the entire storyboard.
   */
  public async rerollNode(input: RerollNodeInput): Promise<RerollNodeResult> {
    if (!input.node_id || !input.node_id.trim()) {
      throw new Error('node_id is required for targeted re-roll.');
    }
    if (!input.user_feedback || !input.user_feedback.trim()) {
      throw new Error('user_feedback is required for targeted re-roll.');
    }

    const contextSlice = this.stateManager.getNodeContextSlice(input.node_id);
    const targetNode = contextSlice.target_node;

    if (contextSlice.type === 'scene') {
      const updatedScript = await this.rerollScriptNode(targetNode as LockedScript, input.user_feedback);
      const found = this.stateManager.findNode(input.node_id)!;
      const newState = this.stateManager.updateLockedScript(found.scene.scene_id, updatedScript);

      return {
        node_id: input.node_id,
        type: 'scene',
        scene_id: found.scene.scene_id,
        updated_node: updatedScript,
        state: newState
      };
    } else {
      const found = this.stateManager.findNode(input.node_id)!;
      if (found.type !== 'shot') {
        throw new Error(`Expected shot node for "${input.node_id}".`);
      }
      const updatedShot = await this.rerollShotNode(targetNode as LockedShot, input.user_feedback);
      const newState = this.stateManager.updateLockedShot(found.scene.scene_id, found.shot_id, updatedShot);

      return {
        node_id: input.node_id,
        type: 'shot',
        scene_id: found.scene.scene_id,
        shot_id: found.shot_id,
        updated_node: updatedShot,
        state: newState
      };
    }
  }

  private async rerollScriptNode(
    currentScript: LockedScript,
    userFeedback: string
  ): Promise<LockedScript> {
    if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
      try {
        const res = await this.callLlmMiniPrompt(currentScript, userFeedback, 'script');
        if (res) return AnyLockedScriptSchema.parse(res);
      } catch (err: any) {
        console.warn(`[RerollService] LLM re-roll failed (${err.message}). Using heuristic refinement.`);
      }
    }

    // Heuristic refinement for ScriptPitch / ScriptOption
    const cur: any = currentScript;
    if (cur.txt !== undefined) {
      // ScriptPitch
      const rewritten = this.rewriteTextNaturally(cur.txt || '', userFeedback);
      return AnyLockedScriptSchema.parse({
        id: cur.id || 'A',
        style: cur.style || 'Heartfelt',
        txt: rewritten
      });
    }

    // Verbose ScriptOption fallback
    const newNarrative = this.rewriteTextNaturally(cur.narrative_block || '', userFeedback);
    const newDialogue = userFeedback.toLowerCase().includes('dialogue') || userFeedback.toLowerCase().includes('say')
      ? `${cur.audio_stem?.dialogue || ''} (Refined: "${userFeedback.replace(/["']/g, '')}")`
      : cur.audio_stem?.dialogue || null;

    return AnyLockedScriptSchema.parse({
      option_id: cur.option_id || 'OPT_1',
      writer_persona: cur.writer_persona || 'Heartfelt Nostalgist',
      narrative_block: newNarrative,
      audio_stem: {
        dialogue: newDialogue,
        sfx: cur.audio_stem?.sfx || 'Refined ambient tone'
      }
    });
  }

  private async rerollShotNode(
    currentShot: LockedShot,
    userFeedback: string
  ): Promise<LockedShot> {
    if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
      try {
        const res = await this.callLlmMiniPrompt(currentShot, userFeedback, 'shot');
        if (res) return AnyLockedShotSchema.parse(res);
      } catch (err: any) {
        console.warn(`[RerollService] LLM shot re-roll failed (${err.message}). Using heuristic refinement.`);
      }
    }

    // Heuristic refinement for ShotPitch / ShotOption / ShotNode:
    // Completely rewrite and naturally integrate new instructions, NEVER appending bracketed notes.
    const cur: any = currentShot;
    if (cur.prmpt !== undefined) {
      // ShotPitch
      const newTxt = this.rewriteTextNaturally(cur.txt || '', userFeedback);
      const newPrmpt = this.rewriteTextNaturally(cur.prmpt || '', userFeedback)
        .replace(/\b(live-action|live action|anime|pixar|3d|photorealistic)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      return AnyLockedShotSchema.parse({
        id: cur.id || 'A',
        style: cur.style || 'Auteur',
        txt: newTxt,
        prmpt: newPrmpt
      });
    }

    if (cur.sota_payload !== undefined || (cur.visual_intent !== undefined && !cur.ai_payload)) {
      // ShotNode
      const baseIntent = cur.visual_intent || cur.txt || '';
      const basePayload = cur.sota_payload || cur.ai_payload || '';
      const newIntent = this.rewriteTextNaturally(baseIntent, userFeedback);
      const newPayload = this.rewriteTextNaturally(basePayload, userFeedback)
        .replace(/\b(live-action|live action|anime|pixar|3d|photorealistic)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      return AnyLockedShotSchema.parse({
        id: cur.id || 'A',
        style: cur.style || 'Auteur',
        visual_intent: newIntent,
        sota_payload: newPayload
      });
    }

    // Verbose ShotOption fallback
    const newIntent = this.rewriteTextNaturally(cur.visual_intent || '', userFeedback);
    const newPayload = this.rewriteTextNaturally(cur.ai_payload || '', userFeedback)
      .replace(/\b(live-action|live action|anime|pixar|3d|photorealistic)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return AnyLockedShotSchema.parse({
      option_id: cur.option_id || 'OPT_1',
      director_persona: cur.director_persona || 'Intimate Auteur',
      visual_intent: newIntent,
      ai_payload: newPayload
    });
  }

  /**
   * Completely rewrites base text incorporating new user directions naturally,
   * explicitly removing bracketed notes and contradictory physical/camera facts.
   */
  private rewriteTextNaturally(baseText: string, instruction: string): string {
    const cleanInst = instruction
      .trim()
      .replace(/^\[|\]$/g, '')
      .replace(/^(direction|note|directorial note|refinement):\s*/i, '');

    let rewritten = baseText;

    const requestsStanding = /\b(?:stand|stands|standing|rise|rises|rising|upright)\b/i.test(cleanInst);
    const requestsSitting = !requestsStanding && /\b(?:sit|sits|seated|sitting)\b/i.test(cleanInst);

    // Erase contradictory physical postures if direction requests standing
    if (requestsStanding) {
      rewritten = rewritten.replace(/\b(?:is\s+)?(?:seated|sitting|reclined|rests in chair|in the desk chair)\b/gi, 'standing');
      rewritten = rewritten.replace(/\bupright seated posture\b/gi, 'standing posture');
      rewritten = rewritten.replace(/\bseated\b/gi, 'standing');
    }
    // Erase contradictory physical postures if direction requests sitting
    else if (requestsSitting) {
      rewritten = rewritten.replace(/\b(?:is\s+)?(?:standing|stands|walking|pacing)\b/gi, 'seated');
      rewritten = rewritten.replace(/\bstanding posture\b/gi, 'seated posture');
      rewritten = rewritten.replace(/\bstanding\b/gi, 'seated');
    }

    // Erase any existing bracketed notes like [Direction: ...] or [Note applied: ...]
    rewritten = rewritten.replace(/\s*\[(?:Direction|Note applied|Note)[^\]]*\]/gi, '');
    rewritten = rewritten.replace(/\s*\((?:Directorial adjustment|Refinement)[^\)]*\)/gi, '');

    // Seamlessly weave new instruction into prose without brackets
    const cleanBase = rewritten.trim().replace(/[.,;]+$/, '');
    const capitalizedInst = cleanInst.charAt(0).toUpperCase() + cleanInst.slice(1).replace(/[.]+$/, '');

    return `${cleanBase}. ${capitalizedInst}.`;
  }

  private async callLlmMiniPrompt(
    targetNode: any,
    userFeedback: string,
    type: 'script' | 'shot'
  ): Promise<any | null> {
    const userPrompt = `Target JSON Node:
${JSON.stringify(targetNode, null, 2)}

User Direction:
${userFeedback}

CRITICAL: When rerolling, you must COMPLETELY REWRITE the sota_payload and visual_intent from scratch to naturally weave in the user's new instructions. NEVER append bracketed notes like [Direction: ...]. Ensure old, contradictory physical facts are completely erased from the new text. Output raw minified JSON only.`;

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
          system: REROLL_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });
      if (res.ok) {
        const json: any = await res.json();
        const text = json.content?.[0]?.text || '';
        return this.parseNode(text);
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
            { role: 'system', content: REROLL_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' }
        })
      });
      if (res.ok) {
        const json: any = await res.json();
        const text = json.choices?.[0]?.message?.content || '';
        return this.parseNode(text);
      }
    }

    return null;
  }

  private parseNode(text: string): any | null {
    try {
      const clean = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const first = clean.indexOf('{');
      const last = clean.lastIndexOf('}');
      if (first !== -1 && last !== -1) {
        return JSON.parse(clean.substring(first, last + 1));
      }
    } catch {}
    return null;
  }
}
