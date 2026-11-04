import { AssetExtractionResult, AssetExtractionResultSchema, NogyaanState } from './types.js';
import { ASSET_EXTRACTOR_SYSTEM_PROMPT } from './prompts.js';
import { StateManager } from './state-manager.js';

export interface ExtractActiveAssetsInput {
  state?: NogyaanState;
}

export class AssetLockerService {
  private stateManager: StateManager;

  constructor(stateManager?: StateManager) {
    this.stateManager = stateManager || new StateManager();
  }

  /**
   * Phase 2: Analyzes locked scene narratives, extracts the AssetBible,
   * and tags each scene with its active asset references (active_refs).
   * Context Slice: ONLY the locked 4-scene narrative blocks.
   */
  public async extractActiveAssets(
    input?: ExtractActiveAssetsInput
  ): Promise<{
    extraction: AssetExtractionResult;
    state: NogyaanState;
  }> {
    const sm = input?.state ? new StateManager() : this.stateManager;
    if (input?.state) {
      sm.setState(input.state);
    }

    const sceneNarratives = sm.getSceneNarrativesForAssetExtraction();

    let extraction: AssetExtractionResult | null = null;

    if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
      try {
        extraction = await this.callLlmExtractor(sceneNarratives);
      } catch (err: any) {
        console.warn(`[AssetLocker] LLM extraction failed (${err.message}). Using heuristic engine.`);
      }
    }

    if (!extraction) {
      extraction = this.generateHeuristicAssetExtraction(sceneNarratives);
    }

    const validated = AssetExtractionResultSchema.parse(extraction);
    const updatedState = sm.applyAssetExtraction(validated);

    return {
      extraction: validated,
      state: updatedState
    };
  }

  private generateHeuristicAssetExtraction(
    scenes: Array<{ scene_id: string; txt: string }>
  ): AssetExtractionResult {
    const allText = scenes.map((s) => s.txt).join(' ');

    // Extract product
    let productDesc = 'Hero brand product displayed in pristine commercial lighting';
    if (allText.toLowerCase().includes('coffee')) {
      productDesc = 'Authentic filter coffee concentrate bottle with brass cap';
    } else if (allText.toLowerCase().includes('tea') || allText.toLowerCase().includes('chai')) {
      productDesc = 'Artisanal single-estate premium tea blend tin';
    } else if (allText.toLowerCase().includes('app') || allText.toLowerCase().includes('software')) {
      productDesc = 'Sleek dark-mode mobile dashboard interface';
    }

    // Characters
    const characters: Record<string, string> = {
      CHAR_01: 'Lead protagonist, 30s, expressive eyes, modern relaxed attire'
    };
    if (allText.toLowerCase().includes('family') || allText.toLowerCase().includes('father') || allText.toLowerCase().includes('sharma')) {
      characters.CHAR_02 = 'Senior family member, 60s, gentle smile, traditional attire';
    } else if (allText.toLowerCase().includes('friend') || allText.toLowerCase().includes('colleague')) {
      characters.CHAR_02 = 'Supportive companion, late 20s, energetic demeanor';
    }

    // Environments
    const backgrounds: Record<string, string> = {
      BG_01: 'Warm domestic interior with natural sunlight pouring in through curtains'
    };
    if (scenes.length > 2) {
      backgrounds.BG_02 = 'Vibrant modern workspace or exterior storefront with directional lighting';
    }

    // Scene-level tagging
    const scene_tagging: Record<string, string[]> = {};
    scenes.forEach((sc, idx) => {
      const active: string[] = ['@CHAR_01'];
      if (idx === 0) {
        active.push('@BG_01');
      } else if (idx === 1) {
        active.push(backgrounds.BG_02 ? '@BG_02' : '@BG_01');
        if (characters.CHAR_02 && sc.txt.toLowerCase().includes('share')) {
          active.push('@CHAR_02');
        }
      } else if (idx === 2) {
        if (characters.CHAR_02) active.push('@CHAR_02');
        active.push('@BG_01');
      } else {
        // Climax / Act 4 uses lead, product, and main setting
        active.push('@BG_01', '@PROD_01');
        if (characters.CHAR_02) active.push('@CHAR_02');
      }
      scene_tagging[sc.scene_id] = active;
    });

    return {
      assets: {
        characters,
        backgrounds,
        product: productDesc
      },
      scene_tagging
    };
  }

  private async callLlmExtractor(
    scenes: Array<{ scene_id: string; txt: string }>
  ): Promise<AssetExtractionResult | null> {
    const userPrompt = `Analyze these locked commercial scenes:
${JSON.stringify(scenes, null, 2)}

Extract the minimal AssetBible and tag active asset references per scene.
Output raw minified JSON only:
{
  "assets": {
    "characters": { "CHAR_01": "..." },
    "backgrounds": { "BG_01": "..." },
    "product": "..."
  },
  "scene_tagging": {
    "SCENE_01": ["@CHAR_01", "@BG_01"]
  }
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
          max_tokens: 1536,
          system: ASSET_EXTRACTOR_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });
      if (res.ok) {
        const json: any = await res.json();
        const text = json.content?.[0]?.text || '';
        return this.parseExtraction(text);
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
            { role: 'system', content: ASSET_EXTRACTOR_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' }
        })
      });
      if (res.ok) {
        const json: any = await res.json();
        const text = json.choices?.[0]?.message?.content || '';
        return this.parseExtraction(text);
      }
    }

    return null;
  }

  private parseExtraction(text: string): AssetExtractionResult | null {
    try {
      const clean = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const first = clean.indexOf('{');
      const last = clean.lastIndexOf('}');
      if (first !== -1 && last !== -1) {
        const parsed = JSON.parse(clean.substring(first, last + 1));
        return AssetExtractionResultSchema.parse(parsed);
      }
    } catch {}
    return null;
  }
}
