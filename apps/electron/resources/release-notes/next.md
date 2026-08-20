# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

- **Upgrade to Bun 1.4** — the bundled runtime (pi-agent-server subprocess), build tooling, and CI now use Bun 1.4.0 (Rust rewrite, +1,517 Node.js compatibility tests, up to 5× lower idle CPU, up to 35% lower memory usage). Pins updated across build scripts, Docker images, and GitHub Actions.

## Bug Fixes

- **Fix ChatGPT Plus (OAuth) chat failing with "No API key found for openai-codex"** — the ChatGPT OAuth bearer token was passed to the Pi SDK as an `api_key` credential, but the SDK's `openai-codex` provider is OAuth-only and rejected it. It now arrives as a full `oauth` credential (access + refresh + expiry), matching what the SDK's provider-aware auth resolution expects.

## Breaking Changes
