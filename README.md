# Ad Director MCP (🎬 `ad-director-mcp`)

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-1.6.0-purple.svg)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Studio-Grade Video Ad Director & Production Orchestrator** for Claude Desktop, Cursor, and Claude Code. Powered by hardened DAG state machine branching (1/2/3/R), scene-to-scene physical continuity locks (`exit_frame_anchor`), reference-tagged kinetic video prompts, and a real-time 3-Zone local production studio canvas.

---

## 🌟 Key Highlights

- **🎛️ Native Claude Input-Bar Presets (`/preset-*`)**:
  Select storytelling frameworks directly from Claude Desktop's slash menu:
  - `/preset-indian-d2c-story`: Deeply emotional human-centric advertising (Piyush Pandey school of human truth). Hinglish character dialogue with 100% English camera directions.
  - `/preset-dev-product-launch`: High-craft developer cinema showcasing painful production bugs, terminal flow states, and friction relief. Strictly 100% English.
  - `/preset-tiktok-ugc-hook`: High-velocity vertical video framework engineered for thumb-stopping 0-3 second retention. Strictly 100% English.
- **🛡️ Hardened FSM Stage Locks & Anti-Jargon Gate**:
  Deterministic sequence enforcement (`CORE_THEME` ➔ `SCENE_1_SETUP` ➔ `SCENE_2_CATALYST` ➔ `SCENE_3_TWIST` ➔ `SCENE_4_CLIMAX` ➔ `LOCK_ASSETS` ➔ `COMPILE_SHOTS` ➔ `COMPLETED`). Blocks camera specs during narrative stages with automated error rejection.
- **✂️ 1/2/3/R State-Pruning Decision Engine**:
  Locks approved creative choices, wipes unchosen branches, tracks cumulative pruned branches, and supports instant regeneration (`R`) without advancing stages.
- **🔗 Physical Continuity Bridge (`exit_frame_anchor`)**:
  Every committed scene locks its exact physical termination frame (character posture, objects, camera position), enforcing visual continuity into the next scene.
- **🏷️ Reference-Tagged Kinetic Video Prompts**:
  Tailored for modern generative video models (**Kling 3.0 Omni**, **Google Veo 3.1**, **Runway Gen-4.5**, **Seedance**). Uses reference image tags (`@CHAR_01`, `@BG_01`, `@PROD_01`), concise kinetic actions, dialogue lip-sync, and SFX/audio descriptors without bloated 80-word static appearance text.
- **🎨 3-Zone Local Web Studio Canvas (`http://localhost:4321`)**:
  Real-time dark mode production bible:
  - **Zone 1**: The Approved Master Narrative Arc with exit-frame continuity bridges.
  - **Zone 2**: Master Continuity Asset Bible with one-click Midjourney/Flux prompt copying.
  - **Zone 3**: Two-Column Screenplay & AI Kinetic Video Prompt Matrix.
  - Pure UTF-8 data flow—zero HTML entity double-escaping (`&#039;` / `&quot;`).
- **🗂️ Isolated Session DAGs**:
  Sessions are isolated in `.ad-director/sessions/<companySlug>-<shortId>.json` with `.ad-director/latest-active.json` pointers. Prevents cross-tab pollution and enforces the New-Session Intake Gate.

---

## 🚀 Quickstart & Installation

### Option 1: Automatic CLI Setup (Recommended)

Run the cross-platform auto-injector:

```bash
# Production setup via npx
npx ad-director-mcp init

# Or for project-local config (.cursor/mcp.json and .mcp.json)
npx ad-director-mcp init --project
```

The CLI automatically detects your OS and configures:
- **Claude Desktop** (macOS, Linux, and Windows standard + MSIX Store virtualized paths)
- **Cursor** (Global `~/.cursor/mcp.json` or project-local)
- **Claude Code** (Project-local `.mcp.json`)

### Option 2: Local Development Setup

Clone the repository and build:

```bash
git clone https://github.com/your-org/ad-director-mcp.git
cd ad-director-mcp
npm install
npm run build

# Inject local build into Claude Desktop and Cursor
node dist/cli.js init --local

# Verify environment & configs
node dist/cli.js doctor
```

---

## 🛠️ MCP Tools Reference

| Tool | Valid Stage | Inputs | Description |
|---|---|---|---|
| `list_presets` | Any | None | Lists available storytelling frameworks, descriptions, and strict dialogue rules. |
| `init_brief` | Initial | `company`, `product`, `goal`, `preset`, `brandFriction` | Validates brief, initializes isolated session, and locks stage to `CORE_THEME`. |
| `branch_scene` | Narrative (`CORE_THEME` – `SCENE_4_CLIMAX`) | `action`, `chosen_option_id`, `chosen_narrative_summary`, `exit_frame_anchor`, `nextOptions` | Commits option (`1`, `2`, `3`) or regenerates (`R`), wipes pruned branches, and returns the physical continuity bridge. |
| `lock_assets` | `LOCK_ASSETS` (after Scene 4) | `characters` (`CHAR_01..N`), `environments` (`BG_01..N`), `product` (`PROD_01`) | Locks canonical visual asset references and generates Midjourney / Flux prompts. |
| `compile_shots` | `COMPILE_SHOTS` (after Lock Assets) | `shots`, `openStudioUi` | Compiles reference-tagged kinetic prompts, checks referential integrity, and opens `http://localhost:4321`. |

---

## 💬 Usage Flow in Claude

1. **Start a new ad session**:
   ```text
   /preset-indian-d2c-story
   company_and_product: ChaiWaale Kadak CTC Spiced Tea
   ad_goal: Reconnect busy corporate workers with afternoon family tea rituals
   ```

2. **Branch through narrative scenes**:
   Claude presents Option 1, Option 2, Option 3, and Option R.
   ```text
   Reply: 1
   ```

3. **Lock continuity and assets**:
   After Scene 4 Climax, Claude locks visual assets (`@CHAR_01`, `@BG_01`, `@PROD_01`).

4. **Review in Studio Canvas**:
   Claude compiles the shots and automatically opens **`http://localhost:4321`** to inspect the narrative arc, generate reference PNGs, and copy AI video prompts.

---

## 🧪 Testing & Verification

The package includes comprehensive automated verification suites covering FSM safety, CLI injection, MSIX path handling, stdio transport, and architectural bug fixes:

```bash
npm test
```

Test suites executed:
1. `tests/run-verification.mjs` (FSM transitions, anti-jargon gate, sequential pruning, asset ID validation)
2. `tests/test-architecture-and-fixes.mjs` (Preset discovery, session isolation, continuity bridges, kinetic prompts, raw UTF-8)
3. `tests/test-cli.mjs` (OS-aware config resolution, safe merging, doctor diagnostics)
4. `tests/test-stdio.mjs` (Stdio transport handshake with prompts, tools, and resources capabilities)
5. `tests/test-system32-cwd.mjs` (Windows MSIX System32 CWD fallback protection)

---

## 📁 Repository Structure

```text
ad-director-mcp/
├── presets/                    # Dynamic narrative framework definitions
│   ├── indian-d2c-story.json   # Hinglish emotional storytelling
│   ├── dev-product-launch.json # 100% English developer cinema
│   └── tiktok-ugc-hook.json    # 100% English 0-3s retention hooks
├── src/
│   ├── domain/
│   │   └── schemas.ts          # Zod domain schemas and TypeScript interfaces
│   ├── services/
│   │   ├── preset-registry.service.ts # Dynamic preset discovery & loader
│   │   ├── session-dag.service.ts     # Isolated session DAG persistence
│   │   └── prompt-compiler.service.ts # Reference-tagged kinetic prompt compiler
│   ├── mcp/
│   │   ├── prompts.ts          # MCP Slash Command Prompts (/preset-*)
│   │   └── tools.ts            # MCP Tools handler registration
│   ├── state/
│   │   └── dag-store.ts        # Hardened state machine with FSM locks
│   ├── tools/                  # Tool execution handlers (1 to 4)
│   ├── ui/
│   │   └── studio-app.html     # 3-Zone Dark Mode Production Studio UI
│   ├── cli.ts                  # Cross-platform client injector
│   └── index.ts                # Master stdio MCP server & UI web server
├── tests/                      # Automated verification test suites
├── SKILL.md                    # Antigravity & Claude Skill instructions
└── package.json
```

---

## 📄 License

MIT © Antigravity Team
