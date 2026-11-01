/**
 * @file tests/run-verification.mjs
 * @description Automated test runner testing the compiled dist build.
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  DAGStore,
  OUTPUT_DIR,
  STORY_GRAPH_PATH,
  sanitizeBrandOrProjectName,
  validateNoCameraJargon,
  ANTI_JARGON_VIOLATION_MESSAGE,
  escapeHtml,
  sanitizeObjectForHtml,
} from "../dist/state/dag-store.js";
import { executeInitBrief } from "../dist/tools/1-init-brief.js";
import { executeBranchScene } from "../dist/tools/2-branch-scene.js";
import { executeLockAssets } from "../dist/tools/3-lock-assets.js";
import { executeCompileShots } from "../dist/tools/4-compile-shots.js";

async function runTests() {
  console.log("🎬 Starting Hardened FSM & Guardrails Verification Suite (Compiled Dist)...\n");

  // ==========================================================================
  // Test 1: Path Safety & Sanitization
  // ==========================================================================
  console.log("▶ [Test 1] Verifying Path Safety, Sanitization & Workspace Resolution...");
  assert.strictEqual(
    sanitizeBrandOrProjectName("Chai & Sons @ 100% / Best!"),
    "Chai___Sons___100____Best_",
    "Brand name should have non-alphanumeric characters replaced by underscore"
  );
  assert.ok(
    OUTPUT_DIR.endsWith(".noslop") || OUTPUT_DIR.endsWith(".ad-director"),
    "Output directory must end with .noslop or .ad-director"
  );

  // Test AD_DIRECTOR_WORKSPACE environment variable override
  const originalEnv = process.env.AD_DIRECTOR_WORKSPACE;
  const customWorkspace = path.resolve(process.cwd(), ".custom-test-ws");
  process.env.AD_DIRECTOR_WORKSPACE = customWorkspace;
  const customStore = new DAGStore();
  assert.strictEqual(
    customStore.getWorkspaceDir(),
    customWorkspace,
    "DAGStore must honor AD_DIRECTOR_WORKSPACE environment variable"
  );
  // Cleanup custom workspace
  if (fs.existsSync(customWorkspace)) {
    fs.rmSync(customWorkspace, { recursive: true, force: true });
  }
  if (originalEnv) {
    process.env.AD_DIRECTOR_WORKSPACE = originalEnv;
  } else {
    delete process.env.AD_DIRECTOR_WORKSPACE;
  }
  console.log("  ✔ Path safety, name sanitization, and workspace override passed.");

  // ==========================================================================
  // Test 2: Anti-Jargon Gate
  // ==========================================================================
  console.log("▶ [Test 2] Verifying Anti-Jargon Gate...");
  const forbiddenTerms = [
    "Shot on 35mm lens",
    "Close up with 85mm",
    "f/1.4 aperture beauty",
    "Anamorphic cinematic style",
    "16:9 aspect ratio",
    "9:16 vertical crop",
    "Heavy bokeh background",
    "24mm wide angle",
    "50mm prime",
  ];

  for (const term of forbiddenTerms) {
    let errorCaught = false;
    try {
      validateNoCameraJargon([term]);
    } catch (err) {
      errorCaught = true;
      assert.strictEqual(
        err.message,
        ANTI_JARGON_VIOLATION_MESSAGE,
        `Error message must match exact specification for term '${term}'`
      );
    }
    assert.ok(errorCaught, `Anti-jargon gate must reject term: ${term}`);
  }

  // Allowed emotional text
  validateNoCameraJargon([
    "Warm nostalgic evening with father and son",
    "Intimate close-up of weathered hands pouring cutting chai",
    "Piyush Pandey emotional heartstring moment",
  ]);
  console.log("  ✔ Anti-Jargon gate correctly blocks all forbidden camera specs.");

  // ==========================================================================
  // Test 3: Tool 1 (init_brief) & Stage Initialization
  // ==========================================================================
  console.log("▶ [Test 3] Verifying Tool 1 (init_brief)...");
  const store = new DAGStore();
  store.reset();

  // Test anti-jargon rejection on init_brief
  let initJargonCaught = false;
  try {
    await executeInitBrief(
      {
        company: "ChaiWaale",
        product: "Masala Chai",
        goal: "Brand awareness in 16:9 aspect ratio",
      },
      store
    );
  } catch (err) {
    initJargonCaught = true;
    assert.strictEqual(err.message, ANTI_JARGON_VIOLATION_MESSAGE);
  }
  assert.ok(initJargonCaught, "init_brief must reject technical camera specs");

  // Valid init_brief execution
  const initResult = await executeInitBrief(
    {
      company: "ChaiWaale",
      product: "Kadak Masala Chai",
      goal: "Revive afternoon family tea ritual",
      preset: "indian-d2c-story",
      brandFriction: "Fast-paced corporate life reducing family tea-time conversations",
    },
    store
  );

  assert.strictEqual(initResult.success, true);
  assert.strictEqual(initResult.currentStage, "CORE_THEME");
  assert.ok(initResult._systemDirective, "_systemDirective block must be present");
  assert.ok(
    initResult._systemDirective.languageRule.includes("Hinglish"),
    "Must mandate Hinglish for indian-d2c-story"
  );
  assert.ok(
    initResult._systemDirective.endingRule.includes("Reply 1, 2, 3, or R (regenerate)."),
    "Ending rule must strictly be: Reply 1, 2, 3, or R (regenerate)."
  );
  console.log("  ✔ init_brief initializes state to CORE_THEME with strict directives.");

  // ==========================================================================
  // Test 4: Regenerate Mode ('R') in branch_scene
  // ==========================================================================
  console.log("▶ [Test 4] Verifying Regenerate Mode ('R') in branch_scene...");
  const regenResult = await executeBranchScene(
    {
      action: "regenerate",
      nextOptions: [
        { id: "1", title: "Tapri Memory", description: "Old college tapri chai memories" },
        { id: "2", title: "Office Rush", description: "Hustle vs quiet moment" },
        { id: "3", title: "Train Compartment", description: "Sharing flask on Mumbai local train" },
      ],
    },
    store
  );

  assert.strictEqual(regenResult.currentStage, "CORE_THEME", "Stage must NOT advance on regenerate");
  assert.strictEqual(regenResult.prunedCount, 3, "prunedCount must increment by 3 on regenerate");
  assert.strictEqual(regenResult.lockedNodes.length, 0, "No nodes locked during regenerate");
  console.log("  ✔ Regenerate mode ('R') increments prunedCount by 3 and preserves stage.");

  // ==========================================================================
  // Test 5: Sequential FSM Commit & Pruning
  // ==========================================================================
  console.log("▶ [Test 5] Verifying Sequential FSM Commit & Pruning...");

  // Commit Step 1: CORE_THEME -> moves to SCENE_1_SETUP
  const commit1 = await executeBranchScene(
    {
      action: "commit",
      selectedOptionId: "1",
      title: "Tapri Memory",
      description: "Father remembers sharing tapri chai with his son 20 years ago",
      treatmentProse: "INT. MUMBAI LIVING ROOM - EVENING. Rain lashes against the vintage windowpane.",
      nextOptions: [
        { id: "1", title: "Morning Rush Setup", description: "Son is rushing for a meeting" },
        { id: "2", title: "Kitchen Silence Setup", description: "Father brews chai in silence" },
        { id: "3", title: "Balcony Setup", description: "Monsoon breeze on the verandah" },
      ],
    },
    store
  );

  assert.strictEqual(commit1.currentStage, "SCENE_1_SETUP");
  assert.strictEqual(commit1.prunedCount, 5, "prunedCount should now be 3 + 2 = 5");
  assert.strictEqual(commit1.lockedNodes.length, 1);
  assert.strictEqual(commit1.lockedNodes[0].selectedOptionId, "1");
  assert.ok(
    commit1._systemDirective.instruction.includes("IGNORE ALL REJECTED OPTIONS"),
    "Directive must instruct LLM to ignore rejected options"
  );

  // Commit Step 2: SCENE_1_SETUP -> moves to SCENE_2_CATALYST
  const commit2 = await executeBranchScene(
    {
      action: "commit",
      selectedOptionId: "2",
      title: "Kitchen Silence Setup",
      description: "Father brews chai in vintage brass vessel",
      treatmentProse: "The aroma of crushed ginger and cardamom fills the quiet apartment.",
      nextOptions: [
        { id: "1", title: "Laptop Spills", description: "Son accidentally knocks mug" },
        { id: "2", title: "Power Cut", description: "Sudden blackout during thunderstorm" },
        { id: "3", title: "Old Radio Turns On", description: "Favorite melody plays" },
      ],
    },
    store
  );
  assert.strictEqual(commit2.currentStage, "SCENE_2_CATALYST");
  assert.strictEqual(commit2.prunedCount, 7);

  // Commit Step 3: SCENE_2_CATALYST -> moves to SCENE_3_TWIST
  const commit3 = await executeBranchScene(
    {
      action: "commit",
      selectedOptionId: "2",
      title: "Power Cut Catalyst",
      description: "Thunderclap triggers a power outage, halting the zoom call",
      treatmentProse: "Darkness settles over the apartment. The blue glow of the laptop dies.",
      nextOptions: [
        { id: "1", title: "Unspoken Confession", description: "Son confesses burnout" },
        { id: "2", title: "Old Photo Album", description: "Candlelight illuminates vintage photo" },
        { id: "3", title: "Silent Tea Exchange", description: "Father silently slides a hot glass of chai" },
      ],
    },
    store
  );
  assert.strictEqual(commit3.currentStage, "SCENE_3_TWIST");

  // Commit Step 4: SCENE_3_TWIST -> moves to SCENE_4_CLIMAX
  const commit4 = await executeBranchScene(
    {
      action: "commit",
      selectedOptionId: "3",
      title: "Silent Tea Exchange",
      description: "Father places the chai glass next to the son's work notebook",
      treatmentProse: "Steam rises between them. The son looks up from his keyboard.",
      nextOptions: [
        { id: "1", title: "The Shared Sip", description: "First sip breaks the cold barrier" },
        { id: "2", title: "The Hand on Shoulder", description: "Warm reassurance without words" },
        { id: "3", title: "Laughter in the Dark", description: "Shared laughter over an old family joke" },
      ],
    },
    store
  );
  assert.strictEqual(commit4.currentStage, "SCENE_4_CLIMAX");

  // Commit Step 5: SCENE_4_CLIMAX -> moves to LOCK_ASSETS
  const commit5 = await executeBranchScene(
    {
      action: "commit",
      selectedOptionId: "1",
      title: "The Shared Sip",
      description: "Son takes the first sip; warmth washes over his tired face",
      treatmentProse: "They drink together in candlelight. ChaiWaale Kadak: Kuch baatein sirf chai ke saath hoti hain.",
    },
    store
  );
  assert.strictEqual(commit5.currentStage, "LOCK_ASSETS");
  assert.strictEqual(commit5.isNarrativeComplete, true);
  console.log("  ✔ Sequential narrative branching transitions strictly through SCENE_4_CLIMAX to LOCK_ASSETS.");

  // ==========================================================================
  // Test 6: FSM Out-of-Sequence Rejections
  // ==========================================================================
  console.log("▶ [Test 6] Verifying FSM Stage Lock Enforcements...");

  // In stage LOCK_ASSETS, branch_scene should be rejected
  let branchOutOfSequence = false;
  try {
    await executeBranchScene(
      {
        action: "commit",
        selectedOptionId: "1",
        title: "Rogue branch",
        description: "Trying to branch when narrative is done",
        treatmentProse: "Forbidden",
      },
      store
    );
  } catch (err) {
    branchOutOfSequence = true;
    assert.ok(err.message.includes("FSM STAGE VIOLATION"));
  }
  assert.ok(branchOutOfSequence, "branch_scene must be rejected during LOCK_ASSETS stage");

  // In stage LOCK_ASSETS, compile_shots should be rejected (must lock assets first)
  let compileOutOfSequence = false;
  try {
    await executeCompileShots(
      {
        shots: [
          {
            sceneId: "SHOT_01",
            action: "Father pours chai",
            characterId: "CHAR_01",
            backgroundId: "BG_01",
          },
        ],
        openStudioUi: false,
      },
      store
    );
  } catch (err) {
    compileOutOfSequence = true;
    assert.ok(err.message.includes("FSM STAGE VIOLATION"));
  }
  assert.ok(compileOutOfSequence, "compile_shots must be rejected before LOCK_ASSETS is completed");
  console.log("  ✔ Out-of-sequence tool executions are strictly rejected.");

  // ==========================================================================
  // Test 7: Tool 3 (lock_assets) - ID Pattern Validation (CHAR_01..N, BG_01..N, PROD_01)
  // ==========================================================================
  console.log("▶ [Test 7] Verifying Tool 3 (lock_assets) and Asset ID validations...");

  // Invalid character ID (e.g. 'HERO_DAD')
  let invalidCharId = false;
  try {
    await executeLockAssets(
      {
        characters: [
          {
            assetId: "HERO_DAD", // Invalid: must match CHAR_01..N
            name: "Babuji",
            appearancePrompt: "Elderly Indian father with warm eyes and graying mustache",
          },
        ],
        environments: [
          {
            assetId: "BG_01",
            name: "Mumbai Living Room",
            environmentPrompt: "Cozy middle-class apartment with wooden furniture",
          },
        ],
      },
      store
    );
  } catch (err) {
    invalidCharId = true;
    assert.ok(err.message.includes("CHAR_01..N") || err.message.includes("violates naming convention"));
  }
  assert.ok(invalidCharId, "lock_assets must reject invalid character ID format");

  // Invalid background ID (e.g. 'LIVING_ROOM')
  let invalidBgId = false;
  try {
    await executeLockAssets(
      {
        characters: [
          {
            assetId: "CHAR_01",
            name: "Babuji",
            appearancePrompt: "Elderly Indian father with warm eyes and graying mustache",
          },
        ],
        environments: [
          {
            assetId: "LIVING_ROOM", // Invalid: must match BG_01..N
            name: "Mumbai Living Room",
            environmentPrompt: "Cozy middle-class apartment with wooden furniture",
          },
        ],
      },
      store
    );
  } catch (err) {
    invalidBgId = true;
    assert.ok(err.message.includes("BG_01..N") || err.message.includes("violates naming convention"));
  }
  assert.ok(invalidBgId, "lock_assets must reject invalid background ID format");

  // Invalid product ID (e.g. 'PROD_99')
  let invalidProdId = false;
  try {
    await executeLockAssets(
      {
        characters: [
          {
            assetId: "CHAR_01",
            name: "Babuji",
            appearancePrompt: "Elderly Indian father with warm eyes and graying mustache",
          },
        ],
        environments: [
          {
            assetId: "BG_01",
            name: "Mumbai Living Room",
            environmentPrompt: "Cozy middle-class apartment with wooden furniture",
          },
        ],
        product: {
          assetId: "PROD_99", // Invalid: must be PROD_01
          name: "ChaiWaale Kadak Chai",
          productPrompt: "Traditional tea packaging",
        },
      },
      store
    );
  } catch (err) {
    invalidProdId = true;
    assert.ok(err.message.includes("PROD_01") || err.message.includes("violates naming convention"));
  }
  assert.ok(invalidProdId, "lock_assets must reject invalid product ID");

  // Valid asset lock
  const validLockAssetsResult = await executeLockAssets(
    {
      characters: [
        {
          assetId: "CHAR_01",
          name: "Babuji (Father)",
          appearancePrompt: "60-year-old Indian father with kind crinkled eyes, wearing handloom kurta",
        },
        {
          assetId: "CHAR_02",
          name: "Aman (Son)",
          appearancePrompt: "28-year-old tired tech worker with messy hair, wearing spectacles and casual tee",
        },
      ],
      environments: [
        {
          assetId: "BG_01",
          name: "Rainy Living Room",
          environmentPrompt: "Atmospheric vintage Mumbai apartment with rain against windowpanes and warm wooden textures",
          lightingProfile: "Warm tungsten lamp and soft monsoon evening shadows",
        },
      ],
      product: {
        assetId: "PROD_01",
        name: "ChaiWaale Kadak Masala Chai",
        productPrompt: "Amber glass jar with vintage brass lid containing aromatic whole spices and CTC tea",
      },
    },
    store
  );

  assert.strictEqual(validLockAssetsResult.success, true);
  assert.strictEqual(validLockAssetsResult.currentStage, "COMPILE_SHOTS");
  console.log("  ✔ lock_assets successfully validates CHAR_01..N, BG_01..N, PROD_01 and transitions to COMPILE_SHOTS.");

  // ==========================================================================
  // Test 8: Tool 4 (compile_shots) - Referential Integrity & Auto-Compilation
  // ==========================================================================
  console.log("▶ [Test 8] Verifying Tool 4 (compile_shots)...");

  // Referential Integrity failure: Hallucinated character ID 'CHAR_99'
  let refCharFailed = false;
  try {
    await executeCompileShots(
      {
        shots: [
          {
            sceneId: "SCENE_01",
            order: 1,
            title: "The Boil",
            action: "Babuji stirs the tea",
            characterId: "CHAR_99", // Unlisted ID!
            backgroundId: "BG_01",
            lens: "35mm prime",
          },
        ],
        openStudioUi: false,
      },
      store
    );
  } catch (err) {
    refCharFailed = true;
    assert.ok(err.message.includes("REFERENTIAL INTEGRITY VIOLATION"));
    assert.ok(err.message.includes("CHAR_99"));
  }
  assert.ok(refCharFailed, "compile_shots must reject unlisted characterId");

  // Referential Integrity failure: Hallucinated background ID 'BG_99'
  let refBgFailed = false;
  try {
    await executeCompileShots(
      {
        shots: [
          {
            sceneId: "SCENE_01",
            order: 1,
            title: "The Boil",
            action: "Babuji stirs the tea",
            characterId: "CHAR_01",
            backgroundId: "BG_99", // Unlisted background!
            lens: "35mm prime",
          },
        ],
        openStudioUi: false,
      },
      store
    );
  } catch (err) {
    refBgFailed = true;
    assert.ok(err.message.includes("REFERENTIAL INTEGRITY VIOLATION"));
    assert.ok(err.message.includes("BG_99"));
  }
  assert.ok(refBgFailed, "compile_shots must reject unlisted backgroundId");

  // Valid compile_shots execution
  const compileResult = await executeCompileShots(
    {
      shots: [
        {
          sceneId: "SHOT_01",
          order: 1,
          title: "Boiling Kadak Chai",
          action: "Babuji stirs cardamom and crushed ginger into simmering milk in the vintage brass vessel",
          characterId: "CHAR_01",
          backgroundId: "BG_01",
          lens: "50mm anamorphic prime",
          cameraAngle: "CLOSE_UP",
          cameraMovement: "PUSH_IN",
          duration: 4,
        },
        {
          sceneId: "SHOT_02",
          order: 2,
          title: "The Silent Offering",
          action: "Babuji slides the steaming glass mug across the table toward Aman",
          characterIds: ["CHAR_01", "CHAR_02"],
          backgroundId: "BG_01",
          lens: "35mm prime",
          cameraAngle: "MEDIUM_SHOT",
          cameraMovement: "TRACKING",
          duration: 5,
        },
      ],
      openStudioUi: false,
    },
    store
  );

  assert.strictEqual(compileResult.success, true);
  assert.strictEqual(compileResult.currentStage, "COMPLETED");
  assert.strictEqual(compileResult.shotsCount, 2);

  // Server-side auto-compilation verification
  const shot1 = compileResult.shots[0];
  assert.ok(
    shot1.compiledVideoPrompt.includes("60-year-old Indian father"),
    "compiledVideoPrompt must contain locked appearance prompt"
  );
  assert.ok(
    shot1.compiledVideoPrompt.includes("Atmospheric vintage Mumbai apartment"),
    "compiledVideoPrompt must contain locked environment prompt"
  );
  assert.ok(
    shot1.compiledVideoPrompt.includes("Warm tungsten lamp"),
    "compiledVideoPrompt must contain locked lighting profile"
  );
  assert.ok(
    shot1.compiledVideoPrompt.includes("50mm anamorphic prime"),
    "compiledVideoPrompt must contain camera lens"
  );
  assert.ok(
    shot1.compiledVideoPrompt.includes("PUSH_IN"),
    "compiledVideoPrompt must contain camera movement"
  );
  console.log("  ✔ Server-side auto-compilation programmatically concatenated locked assets into compiledVideoPrompt.");

  // ==========================================================================
  // Test 9: HTML Entity Sanitization
  // ==========================================================================
  console.log("▶ [Test 9] Verifying HTML Entity Sanitization (<, >, &, \", ')...");
  assert.strictEqual(
    escapeHtml('<script>alert("XSS & \'hack\'");</script>'),
    "&lt;script&gt;alert(&quot;XSS &amp; &#039;hack&#039;&quot;);&lt;/script&gt;"
  );

  const testObj = {
    title: "<img src=x onerror=alert(1)>",
    list: ["Fish & Chips", "Tom's 'Car'"],
    nested: {
      desc: "5 > 3 & 2 < 4",
    },
  };
  const sanitized = sanitizeObjectForHtml(testObj);
  assert.strictEqual(sanitized.title, "&lt;img src=x onerror=alert(1)&gt;");
  assert.strictEqual(sanitized.list[0], "Fish &amp; Chips");
  assert.strictEqual(sanitized.list[1], "Tom&#039;s &#039;Car&#039;");
  assert.strictEqual(sanitized.nested.desc, "5 &gt; 3 &amp; 2 &lt; 4");
  console.log("  ✔ HTML Sanitization escapes all 5 required characters across nested structures.");

  console.log("\n🎉 ALL TESTS PASSED! Strict FSM, Anti-Jargon, Pruning, Asset, and Compilation Guardrails Verified.");
}

runTests().catch((err) => {
  console.error("❌ Test suite failed:", err);
  process.exit(1);
});

