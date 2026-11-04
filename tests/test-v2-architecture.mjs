#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { StateManager } from '../dist/v2/state-manager.js';
import { WritersRoomService } from '../dist/v2/writers-room.service.js';
import { AssetLockerService } from '../dist/v2/asset-locker.service.js';
import { DpPitchService } from '../dist/v2/dp-pitch.service.js';
import { RerollService } from '../dist/v2/reroll.service.js';
import {
  NogyaanStateSchema,
  ScriptPitchSchema,
  ShotPitchSchema,
  AssetExtractionResultSchema
} from '../dist/v2/types.js';
import {
  ZERO_YAP_CONSTRAINT,
  WRITER_SYSTEM_PROMPT,
  ASSET_EXTRACTOR_SYSTEM_PROMPT,
  DP_SYSTEM_PROMPT,
  REROLL_SYSTEM_PROMPT
} from '../dist/v2/prompts.js';

console.log('🧪 Starting nogyaan V2 Just-In-Time (JIT) Context Slicing Automated Verification...\n');

const tmpDir = path.join(os.tmpdir(), `nogyaan-jit-test-${Date.now()}`);
fs.mkdirSync(tmpDir, { recursive: true });
const tmpStateFile = path.join(tmpDir, 'nogyaan-state.json');

try {
  // ==========================================================================
  // Test 1: Zero-Yap Enforcement Across All Prompts
  // ==========================================================================
  console.log('🔹 Test 1: Zero-Yap Enforcement Verification');
  const expectedPrefix = 'CRITICAL: Output ONLY raw, minified JSON. Do NOT wrap in markdown formatting (```json). Do NOT output conversational filler, pleasantries, or explanations. Failure to comply will break the parsing engine.';

  assert(WRITER_SYSTEM_PROMPT.startsWith(expectedPrefix), 'WRITER_SYSTEM_PROMPT must start with Zero-Yap constraint');
  assert(ASSET_EXTRACTOR_SYSTEM_PROMPT.startsWith(expectedPrefix), 'ASSET_EXTRACTOR_SYSTEM_PROMPT must start with Zero-Yap constraint');
  assert(DP_SYSTEM_PROMPT.startsWith(expectedPrefix), 'DP_SYSTEM_PROMPT must start with Zero-Yap constraint');
  assert(REROLL_SYSTEM_PROMPT.startsWith(expectedPrefix), 'REROLL_SYSTEM_PROMPT must start with Zero-Yap constraint');

  const hardStopDirective = 'CRITICAL: You are an interactive DP. You must only pitch 3 options for the CURRENT single shot. Do NOT generate the next shot. Do NOT generate a prompt for the whole scene. Output the 3 options as JSON, then STOP and wait for the user\'s selection. Do not attempt to complete the storyboard.';
  assert(DP_SYSTEM_PROMPT.includes(hardStopDirective), 'DP_SYSTEM_PROMPT must contain the exact hard stop directive');

  console.log('  ✅ All system prompts strictly enforce Zero-Yap constraint and Hard Stop directive.');

  // ==========================================================================
  // Test 2: StateManager JIT Context Slicers (Zero Global Context Drag)
  // ==========================================================================
  console.log('\n🔹 Test 2: StateManager Segregation & JIT Context Slicers');
  const stateManager = new StateManager(tmpStateFile);

  stateManager.setCorePremise('Craft coffee brand launch emphasizing generational bond');
  stateManager.updateGlobalMedium('Live-Action Cinematic');

  // Verify Scene 1 slice: only core_premise, previous_scene_narrative is null
  const sliceS1 = stateManager.getScriptContextSlice('SCENE_01');
  assert.equal(sliceS1.core_premise.includes('Craft coffee'), true);
  assert.equal(sliceS1.previous_scene_narrative, null, 'Scene 1 must not have previous scene narrative');

  // Lock Scene 1 with minified ScriptPitch
  const pitch1 = {
    id: 'A',
    style: 'Heartfelt',
    txt: 'Sharma ji quietly brews the dark decoction while looking out at the waking street.'
  };
  stateManager.lockScript('SCENE_01', pitch1);

  // Verify Scene 2 slice: has Scene 1 narrative only
  const sliceS2 = stateManager.getScriptContextSlice('SCENE_02');
  assert.equal(sliceS2.previous_scene_narrative, pitch1.txt);

  // Lock Scene 2, 3, 4
  const pitch2 = {
    id: 'B',
    style: 'Viral',
    txt: 'Aarav bursts into the kitchen in a panic over an investor pitch deadline.'
  };
  stateManager.lockScript('SCENE_02', pitch2);

  const pitch3 = {
    id: 'C',
    style: 'Offbeat',
    txt: 'Sharma ji hands Aarav the brass tumbler with complete unbothered stillness.'
  };
  stateManager.lockScript('SCENE_03', pitch3);

  const pitch4 = {
    id: 'A',
    style: 'Heartfelt',
    txt: 'One sip grounds Aarav completely. Both share a quiet smile over the authentic coffee.'
  };
  stateManager.lockScript('SCENE_04', pitch4);

  // Verify Scene 3 slice receives ONLY Scene 2 (never Scene 1 or future scenes)
  const sliceS3 = stateManager.getScriptContextSlice('SCENE_03');
  assert.equal(sliceS3.previous_scene_narrative, pitch2.txt);
  assert(!sliceS3.previous_scene_narrative.includes(pitch1.txt), 'Must not leak Scene 1 into Scene 3');

  console.log('  ✅ StateManager JIT context slicers enforce strict boundary isolation.');

  // ==========================================================================
  // Test 3: Phase 1: The Writer's Room (Minified ScriptPitch)
  // ==========================================================================
  console.log('\n🔹 Test 3: Phase 1 Writer\'s Room (Minified ScriptPitch & 3 Styles)');
  const writersRoom = new WritersRoomService(stateManager);

  const pitchedOptions = await writersRoom.pitchScriptOptions({
    scene_id: 'SCENE_01',
    user_guidance: 'Lead feels morning calm'
  });

  assert.equal(pitchedOptions.length, 3, 'Must output exactly 3 pitches');
  const pitchStyles = pitchedOptions.map((p) => p.style);
  assert(pitchStyles.includes('Heartfelt'), 'Must contain Heartfelt');
  assert(pitchStyles.includes('Viral'), 'Must contain Viral');
  assert(pitchStyles.includes('Offbeat'), 'Must contain Offbeat');

  for (const p of pitchedOptions) {
    ScriptPitchSchema.parse(p);
    assert(p.id && p.style && p.txt, 'Must contain minified keys (id, style, txt)');
  }

  console.log('  ✅ Phase 1 Writer\'s Room outputs minified ScriptPitch schemas.');

  // ==========================================================================
  // Test 4: Phase 2: The Asset Locker (Entity Extraction & Active Ref Tagging)
  // ==========================================================================
  console.log('\n🔹 Test 4: Phase 2 Asset Locker (Active Ref Tagging & Entity Extraction)');
  const assetLocker = new AssetLockerService(stateManager);

  const extractionResult = await assetLocker.extractActiveAssets();
  assert(extractionResult.extraction, 'Must return extraction object');

  const { assets, scene_tagging } = extractionResult.extraction;
  assert(Object.keys(assets.characters).length >= 1, 'Must extract characters');
  assert(Object.keys(assets.backgrounds).length >= 1, 'Must extract backgrounds');
  assert(assets.product, 'Must extract hero product');

  // Verify scene-level tagging
  assert(scene_tagging['SCENE_01'], 'Scene 1 must be tagged');
  assert(scene_tagging['SCENE_02'], 'Scene 2 must be tagged');
  assert(scene_tagging['SCENE_03'], 'Scene 3 must be tagged');
  assert(scene_tagging['SCENE_04'], 'Scene 4 must be tagged');

  // Verify state on disk now has active_refs injected into each scene
  const currentState = stateManager.getState();
  for (const sc of currentState.scenes) {
    assert(Array.isArray(sc.active_refs), 'Scene must have active_refs array');
    assert(sc.active_refs.length > 0, `Scene ${sc.scene_id} must have tagged active_refs`);
  }

  console.log('  ✅ Phase 2 Asset Locker extracted AssetBible and tagged active_refs.');

  // ==========================================================================
  // Test 5: Phase 3: The DP Suite (Filtered Asset Bible, Spatial Memory & Director Notes)
  // ==========================================================================
  console.log('\n🔹 Test 5: Phase 3 DP Suite (Filtered Assets, Spatial Memory & Director Notes)');
  const dpPitch = new DpPitchService(stateManager);

  // Set persistent cinematic rules
  const directorRule = 'Scene 4 must visually mirror Scene 1; maintain warm practical lighting';
  stateManager.setGlobalDirectorNotes(directorRule);

  // Set explicit active_refs on Scene 2: CHAR_01 only, no CHAR_02
  stateManager.tagSceneAssets('SCENE_02', ['@CHAR_01', '@BG_02']);

  // Get DP Context Slice for Scene 2, Shot 1
  const dpSlice = stateManager.getShotContextSlice('SCENE_02', 'SHOT_01');
  assert.equal(dpSlice.scene_narrative, pitch2.txt);
  // Verify filtered assets does NOT include CHAR_02
  assert(dpSlice.filtered_assets.characters['CHAR_01'], 'Filtered assets must include CHAR_01');
  assert(!dpSlice.filtered_assets.characters['CHAR_02'], 'Filtered assets must NOT include unused CHAR_02');
  // Verify previous_shot is NOT in slice
  assert.equal(dpSlice.previous_shot, undefined, 'Shot X-1 must NOT be passed in JIT payload');
  // Verify spatial_memory and global_director_notes are present
  assert(Array.isArray(dpSlice.spatial_memory), 'spatial_memory must be an array');
  assert.equal(dpSlice.global_director_notes, directorRule, 'global_director_notes must be present in slice');

  // Pitch Shot 1
  const shotPitches = await dpPitch.pitchShotOptions({
    scene_id: 'SCENE_02',
    shot_id: 'SHOT_01'
  });

  assert.equal(shotPitches.length, 3, 'Must output exactly 3 DP shot options');
  const dpStyles = shotPitches.map((p) => p.style);
  assert(dpStyles.includes('Auteur'), 'Must contain Auteur');
  assert(dpStyles.includes('Kinetic'), 'Must contain Kinetic');
  assert(dpStyles.includes('Theatrical'), 'Must contain Theatrical');

  for (const s of shotPitches) {
    ShotPitchSchema.parse(s);
    assert(s.id && s.style && s.txt && s.prmpt, 'Must contain minified keys (id, style, txt, prmpt)');
    // Style-agnostic check
    const lowerPrmpt = s.prmpt.toLowerCase();
    assert(!lowerPrmpt.includes('live-action'), 'prmpt must be style-agnostic');
    assert(!lowerPrmpt.includes('2d anime'), 'prmpt must be style-agnostic');
    assert(!lowerPrmpt.includes('pixar'), 'prmpt must be style-agnostic');
  }

  // Lock Shot 1 with explicit and auto-extracted spatial facts (The Spatial Mutation)
  stateManager.lockShot('SCENE_02', 'SHOT_01', shotPitches[0], [
    'Sharma is seated at table 4',
    'Phone is on table'
  ]);

  // Verify Scene 2 spatial_memory on state
  const sc2 = stateManager.getScene('SCENE_02');
  assert(sc2.spatial_memory.includes('Sharma is seated at table 4'), 'Must record Sharma seated at table 4');
  assert(sc2.spatial_memory.includes('Phone is on table'), 'Must record Phone on table');

  // Check Shot 2 context slice receives spatial_memory and global_director_notes (NO previous_shot)
  const dpSlice2 = stateManager.getShotContextSlice('SCENE_02', 'SHOT_02');
  assert.equal(dpSlice2.previous_shot, undefined, 'Shot 2 must NOT receive previous_shot state');
  assert.equal(dpSlice2.global_director_notes, directorRule);
  assert(dpSlice2.spatial_memory.includes('Sharma is seated at table 4'), 'Shot 2 must receive rolling spatial memory');
  assert(dpSlice2.spatial_memory.includes('Phone is on table'), 'Shot 2 must receive phone position');

  // Lock Shot 2 with positional movement to verify silent spatial update
  stateManager.lockShot('SCENE_02', 'SHOT_02', {
    id: 'B',
    style: 'Kinetic',
    txt: 'Sharma stands up from table 4 and walks to the kitchen counter.',
    prmpt: '24mm lens, f/8, rapid tracking pace behind Sharma walking towards kitchen counter.'
  });

  const sc2Updated = stateManager.getScene('SCENE_02');
  assert(
    sc2Updated.spatial_memory.some((m) => m.toLowerCase().includes('sharma')),
    'Spatial memory must preserve Sharma location'
  );

  console.log('  ✅ Phase 3 DP Suite enforces Filtered Asset Bible, Spatial Memory & Director Notes.');

  // ==========================================================================
  // Test 6: Phase 5: Targeted Re-Roll (Isolated Node Modification, Zero Token Burn)
  // ==========================================================================
  console.log('\n🔹 Test 6: Phase 5 Targeted Re-Roll (Single-Node Context Slice)');
  const rerollService = new RerollService(stateManager);

  // Verify slice for target node contains ONLY that node
  const nodeSlice = stateManager.getNodeContextSlice('SCENE_02:SHOT_01');
  assert.equal(nodeSlice.type, 'shot');
  assert.equal(nodeSlice.target_node.id, shotPitches[0].id);

  const beforeScene3 = JSON.stringify(stateManager.getScene('SCENE_03'));

  // Reroll Shot 1 in Scene 2
  const rerollResult = await rerollService.rerollNode({
    node_id: 'SCENE_02:SHOT_01',
    user_feedback: 'Close-up 85mm on hands shaking with caffeine withdrawal'
  });

  assert.equal(rerollResult.type, 'shot');
  assert.equal(rerollResult.scene_id, 'SCENE_02');

  // Verify Scene 3 is completely untouched
  const afterScene3 = JSON.stringify(stateManager.getScene('SCENE_03'));
  assert.equal(beforeScene3, afterScene3, 'Scene 3 must remain untouched during Scene 2 shot re-roll');

  console.log('  ✅ Phase 5 Targeted Re-Roll modifies isolated node with zero cross-node burn.');

  // ==========================================================================
  // Test 7: Full Disk State Validation
  // ==========================================================================
  console.log('\n🔹 Test 7: Full nogyaan-state.json Disk Validation');
  const diskRaw = fs.readFileSync(tmpStateFile, 'utf-8');
  const diskJson = JSON.parse(diskRaw);
  const validatedState = NogyaanStateSchema.parse(diskJson);

  assert.equal(validatedState.scenes.length, 4);
  assert.equal(validatedState.core_premise.includes('Craft coffee'), true);
  assert(validatedState.scenes[1].active_refs.includes('@CHAR_01'));
  assert.equal(validatedState.global_director_notes, directorRule, 'Disk state must preserve global_director_notes');
  assert(validatedState.scenes[1].spatial_memory.length > 0, 'Disk state must preserve spatial_memory array');

  console.log('  ✅ nogyaan-state.json on disk validates 100% against NogyaanStateSchema.');

  // ==========================================================================
  // Test 8: Verify Zero Scene-Level Prompt Tools & Yield State Machine
  // ==========================================================================
  console.log('\n🔹 Test 8: MCP Tools Verification (No Eager Scene Compilation & Yield State Machine)');
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

  const { registerMcpTools } = await import('../dist/mcp/tools.js');
  const { SessionDagService } = await import('../dist/services/session-dag.service.js');
  const { PresetRegistryService } = await import('../dist/services/preset-registry.service.js');
  const { PromptCompilerService } = await import('../dist/services/prompt-compiler.service.js');

  const pc = new PromptCompilerService();
  const pr = new PresetRegistryService();
  const ss = new SessionDagService(undefined, pc);

  registerMcpTools(
    mockServer,
    ss,
    pr,
    pc,
    stateManager,
    writersRoom,
    dpPitch,
    new RerollService(stateManager),
    assetLocker
  );

  const toolsListResult = await listHandler();
  const registeredToolNames = toolsListResult.tools.map((t) => t.name);

  assert(!registeredToolNames.includes('compile_single_scene'), 'compile_single_scene must NOT be exposed as MCP tool');
  assert(!registeredToolNames.includes('compile_shots'), 'compile_shots must NOT be exposed as MCP tool');
  assert(registeredToolNames.includes('pitch_shot_options'), 'pitch_shot_options must be registered');
  assert(registeredToolNames.includes('lock_shot_option'), 'lock_shot_option must be registered');

  // Verify pitch_shot_options yields to user and completely halts
  const pitchCall = await callHandler({
    params: {
      name: 'pitch_shot_options',
      arguments: { scene_id: 'SCENE_01', shot_id: 'SHOT_01' }
    }
  });

  const pitchData = JSON.parse(pitchCall.content[0].text);
  assert.equal(pitchData.status, 'YIELD_TO_USER', 'Must return YIELD_TO_USER status');
  assert.equal(pitchData.action_required, 'USER_SELECTION', 'Must require USER_SELECTION');
  assert.equal(pitchData.options.length, 3, 'Must pitch exactly 3 options');
  assert.equal(pitchData._systemDirective.directive, 'HARD_STOP_YIELD_TO_USER');
  assert(pitchData._systemDirective.instruction.includes('CRITICAL: You are an interactive DP. You must only pitch 3 options for the CURRENT single shot. Do NOT generate the next shot. Do NOT generate a prompt for the whole scene. Output the 3 options as JSON, then STOP and wait for the user\'s selection. Do not attempt to complete the storyboard.'));

  console.log('  ✅ MCP Tools verified: Zero scene-level prompt tools, strict Yield-to-User state machine.');

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\n✨ ALL JIT CONTEXT SLICING TESTS PASSED CLEANLY! ✨\n');
  process.exit(0);
} catch (err) {
  console.error('\n❌ TEST FAILED:', err);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
  process.exit(1);
}
