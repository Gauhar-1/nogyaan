import fs from 'node:fs';
import path from 'node:path';
import {
  DIRECTOR_SYSTEM_PROMPT,
  DirectorsCut,
  DirectorsCutSchema,
  RenderMedium,
  RenderMediumSchema,
  SceneCoverage,
  SubShot,
  SubShotSchema
} from '../domain/schemas.js';
import { SessionDagService } from './session-dag.service.js';

export interface CompileShotsRequestInput {
  narrative?: string;
  scenes?: Array<{
    scene_id?: string;
    narrative_block: string;
    dialogue?: string | null;
    sfx?: string;
  }>;
  global_render_medium: RenderMedium;
  session_id?: string;
}

export interface RerollShotRequestInput {
  shot_id: string;
  user_feedback: string;
  session_id?: string;
}

export class DirectorsShotCompilerService {
  private sessionService: SessionDagService;

  constructor(sessionService?: SessionDagService) {
    this.sessionService = sessionService || new SessionDagService();
  }

  /**
   * Translates a finalized 4-scene narrative into a DirectorsCut shot list.
   * Calls LLM if available (Anthropic / OpenAI API keys), or uses the built-in
   * deterministic heuristic compiler executing the exact Coverage Matrix & Logic Tree rules.
   */
  public async compileDirectorsCut(input: CompileShotsRequestInput): Promise<DirectorsCut> {
    const medium = RenderMediumSchema.parse(input.global_render_medium);
    const scenesToProcess = this.resolveScenesToProcess(input);

    if (scenesToProcess.length === 0) {
      throw new Error(
        'No narrative scenes provided or found in active session to compile shots from.'
      );
    }

    let directorsCut: DirectorsCut | null = null;

    // 1. Attempt LLM Compilation if API keys are configured
    if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
      try {
        directorsCut = await this.callLlmCompiler(scenesToProcess, medium);
      } catch (err: any) {
        console.warn(
          `[DirectorsShotCompiler] LLM API call failed (${err.message}). Falling back to heuristic engine.`
        );
      }
    }

    // 2. Fallback to deterministic heuristic logic engine implementing the exact prompt rules
    if (!directorsCut) {
      directorsCut = this.compileHeuristicDirectorsCut(scenesToProcess, medium);
    }

    // 3. Normalize & guarantee strictly sequential unique shot_ids
    directorsCut = this.enforceSequentialShotIds(directorsCut, medium);

    // 4. Validate schema
    const validated = DirectorsCutSchema.parse(directorsCut);

    // 5. Persist to local state
    this.persistDirectorsCut(validated, input.session_id);

    return validated;
  }

  /**
   * Targeted Re-Roll: Sends ONLY the specific SubShot and user_feedback to the LLM
   * and replaces only that node in local JSON state.
   */
  public async rerollSubShot(input: RerollShotRequestInput): Promise<DirectorsCut> {
    if (!input.shot_id || !input.shot_id.trim()) {
      throw new Error('shot_id is required for targeted re-roll.');
    }
    if (!input.user_feedback || !input.user_feedback.trim()) {
      throw new Error('user_feedback is required for targeted re-roll.');
    }

    const currentCut = this.loadCurrentDirectorsCut(input.session_id);
    if (!currentCut) {
      throw new Error(
        'No active DirectorsCut found in local state. Please run initial compilation first.'
      );
    }

    // Locate the target sub-shot
    let foundSceneIndex = -1;
    let foundSubShotIndex = -1;
    let targetSubShot: SubShot | null = null;

    for (let sIdx = 0; sIdx < currentCut.scenes.length; sIdx++) {
      const sc = currentCut.scenes[sIdx];
      const subIdx = sc.coverage.findIndex((sh) => sh.shot_id === input.shot_id);
      if (subIdx !== -1) {
        foundSceneIndex = sIdx;
        foundSubShotIndex = subIdx;
        targetSubShot = sc.coverage[subIdx];
        break;
      }
    }

    if (!targetSubShot || foundSceneIndex === -1 || foundSubShotIndex === -1) {
      throw new Error(
        `SubShot with ID "${input.shot_id}" not found in current DirectorsCut.`
      );
    }

    let updatedSubShot: SubShot | null = null;

    // Call LLM with mini-prompt if API key available
    if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
      try {
        updatedSubShot = await this.callLlmLlmReroll(targetSubShot, input.user_feedback);
      } catch (err: any) {
        console.warn(
          `[DirectorsShotCompiler] LLM re-roll failed (${err.message}). Using heuristic re-roll.`
        );
      }
    }

    if (!updatedSubShot) {
      updatedSubShot = this.heuristicRerollSubShot(targetSubShot, input.user_feedback);
    }

    // Preserve exact shot_id and validate
    updatedSubShot.shot_id = targetSubShot.shot_id;
    const validatedSubShot = SubShotSchema.parse(updatedSubShot);

    // Replace ONLY that specific node
    currentCut.scenes[foundSceneIndex].coverage[foundSubShotIndex] = validatedSubShot;

    // Validate full cut and persist
    const validatedCut = DirectorsCutSchema.parse(currentCut);
    this.persistDirectorsCut(validatedCut, input.session_id);

    return validatedCut;
  }

  /**
   * Resolves 4 scenes from request body or from current active session state.
   */
  private resolveScenesToProcess(
    input: CompileShotsRequestInput
  ): Array<{ scene_id: string; narrative_block: string; dialogue: string | null; sfx: string }> {
    if (input.scenes && input.scenes.length > 0) {
      return input.scenes.map((s, idx) => ({
        scene_id: s.scene_id || `SCENE_${(idx + 1).toString().padStart(2, '0')}`,
        narrative_block: s.narrative_block,
        dialogue: s.dialogue ?? null,
        sfx: s.sfx || 'Ambient environment tone, subtle physical foley'
      }));
    }

    // If a raw narrative string was provided, split into scenes
    if (input.narrative && input.narrative.trim().length > 0) {
      const rawText = input.narrative.trim();
      const parts = rawText.split(/(?:Scene\s*\d+|Act\s*[I|V|X]+)[:\n-]/i).filter((p) => p.trim());
      if (parts.length > 0) {
        return parts.slice(0, 4).map((p, idx) => ({
          scene_id: `SCENE_${(idx + 1).toString().padStart(2, '0')}`,
          narrative_block: p.trim(),
          dialogue: this.extractDialogueFromText(p),
          sfx: this.extractSfxFromText(p)
        }));
      }
    }

    // Pull from active session
    const session = this.sessionService.loadSession(input.session_id);
    if (session) {
      const nodes = session.lockedNodes && session.lockedNodes.length > 0
        ? session.lockedNodes
        : session.scenes;

      if (nodes && nodes.length > 0) {
        return nodes.slice(0, 4).map((node, idx) => {
          const summary = node.chosenNarrativeSummary || (node as any).treatmentProse || '';
          return {
            scene_id: `SCENE_${(idx + 1).toString().padStart(2, '0')}`,
            narrative_block: summary,
            dialogue: this.extractDialogueFromText(summary),
            sfx: this.extractSfxFromText(summary)
          };
        });
      }
    }

    return [];
  }

  /**
   * Deterministic Heuristic Logic Engine executing the exact DIRECTOR_SYSTEM_PROMPT rules.
   */
  private compileHeuristicDirectorsCut(
    scenes: Array<{ scene_id: string; narrative_block: string; dialogue: string | null; sfx: string }>,
    globalMedium: RenderMedium
  ): DirectorsCut {
    const sceneCoverages: SceneCoverage[] = scenes.map((scene, sIdx) => {
      const sceneNum = sIdx + 1;
      const text = scene.narrative_block;
      const archetypes = this.detectArchetype(text);
      const opticalConstraint = this.detectOpticalConstraint(text);
      const isCrowded = /\b(crowd|packed|restaurant|bystanders|diners|chaos|audience|room full)\b/i.test(text);
      const crowdConstraint = isCrowded
        ? 'background crowd blurred with f/1.4 shallow depth of field, maximum 2 characters in frame'
        : 'clean composition, maximum 2 characters in frame';

      const coverage: SubShot[] = [];

      switch (archetypes) {
        case 'EMOTIONAL_SHIFT': {
          // Output exactly 2 sub-shots
          coverage.push({
            shot_id: `S${sceneNum.toString().padStart(2, '0')}_SH01_SUB_A`,
            sub_shot_type: 'Medium Tracking - Establishing',
            cinematic_prompt: `${opticalConstraint.lens}, ${opticalConstraint.movement}, ${opticalConstraint.lighting}. Medium tracking shot tracking subject motion through space, ${crowdConstraint}. Action: ${this.summarizeAction(text, 'establishing')}.`
          });
          coverage.push({
            shot_id: `S${sceneNum.toString().padStart(2, '0')}_SH02_SUB_B`,
            sub_shot_type: 'Push-in Extreme Close Up - Eyes',
            cinematic_prompt: `85mm lens, f/1.4 extreme shallow depth of field, slow smooth push-in dolly. Tight extreme close-up on the eyes and micro-expression, dramatic catchlight across pupils, background completely dissolved. Action: ${this.summarizeAction(text, 'emotional shift reaction')}.`
          });
          break;
        }

        case 'THE_EXCHANGE': {
          // Output exactly 3 sub-shots
          coverage.push({
            shot_id: `S${sceneNum.toString().padStart(2, '0')}_SH01_SUB_A`,
            sub_shot_type: 'Over-the-shoulder - Character A',
            cinematic_prompt: `${opticalConstraint.lens}, ${opticalConstraint.lighting}. Over-the-shoulder shot looking past Character A's shoulder towards Character B, single continuous hold, ${crowdConstraint}. Action: ${this.summarizeAction(text, 'character A dialog delivery')}.`
          });
          coverage.push({
            shot_id: `S${sceneNum.toString().padStart(2, '0')}_SH02_SUB_B`,
            sub_shot_type: 'Over-the-shoulder - Character B',
            cinematic_prompt: `${opticalConstraint.lens}, ${opticalConstraint.lighting}. Reverse over-the-shoulder shot framing Character B's listening response and posture, ${crowdConstraint}. Action: ${this.summarizeAction(text, 'character B reaction and exchange')}.`
          });
          coverage.push({
            shot_id: `S${sceneNum.toString().padStart(2, '0')}_SH03_SUB_C`,
            sub_shot_type: 'Macro Insert - Hands/Object',
            cinematic_prompt: `100mm macro lens, f/2.0 shallow focus, locked tripod. Extreme close-up insert on the hands executing the physical handover, crisp tactile texture and sharp focus on fingertips. Action: ${this.summarizeAction(text, 'physical handover of object')}.`
          });
          break;
        }

        case 'TECHNICAL_ACTION': {
          // Output exactly 3 sub-shots
          coverage.push({
            shot_id: `S${sceneNum.toString().padStart(2, '0')}_SH01_SUB_A`,
            sub_shot_type: 'Wide - Establishing Action',
            cinematic_prompt: `${opticalConstraint.lens}, ${opticalConstraint.movement}, ${opticalConstraint.lighting}. Wide establishing composition framing the subject engaged in technical workflow, ${crowdConstraint}. Action: ${this.summarizeAction(text, 'workspace and device context')}.`
          });
          coverage.push({
            shot_id: `S${sceneNum.toString().padStart(2, '0')}_SH02_SUB_B`,
            sub_shot_type: 'POV High Angle - Hands',
            cinematic_prompt: `35mm lens, high-angle downward POV framing over the hands interacting with the physical device or tools, sharp foreground focus, soft ambient fill. Action: ${this.summarizeAction(text, 'hands interacting with interface')}.`
          });
          coverage.push({
            shot_id: `S${sceneNum.toString().padStart(2, '0')}_SH03_SUB_C`,
            sub_shot_type: 'Extreme Macro - Interface/Action',
            cinematic_prompt: `100mm macro lens, f/2.8, static locked tripod, soft reflective key light. Extreme macro framing of the UI interaction and instantaneous physical response. Action: ${this.summarizeAction(text, 'screen interface and button press micro-detail')}.`
          });
          break;
        }

        case 'STANDARD_ACTION':
        default: {
          // Output 1 single Master shot
          coverage.push({
            shot_id: `S${sceneNum.toString().padStart(2, '0')}_SH01_SUB_A`,
            sub_shot_type: 'Master - Continuous Action',
            cinematic_prompt: `${opticalConstraint.lens}, ${opticalConstraint.movement}, ${opticalConstraint.lighting}. Master continuous take framing the complete physical sequence, ${crowdConstraint}. Action: ${this.summarizeAction(text, 'master action block')}.`
          });
          break;
        }
      }

      return {
        scene_id: scene.scene_id,
        narrative_block: text,
        audio_stem: {
          dialogue: scene.dialogue,
          sfx: scene.sfx
        },
        coverage
      };
    });

    return {
      global_render_medium: globalMedium,
      scenes: sceneCoverages
    };
  }

  /**
   * Routing: Evaluates narrative text against the 4 archetypes defined in Coverage Matrix.
   */
  private detectArchetype(
    text: string
  ): 'EMOTIONAL_SHIFT' | 'THE_EXCHANGE' | 'TECHNICAL_ACTION' | 'STANDARD_ACTION' {
    const lower = text.toLowerCase();

    // 1. Technical Action (Phone UI, scanning QR, cooking, typing, app, tool)
    if (
      /\b(phone|qr|scan\w*|app|ui|screen|bell|tap\w*|click\w*|button|cook\w*|kitchen|laptop|typ\w*|device|pan|pot)\b/i.test(
        lower
      )
    ) {
      return 'TECHNICAL_ACTION';
    }

    // 2. The Exchange (Dialogue/Handover, waiter, serves, hands over, passes, talks, tells, asks, customer, cashier)
    if (
      /\b(dialogue|hands?\s*over|handover|waiter|serv\w*|pass\w*|speak\w*|says?|repl\w*|convers\w*|order\w*|bill|exchange\w*|dupatta|bhaiya)\b/i.test(
        lower
      )
    ) {
      return 'THE_EXCHANGE';
    }

    // 3. Emotional Shift (Realization, eyes, reaction, shock, smile, laughs, freeze, stunned, relief, gasps, notice)
    if (
      /\b(realiz\w*|react\w*|shock\w*|surpris\w*|relief\w*|freez\w*|notic\w*|star\w*|eyes?|smil\w*|laugh\w*|gasp\w*|sigh\w*|frustrat\w*|breaking point|look\w*\s+up)\b/i.test(
        lower
      )
    ) {
      return 'EMOTIONAL_SHIFT';
    }

    return 'STANDARD_ACTION';
  }

  /**
   * Logic Tree: Maps scene tone to specific optical constraints.
   */
  private detectOpticalConstraint(
    text: string
  ): { lens: string; movement: string; lighting: string } {
    const lower = text.toLowerCase();

    // Comedy / Awkward
    if (
      /\b(comedy|awkward|ridiculous|funny|laugh|desperate|flailing|silly|cringe|confused|embarrass)\b/i.test(
        lower
      )
    ) {
      return {
        lens: '50mm lens',
        movement: 'locked-off tripod, symmetrical framing',
        lighting: 'high-key even lighting'
      };
    }

    // Chaos / Disorientation
    if (
      /\b(chaos|disorientation|shouting|running|frantic|packed|rush|jitter|crowded|wave|noise)\b/i.test(
        lower
      )
    ) {
      return {
        lens: '24mm wide lens',
        movement: 'handheld jitter, deep depth of field',
        lighting: 'harsh directional lighting'
      };
    }

    // Intimacy / Focus
    if (
      /\b(intimate|intimacy|focus|quiet|calm|gentle|warm|relief|sip|tea|loving|care|eyes|smile)\b/i.test(
        lower
      )
    ) {
      return {
        lens: '85mm-100mm lens',
        movement: 'f/1.4 extreme shallow depth of field, slow fluid-head dolly',
        lighting: 'soft wrapping light with crushed shadows'
      };
    }

    // Scale / Power
    if (
      /\b(power|scale|hero|grand|triumphant|standing tall|revelation|stage|skyline|spotlight)\b/i.test(
        lower
      )
    ) {
      return {
        lens: '14mm ultra-wide lens',
        movement: 'low angle looking up, slow crane movement',
        lighting: 'dramatic backlighting'
      };
    }

    // Default balanced cinematic
    return {
      lens: '50mm lens',
      movement: 'slow steady push-in, subtle low angle',
      lighting: 'cinematic atmospheric lighting'
    };
  }

  private summarizeAction(text: string, context: string): string {
    const clean = text.replace(/[\r\n]+/g, ' ').trim();
    if (clean.length <= 160) return clean;
    return `${clean.substring(0, 155)}... (${context})`;
  }

  private extractDialogueFromText(text: string): string | null {
    const match = text.match(/["']([^"']{3,120})["']/);
    if (match && match[1]) {
      return match[1].trim();
    }
    return null;
  }

  private extractSfxFromText(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes('qr') || lower.includes('bell') || lower.includes('tap') || lower.includes('phone')) {
      return 'Gentle tactile digital chime, subtle smartphone haptic click, warm room murmur in background';
    }
    if (lower.includes('restaurant') || lower.includes('packed') || lower.includes('clatter')) {
      return 'Busy restaurant chatter, steel cutlery clinking, distant kitchen steam sizzle';
    }
    if (lower.includes('tea') || lower.includes('chai') || lower.includes('pour') || lower.includes('cup')) {
      return 'Hot liquid pouring into ceramic cup, aromatic steam hiss, slow quiet exhale';
    }
    return 'Ambient room tone, subtle movement foley';
  }

  /**
   * Enforces strictly sequential IDs: S01_SH01_SUB_A, S01_SH02_SUB_B...
   */
  private enforceSequentialShotIds(cut: DirectorsCut, medium: RenderMedium): DirectorsCut {
    const cleanScenes: SceneCoverage[] = cut.scenes.map((scene, sIdx) => {
      const sceneNum = (sIdx + 1).toString().padStart(2, '0');
      const cleanCoverage: SubShot[] = scene.coverage.map((shot, subIdx) => {
        const shotNum = (subIdx + 1).toString().padStart(2, '0');
        const letter = String.fromCharCode(65 + subIdx); // A, B, C...
        const shotId = `S${sceneNum}_SH${shotNum}_SUB_${letter}`;

        // Ensure style-agnostic: strip out accidental medium mentions
        let cleanPrompt = shot.cinematic_prompt || '';
        cleanPrompt = cleanPrompt
          .replace(/\b(anime|pixar|pixar style|live-action|live action|photorealistic|hyperrealistic|stop motion|2d animation|3d animation)\b/gi, '')
          .replace(/\s{2,}/g, ' ')
          .trim();

        return {
          shot_id: shotId,
          sub_shot_type: shot.sub_shot_type || 'Master - Continuous Action',
          cinematic_prompt: cleanPrompt
        };
      });

      return {
        scene_id: scene.scene_id || `SCENE_${sceneNum}`,
        narrative_block: scene.narrative_block,
        audio_stem: {
          dialogue: scene.audio_stem?.dialogue ?? null,
          sfx: scene.audio_stem?.sfx || 'Ambient environment tone'
        },
        coverage: cleanCoverage
      };
    });

    return {
      global_render_medium: medium,
      scenes: cleanScenes
    };
  }

  /**
   * Heuristic Re-roll for SubShot based on user feedback.
   */
  private heuristicRerollSubShot(original: SubShot, feedback: string): SubShot {
    const feedbackLower = feedback.toLowerCase();
    let updatedType = original.sub_shot_type;
    let prompt = original.cinematic_prompt;

    // Adjust camera / framing based on feedback
    if (feedbackLower.includes('closer') || feedbackLower.includes('close up') || feedbackLower.includes('tight')) {
      prompt = prompt.replace(/\b(wide|medium|50mm|24mm)\b/gi, 'tight extreme close-up, 100mm macro lens');
      updatedType = updatedType.includes('Close Up') ? updatedType : `${updatedType} - Close Up Refinement`;
    } else if (feedbackLower.includes('wider') || feedbackLower.includes('wide shot')) {
      prompt = prompt.replace(/\b(tight|close-up|close up|macro|85mm|100mm)\b/gi, 'wide establishing, 24mm lens');
      updatedType = 'Wide - Establishing Action';
    }

    if (feedbackLower.includes('faster') || feedbackLower.includes('dynamic') || feedbackLower.includes('dramatic')) {
      prompt += ' Dynamic kinetic push-in with rapid camera acceleration, dramatic contrasting shadows.';
    } else if (feedbackLower.includes('slower') || feedbackLower.includes('calm') || feedbackLower.includes('subtle')) {
      prompt += ' Extremely slow and tranquil fluid-head slide, soft diffused wrapping light.';
    }

    // Incorporate user feedback note directly
    prompt += ` [Refined Direction: ${feedback.trim()}]`;

    // Strip any forbidden art-medium words
    prompt = prompt
      .replace(/\b(anime|pixar|live-action|photorealistic|stop motion|3d animation)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return {
      shot_id: original.shot_id,
      sub_shot_type: updatedType,
      cinematic_prompt: prompt
    };
  }

  /**
   * Call Anthropic or OpenAI LLM API to compile the DirectorsCut.
   */
  private async callLlmCompiler(
    scenes: Array<{ scene_id: string; narrative_block: string; dialogue: string | null; sfx: string }>,
    globalMedium: RenderMedium
  ): Promise<DirectorsCut | null> {
    const userPrompt = `Compile this 4-scene narrative into a DirectorsCut JSON shot list:
Global Render Medium: ${globalMedium}

Scenes:
${scenes
  .map(
    (s, idx) => `
Scene ${idx + 1} (${s.scene_id}):
Narrative: ${s.narrative_block}
Dialogue: ${s.dialogue || 'NONE'}
SFX: ${s.sfx}
`
  )
  .join('\n')}

Output raw valid JSON ONLY conforming strictly to the DirectorsCut schema.`;

    if (process.env.ANTHROPIC_API_KEY) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4096,
          system: DIRECTOR_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
      }

      const json: any = await response.json();
      const text = json.content?.[0]?.text || '';
      return this.parseJsonFromLlmText(text);
    }

    if (process.env.OPENAI_API_KEY) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: DIRECTOR_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const json: any = await response.json();
      const text = json.choices?.[0]?.message?.content || '';
      return this.parseJsonFromLlmText(text);
    }

    return null;
  }

  /**
   * Call LLM with mini-prompt for targeted SubShot re-roll.
   */
  private async callLlmLlmReroll(
    targetSubShot: SubShot,
    userFeedback: string
  ): Promise<SubShot | null> {
    const miniPrompt = `You are the Director's Shot Compiler. Update this cinematic shot based on user feedback. Maintain the JSON schema.
Current SubShot:
${JSON.stringify(targetSubShot, null, 2)}

User Feedback:
${userFeedback}

Strict Rules:
1. Return JSON for SubShot only matching schema:
   {
     "shot_id": "${targetSubShot.shot_id}",
     "sub_shot_type": "...",
     "cinematic_prompt": "..."
   }
2. The cinematic_prompt MUST ONLY contain camera angles, lighting, lens types, and physical action. NO medium styles (e.g. never say "anime", "pixar", "photorealistic", "live-action").
3. Output raw JSON only.`;

    if (process.env.ANTHROPIC_API_KEY) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [{ role: 'user', content: miniPrompt }]
        })
      });
      if (response.ok) {
        const json: any = await response.json();
        const text = json.content?.[0]?.text || '';
        return this.parseJsonFromLlmText(text);
      }
    }

    if (process.env.OPENAI_API_KEY) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: miniPrompt }],
          response_format: { type: 'json_object' }
        })
      });
      if (response.ok) {
        const json: any = await response.json();
        const text = json.choices?.[0]?.message?.content || '';
        return this.parseJsonFromLlmText(text);
      }
    }

    return null;
  }

  private parseJsonFromLlmText(text: string): any {
    const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
    }
    return JSON.parse(cleaned);
  }

  /**
   * Persists the DirectorsCut to session state, story_graph.json, and standalone file.
   */
  public persistDirectorsCut(directorsCut: DirectorsCut, sessionId?: string): void {
    const storageDir = this.sessionService.getStorageDir();

    // 1. Save standalone directors_cut.json
    const cutFilePath = path.join(storageDir, 'directors_cut.json');
    fs.writeFileSync(cutFilePath, JSON.stringify(directorsCut, null, 2), 'utf-8');

    // 2. Attach to active session if available
    const session = this.sessionService.loadSession(sessionId);
    if (session) {
      session.directorsCut = directorsCut;
      this.sessionService.saveSession(session);
    } else {
      // Mirror to story_graph.json if no active session
      const graphPath = this.sessionService.getStoryGraphPath();
      if (fs.existsSync(graphPath)) {
        try {
          const raw = fs.readFileSync(graphPath, 'utf-8');
          const graph = JSON.parse(raw);
          graph.directorsCut = directorsCut;
          fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf-8');
        } catch {}
      }
    }
  }

  /**
   * Retrieves the current DirectorsCut from local state.
   */
  public loadCurrentDirectorsCut(sessionId?: string): DirectorsCut | null {
    // 1. Try active session
    const session = this.sessionService.loadSession(sessionId);
    if (session && session.directorsCut) {
      return session.directorsCut;
    }

    // 2. Try standalone directors_cut.json
    const storageDir = this.sessionService.getStorageDir();
    const cutFilePath = path.join(storageDir, 'directors_cut.json');
    if (fs.existsSync(cutFilePath)) {
      try {
        const raw = fs.readFileSync(cutFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return DirectorsCutSchema.parse(parsed);
      } catch {}
    }

    // 3. Try story_graph.json
    const graphPath = this.sessionService.getStoryGraphPath();
    if (fs.existsSync(graphPath)) {
      try {
        const raw = fs.readFileSync(graphPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.directorsCut) {
          return DirectorsCutSchema.parse(parsed.directorsCut);
        }
      } catch {}
    }

    return null;
  }
}
