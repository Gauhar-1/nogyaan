#!/usr/bin/env node

/**
 * @file src/cli.ts
 * @description Cross-Platform CLI and DX Orchestrator for nogyaan MCP Server.
 * Safely configures Claude Desktop (Standard + Windows MSIX Store), Cursor, and Claude Code
 * with non-destructive JSON merges, timestamped backups, environment diagnostics, and automated rules deployment.
 */

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import open from "open";
import { PresetRegistryService } from "./services/preset-registry.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves the package root directory relative to import.meta.url by searching upwards.
 */
export function getPackageRoot(): string {
  let curr = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(curr, "package.json"))) {
      return curr;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

// ============================================================================
// 1. OS-Aware Config Path Resolution
// ============================================================================

/**
 * Resolves standard platform-specific Claude Desktop configuration path.
 * - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
 * - Windows: %APPDATA%/Claude/claude_desktop_config.json
 * - Linux: ~/.config/Claude/claude_desktop_config.json
 */
export function getClaudeDesktopConfigPath(): string {
  const home = os.homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "Claude", "claude_desktop_config.json");
  } else if (process.platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json"
    );
  } else {
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    return path.join(xdgConfig, "Claude", "claude_desktop_config.json");
  }
}

/**
 * Resolves MSIX / Windows Store virtualized Claude Desktop config paths:
 * Inside %LOCALAPPDATA%/Packages, look for any directory starting with Claude_ (e.g. Claude_pzs8sxrjxfjjc),
 * and target LocalCache/Roaming/Claude/claude_desktop_config.json inside it.
 */
export function getClaudeDesktopMsixConfigPaths(): string[] {
  if (process.platform !== "win32") {
    return [];
  }

  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const packagesDir = path.join(localAppData, "Packages");

  if (!fs.existsSync(packagesDir)) {
    return [];
  }

  try {
    const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
    const msixPaths: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("Claude_")) {
        const candidateDir = path.join(
          packagesDir,
          entry.name,
          "LocalCache",
          "Roaming",
          "Claude"
        );
        if (fs.existsSync(candidateDir)) {
          msixPaths.push(path.join(candidateDir, "claude_desktop_config.json"));
        }
      }
    }

    return msixPaths;
  } catch {
    return [];
  }
}

/**
 * Returns all active Claude Desktop configuration paths for this machine.
 * On Windows, this returns both the standard %APPDATA% path and any MSIX Store virtualized paths.
 */
export function getAllClaudeDesktopConfigTargets(): { name: string; path: string }[] {
  const targets: { name: string; path: string }[] = [];

  // Standard path
  targets.push({
    name: "Claude Desktop",
    path: getClaudeDesktopConfigPath(),
  });

  // Windows MSIX Store virtualized paths
  const msixPaths = getClaudeDesktopMsixConfigPaths();
  for (let i = 0; i < msixPaths.length; i++) {
    targets.push({
      name: msixPaths.length === 1 ? "Claude Desktop (MSIX Store)" : `Claude Desktop (MSIX #${i + 1})`,
      path: msixPaths[i],
    });
  }

  return targets;
}

/**
 * Resolves global Cursor configuration path (~/.cursor/mcp.json).
 */
export function getCursorGlobalConfigPath(): string {
  return path.join(os.homedir(), ".cursor", "mcp.json");
}

/**
 * Resolves project-local Cursor configuration path (./.cursor/mcp.json).
 */
export function getProjectCursorConfigPath(cwd: string = process.cwd()): string {
  return path.join(cwd, ".cursor", "mcp.json");
}

/**
 * Resolves project-local Claude Code configuration path (./.mcp.json).
 */
export function getProjectClaudeCodeConfigPath(cwd: string = process.cwd()): string {
  return path.join(cwd, ".mcp.json");
}

/**
 * Resolves project-local Cursor rule target (./.cursor/rules/nogyaan.mdc).
 */
export function getProjectCursorRulePath(cwd: string = process.cwd()): string {
  return path.join(cwd, ".cursor", "rules", "nogyaan.mdc");
}

// ============================================================================
// 2. Safe & Non-Destructive JSON Merge Engine
// ============================================================================

export interface ConfigOpResult {
  path: string;
  client: string;
  status: "created" | "updated" | "removed" | "skipped" | "aborted";
  backupPath?: string;
  error?: string;
}

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Non-destructively merges the "nogyaan" entry into a target JSON config.
 * - If file exists: validates JSON, creates timestamped backup in same folder,
 *   removes any legacy entry, and merges ONLY mcpServers["nogyaan"].
 * - If malformed: ABORTS immediately with error to protect user config.
 * - If file does not exist: creates directory recursively and writes clean template.
 */
export function safeInjectMcpServer(
  configPath: string,
  clientName: string,
  serverEntry: McpServerEntry
): ConfigOpResult {
  try {
    const dir = path.dirname(configPath);

    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8");
      let config: any;

      // Malformed JSON check: DO NOT OVERWRITE! Abort!
      try {
        config = JSON.parse(raw);
      } catch (err: any) {
        return {
          path: configPath,
          client: clientName,
          status: "aborted",
          error: `CRITICAL: Malformed JSON syntax in ${configPath}: ${err.message}. Operation aborted to prevent loss of existing MCP servers.`,
        };
      }

      if (typeof config !== "object" || config === null || Array.isArray(config)) {
        return {
          path: configPath,
          client: clientName,
          status: "aborted",
          error: `Root JSON in ${configPath} is not an object. Operation aborted.`,
        };
      }

      // Create timestamped backup before modifying
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const standardBackupPath = `${configPath}.bak`;
      const timestampedBackupPath = `${configPath}.bak-${timestamp}`;

      try {
        fs.copyFileSync(configPath, standardBackupPath);
        fs.copyFileSync(configPath, timestampedBackupPath);
      } catch (backupErr: any) {
        return {
          path: configPath,
          client: clientName,
          status: "aborted",
          error: `Failed to create safety backup at ${standardBackupPath}: ${backupErr.message}`,
        };
      }

      // Ensure mcpServers object exists
      if (
        !config.mcpServers ||
        typeof config.mcpServers !== "object" ||
        Array.isArray(config.mcpServers)
      ) {
        config.mcpServers = {};
      }

      // Cleanly remove any legacy server entries to eliminate duplicates
      if ("ad-director" in config.mcpServers) {
        delete config.mcpServers["ad-director"];
      }
      if ("noslop" in config.mcpServers) {
        delete config.mcpServers["noslop"];
      }

      // Register under "nogyaan"
      config.mcpServers["nogyaan"] = serverEntry;

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

      return {
        path: configPath,
        client: clientName,
        status: "updated",
        backupPath: standardBackupPath,
      };
    } else {
      // File does not exist yet: create directory and initialize cleanly
      fs.mkdirSync(dir, { recursive: true });

      const newConfig = {
        mcpServers: {
          nogyaan: serverEntry,
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), "utf-8");

      return {
        path: configPath,
        client: clientName,
        status: "created",
      };
    }
  } catch (err: any) {
    return {
      path: configPath,
      client: clientName,
      status: "aborted",
      error: `Unexpected error writing to ${configPath}: ${err.message}`,
    };
  }
}

/**
 * Cleanly removes "nogyaan" and legacy entries from a config file while preserving all other servers.
 */
export function safeRemoveMcpServer(
  configPath: string,
  clientName: string
): ConfigOpResult {
  try {
    if (!fs.existsSync(configPath)) {
      return {
        path: configPath,
        client: clientName,
        status: "skipped",
      };
    }

    const raw = fs.readFileSync(configPath, "utf-8");
    let config: any;

    try {
      config = JSON.parse(raw);
    } catch (err: any) {
      return {
        path: configPath,
        client: clientName,
        status: "aborted",
        error: `Malformed JSON in ${configPath}: ${err.message}. Skipped removal.`,
      };
    }

    let removed = false;
    if (config?.mcpServers) {
      if ("nogyaan" in config.mcpServers) {
        delete config.mcpServers["nogyaan"];
        removed = true;
      }
      if ("noslop" in config.mcpServers) {
        delete config.mcpServers["noslop"];
        removed = true;
      }
      if ("ad-director" in config.mcpServers) {
        delete config.mcpServers["ad-director"];
        removed = true;
      }
    }

    if (removed) {
      const standardBackupPath = `${configPath}.bak`;
      try {
        fs.copyFileSync(configPath, standardBackupPath);
      } catch {}

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

      return {
        path: configPath,
        client: clientName,
        status: "removed",
        backupPath: standardBackupPath,
      };
    }

    return {
      path: configPath,
      client: clientName,
      status: "skipped",
    };
  } catch (err: any) {
    return {
      path: configPath,
      client: clientName,
      status: "aborted",
      error: `Failed to remove from ${configPath}: ${err.message}`,
    };
  }
}

/**
 * Copies SKILL.md into .cursor/rules/nogyaan.mdc with proper MDC frontmatter.
 */
export function installCursorRule(cwd: string = process.cwd()): boolean {
  try {
    const pkgRoot = getPackageRoot();
    const candidates = [
      path.join(pkgRoot, "SKILL.md"),
      path.resolve(cwd, "SKILL.md"),
      path.resolve(__dirname, "SKILL.md"),
      path.resolve(__dirname, "../SKILL.md"),
      path.resolve(__dirname, "../../SKILL.md"),
    ];

    let skillContent = "";
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        skillContent = fs.readFileSync(c, "utf-8");
        break;
      }
    }

    if (!skillContent) {
      console.warn("  ⚠ Warning: SKILL.md not found in package root; skipping Cursor rule installation.");
      return false;
    }

    const targetRulePath = getProjectCursorRulePath(cwd);
    const ruleDir = path.dirname(targetRulePath);
    if (!fs.existsSync(ruleDir)) {
      fs.mkdirSync(ruleDir, { recursive: true });
    }

    // Remove old legacy rules if present
    for (const legacyName of ["noslop.mdc", "ad-director.mdc"]) {
      const legacyRulePath = path.join(ruleDir, legacyName);
      if (fs.existsSync(legacyRulePath)) {
        try {
          fs.unlinkSync(legacyRulePath);
        } catch {}
      }
    }

    // Format proper .mdc rule format for Cursor Agent
    const mdcHeader = `---
description: nogyaan: State-Pruned Video Director & Storyboard MCP Server with 1/2/3/R decision branching and diffusion prompt compilation
globs: *
alwaysApply: true
---

`;

    const sanitizedBody = skillContent.replace(/^---[\s\S]*?---\n*/, "");
    fs.writeFileSync(targetRulePath, mdcHeader + sanitizedBody, "utf-8");
    return true;
  } catch (err: any) {
    console.warn(`  ⚠ Warning: Could not install Cursor rule: ${err.message}`);
    return false;
  }
}

/**
 * Tests if a given TCP port is available on localhost.
 */
export function checkPortAvailable(port: number = 4321): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

// ============================================================================
// 3. Commander CLI Program Definition
// ============================================================================

const program = new Command();

program
  .name("nogyaan")
  .description("State-Pruned Video Director & Storyboard MCP Server with DAG branching and visual workbench")
  .version("1.0.0");

// ----------------------------------------------------------------------------
// Command: init (Default)
// ----------------------------------------------------------------------------
program
  .command("init", { isDefault: true })
  .description("Configure the nogyaan MCP server in Claude Desktop, Cursor, and Claude Code (Default)")
  .option("--local", "Configure with local Node.js path to dist/index.js for active development/testing")
  .option("--project", "Also configure project-local .cursor/mcp.json, .mcp.json, and install Cursor rules")
  .action(async (options) => {
    console.log("\n🎬 \x1b[1m\x1b[32mnogyaan\x1b[0m \x1b[1m\x1b[37m— Video Director MCP Client Injector & Installer\x1b[0m\n");

    const isLocal = Boolean(options.local);
    const isProject = Boolean(options.project);

    // Resolve server command & args
    let serverEntry: McpServerEntry;
    if (isLocal) {
      const projectRoot = getPackageRoot();
      let indexPath = path.resolve(__dirname, "index.js");
      if (!fs.existsSync(indexPath)) {
        const rootDist = path.resolve(projectRoot, "dist", "index.js");
        if (fs.existsSync(rootDist)) {
          indexPath = rootDist;
        }
      }

      serverEntry = {
        command: "node",
        args: [indexPath],
        env: {
          NOGYAAN_WORKSPACE: projectRoot,
        },
      };
      console.log(`\x1b[36m• Running in Local Development mode (--local)\x1b[0m`);
      console.log(`  Target:    \x1b[33mnode ${indexPath}\x1b[0m`);
      console.log(`  Workspace: \x1b[33m${projectRoot}\x1b[0m\n`);
    } else {
      serverEntry = {
        command: "npx",
        args: ["-y", "nogyaan", "serve"],
      };
      console.log(`\x1b[36m• Running in Production mode (npx)\x1b[0m`);
      console.log(`  Target: \x1b[33mnpx -y nogyaan serve\x1b[0m\n`);
    }

    const results: ConfigOpResult[] = [];

    // 1. Claude Desktop (Standard %APPDATA% + Windows MSIX Store if present)
    const claudeTargets = getAllClaudeDesktopConfigTargets();
    for (const t of claudeTargets) {
      results.push(safeInjectMcpServer(t.path, t.name, serverEntry));
    }

    // 2. Cursor Global
    const cursorGlobalPath = getCursorGlobalConfigPath();
    results.push(safeInjectMcpServer(cursorGlobalPath, "Cursor (Global)", serverEntry));

    // 3. Project-Local (if --project flag passed)
    if (isProject) {
      const projectCursorPath = getProjectCursorConfigPath();
      results.push(safeInjectMcpServer(projectCursorPath, "Cursor (Project)", serverEntry));

      const claudeCodePath = getProjectClaudeCodeConfigPath();
      results.push(safeInjectMcpServer(claudeCodePath, "Claude Code (Project)", serverEntry));

      const ruleInstalled = installCursorRule();
      if (ruleInstalled) {
        console.log(`  \x1b[32m✔\x1b[0m \x1b[1mCursor Rule (.mdc):\x1b[0m Installed at ${getProjectCursorRulePath()}`);
      }
    }

    // Terminal Output Summary
    console.log("\x1b[1mConfiguration Results:\x1b[0m");
    let hasAbort = false;
    for (const r of results) {
      if (r.status === "updated") {
        console.log(
          `  \x1b[32m✔\x1b[0m \x1b[1m${r.client}:\x1b[0m Configured 'nogyaan' in ${r.path} \x1b[90m(Backup: ${path.basename(r.backupPath || "")})\x1b[0m`
        );
      } else if (r.status === "created") {
        console.log(
          `  \x1b[32m✔\x1b[0m \x1b[1m${r.client}:\x1b[0m Created new config with 'nogyaan' at ${r.path}`
        );
      } else if (r.status === "aborted") {
        hasAbort = true;
        console.error(`  \x1b[31m✖\x1b[0m \x1b[1m${r.client}:\x1b[0m ${r.error}`);
      }
    }

    console.log("\n" + "─".repeat(60) + "\n");
    if (!hasAbort) {
      console.log("\x1b[32m\x1b[1m✅ nogyaan installed! Restart Claude Desktop / Cursor and type:\x1b[0m");
      console.log(`\x1b[37m"Direct a video ad using nogyaan" or type "/preset-indian-d2c-story"\x1b[0m\n`);
    } else {
      console.log("\x1b[33m⚠ Some targets were skipped or aborted due to syntax errors.\x1b[0m\n");
    }
  });

// ----------------------------------------------------------------------------
// Command: studio
// ----------------------------------------------------------------------------
program
  .command("studio")
  .description("Launch and open the local nogyaan Director's Workbench UI in your browser")
  .option("-p, --port <port>", "Port to use for the visual studio", "4321")
  .action(async (opts) => {
    const port = parseInt(opts.port, 10) || 4321;
    const url = `http://localhost:${port}`;
    console.log(`\n🎨 Opening nogyaan Studio at ${url}...\n`);
    try {
      await open(url);
    } catch {
      console.log(`Please open ${url} in your browser.`);
    }
  });

// ----------------------------------------------------------------------------
// Command: presets
// ----------------------------------------------------------------------------
program
  .command("presets")
  .description("List all available storytelling presets and narrative cartridges")
  .action(async () => {
    console.log("\n🎛️ \x1b[1m\x1b[32mnogyaan\x1b[0m \x1b[1m\x1b[37m— Available Narrative Cartridges:\x1b[0m\n");
    try {
      const registry = new PresetRegistryService();
      const presets = registry.getAllPresets();
      for (const p of presets) {
        console.log(`  \x1b[32m•\x1b[0m \x1b[1m${p.id}\x1b[0m (${p.name})`);
        console.log(`    \x1b[90mPhilosophy:\x1b[0m ${p.philosophy || p.description}`);
        console.log(`    \x1b[90mLanguage Rule:\x1b[0m ${p.dialogueLanguageRule}\n`);
      }
    } catch (err: any) {
      console.error("Could not load presets:", err.message);
    }
  });

// ----------------------------------------------------------------------------
// Command: doctor
// ----------------------------------------------------------------------------
program
  .command("doctor")
  .description("Verify system readiness, Node version, port 4321, and config file health")
  .action(async () => {
    console.log("\n🩺 \x1b[1m\x1b[32mnogyaan\x1b[0m \x1b[1m\x1b[37m— System Diagnostics (Doctor)\x1b[0m\n");

    // 1. Node.js Version Check (>= 18)
    const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
    if (nodeMajor >= 18) {
      console.log(`  \x1b[32m✔\x1b[0m Node.js Runtime: v${process.versions.node} (>= 18 required)`);
    } else {
      console.log(`  \x1b[31m✖\x1b[0m Node.js Runtime: v${process.versions.node} is below required v18. Please upgrade Node.js.`);
    }

    // 2. Server Build Verification
    let indexPath = path.resolve(__dirname, "index.js");
    if (!fs.existsSync(indexPath)) {
      const cwdDist = path.resolve(process.cwd(), "dist", "index.js");
      if (fs.existsSync(cwdDist)) {
        indexPath = cwdDist;
      }
    }

    if (fs.existsSync(indexPath)) {
      console.log(`  \x1b[32m✔\x1b[0m Server Build: Found entry point at ${indexPath}`);
    } else {
      console.log(`  \x1b[31m✖\x1b[0m Server Build: Missing ${indexPath}. Run 'npm run build' first.`);
    }

    // 3. Studio Web Server Port Check (4321)
    const portFree = await checkPortAvailable(4321);
    if (portFree) {
      console.log(`  \x1b[32m✔\x1b[0m Port 4321: Available for visual Studio Workbench server`);
    } else {
      console.log(`  \x1b[33m⚠\x1b[0m Port 4321: In use (another instance of nogyaan Studio may be running)`);
    }

    // 4. Config Files Syntax Health
    const configChecks = [
      ...getAllClaudeDesktopConfigTargets(),
      { name: "Cursor (Global)", path: getCursorGlobalConfigPath() },
      { name: "Cursor (Project)", path: getProjectCursorConfigPath() },
      { name: "Claude Code (Project)", path: getProjectClaudeCodeConfigPath() },
    ];

    console.log("\n\x1b[1mConfig File Health Checks:\x1b[0m");
    for (const c of configChecks) {
      if (fs.existsSync(c.path)) {
        try {
          const raw = fs.readFileSync(c.path, "utf-8");
          const parsed = JSON.parse(raw);
          const hasNogyaan = Boolean(parsed.mcpServers?.["nogyaan"]);
          const hasLegacy = Boolean(parsed.mcpServers?.["noslop"] || parsed.mcpServers?.["ad-director"]);
          let tag = "\x1b[90m[not configured]\x1b[0m";
          if (hasNogyaan) {
            tag = "\x1b[32m[nogyaan configured]\x1b[0m";
          } else if (hasLegacy) {
            tag = "\x1b[33m[legacy mcp detected — run 'nogyaan init' to update]\x1b[0m";
          }
          console.log(`  \x1b[32m✔\x1b[0m ${c.name}: Valid JSON at ${c.path} ${tag}`);
        } catch (err: any) {
          console.log(`  \x1b[31m✖\x1b[0m ${c.name}: Malformed JSON in ${c.path} (${err.message})`);
        }
      } else {
        console.log(`  \x1b[90m○\x1b[0m ${c.name}: Not yet created at ${c.path}`);
      }
    }

    console.log("\nDiagnostics complete.\n");
  });

// ----------------------------------------------------------------------------
// Command: uninstall
// ----------------------------------------------------------------------------
program
  .command("uninstall")
  .description("Safely remove nogyaan MCP server from Claude Desktop and Cursor configs")
  .option("--project", "Also remove from project-local .cursor/mcp.json and .mcp.json")
  .action(async (options) => {
    console.log("\n🧹 \x1b[1m\x1b[32mnogyaan\x1b[0m \x1b[1m\x1b[37m— Uninstaller\x1b[0m\n");

    const targets = [
      ...getAllClaudeDesktopConfigTargets(),
      { name: "Cursor (Global)", path: getCursorGlobalConfigPath() },
    ];

    if (options.project) {
      targets.push({ name: "Cursor (Project)", path: getProjectCursorConfigPath() });
      targets.push({ name: "Claude Code (Project)", path: getProjectClaudeCodeConfigPath() });

      const rulePath = getProjectCursorRulePath();
      if (fs.existsSync(rulePath)) {
        try {
          fs.unlinkSync(rulePath);
          console.log(`  \x1b[32m✔\x1b[0m Removed Cursor rule at ${rulePath}`);
        } catch {}
      }
    }

    for (const t of targets) {
      const res = safeRemoveMcpServer(t.path, t.name);
      if (res.status === "removed") {
        console.log(`  \x1b[32m✔\x1b[0m Removed 'nogyaan' from ${t.path} (Backup: ${path.basename(res.backupPath || "")})`);
      } else if (res.status === "skipped") {
        console.log(`  \x1b[90m○\x1b[0m 'nogyaan' was not present in ${t.path}`);
      } else if (res.status === "aborted") {
        console.error(`  \x1b[31m✖\x1b[0m ${res.error}`);
      }
    }

    console.log("\nUninstallation finished. Restart Claude Desktop / Cursor.\n");
  });

// ----------------------------------------------------------------------------
// Command: serve
// ----------------------------------------------------------------------------
program
  .command("serve")
  .description("Launch the nogyaan Stdio MCP server")
  .action(async () => {
    await import("./index.js");
  });

program.parse(process.argv);
