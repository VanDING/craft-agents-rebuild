# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **OpenAI Responses protocol for custom endpoints** — the custom-endpoint protocol picker now offers "OpenAI Responses" alongside Chat Completions and Anthropic Messages. Third-party APIs that implement the Responses format (e.g. DeepSeek's `https://api.deepseek.com`) route through the Pi SDK's Responses adapter. Configured as `customEndpoint.api = 'openai-responses'`; the SDK side needed no changes — its built-in adapter registry already knew the protocol.

## Improvements

- **Upgrade to Bun 1.4** — the bundled runtime (pi-agent-server subprocess), build tooling, and CI now use Bun 1.4.0 (Rust rewrite, +1,517 Node.js compatibility tests, up to 5× lower idle CPU, up to 35% lower memory usage). Pins updated across build scripts, Docker images, and GitHub Actions.
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
