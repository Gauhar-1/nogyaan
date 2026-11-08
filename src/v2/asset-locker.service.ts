import { AssetBible, AssetExtractionResult, AssetExtractionResultSchema, NogyaanState } from './types.js';
import { ASSET_EXTRACTOR_SYSTEM_PROMPT } from './prompts.js';
import { StateManager } from './state-manager.js';

export interface ExtractActiveAssetsInput {
  scene_id?: string;
  company_name?: string;
  product_goal?: string;
  assets?: AssetBible | any;
  scene_tagging?: Record<string, string[]>;
  extraction?: AssetExtractionResult;
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

    // Direct dynamic pass-through if pre-extracted or provided by LLM / user
    let extraction: AssetExtractionResult | null = null;
    if (input?.extraction) {
      extraction = input.extraction;
    } else if (input?.assets) {
      extraction = {
        assets: {
          characters: input.assets.characters || {},
          backgrounds: input.assets.backgrounds || {},
          product: typeof input.assets.product === 'string' ? input.assets.product : String(input.assets.product || '')
        },
        scene_tagging: input.scene_tagging || {}
      };
    }

    const sceneNarratives = sm.getSceneNarrativesForAssetExtraction();

    if (!extraction) {
      if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
        try {
          extraction = await this.callLlmExtractor(sceneNarratives, input);
        } catch (err: any) {
          console.warn(`[AssetLocker] LLM extraction failed (${err.message}). Using heuristic engine.`);
        }
      }
    }

    if (!extraction) {
      extraction = this.generateHeuristicAssetExtraction(sceneNarratives, input);
    }

    const validated = AssetExtractionResultSchema.parse(extraction);
    const updatedState = sm.applyAssetExtraction(validated);

    return {
      extraction: validated,
      state: updatedState
    };
  }

  private generateHeuristicAssetExtraction(
    scenes: Array<{ scene_id: string; txt: string }>,
    input?: ExtractActiveAssetsInput
  ): AssetExtractionResult {
    const allText = scenes.map((s) => s.txt).join(' ');
    const currentState = this.stateManager.getState();
    const premise = currentState.core_premise || '';
    const briefContext = this.stateManager.getBriefContext();
    const companyName = input?.company_name || briefContext.company_name;
    const productGoal = input?.product_goal || briefContext.product_goal;
    const productName = briefContext.product_name;

    // 1. Actively parse Product from brief context first, then state, then narrative
    let productDesc = '';
    if (productName && productName.trim().length > 0) {
      productDesc = `${productName.trim()} featured in dynamic commercial presentation`;
    } else if (currentState.assets?.product && currentState.assets.product.trim().length > 0) {
      productDesc = currentState.assets.product;
    } else if (premise.includes(':')) {
      const parts = premise.split(':');
      const left = parts[0];
      const match = left.match(/[-—–]\s*([^:–—]+)/);
      if (match && match[1]) {
        productDesc = `${match[1].trim()} featured in dynamic commercial presentation`;
      }
    }
    if (!productDesc && productGoal) {
      const mGoal = productGoal.match(/\b(?:for|of|with|featuring|launching|announcing)\s+([A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)?)/i);
      if (mGoal && mGoal[1]) {
        productDesc = `Hero ${mGoal[1].trim()} featured in dynamic commercial presentation`;
      }
    }
    if (!productDesc) {
      const prodClues = allText.match(/\b(?:using|with|holding|activates|displays|unveils|launches|features|scans|taps|opens|app|bottle|tin|device|tool|platform|drink|snack|tea|coffee)\b\s+([A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)?)/i);
      if (prodClues && prodClues[1]) {
        productDesc = `Hero ${prodClues[1].trim()} prominently featured in authentic product lighting`;
      } else {
        productDesc = 'Hero brand product established in narrative, presented in crisp commercial focus';
      }
    }

    // 2. Actively parse Characters from locked_script texts (strictly excluding company and brand names)
    const characters: Record<string, string> = {};
    const knownNames: string[] = [];

    // Extract character names primarily from visual action staging
    // Strip quoted dialogue lines and CTA slogans to avoid extracting common vocabulary
    let textForCharacterExtraction = '';
    for (const sc of scenes) {
      const visualMatches = sc.txt.match(/\[Visual\]:\s*([\s\S]*?)(?=\[(?:Voiceover|Dialogue|On-Screen|CTA)|$)/gi);
      if (visualMatches && visualMatches.length > 0) {
        textForCharacterExtraction += ' ' + visualMatches.map((m) => m.replace(/\[Visual\]:\s*/i, '')).join(' ');
      } else {
        const stripped = sc.txt.replace(/"[^"]*"/g, ' ').replace(/'[^']*'/g, ' ');
        textForCharacterExtraction += ' ' + stripped;
      }
    }

    const forbiddenCompanyTokens = new Set<string>();
    if (companyName) {
      forbiddenCompanyTokens.add(companyName.toLowerCase());
      for (const token of companyName.toLowerCase().split(/[\s_—–-]+/)) {
        if (token.length > 1) forbiddenCompanyTokens.add(token);
      }
    }
    const forbiddenProductTokens = new Set<string>();
    if (productName) {
      forbiddenProductTokens.add(productName.toLowerCase());
      for (const token of productName.toLowerCase().split(/[\s_—–-]+/)) {
        if (token.length > 1) forbiddenProductTokens.add(token);
      }
    }

    const nameMatches = textForCharacterExtraction.matchAll(/\b([A-Z][a-z]+(?:\s+ji)?)\b/g);
    for (const m of nameMatches) {
      const candidate = m[1];
      const ignored = [
        'Scene', 'Act', 'Shot', 'The', 'A', 'An', 'In', 'On', 'With', 'Camera', 'Close',
        'Wide', 'Angle', 'Focus', 'Light', 'Option', 'Style', 'And', 'Picking', 'Opening',
        'Visual', 'Voiceover', 'Dialogue', 'Screen', 'Text', 'Cta', 'Beat', 'Action',
        'Company', 'Brand', 'Product', 'Goal', 'Hero', 'Some', 'When', 'Tradition', 'Closer',
        'Tell', 'Stop', 'Yeah', 'Notice', 'Keep', 'Standard', 'Pure', 'Done', 'Fast', 'High',
        'Another', 'Every', 'Fresh', 'Morning', 'Today', 'Tomorrow', 'Grab', 'Take', 'Look',
        'See', 'Hold', 'Make', 'Start', 'Power', 'Real', 'True', 'Best', 'New', 'Good',
        'Free', 'First', 'Next', 'Last', 'Final', 'After', 'Before', 'While', 'Since'
      ];
      if (!ignored.includes(candidate) && !knownNames.includes(candidate)) {
        const candLower = candidate.toLowerCase();
        if (forbiddenCompanyTokens.has(candLower) || forbiddenProductTokens.has(candLower)) {
          continue; // Strict directive: Do NOT extract company or product name as a character
        }
        if (!/^(coffee|chai|tea|brand|product|office|kitchen|room|table|desk|store|app)$/i.test(candidate)) {
          knownNames.push(candidate);
        }
      }
    }

    if (knownNames.length > 0) {
      characters.CHAR_01 = `${knownNames[0]}, central lead identified in narrative, authentic wardrobe and expressive focus`;
      if (knownNames.length > 1) {
        characters.CHAR_02 = `${knownNames[1]}, secondary character featured in narrative, authentic wardrobe`;
      }
      if (knownNames.length > 2) {
        characters.CHAR_03 = `${knownNames[2]}, supporting character established in narrative`;
      }
    } else {
      characters.CHAR_01 = 'Lead protagonist established in scene narrative, authentic wardrobe and natural styling';
    }

    // 3. Actively parse Environments (Backgrounds)
    const backgrounds: Record<string, string> = {};
    const envKeywords = [
      'restaurant dining hall', 'restaurant', 'cafe', 'bar', 'lounge', 'office workspace', 'office',
      'kitchen', 'living room', 'bedroom', 'dining room', 'rooftop', 'balcony', 'studio', 'street',
      'storefront', 'store', 'market', 'warehouse', 'auditorium', 'conference room',
      'outdoor patio', 'terrace', 'home interior', 'workspace', 'park', 'airport', 'hotel',
      'gym', 'laboratory', 'garage', 'alley', 'classroom'
    ];

    let foundEnvs: string[] = [];
    const locationPhraseMatch = allText.match(/\b(?:inside|in|at)\s+(?:an?|the)?\s*([a-zA-Z0-9_\-]+(?:\s+[a-zA-Z0-9_\-]+)?\s+(?:bar|cafe|restaurant|room|office|kitchen|lounge|shop|store|hall|station|street|interior))\b/i);
    if (locationPhraseMatch && locationPhraseMatch[1]) {
      foundEnvs.push(locationPhraseMatch[1].trim());
    }

    for (const kw of envKeywords) {
      if (new RegExp(`\\b${kw}\\b`, 'i').test(allText)) {
        if (!foundEnvs.some((e) => e.toLowerCase().includes(kw.toLowerCase()) || kw.toLowerCase().includes(e.toLowerCase()))) {
          foundEnvs.push(kw);
        }
      }
    }

    if (foundEnvs.length > 0) {
      const primaryEnv = foundEnvs[0].charAt(0).toUpperCase() + foundEnvs[0].slice(1);
      backgrounds.BG_01 = `${primaryEnv} location established in script narrative with directional atmospheric lighting`;
      if (foundEnvs.length > 1) {
        const secEnv = foundEnvs[1].charAt(0).toUpperCase() + foundEnvs[1].slice(1);
        backgrounds.BG_02 = `${secEnv} location established in script narrative with balanced spatial lighting`;
      }
    } else {
      backgrounds.BG_01 = 'Primary physical setting established in script narrative with authentic spatial lighting';
      if (scenes.length > 2) {
        backgrounds.BG_02 = 'Secondary setting established in script narrative with distinct spatial lighting';
      }
    }

    // 4. Scene-level tagging
    const scene_tagging: Record<string, string[]> = {};
    const charKeys = Object.keys(characters);
    scenes.forEach((sc, idx) => {
      const active: string[] = [charKeys[0] ? `@${charKeys[0]}` : '@CHAR_01'];
      const scLower = sc.txt.toLowerCase();

      // Background tagging
      if (backgrounds.BG_02 && (idx > 0 && (scLower.includes('bg_02') || (foundEnvs[1] && scLower.includes(foundEnvs[1]))))) {
        active.push('@BG_02');
      } else {
        active.push('@BG_01');
      }

      // Character tagging
      if (charKeys[1]) {
        const secName = knownNames[1]?.toLowerCase();
        if ((secName && scLower.includes(secName)) || scLower.includes('char_02') || idx >= 1) {
          active.push(`@${charKeys[1]}`);
        }
      }
      if (charKeys[2]) {
        const thirdName = knownNames[2]?.toLowerCase();
        if ((thirdName && scLower.includes(thirdName)) || scLower.includes('char_03')) {
          active.push(`@${charKeys[2]}`);
        }
      }

      // Product tagging (always tag in climax, or if referenced in scene)
      if (idx === scenes.length - 1 || scLower.includes('product') || scLower.includes('prod_01') || scLower.includes(productDesc.toLowerCase().slice(0, 10))) {
        active.push('@PROD_01');
      }

      scene_tagging[sc.scene_id] = Array.from(new Set(active));
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
    scenes: Array<{ scene_id: string; txt: string }>,
    input?: ExtractActiveAssetsInput
  ): Promise<AssetExtractionResult | null> {
    const briefContext = this.stateManager.getBriefContext();
    const companyName = input?.company_name || briefContext.company_name;
    const productGoal = input?.product_goal || briefContext.product_goal;
    const productName = briefContext.product_name;

    const userPrompt = `Analyze these locked commercial scenes:
${JSON.stringify(scenes, null, 2)}

Brief Context:
- Company / Brand Name: ${companyName || 'Not specified'}
- Product Goal / Premise: ${productGoal || 'Not specified'}
- Main Product: ${productName || 'Not specified'}

CRITICAL DIRECTIVES:
- Do not extract the company name as a character. Identify the main product from the brief.
- Characters (@CHAR_01..N) must be individuals/actors, NEVER the company or brand.
- Hero Product (@PROD_01) must be the main product from the brief.

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

