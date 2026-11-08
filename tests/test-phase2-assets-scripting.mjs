#!/usr/bin/env node

/**
 * @file tests/test-phase2-assets-scripting.mjs
 * @description Comprehensive automated verification for Phase 2: Asset Extraction & Scripting Logic Fixes.
 * 1. Intelligent Asset Extraction (Contextual Awareness & Company Name Filtering)
 * 2. Scene-Level Tagging & update_scene_tags MCP Tool
 * 3. Real Advertising Scripts ([Visual], [Voiceover/Dialogue], [On-Screen Text / CTA])
 * 4. Dynamic Generation (High entropy & distinct pitches across runs)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { StateManager } from '../dist/v2/state-manager.js';
import { WritersRoomService } from '../dist/v2/writers-room.service.js';
import { AssetLockerService } from '../dist/v2/asset-locker.service.js';
import { registerMcpTools } from '../dist/mcp/tools.js';
import { SessionDagService } from '../dist/services/session-dag.service.js';
import { PresetRegistryService } from '../dist/services/preset-registry.service.js';
import { PromptCompilerService } from '../dist/services/prompt-compiler.service.js';
import { DpPitchService } from '../dist/v2/dp-pitch.service.js';
import { RerollService } from '../dist/v2/reroll.service.js';
import {
  WRITER_SYSTEM_PROMPT,
  ASSET_EXTRACTOR_SYSTEM_PROMPT,
  ZERO_YAP_CONSTRAINT
} from '../dist/v2/prompts.js';

console.log('🧪 Starting Phase 2: Asset Extraction & Scripting Logic Verification Suite...\n');

const tmpDir = path.join(os.tmpdir(), `nogyaan-phase2-test-${Date.now()}`);
fs.mkdirSync(tmpDir, { recursive: true });
const tmpStateFile = path.join(tmpDir, 'phase2-state.json');

try {
  // ==========================================================================
  // Test 1: System Prompt Guardrails & Zero-Yap Preservation
  // ==========================================================================
  console.log('🔹 [Test 1] Verifying System Prompts for Phase 2...');

  // Must strictly preserve ZERO_YAP_CONSTRAINT at the start
  assert(WRITER_SYSTEM_PROMPT.startsWith(ZERO_YAP_CONSTRAINT), 'WRITER_SYSTEM_PROMPT must start with Zero-Yap constraint');
  assert(ASSET_EXTRACTOR_SYSTEM_PROMPT.startsWith(ZERO_YAP_CONSTRAINT), 'ASSET_EXTRACTOR_SYSTEM_PROMPT must start with Zero-Yap constraint');

  // Verify WRITER_SYSTEM_PROMPT requires structured beat sheets
  assert(WRITER_SYSTEM_PROMPT.includes('[Visual]'), 'WRITER_SYSTEM_PROMPT must require [Visual] in beat sheet');
  assert(WRITER_SYSTEM_PROMPT.includes('[Voiceover/Dialogue]'), 'WRITER_SYSTEM_PROMPT must require [Voiceover/Dialogue]');
  assert(WRITER_SYSTEM_PROMPT.includes('[On-Screen Text / CTA]'), 'WRITER_SYSTEM_PROMPT must require [On-Screen Text / CTA]');

  // Verify ASSET_EXTRACTOR_SYSTEM_PROMPT requires contextual awareness
  assert(
    ASSET_EXTRACTOR_SYSTEM_PROMPT.includes('Do not extract the company name as a character. Identify the main product from the brief.'),
    'ASSET_EXTRACTOR_SYSTEM_PROMPT must instruct not to extract company name as character and identify main product from brief'
  );

  console.log('  ✔ System prompts correctly updated with Zero-Yap integrity preserved.');

  // ==========================================================================
  // Test 2: Contextual Asset Extraction (Company Name Excluded & Product Identified)
  // ==========================================================================
  console.log('\n🔹 [Test 2] Contextual Asset Extraction (Never Extract Company Name as Character)...');

  const stateManager = new StateManager(tmpStateFile, 'test-brand-session');
  stateManager.setCorePremise('KombuchaCo - Sparkling Ginger Tonic: Launch organic prebiotic beverage across retail');

  // Set up 4 scenes where the script narrative mentions the company name and actual characters
  stateManager.lockScript('SCENE_01', {
    id: 'A',
    style: 'Heartfelt',
    txt: '[Visual]: In a sunlit kitchen, Maya stares at her laptop while KombuchaCo delivery arrives on the doorstep.\n[Voiceover/Dialogue]: "Another late morning."\n[On-Screen Text / CTA]: KombuchaCo — Fresh Morning Start'
  });

  stateManager.lockScript('SCENE_02', {
    id: 'B',
    style: 'Viral',
    txt: '[Visual]: Maya unboxes the Sparkling Ginger Tonic in the kitchen as Devon rushes in holding gym gear.\n[Voiceover/Dialogue]: "Grab me one of those!"\n[On-Screen Text / CTA]: Prebiotic Power'
  });

  stateManager.lockScript('SCENE_03', {
    id: 'C',
    style: 'Offbeat',
    txt: '[Visual]: In the kitchen, Devon takes a crisp sip of Sparkling Ginger Tonic with wide comedic eyes.\n[Voiceover/Dialogue]: "That actually hits."\n[On-Screen Text / CTA]: 100% Real Roots'
  });

  stateManager.lockScript('SCENE_04', {
    id: 'A',
    style: 'Heartfelt',
    txt: '[Visual]: Maya and Devon clink the bottles on the patio table in warm late afternoon sun.\n[Voiceover/Dialogue]: "To making it through the week."\n[On-Screen Text / CTA]: KombuchaCo — Refresh Your Rhythm'
  });

  const assetLocker = new AssetLockerService(stateManager);
  const extractionResult = await assetLocker.extractActiveAssets({
    company_name: 'KombuchaCo',
    product_goal: 'Launch organic prebiotic beverage across retail'
  });

  const { characters, backgrounds, product } = extractionResult.extraction.assets;
  const charDescriptions = Object.values(characters).join(' ');

  // CRITICAL ASSERTION: Company name "KombuchaCo" or "Kombucha" must NEVER be extracted as a character
  assert(!characters['KombuchaCo'], 'KombuchaCo must NOT be an asset key in characters');
  assert(!charDescriptions.toLowerCase().startsWith('kombuchaco'), 'Character description must NOT identify KombuchaCo as person');
  assert(!charDescriptions.toLowerCase().startsWith('kombucha,'), 'Character description must NOT identify Kombucha as person');

  // Human characters Maya and Devon must be extracted
  assert(charDescriptions.includes('Maya'), `Maya should be extracted as character. Got: ${charDescriptions}`);
  assert(charDescriptions.includes('Devon'), `Devon should be extracted as secondary character. Got: ${charDescriptions}`);

  // Product description must accurately capture the main product
  assert(product.toLowerCase().includes('tonic') || product.toLowerCase().includes('sparkling ginger') || product.toLowerCase().includes('kombucha'),
    `Product must be identified from brief/narrative. Got: "${product}"`
  );

  console.log('  ✔ Company name strictly excluded from characters; real human characters and hero product extracted.');

  // ==========================================================================
  // Test 3: Scene-Level Tagging & update_scene_tags Tool
  // ==========================================================================
  console.log('\n🔹 [Test 3] Scene-Level Tagging & update_scene_tags Tool...');

  // Check initial scene 2 active_refs
  let scene2 = stateManager.getState().scenes.find((s) => s.scene_id === 'SCENE_02');
  assert(scene2 && scene2.active_refs.length > 0, 'Scene 2 must have initial active_refs');

  // Test StateManager.updateSceneTags: add a character and tag
  stateManager.updateSceneTags('SCENE_02', {
    add_characters: ['CHAR_03'],
    add_tags: ['@BG_02']
  });

  scene2 = stateManager.getState().scenes.find((s) => s.scene_id === 'SCENE_02');
  assert(scene2.active_refs.includes('@CHAR_03'), 'Scene 2 active_refs must include newly added @CHAR_03');
  assert(scene2.active_refs.includes('@BG_02'), 'Scene 2 active_refs must include newly added @BG_02');

  // Test StateManager.updateSceneTags: remove character
  stateManager.updateSceneTags('SCENE_02', {
    remove_characters: ['CHAR_03']
  });
  scene2 = stateManager.getState().scenes.find((s) => s.scene_id === 'SCENE_02');
  assert(!scene2.active_refs.includes('@CHAR_03'), 'Scene 2 active_refs must no longer include @CHAR_03');

  // Test full replacement of active_refs
  stateManager.updateSceneTags('SCENE_02', {
    active_refs: ['@CHAR_01', '@BG_01']
  });
  scene2 = stateManager.getState().scenes.find((s) => s.scene_id === 'SCENE_02');
  assert.deepEqual(scene2.active_refs, ['@CHAR_01', '@BG_01'], 'Scene 2 active_refs must exactly match replacement array');

  // Test MCP tool registration for update_scene_tags
  let listHandler = null;
  let callHandler = null;
  const mockServer = {
    setRequestHandler: (schema, handler) => {
      if (!listHandler) {
        listHandler = handler;
      } else {
        callHandler = handler;
      }
    }
  };

  const pc = new PromptCompilerService();
  const pr = new PresetRegistryService();
  const ss = new SessionDagService(undefined, pc);

  registerMcpTools(
    mockServer,
    ss,
    pr,
    pc,
    stateManager,
    new WritersRoomService(stateManager),
    new DpPitchService(stateManager),
    new RerollService(stateManager),
    assetLocker
  );

  const toolsListResult = await listHandler();
  const updateTool = toolsListResult.tools.find((t) => t.name === 'update_scene_tags');
  assert(updateTool, 'update_scene_tags tool must be registered in MCP list');
  assert(updateTool.inputSchema.required.includes('session_id'), 'update_scene_tags must require session_id');
  assert(updateTool.inputSchema.required.includes('scene_id'), 'update_scene_tags must require scene_id');

  // Invoke update_scene_tags via MCP tool call
  const toolCallResponse = await callHandler({
    params: {
      name: 'update_scene_tags',
      arguments: {
        session_id: 'test-brand-session',
        scene_id: 'SCENE_03',
        add_characters: ['CHAR_02'],
        add_tags: ['@BG_02']
      }
    }
  });

  assert(!toolCallResponse.isError, `Tool call must succeed. Got error: ${JSON.stringify(toolCallResponse)}`);
  const scene3 = stateManager.getState().scenes.find((s) => s.scene_id === 'SCENE_03');
  assert(scene3.active_refs.includes('@CHAR_02'), 'Scene 3 active_refs must contain @CHAR_02 via MCP tool');
  assert(scene3.active_refs.includes('@BG_02'), 'Scene 3 active_refs must contain @BG_02 via MCP tool');

  console.log('  ✔ update_scene_tags tool verified: full replacement, character add/remove, and MCP schema.');

  // ==========================================================================
  // Test 4: Real Advertising Scripts (Structured Beat Sheet: Visual, VO, CTA)
  // ==========================================================================
  console.log('\n🔹 [Test 4] Real Advertising Scripts (Structured Beat Sheets)...');

  const writersRoom = new WritersRoomService(stateManager);
  const pitches = await writersRoom.pitchScriptOptions({
    scene_id: 'SCENE_01',
    user_guidance: 'Morning routine friction'
  });

  assert.equal(pitches.length, 3, 'Must output 3 options');
  for (const p of pitches) {
    assert(p.txt.includes('[Visual]:'), `Pitch ${p.id} (${p.style}) must contain [Visual]:`);
    assert(p.txt.includes('[Voiceover/Dialogue]:'), `Pitch ${p.id} (${p.style}) must contain [Voiceover/Dialogue]:`);
    assert(p.txt.includes('[On-Screen Text / CTA]:'), `Pitch ${p.id} (${p.style}) must contain [On-Screen Text / CTA]:`);
  }

  console.log('  ✔ All pitches output structured commercial beat sheets with [Visual], [Voiceover/Dialogue], and [On-Screen Text / CTA].');

  // ==========================================================================
  // Test 5: Dynamic Generation (Varied Pitches Across Calls)
  // ==========================================================================
  console.log('\n🔹 [Test 5] Dynamic Generation (Varied Pitches Across Calls)...');

  // Generate multiple batches of pitches
  const batch1 = await writersRoom.pitchScriptOptions({ scene_id: 'SCENE_01' });
  // Slight delay or different entropy
  await new Promise((r) => setTimeout(r, 20));
  const batch2 = await writersRoom.pitchScriptOptions({ scene_id: 'SCENE_01' });

  // Verify that options maintain valid structure across runs
  assert.equal(batch1.length, 3);
  assert.equal(batch2.length, 3);

  // Collect text across multiple runs to ensure entropy / angle variation
  const allGeneratedTexts = new Set();
  for (let i = 0; i < 6; i++) {
    const runPitches = await writersRoom.pitchScriptOptions({ scene_id: 'SCENE_01' });
    for (const p of runPitches) {
      allGeneratedTexts.add(p.txt);
    }
  }

  // Across 6 runs (18 pitches total), we must have more than 3 unique pitch strings due to entropy pool
  assert(
    allGeneratedTexts.size > 3,
    `Dynamic generation must produce varied pitches across repeated calls. Unique count: ${allGeneratedTexts.size}`
  );

  console.log(`  ✔ Dynamic generation verified: produced ${allGeneratedTexts.size} distinct concept beats across runs.`);

} catch (err) {
  console.error('\n❌ Phase 2 Verification Failed:', err);
  process.exit(1);
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}

console.log('\n🎉 ALL PHASE 2: ASSET EXTRACTION & SCRIPTING TESTS PASSED 100%!');
process.exit(0);
