import {
  AssetRegistry,
  CameraSpec,
  CharacterAsset,
  CompiledShot,
  LocationAsset,
  ProductAsset
} from '../domain/schemas.js';

export interface ShotCompilationInput {
  sceneNumber: number;
  durationSeconds: number;
  storyBeatSummary: string;
  entryFrameBridge: string;
  screenplayAction: string;
  spokenDialogue: string;
  sfxAndAmbience: string;
  editorCutNote: string;
  cameraSpec: CameraSpec;
  attachedAssetRefs: string[];
  kineticMotion?: string; // Optional specific kinetic action, otherwise derived from screenplayAction
}

export class PromptCompilerService {
  /**
   * Validates that all attachedAssetRefs (@CHAR_01, @BG_01, @PROD_01) exist in the AssetRegistry.
   */
  public validateAssetReferences(assetRefs: string[], registry: AssetRegistry): void {
    const validCharIds = new Set(registry.characters.map((c) => `@${c.id}`));
    const validBgIds = new Set(registry.environments.map((b) => `@${b.id}`));
    const validProdId = `@${registry.product.id}`;

    for (const rawRef of assetRefs) {
      const ref = rawRef.startsWith('@') ? rawRef : `@${rawRef}`;
      const isValid =
        validCharIds.has(ref) ||
        validBgIds.has(ref) ||
        ref === validProdId ||
        ref === '@PROD_01';

      if (!isValid) {
        const available = [
          ...Array.from(validCharIds),
          ...Array.from(validBgIds),
          validProdId
        ].join(', ');
        throw new Error(
          `REFERENTIAL INTEGRITY VIOLATION: Asset reference "${rawRef}" was not declared in the locked asset registry. Available assets: ${available}`
        );
      }
    }
  }

  /**
   * Compiles the deterministic Reference-Tagged Kinetic Video Prompt
   * Format:
   * [Refs: @CHAR_01, @BG_01] 85mm f/1.4, LOW_ANGLE, DOLLY_IN. <kineticMotion>. Dialogue lip-sync: "<dialogue>". Audio: <sfx>.
   */
  public compileVideoPrompt(
    input: {
      cameraSpec: CameraSpec;
      attachedAssetRefs: string[];
      kineticMotion: string;
      spokenDialogue: string;
      sfxAndAmbience: string;
    }
  ): string {
    const normalizedRefs = input.attachedAssetRefs.map((r) =>
      r.startsWith('@') ? r : `@${r}`
    );
    const refsTag = `[Refs: ${normalizedRefs.join(', ')}]`;
    const cameraTag = `${input.cameraSpec.lensMm} ${input.cameraSpec.aperture}, ${input.cameraSpec.angle}, ${input.cameraSpec.movement}.`;
    const cleanMotion = input.kineticMotion.trim().replace(/\.$/, '');
    const dialogueTag = `Dialogue lip-sync: "${input.spokenDialogue.trim()}".`;
    const audioTag = `Audio: ${input.sfxAndAmbience.trim().replace(/\.$/, '')}.`;

    return `${refsTag} ${cameraTag} ${cleanMotion}. ${dialogueTag} ${audioTag}`;
  }

  /**
   * Compiles a full shot with deterministic prompt generation and asset validation.
   */
  public compileShot(
    input: ShotCompilationInput,
    registry?: AssetRegistry
  ): CompiledShot {
    if (registry) {
      this.validateAssetReferences(input.attachedAssetRefs, registry);
    }

    const kineticMotion = input.kineticMotion || input.screenplayAction;
    const aiVideoPrompt = this.compileVideoPrompt({
      cameraSpec: input.cameraSpec,
      attachedAssetRefs: input.attachedAssetRefs,
      kineticMotion,
      spokenDialogue: input.spokenDialogue,
      sfxAndAmbience: input.sfxAndAmbience
    });

    return {
      sceneNumber: input.sceneNumber,
      durationSeconds: input.durationSeconds,
      storyBeatSummary: input.storyBeatSummary,
      entryFrameBridge: input.entryFrameBridge,
      screenplayAction: input.screenplayAction,
      spokenDialogue: input.spokenDialogue,
      sfxAndAmbience: input.sfxAndAmbience,
      editorCutNote: input.editorCutNote,
      cameraSpec: input.cameraSpec,
      attachedAssetRefs: input.attachedAssetRefs.map((r) =>
        r.startsWith('@') ? r : `@${r}`
      ),
      aiVideoPrompt
    };
  }

  /**
   * Generates production-ready Midjourney / Flux Image Generation Prompts for Asset Bible
   */
  public generateCharacterImagePrompt(char: CharacterAsset): string {
    return `Character concept portrait of ${char.name}, ${char.role}, ${char.appearancePrompt}, photorealistic 35mm film photography, 8k resolution, authentic skin texture, cinematic lighting, master studio portrait, sharp focus --ar 16:9 --style raw`;
  }

  public generateLocationImagePrompt(loc: LocationAsset): string {
    return `Cinematic environment landscape of ${loc.name}, ${loc.environmentPrompt}, lighting: ${loc.lightingProfile}, architectural wide shot, photorealistic 24mm lens, Kodak Portra 400 color science, ultra-detailed atmosphere --ar 16:9 --style raw`;
  }

  public generateProductImagePrompt(prod: ProductAsset): string {
    return `High-end commercial hero studio photography of ${prod.name}, ${prod.packagingAppearance}, angle: ${prod.heroAngle}, advertising luxury commercial lighting, reflections, condensation drops, crisp product packaging, 85mm macro lens, Hasselblad quality --ar 16:9 --style raw`;
  }
}

