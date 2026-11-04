import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import open from 'open';
import { PresetRegistryService } from '../services/preset-registry.service.js';
import { PromptCompilerService } from '../services/prompt-compiler.service.js';
import { SessionDagService } from '../services/session-dag.service.js';
import { StateManager } from '../v2/state-manager.js';
import { WritersRoomService } from '../v2/writers-room.service.js';
import { AssetLockerService } from '../v2/asset-locker.service.js';
import { DpPitchService } from '../v2/dp-pitch.service.js';
import { RerollService } from '../v2/reroll.service.js';
import {
  AnyLockedScriptSchema,
  AnyLockedShotSchema,
  Medium
} from '../v2/types.js';

export function registerMcpTools(
  server: Server,
  sessionService: SessionDagService,
  presetRegistry: PresetRegistryService,
  promptCompiler: PromptCompilerService,
  stateManagerInput?: StateManager,
  writersRoomInput?: WritersRoomService,
  dpPitchInput?: DpPitchService,
  rerollServiceInput?: RerollService,
  assetLockerInput?: AssetLockerService
): void {
  const stateManager = stateManagerInput || new StateManager();
  const writersRoom = writersRoomInput || new WritersRoomService(stateManager);
  const assetLocker = assetLockerInput || new AssetLockerService(stateManager);
  const dpPitch = dpPitchInput || new DpPitchService(stateManager);
  const rerollService = rerollServiceInput || new RerollService(stateManager);

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
          name: 'pitch_script_options',
          description:
            'Phase 1 Writer\'s Room: JIT context-sliced narrative branching. Passes ONLY core premise and Scene N-1 locked narrative (zero camera data, zero assets). Generates exactly 3 minified ScriptPitch options (Heartfelt, Viral, Offbeat).',
          inputSchema: {
            type: 'object',
            properties: {
              scene_id: {
                type: 'string',
                description: 'Scene ID to pitch script options for (e.g. "SCENE_01")'
              },
              user_guidance: {
                type: 'string',
                description: 'Optional directorial steering or thematic guidance'
              }
            },
            required: ['scene_id']
          }
        },
        {
          name: 'lock_script_option',
          description:
            'Locks a chosen ScriptPitch or ScriptOption into the local nogyaan-state.json for the specified scene.',
          inputSchema: {
            type: 'object',
            properties: {
              scene_id: {
                type: 'string',
                description: 'Target scene ID (e.g. "SCENE_01")'
              },
              script: {
                type: 'object',
                description: 'The chosen ScriptPitch object (id, style, txt) or ScriptOption object'
              },
              option_id: {
                type: 'string',
                description: 'Optional option_id if selecting from pitched options'
              }
            },
            required: ['scene_id']
          }
        },
        {
          name: 'extract_active_assets',
          description:
            'Phase 2 Asset Locker: Analyzes locked 4-scene narrative to identify required cast, backgrounds, and products, returning an AssetBible and tagging each scene with active_refs (e.g., ["@CHAR_01", "@BG_02"]) to prevent passing unused characters into downstream DP shots.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'pitch_shot_options',
          description:
            'Phase 3 DP Suite: Strictly sequential shot-by-shot pitch. Receives Scene X, Shot Y, pitches EXACTLY 3 options (Auteur, Kinetic, Theatrical) for that single shot, and completely HALTS execution to yield to the user. The AI must STOP and do nothing until the user explicitly selects one of the 3 options in the UI.',
          inputSchema: {
            type: 'object',
            properties: {
              scene_id: {
                type: 'string',
                description: 'Scene ID (e.g. "SCENE_01")'
              },
              shot_id: {
                type: 'string',
                description: 'Shot identifier (e.g. "SHOT_01")'
              }
            },
            required: ['scene_id', 'shot_id']
          }
        },
        {
          name: 'lock_shot_option',
          description:
            'Locks a chosen ShotPitch or ShotOption into the local nogyaan-state.json for the specified scene and shot.',
          inputSchema: {
            type: 'object',
            properties: {
              scene_id: {
                type: 'string',
                description: 'Scene ID'
              },
              shot_id: {
                type: 'string',
                description: 'Shot identifier (e.g. "SHOT_01")'
              },
              shot: {
                type: 'object',
                description: 'The chosen ShotPitch object (id, style, txt, prmpt) or ShotOption'
              },
              spatial_facts: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Optional physical facts established in this shot (e.g. ["Sharma is seated at table 4", "Phone is on table"])'
              }
            },
            required: ['scene_id', 'shot_id', 'shot']
          }
        },
        {
          name: 'set_director_notes',
          description:
            'Sets persistent cinematic rules or directorial constraints in nogyaan-state.json (e.g., "Scene 4 must visually mirror Scene 1") that apply across all scenes.',
          inputSchema: {
            type: 'object',
            properties: {
              notes: {
                type: 'string',
                description: 'Directorial notes and persistent cinematic rules'
              }
            },
            required: ['notes']
          }
        },
        {
          name: 'reroll_node',
          description:
            'Targeted Re-Roll: Modifies ONLY an isolated node (scene or shot ID) in nogyaan-state.json based on specific user feedback, preserving all other locked scenes and shots with zero token burn.',
          inputSchema: {
            type: 'object',
            properties: {
              node_id: {
                type: 'string',
                description: 'Target node identifier (scene_id like "SCENE_01", shot_id like "SHOT_01", or "SCENE_01:SHOT_01")'
              },
              user_feedback: {
                type: 'string',
                description: 'Targeted directorial refinement feedback'
              }
            },
            required: ['node_id', 'user_feedback']
          }
        },
        {
          name: 'get_nogyaan_state',
          description:
            'Returns the full current nogyaan-state.json state machine (global_medium, assets, and scenes with locked scripts and shots).',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'update_asset_bible',
          description:
            'Updates characters, backgrounds, hero product, and global_medium in nogyaan-state.json.',
          inputSchema: {
            type: 'object',
            properties: {
              characters: {
                type: 'object',
                description: 'Map of character ID to description (e.g. {"CHAR_01": "Sharma ji, 50s..."})'
              },
              backgrounds: {
                type: 'object',
                description: 'Map of background ID to description (e.g. {"BG_01": "Living room..."})'
              },
              product: {
                type: 'string',
                description: 'Hero product description'
              },
              global_medium: {
                type: 'string',
                enum: ['Live-Action Cinematic', '2D Anime', '3D Pixar Style'],
                description: 'Global rendering medium'
              },
              global_director_notes: {
                type: 'string',
                description: 'Persistent cinematic rules applying across all scenes (e.g., "Scene 4 must visually mirror Scene 1")'
              }
            }
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
          `### [🎬 nogyaan] BRAND BRIEF: ${session.company.toUpperCase()}\n` +
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

      if (name === 'pitch_script_options') {
        const options = await writersRoom.pitchScriptOptions({
          scene_id: input.scene_id,
          user_guidance: input.user_guidance
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  scene_id: input.scene_id,
                  pitches: options,
                  _systemDirective: {
                    instruction:
                      'Present these 3 distinct narrative paths to the user (Heartfelt, Viral, Offbeat). Once selected, call "lock_script_option".',
                    endingRule: "End response with: 'Select Option A, B, or C or request guidance.'"
                  }
                },
                null,
                2
              )
            }
          ]
        };
      }

      if (name === 'lock_script_option') {
        let scriptToLock = input.script || input.pitch;
        if (!scriptToLock && (input.option_id || input.id)) {
          const searchId = input.option_id || input.id;
          const existingScene = stateManager.getScene(input.scene_id);
          const lScript: any = existingScene?.locked_script;
          if (existingScene && lScript && (lScript.option_id === searchId || lScript.id === searchId)) {
            scriptToLock = existingScene.locked_script;
          }
        }
        if (!scriptToLock) {
          throw new Error('Script object is required to lock script option.');
        }
        const updatedState = stateManager.lockScript(input.scene_id, scriptToLock);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: `Script option locked for ${input.scene_id}.`,
                  scene_id: input.scene_id,
                  locked_script: scriptToLock,
                  state: updatedState,
                  _systemDirective: {
                    instruction:
                      updatedState.scenes.length >= 4 && updatedState.scenes.every((s) => s.locked_script)
                        ? 'All 4 scenes locked! Trigger "extract_active_assets" to tag scene-level assets before moving to the DP Suite.'
                        : `Script for ${input.scene_id} is locked. Proceed to next scene or call extract_active_assets when all 4 scenes are locked.`
                  }
                },
                null,
                2
              )
            }
          ]
        };
      }

      if (name === 'extract_active_assets') {
        const result = await assetLocker.extractActiveAssets();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Asset Bible extracted and active_refs tagged for all scenes.',
                  extraction: result.extraction,
                  state: result.state,
                  _systemDirective: {
                    instruction:
                      'Active asset references tagged across all scenes. Now call "pitch_shot_options" for Scene 1 Shot 1.'
                  }
                },
                null,
                2
              )
            }
          ]
        };
      }

      if (name === 'pitch_shot_options') {
        // Step A: Tool receives request for Scene X, Shot Y
        const options = await dpPitch.pitchShotOptions({
          scene_id: input.scene_id,
          shot_id: input.shot_id
        });

        // Step B: Generated EXACTLY 3 options (Auteur, Kinetic, Theatrical) for that single shot
        // Step C (THE YIELD): Return these 3 options to the UI/MCP and completely HALT execution.
        // Step D: System does NOTHING until the user explicitly selects one of the 3 options.
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'YIELD_TO_USER',
                  action_required: 'USER_SELECTION',
                  message: `Pitched 3 options for ${input.scene_id} ${input.shot_id}. Execution halted. Waiting for user to select 1 option before proceeding.`,
                  scene_id: input.scene_id,
                  shot_id: input.shot_id,
                  pitches: options,
                  options: options,
                  _systemDirective: {
                    directive: 'HARD_STOP_YIELD_TO_USER',
                    instruction:
                      'CRITICAL: You are an interactive DP. You must only pitch 3 options for the CURRENT single shot. Do NOT generate the next shot. Do NOT generate a prompt for the whole scene. Output the 3 options as JSON, then STOP and wait for the user\'s selection. Do not attempt to complete the storyboard.',
                    workflow:
                      '1. Display the 3 pitched treatments (A: Auteur, B: Kinetic, C: Theatrical) to the user. 2. Completely HALT execution. Do NOT call pitch_shot_options for the next shot. Do NOT proceed. 3. Wait for the user to explicitly select an option in the UI or chat. 4. Only after the user selects, call lock_shot_option.',
                    endingRule: 'Select Treatment A, B, or C or request targeted camera adjustments before moving to the next shot.'
                  }
                },
                null,
                2
              )
            }
          ]
        };
      }

      if (name === 'lock_shot_option') {
        const shotToLock = input.shot || input.pitch;
        if (!shotToLock) {
          throw new Error('Shot object is required to lock shot option.');
        }
        const spatialFacts = input.spatial_facts || input.spatial_memory_updates;
        const updatedState = stateManager.lockShot(
          input.scene_id,
          input.shot_id,
          shotToLock,
          spatialFacts
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: `Shot option locked for ${input.scene_id} -> ${input.shot_id}. Spatial memory silently updated.`,
                  scene_id: input.scene_id,
                  shot_id: input.shot_id,
                  locked_shot: shotToLock,
                  spatial_memory: updatedState.scenes.find((s) => s.scene_id === input.scene_id)?.spatial_memory || [],
                  state: updatedState
                },
                null,
                2
              )
            }
          ]
        };
      }

      if (name === 'set_director_notes') {
        const updatedState = stateManager.setGlobalDirectorNotes(input.notes);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Global director notes updated.',
                  global_director_notes: updatedState.global_director_notes,
                  state: updatedState
                },
                null,
                2
              )
            }
          ]
        };
      }

      if (name === 'reroll_node') {
        const result = await rerollService.rerollNode({
          node_id: input.node_id,
          user_feedback: input.user_feedback
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: `Targeted re-roll applied to node "${input.node_id}".`,
                  result
                },
                null,
                2
              )
            }
          ]
        };
      }

      if (name === 'get_nogyaan_state') {
        const state = stateManager.getState();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(state, null, 2)
            }
          ]
        };
      }

      if (name === 'update_asset_bible') {
        const currentState = stateManager.getState();
        const updatedAssets = {
          characters: input.characters !== undefined ? input.characters : currentState.assets.characters,
          backgrounds: input.backgrounds !== undefined ? input.backgrounds : currentState.assets.backgrounds,
          product: input.product !== undefined ? input.product : currentState.assets.product
        };
        stateManager.updateAssetBible(updatedAssets);
        if (input.global_medium) {
          stateManager.updateGlobalMedium(input.global_medium as Medium);
        }
        if (input.global_director_notes !== undefined) {
          stateManager.setGlobalDirectorNotes(input.global_director_notes);
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: 'AssetBible, Medium & Director Notes updated.',
                  state: stateManager.getState()
                },
                null,
                2
              )
            }
          ]
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
