// tests/test-stage-progression.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DAGStore } from '../dist/state/dag-store.js';
import { PromptCompilerService } from '../dist/services/prompt-compiler.service.js';
import { PresetRegistryService } from '../dist/services/preset-registry.service.js';
import { SessionDagService } from '../dist/services/session-dag.service.js';
import { StateManager } from '../dist/v2/state-manager.js';
import { WritersRoomService } from '../dist/v2/writers-room.service.js';
import { DpPitchService } from '../dist/v2/dp-pitch.service.js';
import { RerollService } from '../dist/v2/reroll.service.js';
import { AssetLockerService } from '../dist/v2/asset-locker.service.js';
import { registerMcpTools } from '../dist/mcp/tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceDir = path.resolve(__dirname, '..');

console.log('🧪 Starting Stage Progression & FSM Tool Bounds Verification Suite...\n');

// ============================================================================
// Test 1: dagStore stage progression & dual naming (SCENE_2_SETUP + SCENE_2_CATALYST)
// ============================================================================
console.log('🔹 [Test 1] Verifying DAGStore Stage Progression & Dual Naming...');

const testSessionId1 = `test-dag-prog-${Date.now().toString(36)}`;
const dagStore = new DAGStore(undefined, workspaceDir);

// 1. Initialize brief -> CORE_THEME
const initGraph = dagStore.initBrief(
  {
    company: 'AeroGlide',
    product: 'Carbon Fiber Pen',
    goal: 'Showcase precision engineering',
    presetId: 'preset-auteur-noir'
  },
  undefined,
  testSessionId1
);

assert.equal(initGraph.currentStage, 'CORE_THEME');
assert.equal(initGraph.current_stage, 'CORE_THEME');

// 2. Lock core theme -> SCENE_1_SETUP
const themeGraph = dagStore.lockCoreTheme({
  sessionId: testSessionId1,
  chosenThemeId: '1',
  themeTitle: 'Weightless Engineering',
  themePremise: 'Gravity yields to craftsmanship'
});

assert.equal(themeGraph.currentStage, 'SCENE_1_SETUP');
assert.equal(themeGraph.current_stage, 'SCENE_1_SETUP');

// 3. Branch Scene 1 commit -> advances to SCENE_2_SETUP (current_stage) and SCENE_2_CATALYST (currentStage)
const scene1Graph = dagStore.branchScene({
  sessionId: testSessionId1,
  action: 'commit',
  selectedOptionId: '1',
  treatmentProse: 'The pen rests on balanced glass as light cascades across the carbon weave.'
});

assert.equal(scene1Graph.current_stage, 'SCENE_2_SETUP', 'current_stage MUST advance to SCENE_2_SETUP');
assert.equal(scene1Graph.currentStage, 'SCENE_2_CATALYST', 'currentStage must remain SCENE_2_CATALYST for compatibility');
console.log('  ✔ Scene 1 branch correctly advanced current_stage to "SCENE_2_SETUP" and currentStage to "SCENE_2_CATALYST".');

// 4. Branch Scene 2 commit -> SCENE_3_TWIST
const scene2Graph = dagStore.branchScene({
  sessionId: testSessionId1,
  action: 'commit',
  selectedOptionId: '1',
  treatmentProse: 'A hand lifts the pen; the glass balance tilts under sudden breeze.'
});

assert.equal(scene2Graph.current_stage, 'SCENE_3_TWIST');
assert.equal(scene2Graph.currentStage, 'SCENE_3_TWIST');

// 5. Branch Scene 3 commit -> SCENE_4_CLIMAX
const scene3Graph = dagStore.branchScene({
  sessionId: testSessionId1,
  action: 'commit',
  selectedOptionId: '1',
  treatmentProse: 'Ink touches parchment with zero resistance, gliding smoothly.'
});

assert.equal(scene3Graph.current_stage, 'SCENE_4_CLIMAX');
assert.equal(scene3Graph.currentStage, 'SCENE_4_CLIMAX');

// 6. Branch Scene 4 commit -> LOCK_ASSETS
const scene4Graph = dagStore.branchScene({
  sessionId: testSessionId1,
  action: 'commit',
  selectedOptionId: '1',
  treatmentProse: 'The pen clicks shut; the AeroGlide emblem catches a final rim light.'
});

assert.equal(scene4Graph.current_stage, 'LOCK_ASSETS');
assert.equal(scene4Graph.currentStage, 'LOCK_ASSETS');

// 7. Lock assets -> COMPILE_SHOTS
const assetsGraph = dagStore.lockAssets({
  sessionId: testSessionId1,
  characters: [
    { id: 'CHAR_01', name: 'Devon', appearancePrompt: 'Linen shirt, focused eyes', role: 'Architect' }
  ],
  environments: [
    { id: 'BG_01', name: 'Design Studio', environmentPrompt: 'Minimalist studio with concrete table', lightingProfile: 'Cinematic rim light' }
  ],
  product: { id: 'PROD_01', name: 'AeroGlide Pen', packagingAppearance: 'Matte carbon finish', heroAngle: 'Close-up 45-degree angle' }
});

assert.equal(assetsGraph.current_stage, 'COMPILE_SHOTS');
assert.equal(assetsGraph.currentStage, 'COMPILE_SHOTS');
console.log('  ✔ Narrative branching and lock_assets strictly advanced through COMPILE_SHOTS.');

// 8. Lock shots across all 4 scenes -> stays in COMPILE_SHOTS (no auto-premature completion)
assert.equal(dagStore.isAllShotsLocked(assetsGraph), false);

dagStore.lockShot({
  sessionId: testSessionId1,
  sceneId: 'SCENE_01',
  shot: { order: 1, action: 'Shot 1 action', compiledVideoPrompt: 'Shot 1 prompt' }
});
dagStore.lockShot({
  sessionId: testSessionId1,
  sceneId: 'SCENE_02',
  shot: { order: 2, action: 'Shot 2 action', compiledVideoPrompt: 'Shot 2 prompt' }
});
dagStore.lockShot({
  sessionId: testSessionId1,
  sceneId: 'SCENE_03',
  shot: { order: 3, action: 'Shot 3 action', compiledVideoPrompt: 'Shot 3 prompt' }
});

const preCompletedGraph = dagStore.load(testSessionId1);
assert.equal(preCompletedGraph.current_stage, 'COMPILE_SHOTS');
assert.equal(dagStore.isAllShotsLocked(preCompletedGraph), false);

// 4th scene locked -> does NOT auto-complete; stays in COMPILE_SHOTS
const shot4Graph = dagStore.lockShot({
  sessionId: testSessionId1,
  sceneId: 'SCENE_04',
  shot: { order: 4, action: 'Shot 4 action', compiledVideoPrompt: 'Shot 4 prompt' }
});

assert.equal(shot4Graph.current_stage, 'COMPILE_SHOTS', 'Must NOT auto-trigger COMPLETED stage just because Scene 4 receives its first shot');
console.log('  ✔ Locking shots in Scene 4 does not prematurely advance to COMPLETED.');

// Now explicitly call finalizeStoryboard -> advances to COMPLETED
const completedGraph = dagStore.finalizeStoryboard(testSessionId1);
assert.equal(completedGraph.current_stage, 'COMPLETED', 'Must transition to COMPLETED upon explicit finalizeStoryboard');
assert.equal(completedGraph.currentStage, 'COMPLETED', 'currentStage must be COMPLETED');
assert.equal(completedGraph.stage, 'COMPLETED', 'stage must be COMPLETED');
console.log('  ✔ Explicit finalizeStoryboard transitioned current_stage and currentStage to "COMPLETED".');

// ============================================================================
// Test 2: MCP Tool Stage Bounds Enforcement
// ============================================================================
console.log('\n🔹 [Test 2] Verifying MCP Tool Stage Bounds Enforcement...');

// Set up Mock MCP Server
let toolHandler;
const mockServer = {
  setRequestHandler: (_schema, handler) => {
    toolHandler = handler;
  }
};

const pc = new PromptCompilerService();
const pr = new PresetRegistryService();
const ss = new SessionDagService(undefined, pc);

const testSessionId2 = `test-tool-bounds-${Date.now().toString(36)}`;
const stateManager = StateManager.forSession(testSessionId2, workspaceDir);
const writersRoom = new WritersRoomService(stateManager);
const dpPitch = new DpPitchService(stateManager);
const rerollService = new RerollService(stateManager);
const assetLocker = new AssetLockerService(stateManager);

registerMcpTools(
  mockServer,
  ss,
  pr,
  pc,
  stateManager,
  writersRoom,
  dpPitch,
  rerollService,
  assetLocker
);

const callTool = async (name, args) => {
  return await toolHandler({
    params: {
      name,
      arguments: { session_id: testSessionId2, ...args }
    }
  });
};

// 1. Initialize brief (State: CORE_THEME)
const initRes = await callTool('init_brief', {
  company: 'Veloce',
  product: 'Espresso Machine',
  goal: 'Premium morning ritual',
  presetId: 'preset-auteur-noir'
});
assert(!initRes.isError, 'init_brief must succeed');

// Bound Check 1: pitch_script_options in CORE_THEME -> MUST FAIL
const failPitchScript = await callTool('pitch_script_options', { scene_id: 'SCENE_01' });
assert.equal(failPitchScript.isError, true);
assert(
  failPitchScript.content[0].text.includes("Cannot pitch script options during stage 'CORE_THEME'"),
  'pitch_script_options must reject execution during CORE_THEME'
);
console.log('  ✔ pitch_script_options rejected during CORE_THEME.');

// Bound Check 2: lock_script_option in CORE_THEME -> MUST FAIL
const failLockScript = await callTool('lock_script_option', {
  scene_id: 'SCENE_01',
  script: { id: '1', style: 'Heartfelt', txt: 'Morning light reflects on stainless steel' }
});
assert.equal(failLockScript.isError, true);
assert(
  failLockScript.content[0].text.includes("Cannot lock script option during stage 'CORE_THEME'"),
  'lock_script_option must reject execution during CORE_THEME'
);
console.log('  ✔ lock_script_option rejected during CORE_THEME.');

// Bound Check 3: extract_active_assets in CORE_THEME -> MUST FAIL
const failExtractAssets = await callTool('extract_active_assets', {
  script_content: 'Barista steams milk in quiet cafe'
});
assert.equal(failExtractAssets.isError, true);
assert(
  failExtractAssets.content[0].text.includes('FSM STAGE VIOLATION'),
  'extract_active_assets must reject execution during CORE_THEME'
);
console.log('  ✔ extract_active_assets rejected during CORE_THEME.');

// Bound Check 4: pitch_shot_concepts in CORE_THEME -> MUST FAIL
const failPitchShotConcepts = await callTool('pitch_shot_concepts', {
  scene_id: 'SCENE_01',
  shot_id: 'SHOT_01'
});
assert.equal(failPitchShotConcepts.isError, true);
assert(
  failPitchShotConcepts.content[0].text.includes("Cannot call pitch_shot_concepts while in stage 'CORE_THEME'"),
  'pitch_shot_concepts must reject execution during CORE_THEME'
);
console.log('  ✔ pitch_shot_concepts rejected during CORE_THEME.');

// Bound Check 5: compile_sota_prompt in CORE_THEME -> MUST FAIL
const failCompilePrompt = await callTool('compile_sota_prompt', {
  scene_id: 'SCENE_01',
  shot_id: 'SHOT_01',
  selected_option: '1'
});
assert.equal(failCompilePrompt.isError, true);
assert(
  failCompilePrompt.content[0].text.includes("Cannot call compile_sota_prompt while in stage 'CORE_THEME'"),
  'compile_sota_prompt must reject execution during CORE_THEME'
);
console.log('  ✔ compile_sota_prompt rejected during CORE_THEME.');

// Bound Check 6: lock_shot_option in CORE_THEME -> MUST FAIL
const failLockShot = await callTool('lock_shot_option', {
  scene_id: 'SCENE_01',
  shot_id: 'SHOT_01',
  shot: { order: 1, action: 'Shot 1 action', sota_payload: 'Shot 1 prompt' }
});
assert.equal(failLockShot.isError, true);
assert(
  failLockShot.content[0].text.includes("Cannot call lock_shot_option while in stage 'CORE_THEME'"),
  'lock_shot_option must reject execution during CORE_THEME'
);
console.log('  ✔ lock_shot_option rejected during CORE_THEME.');

// ============================================================================
// Test 3: Progression to COMPILE_SHOTS and Workflow Completion Trigger
// ============================================================================
console.log('\n🔹 [Test 3] Verifying Complete End-to-End Workflow & Finish Line Trigger...');

// Lock Core Theme
const lockThemeRes = await callTool('lock_core_theme', {
  chosen_theme_id: '1',
  theme_title: 'Precision Extraction',
  theme_premise: 'Every drop measured to the milligram'
});
assert(!lockThemeRes.isError);

// Advance Scenes 1-4 via branch_scene
for (let sc = 1; sc <= 4; sc++) {
  const branchRes = await callTool('branch_scene', {
    action: 'commit',
    scene_number: sc,
    chosen_option_id: '1',
    chosen_narrative_summary: `Narrative beat for scene ${sc} describing the barista and the machine.`
  });
  assert(!branchRes.isError);
}

// Lock Assets
const lockAssetsRes = await callTool('lock_assets', {
  characters: [
    { id: 'CHAR_01', name: 'Luca', appearancePrompt: 'Italian barista in dark apron' }
  ],
  environments: [
    { id: 'BG_01', name: 'Milan Cafe', environmentPrompt: 'Historic espresso bar with marble counter' }
  ],
  product: {
    id: 'PROD_01',
    name: 'Veloce One',
    packagingAppearance: 'Polished mirror chrome espresso machine'
  }
});
assert(!lockAssetsRes.isError);

// Now in COMPILE_SHOTS: pitch_shot_concepts MUST succeed
const pitchConceptsRes = await callTool('pitch_shot_concepts', {
  scene_id: 'SCENE_01',
  shot_id: 'SHOT_01'
});
assert(!pitchConceptsRes.isError, 'pitch_shot_concepts must succeed in COMPILE_SHOTS');
console.log('  ✔ pitch_shot_concepts succeeds once assets are locked.');

// Compile shots for Scenes 1-3
for (let sc = 1; sc <= 3; sc++) {
  const compRes = await callTool('compile_sota_prompt', {
    scene_id: `SCENE_0${sc}`,
    shot_id: 'SHOT_01',
    selected_option: '1',
    visual_intent: `Visual intent for scene ${sc} shot 1`
  });
  assert(!compRes.isError);
  const compData = JSON.parse(compRes.content[0].text.slice(compRes.content[0].text.indexOf('{')));
  assert.equal(compData.workflow_complete, false);
}

// Compile shot for Scene 4 Shot 1 -> MUST stay in SCENE_4_SETUP and NOT complete prematurely
const scene4Shot1Res = await callTool('compile_sota_prompt', {
  scene_id: 'SCENE_04',
  shot_id: 'SHOT_01',
  selected_option: '1',
  visual_intent: 'Luca wipes down the chrome steam wand as steam diffuses in the sunrise light.'
});
assert(!scene4Shot1Res.isError);
const s4s1Data = JSON.parse(scene4Shot1Res.content[0].text.slice(scene4Shot1Res.content[0].text.indexOf('{')));
assert.equal(s4s1Data.workflow_complete, false, 'Scene 4 Shot 1 must NOT auto-complete workflow');
assert.equal(s4s1Data.current_stage, 'SCENE_4_SETUP', 'System must stay in SCENE_4_SETUP indefinitely');
console.log('  ✔ Scene 4 Shot 1 stayed in SCENE_4_SETUP without premature completion.');

// Compile shot for Scene 4 Shot 2 -> user locks multiple shots in Scene 4
const scene4Shot2Res = await callTool('compile_sota_prompt', {
  scene_id: 'SCENE_04',
  shot_id: 'SHOT_02',
  selected_option: '1',
  visual_intent: 'Luca pours the rich crema espresso with artisan precision.'
});
assert(!scene4Shot2Res.isError);
const s4s2Data = JSON.parse(scene4Shot2Res.content[0].text.slice(scene4Shot2Res.content[0].text.indexOf('{')));
assert.equal(s4s2Data.workflow_complete, false, 'Scene 4 Shot 2 must NOT auto-complete workflow');
assert.equal(s4s2Data.current_stage, 'SCENE_4_SETUP', 'System remains in SCENE_4_SETUP');
console.log('  ✔ Scene 4 Shot 2 added; system supports multiple shots per scene without auto-completing.');

// Verify State Preservation & Zero Truncation: all 4 scenes and shots intact on disk!
const sessionFileOnDisk = JSON.parse(
  fs.readFileSync(path.join(workspaceDir, '.nogyaan', 'sessions', `${testSessionId2}.json`), 'utf-8')
);
assert(Array.isArray(sessionFileOnDisk.scenes), 'scenes must exist as an array');
assert.equal(sessionFileOnDisk.scenes.length, 4, 'All 4 scenes must be preserved in the session file');
assert(sessionFileOnDisk.scenes[0].shots && Object.keys(sessionFileOnDisk.scenes[0].shots).length >= 1, 'Scene 1 shots preserved');
assert(sessionFileOnDisk.scenes[1].shots && Object.keys(sessionFileOnDisk.scenes[1].shots).length >= 1, 'Scene 2 shots preserved');
assert(sessionFileOnDisk.scenes[2].shots && Object.keys(sessionFileOnDisk.scenes[2].shots).length >= 1, 'Scene 3 shots preserved');
assert(sessionFileOnDisk.scenes[3].shots && Object.keys(sessionFileOnDisk.scenes[3].shots).length >= 2, 'Scene 4 multiple shots preserved');
assert(sessionFileOnDisk.scene_tags, 'scene_tags must be preserved');
console.log('  ✔ State Preservation Verified: All 4 scenes, all nested shots, and scene_tags preserved on disk with zero truncation.');

// Call finalize_storyboard -> explicitly completes storyboard and triggers finish line notice
const finalizeRes = await callTool('finalize_storyboard', {
  director_notes: 'Treatment approved for final production render.'
});
assert(!finalizeRes.isError);
const finalRaw = finalizeRes.content[0].text;
const finalData = JSON.parse(finalRaw.slice(finalRaw.indexOf('{')));

assert.equal(finalData.workflow_complete, true, 'workflow_complete must be true upon finalize_storyboard');
assert.equal(finalData.currentStage, 'COMPLETED', 'currentStage must be COMPLETED');
assert.equal(finalData.current_stage, 'COMPLETED', 'current_stage must be COMPLETED');
assert.equal(finalData.stage, 'COMPLETED', 'stage must be COMPLETED');
assert(finalRaw.includes('Your Director\'s Treatment is complete! Open http://localhost:4321'), 'Must include Finish Line congratulatory notice');
console.log('  ✔ finalize_storyboard successfully completed the workflow and returned Finish Line notification.');

// Clean up test sessions
try {
  fs.unlinkSync(path.join(workspaceDir, '.nogyaan', 'sessions', `${testSessionId1}.json`));
  fs.unlinkSync(path.join(workspaceDir, '.nogyaan', 'sessions', `${testSessionId2}.json`));
} catch {}

console.log('\n🎉 ALL STAGE PROGRESSION & FSM TOOL BOUNDS TESTS PASSED 100%!');
process.exit(0);
