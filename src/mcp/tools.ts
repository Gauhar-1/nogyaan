import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import open from 'open';
import { PresetRegistryService } from '../services/preset-registry.service.js';
import { PromptCompilerService } from '../services/prompt-compiler.service.js';
import { SessionDagService } from '../services/session-dag.service.js';

export function registerMcpTools(
  server: Server,
  sessionService: SessionDagService,
  presetRegistry: PresetRegistryService,
  promptCompiler: PromptCompilerService
): void {
  const presetIds = presetRegistry.getPresetIds();

  // Handler for listing tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'list_presets',
          description:
            'Returns a list of all loaded narrative presets (e.g., indian-d2c-story, dev-product-launch, tiktok-ugc-hook) with their philosophy, lens palette, and strict dialogue language rules.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'init_brief',
          description:
            'Step 1: Initializes brand brief and creates a new isolated session. Sets stage to CORE_THEME. Scans for anti-jargon compliance. Requires company, product, and goal. Claude must then call lock_core_theme.',
          inputSchema: {
            type: 'object',
            properties: {
              company: {
                type: 'string',
                description: 'Company or brand name (e.g. "ChaiWaale", "DevScale")'
              },
              product: {
                type: 'string',
                description: 'Product or service being advertised'
              },
              goal: {
                type: 'string',
                description: 'Campaign conversion or emotional objective'
              },
              preset: {
                type: 'string',
                enum: presetIds,
                description: `Narrative preset to apply (Available: ${presetIds.join(', ')}). Defaults to indian-d2c-story`
              },
              preset_id: {
                type: 'string',
                enum: presetIds,
                description: 'Alias for preset argument'
              },
              brandFriction: {
                type: 'string',
                description: 'Human or cultural friction this brand resolves'
              },
              audience: {
                type: 'string',
                description: 'Target demographic or cultural segment'
              },
              initialOptions: {
                type: 'array',
                description: 'Initial narrative options 1, 2, 3 for CORE_THEME'
              }
            },
            required: ['company', 'product', 'goal']
          }
        },
        {
          name: 'lock_core_theme',
          description:
            'Step 1.5: Locks the overarching Core Campaign Premise (an abstract narrative concept, NOT a physical scene). Transitions stage from CORE_THEME to SCENE_1_SETUP.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID (defaults to latest active)'
              },
              chosen_theme_id: {
                type: 'string',
                enum: ['1', '2', '3'],
                description: 'Chosen core theme route ("1", "2", or "3")'
              },
              theme_title: {
                type: 'string',
                description: 'Short descriptive title of the selected theme'
              },
              theme_premise: {
                type: 'string',
                description: 'Full narrative premise and emotional core'
              },
              nextOptions: {
                type: 'array',
                description: 'Proposed 3 opening visual scenarios for Scene 1 (Act I — Setup)'
              }
            },
            required: ['chosen_theme_id', 'theme_title', 'theme_premise']
          }
        },
        {
          name: 'branch_scene',
          description:
            'Step 2: Commits physical Scene 1, 2, 3, or 4 with internal continuity bridges and prunes rejected options. Scene 1 has NO incoming entry frame. Scene > 1 enforces continuity from previous scene.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID (defaults to latest active session)'
              },
              action: {
                type: 'string',
                enum: ['commit', 'regenerate'],
                description: '"commit" to lock an option, "regenerate" (R) to overwrite options'
              },
              scene_number: {
                type: 'number',
                description: 'Physical scene number being locked (1 to 4)'
              },
              chosen_option_id: {
                type: 'string',
                enum: ['1', '2', '3'],
                description: 'Selected option identifier'
              },
              selectedOptionId: {
                type: 'string',
                enum: ['1', '2', '3'],
                description: 'Alias for chosen_option_id'
              },
              chosen_narrative_summary: {
                type: 'string',
                description: 'Full narrative beat summary for the locked scene'
              },
              title: {
                type: 'string',
                description: 'Title for the scene'
              },
              description: {
                type: 'string',
                description: 'Scene description'
              },
              treatmentProse: {
                type: 'string',
                description: 'Screenplay treatment action'
              },
              exit_frame_anchor: {
                type: 'string',
                description:
                  'Exact physical posture, character position, and location at the final millisecond of this scene'
              },
              nextOptions: {
                type: 'array',
                description: 'The 3 branching options for the next scene or regenerated current scene'
              },
              pruning_confirmation: {
                type: 'array',
                items: { type: 'string' },
                description: 'Confirmation IDs of rejected branches pruned'
              }
            },
            required: ['action']
          }
        },
        {
          name: 'lock_assets',
          description:
            'Step 3: Locks visual assets (characters CHAR_01..N, environments BG_01..N, and product PROD_01). Generates Midjourney/Flux reference prompts.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID (defaults to latest active)'
              },
              characters: {
                type: 'array',
                description: 'Array of character definitions with CHAR_01..N IDs'
              },
              environments: {
                type: 'array',
                description: 'Array of background/location definitions with BG_01..N IDs'
              },
              product: {
                type: 'object',
                description: 'Hero product definition with PROD_01 ID'
              }
            },
            required: ['characters', 'environments']
          }
        },
        {
          name: 'compile_single_scene',
          description:
            'Step 4: Compiles ONE scene at a time with strict video diffusion rules (single continuous camera trajectory, separated onCameraSpokenDialogue vs VO, >= 80 chars physical blocking, dual reference/standalone prompts).',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID (defaults to latest active)'
              },
              scene_number: {
                type: 'number',
                description: 'Scene number being compiled (1, 2, 3, or 4)'
              },
              duration_seconds: {
                type: 'number',
                description: 'Continuous take runtime in seconds (4s to 8s, default 5s)'
              },
              act_title: {
                type: 'string',
                description: 'Act title (e.g., "Act I — Setup", "Act II — Catalyst", "Act III — Twist", "Act IV — Climax")'
              },
              narrative_title: {
                type: 'string',
                description: 'Short creative title for this scene take'
              },
              story_beat_summary: {
                type: 'string',
                description: 'Preserved human story beat from the locked script'
              },
              entry_frame_bridge: {
                type: 'string',
                description: 'How this continuous take picks up from previous scene (or "NONE" for Scene 1)'
              },
              kinetic_action_description: {
                type: 'string',
                description:
                  'MANDATORY: Minimum 80 characters of continuous physical motion, micro-movements, and camera physics. Zero generic slop ("interact in scene", "walks and talks", "then cuts to" are strictly rejected).'
              },
              camera_spec: {
                type: 'object',
                properties: {
                  lensMm: { type: 'string', description: 'Lens focal length (e.g. "24mm", "35mm", "50mm", "85mm")' },
                  aperture: { type: 'string', description: 'Lens aperture (e.g. "f/1.4", "f/2.8")' },
                  framingAndAngle: { type: 'string', description: 'Framing & angle (e.g. "Low-angle medium close-up")' },
                  singleContinuousMovement: { type: 'string', description: 'Continuous take movement (e.g. "Slow cinematic push-in")' }
                },
                required: ['lensMm', 'aperture', 'framingAndAngle', 'singleContinuousMovement']
              },
              on_camera_spoken_dialogue: {
                type: 'string',
                description: 'Exact words physically spoken by visible character moving lips on screen (or "NONE")'
              },
              post_production_voiceover: {
                type: 'string',
                description: 'Narrator voiceover added in post-production timeline (or "NONE")'
              },
              sfx_and_ambience: {
                type: 'string',
                description: 'Audio ambience and foley sound effects (or "NONE")'
              },
              on_screen_text_overlay: {
                type: 'string',
                description: 'Graphic title or typography overlay added in post (or "NONE")'
              },
              editor_cut_note: {
                type: 'string',
                description: 'Editorial cut transition note for human video editor'
              },
              attached_asset_refs: {
                type: 'array',
                items: { type: 'string' },
                description: 'Locked asset IDs present in this take (e.g. ["@CHAR_01", "@BG_01", "@PROD_01"])'
              }
            },
            required: ['scene_number', 'kinetic_action_description', 'camera_spec', 'attached_asset_refs']
          }
        },
        {
          name: 'compile_shots',
          description:
            'Convenience batch compiler: Compiles multiple scenes in sequence. Use compile_single_scene for step-by-step control.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID (defaults to latest active)'
              },
              shots: {
                type: 'array',
                description: 'Array of scene shots to compile'
              },
              openStudioUi: {
                type: 'boolean',
                description: 'Whether to open http://localhost:4321 in browser'
              }
            },
            required: ['shots']
          }
        }
      ]
    };
  });

  // Handler for tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const input: Record<string, any> = args || {};

    try {
      if (name === 'list_presets') {
        const presets = presetRegistry.getAllPresets();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(presets, null, 2)
            }
          ]
        };
      }

      if (name === 'init_brief') {
        const presetId = input.preset || input.preset_id || 'indian-d2c-story';
        const preset = presetRegistry.getPresetById(presetId);
        if (!preset) {
          throw new Error(
            `Unknown preset "${presetId}". Available presets: ${presetIds.join(', ')}`
          );
        }

        const session = sessionService.createSession({
          company: input.company,
          product: input.product,
          goal: input.goal,
          presetId,
          brandFriction: input.brandFriction,
          options: input.initialOptions
        });

        const lockedBrief =
          `### [🎬 noslop] BRAND BRIEF: ${session.company.toUpperCase()}\n` +
          `* **Product:** ${session.product}\n` +
          `* **Goal:** ${session.goal}\n` +
          `* **Storytelling Cartridge:** ${preset.name} (${preset.id})\n` +
          `* **Language Rule:** ${preset.dialogueLanguageRule}\n` +
          `* **Session ID:** ${session.sessionId}`;

        const result = {
          success: true,
          message: `Brand brief locked into isolated session ${session.sessionId}. State initialized to CORE_THEME.`,
          sessionId: session.sessionId,
          currentStage: session.stage,
          workspaceDir: sessionService.getWorkspaceDir(),
          storagePath: `${sessionService.getSessionsDir()}/${session.sessionId}.json`,
          lockedBrief,
          preset,
          _systemDirective: {
            instruction:
              'Present 3 distinct Core Campaign Premise options for the brand friction. When user selects 1, 2, or 3, call "lock_core_theme".',
            languageRule: preset.dialogueLanguageRule,
            endingRule: "End your response STRICTLY with: 'Reply 1, 2, 3, or R (regenerate).'"
          }
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      if (name === 'lock_core_theme') {
        const result = sessionService.lockCoreTheme({
          sessionId: input.session_id,
          chosenThemeId: input.chosen_theme_id,
          themeTitle: input.theme_title,
          themePremise: input.theme_premise,
          nextOptions: input.nextOptions
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      if (name === 'branch_scene') {
        const activeSession = sessionService.loadSession(input.session_id);
        const preset = activeSession ? presetRegistry.getPresetById(activeSession.presetId) : undefined;
        const languageRule = preset?.dialogueLanguageRule || 'Strictly adhere to preset language rules.';

        const chosenOptionId = input.chosen_option_id || input.selectedOptionId;
        const chosenNarrativeSummary =
          input.chosen_narrative_summary ||
          input.treatmentProse ||
          input.description ||
          input.title;

        const branchResult = sessionService.branchScene({
          sessionId: input.session_id,
          action: input.action,
          sceneNumber: input.scene_number,
          chosenOptionId,
          chosenNarrativeSummary,
          title: input.title,
          description: input.description,
          treatmentProse: input.treatmentProse,
          exitFrameAnchor: input.exit_frame_anchor,
          nextOptions: input.nextOptions,
          pruningConfirmation: input.pruning_confirmation,
          presetLanguageRule: languageRule
        });

        const outputData = {
          success: true,
          sessionId: branchResult.session.sessionId,
          currentStage: branchResult.session.stage,
          prunedCount: branchResult.session.prunedCount,
          isNarrativeComplete: branchResult.session.stage === 'LOCK_ASSETS',
          lockedNodes: branchResult.session.lockedNodes,
          continuityBridge: branchResult.continuityBridge,
          dialogueLanguageRule: languageRule,
          _systemDirective: branchResult.directive
        };

        let formattedText = JSON.stringify(outputData, null, 2);
        if (branchResult.continuityBridge) {
          formattedText = `${branchResult.continuityBridge}\n\n${formattedText}`;
        }

        return {
          content: [{ type: 'text', text: formattedText }]
        };
      }

      if (name === 'lock_assets') {
        const activeSession = sessionService.loadSession(input.session_id);
        const preset = activeSession ? presetRegistry.getPresetById(activeSession.presetId) : undefined;
        const languageRule = preset?.dialogueLanguageRule || 'Strictly adhere to preset language rules.';

        const result = sessionService.lockAssets({
          sessionId: input.session_id,
          characters: input.characters,
          environments: input.environments,
          product: input.product,
          presetLanguageRule: languageRule
        });

        const outputData = {
          success: true,
          sessionId: result.session.sessionId,
          currentStage: result.session.stage,
          lockedAssets: result.session.assets,
          dialogueLanguageRule: languageRule,
          _systemDirective: result.directive
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(outputData, null, 2) }]
        };
      }

      if (name === 'compile_single_scene') {
        const result = sessionService.compileSingleScene({
          sessionId: input.session_id,
          sceneNumber: input.scene_number,
          durationSeconds: input.duration_seconds,
          actTitle: input.act_title,
          narrativeTitle: input.narrative_title,
          storyBeatSummary: input.story_beat_summary,
          entryFrameBridge: input.entry_frame_bridge,
          kineticActionDescription: input.kinetic_action_description,
          cameraSpec: input.camera_spec,
          onCameraSpokenDialogue: input.on_camera_spoken_dialogue,
          postProductionVoiceover: input.post_production_voiceover,
          sfxAndAmbience: input.sfx_and_ambience,
          onScreenTextOverlay: input.on_screen_text_overlay,
          editorCutNote: input.editor_cut_note,
          attachedAssetRefs: input.attached_asset_refs
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      if (name === 'compile_shots') {
        const activeSession = sessionService.loadSession(input.session_id);
        const preset = activeSession ? presetRegistry.getPresetById(activeSession.presetId) : undefined;
        const languageRule = preset?.dialogueLanguageRule || 'Strictly adhere to preset language rules.';

        const result = sessionService.compileShots({
          sessionId: input.session_id,
          shots: input.shots,
          openStudioUi: input.openStudioUi,
          presetLanguageRule: languageRule
        });

        if (input.openStudioUi !== false) {
          try {
            await open('http://localhost:4321');
          } catch {}
        }

        const outputData = {
          success: true,
          sessionId: result.session.sessionId,
          currentStage: result.session.stage,
          compiledShots: result.compiledShots,
          studioCanvasUrl: 'http://localhost:4321',
          dialogueLanguageRule: languageRule,
          _systemDirective: result.directive
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(outputData, null, 2) }]
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `ERROR: ${err.message}` }],
        isError: true
      };
    }
  });
}
