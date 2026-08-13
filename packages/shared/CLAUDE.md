# Shared Package

PiAgent (`src/agent/pi-agent.ts`) is the only agent backend: a JSONL-over-stdio client driving the `packages/pi-agent-server` subprocess, which is the sole runtime importer of `@earendil-works/pi-coding-agent`.

- `defaultMidStreamBehavior()` always returns `'steer'` (config/llm-connections.ts).
- Event vocabulary: `text_delta/text_complete/tool_start/tool_result/complete/status/error` (`src/agent/backend/pi/event-adapter.ts`).
- Permission pipeline: main-process authority via `pre_tool_use_request/response` (`src/agent/core/pre-tool-use.ts`).
