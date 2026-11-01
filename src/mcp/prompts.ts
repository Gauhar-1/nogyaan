import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { PresetRegistryService } from '../services/preset-registry.service.js';

export function registerMcpPrompts(
  server: Server,
  presetRegistry: PresetRegistryService
): void {
  // Handler for listing available slash command prompts in Claude
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const presets = presetRegistry.getAllPresets();
    const prompts = presets.map((preset) => ({
      name: `preset-${preset.id}`,
      description: `[noslop] Initialize an ad storyboard with ${preset.name} (${preset.philosophy || preset.description})`,
      arguments: [
        {
          name: 'company_and_product',
          description: 'Company/Brand and Product name and key features (e.g., "ChaiWaale Kadak CTC Spiced Tea")',
          required: true
        },
        {
          name: 'ad_goal',
          description: 'Campaign objective and emotional friction (e.g., "Reconnect busy corporate workers with family tea rituals")',
          required: true
        }
      ]
    }));

    return { prompts };
  });

  // Handler for getting a specific prompt when chosen via /preset-...
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const promptName = request.params.name;
    const presets = presetRegistry.getAllPresets();
    const preset = presets.find((p) => `preset-${p.id}` === promptName);

    if (!preset) {
      throw new Error(`Unknown prompt: ${promptName}`);
    }

    const companyAndProduct =
      request.params.arguments?.company_and_product || 'Unspecified Brand & Product';
    const adGoal = request.params.arguments?.ad_goal || 'Engage target audience';

    const promptText = [
      `You are the Executive Creative Director using the "${preset.name}" preset.`,
      `Framework Philosophy: ${preset.philosophy || preset.description}`,
      `Mandatory Language Rule: ${preset.dialogueLanguageRule}`,
      '',
      'CLIENT BRIEF INTAKE:',
      `- Company & Product: ${companyAndProduct}`,
      `- Campaign Goal: ${adGoal}`,
      '',
      'MANDATORY INITIALIZATION DIRECTIVE:',
      `1. Immediately invoke the "init_brief" tool with:`,
      `   - preset: "${preset.id}" (or preset_id: "${preset.id}")`,
      `   - company: [Extract brand name from "${companyAndProduct}"]`,
      `   - product: [Extract product from "${companyAndProduct}"]`,
      `   - goal: "${adGoal}"`,
      `2. Strictly follow the 1/2/3/R branching contract for Scene 1 Setup.`,
      `3. Never output technical camera jargon (e.g., focal lengths or apertures) during narrative branching.`
    ].join('\n');

    return {
      description: `Storyboard generation prompt for ${preset.name}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: promptText
          }
        }
      ]
    };
  });
}

