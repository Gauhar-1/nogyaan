/**
 * @file tests/test-architecture-and-fixes.mjs
 * @description Comprehensive automated test suite verifying Fixes 1 through 6:
 * - Fix 1: Dynamic MCP Prompts registration (/preset-*) & list_presets tool
 * - Fix 2: Isolated Session DAG storage (.ad-director/sessions/<slug>-<id>.json & latest-active.json)
 * - Fix 3: Strict Scene-to-Scene Continuity Lock (exit_frame_anchor)
 * - Fix 4: Strict Preset-Scoped Language Gate (Hinglish vs 100% English)
 * - Fix 5: Reference-Tagged Kinetic Prompts (@CHAR_01, @BG_01, @PROD_01)
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
  // Fix 1: Preset Registry Dynamic Discovery & Language Rules
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
  console.log('▶ [Fix 2] Verifying Isolated Session Storage (.ad-director/sessions/)...');
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

  console.log('  ✔ Sessions stored strictly isolated under .ad-director/sessions/ without collision.');

  // ==========================================================================
  // Fix 3: Scene-to-Scene Continuity Lock (exit_frame_anchor)
  // ==========================================================================
  console.log('▶ [Fix 3] Verifying Physical Continuity Bridge (exit_frame_anchor)...');
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

  assert.strictEqual(branch1.session.stage, 'SCENE_1_SETUP');
  assert.ok(branch1.continuityBridge, 'Continuity bridge must be returned');
  assert.ok(
    branch1.continuityBridge.includes('MANDATORY CONTINUITY BRIDGE'),
    'Bridge must contain mandatory continuity bridge tag'
  );
  assert.ok(
    branch1.continuityBridge.includes(exitAnchorScene1),
    'Bridge must contain the exact exit_frame_anchor'
  );
  assert.ok(
    branch1.continuityBridge.includes('100% English'),
    'Bridge must include dev-product-launch English language rule'
  );
  console.log('  ✔ Continuity bridge successfully generated with exit_frame_anchor and language rule.');

  // ==========================================================================
  // Fix 5: Reference-Tagged Kinetic Prompts (@CHAR_01, @BG_01, @PROD_01)
  // ==========================================================================
  console.log('▶ [Fix 5] Verifying Reference-Tagged Kinetic Prompts & Asset Validation...');

  // Lock assets for Session A
  // Advance through remaining stages to LOCK_ASSETS
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

  // Scene 4 Climax to Lock Assets
  sessionService.branchScene({
    sessionId: sessionA.sessionId,
    action: 'commit',
    sceneNumber: 5,
    chosenOptionId: '1',
    chosenNarrativeSummary: 'Team celebrates in Slack: Zero downtime deployment achieved.',
    exitFrameAnchor: 'Slack channel erupts with dancing parrot emojis.'
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

  // Test invalid asset reference
  let integrityFailed = false;
  try {
    sessionService.compileShots({
      sessionId: sessionA.sessionId,
      shots: [
        {
          sceneNumber: 1,
          durationSeconds: 5,
          storyBeatSummary: 'Late night incident',
          entryFrameBridge: 'Connecting from black screen',
          screenplayAction: '@CHAR_01 slumps into chair',
          spokenDialogue: '"Not the database again."',
          sfxAndAmbience: 'Heavy mechanical keyboard clatter and pager chime',
          editorCutNote: 'Cut on cursor blink',
          cameraSpec: { lensMm: '35mm', aperture: 'f/1.8', angle: 'LOW_ANGLE', movement: 'DOLLY_IN' },
          attachedAssetRefs: ['@CHAR_01', '@BG_99'] // BG_99 does not exist!
        }
      ]
    });
  } catch (err) {
    integrityFailed = true;
    assert.ok(err.message.includes('REFERENTIAL INTEGRITY VIOLATION'));
    assert.ok(err.message.includes('@BG_99'));
  }
  assert.ok(integrityFailed, 'compileShots must reject unlisted @BG_99 asset');

  // Valid compilation
  const compiledResult = sessionService.compileShots({
    sessionId: sessionA.sessionId,
    shots: [
      {
        sceneNumber: 1,
        durationSeconds: 5,
        storyBeatSummary: 'Late night incident',
        entryFrameBridge: 'Fade in on dark office',
        screenplayAction: '@CHAR_01 slumps back in chair, rubbing temples as error logs cascade on monitor',
        spokenDialogue: '"Not the database again."',
        sfxAndAmbience: 'Heavy mechanical keyboard clatter and urgent pager chime',
        editorCutNote: 'Cut on cursor blink',
        cameraSpec: { lensMm: '35mm', aperture: 'f/1.8', angle: 'LOW_ANGLE', movement: 'DOLLY_IN' },
        attachedAssetRefs: ['@CHAR_01', '@BG_01', '@PROD_01']
      }
    ]
  });

  assert.strictEqual(compiledResult.session.stage, 'COMPLETED');
  const shot1 = compiledResult.compiledShots[0];
  assert.ok(
    shot1.aiVideoPrompt.startsWith('[Refs: @CHAR_01, @BG_01, @PROD_01]'),
    'Compiled prompt must start with [Refs: @CHAR_01, @BG_01, @PROD_01]'
  );
  assert.ok(
    shot1.aiVideoPrompt.includes('35mm f/1.8, LOW_ANGLE, DOLLY_IN.'),
    'Compiled prompt must contain camera geometry'
  );
  assert.ok(
    shot1.aiVideoPrompt.includes('Dialogue lip-sync: "\\"Not the database again.\\""') ||
    shot1.aiVideoPrompt.includes('Dialogue lip-sync: ""Not the database again.""'),
    'Compiled prompt must contain exact dialogue lip-sync'
  );
  assert.ok(
    shot1.aiVideoPrompt.includes('Audio: Heavy mechanical keyboard clatter and urgent pager chime'),
    'Compiled prompt must contain audio'
  );
  console.log('  ✔ Reference-tagged kinetic prompt compiled deterministically:');
  console.log(`    "${shot1.aiVideoPrompt}"`);

  // ==========================================================================
  // Fix 6: Zero HTML Entity Escaping in Backend Storage
  // ==========================================================================
  console.log('▶ [Fix 6] Verifying Clean Raw UTF-8 (No &#039; or &quot; in JSON)...');
  const rawSessionJson = fs.readFileSync(sessionFileA, 'utf-8');
  assert.ok(
    !rawSessionJson.includes('&#039;'),
    'Backend JSON storage must NOT contain double-escaped apostrophes (&#039;)'
  );
  assert.ok(
    !rawSessionJson.includes('&quot;'),
    'Backend JSON storage must NOT contain double-escaped quotes (&quot;)'
  );
  assert.ok(
    !rawSessionJson.includes('&amp;'),
    'Backend JSON storage must NOT contain double-escaped ampersands (&amp;)'
  );
  console.log('  ✔ Backend storage preserves clean raw UTF-8 without entity corruption.');

  // Cleanup temp workspace
  if (fs.existsSync(tempWorkspace)) {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }

  console.log('\n🎉 ALL 6 ARCHITECTURAL & FIX VERIFICATIONS PASSED 100%!');
}

runFixesVerification().catch((err) => {
  console.error('❌ Verification suite failed:', err);
  process.exit(1);
});
