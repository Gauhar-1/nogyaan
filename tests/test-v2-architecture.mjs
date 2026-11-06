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
  AssetExtractionResultSchema,
  ShotNodeSchema,
  ShotConceptSchema
} from '../dist/v2/types.js';
import {
  ZERO_YAP_CONSTRAINT,
  WRITER_SYSTEM_PROMPT,
  ASSET_EXTRACTOR_SYSTEM_PROMPT,
  DP_SYSTEM_PROMPT,
  REROLL_SYSTEM_PROMPT,
  SHOT_CONCEPTS_SYSTEM_PROMPT,
  COMPILE_SOTA_PROMPT_SYSTEM_PROMPT
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
  assert(SHOT_CONCEPTS_SYSTEM_PROMPT.startsWith(expectedPrefix), 'SHOT_CONCEPTS_SYSTEM_PROMPT must start with Zero-Yap constraint');
  assert(COMPILE_SOTA_PROMPT_SYSTEM_PROMPT.startsWith(expectedPrefix), 'COMPILE_SOTA_PROMPT_SYSTEM_PROMPT must start with Zero-Yap constraint');

  const hardStopDirective = 'CRITICAL: You are an interactive DP. You must only pitch 3 options for the CURRENT single shot. Do NOT generate the next shot. Do NOT generate a prompt for the whole scene. Output the 3 options as JSON, then STOP and wait for the user\'s selection. Do not attempt to complete the storyboard.';
  assert(DP_SYSTEM_PROMPT.includes(hardStopDirective), 'DP_SYSTEM_PROMPT must contain the exact hard stop directive');

  const rerollRewriteRule = 'CRITICAL: When rerolling, you must COMPLETELY REWRITE the sota_payload and visual_intent from scratch to naturally weave in the user\'s new instructions. NEVER append bracketed notes like [Direction: ...]. Ensure old, contradictory physical facts are completely erased from the new text.';
  assert(REROLL_SYSTEM_PROMPT.includes(rerollRewriteRule), 'REROLL_SYSTEM_PROMPT must contain the rewrite rule without bracket appending');

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

  // Verify no bracketed notes appended
  const updatedPrmpt = rerollResult.updated_node.prmpt || rerollResult.updated_node.sota_payload;
  const updatedVisual = rerollResult.updated_node.txt || rerollResult.updated_node.visual_intent;
  assert(!updatedPrmpt.includes('[Direction:'), 'Must not append [Direction: ...] in sota_payload or prmpt');
  assert(!updatedVisual.includes('[Direction:'), 'Must not append [Direction: ...] in visual_intent or txt');
  assert(!updatedPrmpt.includes('[Note applied:'), 'Must not append bracketed notes');

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

  const rawPitchText = pitchCall.content[0].text;
  assert(rawPitchText.includes('[SYSTEM: Pitch successful. Ask the user to reply ONLY with "1", "2", or "3"'));
  const pitchData = JSON.parse(rawPitchText.slice(rawPitchText.indexOf('{')));
  assert.equal(pitchData.status, 'YIELD_TO_USER', 'Must return YIELD_TO_USER status');
  assert.equal(pitchData.action_required, 'USER_SELECTION', 'Must require USER_SELECTION');
  assert.equal(pitchData.options.length, 3, 'Must pitch exactly 3 options');
  assert.equal(pitchData._systemDirective.directive, 'HARD_STOP_YIELD_TO_USER');
  assert(pitchData._systemDirective.instruction.includes('CRITICAL: You are an interactive DP. You must only pitch 3 options for the CURRENT single shot. Do NOT generate the next shot. Do NOT generate a prompt for the whole scene. Output the 3 options as JSON, then STOP and wait for the user\'s selection. Do not attempt to complete the storyboard.'));

  console.log('  ✅ MCP Tools verified: Zero scene-level prompt tools, strict Yield-to-User state machine.');

  // ==========================================================================
  // Test 9: SOTA DP Suite Deferred Payload Generation & Temporal Handshake
  // ==========================================================================
  console.log('\n🔹 Test 9: SOTA DP Suite Deferred Generation & Temporal Handshake (Tool A & Tool B)');

  // 1. Tool registration checks
  assert(registeredToolNames.includes('pitch_shot_concepts'), 'pitch_shot_concepts must be registered as Tool A');
  assert(registeredToolNames.includes('compile_sota_prompt'), 'compile_sota_prompt must be registered as Tool B');

  // 2. Tool A: pitch_shot_concepts for Scene 1 Shot 1
  const conceptsCall = await callHandler({
    params: {
      name: 'pitch_shot_concepts',
      arguments: { scene_id: 'SCENE_01', shot_id: 'SHOT_01' }
    }
  });

  const rawConcepts = conceptsCall.content[0].text;
  assert(rawConcepts.includes('[SYSTEM: Pitch successful. Ask the user to reply ONLY with "1", "2", or "3" to select their shot. If they want to move on, tell them to type "N" for Next Shot or "S" for Next Scene. Keep your response under 2 sentences.]'));

  const conceptsData = JSON.parse(rawConcepts.slice(rawConcepts.indexOf('{')));
  assert.equal(conceptsData.status, 'YIELD_TO_USER');
  assert.equal(conceptsData.action_required, 'USER_SELECTION');
  assert(conceptsData.concepts['1'], 'Must contain Concept 1');
  assert(conceptsData.concepts['2'], 'Must contain Concept 2');
  assert(conceptsData.concepts['3'], 'Must contain Concept 3');
  assert.equal(conceptsData.concepts['1'].persona, 'Auteur');
  assert.equal(conceptsData.concepts['2'].persona, 'Kinetic');
  assert.equal(conceptsData.concepts['3'].persona, 'Theatrical');

  // Verify zero technical camera data in Tool A visual_intent
  const combinedIntent = `${conceptsData.concepts['1'].visual_intent} ${conceptsData.concepts['2'].visual_intent} ${conceptsData.concepts['3'].visual_intent}`.toLowerCase();
  assert(!combinedIntent.includes('f/'), 'Concepts must not contain lens aperture data');
  assert(!combinedIntent.includes('shutter'), 'Concepts must not contain shutter data');
  assert(!combinedIntent.includes('iso'), 'Concepts must not contain ISO data');

  // 3. Tool B: compile_sota_prompt for Scene 1 Shot 1 (Concept 1 - Auteur)
  const compileCall1 = await callHandler({
    params: {
      name: 'compile_sota_prompt',
      arguments: {
        scene_id: 'SCENE_01',
        shot_id: 'SHOT_01',
        selected_option: '1'
      }
    }
  });

  const rawCompile1 = compileCall1.content[0].text;
  assert(rawCompile1.includes('[SYSTEM: Prompt compiled and saved. Ask the user to type "N" for Next Shot or "S" for Next Scene. If they want to refine, tell them to type "R" with their notes. Keep your response under 2 sentences.]'));

  const compileData1 = JSON.parse(rawCompile1.slice(rawCompile1.indexOf('{')));
  assert.equal(compileData1.success, true);
  assert.equal(compileData1.shot_id, 'SHOT_01');
  assert(compileData1.shot.visual_intent.length > 0);
  assert(compileData1.shot.sota_payload.length > 0);

  const payload1 = compileData1.shot.sota_payload;
  assert(payload1.includes('Shot begins with'), 'SOTA payload must contain INGRESS clause');
  assert(payload1.includes('Shot ends with'), 'SOTA payload must contain EGRESS clause');

  // Verify silent state persistence on disk for Scene 1 Shot 1
  const sc1 = stateManager.getScene('SCENE_01');
  assert(sc1.last_shot_egress.length > 0, 'Scene 1 must record last_shot_egress from Shot 1');
  assert(sc1.shots['SHOT_01'], 'Scene 1 must contain SHOT_01 ShotNode');
  const shot1Egress = sc1.last_shot_egress;

  // 4. Temporal Handshake: Tool B for Scene 1 Shot 2 builds on Shot 1 Egress
  const sliceForShot2 = stateManager.getShotContextSlice('SCENE_01', 'SHOT_02');
  assert.equal(sliceForShot2.last_shot_egress, shot1Egress, 'Shot 2 context slice must receive Shot 1 egress');

  const compileCall2 = await callHandler({
    params: {
      name: 'compile_sota_prompt',
      arguments: {
        scene_id: 'SCENE_01',
        shot_id: 'SHOT_02',
        selected_option: '2'
      }
    }
  });

  const rawCompile2 = compileCall2.content[0].text;
  const compileData2 = JSON.parse(rawCompile2.slice(rawCompile2.indexOf('{')));
  assert.equal(compileData2.success, true);
  assert.equal(compileData2.shot_id, 'SHOT_02');

  const payload2 = compileData2.shot.sota_payload;
  assert(payload2.includes('Shot begins with'), 'Shot 2 SOTA payload must contain INGRESS clause');
  assert(payload2.includes('Shot ends with'), 'Shot 2 SOTA payload must contain EGRESS clause');

  // Verify Scene 1 state on disk now records Shot 2's new egress and ShotNode
  const sc1Updated = stateManager.getScene('SCENE_01');
  assert(sc1Updated.shots['SHOT_02'], 'Scene 1 must contain SHOT_02 ShotNode');
  assert(sc1Updated.last_shot_egress.length > 0, 'Scene 1 must update last_shot_egress');
  assert(Array.isArray(sc1Updated.spatial_memory), 'Scene 1 must maintain spatial_memory array');

  console.log('  ✅ SOTA DP Suite verified: Single-keystroke returns, deferred generation, and temporal ingress/egress handshake.');

  // 5. Finish Line Notification: When the final shot of the final scene (Scene 4, Shot 3) is compiled,
  // the tool MUST return the exact completion system instruction congratulating the user and directing to http://localhost:4321
  const compileFinalCall = await callHandler({
    params: {
      name: 'compile_sota_prompt',
      arguments: {
        scene_id: 'SCENE_04',
        shot_id: 'SHOT_03',
        selected_option: '1'
      }
    }
  });

  const rawFinalText = compileFinalCall.content[0].text;
  const expectedFinishLineInstruction =
    '[SYSTEM: This was the final shot of the storyboard. The workflow is complete. You MUST explicitly congratulate the user and tell them: "Your Director\'s Treatment is complete! Open http://localhost:4321 in your browser to view the final monochrome storyboard, copy your SOTA payloads for Kling/Runway, and Export your Blueprint to PDF." Do not ask for further prompts.]';

  assert(
    rawFinalText.includes(expectedFinishLineInstruction),
    'compile_sota_prompt must include exact finish line completion instruction on final shot of final scene'
  );

  const finalData = JSON.parse(rawFinalText.slice(rawFinalText.indexOf('{')));
  assert.equal(finalData.workflow_complete, true, 'workflow_complete must be true on final shot');
  assert.equal(finalData.studio_url, 'http://localhost:4321', 'Must reference exact local workbench URL');
  assert(rawFinalText.includes('http://localhost:4321'), 'Must include exact http://localhost:4321 URL');

  console.log('  ✅ Finish Line Notification verified: Exact congratulatory prompt & http://localhost:4321 URL returned on final shot.');

  // ==========================================================================
  // Test 10: Targeted Re-Roll via reroll_shot (Zero Bracket Appending & Contradiction Erasure)
  // ==========================================================================
  console.log('\n🔹 Test 10: Targeted Re-Roll (reroll_shot Tool & Zero Bracket Appending)');
  assert(registeredToolNames.includes('reroll_shot'), 'reroll_shot must be registered as MCP tool');

  const rerollCall = await callHandler({
    params: {
      name: 'reroll_shot',
      arguments: {
        scene_id: 'SCENE_01',
        shot_id: 'SHOT_01',
        direction: 'Make Sharma stand upright and hold the brass cup instead of sitting'
      }
    }
  });

  const rawReroll = rerollCall.content[0].text;
  assert(rawReroll.includes('[SYSTEM: Shot completely rewritten. Ask the user to type "N" for Next Shot or "S" for Next Scene. If they want further refinement, tell them to type "R" with their notes. Keep your response under 2 sentences.]'));

  const rerollData = JSON.parse(rawReroll.slice(rawReroll.indexOf('{')));
  assert.equal(rerollData.success, true);
  const rerolledShot = rerollData.result.updated_node;
  assert(!rerolledShot.visual_intent.includes('[Direction:'), 'Must not append [Direction: ...]');
  assert(!rerolledShot.sota_payload.includes('[Direction:'), 'Must not append [Direction: ...]');
  assert(!rerolledShot.sota_payload.toLowerCase().includes('seated'), 'Old contradictory posture (seated) must be erased');
  console.log('  ✅ reroll_shot successfully rewrote shot without bracketed notes and erased contradictory facts.');

  // ==========================================================================
  // Test 11: Native JSON-to-PDF Generator (Selectable Text, No Screenshot DOM Capture)
  // ==========================================================================
  console.log('\n🔹 Test 11: Native JSON-to-PDF Generator Verification');
  const { buildTreatmentPdfDoc, generateTreatmentPdfBuffer } = await import('../dist/v2/pdf-generator.js');

  const pdfDoc = buildTreatmentPdfDoc(currentState);
  assert(pdfDoc, 'buildTreatmentPdfDoc must return a jsPDF instance');
  assert(pdfDoc.getNumberOfPages() >= 2, 'Generated PDF must be multi-page (Page 1 = Cover/Context, Subsequent = Scenes)');

  const pdfBuffer = generateTreatmentPdfBuffer(currentState);
  assert(Buffer.isBuffer(pdfBuffer), 'generateTreatmentPdfBuffer must return a Node Buffer');
  assert(pdfBuffer.length > 2000, 'PDF buffer must have valid byte length');
  assert.equal(pdfBuffer.subarray(0, 5).toString('utf-8'), '%PDF-', 'PDF must begin with native %PDF- magic bytes');

  // Verify complete elimination of screenshot / window.print approach
  const studioHtmlPath = path.resolve('src/ui/studio-app.html');
  const studioHtmlContent = fs.readFileSync(studioHtmlPath, 'utf-8');
  assert(!studioHtmlContent.includes('window.print()'), 'studio-app.html must NOT contain window.print()');
  assert(!studioHtmlContent.includes('html2canvas'), 'studio-app.html must NOT contain html2canvas');
  assert(!studioHtmlContent.includes('html2pdf'), 'studio-app.html must NOT contain html2pdf');
  assert(studioHtmlContent.includes('exportNativeBlueprintPdf'), 'studio-app.html must contain exportNativeBlueprintPdf');

  const reactAppPath = path.resolve('src/ui/NogyaanV2App.tsx');
  const reactAppContent = fs.readFileSync(reactAppPath, 'utf-8');
  assert(!reactAppContent.includes('window.print()'), 'NogyaanV2App.tsx must NOT contain window.print()');
  assert(!reactAppContent.includes('html2canvas'), 'NogyaanV2App.tsx must NOT contain html2canvas');
  assert(!reactAppContent.includes('html2pdf'), 'NogyaanV2App.tsx must NOT contain html2pdf');
  assert(reactAppContent.includes('downloadTreatmentPdf'), 'NogyaanV2App.tsx must import and use downloadTreatmentPdf');

  console.log('  ✅ Native JSON-to-PDF Generator produces multi-page selectable-text PDF with zero DOM-screenshot dependencies.');

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
