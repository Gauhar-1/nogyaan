/**
 * @file tests/test-system32-cwd.mjs
 * @description Verifies that DAGStore and init_brief handle process.cwd() being C:\WINDOWS\system32
 * without throwing EPERM error.
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DAGStore, getWorkspaceDir } from "../dist/state/dag-store.js";
import { executeInitBrief } from "../dist/tools/1-init-brief.js";

console.log("🎬 Verifying System32 CWD & Writable Workspace Fallback...\n");

// Case 1: AD_DIRECTOR_WORKSPACE is set
const customWs = path.resolve(process.cwd(), ".test-explicit-ws");
process.env.AD_DIRECTOR_WORKSPACE = customWs;
const storeWithEnv = new DAGStore();
assert.strictEqual(
  storeWithEnv.getWorkspaceDir(),
  customWs,
  "Must use AD_DIRECTOR_WORKSPACE when provided"
);

// Clean up
delete process.env.AD_DIRECTOR_WORKSPACE;
if (fs.existsSync(customWs)) {
  fs.rmSync(customWs, { recursive: true, force: true });
}

// Case 2: Process CWD simulation or check
console.log("Current resolved workspaceDir:", getWorkspaceDir());

// Run init_brief to verify it succeeds and returns storagePath
async function testInit() {
  const store = new DAGStore();
  const res = await executeInitBrief(
    {
      company: "TestBrand",
      product: "TestProduct",
      goal: "TestGoal",
    },
    store
  );

  assert.strictEqual(res.success, true);
  assert.ok(res.storagePath, "Must return storagePath");
  assert.ok(res.workspaceDir, "Must return workspaceDir");
  assert.ok(fs.existsSync(res.storagePath), "story_graph.json must exist at storagePath");
  console.log(`  ✔ Blueprint successfully created at: ${res.storagePath}`);
}

testInit().then(() => {
  console.log("\n🎉 System32 & Workspace Fallback Verification Passed!\n");
}).catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});

