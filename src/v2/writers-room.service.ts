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
      ? `Picking up from previous beat: "${slice.previous_scene_narrative.slice(0, 70)}..."`
      : 'Opening scene establishing character and daily friction.';

    const premiseTheme = slice.core_premise || 'Authentic human storytelling';
    const brief = this.stateManager.getBriefContext();
    const brandLabel = brief.company_name || 'Brand';

    // Dynamic entropy pools for varied, non-identical pitches across calls
    const timestampSeed = Date.now() % 5;
    const heartfeltAngles = [
      {
        visual: `${prevContext} An intimate, grounded human beat highlighting ${premiseTheme}. Characters navigate real emotional stakes with understated honesty and quiet recognition.${guidance}`,
        vo: `"Some things you don't say out loud. You just share them."`,
        cta: `${brandLabel} — For the moments that matter.`
      },
      {
        visual: `${prevContext} Morning light catches a relatable, quiet gesture between characters centered on ${premiseTheme}. Soft eye contact and an unhurried, reassuring presence take center stage.${guidance}`,
        vo: `"When everything moves too fast, start with what's real."`,
        cta: `${brandLabel} — Built on genuine craft.`
      },
      {
        visual: `${prevContext} A tender, generational exchange unfolding around ${premiseTheme}. A gentle hand placed on a shoulder, subtle breath of relief.${guidance}`,
        vo: `"Tradition isn't about looking back. It's about who you share it with."`,
        cta: `${brandLabel} — Timeless care.`
      },
      {
        visual: `${prevContext} Naturalistic atmosphere where character pauses amidst the rush, experiencing clarity through ${premiseTheme}.${guidance}`,
        vo: `"The best decisions don't make noise. They just feel right."`,
        cta: `${brandLabel} — Pure focus.`
      },
      {
        visual: `${prevContext} Authentic human vulnerability turning into quiet confidence as ${premiseTheme} bridges a subtle distance between people.${guidance}`,
        vo: `"Closer than words ever get."`,
        cta: `${brandLabel} — Together in every detail.`
      }
    ];

    const viralAngles = [
      {
        visual: `${prevContext} High-impact relatable friction tackling ${premiseTheme}. Rapid-fire visual escalation turns everyday frustration into a dynamic, modern turning point with punchy pacing.${guidance}`,
        vo: `"Tell me you're not still doing this the old way. Stop scrolling."`,
        cta: `Tap to switch to ${brandLabel}.`
      },
      {
        visual: `${prevContext} Kinetic, fast-cut montage of the universal absurdity of the daily struggle before ${premiseTheme} flips the script with unexpected comedic swagger.${guidance}`,
        vo: `"We all pretend this doesn't drive us crazy. Until today."`,
        cta: `Experience ${brandLabel} now.`
      },
      {
        visual: `${prevContext} Sudden comedic record-scratch freeze frame breaking the fourth wall as ${premiseTheme} solves the exact chaos unfolding.${guidance}`,
        vo: `"Yeah, that's me. You're probably wondering how I fixed this in 3 seconds."`,
        cta: `${brandLabel}: Done differently.`
      },
      {
        visual: `${prevContext} Hyper-relatable POV sequence tracking micro-annoyances escalating before the swift, satisfying intervention of ${premiseTheme}.${guidance}`,
        vo: `"POV: You finally stopped tolerating mediocre compromises."`,
        cta: `Upgrade with ${brandLabel}.`
      },
      {
        visual: `${prevContext} Subverted expectation hook: what looks like high-stakes drama resolves into effortless modern simplicity with ${premiseTheme}.${guidance}`,
        vo: `"Plot twist: it was never actually that complicated."`,
        cta: `Discover ${brandLabel}.`
      }
    ];

    const offbeatAngles = [
      {
        visual: `${prevContext} Stylized deadpan observation framing ${premiseTheme}. Meticulous physical choreography and dry visual comedy give everyday routine actions unexpected narrative weight.${guidance}`,
        vo: `"Fascinating. Completely unnecessary to panic, yet here we are."`,
        cta: `${brandLabel} — Methodically superior.`
      },
      {
        visual: `${prevContext} Symmetrical, surreal tableau where characters maintain absolute straight-faced seriousness while interacting with ${premiseTheme} in an eccentric physical setup.${guidance}`,
        vo: `"Notice the trajectory of common sense entering the room."`,
        cta: `${brandLabel} — Unapologetically precise.`
      },
      {
        visual: `${prevContext} Quirky micro-rhythm choreography: rhythmic clicking, synchronized head tilts, and deadpan timing establishing ${premiseTheme}.${guidance}`,
        vo: `"Standard procedure requires zero drama."`,
        cta: `${brandLabel} — Uniquely calibrated.`
      },
      {
        visual: `${prevContext} Droll Wes Anderson-inspired wide composition where a single deliberate object shift around ${premiseTheme} recalibrates the entire scene's tension.${guidance}`,
        vo: `"A highly calculated upgrade. Observe."`,
        cta: `${brandLabel} — Designed with intention.`
      },
      {
        visual: `${prevContext} Deadpan comedic stillness contrasting sudden absurd environmental motion, highlighting the poise of ${premiseTheme}.${guidance}`,
        vo: `"Keep calm. The math checks out."`,
        cta: `${brandLabel} — Simply better.`
      }
    ];

    // Pick dynamic angle using seed and random entropy so repeated calls yield distinct concepts
    const pickA = heartfeltAngles[(timestampSeed + Math.floor(Math.random() * heartfeltAngles.length)) % heartfeltAngles.length];
    const pickB = viralAngles[(timestampSeed + 1 + Math.floor(Math.random() * viralAngles.length)) % viralAngles.length];
    const pickC = offbeatAngles[(timestampSeed + 2 + Math.floor(Math.random() * offbeatAngles.length)) % offbeatAngles.length];

    const optA: ScriptPitch = {
      id: 'A',
      style: 'Heartfelt',
      txt: `[Visual]: ${pickA.visual}\n[Voiceover/Dialogue]: ${pickA.vo}\n[On-Screen Text / CTA]: ${pickA.cta}`
    };

    const optB: ScriptPitch = {
      id: 'B',
      style: 'Viral',
      txt: `[Visual]: ${pickB.visual}\n[Voiceover/Dialogue]: ${pickB.vo}\n[On-Screen Text / CTA]: ${pickB.cta}`
    };

    const optC: ScriptPitch = {
      id: 'C',
      style: 'Offbeat',
      txt: `[Visual]: ${pickC.visual}\n[Voiceover/Dialogue]: ${pickC.vo}\n[On-Screen Text / CTA]: ${pickC.cta}`
    };

    return [optA, optB, optC];
  }

  private async callLlmWriter(
    scene_id: string,
    slice: { core_premise: string; previous_scene_narrative: string | null },
    userGuidance?: string
  ): Promise<ScriptPitch[] | null> {
    const entropySeed = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const userPrompt = `Scene Target: "${scene_id}"
Core Campaign Premise / Goal: ${slice.core_premise}
Locked Scene N-1 Narrative (Continuity): ${slice.previous_scene_narrative || 'None (Scene 1 Opening)'}
User Guidance: ${userGuidance || 'None provided'}
Entropy Seed: ${entropySeed} (CRITICAL: Explore a fresh, non-repetitive creative angle)

Format each pitch "txt" as a structured commercial beat sheet:
[Visual]: <staging and human action>
[Voiceover/Dialogue]: <dialogue or voiceover>
[On-Screen Text / CTA]: <graphic copy or call-to-action>

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
          temperature: 0.9,
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
          temperature: 0.9,
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
