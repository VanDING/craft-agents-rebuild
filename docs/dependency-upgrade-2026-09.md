# September 2026 dependency upgrade

Checked on 2026-09-08 against the npm registry, PyPI, and official release channels.

## Scope

All 14 workspace manifests now declare the current released versions of their direct
packages, preserving their exact/range style. Duplicate workspace declarations were
aligned. There are 176 distinct external direct package names after removing the
obsolete `@types/uuid` stub and explicitly declaring required Babel, Tiptap, and table
integration dependencies. `bun update` refreshed transitive resolutions within the
ranges supported by their parents.

Key upgrades include Electron 44.2.0, OpenAI 7.10.0, MCP 1.30.0, React 19.2.8,
Tiptap 3.31.3, TanStack Table 9.2.4, Vite 8.2.2, React Vite plugin 6.1.1,
ESLint 10.10.0, Motion 13.2.0, Shiki 4.4.3, sharp 0.35.4, and Playwright 1.63.0.
Pi 0.85.1, TypeScript 7.0.2, Tailwind 4.3.3, and Bun 1.4.2 were already current.

All 12 Python direct package names are pinned to the checked PyPI versions in their
PEP 723 script headers. The PDF tool now uses Pillow 12.3.0 and pypdf 6.18.0.
Python transitive dependencies remain resolver-managed; these pins do not constitute
complete Python environment lockfiles.

## Release-channel exceptions

- Baileys stays on the highest published stable version, 6.17.16. Its npm `latest`
  tag points to **7.0.0-rc14**, a release candidate. The final recursive Bun outdated
  check reports only this package.
- `@uiw/react-json-view` remains on its existing alpha release channel at
  2.0.0-alpha.43, the publisher's current default.
- SheetJS uses the official **0.20.3 tarball**, because npm's `xlsx` channel stops at
  0.18.5. See [the official installation documentation](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/).
- Parent-pinned transitive packages are not forcibly overridden across major versions.
  In particular, Pi still depends on OpenAI 6.40.0 separately from our direct 7.10.0.
  Being older than `latest` alone does not establish compatibility with an override.
- No vulnerability-free claim is made by this version upgrade.

## Compatibility work

- Migrated settings/info tables to Table 9 `useTable`, explicitly registered features
  and row models, scoped shared types, and retained controlled filtering, sorting,
  pagination, expansion, resizing, and selection behavior.
- Updated Pierre diff prop generics without changing display options.
- Replaced the removed React-plugin `babel` option with `@rolldown/plugin-babel`,
  preserving Jotai debug labels and atom-family hot refresh.
- Updated Vite configuration names and fixed WebUI subpath aliases. Browser
  `stream/web` imports now resolve to native Web Streams.
- Aligned Viewer TypeScript libraries with shared ES2022+ code and declared Node
  types needed by bundled environment checks.
- Updated SheetJS tests to pass buffers explicitly, avoiding ESM filesystem globals.

## Bun and packaging

Project-owned local commands use `bun run`; build installs use the frozen Bun
lockfile. Cross-architecture ripgrep fetching uses Bun instead of `npm pack`.
The package registry is unchanged and the application still supports users' npm
commands and npm-based MCP servers.

The Bun version in `package.json` drives platform build scripts and shared build
utilities. Windows cached Bun binaries are checked by version. Electron's explicit
packaging version is 44.2.0.

The electron-builder `beforePack` hook provisions the exact target's Bun and uv,
verifies their release checksums, and stages ripgrep's wrapper and platform binary.
uv 0.12.10 has a version stamp so an older cached binary is refreshed, including
server builds and local development. The explicit server `--skip-download` option
continues to permit reuse as requested by the caller.

CI Actions are pinned to verified release commits: checkout v7.0.1, setup-uv v10.0.1,
and setup-bun v2.2.0. Node.js remains necessary for Node-targeted tooling and workers;
using Bun as the command entry point does not force these programs to run on Bun.

## Verification

- `bun run validate:ci`: all workspace and build-config type checks, 61 shared
  runtime/config tests, 24 Python document-tool tests, 4 new table regression tests,
  and locale parity/sorting/coverage checks passed.
- `bun run lint`: no errors; existing warnings remain.
- Electron, WebUI, and Viewer production builds passed.
- OpenAI image-generation, Office Artifact/RPC, and diff-normalization focused tests
  passed after the SheetJS migration.
- A real Chromium session exercised React pagination, sorting, filtering, and page
  reset after filtering, with no page errors.
- Cross-architecture ripgrep installation through Bun passed; shell syntax and
  whitespace checks passed.
- macOS x64 unpacked packaging passed. The packaged binaries report Electron
  44.2.0, Bun 1.4.2, and uv 0.12.10; packaged ripgrep and a native PTY command ran
  successfully. Frozen offline dependency installation also passed.
- Windows/Linux installers,
  signing/notarization, live provider credentials, and WhatsApp login are not
  validated by these local checks.

The validation runtime was Bun 1.4.2 downloaded for this task. The machine-wide Bun
installation was not replaced.
