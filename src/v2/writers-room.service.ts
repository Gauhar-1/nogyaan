import { ScriptPitch, ScriptPitchSchema, NogyaanState } from './types.js';
import { WRITER_SYSTEM_PROMPT } from './prompts.js';
import { StateManager } from './state-manager.js';

export interface PitchScriptInput {
  scene_id: string; // e.g. "SCENE_01"
  user_guidance?: string;
  options?: ScriptPitch[] | any[];
  state?: NogyaanState;
}

export class WritersRoomService {
  private stateManager: StateManager;

  constructor(stateManager?: StateManager) {
    this.stateManager = stateManager || new StateManager();
  }

  /**
   * Generates exactly 3 ScriptPitch choices using Just-In-Time Context Slicing.
   * Only receives the Core Premise and Scene N-1 locked narrative.
   * Never receives Scene N-2, Scene N-3, camera data, or assets.
   */
  public async pitchScriptOptions(input: PitchScriptInput): Promise<ScriptPitch[]> {
    const sm = input.state ? new StateManager() : this.stateManager;
    if (input.state) {
      sm.setState(input.state);
    }

    // Direct dynamic pass-through if pre-generated options provided
    if (input.options && Array.isArray(input.options) && input.options.length >= 3) {
      return input.options.slice(0, 3).map((opt, idx) => {
        const id = opt.id || String.fromCharCode(65 + idx);
        const style = opt.style || opt.writer_persona || (idx === 0 ? 'Heartfelt' : idx === 1 ? 'Viral' : 'Offbeat');
        const txt = opt.txt || opt.narrative_block || opt.description || opt.summary || String(opt);
        return ScriptPitchSchema.parse({ id, style, txt });
      });
    }

    // Just-In-Time Context Slice: ONLY Core Premise & Scene N-1
    const contextSlice = sm.getScriptContextSlice(input.scene_id);

    let options: ScriptPitch[] | null = null;

    if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
      try {
        options = await this.callLlmWriter(input.scene_id, contextSlice, input.user_guidance);
      } catch (err: any) {
        console.warn(`[WritersRoom] LLM API call failed (${err.message}). Using heuristic engine.`);
      }
    }

    if (!options || options.length < 3) {
      options = this.generateHeuristicScriptPitches(input.scene_id, contextSlice, input.user_guidance);
    }

    // Validate all 3 pitches against ScriptPitchSchema
    return options.slice(0, 3).map((opt) => ScriptPitchSchema.parse(opt));
  }

  private generateHeuristicScriptPitches(
    scene_id: string,
    slice: { core_premise: string; previous_scene_narrative: string | null },
    userGuidance?: string
  ): ScriptPitch[] {
    const guidance = userGuidance ? ` Focus: ${userGuidance}.` : '';
    const prevContext = slice.previous_scene_narrative
      ? `Picking up from: "${slice.previous_scene_narrative.slice(0, 80)}..."`
      : 'Opening scene establishing character and daily friction.';

    const premiseTheme = slice.core_premise || 'Authentic human storytelling';

    // 1. Heartfelt Nostalgist (grounded, intimate, emotional connection around core premise)
    const optA: ScriptPitch = {
      id: 'A',
      style: 'Heartfelt',
      txt: `${prevContext} An intimate, grounded human beat highlighting ${premiseTheme}. Characters navigate real emotional stakes with understated honesty, letting subtle body language and shared recognition carry the moment.${guidance}`.trim()
    };

    // 2. Viral Disruptor (punchy, high-energy, relatable friction)
    const optB: ScriptPitch = {
      id: 'B',
      style: 'Viral',
      txt: `${prevContext} High-impact relatable friction tackling ${premiseTheme}. Rapid-fire visual escalation turns everyday frustration into a dynamic, modern turning point with punchy visual pacing.${guidance}`.trim()
    };

    // 3. Offbeat Eccentric (deadpan, eccentric, stylized precision)
    const optC: ScriptPitch = {
      id: 'C',
      style: 'Offbeat',
      txt: `${prevContext} Stylized deadpan observation framing ${premiseTheme}. Meticulous physical choreography and dry visual comedy give everyday objects and routine actions unexpected narrative weight.${guidance}`.trim()
    };

    return [optA, optB, optC];
  }

  private async callLlmWriter(
    scene_id: string,
    slice: { core_premise: string; previous_scene_narrative: string | null },
    userGuidance?: string
  ): Promise<ScriptPitch[] | null> {
    const userPrompt = `Scene Target: "${scene_id}"
Core Campaign Premise / Goal: ${slice.core_premise}
Locked Scene N-1 Narrative (Continuity): ${slice.previous_scene_narrative || 'None (Scene 1 Opening)'}
User Guidance: ${userGuidance || 'None provided'}

Generate exactly 3 ScriptPitch options in raw minified JSON:
[
  {"id": "A", "style": "Heartfelt", "txt": "..."},
  {"id": "B", "style": "Viral", "txt": "..."},
  {"id": "C", "style": "Offbeat", "txt": "..."}
]`;

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
          system: WRITER_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });
      if (res.ok) {
        const json: any = await res.json();
        const text = json.content?.[0]?.text || '';
        return this.parsePitches(text);
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
            { role: 'system', content: WRITER_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' }
        })
      });
      if (res.ok) {
        const json: any = await res.json();
        const text = json.choices?.[0]?.message?.content || '';
        return this.parsePitches(text);
      }
    }

    return null;
  }

  private parsePitches(text: string): ScriptPitch[] | null {
    try {
      const clean = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const first = clean.indexOf('[');
      const last = clean.lastIndexOf(']');
      if (first !== -1 && last !== -1) {
        const parsed = JSON.parse(clean.substring(first, last + 1));
        return parsed.map((item: any) => ScriptPitchSchema.parse(item));
      }
      const firstObj = clean.indexOf('{');
      const lastObj = clean.lastIndexOf('}');
      if (firstObj !== -1 && lastObj !== -1) {
        const parsed = JSON.parse(clean.substring(firstObj, lastObj + 1));
        const arr = Array.isArray(parsed) ? parsed : parsed.options || [];
        return arr.map((item: any) => ScriptPitchSchema.parse(item));
      }
    } catch {}
    return null;
  }
}
