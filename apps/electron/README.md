# Craft Agents Electron App

The primary desktop client for Craft Agents. It provides the multi-session workspace, Content Workbench, browser integration, local capability dispatch, and renderer for the single Pi agent backend.

## Quick start

From the repository root:

```bash
bun install
bun run electron:dev       # development with renderer HMR
bun run electron:build     # production bundles and resources
bun run electron:start     # build and launch
```

Use Bun 1.4.0, as pinned by the root `packageManager` field and build scripts.

## Runtime architecture

```text
renderer (React)
    │ preload context bridge / RPC events
Electron main process
    │ packages/server-core SessionManager
    │ packages/shared PiAgent
    └─ JSONL stdio → bundled pi-agent-server → Pi SDK 0.84.3
```

The main-process bundle does not contain an AI SDK. `packages/pi-agent-server` is built separately with Bun and staged under `resources/pi-agent-server`; this keeps provider and agent failures isolated from Electron.

Credentials are resolved by the shared credential manager and sent to the subprocess as provider-aware `piAuth` data. OAuth refreshes are delivered with `token_update`. Provider secrets are not read from ambient `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` variables.

Session lifecycle and source management live in `packages/server-core`; tool permissions and event adaptation live in `packages/shared`; React components shared with web surfaces live in `packages/ui`.

## Directory map

```text
apps/electron/
├── src/main/       Electron lifecycle, windows, local capabilities
├── src/preload/    renderer-safe context bridge
├── src/renderer/   React app, event processing, workbench panels
├── src/shared/     desktop transport and route types
├── resources/      bundled docs, defaults, icons, release notes
├── scripts/        platform packaging helpers
└── electron-builder.yml
```

`resources/AGENTS.md` defines the rules for bundled resources. In particular, user-visible changes go to `resources/release-notes/next.md`; versioned release-note files are release-owned history.

## Build and verification

```bash
bun run typecheck:electron
bun run electron:build:main
bun run electron:build:preload
bun run electron:build:renderer
bun run electron:build:resources
bun run electron:build:assets
bun run electron:build
```

The platform packaging commands are `electron:dist:mac`, `electron:dist:win`, and `electron:dist:linux`. Packaged builds must contain both the Pi server bundle and the pinned Bun runtime.

## Event contract

Desktop code consumes the canonical `AgentEvent` protocol:

- `text_delta.text` contains streaming text.
- `error.message` contains plain backend errors.
- `tool_start` establishes the `toolUseId → toolName` mapping used by later results.
- `agent_settled` is adapted to the terminal `complete` event; `agent_end` is not terminal.
- `report_progress` is rendered as intermediate text while the Pi loop continues.

Do not introduce a second provider-specific event path in Electron. Normalize backend data at the shared adapter boundary.

## Performance diagnostics

Main-process spans record cold/warm agent state, first event/response/tool, and tool round trips. The renderer records event processing and stream-to-paint samples with p50/p95 summaries through `src/renderer/lib/perf.ts`.

When investigating perceived stalls, distinguish:

1. cold subprocess/session startup;
2. provider first-token latency;
3. tool round-trip latency;
4. main-process event handling;
5. renderer paint latency.

This avoids attributing network or model latency to the desktop renderer.

## Debugging

- Run `bun run server:build:subprocess` after Pi server changes.
- Run `bun run typecheck:all` before packaging.
- Main-process and subprocess logs identify session lifecycle, auth refresh, tool sync, and process exits.
- If a packaged session stays on “thinking,” verify `resources/pi-agent-server/index.js` and the platform Bun executable exist in the unpacked app.

For the complete backend contract, see [`docs/pi-kernel.md`](../../docs/pi-kernel.md).
