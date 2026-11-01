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
            'Step 1: Initializes brand brief and creates a new isolated session. Sets stage to CORE_THEME. Scans for anti-jargon compliance. Requires company, product, and goal.',
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
          name: 'branch_scene',
          description:
            'Step 2: Commits a narrative choice (1, 2, or 3) or regenerates (R). Enforces physical continuity lock (exit_frame_anchor) and anti-jargon gate.',
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
                description: 'Scene number being locked (1 to 4)'
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
                description: 'Detailed screenplay action'
              },
              exit_frame_anchor: {
                type: 'string',
                description:
                  'MANDATORY: Exact physical state, character posture, and location at final millisecond of this scene'
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
            'Step 3: Locks visual assets (characters, environments, and product). Enforces CHAR_01..N, BG_01..N, and PROD_01 IDs.',
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
          name: 'compile_shots',
          description:
            'Step 4: Compiles reference-tagged kinetic video prompts (@CHAR_01, @BG_01, @PROD_01) and cut guides. Launches Studio UI at http://localhost:4321.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID (defaults to latest active)'
              },
              shots: {
                type: 'array',
                description: 'Array of scene shots to compile with cameraSpec and attachedAssetRefs'
              },
              openStudioUi: {
                type: 'boolean',
                description: 'Whether to open the local Studio UI in browser (default: true)'
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
          `### BRAND BRIEF: ${session.company.toUpperCase()}\n` +
          `* **Product:** ${session.product}\n` +
          `* **Goal:** ${session.goal}\n` +
          `* **Storytelling Framework:** ${preset.name}\n` +
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
            languageRule: preset.dialogueLanguageRule,
            optionsRule: 'Show ONLY Option 1, Option 2, and Option 3. Do NOT create unapproved options or extra variants.',
            endingRule: "End your response STRICTLY with: 'Reply 1, 2, 3, or R (regenerate).'",
            antiJargonRule:
              'VIOLATION: Do not include technical camera specs during narrative branching. Rewrite options focusing purely on emotion, cultural tropes, and storytelling.',
            workflowRule: "STOP and wait for user selection. NEVER proceed past CORE_THEME without calling 'branch_scene'."
          }
        };

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

