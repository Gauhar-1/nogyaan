import {
  AssetRegistry,
  CameraSpec,
  CharacterAsset,
  CompiledShot,
  LocationAsset,
  ProductAsset,
  ResolvedAssetRef
} from '../domain/schemas.js';

export interface SingleSceneCompilationInput {
  sceneNumber: number;
  durationSeconds: number;
  actTitle?: string;
  narrativeTitle?: string;
  storyBeatSummary: string;
  entryFrameBridge?: string;
  visualBlocking?: string;
  kineticActionDescription: string;
  cameraSpec: {
    lensMm: string;
    aperture: string;
    framingAndAngle?: string;
    singleContinuousMovement?: string;
    angle?: string;
    movement?: string;
  };
  onCameraSpokenDialogue?: string;
  postProductionVoiceover?: string;
  sfxAndAmbience?: string;
  onScreenTextOverlay?: string;
  editorCutNote?: string;
  attachedAssetRefs: string[];
}

export class PromptCompilerService {
  /**
   * Validates that all attachedAssetRefs (@CHAR_01, @BG_01, @PROD_01) exist in the AssetRegistry.
   */
  public validateAssetReferences(assetRefs: string[], registry: AssetRegistry): void {
    const validCharIds = new Set(registry.characters.map((c) => `@${c.id.toUpperCase()}`));
    const validBgIds = new Set(registry.environments.map((b) => `@${b.id.toUpperCase()}`));
    const validProdId = `@${registry.product.id.toUpperCase()}`;

    for (const rawRef of assetRefs) {
      const ref = rawRef.startsWith('@') ? rawRef.toUpperCase() : `@${rawRef.toUpperCase()}`;
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
   * Resolves raw asset IDs into human-readable labels and visual summaries
   * e.g., "@CHAR_01" -> "The Shopper (CHAR_01)" with appearance summary
   */
  public resolveAssetReferences(
    assetRefs: string[],
    registry: AssetRegistry
  ): ResolvedAssetRef[] {
    const resolved: ResolvedAssetRef[] = [];

    for (const rawRef of assetRefs) {
      const cleanId = rawRef.replace(/^@/, '').toUpperCase();

      if (/^CHAR_\d+$/.test(cleanId)) {
        const char = registry.characters.find((c) => c.id.toUpperCase() === cleanId);
        if (char) {
          resolved.push({
            id: char.id,
            name: char.name,
            role: char.role,
            label: `${char.name} (${char.id})`,
            summary: `${char.name} (${char.id} — ${char.appearancePrompt})`
          });
        }
      } else if (/^BG_\d+$/.test(cleanId)) {
        const env = registry.environments.find((b) => b.id.toUpperCase() === cleanId);
        if (env) {
          resolved.push({
            id: env.id,
            name: env.name,
            label: `${env.name} (${env.id})`,
            summary: `${env.name} (${env.id} — ${env.environmentPrompt}, Lighting: ${env.lightingProfile})`
          });
        }
      } else if (cleanId === 'PROD_01') {
        const prod = registry.product;
        resolved.push({
          id: 'PROD_01',
          name: prod.name,
          label: `${prod.name} (PROD_01)`,
          summary: `${prod.name} (PROD_01 — ${prod.packagingAppearance}, ${prod.heroAngle})`
        });
      }
    }

    return resolved;
  }

  /**
   * Compiles the Reference-Tagged Kinetic Video Prompt for Kling 3.0 Elements / Veo 3.1 Image-to-Video
   * Strictly separates On-Camera Dialogue from Post-Prod Voiceover and On-Screen Graphics!
   */
  public compileReferenceModePrompt(params: {
    cameraSpec: CameraSpec;
    resolvedAssets: ResolvedAssetRef[];
    kineticAction: string;
    onCameraSpokenDialogue?: string;
    sfxAndAmbience?: string;
  }): string {
    const refTags = params.resolvedAssets.map((a) => `@${a.id} (${a.name})`).join(', ');
    const refsPrefix = refTags ? `[Refs: ${refTags}]` : '';

    const cameraPart = `${params.cameraSpec.lensMm} ${params.cameraSpec.aperture}, ${params.cameraSpec.framingAndAngle}, ${params.cameraSpec.singleContinuousMovement}.`;
    const actionPart = params.kineticAction.trim().replace(/\.$/, '');

    // Rule 2: ONLY include onCameraSpokenDialogue for video lip-sync. Never inject VO or text overlays!
    let dialoguePart = '';
    const dialogue = params.onCameraSpokenDialogue?.trim();
    if (dialogue && dialogue.toUpperCase() !== 'NONE') {
      const cleanDialogue = dialogue.replace(/^["']|["']$/g, '');
      dialoguePart = ` Dialogue lip-sync: "${cleanDialogue}".`;
    }

    let audioPart = '';
    const sfx = params.sfxAndAmbience?.trim();
    if (sfx && sfx.toUpperCase() !== 'NONE') {
      audioPart = ` Audio: ${sfx.replace(/\.$/, '')}.`;
    }

    return `${refsPrefix} ${cameraPart} ${actionPart}.${dialoguePart}${audioPart}`.trim();
  }

  /**
   * Compiles the Standalone Full-Text Video Prompt for direct Text-to-Video without image uploads
   * Automatically weaves character wardrobe and environment atmosphere directly into the continuous prompt.
   */
  public compileStandaloneModePrompt(params: {
    cameraSpec: CameraSpec;
    resolvedAssets: ResolvedAssetRef[];
    kineticAction: string;
    onCameraSpokenDialogue?: string;
    sfxAndAmbience?: string;
  }): string {
    const cameraPart = `Cinematic continuous take, ${params.cameraSpec.lensMm} ${params.cameraSpec.aperture}, ${params.cameraSpec.framingAndAngle}, ${params.cameraSpec.singleContinuousMovement}.`;

    const envAsset = params.resolvedAssets.find((a) => a.id.startsWith('BG_'));
    const envPart = envAsset ? ` Environment: ${envAsset.summary}.` : '';

    const charAssets = params.resolvedAssets.filter((a) => a.id.startsWith('CHAR_'));
    const charPart = charAssets.length > 0 ? ` Subjects: ${charAssets.map((c) => c.summary).join('; ')}.` : '';

    const prodAsset = params.resolvedAssets.find((a) => a.id === 'PROD_01');
    const prodPart = prodAsset ? ` Featuring ${prodAsset.summary}.` : '';

    // Replace @CHAR_01 with character name in action
    let standaloneAction = params.kineticAction.trim().replace(/\.$/, '');
    for (const a of params.resolvedAssets) {
      standaloneAction = standaloneAction.replace(new RegExp(`@${a.id}`, 'g'), a.name);
    }

    let dialoguePart = '';
    const dialogue = params.onCameraSpokenDialogue?.trim();
    if (dialogue && dialogue.toUpperCase() !== 'NONE') {
      const cleanDialogue = dialogue.replace(/^["']|["']$/g, '');
      dialoguePart = ` Dialogue lip-sync: "${cleanDialogue}".`;
    }

    let audioPart = '';
    const sfx = params.sfxAndAmbience?.trim();
    if (sfx && sfx.toUpperCase() !== 'NONE') {
      audioPart = ` Audio ambience: ${sfx.replace(/\.$/, '')}.`;
    }

    return `${cameraPart}${envPart}${charPart}${prodPart} Continuous action: ${standaloneAction}.${dialoguePart}${audioPart}`.trim();
  }

  /**
   * Compiles a single scene with full 5-rule enforcement and dual prompt generation
   */
  public compileSingleScene(
    input: SingleSceneCompilationInput,
    registry?: AssetRegistry
  ): CompiledShot {
    if (registry) {
      this.validateAssetReferences(input.attachedAssetRefs, registry);
    }

    const resolvedAssets = registry
      ? this.resolveAssetReferences(input.attachedAssetRefs, registry)
      : input.attachedAssetRefs.map((ref) => {
          const cleanId = ref.replace(/^@/, '');
          return {
            id: cleanId,
            name: cleanId,
            label: ref,
            summary: ref
          };
        });

    const cameraSpec: CameraSpec = {
      lensMm: input.cameraSpec.lensMm || '50mm',
      aperture: input.cameraSpec.aperture || 'f/1.8',
      framingAndAngle:
        input.cameraSpec.framingAndAngle ||
        input.cameraSpec.angle ||
        'Eye-level medium shot',
      singleContinuousMovement:
        input.cameraSpec.singleContinuousMovement ||
        input.cameraSpec.movement ||
        'Slow smooth push-in'
    };

    const action = input.kineticActionDescription || input.visualBlocking || '';
    const onCameraDialogue = input.onCameraSpokenDialogue || 'NONE';
    const postProdVO = input.postProductionVoiceover || 'NONE';
    const sfx = input.sfxAndAmbience || 'NONE';
    const overlayText = input.onScreenTextOverlay || 'NONE';

    const referenceModePrompt = this.compileReferenceModePrompt({
      cameraSpec,
      resolvedAssets,
      kineticAction: action,
      onCameraSpokenDialogue: onCameraDialogue,
      sfxAndAmbience: sfx
    });

    const standaloneModePrompt = this.compileStandaloneModePrompt({
      cameraSpec,
      resolvedAssets,
      kineticAction: action,
      onCameraSpokenDialogue: onCameraDialogue,
      sfxAndAmbience: sfx
    });

    const actTitles = ['Act I — Setup', 'Act II — Catalyst', 'Act III — Twist', 'Act IV — Climax'];
    const actTitle =
      input.actTitle ||
      (input.sceneNumber <= 4 ? actTitles[input.sceneNumber - 1] : `Act ${input.sceneNumber}`);

    return {
      sceneNumber: input.sceneNumber,
      durationSeconds: input.durationSeconds || 5,
      actTitle,
      narrativeTitle: input.narrativeTitle || `Scene ${input.sceneNumber}`,
      storyBeatSummary: input.storyBeatSummary,
      entryFrameBridge:
        input.entryFrameBridge ||
        (input.sceneNumber === 1 ? 'NONE (Opening scene)' : 'Connecting from previous frame'),
      visualBlocking: input.visualBlocking || action,
      cameraSpec,
      onCameraSpokenDialogue: onCameraDialogue,
      postProductionVoiceover: postProdVO,
      sfxAndAmbience: sfx,
      onScreenTextOverlay: overlayText,
      editorCutNote: input.editorCutNote || 'Match cut on motion',
      attachedAssetRefs: input.attachedAssetRefs.map((r) =>
        r.startsWith('@') ? r : `@${r}`
      ),
      attachedAssetsResolved: resolvedAssets,
      referenceModePrompt,
      standaloneModePrompt,
      // Backward compatibility bindings:
      aiVideoPrompt: referenceModePrompt,
      screenplayAction: input.visualBlocking || action,
      spokenDialogue: onCameraDialogue,
      compiledVideoPrompt: referenceModePrompt
    };
  }

  /**
   * Backward-compatibility helper for legacy compilation calls
   */
  public compileVideoPrompt(input: {
    cameraSpec: any;
    attachedAssetRefs: string[];
    kineticMotion: string;
    spokenDialogue: string;
    sfxAndAmbience: string;
  }): string {
    const cam: CameraSpec = {
      lensMm: input.cameraSpec.lensMm || '50mm',
      aperture: input.cameraSpec.aperture || 'f/1.8',
      framingAndAngle: input.cameraSpec.framingAndAngle || input.cameraSpec.angle || 'Medium shot',
      singleContinuousMovement: input.cameraSpec.singleContinuousMovement || input.cameraSpec.movement || 'Push in'
    };
    const resolved = input.attachedAssetRefs.map((r) => ({
      id: r.replace(/^@/, ''),
      name: r.replace(/^@/, ''),
      label: r,
      summary: r
    }));
    return this.compileReferenceModePrompt({
      cameraSpec: cam,
      resolvedAssets: resolved,
      kineticAction: input.kineticMotion,
      onCameraSpokenDialogue: input.spokenDialogue,
      sfxAndAmbience: input.sfxAndAmbience
    });
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
