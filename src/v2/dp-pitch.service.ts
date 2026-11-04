import { AssetBible, LockedShot, NogyaanState, ShotPitch, ShotPitchSchema } from './types.js';
import { DP_SYSTEM_PROMPT } from './prompts.js';
import { StateManager } from './state-manager.js';

export interface PitchShotInput {
  scene_id: string; // e.g. "SCENE_01"
  shot_id: string; // e.g. "SHOT_01"
  state?: NogyaanState;
}

export class DpPitchService {
  private stateManager: StateManager;

  constructor(stateManager?: StateManager) {
    this.stateManager = stateManager || new StateManager();
  }

  /**
   * Generates exactly 3 ShotPitch choices using strict Shot-by-Shot serialization.
   * Context Slice: ONLY Scene N narrative txt, Filtered Asset Bible (Scene N active_refs),
   * and Shot X-1 state.
   */
  public async pitchShotOptions(input: PitchShotInput): Promise<ShotPitch[]> {
    const sm = input.state ? new StateManager() : this.stateManager;
    if (input.state) {
      sm.setState(input.state);
    }

    // Just-In-Time Context Slice: ONLY Scene N txt, Filtered Assets, and Shot X-1
    const contextSlice = sm.getShotContextSlice(input.scene_id, input.shot_id);

    let options: ShotPitch[] | null = null;

    if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
      try {
        options = await this.callLlmDp(input.scene_id, input.shot_id, contextSlice);
      } catch (err: any) {
        console.warn(`[DpPitch] LLM API call failed (${err.message}). Using heuristic engine.`);
      }
    }

    if (!options || options.length < 3) {
      options = this.generateHeuristicShotPitches(input.scene_id, input.shot_id, contextSlice);
    }

    // Strip any accidental art style words from prmpt and validate
    return options.slice(0, 3).map((opt) => {
      const cleanPrmpt = opt.prmpt
        .replace(/\b(live-action|live action|anime|pixar|3d|photorealistic|hyperrealistic)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

      return ShotPitchSchema.parse({
        ...opt,
        prmpt: cleanPrmpt
      });
    });
  }

  private generateHeuristicShotPitches(
    scene_id: string,
    shot_id: string,
    slice: {
      scene_narrative: string;
      filtered_assets: AssetBible;
      previous_shot: LockedShot | null;
    }
  ): ShotPitch[] {
    const charKeys = Object.keys(slice.filtered_assets.characters || {});
    const charRef1 = charKeys[0] ? `@${charKeys[0]}` : '@CHAR_01';
    const bgKeys = Object.keys(slice.filtered_assets.backgrounds || {});
    const bgRef = bgKeys[0] ? `@${bgKeys[0]}` : '@BG_01';
    const prodRef = '@PROD_01';

    const prevNote = slice.previous_shot
      ? `Picking up spatial orientation from preceding shot: continuity hold.`
      : `Establishing master spatial coordinates in ${bgRef}.`;

    // 1. Auteur (Intimate Auteur)
    const optA: ShotPitch = {
      id: 'A',
      style: 'Auteur',
      txt: `${prevNote} The camera glides with reverence into ${charRef1}'s emotional space. Soft wrapping chiaroscuro light sculpts their contemplative profile against the velvety depths of ${bgRef}, pulling the viewer into the raw truth of the moment.`,
      prmpt: `85mm lens, f/1.4 shallow depth of field, slow fluid-head push-in, chiaroscuro lighting with crushed shadows and warm key wrap. Tight medium close-up of ${charRef1} in ${bgRef}. Micro-eyebrow twitch, steady breath. Blurred background textures. Single continuous take, zero cuts.`
    };

    // 2. Kinetic (Kinetic Documentarian)
    const optB: ShotPitch = {
      id: 'B',
      style: 'Kinetic',
      txt: `${prevNote} Raw, immediate energy throws the audience directly into the chaos. The wide glass trembles with spontaneous physical motion, capturing the grit and kinetic friction as ${charRef1} moves briskly through ${bgRef}.`,
      prmpt: `24mm ultra-wide lens, f/8 deep focus, aggressive handheld camera jitter, harsh directional side lighting with high-contrast specular highlights. Low-angle tracking shot pacing rapidly alongside ${charRef1} inside ${bgRef}. Rapid momentum, snap pan to ${prodRef}. Deep focus. Zero cuts.`
    };

    // 3. Theatrical (Theatrical Stylist)
    const optC: ShotPitch = {
      id: 'C',
      style: 'Theatrical',
      txt: `${prevNote} An obsessive exercise in architectural symmetry. ${charRef1} is positioned dead-center like a Wes Anderson dollhouse tableau, moving with dry clockwork precision under saturated, crisp practical lighting.`,
      prmpt: `50mm prime lens, f/4 aperture, bolted heavy tripod, centered geometric symmetry, high-key even practical lighting with flat shadows. Locked static medium shot of ${charRef1} centered inside ${bgRef}. Synchronized deadpan head turn. Architectural alignment. Single continuous hold.`
    };

    return [optA, optB, optC];
  }

  private async callLlmDp(
    scene_id: string,
    shot_id: string,
    slice: {
      scene_narrative: string;
      filtered_assets: AssetBible;
      previous_shot: LockedShot | null;
    }
  ): Promise<ShotPitch[] | null> {
    const userPrompt = `Target: ${scene_id} -> ${shot_id}
Locked Scene Narrative (txt): ${slice.scene_narrative}
Filtered Asset Bible (Scene Active Refs Only): ${JSON.stringify(slice.filtered_assets)}
Preceding Shot X-1 (Spatial Continuity): ${slice.previous_shot ? JSON.stringify(slice.previous_shot) : 'None (Shot 1 opener)'}

Generate exactly 3 ShotPitch options in raw minified JSON:
[
  {"id": "A", "style": "Auteur", "txt": "...", "prmpt": "..."},
  {"id": "B", "style": "Kinetic", "txt": "...", "prmpt": "..."},
  {"id": "C", "style": "Theatrical", "txt": "...", "prmpt": "..."}
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
          max_tokens: 1536,
          system: DP_SYSTEM_PROMPT,
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
            { role: 'system', content: DP_SYSTEM_PROMPT },
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

  private parsePitches(text: string): ShotPitch[] | null {
    try {
      const clean = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const first = clean.indexOf('[');
      const last = clean.lastIndexOf(']');
      if (first !== -1 && last !== -1) {
        const parsed = JSON.parse(clean.substring(first, last + 1));
        return parsed.map((item: any) => ShotPitchSchema.parse(item));
      }
      const firstObj = clean.indexOf('{');
      const lastObj = clean.lastIndexOf('}');
      if (firstObj !== -1 && lastObj !== -1) {
        const parsed = JSON.parse(clean.substring(firstObj, lastObj + 1));
        const arr = Array.isArray(parsed) ? parsed : parsed.options || [];
        return arr.map((item: any) => ShotPitchSchema.parse(item));
      }
    } catch {}
    return null;
  }
}
