#!/usr/bin/env node

/**
 * @file src/index.ts
 * @description Master Stdio MCP Server Entry Point for nogyaan.
 * Enforces strict FSM stages, Zod schemas, Anti-Jargon validation,
 * referential integrity checks, and serves the Studio UI on http://localhost:4321.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { PresetRegistryService } from './services/preset-registry.service.js';
import { PromptCompilerService } from './services/prompt-compiler.service.js';
import { SessionDagService } from './services/session-dag.service.js';
import { DirectorsShotCompilerService } from './services/directors-shot-compiler.service.js';
import { StateManager } from './v2/state-manager.js';
import { WritersRoomService } from './v2/writers-room.service.js';
import { AssetLockerService } from './v2/asset-locker.service.js';
import { DpPitchService } from './v2/dp-pitch.service.js';
import { RerollService } from './v2/reroll.service.js';
import { Medium } from './v2/types.js';
import { registerMcpPrompts } from './mcp/prompts.js';
import { registerMcpTools } from './mcp/tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves the package root directory relative to import.meta.url by searching upwards.
 */
function getPackageRoot(): string {
  let curr = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(curr, 'package.json'))) {
      return curr;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

// Initialize Single-Responsibility Services
const promptCompiler = new PromptCompilerService();
const presetRegistry = new PresetRegistryService();
const sessionService = new SessionDagService(undefined, promptCompiler);
const directorsCompiler = new DirectorsShotCompilerService(sessionService);

// Initialize V2 Architecture Services
const stateManager = new StateManager();
const writersRoom = new WritersRoomService(stateManager);
const assetLocker = new AssetLockerService(stateManager);
const dpPitch = new DpPitchService(stateManager);
const rerollService = new RerollService(stateManager);

function parseJsonBody<T = any>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : ({} as T));
      } catch (err: any) {
        reject(new Error(`Invalid JSON body: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

// ============================================================================
// 1. Studio Web Server (http://localhost:4321) - Zero HTML Entity Corruption
// ============================================================================

function startStudioServer(port: number = 4321): void {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://localhost:${port}`);

    // API endpoint returning current active session state as raw UTF-8 JSON
    if (parsedUrl.pathname === '/api/graph') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const currentSession = sessionService.loadSession();
      if (currentSession) {
        res.end(JSON.stringify(currentSession, null, 2));
      } else {
        res.end(JSON.stringify({ status: 'NO_ACTIVE_SESSION' }));
      }
      return;
    }

    // API endpoint: Tier 2 Initial Compilation (POST /api/compile-shots)
    if (req.method === 'POST' && parsedUrl.pathname === '/api/compile-shots') {
      parseJsonBody(req)
        .then(async (body) => {
          try {
            const cut = await directorsCompiler.compileDirectorsCut(body);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(cut, null, 2));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
          }
        })
        .catch((err) => {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // API endpoint: Tier 2 Targeted Re-Roll (POST /api/reroll-shot)
    if (req.method === 'POST' && parsedUrl.pathname === '/api/reroll-shot') {
      parseJsonBody(req)
        .then(async (body) => {
          try {
            const cut = await directorsCompiler.rerollSubShot(body);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(cut, null, 2));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
          }
        })
        .catch((err) => {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // API endpoint: Get Current DirectorsCut (GET /api/directors-cut)
    if (req.method === 'GET' && parsedUrl.pathname === '/api/directors-cut') {
      const sessionId = parsedUrl.searchParams.get('session_id') || undefined;
      const cut = directorsCompiler.loadCurrentDirectorsCut(sessionId);
      if (cut) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(cut, null, 2));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'NO_DIRECTORS_CUT' }));
      }
      return;
    }

    // ========================================================================
    // V2 Architecture Endpoints (State, SSE Stream, Pitch & Targeted Re-Roll)
    // ========================================================================

    // 1. Get V2 State (GET /api/v2/state)
    if (req.method === 'GET' && parsedUrl.pathname === '/api/v2/state') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(stateManager.getState(), null, 2));
      return;
    }

    // 2. Server-Sent Events (SSE) Live Sync Stream (GET /api/v2/events)
    if (req.method === 'GET' && parsedUrl.pathname === '/api/v2/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      // Send initial handshake and state
      res.write(`: connected\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'INIT', state: stateManager.getState() })}\n\n`);

      // Subscribe to state changes triggered by MCP tools or UI actions
      const unsubscribe = stateManager.subscribe((updatedState) => {
        try {
          res.write(`data: ${JSON.stringify({ type: 'STATE_UPDATED', state: updatedState })}\n\n`);
        } catch {}
      });

      // Keepalive heartbeat
      const heartbeat = setInterval(() => {
        try {
          res.write(`: heartbeat\n\n`);
        } catch {}
      }, 15000);

      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      return;
    }

    // 3. Update Global Medium (POST /api/v2/medium)
    if (req.method === 'POST' && parsedUrl.pathname === '/api/v2/medium') {
      parseJsonBody<{ medium: Medium }>(req)
        .then((body) => {
          try {
            const newState = stateManager.updateGlobalMedium(body.medium);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, state: newState }));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
          }
        })
        .catch((err) => {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // 4. Update Asset Bible (POST /api/v2/assets)
    if (req.method === 'POST' && parsedUrl.pathname === '/api/v2/assets') {
      parseJsonBody(req)
        .then((body) => {
          try {
            const currentState = stateManager.getState();
            const assets = {
              characters: body.characters !== undefined ? body.characters : currentState.assets.characters,
              backgrounds: body.backgrounds !== undefined ? body.backgrounds : currentState.assets.backgrounds,
              product: body.product !== undefined ? body.product : currentState.assets.product
            };
            const newState = stateManager.updateAssetBible(assets);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, state: newState }));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
          }
        })
        .catch((err) => {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // 5. Pitch Script Options (POST /api/v2/pitch-script)
    if (req.method === 'POST' && parsedUrl.pathname === '/api/v2/pitch-script') {
      parseJsonBody(req)
        .then(async (body) => {
          try {
            const options = await writersRoom.pitchScriptOptions(body);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, scene_id: body.scene_id, options }));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
          }
        })
        .catch((err) => {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // 6. Lock Script Option (POST /api/v2/lock-script)
    if (req.method === 'POST' && parsedUrl.pathname === '/api/v2/lock-script') {
      parseJsonBody(req)
        .then((body) => {
          try {
            const newState = stateManager.lockScript(body.scene_id, body.script);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, state: newState }));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
          }
        })
        .catch((err) => {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // 7. Pitch Shot Options (POST /api/v2/pitch-shot)
    if (req.method === 'POST' && parsedUrl.pathname === '/api/v2/pitch-shot') {
      parseJsonBody(req)
        .then(async (body) => {
          try {
            const options = await dpPitch.pitchShotOptions(body);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, scene_id: body.scene_id, shot_id: body.shot_id, options }));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
          }
        })
        .catch((err) => {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // 8. Lock Shot Option (POST /api/v2/lock-shot)
    if (req.method === 'POST' && parsedUrl.pathname === '/api/v2/lock-shot') {
      parseJsonBody(req)
        .then((body) => {
          try {
            const spatialFacts = body.spatial_facts || body.spatial_memory_updates;
            const newState = stateManager.lockShot(
              body.scene_id,
              body.shot_id,
              body.shot,
              spatialFacts
            );
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, state: newState }));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
          }
        })
        .catch((err) => {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // 8.1. Update Global Director Notes (POST /api/v2/director-notes)
    if (req.method === 'POST' && parsedUrl.pathname === '/api/v2/director-notes') {
      parseJsonBody<{ notes?: string; global_director_notes?: string }>(req)
        .then((body) => {
          try {
            const notes = body.notes !== undefined ? body.notes : (body.global_director_notes || '');
            const newState = stateManager.setGlobalDirectorNotes(notes);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, state: newState }));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
          }
        })
        .catch((err) => {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // 8.5. Extract Active Assets & Tag Scenes (POST /api/v2/extract-assets)
    if (req.method === 'POST' && parsedUrl.pathname === '/api/v2/extract-assets') {
      assetLocker.extractActiveAssets()
        .then((result) => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, extraction: result.extraction, state: result.state }));
        })
        .catch((err) => {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // 9. Targeted Re-Roll (POST /api/v2/reroll-node)
    if (req.method === 'POST' && parsedUrl.pathname === '/api/v2/reroll-node') {
      parseJsonBody(req)
        .then(async (body) => {
          try {
            const result = await rerollService.rerollNode({
              node_id: body.node_id,
              user_feedback: body.user_feedback
            });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, result }));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
          }
        })
        .catch((err) => {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // Serve Static Assets from assets/ directory (e.g. /assets/logo.png)
    if (parsedUrl.pathname.startsWith('/assets/')) {
      const pkgRoot = getPackageRoot();
      const relativeAsset = parsedUrl.pathname.replace(/^\/assets\//, '');
      const assetFilePath = path.resolve(pkgRoot, 'assets', relativeAsset);
      const assetsDir = path.resolve(pkgRoot, 'assets');

      if (assetFilePath.startsWith(assetsDir) && fs.existsSync(assetFilePath)) {
        try {
          const stat = fs.statSync(assetFilePath);
          if (stat.isFile()) {
            const ext = path.extname(assetFilePath).toLowerCase();
            const contentTypes: Record<string, string> = {
              '.png': 'image/png',
              '.svg': 'image/svg+xml',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.webp': 'image/webp',
              '.gif': 'image/gif',
              '.ico': 'image/x-icon'
            };
            const contentType = contentTypes[ext] || 'application/octet-stream';
            res.writeHead(200, {
              'Content-Type': contentType,
              'Content-Length': stat.size,
              'Cache-Control': 'public, max-age=86400'
            });
            fs.createReadStream(assetFilePath).pipe(res);
            return;
          }
        } catch {}
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Asset Not Found');
      return;
    }

    // Serve Studio Visual Canvas
    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
      const pkgRoot = getPackageRoot();
      const candidates = [
        path.join(pkgRoot, 'dist', 'ui', 'studio-app.html'),
        path.join(pkgRoot, 'src', 'ui', 'studio-app.html'),
        path.resolve(__dirname, 'ui/studio-app.html'),
        path.resolve(__dirname, '../src/ui/studio-app.html')
      ];

      let html = '';
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          html = fs.readFileSync(c, 'utf-8');
          break;
        }
      }

      if (html) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('studio-app.html not found.');
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[nogyaan] Studio canvas port ${port} is already active.`);
    } else {
      console.error('[nogyaan] Studio server error:', err);
    }
  });

  server.listen(port, () => {
    console.error(`[nogyaan] Studio visual canvas running at http://localhost:${port}`);
  });
}

// ============================================================================
// 2. MCP Server Definition & Handlers
// ============================================================================

const server = new Server(
  {
    name: 'nogyaan',
    version: '1.0.0'
  },
  {
    capabilities: {
      prompts: {},
      tools: {},
      resources: {}
    }
  }
);

// Register Dynamic MCP Prompts for Claude Slash Commands (/preset-...)
registerMcpPrompts(server, presetRegistry);

// Register MCP Tools (list_presets, init_brief, branch_scene, lock_assets, compile_shots, pitch_script_options, etc.)
registerMcpTools(
  server,
  sessionService,
  presetRegistry,
  promptCompiler,
  stateManager,
  writersRoom,
  dpPitch,
  rerollService,
  assetLocker
);

// Expose Resources: Current Active Story Graph and V2 State
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'nogyaan://story_graph',
        name: 'nogyaan Story Graph',
        description:
          'Authoritative state machine containing locked decisions, screenplay treatment, assets, and shot list.',
        mimeType: 'application/json'
      },
      {
        uri: 'nogyaan://v2/state',
        name: 'nogyaan V2 State',
        description:
          'V2 State Manager (nogyaan-state.json) containing global medium, asset bible, scenes, and shots.',
        mimeType: 'application/json'
      }
    ]
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (
    request.params.uri === 'nogyaan://story_graph' ||
    request.params.uri.endsWith('://story_graph')
  ) {
    const session = sessionService.loadSession();
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'application/json',
          text: JSON.stringify(session || {}, null, 2)
        }
      ]
    };
  }

  if (
    request.params.uri === 'nogyaan://v2/state' ||
    request.params.uri.endsWith('://v2/state')
  ) {
    const v2State = stateManager.getState();
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'application/json',
          text: JSON.stringify(v2State, null, 2)
        }
      ]
    };
  }

  throw new Error(`Resource not found: ${request.params.uri}`);
});

// ============================================================================
// 3. Main Launch
// ============================================================================

async function main() {
  startStudioServer(4321);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[nogyaan] nogyaan MCP Server running on stdio.');
}

main().catch((err) => {
  console.error('[nogyaan] Fatal server error:', err);
  process.exit(1);
});
