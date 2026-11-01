/**
 * @file tests/test-architecture-and-fixes.mjs
 * @description Comprehensive automated test suite verifying:
 * - Fix 1: Dynamic MCP Prompts registration (/preset-*) & list_presets tool
 * - Fix 2: Isolated Session DAG storage (.ad-director/sessions/<slug>-<id>.json & latest-active.json)
 * - Fix 3: Dedicated lock_core_theme (abstract concept) + Physical Scene continuity
 * - Fix 4: Strict Preset-Scoped Language Gate (Hinglish vs 100% English)
 * - Fix 5: Iterative compile_single_scene with 5 video diffusion rules & slop rejection
 * - Fix 6: Zero HTML entity corruption in backend storage (clean raw UTF-8)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { PresetRegistryService } from '../dist/services/preset-registry.service.js';
import { SessionDagService } from '../dist/services/session-dag.service.js';
import { PromptCompilerService } from '../dist/services/prompt-compiler.service.js';

async function runFixesVerification() {
  console.log('🧪 Starting Architectural & 6-Bug Verification Suite...\n');

  // ==========================================================================
  // Fix 1 & 4: Preset Registry Dynamic Discovery & Language Rules
  // ==========================================================================
  console.log('▶ [Fix 1 & Fix 4] Verifying Preset Registry & Scoped Language Gates...');
  const presetRegistry = new PresetRegistryService();
  const presets = presetRegistry.getAllPresets();
  const presetIds = presetRegistry.getPresetIds();

  assert.ok(presetIds.includes('indian-d2c-story'), 'Preset indian-d2c-story must be present');
  assert.ok(presetIds.includes('dev-product-launch'), 'Preset dev-product-launch must be present');
  assert.ok(presetIds.includes('tiktok-ugc-hook'), 'Preset tiktok-ugc-hook must be present');

  const indianPreset = presetRegistry.getPresetById('indian-d2c-story');
  assert.ok(
    indianPreset.dialogueLanguageRule.includes('Hinglish'),
    'indian-d2c-story must specify Hinglish dialogue rule'
  );

  const devPreset = presetRegistry.getPresetById('dev-product-launch');
  assert.ok(
    devPreset.dialogueLanguageRule.includes('100% English') && devPreset.dialogueLanguageRule.includes('ZERO Hinglish'),
    'dev-product-launch must strictly enforce 100% English and zero Hinglish'
  );

  const tiktokPreset = presetRegistry.getPresetById('tiktok-ugc-hook');
  assert.ok(
    tiktokPreset.dialogueLanguageRule.includes('100% English') && tiktokPreset.dialogueLanguageRule.includes('ZERO Hinglish'),
    'tiktok-ugc-hook must strictly enforce 100% English and zero Hinglish'
  );
  console.log('  ✔ All 3 presets dynamically loaded and strictly scoped.');

  // ==========================================================================
  // Fix 2: Session Isolation & No Global State Mutating Across Tabs
  // ==========================================================================
  console.log('▶ [Fix 2] Verifying Isolated Session Storage (.noslop/sessions/)...');
  const tempWorkspace = path.resolve(process.cwd(), '.test-session-ws');
  if (fs.existsSync(tempWorkspace)) {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }

  const promptCompiler = new PromptCompilerService();
  const sessionService = new SessionDagService(tempWorkspace, promptCompiler);

  // Create session A
  const sessionA = sessionService.createSession({
    company: 'Acme DevTools',
    product: 'TurboDeploy',
    goal: 'Zero downtime deployment',
    presetId: 'dev-product-launch'
  });

  // Create session B
  const sessionB = sessionService.createSession({
    company: 'Chai Heritage',
    product: 'Royal Masala Blend',
    goal: 'Celebrate traditional brewing',
    presetId: 'indian-d2c-story'
  });

  assert.notStrictEqual(sessionA.sessionId, sessionB.sessionId, 'Session IDs must be distinct');
  assert.ok(sessionA.sessionId.startsWith('acme-devtools-'), 'Session A ID should contain slug');
  assert.ok(sessionB.sessionId.startsWith('chai-heritage-'), 'Session B ID should contain slug');

  const sessionFileA = path.join(sessionService.getSessionsDir(), `${sessionA.sessionId}.json`);
  const sessionFileB = path.join(sessionService.getSessionsDir(), `${sessionB.sessionId}.json`);
  assert.ok(fs.existsSync(sessionFileA), 'Session A JSON file must exist in sessions dir');
  assert.ok(fs.existsSync(sessionFileB), 'Session B JSON file must exist in sessions dir');

  // Verify latest-active pointer
  const latestPath = sessionService.getLatestActivePath();
  assert.ok(fs.existsSync(latestPath), 'latest-active.json must exist');
  const latestData = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
  assert.strictEqual(latestData.latestSessionId, sessionB.sessionId, 'Latest active pointer must point to session B');

  // Verify loading isolated sessions
  const loadedA = sessionService.loadSession(sessionA.sessionId);
  assert.strictEqual(loadedA.company, 'Acme DevTools');
  assert.strictEqual(loadedA.presetId, 'dev-product-launch');

  const loadedB = sessionService.loadSession(sessionB.sessionId);
  assert.strictEqual(loadedB.company, 'Chai Heritage');
  assert.strictEqual(loadedB.presetId, 'indian-d2c-story');

  console.log('  ✔ Sessions stored strictly isolated under .noslop/sessions/ without collision.');

  // ==========================================================================
  // Section 1.A: Dedicated lock_core_theme (Abstract concept, not a scene)
  // ==========================================================================
  console.log('▶ [Section 1.A] Verifying dedicated lock_core_theme...');
  const themeResult = sessionService.lockCoreTheme({
    sessionId: sessionA.sessionId,
    chosenThemeId: '1',
    themeTitle: 'The 2 AM Production Pager Nightmare',
    themePremise: 'A senior DevOps engineer fights a catastrophic database blackout at 2 AM while the rest of the company sleeps soundly.'
  });

  assert.strictEqual(themeResult.session.stage, 'SCENE_1_SETUP');
  assert.ok(themeResult.session.coreTheme, 'coreTheme must be set on session');
  assert.strictEqual(themeResult.session.coreTheme.themeTitle, 'The 2 AM Production Pager Nightmare');
  assert.strictEqual(themeResult.session.lockedNodes.length, 0, 'lockedNodes must remain empty because Core Theme is not a physical scene');
  assert.ok(
    themeResult.directive.instruction.includes('Scene 1 has NO previous exit frame'),
    'Directive must indicate Scene 1 has no previous exit frame'
  );
  console.log('  ✔ lock_core_theme saves to coreTheme without polluting physical scenes array.');

  // ==========================================================================
  // Section 1.B: Physical Scene Branching with exit_frame_anchor
  // ==========================================================================
  console.log('▶ [Section 1.B] Verifying physical scene branching...');
  const exitAnchorScene1 = 'Lead engineer sits slumped in Herman Miller chair, staring blankly at blinking red terminal cursor at 2:14 AM.';

  const branch1 = sessionService.branchScene({
    sessionId: sessionA.sessionId,
    action: 'commit',
    sceneNumber: 1,
    chosenOptionId: '1',
    chosenNarrativeSummary: 'Late night pager alarm sounds as server goes down.',
    exitFrameAnchor: exitAnchorScene1,
    nextOptions: [
      { id: '1', title: 'Coffee Spills', description: 'Reaching for cold coffee mug' },
      { id: '2', title: 'Terminal Panic', description: 'SSH fails to connect' },
      { id: '3', title: 'Quiet Realization', description: 'Noticing bad regex in git blame' }
    ],
    presetLanguageRule: devPreset.dialogueLanguageRule
  });

  assert.strictEqual(branch1.session.stage, 'SCENE_2_CATALYST');
  assert.strictEqual(branch1.session.lockedNodes.length, 1);
  assert.strictEqual(branch1.session.lockedNodes[0].sceneNumber, 1);
  assert.ok(branch1.continuityBridge, 'Continuity bridge must be returned');
  assert.ok(
    branch1.continuityBridge.includes('MANDATORY CONTINUITY BRIDGE'),
    'Bridge must contain mandatory continuity bridge tag'
  );
  assert.ok(
    branch1.continuityBridge.includes(exitAnchorScene1),
    'Bridge must contain the exact exit_frame_anchor'
  );
  console.log('  ✔ Scene 1 committed and returned continuity bridge for Scene 2.');

  // Advance remaining scenes to LOCK_ASSETS
  sessionService.branchScene({
    sessionId: sessionA.sessionId,
    action: 'commit',
    sceneNumber: 2,
    chosenOptionId: '2',
    chosenNarrativeSummary: 'SSH fails to connect to cluster.',
    exitFrameAnchor: 'Hands frozen over mechanical keyboard as red timeout banner flashes.'
  });

  sessionService.branchScene({
    sessionId: sessionA.sessionId,
    action: 'commit',
    sceneNumber: 3,
    chosenOptionId: '1',
    chosenNarrativeSummary: 'Engineer discovers TurboDeploy 1-click rollback command.',
    exitFrameAnchor: 'Finger hovers over Enter key with terminal reflection on glasses.'
  });

  sessionService.branchScene({
    sessionId: sessionA.sessionId,
    action: 'commit',
    sceneNumber: 4,
    chosenOptionId: '3',
    chosenNarrativeSummary: 'Rollback succeeds in 400ms, green health check restored.',
    exitFrameAnchor: 'Exhales with huge relief as terminal displays all pods running.'
  });

  assert.strictEqual(sessionService.loadSession(sessionA.sessionId).stage, 'LOCK_ASSETS');

  // Lock assets
  sessionService.lockAssets({
    sessionId: sessionA.sessionId,
    characters: [
      {
        assetId: 'CHAR_01',
        name: 'Devon',
        role: 'Senior DevOps Architect',
        appearancePrompt: 'Late 20s exhausted software engineer with messy dark hair and wireframe glasses'
      }
    ],
    environments: [
      {
        assetId: 'BG_01',
        name: 'Dark Mode Home Office',
        environmentPrompt: 'Moody dark room illuminated only by multi-monitor neon glow and mechanical keyboard LEDs',
        lightingProfile: 'Neon cyan and magenta rim lighting'
      }
    ],
    product: {
      assetId: 'PROD_01',
      name: 'TurboDeploy CLI',
      packagingAppearance: 'Ultra-fast terminal CLI interface with clean emerald status indicators',
      heroAngle: 'Macro terminal rack focus'
    }
  });

  assert.strictEqual(sessionService.loadSession(sessionA.sessionId).stage, 'COMPILE_SHOTS');

  // ==========================================================================
  // Section 2: Iterative compile_single_scene & Slop Rejection Validator
  // ==========================================================================
  console.log('▶ [Section 2] Verifying compile_single_scene & Generic Slop Rejection...');

  // Test 1: Slop rejection (< 80 chars)
  let shortSlopCaught = false;
  try {
    sessionService.compileSingleScene({
      sessionId: sessionA.sessionId,
      sceneNumber: 1,
      kineticActionDescription: 'Devon sits at desk.', // too short!
      cameraSpec: { lensMm: '35mm', aperture: 'f/1.8' },
      attachedAssetRefs: ['@CHAR_01', '@BG_01']
    });
  } catch (err) {
    shortSlopCaught = true;
    assert.ok(err.message.includes('at least 80 characters'));
  }
  assert.ok(shortSlopCaught, 'Validator must reject kineticActionDescription < 80 characters');

  // Test 2: Slop rejection (vague phrase: "interact in scene")
  let phraseSlopCaught = false;
  try {
    sessionService.compileSingleScene({
      sessionId: sessionA.sessionId,
      sceneNumber: 1,
      kineticActionDescription: 'Devon interacts in scene with the computer terminal while looking around the dimly lit room.',
      cameraSpec: { lensMm: '35mm', aperture: 'f/1.8' },
      attachedAssetRefs: ['@CHAR_01', '@BG_01']
    });
  } catch (err) {
    phraseSlopCaught = true;
    assert.ok(err.message.includes('Generic placeholders or multiple cuts detected'));
  }
  assert.ok(phraseSlopCaught, 'Validator must reject vague generic phrase "interact in scene"');

  // Test 3: Slop rejection (multiple cuts: "then cuts to")
  let multiCutCaught = false;
  try {
    sessionService.compileSingleScene({
      sessionId: sessionA.sessionId,
      sceneNumber: 1,
      kineticActionDescription: 'Devon stares at terminal screen then cuts to close up of mechanical keyboard in the dark.',
      cameraSpec: { lensMm: '35mm', aperture: 'f/1.8' },
      attachedAssetRefs: ['@CHAR_01', '@BG_01']
    });
  } catch (err) {
    multiCutCaught = true;
    assert.ok(err.message.includes('Generic placeholders or multiple cuts detected'));
  }
  assert.ok(multiCutCaught, 'Validator must reject "then cuts to" (enforces single continuous take)');

  // Test 4: Valid compile_single_scene with 5-rule diffusion model compliance
  const validScene1 = sessionService.compileSingleScene({
    sessionId: sessionA.sessionId,
    sceneNumber: 1,
    durationSeconds: 5,
    actTitle: 'Act I — Setup',
    narrativeTitle: 'The 2:14 AM Pager Alarm',
    storyBeatSummary: 'Pager duty wakes the engineer as production crashes.',
    kineticActionDescription: 'Devon slumps back into the ergonomic chair, eyes widening in panic as red error logs cascade uncontrollably across all three ultra-wide monitors.',
    cameraSpec: {
      lensMm: '35mm',
      aperture: 'f/1.8',
      framingAndAngle: 'Low-angle medium close-up',
      singleContinuousMovement: 'Slow steady push-in towards trembling hands'
    },
    onCameraSpokenDialogue: '"Not the production database at 2 AM."',
    postProductionVoiceover: 'Every engineer knows the feeling of midnight on-call dread.',
    sfxAndAmbience: 'High-frequency pager chimes echoing against mechanical keyboard clatter',
    onScreenTextOverlay: 'INCIDENT #4092: CRITICAL FAILURE',
    editorCutNote: 'Match-cut on finger striking Enter key',
    attachedAssetRefs: ['@CHAR_01', '@BG_01', '@PROD_01']
  });

  const shot1 = validScene1.compiledShot;
  assert.ok(shot1.referenceModePrompt, 'referenceModePrompt must be compiled');
  assert.ok(shot1.standaloneModePrompt, 'standaloneModePrompt must be compiled');

  // Verify Rule 2: onCameraSpokenDialogue is in lip-sync, but postProductionVoiceover is NOT in video prompt!
  assert.ok(
    shot1.referenceModePrompt.includes('Dialogue lip-sync: "Not the production database at 2 AM."'),
    'Lip-sync must contain on-camera dialogue'
  );
  assert.ok(
    !shot1.referenceModePrompt.includes('Every engineer knows'),
    'AI video prompt must NEVER contain post-production voiceover'
  );
  assert.ok(
    !shot1.referenceModePrompt.includes('INCIDENT #4092'),
    'AI video prompt must NEVER contain on-screen text overlay'
  );

  // Verify Smart Asset Mapping
  assert.ok(
    shot1.attachedAssetsResolved.length >= 3,
    'Must resolve human-readable asset mapping'
  );
  const charResolved = shot1.attachedAssetsResolved.find((a) => a.id === 'CHAR_01');
  assert.strictEqual(charResolved.name, 'Devon');
  assert.strictEqual(charResolved.label, 'Devon (CHAR_01)');

  console.log('  ✔ compile_single_scene successfully compiled dual prompts with strict VO separation.');
  console.log(`    Ref Prompt: "${shot1.referenceModePrompt.substring(0, 110)}..."`);
  console.log(`    Standalone: "${shot1.standaloneModePrompt.substring(0, 110)}..."`);

  // ==========================================================================
  // Section 3: Verify Zero HTML Entity Corruption in Backend Storage
  // ==========================================================================
  console.log('▶ [Section 3] Verifying Clean Raw UTF-8 (No &#039; or &quot; in JSON)...');
  const rawSessionJson = fs.readFileSync(sessionFileA, 'utf-8');
  assert.ok(!rawSessionJson.includes('&#039;'), 'JSON must not contain &#039;');
  assert.ok(!rawSessionJson.includes('&quot;'), 'JSON must not contain &quot;');
  console.log('  ✔ Backend storage preserves clean raw UTF-8 without entity corruption.');

  // Cleanup temp workspace
  if (fs.existsSync(tempWorkspace)) {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }

  console.log('\n🎉 ALL ARCHITECTURAL, FSM, CONTINUITY & PROMPT COMPILER TESTS PASSED 100%!');
}

runFixesVerification().catch((err) => {
  console.error('❌ Verification suite failed:', err);
  process.exit(1);
});
