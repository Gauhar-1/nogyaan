/**
 * @file tests/test-cli.mjs
 * @description Comprehensive test suite for CLI and DX installer.
 * Verifies OS-aware path resolution, non-destructive JSON merges, backup creation,
 * malformed JSON protection, rule installation, doctor diagnostics, and uninstaller.
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  getClaudeDesktopConfigPath,
  getClaudeDesktopMsixConfigPaths,
  getAllClaudeDesktopConfigTargets,
  getCursorGlobalConfigPath,
  getProjectCursorConfigPath,
  getProjectClaudeCodeConfigPath,
  getProjectCursorRulePath,
  safeInjectMcpServer,
  safeRemoveMcpServer,
  installCursorRule,
  checkPortAvailable,
} from "../dist/cli.js";

async function runCliTests() {
  console.log("🎬 Starting CLI & DX Architecture Verification Suite...\n");

  const sandboxDir = path.resolve(process.cwd(), ".cli-test-sandbox");
  if (fs.existsSync(sandboxDir)) {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  }
  fs.mkdirSync(sandboxDir, { recursive: true });

  // ==========================================================================
  // Test 1: OS-Aware Path Resolution
  // ==========================================================================
  console.log("▶ [Test 1] Testing OS-Aware Path Resolution...");
  const claudePath = getClaudeDesktopConfigPath();
  const cursorGlobal = getCursorGlobalConfigPath();
  const projectCursor = getProjectCursorConfigPath(sandboxDir);
  const projectClaude = getProjectClaudeCodeConfigPath(sandboxDir);
  const cursorRule = getProjectCursorRulePath(sandboxDir);

  if (process.platform === "win32") {
    assert.ok(claudePath.includes("Claude"), "Windows Claude path should include 'Claude'");
    assert.ok(claudePath.endsWith("claude_desktop_config.json"));
    const allTargets = getAllClaudeDesktopConfigTargets();
    assert.ok(allTargets.length >= 1, "Must find at least standard Claude Desktop config target");
  } else if (process.platform === "darwin") {
    assert.ok(claudePath.includes("Library/Application Support/Claude"));
  } else {
    assert.ok(claudePath.includes("Claude"));
  }

  assert.strictEqual(
    cursorGlobal,
    path.join(os.homedir(), ".cursor", "mcp.json")
  );
  assert.strictEqual(
    projectCursor,
    path.join(sandboxDir, ".cursor", "mcp.json")
  );
  assert.strictEqual(
    projectClaude,
    path.join(sandboxDir, ".mcp.json")
  );
  assert.strictEqual(
    cursorRule,
    path.join(sandboxDir, ".cursor", "rules", "ad-director.mdc")
  );
  console.log("  ✔ All OS-aware and project-local paths resolved accurately.");

  // ==========================================================================
  // Test 2: Safe Creation of Non-Existent Config
  // ==========================================================================
  console.log("▶ [Test 2] Testing Safe Creation of Non-Existent Config...");
  const targetFile = path.join(sandboxDir, "client-a", "mcp.json");
  const serverEntry = {
    command: "node",
    args: ["/absolute/path/dist/index.js"],
  };

  const createRes = safeInjectMcpServer(targetFile, "TestClientA", serverEntry);
  assert.strictEqual(createRes.status, "created");
  assert.ok(fs.existsSync(targetFile), "Config file should be created");

  const parsedCreated = JSON.parse(fs.readFileSync(targetFile, "utf-8"));
  assert.deepStrictEqual(parsedCreated.mcpServers["ad-director"], serverEntry);
  console.log("  ✔ Clean config file and parent folders created recursively.");

  // ==========================================================================
  // Test 3: Non-Destructive Merging with Existing Servers & Backup
  // ==========================================================================
  console.log("▶ [Test 3] Testing Non-Destructive Merging & Backup...");
  // Pre-seed config with existing user servers
  const existingConfig = {
    mcpServers: {
      "sqlite": { command: "uvx", args: ["mcp-server-sqlite"] },
      "github": { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
    },
    customUserSettings: {
      theme: "dark",
      autoSave: true,
    },
  };
  fs.writeFileSync(targetFile, JSON.stringify(existingConfig, null, 2), "utf-8");

  const updatedEntry = {
    command: "npx",
    args: ["-y", "ad-director-mcp", "serve"],
  };

  const mergeRes = safeInjectMcpServer(targetFile, "TestClientA", updatedEntry);
  assert.strictEqual(mergeRes.status, "updated");
  assert.ok(fs.existsSync(`${targetFile}.bak`), "Backup file .bak must be created");

  const parsedMerged = JSON.parse(fs.readFileSync(targetFile, "utf-8"));
  // Existing servers must be preserved!
  assert.ok(parsedMerged.mcpServers.sqlite, "Existing server 'sqlite' must be preserved");
  assert.ok(parsedMerged.mcpServers.github, "Existing server 'github' must be preserved");
  assert.strictEqual(parsedMerged.customUserSettings.theme, "dark", "User settings must be preserved");
  // ad-director must be merged
  assert.deepStrictEqual(parsedMerged.mcpServers["ad-director"], updatedEntry);
  console.log("  ✔ Existing servers and user settings strictly preserved with safety backup.");

  // ==========================================================================
  // Test 4: Malformed JSON Protection (Abort Without Overwrite)
  // ==========================================================================
  console.log("▶ [Test 4] Testing Malformed JSON Protection...");
  const malformedFile = path.join(sandboxDir, "malformed", "config.json");
  fs.mkdirSync(path.dirname(malformedFile), { recursive: true });
  const brokenContent = "{\n  \"mcpServers\": {\n    \"broken\": true,\n"; // Invalid JSON
  fs.writeFileSync(malformedFile, brokenContent, "utf-8");

  const malformedRes = safeInjectMcpServer(malformedFile, "BrokenClient", updatedEntry);
  assert.strictEqual(malformedRes.status, "aborted");
  assert.ok(malformedRes.error?.includes("Malformed JSON"));

  // Verify file was NOT touched or overwritten
  const contentAfter = fs.readFileSync(malformedFile, "utf-8");
  assert.strictEqual(contentAfter, brokenContent, "Malformed file must not be overwritten");
  console.log("  ✔ Malformed JSON aborted immediately with zero data loss.");

  // ==========================================================================
  // Test 5: Clean Uninstallation (Preserving Other Servers)
  // ==========================================================================
  console.log("▶ [Test 5] Testing Clean Uninstallation...");
  const removeRes = safeRemoveMcpServer(targetFile, "TestClientA");
  assert.strictEqual(removeRes.status, "removed");

  const parsedAfterRemove = JSON.parse(fs.readFileSync(targetFile, "utf-8"));
  assert.strictEqual(parsedAfterRemove.mcpServers["ad-director"], undefined, "ad-director must be removed");
  assert.ok(parsedAfterRemove.mcpServers.sqlite, "Other servers like sqlite must remain untouched");
  assert.ok(parsedAfterRemove.mcpServers.github, "Other servers like github must remain untouched");
  console.log("  ✔ ad-director cleanly removed without affecting other servers.");

  // ==========================================================================
  // Test 6: Cursor Rule Installation (.cursor/rules/ad-director.mdc)
  // ==========================================================================
  console.log("▶ [Test 6] Testing Cursor Rule Installation (.mdc)...");
  const ruleSuccess = installCursorRule(sandboxDir);
  assert.ok(ruleSuccess, "installCursorRule should return true");
  const installedRulePath = getProjectCursorRulePath(sandboxDir);
  assert.ok(fs.existsSync(installedRulePath), "ad-director.mdc must exist");

  const ruleContent = fs.readFileSync(installedRulePath, "utf-8");
  assert.ok(ruleContent.includes("alwaysApply: true"), "Must contain alwaysApply in frontmatter");
  assert.ok(ruleContent.includes("1/2/3/R"), "Must contain 1/2/3/R rule protocol");
  console.log("  ✔ Cursor rule .mdc installed with frontmatter.");

  // ==========================================================================
  // Test 7: Port Check Utility
  // ==========================================================================
  console.log("▶ [Test 7] Testing Port Check Utility...");
  const isAvailable = await checkPortAvailable(4321);
  console.log(`  ℹ Port 4321 availability: ${isAvailable}`);

  // ==========================================================================
  // Test 8: End-to-End CLI Execution via Subprocess
  // ==========================================================================
  console.log("▶ [Test 8] Testing Subprocess CLI Commands...");

  // Doctor command
  const doctorOutput = execSync("node dist/cli.js doctor", { encoding: "utf-8" });
  assert.ok(doctorOutput.includes("Node.js Runtime"), "doctor output must include Node.js check");
  assert.ok(doctorOutput.includes("Server Build"), "doctor output must include Server Build check");
  console.log("  ✔ 'node dist/cli.js doctor' executed cleanly.");

  // Init --local command output check
  const initLocalOutput = execSync("node dist/cli.js init --local --project", { encoding: "utf-8" });
  assert.ok(initLocalOutput.includes("Local Development mode (--local)"), "Must indicate --local mode");
  assert.ok(initLocalOutput.includes("Restart Claude Desktop / Cursor"), "Must include restart prompt");
  assert.ok(
    initLocalOutput.includes("Direct an Indian D2C ad for QuickBiteQR using ad-director"),
    "Must include the exact quickstart prompt"
  );
  console.log("  ✔ 'node dist/cli.js init --local --project' executed and output quickstart prompt.");

  // Clean up sandbox
  fs.rmSync(sandboxDir, { recursive: true, force: true });

  console.log("\n🎉 ALL CLI & DX TESTS PASSED CLEANLY!");
}

runCliTests().catch((err) => {
  console.error("❌ CLI test suite failed:", err);
  process.exit(1);
});

