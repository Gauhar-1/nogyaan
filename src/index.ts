#!/usr/bin/env node

/**
 * @file src/index.ts
 * @description Master Stdio MCP Server Entry Point for noslop.
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

// ============================================================================
// 1. Studio Web Server (http://localhost:4321) - Zero HTML Entity Corruption
// ============================================================================

function startStudioServer(port: number = 4321): void {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

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
      console.error(`[noslop] Studio canvas port ${port} is already active.`);
    } else {
      console.error('[noslop] Studio server error:', err);
    }
  });

  server.listen(port, () => {
    console.error(`[noslop] Studio visual canvas running at http://localhost:${port}`);
  });
}

// ============================================================================
// 2. MCP Server Definition & Handlers
// ============================================================================

const server = new Server(
  {
    name: 'noslop',
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

// Register MCP Tools (list_presets, init_brief, branch_scene, lock_assets, compile_shots)
registerMcpTools(server, sessionService, presetRegistry, promptCompiler);

// Expose Resource: Current Active Story Graph
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'noslop://story_graph',
        name: 'noslop Story Graph',
        description:
          'Authoritative state machine containing locked decisions, screenplay treatment, assets, and shot list.',
        mimeType: 'application/json'
      },
      {
        uri: 'ad-director://story_graph',
        name: 'noslop Story Graph (Legacy Alias)',
        description:
          'Legacy alias for authoritative state machine containing locked decisions, screenplay treatment, assets, and shot list.',
        mimeType: 'application/json'
      }
    ]
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (
    request.params.uri === 'noslop://story_graph' ||
    request.params.uri === 'ad-director://story_graph'
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
  throw new Error(`Resource not found: ${request.params.uri}`);
});

// ============================================================================
// 3. Main Launch
// ============================================================================

async function main() {
  startStudioServer(4321);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[noslop] noslop MCP Server running on stdio.');
}

main().catch((err) => {
  console.error('[noslop] Fatal server error:', err);
  process.exit(1);
});
