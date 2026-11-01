#!/usr/bin/env node

/**
 * @file src/index.ts
 * @description Master Stdio MCP Server Entry Point for Ad Director.
 * Enforces strict FSM stages, Zod schemas, Anti-Jargon validation,
 * referential integrity checks, and serves the HTML-sanitized studio UI on http://localhost:4321.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { DAGStore, sanitizeObjectForHtml } from "./state/dag-store.js";
import { initBriefSchema, executeInitBrief } from "./tools/1-init-brief.js";
import { branchSceneSchema, executeBranchScene } from "./tools/2-branch-scene.js";
import { lockAssetsSchema, executeLockAssets } from "./tools/3-lock-assets.js";
import { compileShotsSchema, executeCompileShots } from "./tools/4-compile-shots.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves the package root directory relative to import.meta.url by searching upwards.
 */
function getPackageRoot(): string {
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

// Initialize authoritative DAG Store instance
const dagStore = new DAGStore();

// ============================================================================
// 1. Studio Web Server (http://localhost:4321) with HTML Entity Sanitization
// ============================================================================

function startStudioServer(port: number = 4321): void {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || "/", `http://localhost:${port}`);

    // API endpoint returning current DAG story state with HTML entity sanitization
    if (parsedUrl.pathname === "/api/graph") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      const rawGraph = dagStore.load();
      // Enforce HTML entity escaping (<, >, &, ", ') before serving
      const sanitizedGraph = sanitizeObjectForHtml(rawGraph);
      res.end(JSON.stringify(sanitizedGraph, null, 2));
      return;
    }

    // Serve Studio Visual Canvas
    if (parsedUrl.pathname === "/" || parsedUrl.pathname === "/index.html") {
      const pkgRoot = getPackageRoot();
      const candidates = [
        path.join(pkgRoot, "dist", "ui", "studio-app.html"),
        path.join(pkgRoot, "src", "ui", "studio-app.html"),
        path.resolve(__dirname, "ui/studio-app.html"),
        path.resolve(__dirname, "../src/ui/studio-app.html"),
      ];

      let html = "";
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          html = fs.readFileSync(c, "utf-8");
          break;
        }
      }

      if (html) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } else {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("studio-app.html not found.");
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[ad-director] Studio canvas port ${port} is already active.`);
    } else {
      console.error("[ad-director] Studio server error:", err);
    }
  });

  server.listen(port, () => {
    console.error(`[ad-director] Studio visual canvas running at http://localhost:${port}`);
  });
}

// ============================================================================
// 2. MCP Server Definition & Handlers
// ============================================================================

const server = new Server(
  {
    name: "ad-director-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// 2.1 List Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "init_brief",
        description:
          "Step 1: Initializes the brand brief and campaign friction in the DAG state machine. Sets stage to CORE_THEME. Scans for anti-jargon compliance.",
        inputSchema: {
          type: "object",
          properties: {
            company: { type: "string", description: "Company or brand name" },
            product: { type: "string", description: "Specific product or service being promoted" },
            goal: { type: "string", description: "Core business objective or conversion goal" },
            audience: { type: "string", description: "Target demographic or cultural segment" },
            preset: {
              type: "string",
              enum: ["indian-d2c-story", "dev-product-launch", "tiktok-ugc-hook"],
              default: "indian-d2c-story",
              description: "Narrative preset (defaults to indian-d2c-story)",
            },
            brandFriction: {
              type: "string",
              description: "The deep emotional or everyday human friction this brand resolves",
            },
            initialOptions: {
              type: "array",
              description: "Optional initial 3 options for CORE_THEME",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  description: { type: "string" },
                  treatmentProse: { type: "string" },
                },
                required: ["id", "title", "description"],
              },
            },
          },
          required: ["company", "product", "goal"],
        },
      },
      {
        name: "branch_scene",
        description:
          "Step 2 to 5: Commits a selected creative option ('1', '2', '3') or triggers regeneration ('R'). Enforces strict FSM stage sequence, prunes discarded options, and blocks technical camera jargon.",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["commit", "regenerate"],
              description: "Action type: 'commit' to lock an option, or 'regenerate' (R) to overwrite options without advancing stage",
            },
            selectedOptionId: {
              type: "string",
              enum: ["1", "2", "3"],
              description: "Selected option identifier ('1', '2', or '3'). Required when action is 'commit'",
            },
            nextOptions: {
              type: "array",
              description: "The 3 proposed narrative options for the stage",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  description: { type: "string" },
                  treatmentProse: { type: "string" },
                },
                required: ["id", "title", "description"],
              },
            },
            title: { type: "string", description: "Optional title for the chosen option" },
            description: { type: "string", description: "Optional description for the chosen option" },
            treatmentProse: { type: "string", description: "Cinematic screenplay paragraph for the locked choice" },
          },
          required: ["action"],
        },
      },
      {
        name: "lock_assets",
        description:
          "Step 6: Locks character appearance anchors (CHAR_01..N), background environments (BG_01..N), and hero product (PROD_01). Can only be called after SCENE_4_CLIMAX is locked.",
        inputSchema: {
          type: "object",
          properties: {
            characters: {
              type: "array",
              description: "List of character asset definitions with appearance prompts (CHAR_01..N)",
              items: {
                type: "object",
                properties: {
                  assetId: { type: "string", description: "Character ID matching CHAR_01..N (e.g. 'CHAR_01')" },
                  name: { type: "string" },
                  role: { type: "string", default: "Lead" },
                  appearancePrompt: { type: "string" },
                  pulidSeed: { type: "integer", default: 42 },
                },
                required: ["assetId", "name", "appearancePrompt"],
              },
            },
            environments: {
              type: "array",
              description: "List of location asset definitions with lighting profiles (BG_01..N)",
              items: {
                type: "object",
                properties: {
                  assetId: { type: "string", description: "Background ID matching BG_01..N (e.g. 'BG_01')" },
                  name: { type: "string" },
                  environmentPrompt: { type: "string" },
                  lightingProfile: { type: "string", default: "Cinematic atmospheric lighting" },
                },
                required: ["assetId", "name", "environmentPrompt"],
              },
            },
            product: {
              type: "object",
              description: "Hero product asset definition (must have assetId 'PROD_01')",
              properties: {
                assetId: { type: "string", default: "PROD_01" },
                name: { type: "string" },
                productPrompt: { type: "string" },
                category: { type: "string", default: "D2C Hero Product" },
              },
              required: ["assetId", "name", "productPrompt"],
            },
          },
          required: ["characters", "environments"],
        },
      },
      {
        name: "compile_shots",
        description:
          "Step 7: Compiles locked scenes into technical shot geometry with referential integrity verification and server-side video prompt auto-compilation. Can only be called after LOCK_ASSETS.",
        inputSchema: {
          type: "object",
          properties: {
            shots: {
              type: "array",
              description: "Ordered shot list breakdown referencing locked CHAR_01..N and BG_01..N",
              items: {
                type: "object",
                properties: {
                  sceneId: { type: "string" },
                  order: { type: "integer" },
                  title: { type: "string" },
                  action: { type: "string" },
                  dialogue: { type: "string" },
                  characterId: { type: "string", description: "Must exist in AssetRegistry (e.g. 'CHAR_01')" },
                  characterIds: { type: "array", items: { type: "string" } },
                  backgroundId: { type: "string", description: "Must exist in AssetRegistry (e.g. 'BG_01')" },
                  locationId: { type: "string" },
                  lens: { type: "string", default: "35mm cinematic lens" },
                  cameraAngle: {
                    type: "string",
                    enum: [
                      "CAM_A_CENTER",
                      "CAM_B_45_CLOSE",
                      "CAM_C_OTS",
                      "CLOSE_UP",
                      "MEDIUM_SHOT",
                      "WIDE_SHOT",
                      "EXTREME_CLOSE_UP",
                      "ESTABLISHING",
                    ],
                    default: "CAM_A_CENTER",
                  },
                  cameraMovement: {
                    type: "string",
                    enum: [
                      "STATIC",
                      "PUSH_IN",
                      "PULL_OUT",
                      "PAN_LEFT",
                      "PAN_RIGHT",
                      "TILT_UP",
                      "TILT_DOWN",
                      "TRACKING",
                      "ORBIT",
                    ],
                    default: "STATIC",
                  },
                  duration: { type: "number", default: 5 },
                },
                required: ["sceneId", "action"],
              },
            },
            openStudioUi: {
              type: "boolean",
              default: true,
              description: "Whether to automatically open http://localhost:4321 in the browser",
            },
          },
          required: ["shots"],
        },
      },
    ],
  };
});

// 2.2 Call Tool Execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "init_brief": {
        const result = await executeInitBrief(args as any, dagStore);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
      case "branch_scene": {
        const result = await executeBranchScene(args as any, dagStore);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
      case "lock_assets": {
        const result = await executeLockAssets(args as any, dagStore);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
      case "compile_shots": {
        const result = await executeCompileShots(args as any, dagStore);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    console.error(`[ad-director] Tool execution error for ${name}:`, err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: err.message || String(err),
        },
      ],
    };
  }
});

// 2.3 Resources: Expose Current Graph
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "ad-director://story_graph",
        name: "Ad Director Story Graph",
        description:
          "The authoritative DAG state machine containing locked decisions, screenplay treatment, assets, and shot list.",
        mimeType: "application/json",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === "ad-director://story_graph") {
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "application/json",
          text: JSON.stringify(sanitizeObjectForHtml(dagStore.load()), null, 2),
        },
      ],
    };
  }
  throw new Error(`Resource not found: ${request.params.uri}`);
});

// ============================================================================
// 3. Main Launch
// ============================================================================

async function main() {
  // Start local Studio UI web server in background
  startStudioServer(4321);

  // Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[ad-director] Ad Director MCP Server running on stdio.");
}

main().catch((err) => {
  console.error("[ad-director] Fatal server error:", err);
  process.exit(1);
});
