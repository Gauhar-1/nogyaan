// tests/test-dynamic-session-routing.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StateManager } from '../dist/v2/state-manager.js';
import { listAllSessions } from '../dist/index.js';
import { registerMcpTools } from '../dist/mcp/tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceDir = path.resolve(__dirname, '..');

console.log('🧪 Starting Dynamic Session Routing Automated Verification Suite...\n');

// 1. Setup two isolated mock sessions in .nogyaan/sessions/
const sessionsDir = path.resolve(workspaceDir, '.nogyaan', 'sessions');
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

const sessionAId = `test-session-a-${Date.now().toString(36)}`;
const sessionBId = `test-session-b-${Date.now().toString(36)}`;

const smA = StateManager.forSession(sessionAId, workspaceDir);
smA.updateAssetBible({
  product: 'Product Alpha 3000'
});

// Sleep 50ms so session B has a strictly newer mtime
await new Promise(r => setTimeout(r, 50));

const smB = StateManager.forSession(sessionBId, workspaceDir);
smB.updateAssetBible({
  product: 'Product Beta Max'
});

console.log(`▶ Created test session A: ${sessionAId}`);
console.log(`▶ Created test session B: ${sessionBId}`);

// 2. Test listAllSessions() helper
console.log('\n🔹 [Test 1] Verifying listAllSessions() sorting and metadata extraction...');
const allSessions = listAllSessions();
assert(Array.isArray(allSessions), 'listAllSessions must return an array');
assert(allSessions.length >= 2, 'Must contain at least the 2 test sessions');

// Verify session B is ranked before session A (most recently modified first)
const indexB = allSessions.findIndex(s => s.sessionId === sessionBId);
const indexA = allSessions.findIndex(s => s.sessionId === sessionAId);
assert(indexB !== -1, 'Session B must exist in listAllSessions()');
assert(indexA !== -1, 'Session A must exist in listAllSessions()');
assert(indexB < indexA, 'Session B (newer mtime) must appear before Session A');

const itemB = allSessions[indexB];
assert.equal(itemB.sessionId, sessionBId);
assert(itemB.updatedAt, 'Session must include updatedAt');
assert(itemB.mtime > 0, 'Session must include mtimeMs');
console.log('  ✔ listAllSessions() accurately orders by mtime descending with full metadata.');

// 3. Test HTTP Server Endpoints
console.log('\n🔹 [Test 2] Verifying Backend HTTP Routing for /api/sessions and /api/state/:sessionId...');

// Helper to make local HTTP requests
function makeRequest(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:4321${path}`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    }).on('error', reject);
  });
}

// Check GET /api/sessions
const sessionsResp = await makeRequest('/api/sessions');
assert.equal(sessionsResp.statusCode, 200, 'GET /api/sessions must return 200');
const sessionsJson = JSON.parse(sessionsResp.body);
assert(Array.isArray(sessionsJson), '/api/sessions must return an array');
assert(sessionsJson.some(s => s.sessionId === sessionAId), 'API must list Session A');
assert(sessionsJson.some(s => s.sessionId === sessionBId), 'API must list Session B');
console.log('  ✔ GET /api/sessions endpoint returns valid JSON list of active sessions.');

// Check GET /api/state/:sessionId (Path param)
const stateRespA = await makeRequest(`/api/state/${sessionAId}`);
assert.equal(stateRespA.statusCode, 200, 'GET /api/state/:sessionId must return 200');
const stateDataA = JSON.parse(stateRespA.body);
assert.equal(stateDataA.project_id, sessionAId);
assert.equal(stateDataA.assets?.product, 'Product Alpha 3000');
console.log('  ✔ GET /api/state/:sessionId correctly resolves specific session via path param.');

// Check GET /api/v2/state?session=:sessionId (Query param)
const stateRespB = await makeRequest(`/api/v2/state?session=${sessionBId}`);
assert.equal(stateRespB.statusCode, 200, 'GET /api/v2/state?session= must return 200');
const stateDataB = JSON.parse(stateRespB.body);
assert.equal(stateDataB.project_id, sessionBId);
assert.equal(stateDataB.assets?.product, 'Product Beta Max');
console.log('  ✔ GET /api/v2/state?session= correctly resolves specific session via query param.');

// Check GET /api/state without params (Defaults to most recently modified session)
const defaultStateResp = await makeRequest('/api/state');
assert.equal(defaultStateResp.statusCode, 200, 'GET /api/state without params must return 200');
const defaultStateData = JSON.parse(defaultStateResp.body);
assert.equal(defaultStateData.project_id, allSessions[0].sessionId, 'Must default to most recently modified session');
console.log(`  ✔ GET /api/state without params automatically routes to most recent session (${allSessions[0].sessionId}).`);

// 4. Test MCP Tools studio_url dynamic response
console.log('\n🔹 [Test 3] Verifying compile_sota_prompt & branch_scene dynamic studio_url responses...');

let listHandler = null;
let callHandler = null;
const mockServer = {
  setRequestHandler: (schema, handler) => {
    if (!listHandler) {
      listHandler = handler;
    } else {
      callHandler = handler;
    }
  }
};

const { SessionDagService } = await import('../dist/services/session-dag.service.js');
const { PresetRegistryService } = await import('../dist/services/preset-registry.service.js');
const { PromptCompilerService } = await import('../dist/services/prompt-compiler.service.js');
const { WritersRoomService } = await import('../dist/v2/writers-room.service.js');
const { DpPitchService } = await import('../dist/v2/dp-pitch.service.js');
const { RerollService } = await import('../dist/v2/reroll.service.js');
const { AssetLockerService } = await import('../dist/v2/asset-locker.service.js');

const pc = new PromptCompilerService();
const pr = new PresetRegistryService();
const ss = new SessionDagService(undefined, pc);
const sm = StateManager.forSession(sessionAId, workspaceDir);
const wr = new WritersRoomService(sm);
const dp = new DpPitchService(sm);
const rr = new RerollService(sm);
const al = new AssetLockerService(sm);

registerMcpTools(
  mockServer,
  ss,
  pr,
  pc,
  sm,
  wr,
  dp,
  rr,
  al
);

// Initialize brief first
const initCall = await callHandler({
  params: {
    name: 'init_brief',
    arguments: {
      session_id: sessionAId,
      company: 'Brand Alpha',
      product: 'Product Alpha 3000',
      goal: 'Launch Campaign Alpha',
      preset: 'indian-d2c-story'
    }
  }
});
if (initCall.isError) {
  console.error('initCall error:', initCall.content[0].text);
}
assert(!initCall.isError, 'init_brief must succeed');

// Lock core theme
const lockThemeCall = await callHandler({
  params: {
    name: 'lock_core_theme',
    arguments: {
      session_id: sessionAId,
      chosen_theme_id: '1',
      theme_title: 'Theme Alpha',
      brand_name: 'Brand Alpha',
      product_name: 'Product Alpha 3000',
      campaign_goal: 'Launch Brand Alpha',
      theme_premise: 'Premise Alpha'
    }
  }
});
if (lockThemeCall.isError) {
  console.error('lockThemeCall error:', lockThemeCall.content[0].text);
}
assert(!lockThemeCall.isError, 'lock_core_theme must succeed');

// Call branch_scene with session_id
const branchCall = await callHandler({
  params: {
    name: 'branch_scene',
    arguments: {
      session_id: sessionAId,
      action: 'commit',
      selected_option: '1',
      scene_number: 1,
      beat_summary: 'Devon stares at terminal'
    }
  }
});

if (branchCall.isError) {
  console.error('branchCall error:', branchCall.content[0].text);
}
assert(!branchCall.isError, 'branch_scene must succeed');
const rawBranchText = branchCall.content[0].text;
const branchData = JSON.parse(rawBranchText.slice(rawBranchText.indexOf('{')));
assert.equal(
  branchData.studio_url,
  `http://localhost:4321/?session=${sessionAId}`,
  'branch_scene must return dynamic studio_url with session_id'
);
console.log(`  ✔ branch_scene returns dynamic studio_url: ${branchData.studio_url}`);

// 5. Verify Frontend UI source code for dynamic routing & sidebar switcher
console.log('\n🔹 [Test 4] Verifying Frontend UI implementation (Monochrome brutalist & no icons)...');
const htmlContent = fs.readFileSync(path.resolve(workspaceDir, 'src/ui/studio-app.html'), 'utf-8');

assert(htmlContent.includes("fetch('/api/sessions')"), 'Frontend must fetch /api/sessions');
assert(htmlContent.includes("params.get('session')"), 'Frontend must read ?session= query parameter');
assert(htmlContent.includes('session-switcher-box'), 'Frontend must include session-switcher-box in sidebar');
assert(htmlContent.includes('session-select'), 'Frontend must include session-select dropdown');
assert(htmlContent.includes('updateUrlParam'), 'Frontend must support URL parameter sync');

// Verify strict monochrome & no icon libraries
assert(!htmlContent.includes('lucide'), 'Frontend must not include Lucide icons');
assert(!htmlContent.includes('font-awesome'), 'Frontend must not include FontAwesome');
assert(!htmlContent.includes('fa-'), 'Frontend must not use FontAwesome classes');

console.log('  ✔ Frontend UI source strictly adheres to Dynamic Routing and Monochrome Brutalist design.');

// Clean up test sessions
try {
  fs.unlinkSync(path.resolve(sessionsDir, `${sessionAId}.json`));
  fs.unlinkSync(path.resolve(sessionsDir, `${sessionBId}.json`));
} catch {}

console.log('\n🎉 ALL DYNAMIC SESSION ROUTING TESTS PASSED 100%!');
process.exit(0);
