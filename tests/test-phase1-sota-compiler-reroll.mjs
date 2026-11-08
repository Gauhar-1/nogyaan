// tests/test-phase1-sota-compiler-reroll.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { StateManager } from '../dist/v2/state-manager.js';
import { DpPitchService } from '../dist/v2/dp-pitch.service.js';
import { RerollService } from '../dist/v2/reroll.service.js';
import { rerollNodeSchema, rerollShotSchema } from '../dist/mcp/tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceDir = path.resolve(__dirname, '..');

console.log('🧪 Starting Phase 1: SOTA Compiler & Re-roll Logic Verification Suite...\n');

// ============================================================================
// Section 1: Dynamic SOTA Compiler (compile_sota_prompt)
// ============================================================================
console.log('🔹 [Test 1] Dynamic SOTA Compiler: Template Purge & Handoff Logic...');

const testSessionId = `test-compiler-${Date.now().toString(36)}`;
const sm = StateManager.forSession(testSessionId, workspaceDir);

// Set up assets in the dag-store
sm.updateAssetBible({
  characters: {
    CHAR_01: 'Aarav, 30, architect with rolled-up linen shirt and horn-rimmed glasses'
  },
  backgrounds: {
    BG_01: 'Brutalist concrete studio with floor-to-ceiling glass looking over misty hills'
  },
  product: 'Minimalist Titanium Pen'
});

const dp = new DpPitchService(sm);

// 1. Scene 1 Shot 1: Handoff logic (omit Temporal Handshake / Ingress)
const explicitShot1Desc = 'Aarav thoughtfully traces the contour of the blueprint before picking up the titanium pen.';
const compiledS1S1 = await dp.compileSotaPrompt({
  scene_id: 'SCENE_01',
  shot_id: 'SHOT_01',
  selected_option: '1', // Auteur
  visual_intent: explicitShot1Desc
});

const payload1 = compiledS1S1.shot.sota_payload;

// Constraint A: Omit Ingress for Scene 1 Shot 1
assert(
  !payload1.includes('Shot begins with'),
  'Scene 1 Shot 1 MUST completely omit the Temporal Handshake / Ingress line'
);
console.log('  ✔ Handoff Logic: Scene 1 Shot 1 completely omits Ingress continuity line.');

// Constraint B: Remove hardcoding ("static locked-off tripod", "soft window light", "wooden table")
assert(!payload1.toLowerCase().includes('static locked-off tripod'), 'Must NOT contain "static locked-off tripod"');
assert(!payload1.toLowerCase().includes('soft window light'), 'Must NOT contain "soft window light"');
assert(!payload1.toLowerCase().includes('wooden table'), 'Must NOT contain "wooden table"');
console.log('  ✔ Template Purge: Prompt generation is free of fixed templates.');

// Constraint C: Dynamic Assembly (User description + @CHAR/@BG assets + computed camera physics)
assert(payload1.includes(explicitShot1Desc), 'Must contain user explicit shot description');
assert(payload1.includes('@CHAR_01 (Aarav, 30, architect with rolled-up linen shirt and horn-rimmed glasses)'), 'Must contain @CHAR_01 definition from dag-store');
assert(payload1.includes('@BG_01 (Brutalist concrete studio with floor-to-ceiling glass looking over misty hills)'), 'Must contain @BG_01 definition from dag-store');
assert(payload1.includes('Camera Physics [Auteur]'), 'Must contain computed camera physics for Auteur style');
console.log('  ✔ Dynamic Assembly: Concat of user description + @CHAR/@BG asset definitions + computed camera physics verified.');

// Constraint D: Real Egress computed and stored
assert(compiledS1S1.last_shot_egress.length > 0, 'Must compute real egress');
assert(payload1.includes('Shot ends with'), 'Payload must include terminating visual');
assert(
  !compiledS1S1.last_shot_egress.includes('holds steady resting posture beside @PROD_01, eyes locked in calm focus'),
  'Must NOT use the old hardcoded egress template'
);

const scene1State = sm.getScene('SCENE_01');
assert.equal(
  scene1State.last_shot_egress,
  compiledS1S1.last_shot_egress,
  'Real computed visual end-frame must be saved in scene.last_shot_egress egress memory'
);
console.log(`  ✔ Real Egress: Stored visual end-frame in egress memory: "${compiledS1S1.last_shot_egress}".`);

// 2. Scene 1 Shot 2: Ingress Handshake with preceding egress
console.log('\n🔹 [Test 2] Handoff Continuity on Subsequent Shot (Scene 1 Shot 2)...');
const explicitShot2Desc = 'Aarav sprints briskly toward the drafting table with intense kinetic momentum.';
const compiledS1S2 = await dp.compileSotaPrompt({
  scene_id: 'SCENE_01',
  shot_id: 'SHOT_02',
  selected_option: '2', // Kinetic
  visual_intent: explicitShot2Desc
});

const payload2 = compiledS1S2.shot.sota_payload;
assert(
  payload2.includes('Shot begins with'),
  'Subsequent shot (Scene 1 Shot 2) MUST include Temporal Handshake / Ingress'
);
assert(
  payload2.includes(compiledS1S1.last_shot_egress),
  'Shot 2 Ingress must match Shot 1 computed real egress'
);
assert(payload2.includes('Camera Physics [Kinetic]'), 'Must derive Kinetic camera physics');
console.log('  ✔ Temporal Handshake: Shot 2 correctly receives Shot 1 real egress into Ingress.');

// 3. Test Theatrical Style Camera Physics
console.log('\n🔹 [Test 3] Theatrical Style Camera Physics...');
const compiledTheatrical = await dp.compileSotaPrompt({
  scene_id: 'SCENE_01',
  shot_id: 'SHOT_03',
  selected_option: '3', // Theatrical
  visual_intent: 'Symmetrical dead-center architectural alignment of Aarav.'
});
assert(compiledTheatrical.shot.sota_payload.includes('Camera Physics [Theatrical]'));
console.log('  ✔ Theatrical camera physics correctly generated.');

// ============================================================================
// Section 2: Destructive Re-roll (reroll_shot & reroll_node)
// ============================================================================
console.log('\n🔹 [Test 4] Destructive Re-roll: Schema Updates & Complete Overwrite...');

// 1. Verify Zod schemas accept new_visual_intent and new_sota_payload
const testNodeInput = {
  session_id: testSessionId,
  node_id: 'SCENE_01:SHOT_01',
  new_visual_intent: 'Completely new visual intent for Aarav standing upright.',
  new_sota_payload: 'Shot begins with Aarav standing in the center. Camera glides forward. Shot ends with Aarav smiling.'
};

const parsedNode = rerollNodeSchema.parse(testNodeInput);
assert.equal(parsedNode.new_visual_intent, testNodeInput.new_visual_intent);
assert.equal(parsedNode.new_sota_payload, testNodeInput.new_sota_payload);

const testShotInput = {
  session_id: testSessionId,
  scene_id: 'SCENE_01',
  shot_id: 'SHOT_01',
  new_visual_intent: 'Completely new visual intent for shot reroll.',
  new_sota_payload: 'Shot begins with new payload. Camera static. Shot ends with steady focus.'
};

const parsedShot = rerollShotSchema.parse(testShotInput);
assert.equal(parsedShot.new_visual_intent, testShotInput.new_visual_intent);
assert.equal(parsedShot.new_sota_payload, testShotInput.new_sota_payload);
console.log('  ✔ Schema Update: reroll_node and reroll_shot schemas accept new_visual_intent and new_sota_payload.');

// 2. Destructive Overwrite in RerollService
const rr = new RerollService(sm);
const rerollResult = await rr.rerollNode({
  node_id: 'SCENE_01:SHOT_01',
  new_visual_intent: 'DESTRUCTIVE_INTENT_OVERWRITE: Aarav observing the sunset.',
  new_sota_payload: 'DESTRUCTIVE_PAYLOAD_OVERWRITE: Camera glides on 50mm axis. Aarav holds pen. Shot ends with Aarav looking directly into lens.'
});

const updatedNode = rerollResult.updated_node;
assert.equal(
  updatedNode.visual_intent,
  'DESTRUCTIVE_INTENT_OVERWRITE: Aarav observing the sunset.',
  'visual_intent must be a destructive overwrite'
);
assert.equal(
  updatedNode.sota_payload,
  'DESTRUCTIVE_PAYLOAD_OVERWRITE: Camera glides on 50mm axis. Aarav holds pen. Shot ends with Aarav looking directly into lens.',
  'sota_payload must be a destructive overwrite'
);

// Verify that it completely replaced rather than appending to old text
assert(!updatedNode.sota_payload.includes(payload1), 'Must NOT contain any of the old payload text');
assert(!updatedNode.visual_intent.includes(explicitShot1Desc), 'Must NOT contain any of the old visual intent text');
assert(!updatedNode.sota_payload.includes('['), 'Must NOT contain appended bracketed notes');

// Verify disk persistence in stateManager
const sc1AfterReroll = sm.getScene('SCENE_01');
const shot1AfterReroll = sc1AfterReroll.shots['SHOT_01'];
assert.equal(shot1AfterReroll.sota_payload, 'DESTRUCTIVE_PAYLOAD_OVERWRITE: Camera glides on 50mm axis. Aarav holds pen. Shot ends with Aarav looking directly into lens.');
assert.equal(shot1AfterReroll.visual_intent, 'DESTRUCTIVE_INTENT_OVERWRITE: Aarav observing the sunset.');

// Verify real egress was updated from the new overwritten payload
assert.equal(sc1AfterReroll.last_shot_egress, 'Aarav looking directly into lens');
console.log('  ✔ Overwrite, don\'t Append: Destructive overwrite completely replaced old text and updated egress memory.');

// Clean up test session file
try {
  const sessionFilePath = path.resolve(workspaceDir, '.nogyaan', 'sessions', `${testSessionId}.json`);
  if (fs.existsSync(sessionFilePath)) {
    fs.unlinkSync(sessionFilePath);
  }
} catch {}

console.log('\n🎉 ALL PHASE 1: SOTA COMPILER & RE-ROLL TESTS PASSED 100%!');
process.exit(0);
