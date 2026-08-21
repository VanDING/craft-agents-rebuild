# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **OpenAI Responses protocol for custom endpoints** — the custom-endpoint protocol picker now offers "OpenAI Responses" alongside Chat Completions and Anthropic Messages. Third-party APIs that implement the Responses format (e.g. DeepSeek's `https://api.deepseek.com`) route through the Pi SDK's Responses adapter. Configured as `customEndpoint.api = 'openai-responses'`; the SDK side needed no changes — its built-in adapter registry already knew the protocol.

## Improvements

- **Upgrade to Bun 1.4** — the bundled runtime (pi-agent-server subprocess), build tooling, and CI now use Bun 1.4.0 (Rust rewrite, +1,517 Node.js compatibility tests, up to 5× lower idle CPU, up to 35% lower memory usage). Pins updated across build scripts, Docker images, and GitHub Actions.
- **Theme files can now control complete visual styles** — the theme schema now covers semantic surfaces, depth presets, shadows, radii, borders, typography, Lucide stroke style, and interface density. Themes remain JSON-driven and use the existing Appearance selector; no in-app theme editor was added.
- **Cyberpunk Neon and Neo Brutalism themes** — two new themes demonstrate the semantic engine beyond color swaps: one uses compact square geometry and cyan neon glow; the other uses heavy borders, saturated paper colors, and zero-blur offset shadows in both light and dark modes.
- **Core surfaces now consume theme semantics** — the app shell, navigator, content panels, cards, controls, and composer now use theme-defined surfaces, radii, depth, and typography so high-character themes no longer stop at color substitution.
- **Theme-aware Windows title bar** — Windows now keeps its native minimize, maximize, and close controls inside the app's existing draggable top bar. The overlay background and glyph colors follow the effective app, workspace, or preview theme instead of remaining a separate system-colored strip.
- **Cabinet theme collection** — ten MIT-licensed non-default designs from Cabinet were adapted to Craft's semantic theme schema: Warm, Brutalism, Synthwave, Cyberpunk, Techno, Polar, Pixel, Geek, Afrofuturism, and Sumi-e. Craft's own default, Cyberpunk Neon, and Neo Brutalism presets remain distinct.

## Bug Fixes

- **Fix ChatGPT Plus (OAuth) chat failing with "No API key found for openai-codex"** — the ChatGPT OAuth bearer token was passed to the Pi SDK as an `api_key` credential, but the SDK's `openai-codex` provider is OAuth-only and rejected it. It now arrives as a full `oauth` credential (access + refresh + expiry), matching what the SDK's provider-aware auth resolution expects.

## Breaking Changes

- **Legacy bundled themes replaced** — the 14 historical color-only presets were removed. The curated bundle now contains the default light/dark baseline, Craft's Cyberpunk Neon and Neo Brutalism, and the adapted Cabinet collection, all using the semantic-token engine.
