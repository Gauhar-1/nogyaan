import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
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

// ============================================================================
// Explicit Zod Schemas Enforcing session_id as REQUIRED for All MCP Tools
// ============================================================================

export const listPresetsSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Unique project session ID')
});

export const initBriefSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Unique project session ID (e.g. "runway-l12q")'),
  company: z.string().min(1, 'Company name is required').describe('Company or brand name'),
  product: z.string().min(1, 'Product is required').describe('Product or service being advertised'),
  goal: z.string().min(1, 'Goal is required').describe('Campaign conversion or emotional objective'),
  preset: z.string().optional().describe('Narrative preset to apply'),
  preset_id: z.string().optional().describe('Alias for preset argument'),
  brandFriction: z.string().optional().describe('Human or cultural friction this brand resolves'),
  audience: z.string().optional().describe('Target demographic or cultural segment'),
  initialOptions: z.array(z.any()).optional().describe('Initial narrative options 1, 2, 3 for CORE_THEME')
});

export const lockCoreThemeSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID'),
  chosen_theme_id: z.enum(['1', '2', '3']).describe('Chosen core theme route ("1", "2", or "3")'),
  theme_title: z.string().min(1, 'theme_title is required').describe('Short descriptive title of the selected theme'),
  theme_premise: z.string().min(1, 'theme_premise is required').describe('Full narrative premise and emotional core'),
  nextOptions: z.array(z.any()).optional().describe('Proposed 3 opening visual scenarios for Scene 1')
});

export const branchSceneSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID'),
  action: z.enum(['commit', 'regenerate']).describe('"commit" to lock an option, "regenerate" (R) to overwrite options'),
  scene_number: z.number().optional().describe('Physical scene number being locked (1 to 4)'),
  chosen_option_id: z.enum(['1', '2', '3']).optional().describe('Selected option identifier'),
  selectedOptionId: z.enum(['1', '2', '3']).optional().describe('Alias for chosen_option_id'),
  chosen_narrative_summary: z.string().optional().describe('Full narrative beat summary for the locked scene'),
  title: z.string().optional().describe('Title for the scene'),
  description: z.string().optional().describe('Scene description'),
  treatmentProse: z.string().optional().describe('Screenplay treatment action'),
  exit_frame_anchor: z.string().optional().describe('Exact physical posture and position at scene exit'),
  nextOptions: z.array(z.any()).optional().describe('Branching options for next scene or regenerated current scene'),
  pruning_confirmation: z.array(z.string()).optional().describe('Confirmation IDs of rejected branches pruned')
});

export const lockAssetsSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID'),
  characters: z.union([z.array(z.any()), z.record(z.any())]).optional().describe('Character assets (array or dictionary)'),
  environments: z.union([z.array(z.any()), z.record(z.any())]).optional().describe('Environment assets (array or dictionary)'),
  backgrounds: z.union([z.array(z.any()), z.record(z.any())]).optional().describe('Alias for environments (array or dictionary)'),
  product: z.any().optional().describe('Hero product definition (object or array)'),
  products: z.any().optional().describe('Alias for product')
}).passthrough();

export const extractActiveAssetsSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID'),
  scene_id: z.string().optional().describe('Optional target scene ID'),
  company_name: z.string().optional().describe('Optional company / brand name to avoid extracting as character'),
  product_goal: z.string().optional().describe('Optional campaign product goal'),
  assets: z.any().optional().describe('Directly extracted assets (characters, environments/backgrounds, product)'),
  extraction: z.any().optional().describe('Alias for assets'),
  scene_tagging: z.any().optional().describe('Optional scene-to-asset tagging')
}).passthrough();

export const updateSceneTagsSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID'),
  scene_id: z.string().min(1, 'scene_id is required').describe('Target scene ID (e.g. "SCENE_01")'),
  active_refs: z.array(z.string()).optional().describe('Full replacement active asset references for this scene'),
  tags: z.array(z.string()).optional().describe('Alias for active_refs'),
  add_characters: z.union([z.array(z.string()), z.string()]).optional().describe('Character(s) to add to scene (e.g. ["CHAR_01"] or "@CHAR_01")'),
  remove_characters: z.union([z.array(z.string()), z.string()]).optional().describe('Character(s) to remove from scene'),
  add_tags: z.union([z.array(z.string()), z.string()]).optional().describe('Asset tag(s) to add to scene (e.g. ["@BG_02"])'),
  remove_tags: z.union([z.array(z.string()), z.string()]).optional().describe('Asset tag(s) to remove from scene')
}).passthrough();

export const pitchScriptOptionsSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID'),
  scene_id: z.string().min(1, 'scene_id is required').describe('Scene ID to pitch script options for (e.g. "SCENE_01")'),
  user_guidance: z.string().optional().describe('Optional directorial steering or thematic guidance'),
  options: z.array(z.any()).optional().describe('Dynamic script pitch options generated by LLM'),
  pitches: z.array(z.any()).optional().describe('Alias for options')
}).passthrough();

export const lockScriptOptionSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID'),
  scene_id: z.string().min(1, 'scene_id is required').describe('Target scene ID (e.g. "SCENE_01")'),
  script: z.any().optional().describe('The chosen ScriptPitch or ScriptOption object'),
  pitch: z.any().optional().describe('Alias for script parameter'),
  option_id: z.string().optional().describe('Optional option_id if selecting from pitched options'),
  id: z.string().optional().describe('Alias for option_id'),
  style: z.string().optional().describe('Custom style/tone name (e.g. "Deadpan", "Heartfelt")'),
  txt: z.string().optional().describe('Script text or narrative block'),
  narrative_block: z.string().optional().describe('Script narrative block')
}).passthrough();

export const pitchShotConceptsSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID'),
  scene_id: z.string().min(1, 'scene_id is required').describe('Scene ID (e.g. "SCENE_01")'),
  shot_id: z.string().optional().describe('Optional shot identifier (e.g. "SHOT_01")'),
  spatial_memory: z.array(z.string()).optional().describe('Optional rolling physical room geometry facts'),
  concepts: z.any().optional().describe('Dynamic shot concepts generated by LLM (options 1, 2, 3)'),
  options: z.any().optional().describe('Alias for concepts')
}).passthrough();

export const compileSotaPromptSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID'),
  scene_id: z.string().min(1, 'scene_id is required').describe('Scene ID (e.g. "SCENE_01")'),
  selected_option: z.string().min(1, 'selected_option is required').describe('The selected shot option ("1", "2", "3") or visual intent text'),
  option: z.string().optional().describe('Alias for selected_option'),
  shot_id: z.string().optional().describe('Optional shot identifier (e.g. "SHOT_01")'),
  spatial_memory: z.array(z.string()).optional().describe('Optional rolling physical room geometry facts'),
  last_shot_egress: z.string().optional().describe('Optional egress of preceding shot'),
  sota_payload: z.string().optional().describe('Direct dynamic SOTA prompt payload generated by LLM'),
  visual_intent: z.string().optional().describe('Direct dynamic visual intent text generated by LLM'),
  egress: z.string().optional().describe('Direct egress terminating clause'),
  spatial_facts: z.array(z.string()).optional().describe('Direct physical spatial facts established in this shot'),
  is_final_scene: z.boolean().optional(),
  is_final_shot: z.boolean().optional(),
  final_shot: z.boolean().optional()
}).passthrough();

export const pitchShotOptionsSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID'),
  scene_id: z.string().min(1, 'scene_id is required').describe('Scene ID (e.g. "SCENE_01")'),
  shot_id: z.string().optional().describe('Shot identifier (e.g. "SHOT_01")'),
  options: z.array(z.any()).optional().describe('Dynamic shot pitches generated by LLM'),
  pitches: z.array(z.any()).optional().describe('Alias for options')
}).passthrough();

export const lockShotOptionSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID'),
  scene_id: z.string().min(1, 'scene_id is required').describe('Scene ID'),
  shot_id: z.string().min(1, 'shot_id is required').describe('Shot identifier (e.g. "SHOT_01")'),
  shot: z.any().optional().describe('The chosen ShotPitch or ShotOption object'),
  pitch: z.any().optional().describe('Alias for shot parameter'),
  spatial_facts: z.array(z.string()).optional().describe('Physical facts established in this shot'),
  spatial_memory_updates: z.array(z.string()).optional().describe('Alias for spatial_facts'),
  is_final_scene: z.boolean().optional(),
  is_final_shot: z.boolean().optional(),
  final_shot: z.boolean().optional()
}).passthrough();

export const setDirectorNotesSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID'),
  notes: z.string().min(1, 'notes is required').describe('Directorial notes and persistent cinematic rules')
}).passthrough();

export const rerollNodeSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID'),
  node_id: z.string().optional().describe('Target node identifier'),
  scene_id: z.string().optional().describe('Scene identifier'),
  shot_id: z.string().optional().describe('Shot identifier'),
  new_visual_intent: z.string().optional().describe('Explicit replacement visual intent for destructive overwrite'),
  new_sota_payload: z.string().optional().describe('Explicit replacement SOTA prompt payload for destructive overwrite'),
  user_feedback: z.string().optional().describe('Targeted directorial refinement feedback'),
  direction: z.string().optional().describe('Alternative parameter for user direction'),
  notes: z.string().optional().describe('Alternative parameter for user notes'),
  sota_payload: z.string().optional().describe('Direct rewritten SOTA payload'),
  visual_intent: z.string().optional().describe('Direct rewritten visual intent'),
  txt: z.string().optional().describe('Direct rewritten script text'),
  prmpt: z.string().optional().describe('Direct rewritten prompt'),
  style: z.string().optional().describe('Direct rewritten style')
}).passthrough();

export const rerollShotSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID'),
  scene_id: z.string().optional().describe('Scene identifier (e.g., "SCENE_01")'),
  shot_id: z.string().optional().describe('Shot identifier (e.g., "SHOT_01")'),
  node_id: z.string().optional().describe('Composite node identifier (e.g. "SCENE_01:SHOT_01")'),
  new_visual_intent: z.string().optional().describe('Explicit replacement visual intent for destructive overwrite'),
  new_sota_payload: z.string().optional().describe('Explicit replacement SOTA prompt payload for destructive overwrite'),
  user_feedback: z.string().optional().describe('Directorial refinement feedback'),
  direction: z.string().optional().describe('Alternative parameter for user direction'),
  notes: z.string().optional().describe('Alternative parameter for user notes'),
  sota_payload: z.string().optional().describe('Direct rewritten SOTA payload'),
  visual_intent: z.string().optional().describe('Direct rewritten visual intent'),
  txt: z.string().optional().describe('Direct rewritten script text'),
  prmpt: z.string().optional().describe('Direct rewritten prompt'),
  style: z.string().optional().describe('Direct rewritten style')
}).passthrough();

export const getNogyaanStateSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID')
});

export const updateAssetBibleSchema = z.object({
  session_id: z.string().min(1, 'session_id is required').describe('Target session ID'),
  characters: z.record(z.string()).optional().describe('Map of character ID to description'),
  backgrounds: z.record(z.string()).optional().describe('Map of background ID to description'),
  product: z.string().optional().describe('Hero product description'),
  global_medium: z.enum(['Live-Action Cinematic', '2D Anime', '3D Pixar Style']).optional().describe('Global rendering medium'),
  global_director_notes: z.string().optional().describe('Persistent cinematic rules applying across all scenes')
});

// ============================================================================
// Tool Registration Implementation
// ============================================================================

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
  const presetIds = presetRegistry.getPresetIds();

  function getSessionStateManager(sessionId: string): StateManager {
    if (stateManagerInput && (stateManagerInput.getSessionId() === sessionId || stateManagerInput.getState().project_id === sessionId)) {
      return stateManagerInput;
    }
    return StateManager.forSession(sessionId, sessionService.getWorkspaceDir());
  }

  // Handler for listing tools with REQUIRED session_id in schema
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'list_presets',
          description:
            'Returns a list of all loaded narrative presets (e.g., indian-d2c-story, dev-product-launch, tiktok-ugc-hook) with their philosophy, lens palette, and strict dialogue language rules.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Unique project session ID'
              }
            },
            required: ['session_id']
          }
        },
        {
          name: 'init_brief',
          description:
            'Step 1: Initializes brand brief and creates a new isolated session strictly at .nogyaan/sessions/${session_id}.json. Sets stage to CORE_THEME. Scans for anti-jargon compliance. Requires session_id, company, product, and goal. Claude must then call lock_core_theme.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Unique project session ID (e.g. "runway-l12q")'
              },
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
            required: ['session_id', 'company', 'product', 'goal']
          }
        },
        {
          name: 'lock_core_theme',
          description:
            'Step 1.5: Locks the overarching Core Campaign Premise into isolated session state. Transitions stage from CORE_THEME to SCENE_1_SETUP.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
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
            required: ['session_id', 'chosen_theme_id', 'theme_title', 'theme_premise']
          }
        },
        {
          name: 'branch_scene',
          description:
            'Step 2: Commits physical Scene 1, 2, 3, or 4 with internal continuity bridges into isolated session state and prunes rejected options.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
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
            required: ['session_id', 'action']
          }
        },
        {
          name: 'lock_assets',
          description:
            'Step 3 / Upsert Assets: Locks or updates visual assets (characters, environments/backgrounds, and hero product) in the session state. Can be run multiple times to update descriptions. Accepts arrays or dictionaries with arbitrary keys.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
              },
              characters: {
                description: 'Array or dictionary of character definitions with arbitrary keys/descriptions'
              },
              environments: {
                description: 'Array or dictionary of background/location definitions with arbitrary keys/descriptions'
              },
              backgrounds: {
                description: 'Alias for environments'
              },
              product: {
                description: 'Hero product definition (object, string, or array)'
              }
            },
            required: ['session_id']
          }
        },
        {
          name: 'pitch_script_options',
          description:
            'Phase 1 Writer\'s Room: JIT context-sliced narrative branching for the session. Passes ONLY core premise and Scene N-1 locked narrative. Generates exactly 3 minified ScriptPitch options.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
              },
              scene_id: {
                type: 'string',
                description: 'Scene ID to pitch script options for (e.g. "SCENE_01")'
              },
              user_guidance: {
                type: 'string',
                description: 'Optional directorial steering or thematic guidance'
              }
            },
            required: ['session_id', 'scene_id']
          }
        },
        {
          name: 'lock_script_option',
          description:
            'Locks a chosen ScriptPitch or ScriptOption into the isolated session file for the specified scene.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
              },
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
            required: ['session_id', 'scene_id']
          }
        },
        {
          name: 'extract_active_assets',
          description:
            'Phase 2 Asset Locker: Analyzes locked 4-scene narrative for the session to identify required cast, backgrounds, and products, returning an AssetBible and tagging active_refs strictly in .nogyaan/sessions/${session_id}.json.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
              },
              company_name: {
                type: 'string',
                description: 'Optional company name to prevent extracting as a character'
              },
              product_goal: {
                type: 'string',
                description: 'Optional campaign product goal'
              }
            },
            required: ['session_id']
          }
        },
        {
          name: 'update_scene_tags',
          description:
            'Updates or modifies active asset references and characters for a specific scene (e.g. manually add/remove characters or replace active_refs).',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
              },
              scene_id: {
                type: 'string',
                description: 'Target scene ID (e.g. "SCENE_01")'
              },
              active_refs: {
                type: 'array',
                items: { type: 'string' },
                description: 'Full replacement active asset references for this scene'
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Alias for active_refs'
              },
              add_characters: {
                type: 'array',
                items: { type: 'string' },
                description: 'Character(s) to add to scene (e.g. ["CHAR_01"] or "@CHAR_01")'
              },
              remove_characters: {
                type: 'array',
                items: { type: 'string' },
                description: 'Character(s) to remove from scene'
              },
              add_tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Asset tag(s) to add to scene'
              },
              remove_tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Asset tag(s) to remove from scene'
              }
            },
            required: ['session_id', 'scene_id']
          }
        },
        {
          name: 'pitch_shot_concepts',
          description:
            'Tool A (DP Suite): Pitches exactly 3 human-readable visual intent concepts (1: Auteur, 2: Kinetic, 3: Theatrical) for a single shot without technical camera data or JSON bloat, then HALTS to yield to user keystroke selection.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
              },
              scene_id: {
                type: 'string',
                description: 'Scene ID (e.g. "SCENE_01")'
              },
              shot_id: {
                type: 'string',
                description: 'Optional shot identifier (e.g. "SHOT_01" or defaults to next shot in sequence)'
              },
              spatial_memory: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional rolling physical room geometry facts'
              }
            },
            required: ['session_id', 'scene_id']
          }
        },
        {
          name: 'compile_sota_prompt',
          description:
            'Tool B (DP Suite): Compiles the user\'s selected shot concept into a single, dense technical AI video diffusion payload and saves strictly to the isolated session JSON state.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
              },
              scene_id: {
                type: 'string',
                description: 'Scene ID (e.g. "SCENE_01")'
              },
              selected_option: {
                type: 'string',
                description: 'The selected shot option ("1", "2", "3", or visual intent description)'
              },
              shot_id: {
                type: 'string',
                description: 'Optional shot identifier (e.g. "SHOT_01")'
              },
              spatial_memory: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional rolling physical room geometry facts'
              },
              last_shot_egress: {
                type: 'string',
                description: 'Optional egress of preceding shot to establish temporal ingress handshake'
              }
            },
            required: ['session_id', 'scene_id', 'selected_option']
          }
        },
        {
          name: 'pitch_shot_options',
          description:
            'Phase 3 DP Suite: Strictly sequential shot-by-shot pitch for the session. Receives Scene X, Shot Y, pitches EXACTLY 3 options (Auteur, Kinetic, Theatrical) for that single shot, and completely HALTS execution to yield to the user.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
              },
              scene_id: {
                type: 'string',
                description: 'Scene ID (e.g. "SCENE_01")'
              },
              shot_id: {
                type: 'string',
                description: 'Shot identifier (e.g. "SHOT_01")'
              }
            },
            required: ['session_id', 'scene_id', 'shot_id']
          }
        },
        {
          name: 'lock_shot_option',
          description:
            'Locks a chosen ShotPitch or ShotOption strictly into the isolated session file for the specified scene and shot.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
              },
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
            required: ['session_id', 'scene_id', 'shot_id', 'shot']
          }
        },
        {
          name: 'set_director_notes',
          description:
            'Sets persistent cinematic rules or directorial constraints in the session state applying across all scenes.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
              },
              notes: {
                type: 'string',
                description: 'Directorial notes and persistent cinematic rules'
              }
            },
            required: ['session_id', 'notes']
          }
        },
        {
          name: 'reroll_node',
          description:
            'Targeted Re-Roll: Modifies ONLY an isolated node (scene or shot ID) in the session state. Completely replaces the target node using new_visual_intent / new_sota_payload for destructive overwrite, or rewrites from scratch naturally. Never appends bracketed notes.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
              },
              node_id: {
                type: 'string',
                description: 'Target node identifier (scene_id like "SCENE_01", shot_id like "SHOT_01", or "SCENE_01:SHOT_01")'
              },
              new_visual_intent: {
                type: 'string',
                description: 'Explicit replacement visual intent string for destructive overwrite'
              },
              new_sota_payload: {
                type: 'string',
                description: 'Explicit replacement SOTA prompt payload for destructive overwrite'
              },
              user_feedback: {
                type: 'string',
                description: 'Targeted directorial refinement feedback'
              }
            },
            required: ['session_id']
          }
        },
        {
          name: 'reroll_shot',
          description:
            'Targeted Shot Re-Roll: Destructively overwrites a shot using new_visual_intent and new_sota_payload, or completely rewrites visual_intent and sota_payload from scratch to naturally weave in user instructions. Never appends bracketed notes.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
              },
              scene_id: {
                type: 'string',
                description: 'Scene identifier (e.g., "SCENE_01")'
              },
              shot_id: {
                type: 'string',
                description: 'Shot identifier (e.g., "SHOT_01")'
              },
              node_id: {
                type: 'string',
                description: 'Composite node identifier (e.g. "SCENE_01:SHOT_01")'
              },
              new_visual_intent: {
                type: 'string',
                description: 'Explicit replacement visual intent string for destructive overwrite'
              },
              new_sota_payload: {
                type: 'string',
                description: 'Explicit replacement SOTA prompt payload for destructive overwrite'
              },
              user_feedback: {
                type: 'string',
                description: 'Directorial refinement feedback for completely rewriting the shot'
              },
              direction: {
                type: 'string',
                description: 'Alternative parameter for user direction'
              }
            },
            required: ['session_id']
          }
        },
        {
          name: 'get_nogyaan_state',
          description:
            'Returns the full current state machine for the specified session strictly loaded from .nogyaan/sessions/${session_id}.json.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
              }
            },
            required: ['session_id']
          }
        },
        {
          name: 'update_asset_bible',
          description:
            'Updates characters, backgrounds, hero product, and global_medium in the isolated session state.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Target session ID'
              },
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
                description: 'Persistent cinematic rules applying across all scenes'
              }
            },
            required: ['session_id']
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

      // Strict session_id validation on all workflow tools
      const rawSessionId = input.session_id;
      if (!rawSessionId || typeof rawSessionId !== 'string' || !rawSessionId.trim()) {
        throw new Error(`session_id is required for tool "${name}".`);
      }
      const sessionId = rawSessionId.trim();

      // Unless initializing a brand-new session, verify the session file exists
      if (name !== 'init_brief') {
        const isInjectedTestSession = Boolean(
          stateManagerInput &&
          (stateManagerInput.getSessionId() === sessionId || stateManagerInput.getState().project_id === sessionId)
        );
        if (!isInjectedTestSession) {
          const sessionPath = path.resolve(sessionService.getSessionsDir(), `${sessionId}.json`);
          if (!fs.existsSync(sessionPath)) {
            throw new Error(
              `Session not found: "${sessionId}". Expected file at ${sessionPath}. Run init_brief first.`
            );
          }
        }
      }

      const currentSm = getSessionStateManager(sessionId);

      if (name === 'init_brief') {
        const validated = initBriefSchema.parse(input);
        const presetId = validated.preset || validated.preset_id || 'indian-d2c-story';
        const preset = presetRegistry.getPresetById(presetId);
        if (!preset) {
          throw new Error(
            `Unknown preset "${presetId}". Available presets: ${presetIds.join(', ')}`
          );
        }

        const session = sessionService.createSession({
          sessionId,
          company: validated.company,
          product: validated.product,
          goal: validated.goal,
          presetId,
          brandFriction: validated.brandFriction,
          options: validated.initialOptions
        });

        // Initialize state manager state for this session
        currentSm.initProject({
          project_id: session.sessionId,
          core_premise: `${session.company} - ${session.product}: ${session.goal}`
        });

        const lockedBrief =
          `### [🎬 nogyaan] BRAND BRIEF: ${session.company.toUpperCase()}\n` +
          `* **Product:** ${session.product}\n` +
          `* **Goal:** ${session.goal}\n` +
          `* **Storytelling Cartridge:** ${preset.name} (${preset.id})\n` +
          `* **Language Rule:** ${preset.dialogueLanguageRule}\n` +
          `* **Session ID:** ${session.sessionId}`;

        const systemMsg =
          '[SYSTEM: Brief initialized. Propose 3 distinct Core Campaign Premise options. Ask the user to reply ONLY with "1", "2", or "3" (or "R" to regenerate). Keep your response under 2 sentences.]';

        const result = {
          success: true,
          message: `Brand brief locked into isolated session ${session.sessionId}. State initialized to CORE_THEME.`,
          sessionId: session.sessionId,
          currentStage: session.stage,
          workspaceDir: sessionService.getWorkspaceDir(),
          storagePath: `${sessionService.getSessionsDir()}/${session.sessionId}.json`,
          lockedBrief,
          preset,
          system_instruction: systemMsg,
          _systemDirective: {
            instruction: systemMsg,
            languageRule: preset.dialogueLanguageRule,
            endingRule: "End your response STRICTLY with: 'Reply 1, 2, 3, or R (regenerate).'"
          }
        };

        return {
          content: [
            {
              type: 'text',
              text: `${systemMsg}\n\n${JSON.stringify(result, null, 2)}`
            }
          ]
        };
      }

      if (name === 'lock_core_theme') {
        const validated = lockCoreThemeSchema.parse(input);
        const result = sessionService.lockCoreTheme({
          sessionId,
          chosenThemeId: validated.chosen_theme_id,
          themeTitle: validated.theme_title,
          themePremise: validated.theme_premise,
          nextOptions: validated.nextOptions
        });

        currentSm.setCorePremise(validated.theme_premise);

        const systemMsg =
          '[SYSTEM: Core theme locked. Propose 3 opening scenarios for Scene 1. Ask the user to reply ONLY with "1", "2", or "3" (or "R" to regenerate). Keep your response under 2 sentences.]';

        return {
          content: [
            {
              type: 'text',
              text: `${systemMsg}\n\n${JSON.stringify({ ...result, system_instruction: systemMsg }, null, 2)}`
            }
          ]
        };
      }

      if (name === 'branch_scene') {
        const validated = branchSceneSchema.parse(input);
        const activeSession = sessionService.loadSession(sessionId);
        const preset = activeSession ? presetRegistry.getPresetById(activeSession.presetId) : undefined;
        const languageRule = preset?.dialogueLanguageRule || 'Strictly adhere to preset language rules.';

        const chosenOptionId = validated.chosen_option_id || validated.selectedOptionId;
        const chosenNarrativeSummary =
          validated.chosen_narrative_summary ||
          validated.treatmentProse ||
          validated.description ||
          validated.title;

        const branchResult = sessionService.branchScene({
          sessionId,
          action: validated.action,
          sceneNumber: validated.scene_number,
          chosenOptionId,
          chosenNarrativeSummary,
          title: validated.title,
          description: validated.description,
          treatmentProse: validated.treatmentProse,
          exitFrameAnchor: validated.exit_frame_anchor,
          nextOptions: validated.nextOptions,
          pruningConfirmation: validated.pruning_confirmation,
          presetLanguageRule: languageRule
        });

        // Mirror committed scene into session state manager
        if (validated.action === 'commit' && chosenNarrativeSummary) {
          const scNum = validated.scene_number || branchResult.session.lockedNodes.length;
          const sceneId = `SCENE_0${scNum}`;
          currentSm.lockScript(sceneId, {
            id: chosenOptionId || '1',
            style: 'Heartfelt',
            txt: chosenNarrativeSummary
          });
        }

        const isComplete = branchResult.session.stage === 'LOCK_ASSETS';
        const dynamicStudioUrl = `http://localhost:4321/?session=${encodeURIComponent(sessionId)}`;
        const systemMsg = isComplete
          ? `[SYSTEM: Scene 4 Climax locked. Call "extract_active_assets" to extract visual assets and tag scenes. Tell the user to type "N" to begin shot visual concepts. View live treatment at ${dynamicStudioUrl}. Keep your response under 2 sentences.]`
          : `[SYSTEM: Scene ${validated.scene_number || 1} locked. Propose 3 options for the next beat. Ask the user to reply ONLY with "1", "2", or "3" (or "R" to regenerate). Keep your response under 2 sentences.]`;

        const outputData = {
          success: true,
          sessionId: branchResult.session.sessionId,
          studio_url: dynamicStudioUrl,
          currentStage: branchResult.session.stage,
          prunedCount: branchResult.session.prunedCount,
          isNarrativeComplete: isComplete,
          lockedNodes: branchResult.session.lockedNodes,
          continuityBridge: branchResult.continuityBridge,
          dialogueLanguageRule: languageRule,
          system_instruction: systemMsg,
          _systemDirective: {
            ...branchResult.directive,
            studio_url: dynamicStudioUrl
          }
        };

        let formattedText = JSON.stringify(outputData, null, 2);
        if (branchResult.continuityBridge) {
          formattedText = `${branchResult.continuityBridge}\n\n${formattedText}`;
        }

        return {
          content: [{ type: 'text', text: `${systemMsg}\n\n${formattedText}` }]
        };
      }

      if (name === 'lock_assets') {
        const validated = lockAssetsSchema.parse(input);
        const activeSession = sessionService.loadSession(sessionId);
        const preset = activeSession ? presetRegistry.getPresetById(activeSession.presetId) : undefined;
        const languageRule = preset?.dialogueLanguageRule || 'Strictly adhere to preset language rules.';

        const chars = validated.characters || (validated as any).assets?.characters || [];
        const envs = validated.environments || (validated as any).backgrounds || (validated as any).assets?.environments || (validated as any).assets?.backgrounds || [];
        const prod = validated.product || (validated as any).products || (validated as any).assets?.product || (validated as any).assets?.products;

        const result = sessionService.lockAssets({
          sessionId,
          characters: chars,
          environments: envs,
          product: prod,
          presetLanguageRule: languageRule
        });

        // Sync into session state manager
        const charMap: Record<string, string> = {};
        if (Array.isArray(chars)) {
          for (const c of chars) {
            charMap[c.id || c.assetId] = c.appearancePrompt || c.description || c.name || '';
          }
        } else if (typeof chars === 'object' && chars !== null) {
          for (const [k, v] of Object.entries(chars)) {
            charMap[k] = typeof v === 'string' ? v : (v as any).appearancePrompt || (v as any).description || (v as any).name || '';
          }
        }

        const bgMap: Record<string, string> = {};
        if (Array.isArray(envs)) {
          for (const b of envs) {
            bgMap[b.id || b.assetId] = b.environmentPrompt || b.description || b.name || '';
          }
        } else if (typeof envs === 'object' && envs !== null) {
          for (const [k, v] of Object.entries(envs)) {
            bgMap[k] = typeof v === 'string' ? v : (v as any).environmentPrompt || (v as any).description || (v as any).name || '';
          }
        }

        let prodDesc = '';
        if (typeof prod === 'string') {
          prodDesc = prod;
        } else if (prod) {
          prodDesc = prod.packagingAppearance || prod.description || prod.productPrompt || prod.name || '';
        }

        currentSm.updateAssetBible({
          characters: charMap,
          backgrounds: bgMap,
          product: prodDesc
        });

        const systemMsg =
          '[SYSTEM: Assets locked. Call "pitch_shot_concepts" for Scene 1 Shot 1. Ask the user to type "N" to begin shot visual concepts. Keep your response under 2 sentences.]';

        const outputData = {
          success: true,
          sessionId: result.session.sessionId,
          currentStage: result.session.stage,
          lockedAssets: result.session.assets,
          dialogueLanguageRule: languageRule,
          system_instruction: systemMsg,
          _systemDirective: result.directive
        };

        return {
          content: [{ type: 'text', text: `${systemMsg}\n\n${JSON.stringify(outputData, null, 2)}` }]
        };
      }

      if (name === 'pitch_script_options') {
        const validated = pitchScriptOptionsSchema.parse(input);
        const wr = new WritersRoomService(currentSm);
        const options = await wr.pitchScriptOptions({
          scene_id: validated.scene_id,
          user_guidance: validated.user_guidance,
          options: (validated as any).options || (validated as any).pitches
        });

        const systemMsg =
          `[SYSTEM: Script pitched for ${validated.scene_id}. Ask the user to reply ONLY with "1", "2", or "3" to select their script (or "R" to regenerate). Keep your response under 2 sentences.]`;

        return {
          content: [
            {
              type: 'text',
              text: `${systemMsg}\n\n${JSON.stringify(
                {
                  success: true,
                  scene_id: validated.scene_id,
                  pitches: options,
                  system_instruction: systemMsg,
                  _systemDirective: {
                    instruction: systemMsg,
                    endingRule: "End response with: 'Select Option 1, 2, or 3 (or R to regenerate).'"
                  }
                },
                null,
                2
              )}`
            }
          ]
        };
      }

      if (name === 'lock_script_option') {
        const validated = lockScriptOptionSchema.parse(input);
        let scriptToLock = validated.script || validated.pitch;
        if (!scriptToLock && ((validated as any).txt || (validated as any).narrative_block)) {
          scriptToLock = {
            id: validated.option_id || validated.id || 'A',
            style: (validated as any).style || 'Heartfelt',
            txt: (validated as any).txt || (validated as any).narrative_block
          };
        }
        if (!scriptToLock && (validated.option_id || validated.id)) {
          const searchId = validated.option_id || validated.id;
          const existingScene = currentSm.getScene(validated.scene_id);
          const lScript: any = existingScene?.locked_script;
          if (existingScene && lScript && (lScript.option_id === searchId || lScript.id === searchId)) {
            scriptToLock = existingScene.locked_script;
          }
        }
        if (!scriptToLock) {
          throw new Error('Script object is required to lock script option.');
        }
        const updatedState = currentSm.lockScript(validated.scene_id, scriptToLock);

        const allLocked = updatedState.scenes.length >= 4 && updatedState.scenes.every((s) => s.locked_script);
        const systemMsg = allLocked
          ? '[SYSTEM: All 4 scenes locked! Call "extract_active_assets" to tag scene-level assets. Tell user to type "N" to proceed. Keep your response under 2 sentences.]'
          : `[SYSTEM: Script option locked for ${validated.scene_id}. Ask the user to type "N" for Next Scene or "S" to review the treatment. Keep your response under 2 sentences.]`;

        return {
          content: [
            {
              type: 'text',
              text: `${systemMsg}\n\n${JSON.stringify(
                {
                  success: true,
                  message: `Script option locked for ${validated.scene_id}.`,
                  scene_id: validated.scene_id,
                  locked_script: scriptToLock,
                  state: updatedState,
                  system_instruction: systemMsg,
                  _systemDirective: {
                    instruction: systemMsg
                  }
                },
                null,
                2
              )}`
            }
          ]
        };
      }

      if (name === 'extract_active_assets') {
        const validated = extractActiveAssetsSchema.parse(input);
        const al = new AssetLockerService(currentSm);
        const result = await al.extractActiveAssets({
          scene_id: (validated as any).scene_id,
          company_name: (validated as any).company_name,
          product_goal: (validated as any).product_goal,
          assets: (validated as any).assets || (validated as any).extraction,
          extraction: (validated as any).extraction,
          scene_tagging: (validated as any).scene_tagging
        });
        const systemMsg =
          '[SYSTEM: Assets locked and tagged across all scenes. Call "pitch_shot_concepts" for Scene 1 Shot 1. Ask the user to type "N" to begin shot visual concepts. Keep your response under 2 sentences.]';

        return {
          content: [
            {
              type: 'text',
              text: `${systemMsg}\n\n${JSON.stringify(
                {
                  success: true,
                  message: 'Asset Bible extracted and active_refs tagged for all scenes.',
                  extraction: result.extraction,
                  state: result.state,
                  system_instruction: systemMsg,
                  _systemDirective: {
                    instruction: systemMsg
                  }
                },
                null,
                2
              )}`
            }
          ]
        };
      }

      if (name === 'update_scene_tags') {
        const validated = updateSceneTagsSchema.parse(input);
        const toArray = (val: any) => {
          if (!val) return undefined;
          return Array.isArray(val) ? val : [val];
        };

        const updatedState = currentSm.updateSceneTags(validated.scene_id, {
          tags: validated.tags,
          active_refs: validated.active_refs,
          add_tags: toArray(validated.add_tags),
          remove_tags: toArray(validated.remove_tags),
          add_characters: toArray(validated.add_characters),
          remove_characters: toArray(validated.remove_characters)
        });

        const targetScene = updatedState.scenes.find(
          (s) => s.scene_id.toLowerCase() === validated.scene_id.toLowerCase()
        );
        const activeRefs = targetScene?.active_refs || [];

        const systemMsg = `[SYSTEM: Scene tags updated for ${validated.scene_id}. Active references: ${activeRefs.join(', ')}. Keep your response under 2 sentences.]`;

        return {
          content: [
            {
              type: 'text',
              text: `${systemMsg}\n\n${JSON.stringify(
                {
                  success: true,
                  scene_id: validated.scene_id,
                  active_refs: activeRefs,
                  message: `Scene ${validated.scene_id} tags updated. Active references: ${activeRefs.join(', ')}`,
                  state: updatedState,
                  system_instruction: systemMsg
                },
                null,
                2
              )}`
            }
          ]
        };
      }

      if (name === 'pitch_shot_concepts') {
        const validated = pitchShotConceptsSchema.parse(input);
        const dp = new DpPitchService(currentSm);
        const result = await dp.pitchShotConcepts({
          scene_id: validated.scene_id,
          shot_id: validated.shot_id,
          spatial_memory: validated.spatial_memory,
          concepts: (validated as any).concepts || (validated as any).options,
          options: (validated as any).options
        });

        const systemMsg =
          '[SYSTEM: Pitch successful. Ask the user to reply ONLY with "1", "2", or "3" to select their shot. If they want to move on, tell them to type "N" for Next Shot or "S" for Next Scene. Keep your response under 2 sentences.]';

        const outputData = {
          status: 'YIELD_TO_USER',
          action_required: 'USER_SELECTION',
          message: `Pitched 3 visual concepts for ${result.scene_id} ${result.shot_id}. Execution halted. Waiting for user to select 1, 2, or 3.`,
          scene_id: result.scene_id,
          shot_id: result.shot_id,
          concepts: result.concepts,
          spatial_memory: result.spatial_memory,
          last_shot_egress: result.last_shot_egress,
          system_instruction: systemMsg,
          _systemDirective: {
            directive: 'HARD_STOP_YIELD_TO_USER',
            instruction: systemMsg
          }
        };

        return {
          content: [
            {
              type: 'text',
              text: `${systemMsg}\n\n${JSON.stringify(outputData, null, 2)}`
            }
          ]
        };
      }

      if (name === 'compile_sota_prompt') {
        const validated = compileSotaPromptSchema.parse(input);
        const dp = new DpPitchService(currentSm);
        const result = await dp.compileSotaPrompt({
          scene_id: validated.scene_id,
          shot_id: validated.shot_id,
          selected_option: validated.selected_option || validated.option || '1',
          spatial_memory: validated.spatial_memory,
          last_shot_egress: validated.last_shot_egress,
          sota_payload: (validated as any).sota_payload,
          visual_intent: (validated as any).visual_intent,
          egress: (validated as any).egress,
          spatial_facts: (validated as any).spatial_facts
        });

        const currentState = currentSm.getState();
        const scenes = currentState.scenes || [];
        const resolvedSceneId = result.scene_id || validated.scene_id;
        const resolvedShotId = result.shot_id || validated.shot_id || 'SHOT_01';
        const currentScene = scenes.find((s) => s.scene_id.toLowerCase() === resolvedSceneId.toLowerCase());
        const shotCount = currentScene ? Object.keys(currentScene.shots || {}).length : 0;

        const isScene4 =
          /scene[_-]?0?4\b/i.test(resolvedSceneId) ||
          resolvedSceneId.toLowerCase().includes('climax') ||
          resolvedSceneId.toLowerCase().includes('scene_4');
        const isLastScene =
          scenes.length > 0 &&
          (scenes[scenes.length - 1].scene_id.toLowerCase() === resolvedSceneId.toLowerCase() ||
            scenes.findIndex((s) => s.scene_id.toLowerCase() === resolvedSceneId.toLowerCase()) === scenes.length - 1);
        const isFinalScene = isScene4 || (scenes.length >= 4 && isLastScene) || validated.is_final_scene === true;

        const isShot3OrHigher =
          /shot[_-]?0?[3-9]\b/i.test(resolvedShotId) ||
          resolvedShotId.toLowerCase().includes('shot_3') ||
          resolvedShotId.toLowerCase().includes('shot_03') ||
          resolvedShotId.toLowerCase().includes('final');
        const isFinalShot =
          isShot3OrHigher ||
          shotCount >= 3 ||
          validated.is_final_shot === true ||
          validated.final_shot === true;

        const isWorkflowComplete = (isFinalScene && isFinalShot) || result.workflow_complete === true;
        const dynamicStudioUrl = `http://localhost:4321/?session=${encodeURIComponent(sessionId)}`;

        const normalSystemMsg =
          '[SYSTEM: Prompt compiled and saved. Ask the user to type "N" for Next Shot or "S" for Next Scene. If they want to refine, tell them to type "R" with their notes. Keep your response under 2 sentences.]';

        const completionSystemMsg =
          `[SYSTEM: This was the final shot of the storyboard. The workflow is complete. You MUST explicitly congratulate the user and tell them: "Your Director's Treatment is complete! Open ${dynamicStudioUrl} in your browser to view the final monochrome storyboard, copy your SOTA payloads for Kling/Runway, and Export your Blueprint to PDF." Do not ask for further prompts.]`;

        const systemMsg = isWorkflowComplete ? completionSystemMsg : normalSystemMsg;

        const outputData = {
          success: true,
          message: isWorkflowComplete
            ? `Final SOTA AI prompt compiled and saved for ${result.scene_id} -> ${result.shot_id}. Storyboard workflow complete!`
            : `SOTA AI prompt compiled and saved for ${result.scene_id} -> ${result.shot_id}. Temporal egress updated.`,
          workflow_complete: isWorkflowComplete,
          studio_url: dynamicStudioUrl,
          scene_id: result.scene_id,
          shot_id: result.shot_id,
          shot: result.shot,
          last_shot_egress: result.last_shot_egress,
          spatial_memory: result.spatial_memory,
          system_instruction: systemMsg,
          _systemDirective: {
            instruction: systemMsg,
            workflow_complete: isWorkflowComplete,
            studio_url: dynamicStudioUrl
          }
        };

        return {
          content: [
            {
              type: 'text',
              text: `${systemMsg}\n\n${JSON.stringify(outputData, null, 2)}`
            }
          ]
        };
      }

      if (name === 'pitch_shot_options') {
        const validated = pitchShotOptionsSchema.parse(input);
        const dp = new DpPitchService(currentSm);
        const options = await dp.pitchShotOptions({
          scene_id: validated.scene_id,
          shot_id: validated.shot_id,
          options: (validated as any).options || (validated as any).pitches,
          pitches: (validated as any).pitches
        });

        const systemMsg =
          '[SYSTEM: Pitch successful. Ask the user to reply ONLY with "1", "2", or "3" to select their shot. If they want to move on, tell them to type "N" for Next Shot or "S" for Next Scene. Keep your response under 2 sentences.]';

        return {
          content: [
            {
              type: 'text',
              text: `${systemMsg}\n\n${JSON.stringify(
                {
                  status: 'YIELD_TO_USER',
                  action_required: 'USER_SELECTION',
                  message: `Pitched 3 options for ${validated.scene_id} ${validated.shot_id || 'SHOT_01'}. Execution halted. Waiting for user to select 1 option before proceeding.`,
                  scene_id: validated.scene_id,
                  shot_id: validated.shot_id || 'SHOT_01',
                  pitches: options,
                  options: options,
                  system_instruction: systemMsg,
                  _systemDirective: {
                    directive: 'HARD_STOP_YIELD_TO_USER',
                    instruction:
                      'CRITICAL: You are an interactive DP. You must only pitch 3 options for the CURRENT single shot. Do NOT generate the next shot. Do NOT generate a prompt for the whole scene. Output the 3 options as JSON, then STOP and wait for the user\'s selection. Do not attempt to complete the storyboard.',
                    workflow: systemMsg,
                    endingRule: 'Select Treatment 1, 2, or 3 or request targeted camera adjustments before moving to the next shot.'
                  }
                },
                null,
                2
              )}`
            }
          ]
        };
      }

      if (name === 'lock_shot_option') {
        const validated = lockShotOptionSchema.parse(input);
        const shotToLock = validated.shot || validated.pitch;
        if (!shotToLock) {
          throw new Error('Shot object is required to lock shot option.');
        }
        const spatialFacts = validated.spatial_facts || validated.spatial_memory_updates;
        const updatedState = currentSm.lockShot(
          validated.scene_id,
          validated.shot_id,
          shotToLock,
          spatialFacts
        );

        const currentState = currentSm.getState();
        const scenes = currentState.scenes || [];
        const currentScene = scenes.find((s) => s.scene_id.toLowerCase() === validated.scene_id.toLowerCase());
        const shotCount = currentScene ? Object.keys(currentScene.shots || {}).length : 0;

        const isScene4 =
          /scene[_-]?0?4\b/i.test(validated.scene_id) ||
          validated.scene_id.toLowerCase().includes('climax') ||
          validated.scene_id.toLowerCase().includes('scene_4');
        const isLastScene =
          scenes.length > 0 &&
          (validated.scene_id.toLowerCase() === scenes[scenes.length - 1].scene_id.toLowerCase() ||
            scenes.findIndex((s) => s.scene_id.toLowerCase() === validated.scene_id.toLowerCase()) === scenes.length - 1);
        const isFinalScene = isScene4 || (scenes.length >= 4 && isLastScene) || validated.is_final_scene === true;

        const isShot3OrHigher =
          /shot[_-]?0?[3-9]\b/i.test(validated.shot_id) ||
          validated.shot_id.toLowerCase().includes('shot_3') ||
          validated.shot_id.toLowerCase().includes('shot_03') ||
          validated.shot_id.toLowerCase().includes('final');
        const isFinalShot =
          isShot3OrHigher ||
          shotCount >= 3 ||
          validated.is_final_shot === true ||
          validated.final_shot === true;

        const isWorkflowComplete = isFinalScene && isFinalShot;

        const normalSystemMsg =
          '[SYSTEM: Prompt compiled and saved. Ask the user to type "N" for Next Shot or "S" for Next Scene. If they want to refine, tell them to type "R" with their notes. Keep your response under 2 sentences.]';

        const completionSystemMsg =
          '[SYSTEM: This was the final shot of the storyboard. The workflow is complete. You MUST explicitly congratulate the user and tell them: "Your Director\'s Treatment is complete! Open http://localhost:4321 in your browser to view the final monochrome storyboard, copy your SOTA payloads for Kling/Runway, and Export your Blueprint to PDF." Do not ask for further prompts.]';

        const systemMsg = isWorkflowComplete ? completionSystemMsg : normalSystemMsg;

        return {
          content: [
            {
              type: 'text',
              text: `${systemMsg}\n\n${JSON.stringify(
                {
                  success: true,
                  message: isWorkflowComplete
                    ? `Final shot option locked for ${validated.scene_id} -> ${validated.shot_id}. Storyboard workflow complete!`
                    : `Shot option locked for ${validated.scene_id} -> ${validated.shot_id}. Spatial memory silently updated.`,
                  workflow_complete: isWorkflowComplete,
                  studio_url: `http://localhost:4321/?session=${encodeURIComponent(sessionId)}`,
                  scene_id: validated.scene_id,
                  shot_id: validated.shot_id,
                  locked_shot: shotToLock,
                  spatial_memory: updatedState.scenes.find((s) => s.scene_id === validated.scene_id)?.spatial_memory || [],
                  last_shot_egress: updatedState.scenes.find((s) => s.scene_id === validated.scene_id)?.last_shot_egress || '',
                  system_instruction: systemMsg,
                  state: updatedState
                },
                null,
                2
              )}`
            }
          ]
        };
      }

      if (name === 'set_director_notes') {
        const validated = setDirectorNotesSchema.parse(input);
        const updatedState = currentSm.setGlobalDirectorNotes(validated.notes);
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

      if (name === 'reroll_node' || name === 'reroll_shot') {
        const validated = name === 'reroll_node' ? rerollNodeSchema.parse(input) : rerollShotSchema.parse(input);
        const targetNodeId =
          validated.node_id ||
          (validated.scene_id && validated.shot_id ? `${validated.scene_id}:${validated.shot_id}` : validated.shot_id || validated.scene_id);
        const feedback = validated.user_feedback || validated.direction || validated.notes || '';
        const explicitPayload = validated.new_sota_payload || (validated as any).sota_payload || (validated as any).prmpt;
        const explicitIntent = validated.new_visual_intent || (validated as any).visual_intent || (validated as any).txt;

        if (!targetNodeId) {
          throw new Error('Target node identifier (node_id or scene_id/shot_id) is required for re-roll.');
        }
        if (!feedback && !explicitPayload && !explicitIntent) {
          throw new Error('user_feedback, new_sota_payload, or new_visual_intent is required for re-roll.');
        }

        const rr = new RerollService(currentSm);
        const result = await rr.rerollNode({
          node_id: targetNodeId,
          user_feedback: feedback,
          direction: validated.direction,
          notes: validated.notes,
          new_sota_payload: validated.new_sota_payload,
          new_visual_intent: validated.new_visual_intent,
          sota_payload: explicitPayload,
          visual_intent: explicitIntent,
          txt: (validated as any).txt,
          prmpt: (validated as any).prmpt,
          style: (validated as any).style
        });

        const systemMsg =
          '[SYSTEM: Shot completely rewritten. Ask the user to type "N" for Next Shot or "S" for Next Scene. If they want further refinement, tell them to type "R" with their notes. Keep your response under 2 sentences.]';

        return {
          content: [
            {
              type: 'text',
              text: `${systemMsg}\n\n${JSON.stringify(
                {
                  success: true,
                  message: `Targeted re-roll applied to node "${targetNodeId}". SOTA prompt and visual intent completely rewritten without bracketed notes.`,
                  result,
                  system_instruction: systemMsg
                },
                null,
                2
              )}`
            }
          ]
        };
      }

      if (name === 'get_nogyaan_state') {
        getNogyaanStateSchema.parse(input);
        const state = currentSm.getState();
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
        const validated = updateAssetBibleSchema.parse(input);
        const currentState = currentSm.getState();
        const updatedAssets = {
          characters: validated.characters !== undefined ? validated.characters : currentState.assets.characters,
          backgrounds: validated.backgrounds !== undefined ? validated.backgrounds : currentState.assets.backgrounds,
          product: validated.product !== undefined ? validated.product : currentState.assets.product
        };
        currentSm.updateAssetBible(updatedAssets);
        if (validated.global_medium) {
          currentSm.updateGlobalMedium(validated.global_medium as Medium);
        }
        if (validated.global_director_notes !== undefined) {
          currentSm.setGlobalDirectorNotes(validated.global_director_notes);
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: 'AssetBible, Medium & Director Notes updated.',
                  state: currentSm.getState()
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
