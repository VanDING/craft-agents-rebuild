# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **OpenAI Responses protocol for custom endpoints** — the custom-endpoint protocol picker now offers "OpenAI Responses" alongside Chat Completions and Anthropic Messages. Third-party APIs that implement the Responses format (e.g. DeepSeek's `https://api.deepseek.com`) route through the Pi SDK's Responses adapter. Configured as `customEndpoint.api = 'openai-responses'`; the SDK side needed no changes — its built-in adapter registry already knew the protocol.

## Improvements

- **Unified full-page task and schedule editing** — New Task and WorkItem details now share one full-page editor, standalone schedules use the same navigation pattern instead of a modal, and Calendar supports empty-slot creation, drag-to-reschedule, duration resizing, and overlap layout. Project views also remove the redundant “All Tasks” and List create rows, replace native dropdowns, center titles against the full panel, and retire the premature Saved View feature.
- **Session list control moved beside the sidebar toggle** — the session list button now sits with the other navigation controls on the left side of the top bar and behaves as a simple action without a persistent selected state.
- **Automatic custom-endpoint models and model-aware thinking levels** — compatible endpoints now discover models from OpenAI, Anthropic, and Ollama list APIs, while keeping manual IDs as a fallback. Pi capability metadata drives each model's exact reasoning choices (including Minimal and model-specific Extra High/Max), and Pi's effective clamped level is synchronized back to the session UI.
- **Pi kernel 0.84.3 and smoother long-running work** — the single agent backend now waits for Pi's fully settled lifecycle boundary, so automatic retry, compaction, and queued continuation are no longer cut off by a prose update. A dedicated progress channel keeps long tasks moving, context usage comes directly from Pi after settlement, Windows uses Pi's native PowerShell tool, and live browser-tool settings refresh safely on the next turn.
- **Faster warm sessions and chat rendering** — unchanged source runtimes and tool definitions are reused instead of rebuilding the Pi session every turn. Ordered transcripts skip redundant sorting and chat turns are grouped once per render. New cold/warm, first-response, tool round-trip, event-processing, and stream-to-paint timing samples expose p50/p95 regressions.
- **Single-backend cleanup** — removed the unused legacy session tool factory, Claude-hook bridge shapes, dormant `session-mcp-server` workspace, stale Copilot SDK dependency, and obsolete migration plans. The new Pi kernel document is the source of truth for runtime maintenance.
- **Upgrade to Bun 1.4** — the bundled pi-agent-server runtime, local tooling, Docker images, build scripts, and CI now use Bun 1.4.0 consistently.
- **Theme files can now control complete visual styles** — user-owned themes in `~/.craft-agent/themes/` can define semantic surfaces, depth, shadows, radii, borders, typography, Lucide stroke style, and component density. The immutable Default theme remains the only built-in theme; no in-app theme editor was added.
- **Core surfaces now consume theme semantics** — the app shell, navigator, content panels, cards, controls, and composer now use theme-defined surfaces, radii, depth, and typography so high-character themes no longer stop at color substitution.
- **Theme-aware Windows title bar** — Windows now keeps its native minimize, maximize, and close controls inside the app's existing draggable top bar. The controls overlay is fully transparent so the renderer-owned theme, borders, and Mica/Acrylic remain continuous underneath it, while glyph colors follow the effective app, workspace, or preview theme.
- **Deterministic live theme updates** — theme preference writes are now authoritative in `config.json`, workspace switches ignore stale async responses, and add/edit/delete events from the user theme directory are observed once per app. Missing or invalid active themes fall back atomically to Default instead of retaining stale CSS.
- **Explicit font precedence** — Appearance now offers Theme, Inter, and System choices. Theme-authored typography is used only for the Theme choice; explicit user font choices always win.

## Bug Fixes

- **Default composer surface restored** — the default theme again uses the original canvas-colored composer instead of the darker generic form-input token; named themes can still provide a dedicated composer surface.
- **New Session panel spacing restored** — the session panel once again keeps a fixed inset below the 48 px title bar, preventing its upper edge from touching the window chrome.
- **Fix ChatGPT Plus (OAuth) chat failing with "No API key found for openai-codex"** — the ChatGPT OAuth bearer token was passed to the Pi SDK as an `api_key` credential, but the SDK's `openai-codex` provider is OAuth-only and rejected it. It now arrives as a full `oauth` credential (access + refresh + expiry), matching what the SDK's provider-aware auth resolution expects.

## Breaking Changes

- **Default is now the only built-in theme** — bundled named presets are no longer copied into `~/.craft-agent/themes/`. Existing files in that directory remain untouched and work as user themes. The deprecated `~/.craft-agent/theme.json` override is migrated non-destructively to a user theme file and then removed from runtime resolution.
