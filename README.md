<div align="center">

# Craft Agents （RE）

**An agent-native workspace for working with AI agents — across every service, API, and document.**

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)
[![中文文档](https://img.shields.io/badge/文档-中文-green.svg)](README.zh-CN.md)

</div>

---

## A Fork, With Gratitude

> This project is a **fork** of [`craft-ai-agents/craft-agents-oss`](https://github.com/craft-ai-agents/craft-agents-oss), the agent workspace built by the [craft.do](https://craft.do) team.
>
> We are deeply grateful to the upstream maintainers and contributors — this project would not exist without their work. This fork builds on their foundation to pursue a specific architectural direction: **a single, unified AI backend** (see [Differences from upstream](#differences-from-upstream)).

---

## Differences from Upstream

<img width="2781" height="1480" alt="截屏2026-08-11 00 40 03" src="https://github.com/user-attachments/assets/7aa55662-a18b-4d97-864d-4b491090fdd4" />
<img width="2781" height="1480" alt="截屏2026-08-11 00 39 21" src="https://github.com/user-attachments/assets/3b2e6f9b-bab1-4ba3-8cab-ecbf4eb3199d" />
<img width="2781" height="1480" alt="截屏2026-08-11 00 37 41" src="https://github.com/user-attachments/assets/7b3e587a-0aa0-4b8b-9702-8dcd38198574" />
<img width="2781" height="1480" alt="截屏2026-08-11 00 39 05" src="https://github.com/user-attachments/assets/e9e77957-6396-4b83-94d5-0ba21614ce05" />





This fork's core change is architectural: **upstream maintains two AI backends (Claude Agent SDK + Pi SDK); this fork removes the Claude SDK entirely and runs everything on the Pi SDK** — one code path, one extension system, one provider catalog.

| Area | Upstream (`craft-agents-oss`) | This fork |
|------|------------------------------|-----------|
| AI backend | Claude Agent SDK **+** Pi SDK (two paths) | **Pi SDK only** — one unified path |
| Backend lifecycle | Two event and session implementations | One Pi lifecycle ending at `agent_settled` |
| Native payload | ~210 MB Claude binary per platform | None |
| Provider path | Two parallel implementations | One — 30+ providers, strict superset |
| Runtime tool sync | Backend-specific registration | Incremental `sync_tools` with warm-session reuse |

Other notable changes:

- **Removed** the Claude SDK backend, event adapters, error mappers, and the "extended context (1M)" toggle; replaced with a generic `ToolDefinition` layer and `@modelcontextprotocol/sdk`-based MCP servers
- **Added 14 provider presets** to the UI (NVIDIA, Together AI, Fireworks, Moonshot AI, Cloudflare Workers AI / AI Gateway, Ant Ling, ZAI, Xiaomi…)
- **Fixed Windows packaging** (`build-win.ps1`): PowerShell 5.1 SHA256, `@vscode/ripgrep` binary staging, and pi-agent-server bundling
- **New tooling**: shared `tsconfig.base.json`, a postinstall dependency-dedupe script (prosemirror under TS 7), inlined GitHub Copilot OAuth
- **Content Workbench** — a generic multi-panel workspace for every agent view (see below)
- Current kernel architecture and maintenance baseline: [`docs/pi-kernel.md`](docs/pi-kernel.md)

### Content Workbench

The workbench turns every agent view — sessions, board, calendar, reviews, files, context, previews, and the browser — into peer panels you can arrange side by side:

- **Flat top-bar buttons** — every panel kind has a direct top-bar button with three-state indicators (open / focused / background); new-session, new-browser-window and session-list toggles are always available, and narrow windows hide buttons from the tail instead of collapsing into a menu
- **Bound content panels** — Review & Diff, Files tree, Context and Preview render side-by-side via `PanelSlot`, each bound to the active session; at most **3 foreground panels**, with a per-workspace **hidden-panel set** (backgrounded panels restore on demand)
- **Predictable eviction** — when the foreground is full, the *leftmost non-focused* panel moves to the background (new windows always appear on the right); the **main session is pinned to index 0** and never evicted or moved
- **One-click fullscreen** — any panel expands to a fullscreen overlay; the top bar hides while expanded so the restore button stays clickable, and Esc or the floating restore button brings the panel back
- **Equal-width panels** — opening, closing, or restoring a panel resets widths to 1/N; drag-resized proportions survive until the next count change
- **Overlay convergence** — chat file previews, markdown/activity pop-outs and multi-diff views open in the bound panels instead of floating overlays, so one context stays consistent
- **Kanban & Calendar panels** — board/calendar open as panels with close/fullscreen buttons in their headers and macOS traffic-light compensation when fullscreen
- **Context panel upgrade** — token usage, attachments, recently opened files, and source connection status at a glance
- **Session-list toggle** — an independent top-bar button shows/hides the session-list column, decoupled from the sidebar rail
- **Keyboard shortcuts** for every panel (`⌘⇧R` review / `⌘⇧E` files / `⌘⇧O` context / `⌘⇧P` preview / `⌘⇧T` toggle, plus panel navigation)

---

## What Is Craft Agents?

Craft Agents is a desktop workspace we built to work *effectively* with AI agents. It enables:

- **Intuitive multitasking** — a multi-session inbox where every conversation is a first-class, persistent object
- **No-fluff connection to anything** — tell the agent "add Linear as a source" and it finds the public APIs and MCP servers, reads their docs, sets up credentials, and wires everything up. REST APIs, local filesystems, and stdio MCP servers all work
- **A document-centric workflow** — sessions, markdown, diffs, and attachments feel native, instead of a code-editor bolted onto chat
- **A beautiful, fluid UI** — built with Electron + React, designed to stay out of your way

Craft Agents is built on **agent-native software principles** and is highly customizable out of the box. It is open source under the Apache 2.0 license — free to remix and change anything.

---

## Features

- **Single unified AI backend** — one Pi SDK runtime behind every LLM connection, with support for **30+ providers** (Anthropic, OpenAI, Google, DeepSeek, xAI, GitHub Copilot, AWS Bedrock, and more)
- **Multi-session inbox** — desktop app with session management, a customizable status workflow, and flagging
- **Streaming responses** — real-time output with tool-call visualization
- **Sources** — connect MCP servers, REST APIs (Google, Slack, Microsoft…), and local filesystems
- **Self-configuring connections** — the agent can discover, authenticate, and configure new sources on demand
- **Permission modes** — a three-level system (Explore / Ask to Edit / Auto) with customizable rules
- **Skills** — specialized agent instructions stored per-workspace; import from Claude Code or create your own
- **Automations** — event-driven workflows that spawn agent sessions on label changes, schedules, tool use, and more
- **Background tasks** — run long operations with progress tracking
- **Dynamic status system** — workspace-customizable session workflow states (Todo → In Progress → Needs Review → Done)
- **Theme system** — cascading themes at app and workspace levels
- **Multi-file diff** — a VS Code-style window for reviewing every file change in a turn
- **File attachments** — drag-and-drop images, PDFs, and Office documents with automatic conversion
- **Headless server + CLI** — run sessions remotely on a VPS and drive them from a terminal or web UI

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│            Electron Desktop  ·  Web UI  ·  CLI                       │
├──────────────────────────────────────────────────────────────────────┤
│                        packages/server-core                          │
│             SessionManager · BaseAgent · sources · auth · config     │
├──────────────────────────────────────────────────────────────────────┤
│                    packages/pi-agent-server                          │
│              Pi SDK subprocess wrapper  (JSONL stdio)                │
├──────────────────────────────────────────────────────────────────────┤
│                    @earendil-works/pi-coding-agent                   │
│            One unified runtime across 30+ LLM providers              │
└──────────────────────────────────────────────────────────────────────┘
```

The entire app runs on a **single AI backend** — the Pi SDK (`@earendil-works/pi-coding-agent`). Session logic lives in `packages/server-core`; the Pi SDK runs in an isolated subprocess (`packages/pi-agent-server`) so sessions, credentials, and tool execution stay crash-contained.

```
Packages:
├── packages/shared            — Agent logic, config, auth, MCP, sources, automations
├── packages/server-core       — Session manager, WebSocket RPC transport, handlers
├── packages/server            — Headless server entry point
├── packages/pi-agent-server   — Pi SDK subprocess wrapper (JSONL stdio)
├── packages/core              — Core types and storage interfaces
├── packages/ui                — Shared React components (shadcn/ui + Tailwind)
├── packages/session-tools-core — Shared tool definitions
├── packages/messaging-gateway — Telegram + WhatsApp adapter
└── packages/messaging-whatsapp-worker — WhatsApp subprocess

Apps:
├── apps/electron              — Desktop app (Electron + React)
├── apps/webui                 — Web UI (Vite + React)
├── apps/viewer                — Session viewer (Vite + React)
└── apps/cli                   — Terminal client (craft-cli)
```

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) runtime
- An LLM API key (Anthropic, OpenAI, Google, or any of the 30+ supported providers)

### Build from Source

```bash
git clone https://github.com/VanDING/craft-agents-rebuild
cd craft-agents-rebuild
bun install

# Run the desktop app (builds and launches)
bun run electron:start
```

### First Run

1. **Choose your AI provider** — Anthropic API key, Claude OAuth, OpenAI, Google AI Studio, GitHub Copilot, or any of the 30+ supported providers
2. **Create a workspace** — sessions, sources, skills, and themes live here (`~/.craft-agent/workspaces/<name>/`)
3. **Connect sources** *(optional)* — ask the agent to "add GitHub as a source", paste an MCP config, or point it at a local folder
4. **Start chatting** — create a session and let the agent do the work

### Permission Modes

| Mode | Display | Behavior |
|------|---------|----------|
| `safe` | Explore | Read-only, blocks all write operations |
| `ask` | Ask to Edit | Prompts for approval (default) |
| `allow-all` | Auto | Auto-approves all commands |

Use **`SHIFT+TAB`** to cycle through modes in the chat interface.

---

## Headless Server & CLI

Run Craft Agents as a headless server on a remote machine (e.g. a Linux VPS) and connect the desktop app as a thin client — keeping long-running sessions alive, accessible from anywhere:

```bash
CRAFT_SERVER_TOKEN=$(openssl rand -hex 32) bun run server:start
```

The server prints its connection details on startup; launch the desktop app in thin-client mode with `CRAFT_SERVER_URL` and `CRAFT_SERVER_TOKEN` set.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CRAFT_SERVER_TOKEN` | Yes | — | Bearer token for client authentication |
| `CRAFT_RPC_HOST` | No | `127.0.0.1` | Bind address (`0.0.0.0` for remote access) |
| `CRAFT_RPC_PORT` | No | `9100` | Bind port |
| `CRAFT_RPC_TLS_CERT` | No | — | PEM certificate path (enables `wss://`) |
| `CRAFT_RPC_TLS_KEY` | No | — | PEM private key path |
| `CRAFT_RPC_TLS_CA` | No | — | PEM CA chain (optional client-cert verification) |

For terminal-only workflows, the [`craft-cli`](docs/cli.md) client connects over `ws://`/`wss://`, streams responses, and supports scripting:

```bash
bun run apps/cli/src/index.ts run "Summarize this repo"
```

---

## Development

```bash
bun run typecheck:all       # Typecheck every package
bun run validate:dev        # Typecheck + unit tests
bun run validate:ci         # Full CI validation (+ i18n parity/coverage checks)

bun run electron:dev        # Desktop app in dev mode (HMR)
bun run server:dev          # Headless server in dev mode
bun run electron:dist:win   # Package installers (also :mac / :linux)
```

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| Module resolution errors in dev | `bun run server:build:subprocess` (rebuilds the pi-agent-server bundle) |
| "No matching export" during build | `bun install` (lockfile out of sync) |
| Packaged app stuck at "thinking…" | Verify `resources/pi-agent-server/index.js` and `resources/app/vendor/bun/bun.exe` exist in the unpacked app |

---

## Documentation & Support

- [craft-cli reference](docs/cli.md) — terminal client usage, scripting patterns, TLS
- [Pi kernel architecture](docs/pi-kernel.md) — lifecycle, tool synchronization, performance, and upgrade checks
- [Security](SECURITY.md) — report vulnerabilities here
- [Code of Conduct](CODE_OF_CONDUCT.md)

---

## License

[Apache 2.0](LICENSE). This project is a derivative of [`craft-ai-agents/craft-agents-oss`](https://github.com/craft-ai-agents/craft-agents-oss), which is likewise Apache 2.0 — see [NOTICE](NOTICE) for attribution details.
