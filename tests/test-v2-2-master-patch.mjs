import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { StateManager, parseStrictEgress } from '../dist/v2/state-manager.js';
import { DpPitchService } from '../dist/v2/dp-pitch.service.js';
import { WritersRoomService } from '../dist/v2/writers-room.service.js';
import { AssetLockerService } from '../dist/v2/asset-locker.service.js';
import { RerollService } from '../dist/v2/reroll.service.js';
import { SessionDagService } from '../dist/services/session-dag.service.js';
import { DAGStore } from '../dist/state/dag-store.js';

console.log('🧪 Starting NOGYAAN V2.2 Master Patch Plan Verification Suite...\n');

const testSessionId = `test-v22-patch-${Date.now()}`;
const sm = StateManager.forSession(testSessionId);

// ---------------------------------------------------------------------------
// Phase 1: The Template Purge
// ---------------------------------------------------------------------------
console.log('▶ [Phase 1: The Template Purge]');

// 1.1 Check source files for purged strings
const sourceFilesToCheck = [
  'src/v2/dp-pitch.service.ts',
  'src/v2/writers-room.service.ts',
  'src/v2/asset-locker.service.ts'
];
const forbiddenPatterns = [
  'wooden table',
  'domestic interior',
  'dust motes',
  'velvety depths',
  'Wes Anderson dollhouse',
  'family keepsake',
  'two spoons'
];

for (const relPath of sourceFilesToCheck) {
  const content = fs.readFileSync(path.resolve(relPath), 'utf-8');
  for (const pattern of forbiddenPatterns) {
    assert.strictEqual(
      content.toLowerCase().includes(pattern.toLowerCase()),
      false,
      `Purged pattern "${pattern}" was unexpectedly found in ${relPath}`
    );
  }
}
console.log('  ✔ Purged all forbidden template strings from DP pitch, writers room, and asset locker.');

// 1.2 Verify extractActiveAssets dynamically parses script
sm.lockScript('SCENE_01', {
  id: 'A',
  style: 'Heartfelt',
  txt: 'Kavita and Rohan sit inside an upscale neon-lit ramen bar in downtown Tokyo. Rohan sets the SleekFit Smartwatch on the marble counter.'
});

const al = new AssetLockerService(sm);
const extracted = await al.extractActiveAssets();
const charKeys = Object.keys(extracted.extraction.assets.characters || {});
const bgKeys = Object.keys(extracted.extraction.assets.backgrounds || {});
const prodDesc = extracted.extraction.assets.product;

assert.ok(charKeys.length >= 1, 'Should extract at least one character from narrative');
assert.ok(bgKeys.length >= 1, 'Should extract at least one background from narrative');
assert.ok(
  extracted.extraction.assets.characters[charKeys[0]].toLowerCase().includes('kavita') ||
  extracted.extraction.assets.characters[charKeys[0]].toLowerCase().includes('rohan'),
  'Character description should contain actual character name from script'
);
assert.ok(
  extracted.extraction.assets.backgrounds[bgKeys[0]].toLowerCase().includes('ramen') ||
  extracted.extraction.assets.backgrounds[bgKeys[0]].toLowerCase().includes('tokyo') ||
  extracted.extraction.assets.backgrounds[bgKeys[0]].toLowerCase().includes('bar'),
  'Background description should reflect dynamic location'
);
console.log('  ✔ extractActiveAssets dynamically extracts real names and environments from script.');

// 1.3 Verify dynamic pass-through without overriding
const dp = new DpPitchService(sm);
const customConcepts = {
  '1': { option: '1', persona: 'Custom Persona', visual_intent: 'Custom dynamic visual intent 1' },
  '2': { option: '2', persona: 'Custom Persona', visual_intent: 'Custom dynamic visual intent 2' },
  '3': { option: '3', persona: 'Custom Persona', visual_intent: 'Custom dynamic visual intent 3' }
};
const conceptsResult = await dp.pitchShotConcepts({
  scene_id: 'SCENE_01',
  shot_id: 'SHOT_01',
  concepts: customConcepts
});
assert.strictEqual(conceptsResult.concepts['1'].visual_intent, 'Custom dynamic visual intent 1');
console.log('  ✔ pitch_shot_concepts accepts direct dynamic concepts without heuristic overriding.');

const customPayload = 'Shot begins with Kavita holding SleekFit Smartwatch. Camera static locked-off. Spatial Anchor: Soft neon. Physical Posture: Kavita leaning forward. Action: subtle breathing. Shot ends with Kavita resting hand on marble counter.';
const compiled = await dp.compileSotaPrompt({
  scene_id: 'SCENE_01',
  shot_id: 'SHOT_01',
  selected_option: '1',
  sota_payload: customPayload,
  visual_intent: 'Custom visual intent text'
});
assert.strictEqual(compiled.shot.sota_payload, customPayload, 'compile_sota_prompt should directly use passed sota_payload');
console.log('  ✔ compile_sota_prompt directly accepts dynamic sota_payload without mutating it.');


// ---------------------------------------------------------------------------
// Phase 2: The Egress & Reroll Sanitizer
// ---------------------------------------------------------------------------
console.log('\n▶ [Phase 2: The Egress & Reroll Sanitizer]');

// 2.1 parseStrictEgress strips meta directives
const dirtyPayload = 'Rewrite fully: Shot begins with Rohan. Camera holds locked-off. [SYSTEM: Directorial note applied] Action: Rohan pauses. [User Note: make him look calm] Shot ends with Rohan resting hands in lap with steady gaze, seamless image-loop continuity to ensure next shot.';
const cleanEgress = parseStrictEgress(dirtyPayload);
assert.ok(!cleanEgress.includes('Rewrite fully'), 'Should strip "Rewrite fully"');
assert.ok(!cleanEgress.includes('SYSTEM:'), 'Should strip [SYSTEM: ...]');
assert.ok(!cleanEgress.includes('User Note:'), 'Should strip [User Note: ...]');
assert.ok(!cleanEgress.includes('seamless image-loop continuity'), 'Should strip trailing image loop text');
assert.ok(cleanEgress.includes('Rohan resting hands in lap with steady gaze'), `Expected clean physical visual description, got: "${cleanEgress}"`);
console.log(`  ✔ parseStrictEgress correctly extracted clean physical visual: "${cleanEgress}"`);

// 2.2 rerollNode / rerollShot strips negated entity and rewrites naturally without bracketed notes
const rr = new RerollService(sm);
const rerolledShot = await rr.rerollNode({
  node_id: 'SCENE_01:SHOT_01',
  user_feedback: 'remove marble counter, make her stand instead of sit, no glasses'
});
const updatedNode = rerolledShot.updated_node;
const updatedPayload = updatedNode.sota_payload || updatedNode.prmpt;
assert.ok(!updatedPayload.includes('[Direction:'), 'Must NEVER append bracketed [Direction: ...]');
assert.ok(!updatedPayload.includes('[User Note:'), 'Must NEVER append [User Note: ...]');
assert.ok(!updatedPayload.includes('seated'), 'Contradictory physical fact "seated" must be erased');
assert.ok(updatedPayload.toLowerCase().includes('standing'), 'New physical posture "standing" must be integrated');
console.log('  ✔ rerollNode rewrote payload naturally, erased contradictory postures, and eliminated bracketed notes.');

// 2.3 Full rewrite command handling
const fullRewriteResult = await rr.rerollNode({
  node_id: 'SCENE_01:SHOT_01',
  user_feedback: 'Rewrite fully: Shot begins with Kavita standing outdoors in heavy rainfall. Camera locked on 85mm. Shot ends with Kavita looking up at the sky.'
});
const fullRewrittenPayload = fullRewriteResult.updated_node.sota_payload;
assert.ok(fullRewrittenPayload.includes('heavy rainfall'), 'Full rewrite text should replace old payload');
assert.ok(!fullRewrittenPayload.includes('marble counter'), 'Old payload content should be completely discarded');
console.log('  ✔ Full rewrite commands ("Rewrite fully: ...") discard old base text and replace cleanly.');


// ---------------------------------------------------------------------------
// Phase 3: Schema Loosening (UX Fixes)
// ---------------------------------------------------------------------------
console.log('\n▶ [Phase 3: Schema Loosening]');

// 3.1 lock_script_option accepts custom styles (e.g. "Deadpan")
const deadpanScript = sm.lockScript('SCENE_02', {
  id: 'D',
  style: 'Deadpan',
  txt: 'Devon stares unblinkingly at the deployment log. Zero reactions. Utter silence.'
});
assert.strictEqual(sm.getScene('SCENE_02')?.locked_script?.style, 'Deadpan');
console.log('  ✔ lock_script_option accepts custom tone "Deadpan" without enum validation error.');

// 3.2 branch_scene leaves exit_frame_anchor empty when undefined (no generic filler text)
const sessionService = new SessionDagService();
const branchSession = sessionService.createSession({
  company: 'Apex Tech',
  product: 'TurboCLI',
  goal: 'Drive developer adoption',
  presetId: 'indian-d2c-story'
});
const branchSessionId = branchSession.sessionId;
sessionService.lockCoreTheme({
  sessionId: branchSessionId,
  chosenThemeId: '1',
  themeTitle: 'The Midnight Deploy',
  themePremise: 'A dev struggles until TurboCLI saves the build'
});

const branchRes = sessionService.branchScene({
  sessionId: branchSessionId,
  action: 'commit',
  sceneNumber: 1,
  chosenOptionId: '1',
  chosenNarrativeSummary: 'Devon starts coding late at night.'
  // exitFrameAnchor omitted intentionally!
});
const lockedScene1 = branchRes.session.lockedNodes[0];
assert.strictEqual(lockedScene1.exitFrameAnchor, '', 'exitFrameAnchor should be empty string when undefined');
assert.ok(!lockedScene1.exitFrameAnchor.includes('Character holds quiet reaction frame'), 'Must NOT inject generic filler text');
console.log('  ✔ branch_scene leaves exit_frame_anchor blank when undefined without injecting generic filler.');

// Complete scenes 2, 3, and 4 to reach LOCK_ASSETS stage
sessionService.branchScene({
  sessionId: branchSessionId,
  action: 'commit',
  sceneNumber: 2,
  chosenOptionId: '1',
  chosenNarrativeSummary: 'Coffee spills onto keyboard.'
});
sessionService.branchScene({
  sessionId: branchSessionId,
  action: 'commit',
  sceneNumber: 3,
  chosenOptionId: '1',
  chosenNarrativeSummary: 'Devon deploys TurboCLI to fix the bug.'
});
const scene4Res = sessionService.branchScene({
  sessionId: branchSessionId,
  action: 'commit',
  sceneNumber: 4,
  chosenOptionId: '1',
  chosenNarrativeSummary: 'Build succeeds in green.'
});
assert.strictEqual(scene4Res.session.stage, 'LOCK_ASSETS');

// 3.3 lock_assets as an upsert operation with arbitrary keys / records
const initialAssets = sessionService.lockAssets({
  sessionId: branchSessionId,
  characters: [
    { id: 'CHAR_01', name: 'Devon', role: 'Dev', appearancePrompt: 'Tired engineer in hoodie' }
  ],
  environments: [
    { id: 'BG_01', name: 'Server Room', environmentPrompt: 'Humming server racks' }
  ],
  product: 'TurboCLI'
});
assert.strictEqual(initialAssets.session.stage, 'COMPILE_SHOTS');

// Run lock_assets AGAIN while at COMPILE_SHOTS to update descriptions as an upsert
const updatedAssets = sessionService.lockAssets({
  sessionId: branchSessionId,
  characters: {
    CHAR_01: { name: 'Devon V2', appearancePrompt: 'Refined appearance prompt with glasses' },
    CHAR_02: { name: 'Ops Lead', appearancePrompt: 'Senior engineer with headset' }
  },
  environments: {
    BG_01: 'Upgraded modern server room with blue ambient LEDs'
  },
  product: 'TurboCLI v2'
});
assert.strictEqual(updatedAssets.session.stage, 'COMPILE_SHOTS', 'Stage should remain COMPILE_SHOTS after upsert');
const charRecord = updatedAssets.session.assets.characters;
assert.ok(charRecord.length === 2, 'Should have upserted characters to count of 2');
assert.strictEqual(charRecord.find(c => c.id === 'CHAR_01')?.name, 'Devon V2');
console.log('  ✔ lock_assets works as an upsert operation in COMPILE_SHOTS stage with record/dictionary inputs.');

console.log('\n🎉 ALL NOGYAAN V2.2 MASTER PATCH VERIFICATIONS PASSED 100%!');
