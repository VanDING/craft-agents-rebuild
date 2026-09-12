# Craft Agents — Renderer (Web/React) Capability & Dependency Inventory

**Purpose:** itemized inventory of the RENDERER's UI capability surface and its dependencies on
browser/Electron-specific APIs, to judge the cost of re-implementing the UI in a native Rust GUI
toolkit (GPUI).

**Repository:** `E:\craft-agents` @ `package.json` version `0.13.3` (Bun + Electron 44 + React 19).
**Method:** read-only analysis. All counts produced with `rg` (ripgrep 15.1) and PowerShell
`Get-Content`/`Measure-Object` over the working tree, excluding `node_modules`.
**Date of measurement:** working tree as found; no files were modified.

### Counting conventions (important)

| Convention | Meaning |
|---|---|
| **total lines** | `(Get-Content $f).Count` — includes blank lines and comments. Used for all LOC figures in this document. |
| **non-blank lines** | `Get-Content $f \| Measure-Object -Line` — PowerShell excludes empty lines. **Do not mix the two**; earlier drafts of this investigation produced numbers ~9% low because of this. Renderer TS/TSX = **120,523 total / 110,430 non-blank**. |
| **occurrences** | `rg -o` match count (`--count-matches` semantics), i.e. every textual match, not per-line. |
| **files** | distinct files containing ≥1 match. |
| **INFERRED** | explicitly marked where a statement is a judgement rather than a measurement. |

---

## 0. Scope census

### 0.1 The renderer is two packages, not one

The React UI is split across **two** source trees that ship as one bundle:

| Tree | Import specifier | Files (`.ts`/`.tsx`) | Total lines | Non-blank |
|---|---|---|---|---|
| `apps/electron/src/renderer` | `@/…` (vite alias) | 619 (252 `.ts` + 367 `.tsx`) | **120,523** | 110,430 |
| `packages/ui/src` | `@craft-agent/ui` (+ `./motion`, `./chat`, `./markdown`, …) | 204 | **35,391** | 31,753 |
| **Combined UI surface** | | **823** | **155,914** | 142,183 |

`packages/ui` is **not optional**: the renderer imports it **143 times across 127 files**
(`from '@craft-agent/ui'` ×103, `from '@craft-agent/ui/motion'` ×24, plus subpaths). Any rewrite
sizing that ignores `packages/ui` under-counts by ~29%.

*Correction to the task brief:* the renderer directory contains **649 files of any extension**
(619 TS/TSX + 2 CSS + 4 HTML + assets), not 729. The 729 figure could not be reproduced from the
tree; **INFERRED** it counted a different root or included build output.

### 0.2 Vite build entries (4 HTML documents, not 1)

`apps/electron/vite.config.ts` declares four Rollup inputs:

| Entry | Source | Role |
|---|---|---|
| `main` | `src/renderer/index.html` → `main.tsx` | the app |
| `playground` | `playground.html` → `playground.tsx` | **dev-only** component gallery (61 files, 21,172 lines = 17.6% of renderer LOC) |
| `browser-toolbar` | `browser-toolbar.html` → `browser-toolbar.tsx` | chrome for the embedded browser's `BrowserView` toolbar |
| `browser-empty-state` | `browser-empty-state.html` → `browser-empty-state.tsx` | empty-state page for the embedded browser |

The playground is shipped in the production bundle graph (it is a declared input) but is not part of
the user-facing app; a rewrite can drop it. Its 21k lines are excluded from rewrite sizing in §7.

### 0.3 Renderer LOC by top-level directory

| Directory | Files | Total lines |
|---|---|---|
| `components/` | 369 | 65,654 |
| `playground/` (dev-only) | 61 | 21,172 |
| `pages/` | 22 | 8,006 |
| `hooks/` | 45 | 6,346 |
| `lib/` | 45 | 4,585 |
| `event-processor/` | 15 | 3,671 |
| `atoms/` | 22 | 3,099 |
| `contexts/` | 7 | 1,930 |
| `context/` | 9 | 1,558 |
| `actions/` | 8 | 769 |
| `utils/` | 7 | 790 |
| `config/` | 3 | 226 |
| root files (`App.tsx` 2,229; `index.css` 1,328; …) | 8 | ~4,200 |

`components/` subdirectories (total lines): `app-shell` 30,501 (120 files) · `ui` 12,047 (84) ·
`automations` 2,656 (17) · `messaging` 2,353 (17) · `pages` 2,287 (11) · `onboarding` 1,945 (11) ·
`settings` 1,723 (14) · `info` 1,693 (14) · `content-panels` 1,628 (11) · `workspace` 1,409 (9) ·
`apisetup` 1,169 (6) · `app-menu` 991 (7) · `right-sidebar` 722 (3) · `projects` 680 (6) ·
`browser` 615 (6) · `icons` 545 (11) · `artifacts` 405 (6) · `shiki` 252 (4) · `markdown` ~175 (2) ·
`preview` ~123 (1) · `files` ~77 (1).

`packages/ui/src` subdirectories: `markdown` 9,841 (53) · `chat` 8,149 (22) · `trajectory` 4,705 (25) ·
`overlay` 4,259 (28) · `ui` 3,244 (16) · `annotations` 1,969 (27) · `lib` ~1,000 (9) ·
`code-viewer` 990 (8) · `terminal` 389 (3) · `context` ~260 (3) · `icons` ~100 (5).

### 0.4 Test weight

| Tree | Test files | Total lines |
|---|---|---|
| renderer (`__tests__/`, `*.test.ts(x)`, `*.isolated.ts`) | 65 | **7,283** |
| `packages/ui/src` | 41 | **5,036** |
| **Combined** | **106** | **12,319** (≈7.4% of UI LOC) |

A dedicated CI script (`test:ui:table`) covers the data-table feature registry specifically.

---

## 1. Package dependency usage inventory

### 1.1 Method

For every entry in the root `package.json` `dependencies` (and the extra runtime deps declared in
`apps/electron/package.json` and `packages/ui/package.json`, which the renderer actually consumes),
the module specifier was matched with:

```
(?:from|import|require)\s*\(?\s*['"]<pkg>(?:/[^'"]*)?['"]
```

This deliberately catches `import`, `import(...)` and `require(...)`, subpath imports
(`@tiptap/react/menus`) and both quote styles — a plain `from '<pkg>'` grep under-counts the
tiptap/`packages/ui` stack to zero.

**Headline finding:** the marketing-relevant "editor stack" (tiptap, prosemirror, react-markdown,
remark/rehype, katex, beautiful-mermaid, @pierre/diffs, vaul) has **0 direct import sites in the
renderer** — it all lives in `packages/ui` and is re-exported as `@craft-agent/ui` (103 import sites).
A rewrite must replace `packages/ui` too.

### 1.2 (a) UI primitives

| Dependency | Renderer hits / files | `packages/ui` hits / files | Most central files | Native-rewrite cost |
|---|---|---|---|---|
| `lucide-react` | 195 / 194 | 49 / 49 | `components/app-shell/AppShell.tsx`, `components/ui/*` | **Very high** — an icon font/set of ~1,600 vector icons, currentColor + `--icon-stroke-width` driven |
| `motion` (Framer Motion 13) | 37 / 37 | 9 / 9 | `apps/electron/src/renderer/main.tsx:7` (`MotionConfig`), `packages/ui/src/components/ui/Island.tsx:3`, `packages/ui/src/components/chat/TurnCard.tsx:8`, `packages/ui/src/components/ui/BrowserControls.tsx:3` | **High** — springs, `AnimatePresence` exit animations, layout animations |
| `sonner` | 58 / 58 | 0 | `main.tsx:11` (`<Toaster>`), `App.tsx:86` (`toast`), consumed widely (373 `toast(` call sites renderer-wide) | Medium — a toast queue + stacking viewport |
| `cmdk` | 5 / 5 | 0 | **Live**: `components/ui/slash-command-menu.tsx:3`, `components/ui/session-status-menu.tsx:3`, `components/app-shell/input/WorkingDirectorySelector.tsx:3`, `components/apisetup/ApiKeyInput.tsx:15`. **Dead**: `components/ui/command.tsx:2` — the generic shadcn wrapper defines `CommandDialog`/`CommandInput`/`CommandList`/`CommandEmpty`/`CommandGroup`/`CommandSeparator`/`CommandItem` (`:24-152`) with **0 importers repo-wide**, so there is **no global command palette** | Medium for the 4 live users |
| `@radix-ui/react-*` (13 packages) | 15 import sites across 15 wrapper files | 1 (`tooltip.tsx:2`) | all under `apps/electron/src/renderer/components/ui/` | **Very high** — see §1.9 |
| `react-resizable-panels` | 2 / 2 (`components/ui/resizable.tsx:3`, `components/ui/gradient-resize-handle.tsx:2`) | 0 | **DEAD CODE** — `resizable.tsx` defines and exports `ResizablePanelGroup`/`ResizablePanel`/`ResizableHandle` (`:6`, `:22`, `:24`, `:49`) but **no file imports any of them** (verified: 0 import sites for the module path, 0 usages of the symbol names outside the definition file). Layout resizing is hand-rolled instead — see §3 row 1 | **None for the library**; the hand-rolled resize logic is Medium |
| `@dnd-kit/core` | 3 / 3 | 0 | `components/app-shell/kanban/KanbanBoard.tsx:12`, `kanban/KanbanColumn.tsx:2`, `components/ui/sortable-list.tsx:29` | Medium–High — sensor/keyboard-a11y DnD |
| `@dnd-kit/sortable` | 2 / 1 (`components/ui/sortable-list.tsx:35,261`) | 0 | `sortable-list.tsx` | — |
| `@dnd-kit/utilities` | 1 / 1 (`sortable-list.tsx:36`) | 0 | — | — |
| `@dnd-kit/dom` + `@dnd-kit/helpers` | 2 / 1 (playground only, `playground/registry/planner.tsx:3`) `<br>` + `helpers`: **0** | 0 | playground only — **dead for production** | none |
| `vaul` | **0** | 1 / 1 (`packages/ui/src/components/ui/drawer.tsx`) | re-exported via `@craft-agent/ui/ui/drawer` → renderer `components/ui/drawer.tsx` | Medium — drag-to-dismiss drawer |
| `class-variance-authority` | 5 / 5 | 0 | `components/ui/button.tsx`, `badge.tsx`, … | Low — variant→class maps |
| `clsx` | 1 / 1 | 1 / 1 (`lib/utils.ts`) | `cn()` helper | Low |
| `tailwind-merge` | 1 / 1 | 1 / 1 (`lib/utils.ts`) | `cn()` helper | Low |
| `@paper-design/shaders-react` | 1 / 1 | 1 / 1 | `packages/ui/src/components/ui/BrowserShader.tsx`, `apps/electron/.../components/browser/…` | Medium — GPU shader background (WebGL) |
| `react-colorful` | 1 / 1 (`components/ui/color-picker.tsx:14`) | 0 | colour theme editor | Low |
| `react-day-picker` | 1 / 1 (`components/ui/calendar.tsx:10`) | 0 | Settings / calendar surfaces | Medium |
| `@xterm/xterm` + `@xterm/addon-fit` | 2 + 1, **1 file** (`components/content-panels/TerminalPanel.tsx:2-4`) | 0 | terminal surface | **Very high** — terminal emulator |
| `qrcode.react` | 2 / 2 | 0 | messaging pairing dialogs | Low |
| `@uiw/react-json-view` | 1 / 1 | 9 / 3 (`packages/ui/…/overlay/JSONPreviewOverlay.tsx`) | JSON block rendering | Medium |

### 1.3 (b) Rich text / editor

All in `packages/ui`, entry point `packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx`.

**⚠️ Important scope correction:** `@tiptap/*` has **0 imports in `apps/electron/src/renderer`**. The
message composer is a hand-written `contentEditable` (§3 row 6). The tiptap editor's **only renderer
consumer is the dev playground** (`playground/registry/planner.tsx:30,978`). It is however exported
from `@craft-agent/ui` (`packages/ui/src/index.ts:148`) and its node views/CSS are part of the
shipped bundle. **INFERRED:** tiptap appears to be the intended future base for rich-block editing
(artifact revisions, page/plan editing) rather than a currently user-facing surface.

| Dependency | hits / files (`packages/ui`) | Where |
|---|---|---|
| `@tiptap/react` | 7 / 6 | `TiptapMarkdownEditor.tsx:2`, `extensions/MermaidBlock.tsx:2`, `extensions/LatexBlock.tsx:2`, `extensions/TiptapImageBlock.tsx:2`, `TiptapCodeBlockView.tsx:3`, `TiptapBubbleMenus.tsx:3` |
| `@tiptap/starter-kit` | 2 / 2 | `TiptapMarkdownEditor.tsx:3` |
| `@tiptap/markdown` (official) | 2 / 2 | `TiptapMarkdownEditor.tsx:10` |
| `tiptap-markdown` (legacy engine) | 1 / 1 | `TiptapMarkdownEditor.tsx:11` — **both engines coexist**, switched by a `MarkdownEngine = 'legacy' \| 'official'` flag |
| `@tiptap/suggestion` | 1 / 1 | `TiptapSlashMenu.ts:2` |
| `@tiptap/extension-image` | 3 / 3 | `TiptapMarkdownEditor.tsx:8` |
| `@tiptap/extension-mathematics` | 2 / 2 | `TiptapMarkdownEditor.tsx:7` |
| `@tiptap/extension-task-item` / `-task-list` | 2 / 2 each | `TiptapMarkdownEditor.tsx:5-6`, `extensions/AnimatedTaskItem.ts:2` |
| `@tiptap/extension-file-handler` | 1 / 1 | `TiptapMarkdownEditor.tsx:9` (drag-drop of files into editor) |
| `@tiptap/extension-placeholder` | 1 / 1 | `TiptapMarkdownEditor.tsx:4` |
| `@tiptap/extension-bubble-menu` | **0** | uses `@tiptap/react/menus` instead (`TiptapBubbleMenus.tsx:3`) |
| `@tiptap/extension-text-style` | **0** | declared but unused |
| `tiptap-extension-code-block-shiki` | 1 / 1 | `TiptapCodeBlockView.tsx:5` |
| `@tiptap/pm/*` (prosemirror) | 8 / 4 | `@tiptap/pm/state`, `/model`, `/view` |
| `prosemirror-model` / `-state` / `-view` / `-transform` / `prosemirror-highlight` | **0 direct** | all reached through `@tiptap/pm` |
| `react-simple-code-editor` | 1 / 1 (**renderer**) | `apps/electron/src/renderer/components/shiki/ShikiCodeEditor.tsx:16` |

### 1.4 (c) Rendering / highlighting

| Dependency | Renderer | `packages/ui` | Central files |
|---|---|---|---|
| `shiki` 4.4.3 | 1 / 1 | 3 / 3 | `apps/.../components/shiki/ShikiCodeEditor.tsx:17` (`codeToHtml`, `bundledLanguages`), `packages/ui/.../code-viewer/{ShikiDiffViewer,ShikiCodeViewer,registerShikiThemes}.ts(x)`. **22 preloaded languages** + an alias map; theme supplied by `ShikiThemeContext`/`useShikiTheme` from `theme.shikiTheme.{light,dark}` |
| `katex` 0.18.7 | 0 | 4 / 4 | `packages/ui/.../markdown/Markdown.tsx:8` (`katex/dist/katex.min.css`), `MarkdownLatexBlock.tsx`, `TiptapMarkdownEditor.tsx` |
| `react-markdown` | 0 | 5 / 5 | `packages/ui/src/components/markdown/Markdown.tsx:2` — the single markdown render entry |
| `remark-gfm` | 0 | 1 / 1 | `Markdown.tsx:6` |
| `remark-math` | 0 | 2 / 2 | `Markdown.tsx:7`, `math-options.ts` |
| `rehype-katex` | 0 | 1 / 1 | `Markdown.tsx:3` |
| `rehype-raw` | 0 | 1 / 1 | `Markdown.tsx:4` |
| `rehype-sanitize` | 0 | 1 / 1 | `Markdown.tsx:5` (custom schema; strips script/iframe/object/embed/form/meta/base + all `on*`) |
| `beautiful-mermaid` | 0 | 1 / 1 | `packages/ui/.../markdown/MarkdownMermaidBlock.tsx:74` — **dynamic import**, renders SVG string |
| `linkify-it` | 0 | 1 / 1 | `packages/ui/.../markdown/linkify.ts` |
| `marked` | 0 | 0 | only a `.d.ts` shim in `packages/shared/src/types/marked-terminal.d.ts` |
| `@pierre/diffs` 1.4.1 | 0 | 10 / 7 | `packages/ui/.../overlay/MultiDiffPreviewOverlay.tsx:19`, `code-viewer/UnifiedDiffViewer.tsx:13-14` |
| `unified` | 0 | 2 / 2 | markdown preview pipeline |
| `unist-util-visit` | 0 | 1 / 1 | markdown transforms |
| `fflate` | 0 | 1 / 1 | `markdown/table-export.ts:252` (ZIP for XLSX export) |
| `nice-ticks` | 0 | 1 / 1 | trajectory chart axes |
| `strip-markdown` | 1 / 1 (renderer) | 0 | search-index / preview text |

### 1.5 (d) Documents

| Dependency | Renderer | `packages/ui` | Central files | Note |
|---|---|---|---|---|
| `react-pdf` 10.5.0 | 3 / **1** | 6 / 2 | `apps/.../components/content-panels/PdfFilePreview.tsx:3` (`Document, Page, pdfjs`), `packages/ui/.../overlay/PDFPreviewOverlay.impl.tsx`, `markdown/MarkdownPdfBlock.impl.tsx` | lazy `React.lazy` + `.impl` split to keep pdfjs out of the initial graph |
| `pdfjs-dist` 6.3.289 | 1 / 1 | 2 / 2 | worker loaded via `?url` (see `vite-env.d.ts:24`) | needs a Web Worker + canvas |
| `@open-file-viewer/core` 0.1.44 | 2 / 1 | 0 | `components/content-panels/OfficeFilePreview.tsx` | DOCX/XLSX/PPTX preview inside a sandboxed `<iframe srcDoc>` |
| `sharp` 0.35.4 | 0 | 0 | `packages/server-core/src/runtime/platform-headless.ts` | **main/server only**, never in the renderer |
| `markitdown-js` | 0 | 0 | `packages/server-core/src/handlers/rpc/files.ts`, `services/artifact-preview.ts` | **server only** |
| `xlsx` / `univer` / `exceljs` | **ABSENT** | — | `packages/ui/.../markdown/table-export.ts` hand-writes XLSX and zips it with `fflate` | — |

### 1.6 (e) State / data

| Dependency | Renderer | `packages/ui` | Central files |
|---|---|---|---|
| `jotai` 2.20.3 | **89 / 84** | 0 | `atoms/sessions.ts` (750→797 lines), `atoms/workbench.ts`, `atoms/browser-pane.ts`; `main.tsx:6` `JotaiProvider` |
| `jotai-family` | 1 / 1 | 0 | `atoms/sessions.ts` (`atomFamily`, 2 uses) |
| `@tanstack/react-table` 9.2.4 | 5 / 3 | 0 | `components/ui/data-table.tsx:8-9`, `components/ui/data-table-features.ts:21,28` |
| `@tanstack/table-core` (dev) | 1 / 1 | 0 | test construct |
| `date-fns` 4.4.0 | 8 / 7 | 0 | `app-shell/kanban/CalendarView.tsx:29`, `kanban/TaskTile.tsx:5`, `ui/label-value-popover.tsx:20`, `components/pages/page-visuals.tsx:8` |
| `chrono-node` | 1 / 1 | 0 | natural-language date parsing (calendar/automations) |
| `zod` 4.5.4 | **0** | **0** | schema validation is **server/main-side only** (`packages/session-tools-core`, `packages/shared/config/validators.ts`) |
| `gray-matter` | **0** | **0** | `packages/shared/src/skills/storage.ts`, `config/validators.ts`, `session-tools-core/validation.ts` |
| `js-yaml` 5.4.1 | **0** | **0** | **zero import sites repo-wide** — appears to be an unused/transitively-needed dependency |
| `semver` | 0 | 0 | **zero import sites repo-wide** (devDep `@types/semver` only) |

### 1.7 (f) i18n

| Item | Value |
|---|---|
| `react-i18next` imports | renderer **190 / 190**; `packages/ui` **48 / 48** |
| Locale files | `packages/shared/src/i18n/locales/*.json` — **7 locales** (`en`, `de`, `es`, `hu`, `ja`, `pl`, `zh-Hans`) |
| Keys per locale | **2,238 leaf keys** each (exact parity, enforced by `lint:i18n:parity`) |
| `t('…')` call sites | renderer **2,027**; `packages/ui` **295** → **2,322 total** |
| `useTranslation()` sites | renderer **243** |
| Key namespaces | ≈40 prefixes (`common`, `menu`, `sidebar`, `chat`, `settings.*`, `toast`, `dialog`, `automations`, …) — see `packages/shared/CLAUDE.md` |
| Language detection | `i18next-browser-languagedetector` (2 / 2) → `localStorage['i18nextLng']`; renderer pushes the resolved language to main via `electronAPI.changeLanguage` (`main.tsx:37`) |
| Lazy loading | locale messages are dynamically imported per language (`packages/shared/src/i18n/registry.ts`, 69 lines) |

### 1.8 (g) Other / cross-cutting

| Dependency | Renderer | `packages/ui` | Where it is actually used |
|---|---|---|---|
| `@sentry/react` 10.73.0 | 2 / 1 | 0 | `apps/electron/src/renderer/main.tsx:4-5` |
| `@sentry/electron` | 3 / 3 | 0 | `main.tsx:3` (`@sentry/electron/renderer`), `event-processor/useEventProcessor.ts:9`, `components/app-shell/input/InputErrorBoundary.tsx:2` |
| `react` / `react-dom` | 412 / 370 + 6 / 6 | 108 / 94 + 6 / 6 | everywhere; `react-dom/client` + `react-dom/server` (tests) |
| `@craft-agent/ui` | 143 / 127 | 2 / 2 (self) | — |
| `@craft-agent/shared` | 169 / 118 | 4 / 4 | labels, protocol, config, i18n, icons, colors, mentions |
| `@craft-agent/core` | 11 / 10 | 35 / 28 | types + utils |
| `ws` 8.21.3 | 0 | 0 | **server/transport only** (`packages/server-core`, `apps/webui/src/shims/ws.ts`) — the renderer never opens a socket itself |
| `undici` 8.10.2 | 0 | 0 | main/server HTTP |
| `electron-log` | 2 / 2 (**renderer**) | 0 | renderer log bridge |
| `electron-updater` | 0 | 0 | main only (`main/auto-update.ts`) |
| `node-pty` | 0 | 0 | main only (`main/terminal-manager.ts`) |
| `open` 11.0.2 | 0 | 0 | `packages/shared/src/utils/open-url.ts` (main path; direct import blocked by an eslint rule) |
| `playwright` 1.63.0 | 0 | 0 | `scripts/test-*.mjs` — test tooling only |
| `@vscode/ripgrep`, `@shikijs/cli`, `@tailwindcss/typography`, `@dnd-kit/helpers`, `@types/ws` | 0 | 0 | build tooling / types / dead |
| `jose` | 0 | 0 | `packages/server-core/src/webui/auth.ts` |
| `@modelcontextprotocol/sdk` | 0 | 0 | `packages/shared/src/agent/*` |
| `@earendil-works/pi-ai`, `pi-coding-agent` | 0 | 0 | `packages/pi-agent-server/*` (subprocess) |

### 1.9 Radix primitive coverage (the real "widget kit")

| Radix package | Wrapper file (renderer unless noted) | Wrapper LOC |
|---|---|---|
| `@radix-ui/react-avatar` | `components/ui/avatar.tsx` | 173 |
| `@radix-ui/react-collapsible` | `components/ui/collapsible.tsx` | 50 |
| `@radix-ui/react-context-menu` | `components/ui/context-menu.tsx` (304) + `styled-context-menu.tsx` (120) | 424 |
| `@radix-ui/react-dialog` | `components/ui/dialog.tsx` | 131 |
| `@radix-ui/react-dropdown-menu` | `components/ui/dropdown-menu.tsx` (283) + `styled-dropdown.tsx` (16) + `packages/ui/.../ui/StyledDropdown.tsx` | 299 |
| `@radix-ui/react-label` | `components/ui/label.tsx` | 19 |
| `@radix-ui/react-popover` | `components/ui/popover.tsx` | 42 |
| `@radix-ui/react-scroll-area` | `components/ui/scroll-area.tsx` | 54 |
| `@radix-ui/react-select` | `components/ui/select.tsx` | 156 |
| `@radix-ui/react-separator` | `components/ui/separator.tsx` | 24 |
| `@radix-ui/react-slot` | `components/ui/button.tsx` | 63 |
| `@radix-ui/react-switch` | `components/ui/switch.tsx` | 27 |
| `@radix-ui/react-tabs` | `components/ui/tabs.tsx` | 50 |
| `@radix-ui/react-tooltip` | `packages/ui/src/components/tooltip.tsx` only | — |

13 of 14 Radix wrappers live in the renderer; tooltip is the exception (in `packages/ui`).

---

## 2. Electron / browser-API dependency inventory **(critical section)**

### 2.1 The preload bridge — exact exposed surface

Source: `apps/electron/src/preload/bootstrap.ts` (**474 lines**) and
`apps/electron/src/preload/browser-toolbar.ts` (**53 lines**).

| Item | Value |
|---|---|
| Global exposed to the main window | **`window.electronAPI`** — `contextBridge.exposeInMainWorld('electronAPI', api)` at `bootstrap.ts:474` |
| Global exposed to the browser-toolbar `BrowserView` | **`window.browserToolbar`** — `contextBridge.exposeInMainWorld('browserToolbar', {…})` at `browser-toolbar.ts:28` |
| How `electronAPI` is built | `buildClientApi(client, CHANNEL_MAP, isChannelAvailable)` — `bootstrap.ts:210`, implementation `apps/electron/src/transport/build-api.ts` (65 lines) |
| `window.api`, `window.craft`, `window.desktop`, `window.bridge` | **do not exist** |

**Crucially, `ipcRenderer` is never exposed to the renderer.** Verified: `rg -F ipcRenderer apps/electron/src/renderer` → **0 occurrences**. There is no generic invoke escape hatch — the renderer can only call the fixed method set produced from `CHANNEL_MAP`. This is the single most important structural fact for a rewrite: **the renderer↔host contract is 370 named async functions, not a raw channel bus.**

#### 2.1.1 The API surface size

| Measure | Count | Source |
|---|---|---|
| `CHANNEL_MAP` entries (= `window.electronAPI` methods) | **370** — 324 `invoke` + 46 `listener` | `transport/channel-map.ts` (520 lines), counted by line match |
| Distinct RPC channels those entries address | **369** | 1 channel is dual-mapped: `onboarding.GET_AUTH_STATE` → both `getAuthState` and `getSetupNeeds` (transform `r => r.setupNeeds`, `channel-map.ts:154`) |
| Nested (dotted) namespaces | **13** — all `browserPane.*` | `build-api.ts:44-59` turns `browserPane.create` into `api.browserPane.create` |
| Total `RPC_CHANNELS` leaf channels defined | **401** across **58 namespaces** | `packages/shared/src/protocol/channels.ts:6-539` |
| Hand-written additions on top of the map | 12 — `getRuntimeEnvironment`, `getTransportConnectionState`, `onTransportConnectionStateChanged`, `reconnectTransport`, `performOAuth`, `startClaudeOAuth`, `startChatGptOAuth`, `relaunchApp`, `removeWorkspace`, `invokeOnServer`, `sendResourcesToRemote`, `transferSessionToWorkspace`, `onTransferProgress`, `getSystemWarnings`, `changeLanguage`, `getFilePath` | `bootstrap.ts:212-472` |
| **Distinct `electronAPI.<method>` call sites used by the renderer** | **321** | `rg -o 'electronAPI\??\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?'` over the renderer |
| Total `window.electronAPI` textual occurrences | **626**, across **114 files** | `rg -F` |

Raw `ipcRenderer` channels used **inside the preload** (never visible to renderer code):
`sendSync` → `__get-web-contents-id` (`:57`), `__get-workspace-id` (`:82`, `:102`),
`__get-ws-port` (`:100`), `__get-ws-token` (`:101`), `__get-workspace-remote-config` (`:114`);
`invoke` → `__client:validatePath` (`:180`, `:186`), `__dialog:showMessageBox` (`:191`),
`__dialog:showOpenDialog` (`:195`), `__browser:invoke` (`:203`), `app:relaunch` (`:432`),
`workspace:remove` (`:433`), `server:invokeOnServer` (`:440`), `server:sendResourcesToRemote` (`:444`),
`session:transferToWorkspace` (`:446`), `i18n:changeLanguage` (`:461`);
`send` → `__transport:status` (`:239`); `on` → `transfer:progress` (`:449`).
Direct Electron modules used in the preload: `shell.openExternal` (`:176`, `:314`, `:361`, `:397`),
`shell.openPath` (`:181`), `shell.showItemInFolder` (`:187`), `webUtils.getPathForFile` (`:466-472`).

#### 2.1.2 Transport behind the bridge (matters for a rewrite)

`bootstrap.ts` does **not** proxy to `ipcRenderer` for the 370 methods. It builds a
**WebSocket JSON-RPC client** and exposes its methods:

- Thin-client mode (`CRAFT_SERVER_URL` set): one `WsRpcClient` to the remote server (`:84-93`).
- Normal mode: a `RoutedClient` that sends `LOCAL_ONLY` channels to the local Bun server on
  `ws://127.0.0.1:<port>` (`__get-ws-port`) and `REMOTE_ELIGIBLE` channels to whichever server owns
  the active workspace — local or remote (`:104-156`).
- Transport events (`connected` / `reconnecting` / `failed`) are surfaced to main for logging
  (`:235-271`) and to the renderer via `getTransportConnectionState` / `onTransportConnectionStateChanged`.

**Consequence:** a native client does not need Electron's IPC at all for 369 of 370 channels — it
needs a WebSocket JSON-RPC client plus ~24 raw `ipcMain` channels for genuinely OS-bound actions
(see §6). This is *good news* for a GPUI rewrite.

### 2.2 Browser-API usage table (renderer + `packages/ui`)

Counts are `rg -o` occurrences. "Renderer" = `apps/electron/src/renderer`; "UI pkg" = `packages/ui/src`.

| API | Renderer occ / files | UI pkg occ / files | Representative evidence (file:line) | Rewrite difficulty |
|---|---|---|---|---|
| `window.electronAPI` | 626 / 114 | 2 / 1 | `App.tsx:938` (`onSessionEvent`), `components/app-shell/AppShell.tsx:2102` (`browserPane.create`) | **contract to reimplement** |
| `ipcRenderer` (renderer side) | **0** | 0 | — | n/a |
| `window.browserToolbar` | 1 / 1 | 0 | `browser-toolbar.tsx:80` | small |
| `fetch(` | **2 / 2** — *both in playground* | **0** | `playground/registry/turn-card.tsx:1941`, `playground/registry/markdown.tsx:99` | **none in production code** |
| `WebSocket` | **0** | 0 | lives in `apps/electron/src/transport/client.ts` (preload) | must be re-implemented in the native client |
| `EventSource` | **0** | 0 | — | — |
| `XMLHttpRequest` | **0** | 0 | — | — |
| `localStorage` | **56 / 16** | 5 / 2 | `lib/local-storage.ts:87,100,110,117,124` (the only sanctioned accessor), `ThemeContext.tsx`, `main.tsx:34` | Medium — must be replaced by a host-side prefs store |
| `sessionStorage` | **0** | 0 | — | — |
| `indexedDB` / `IDBDatabase` | **0** | 0 | — | — |
| `navigator.clipboard` | **19 / 14** | **11 / 9** | `hooks/useSessionMenuActions.ts:131,151,172`, `pages/ChatPage.tsx:460`, `SharePageDialog.tsx:205`, `ServerSettingsPage.tsx:139`, `TaskActionMenu.tsx:116`; UI: `overlay/CopyButton.tsx:32`, `markdown/CodeBlock.tsx:146`, `chat/TurnCard.tsx:1816` | Low — needs a host clipboard command |
| `document.execCommand` | **2 / 1** | 0 | `components/ui/rich-text-input.tsx:665` (`insertText`), `:673` (`defaultParagraphSeparator`) | Low–Medium (deprecated API) |
| `window.open(` | **0** | 0 | external links go through `electronAPI.openUrl` (`App.tsx:1727`, `lib/open-label-link.ts:22`) | — |
| `openExternal` (via bridge) | 3 / 1 + 34 `openUrl(` sites | 0 | `App.tsx:788`, `pages/SourceInfoPage.tsx:322,354` | Low |
| `<webview>` | **0** | 0 | Electron discourages it; the app uses `BrowserView` in main instead | — |
| `<iframe>` | **4 / 4** | **2 / 2** | `content-panels/FilePreviewContent.tsx:184` (`sandbox=""`), `content-panels/OfficeFilePreview.tsx:74` (`sandbox="allow-same-origin"`), `components/pages/PageFrame.tsx:319` (page runtime), `playground/registry/oauth.tsx:29`; UI: `markdown/MarkdownHtmlBlock.tsx:216`, `overlay/HTMLPreviewOverlay.tsx:202` | **High** — sandboxed HTML/JS execution inside the UI |
| `BrowserView` / `WebContentsView` (renderer side) | **0** — main-process only (36 `BrowserView` refs in `main/browser-pane-manager.ts`) | 0 | see §3.12 | **Highest** — real Chromium embedding |
| `URL.createObjectURL` | 1 / 1 | 1 / 1 | `content-panels/FilePreviewContent.tsx:71`; UI `markdown/table-export.ts:253` | Medium |
| `URL.revokeObjectURL` | 1 / 1 | 1 / 1 | `FilePreviewContent.tsx:79`, `table-export.ts:260` | — |
| `new Blob(` | 3 / 3 | 1 / 1 | `FilePreviewContent.tsx:71`, `OfficeFilePreview.tsx:50`, `FreeFormInput.tsx:1242` | Medium |
| `new File(` | 3 / 1 — *playground only* | 0 | `playground/registry/chat.tsx:687-689` | none |
| `FileReader` | 3 / 2 | 1 / 1 | `FreeFormInput.tsx:1150` (attachment read), `TiptapMarkdownEditor.tsx:122` | Medium |
| HTML5 DnD handlers (`onDrag*`/`onDrop`) | **19 / 4** | 5 / 2 | `kanban/CalendarView.tsx:404,429,473,577,616,707`, `kanban/KanbanBoard.tsx:150-151`, `FreeFormInput.tsx:1599-1602`; UI `TiptapMarkdownEditor.tsx:256,329`, `ImageCardStack.tsx:200` | Medium — two DnD systems coexist (HTML5 + dnd-kit) |
| `dataTransfer` | 5 / 2 | 2 / 1 | `CalendarView.tsx:246,405-406`, `FreeFormInput.tsx:1123,1256` | — |
| `IntersectionObserver` | **4 / 2** | 0 | `hooks/useInView.ts:25,29` (with a feature-detect fallback), `hooks/useSessionSearch.ts:493` comment | Low |
| `ResizeObserver` | **21 / 11** | **9 / 6** | `ChatDisplay.tsx:1134` (streaming auto-scroll), `FreeFormInput.tsx:1055`, `InputContainer.tsx:162`, `TerminalPanel.tsx:58`, `PdfFilePreview.tsx:17`, `hooks/useDynamicStack.ts:176`, `hooks/useContainerWidth.ts:19`; UI `trajectory/TrajectoryTable.tsx:98`, `trajectory/TrajectoryMapView.tsx:119,187`, `ui/Island.tsx:654`, `markdown/MarkdownMermaidBlock.tsx:109` | **High** — pervasive layout-driven reactivity; GPUI needs an explicit layout-invalidation equivalent |
| `MutationObserver` | **6 / 3** | 1 / 1 | `TerminalPanel.tsx:60` (theme change → re-theme xterm), `OfficeFilePreview.tsx:34`, `TurnCard.tsx:1773`, `hooks/useDynamicStack.ts:180` | Medium |
| `requestAnimationFrame` | **38 / 22** | **20 / 10** | `ChatDisplay.tsx` ×10 (scroll pinning, `:797,1091,1249,1408,1437`), `TiptapBubbleMenus.tsx` ×6, `ui/Island.tsx` ×3, `AppShell.tsx` ×3 | Medium — GPUI has frame callbacks; the imperative scroll rituals do not port |
| `getBoundingClientRect` | **37 / 16** | **20 / 10** | `AppShell.tsx` ×5, `ui/rich-text-input.tsx` ×5, `kanban/CalendarView.tsx` ×3, `ui/slash-command-menu.tsx` ×2, `hooks/useResizeGradient.ts` ×2; UI `chat/TurnCard.tsx` ×5, `TiptapBubbleMenus.tsx` ×3 | **High** — popover/annotation/drag positioning is measured against the DOM |
| `offsetWidth`/`clientHeight`/`scrollTop` family | **30 / 9** | **43 / 12** | `ChatDisplay.tsx:1075-1093` (stick-to-bottom math) | High |
| `<canvas>` / `getContext(` | **5 / 3** | **1 / 1** | `ThemeContext.tsx:169` (**2D canvas used to compute a contrast colour from an arbitrary CSS colour**), `hooks/useNotifications.ts:27,85` (badge icon rasterised in renderer), `ui/BrowserShader.tsx:25` | Medium — 2D raster, no WebGL |
| WebGL / `WebGL*` | **0** | 0 | shader lib is `@paper-design/shaders-react`, which may use WebGL internally — **INFERRED** | Medium |
| `matchMedia` | **5 / 3** | 0 | `ThemeContext.tsx:112-113`, `:447` (`(prefers-color-scheme: dark)`), `browser-empty-state.html:12`, `browser-toolbar.html:13` | Low |
| `prefers-color-scheme` | 7 / 4 | 0 | `index.html:22-23` (loader), `ThemeContext.tsx`, HTML entry documents | Low |
| `document.createElement` | 10 / 7 | 21 / 7 | off-screen canvas creation for colour/badge work; style injection | Medium |
| `document.body` | 12 / 6 | 18 / 9 | `@dnd-kit` `DragOverlay` portal target (`LeftSidebar.tsx:168` comment), dialogs | Medium |
| `window.addEventListener` | 26 / 14 | 15 / 8 | global key handling, custom events | — |
| `document.addEventListener` | 33 / 15 | 11 / 7 | outside-click, paste, focus management | — |
| `scrollIntoView` / `scrollTo(` | 16 / 8 | 7 / 6 | `ChatDisplay.tsx:393,761,1116,1137,1149,1194,1250,1400,1431` | High — transcript navigation is scroll-coordinate based |
| `getSelection(` | 5 / 2 | 0 | `rich-text-input.tsx`, annotation selection | Medium |
| `document.createRange(` / `new Range(` | 5 / 2 | 0 | rich-text + annotation geometry | Medium |
| **CSS Custom Highlight API** (`CSS.highlights.set`, `new Highlight()`) | **6 / 1** | 0 | `components/app-shell/ChatDisplay.tsx:83` (lazy accessor), `:886` (`search-passive`), `:906-909` (`search-active` / `search-passive`) - in-transcript search highlighting without mutating the DOM | **High** - Chromium-only, no cross-toolkit analogue |
| `navigator.*` | 40 / 27 | 11 / 9 | mostly `navigator.clipboard`; also `navigator.platform`/UA sniffing in `lib/platform.ts` | Low |
| `performance.now` | 8 / 3 | 2 / 1 | `App.tsx:970,972,975` (renderer perf instrumentation), `lib/perf.ts` | Low |
| `new CustomEvent` | **14 / 10** | 0 | `App.tsx:905` (`craft:restore-input`), `:988` (`craft:compaction-complete`) — cross-component escape hatch | Medium — bespoke event bus |
| `postMessage` | 2 / 1 | 0 | `<iframe>` bridges | Low |
| `new Worker(` | **0** | 0 | pdfjs ships a worker via `?url` but it is library-internal | — |
| `new Audio(` | **0** | 0 | — | — |
| `new Notification(` | **0** | 0 | native notifications go through `electronAPI.showNotification` | — |
| `history.pushState`/`replaceState` | 5 / 2 | 0 | in-app router (`lib/navigate.ts`, `contexts/NavigationContext.tsx`) | Medium |
| `location.hash/href/search` | 8 / 3 | 0 | deep-link / route parsing | Medium |
| `document.title` | 2 / 1 | 0 | window title updates | Low |
| `getComputedStyle` | 6 / 6 | 1 / 1 | reading theme CSS variables at runtime | Medium |
| `document.documentElement` | 9 / 7 | 0 | theme style injection (`style.setProperty`, background image for scenic mode) | Medium |
| `.click()` | 2 / 2 | 0 | programmatic button activation | Low |
| `dispatchEvent` | 16 / 12 | 0 | custom event bus | Medium |
| `dangerouslySetInnerHTML` | 3 / 2 | **7 / 6** | sanitized markdown HTML rendering | **High** — sanitizer + HTML renderer |
| `innerHTML` | 4 / 1 | 0 | shiki output injection | High |
| `querySelector` / `querySelectorAll` | 15 / 9 | 0 | direct DOM traversal | Medium |

### 2.3 CSS-specific features with **no** native equivalent

Aggregated over every `.css` in `apps/electron/src/renderer` + `packages/ui/src`
(13 stylesheets, 3,788 total lines):

| CSS feature | Occurrences | Notes |
|---|---|---|
| `var(--…)` references | **879** | The entire visual system is CSS-custom-property driven |
| distinct custom properties **defined** | **265** (524 definition sites) | 244 defs in `renderer/index.css`, 193 in `packages/ui/src/styles/index.css`, 40 in `trajectory-theme.css`, 19 in `motion.css`, 17 in `animated-task-item.css` |
| distinct `--…`-shaped tokens referenced anywhere | 965 | includes Tailwind 4's generated `--tw-*`, `--color-*`, `--radius-*`, `--shadow-*`, `--container-*`, `--z-*` |
| `color-mix(…)` | **201** | colour maths done in CSS, not JS — e.g. every depth/shadow token |
| `box-shadow` | 51 | 4 named shadow tiers: `--shadow-minimal`, `--shadow-middle`, `--shadow-strong`, `--shadow-modal-small` |
| `scrollbar*` | 47 | custom scrollbar styling (no GPUI equivalent) |
| `animation*:` | 29 | 15 `@keyframes` blocks |
| `transition*:` | 28 | |
| `transform:` | 24 | |
| `linear-gradient` | 22 | (`radial-gradient`: 0) |
| `@keyframes` | **15** | |
| `@container` | **11** | **container queries** — used for panel-width-responsive layout (`--container-panel-compact`, `--container-panel-medium`, `--container-mobile`) |
| `filter: blur` | 8 | |
| `@media` | 9 | mostly `prefers-color-scheme` + `prefers-reduced-motion` |
| `@property` | **8** | registered custom properties (`@property` is used for animatable tokens — Chromium-only behaviour) |
| `backdrop-filter` | **9** | glass panels |
| `mask-*` | 11 | gradient fade masks (scroll fade, badge stacking) |
| `@layer` | 9 | cascade layers |
| `position: sticky` | 1 | |
| `grid-template` | 6 | |
| `aspect-ratio` | 2 | |
| `light-dark()`, `view-transition`, `@supports`, `clip-path` | 0 | not used |

**Tailwind CSS 4 is the styling engine**: `@import "tailwindcss"` (`renderer/index.css:1`,
`packages/ui/src/styles/index.css:26`) + `@plugin "@tailwindcss/typography"`.

| Tailwind usage | Renderer | `packages/ui` |
|---|---|---|
| `className=` occurrences | **4,905** | **1,136** |
| `cn(` / `clsx(` / `cva(` calls | 566 | 205 |

**≈6,041 utility-class call sites** is the single largest implicit cost in a native rewrite: every
one of them is a *string* describing layout/typography/colour that must be re-expressed in the target
toolkit's styling model (or the CSS engine must be reused).

#### 2.3.1 How theming works

The theme engine is **file-driven, not user-editable** (`packages/shared/src/config/theme.ts`,
**634 lines**):

1. **Source of truth**: `~/.craft-agent/themes/*.json` (user themes) + one builtin
   `DEFAULT_THEME_FILE` (`theme.ts:593`). IDs validated by `isValidUserThemeId` (`:48`).
2. **Token schema** — three interfaces merged into `ThemeOverrides` (`:133`):
   - `ThemeColors` — **18** colour tokens (`background`, `foreground`, `accent`, `info`, `success`,
     `destructive`, `backgroundElevated`, `foregroundDimmed`, `secondary`, `secondaryForeground`,
     `muted`, `mutedForeground`, `card`, `cardForeground`, `popoverForeground`, `border`, `ring`,
     `userMessageBubble`)
   - `SurfaceColors` — **5** region tokens (`paper`, `navigator`, `input`, `popover`, `popoverSolid`)
   - `ThemeStyleTokens` — **16** non-colour tokens (`depth`, `shadowColor`, `shadowStrength`,
     `glassBlur`, `radius`, `borderWidth`, `borderStyle`, `fontSans`, `fontSerif`, `fontMono`,
     `fontSize`, `letterSpacing`, `lineHeight`, `iconStrokeWidth`, `iconStrokeLinecap`, `density`)
   - plus `mode: 'solid' | 'scenic'` and `backgroundImage`, and an optional `dark: {…}` override set.
3. **Cascade**: `resolveTheme()` = `mergeThemes(DEFAULT_THEME, appTheme)`; `themeToCSS(theme, isDark)`
   (`:362-459`) emits a CSS string of `--…: value;` declarations, which the renderer injects into
   `document.documentElement` (`renderer/context/ThemeContext.tsx`, **538 lines**).
4. **Material presets**: `depth` ∈ `flat | elevated | neon | glass | raised` expands into the four
   `--shadow-*` tiers + `--theme-backdrop-blur` via `depthToCSS()` (`:288-354`).
5. **Density presets**: `density` ∈ `compact | comfortable | cozy` expands into 4 padding tokens
   (`--theme-row-padding-y`, `--theme-menu-item-padding-y`, `--theme-settings-row-padding-y`,
   `--theme-activity-row-padding-y`) + `--theme-density-scale` (`:256-286, 425-436`).
6. **Scenic mode**: a full-window background image with glass panels; the image is set directly on
   `document.documentElement.style` (deliberately not through the stylesheet, to dodge stylesheet
   size limits with data URLs — `:453-455`).
7. **Shiki pairing**: each theme may declare `shikiTheme: { light, dark }` (`:555-558`), defaulting to
   `github-light` / `github-dark` (`:620`).
8. **Preference persistence**: `ThemePreferences { mode, colorTheme, font }` lives in
   `config.json`; `localStorage` is only a startup cache (see `ThemeContext.tsx:228`).
9. **Cross-window broadcast**: `broadcastThemePreferences` / `onThemePreferencesChange` /
   `broadcastWorkspaceThemeChange` / `onWorkspaceThemeChange` channels
   (`channel-map.ts:334-337`) — theme changes are pushed to every window.
10. **Native-side mirror**: `BACKGROUND_HEX { light:'#F6F7F8', dark:'#080A10' }` (`theme.ts:465`) is
    used for `BrowserWindow` backgroundColor — the main process cannot read CSS variables.

**Rewrite impact:** ~35 authored theme tokens + 5 material presets + 3 density presets + 2 modes.
That is tractable to port **if** the rewrite keeps a declarative token model; it is expensive if the
rewrite has to reproduce Tailwind's generated 965-token namespace.

---

## 3. Feature-surface map

Legend: ✅ implemented · ⚠️ partial · ➖ absent.

| # | Feature | Status | Central files (total lines) | Implementation notes |
|---|---|---|---|---|
| 1 | **App shell / multi-panel layout & resizing** | ✅ **hand-rolled; `react-resizable-panels` is DEAD CODE** | `AppShell.tsx` (**3,778** non-blank / 4,044 total), `WorkbenchResizeSash.tsx` (98/106), `SurfaceContainer.tsx` (265/281), `SurfaceSlot.tsx` (223/231), `MainContentPanel.tsx` (432/463), `LeftSidebar.tsx` (562/595), `TopBar.tsx` (304), `PanelHeader.tsx` (316), `hooks/useResizeGradient.ts` (103), `hooks/useHorizontalResizeGradient.ts` (76) | **No panel-group library in production.** AppShell owns `sidebarWidth` (persisted, default 220 px) + `sessionListWidth` in `useState`, an `isResizing: 'sidebar' \| 'session-list' \| null` mode, `document` mousemove/mouseup listeners (~1388–1431) and one absolutely-positioned handle (~3750–3761); auto-compact hides sidebar + navigator below a mobile width. `WorkbenchResizeSash` is an rAF-throttled drag sash between Primary Surface and Workbench, clamped 360–600 px (`clampCompanionPrimaryWidth`), keyboard-resizable (←/→/Home/End) with double-click reset. `components/ui/resizable.tsx` (49), `gradient-resize-handle.tsx` (57) and `horizontal-resize-handle.tsx` (81) are all **unreferenced** |
| 2 | **Session list & sidebar** | ✅ | `components/app-shell/SessionList.tsx` (794), `SessionItem.tsx` (272), `CompactSessionListFilter.tsx` (465), `SessionSearchHeader.tsx` (103), `MultiSelectPanel.tsx` (193), `SidebarMenu.tsx` (242), `hooks/useSessionSearch.ts` (**452**) | Roving-tabindex keyboard nav (`hooks/keyboard/useRovingTabIndex.ts`, 271); multi-select; label/project filters; search; **no virtualization** (see §4) |
| 3 | **Chat / transcript rendering (streaming)** | ✅ | `components/app-shell/ChatDisplay.tsx` (**2,126**), `packages/ui/src/components/chat/TurnCard.tsx` (**3,047**), `UserMessageBubble.tsx` (478), `SessionViewer.tsx` (227), `turn-utils.ts` (1,153), `InlineExecution.tsx` (216), `components/markdown/StreamingMarkdown.tsx` (171) | Streaming text accumulated in a `useRef` map per session (`event-processor/useEventProcessor.ts:80`); `StreamingMarkdown` splits content into paragraph/code blocks and memoises each by djb2 hash so completed blocks are not re-parsed; auto-scroll via `ResizeObserver` + `requestAnimationFrame` (`ChatDisplay.tsx:1109-1146`) |
| 4 | **Markdown rendering** | ✅ | `packages/ui/src/components/markdown/Markdown.tsx` (**668**) | `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `rehype-raw` + `rehype-sanitize`; 3 render modes (`terminal`/`minimal`/`full`); custom `remarkCollapsibleSections`; preview-blocks registry |
| 5 | **Code block rendering + highlighting** | ✅ | `packages/ui/.../markdown/CodeBlock.tsx` (211), `TiptapCodeBlockView.tsx` (284), `apps/.../components/shiki/ShikiCodeEditor.tsx` (177), `packages/ui/.../code-viewer/ShikiCodeViewer.tsx` (168), `registerShikiThemes.ts` (20) | **shiki** 4.4.3 (`codeToHtml`, `bundledLanguages`) + `tiptap-extension-code-block-shiki` + `prosemirror-highlight`-style decorations forced by a custom ProseMirror meta (`forceShikiDecorations`, `TiptapMarkdownEditor.tsx:33-49`) |
| 6 | **Message composer / rich-text input** | ✅ **hand-written `contentEditable` — NOT tiptap** | `components/app-shell/input/FreeFormInput.tsx` (**2,295** non-blank / 2,508 total), `InputContainer.tsx` (269/300), `ChatInputZone.tsx` (115/123), `InputErrorBoundary.tsx` (97), `use-working-directory-state.ts` (201), `components/ui/rich-text-input.tsx` (718/825), `slash-command-menu.tsx` (634/721), `mention-menu.tsx` (674/753), `label-menu.tsx` (414/460), `skill-mention-menu.tsx` (238), `AttachmentPreview.tsx` (123/133), `WorkingDirectorySelector.tsx` (227), `CompactModelSelector.tsx` (510/534), `CompactPermissionModeSelector.tsx` (136), `ToolbarStatusSlot.tsx` (190), `ActiveOptionBadges.tsx` (487/526) | `RichTextInput` is a **bespoke contentEditable** with IME/composition guards, mention parsing, a 100-line paste→attachment rule, `applySmartTypography`, `coerceInputText` — plus `document.execCommand` (`rich-text-input.tsx:665,673`) and three inline **cmdk** menus (slash commands incl. permission modes + `/compact` + folder completion; mentions typed `'skill' \| 'source' \| 'file' \| 'folder'`; labels). Attachments: file picker + **HTML5 drag-drop** (`:1599-1602`), `FileReader`, per-session persisted drafts via `getDraft`/`setDraft`. **`@tiptap/*` has 0 imports in the renderer** — its only consumer is the dev playground (`playground/registry/planner.tsx:30,978`) |
| 7 | **File tree / file browser** | ✅ | `components/content-panels/FilesPanel.tsx` (203), `ChangedFilesView.tsx` (288), `PreviewPanel.tsx` (163), `components/right-sidebar/SessionFilesSection.tsx` (**578**), `components/files/FileViewer.tsx` (77) | FilesPanel has 5 views: `explorer`, `changed`, `opened`, `activity`, `attachments` (`FilesPanel.tsx:27-33`); explorer backed by `listServerDirectory` / `searchFiles`; file watching via `watchSessionFiles` → `onSessionFilesChanged` |
| 8 | **Content workbench tabs & surfaces** | ✅ | `components/app-shell/ContextWorkbenchTabs.tsx` (205), `SurfaceContainer.tsx` (265), `SurfaceSlot.tsx` (223), `SurfaceLauncherButtons.tsx` (197), `components/content-panels/bound-panel-content.tsx` (55), `atoms/workbench.ts` (648), `lib/surface-launchers.ts` (81) | Surface kinds include `sessions`, `kanban`, `calendar`, `files`, `terminal`, `trajectory`, `preview`, `artifact`, `browser`, `pages` (`SurfaceLauncherButtons.tsx:52`, `AppShell.tsx:2140`); per-session tab state in `workbenchStateAtom` + `workbenchFocusBySessionAtom` |
| 9 | **PDF preview** | ✅ | `components/content-panels/PdfFilePreview.tsx` (30), `packages/ui/.../overlay/PDFPreviewOverlay.impl.tsx` (146), `markdown/MarkdownPdfBlock.impl.tsx` (223) | `react-pdf` + `pdfjs-dist` worker (canvas render + text layer + annotation layer); `vite.config.ts` aliases pdfjs to a single copy; lazy-loaded so pdfjs stays out of the initial chunk |
| 10 | **Image preview / lightbox** | ✅ | `packages/ui/.../overlay/ImagePreviewOverlay.tsx` (177), `PreviewOverlay.tsx` (187), `ZoomControls.tsx` (166), `ItemNavigator.tsx` (99), `markdown/ImageCardStack.tsx` (200), `MarkdownImageBlock.tsx` (250) | Zoom/pan/fullscreen overlays; `@paper-design/shaders-react` used for a shader backdrop |
| 11 | **Artifact review UI** | ✅ | `components/content-panels/ArtifactWorkbench.tsx` (241), `components/artifacts/ArtifactCard.tsx` (139), `ArtifactTurnCards.tsx` (42), `hooks/useArtifacts.ts` (94) | Revisioned deliverables; 12 artifact RPC channels (`listArtifacts`, `applyArtifact`, `submitArtifact`, `reviseArtifact`, `acceptArtifact`, `discardArtifact`, `acquireArtifactLease`, `releaseArtifactLease`, …) |
| 12 | **Browser panel — real embedded browser?** | ✅ **YES — a real Chromium embed** | Renderer: `components/browser/BrowserTabStrip.tsx` (284), `BrowserToolbar.tsx` (47), `BrowserTabBadge.tsx` (92), `AppShell.tsx:2102-2130`; Main: `main/browser-pane-manager.ts` (**3,687**), `main/browser-cdp.ts` (**1,061**), `preload/browser-toolbar.ts` (53) | **Not an iframe.** Main creates a chromeless frameless `BrowserWindow` hosting **three `BrowserView`s**: toolbar (preload `browser-toolbar-preload.cjs`, `sandbox:false`), page (`sandbox:true`), native overlay (`sandbox:true`) — `browser-pane-manager.ts:410/421/436/506-509`, with a hard assertion that `addBrowserView`+`setTopBrowserView` exist (`:431-434`). Partition `persist:browser-pane` (`:385/134`). 17 `browserPane.*` RPC channels (`handlers/browser.ts`) + 3 push events + 8 raw `browser-toolbar:*` IPC channels + a 34-method remote capability bridge `__browser:invoke` (`:2446`). CDP (`webContents.debugger.attach('1.3')`) drives Accessibility/DOM/Runtime/Input domains. Uses the **deprecated `BrowserView` API, not `WebContentsView`** (a comment at `window-manager.ts:276` claims otherwise — stale). |
| 13 | **Terminal panel — xterm?** | ✅ | Renderer: `components/content-panels/TerminalPanel.tsx` (**67**); Main: `main/terminal-manager.ts` (**153**) | **Both are used.** `@xterm/xterm` 6 + `@xterm/addon-fit` in the renderer (`TerminalPanel.tsx:2-4`) create the emulator, `fit.fit()` on `ResizeObserver`, `terminal.write()` on `onTerminalData`, `terminal.onData → writeTerminal`. `node-pty` lives in main (`terminal-manager.ts:6,13-25,85-91`: `spawn(shell, [], { name:'xterm-256color', TERM:'xterm-256color', COLORTERM:'truecolor' })`), with a 1 MB ring buffer and an ANSI-stripping reader exposed to the *agent*. Transport is WS-RPC (`channel-map.ts:20-27`), not `ipcMain`. There is also a **static** non-xterm renderer: `packages/ui/src/components/terminal/TerminalOutput.tsx` (210) + `ansi-parser.ts` (141) for captured shell output in cards. |
| 14 | **Data tables** | ✅ | `components/ui/data-table.tsx` (294), `data-table-features.ts` (56), `data-table-features.test.ts` (61), `components/ui/table.tsx` (101), `components/info/{PermissionsDataTable,AutoRulesDataTable,LabelsDataTable,ToolsDataTable,Info_DataTable}.tsx` | `@tanstack/react-table` v9 with the **explicit feature-registration API**: `data-table-features.ts` registers **9 features** (column/global filtering, column visibility, column sizing, column resizing, row sorting, row pagination, row expanding, row selection) + **4 row-model factories** + **1 filterFn** (`includesString`) + **4 sortFns** (`alphanumeric`, `text`, `basic`, `datetime`) = **18 registered helpers** as a single `dataTableFeatures` contract. `DataTable` adds global/column filters, tree rows (`getSubRows`), pagination (default 50) and sticky-header options; 12 consumer files (permissions, tools, labels, auto-rules, appearance, source info, playground). Dedicated CI gate `test:ui:table` |
| 15 | **Kanban / board** | ✅ | `components/app-shell/kanban/KanbanBoard.tsx` (210), `KanbanBoardContainer.tsx` (608), `KanbanColumn.tsx` (342), `TaskTile.tsx` (517), `TaskEditor.tsx` (**1,289**), `WorkItemEditor.tsx` (219), `WorkItemListView.tsx` (199), `SubtaskRow.tsx` (87), `TaskActionMenu.tsx` (247), `atoms/kanban.ts` (55), `hooks/useKanbanColumnColors.ts` (46) | `@dnd-kit/core` (`DndContext`, `useDraggable`, `useDroppable`) + `DragOverlay`; state in `atoms/kanban.ts` (`kanbanProjectFilterAtom`, `workItemStatusFilterAtom`, `workItemSortAtom`, `kanbanColumnStatusAtom`, …) |
| 16 | **Calendar** | ✅ | `components/app-shell/kanban/CalendarView.tsx` (**864**) | Custom month/week time-grid built on `date-fns` + **raw HTML5 DnD** (`onDragStart`/`onDrop` at `:404,429,473,577,616,707`) + `onDoubleClick` create; backed by `listCalendarEntries`/`createCalendarEntry`/… and `hooks/useCalendarEntries.ts` (93) |
| 17 | **Automations UI** | ✅ | `components/automations/AutomationsListPanel.tsx` (332), `AutomationInfoPage.tsx` (262), `CronBuilder.tsx` (260), `AutomationEventTimeline.tsx` (199), `types.ts` (468), `AutomationActionRow.tsx` (123), `BatchAutomationMenu.tsx` (104) | Cron builder, matcher/action editor (`prompt` \| `webhook` \| `script`), test + replay + history |
| 18 | **Messaging UI** | ✅ | `components/messaging/MessagingDialogHost.tsx` (135) + `TelegramConnectDialog` (154), `LarkConnectDialog` (196), `WeChatConnectDialog` (158), `WeComConnectDialog` (85), `WhatsAppConnectDialog` (141), `TelegramSupergroupPairingDialog` (179), `PairingCodeDialog` (129), `access/*` (878) | Platforms: **Telegram, Lark, WeChat, WeCom, WhatsApp**; pairing codes rendered as QR (`qrcode.react`); owners/allow-list/access-mode admin UI |
| 19 | **Settings pages** | ✅ 11 pages | `pages/settings/` (5,716 lines) + `components/settings/` (1,723) | See §3.1 |
| 20 | **Onboarding** | ✅ | `components/onboarding/OnboardingWizard.tsx` (202) + `CredentialsStep` (417), `APISetupStep` (282), `ProviderSelectStep` (151), `GitBashWarning` (139), `LocalModelStep` (138), `ReauthScreen` (97), `CompletionStep` (53), `WelcomeStep` (44); `hooks/useOnboarding.ts` (**861**) | Multi-step wizard; OAuth flows performed **client-side** in the preload (`performOAuth`, `startClaudeOAuth`, `startChatGptOAuth` — `bootstrap.ts:289-429`) because the redirect callback server must run on the user's machine |
| 21 | **Command palette / global search** | ➖ **NO global command palette (⌘K does not exist)** | `components/ui/command.tsx` (144/155) defines `CommandDialog`/`CommandInput`/`CommandList`/`CommandEmpty`/`CommandGroup`/`CommandSeparator`/`CommandItem` with **0 importers repo-wide** (dead shadcn wrapper). Live `cmdk` users, 4 files: `slash-command-menu.tsx:3`, `session-status-menu.tsx:3`, `app-shell/input/WorkingDirectorySelector.tsx:3`, `apisetup/ApiKeyInput.tsx:15` | Search in practice = session list search (`hooks/useSessionSearch.ts` 452/544 + `SessionSearchHeader.tsx` 103/107) backed by `searchSessionContent` (ripgrep), plus per-entity search headers reused by sources/skills/automations lists; `app.search` hotkey = `mod+f` (`actions/definitions.ts`) |
| 22 | **Context menus, dialogs, sheets, popovers** | ✅ | `components/ui/context-menu.tsx` (304), `styled-context-menu.tsx` (120), `dialog.tsx` (131), `rename-dialog.tsx` (80), `drawer.tsx` (19 → vaul), `popover.tsx` (42), `dropdown-menu.tsx` (283/311), `avatar.tsx` (173/185), `select.tsx` (156/167), `tabs.tsx` (50/55), `collapsible.tsx` (50/55), `scroll-area.tsx` (54/58), `switch.tsx` (27/31), `separator.tsx` (24/26), `label.tsx` (19/22), `button.tsx` (63, Radix `Slot` only), `packages/ui/src/components/tooltip.tsx` (the 14th Radix wrapper); non-Radix surfaces in `packages/ui/.../ui/{Island,SimpleDropdown,StyledDropdown,FilterableSelectPopover,InlineMenuSurface}.tsx`. **Sheets = vaul drawer** (`packages/ui/.../ui/drawer.tsx` re-exported by a 19-line renderer shim); its only renderer consumer is `CompactWorkspaceSwitcher.tsx` | Usage counts (renderer + ui): `<Dialog` **142**, `<DropdownMenu` **149**, `<Popover` **63**, `<Select` **54**, `<ContextMenu` **49**, `<Drawer` **44** |
| 23 | **Notifications / toasts** | ✅ | `components/ui/sonner.tsx` (Toaster wrapper), `hooks/useNotifications.ts` (203), `main/notifications.ts` (267) | In-app: **sonner** (373 `toast(` call sites). OS-level: `notification:show` → Electron `Notification`; badge drawn on a **renderer canvas** and pushed back to main (`badge:draw` / `badge:draw-windows`) |
| 24 | **Drag & drop reordering** | ✅ | `components/ui/sortable-list.tsx` (232, `@dnd-kit`), `kanban/KanbanBoard.tsx`, `kanban/KanbanColumn.tsx`, `app-shell/LeftSidebar.tsx:168`, `hooks/useStatuses.ts` (68), `reorderStatuses` RPC | Two coexisting systems: **dnd-kit** (sortable lists, kanban) and **raw HTML5 DnD** (calendar, file drop into composer) |
| 25 | **Virtualized lists** | ➖ **NONE** | No `react-window` / `react-virtual` / `@tanstack/react-virtual` / `react-virtuoso` / `react-virtualized` anywhere — **0 files and 0 dependency entries**. `packages/ui/src/components/trajectory/trajectory-virtual-rows.ts` (88) implements a hand-rolled fixed-height window projector (`VirtualRowWindow`, `VIRTUAL_OVERSCAN = 5`, top/bottom spacers) used only by `TrajectoryTable.tsx`. The session list pages **incrementally** instead (`INITIAL_DISPLAY_LIMIT = 50`, `BATCH_SIZE = 50`, `MAX_SEARCH_RESULTS = 100` — `hooks/useSessionSearch.ts:17-19,306,478,489`), and `hooks/useInView.ts` lazily mounts off-screen tiles. Chat renders **all** mounted turns | See §4 |
| 26 | **i18n** | ✅ | 7 locales × **2,238 keys**; `packages/shared/src/i18n/{registry.ts,setupI18n.ts,languages.ts}`; **2,322 `t()` call sites** | Locale JSON lazily imported; parity/sorted/coverage lint gates |
| 27 | **Theme engine** | ✅ | `packages/shared/src/config/theme.ts` (634), `renderer/context/ThemeContext.tsx` (538), `renderer/hooks/useTheme.ts` (43), `pages/settings/AppearanceSettingsPage.tsx` (530), `components/ui/color-picker.tsx` (130) | See §2.3.1 |
| 28 | **Run / Trajectory / Context / Map views** | ✅ | `packages/ui/src/components/trajectory/` (25 files, 4,705 lines): `TrajectoryView.tsx` (388), `TrajectoryMapView.tsx` (398), `TrajectoryContextView.tsx` (215), `TrajectoryTable.tsx` (230), `TrajectoryToolbar.tsx` (146), `TrajectoryStrip.tsx` (62), `TrajectoryOverview.tsx` (251), `RecordInspector.tsx` (398), `trajectory-layout.ts` (466), `trajectory-session-map.ts` (210), `trajectory-context.ts` (234), `trajectory-timeline.ts` (185), `trajectory-snapshot.ts` (150), `trajectory-search-index.ts` (94), `trajectory-virtual-rows.ts` (88) + 3 CSS modules (~1,055 lines); renderer host `components/content-panels/TrajectoryPanel.tsx` (204) | Exported as `TrajectoryView`, `TrajectoryTable`, `TrajectoryToolbar`, `TrajectoryStrip`, `TrajectoryMapView`, `TrajectoryContextView`, `TrajectoryPromptView` (`trajectory/index.ts`) |
| 29 | **Diff viewing** | ✅ | `packages/ui/.../code-viewer/{UnifiedDiffViewer.tsx (222), ShikiDiffViewer.tsx (200), DiffViewerControls.tsx (81), DiffIcons.tsx (89), language-map.ts (105)}`, `overlay/MultiDiffPreviewOverlay.tsx` (364), `markdown/MarkdownDiffBlock.tsx` (109), `markdown/diff-normalize.ts` (108), `apps/.../components/shiki/ShikiDiffViewer.tsx` (21), `components/content-panels/ChangedFilesView.tsx` (288) | Two renderers: `UnifiedDiffViewer` parses pre-computed unified-diff strings with `@pierre/diffs` `parsePatchFiles`; `ShikiDiffViewer` renders file→file diffs from `parseDiffFromFile`. `@pierre/diffs/react` `FileDiff` + custom registered Shiki themes. Multi-file overlay stacks diffs with per-file headers. |
| 30 | **Pages runtime (workspace mini-dashboards)** | ✅ | `components/pages/PageFrame.tsx` (312, sandboxed `<iframe>`), `PageView.tsx` (440), `PagesHome.tsx` (188), `SharePageDialog.tsx` (435), `PageGrantsDialog.tsx` (92), `PageSourceAuthBanner.tsx` (219) | Renders agent-authored HTML pages in a sandboxed iframe with a postMessage action bridge + grants/leases/sharing/publishing |
| 31 | **Projects / work items** | ✅ | `components/projects/TaskPage.tsx` (176), `SchedulePage.tsx` (166), `ProjectManagementSurface.tsx` (66), `CreateProjectDialog.tsx` (74), `WorkItemFilterControls.tsx` (78) | |
| 32 | **App menus (native + in-app)** | ✅ | `components/app-menu/DesktopAppMenu.tsx` (279), `MobileAppMenu.tsx` (296), `mobile-menu-pages.ts` (137), `MobileMenuPage.tsx` (76), `MobileMenuItem.tsx` (70); main `main/menu.ts` (271) | Native macOS menu template pushes `menu:*` events; in-app menu mirrors it |
| 33 | **Keyboard shortcuts** | ✅ | `actions/definitions.ts` (248, **31 actions**), `actions/registry.tsx` (163), `actions/keybinding-context.ts` (128), `actions/useAction.ts` (38), `actions/useHotkeyLabel.ts` (32), `components/KeyboardShortcutsDialog.tsx` (162), `pages/ShortcutsPage.tsx` (143), `pages/settings/ShortcutsPage.tsx` (155) | Central action registry with default hotkeys (`mod+n`, `mod+t`, `mod+,`, `mod+f`, `mod+shift+a`, …); overridable, with a per-window keybinding context |
| 34 | **Transport / connection UX** | ✅ | `components/app-shell/TransportConnectionBanner.tsx` (100), `hooks/useTransportConnectionState.ts` (56), `components/app-shell/SetupAuthBanner.tsx` (109), `lib/transport-wait.ts` (44), `lib/reconnect-recovery.ts` (16) | Surfaces WS reconnect state published by the preload |
| 35 | **Background tasks / agents** | ✅ | `components/app-shell/ActiveTasksBar.tsx`, `BackgroundFinishedChip.tsx` (138), `atoms/background-finished.ts` (63), `hooks/useBackgroundTasks.ts` (78), `components/app-shell/kanban/TaskChatPreview.tsx` (108), `RecoveryReconciliationDialog.tsx` (234), `ModelRecoveryReconciliationDialog.tsx` (89) | Live workflow fan-out counters, task recovery reconciliation |
| 36 | **API/Labels/Statuses/Sources/Skills management** | ✅ | `components/apisetup/*` (1,169), `components/info/*` (1,693), `components/app-shell/{SourcesListPanel,SkillsListPanel,ProjectsListPanel}.tsx`, `components/ui/label-menu.tsx` (414), `label-value-popover.tsx` (315), `EditPopover.tsx` (**1,032**) | `EditPopover` is the generic entity-editing surface (sources, skills, labels, statuses, projects) |
| 37 | **Workspace management** | ✅ | `components/workspace/*` (1,409): `WorkspaceCreationScreen.tsx` (214), `AddWorkspaceStep_{Choice,CreateNew,OpenFolder,ConnectRemote}.tsx` (89/180/116/375), `WorkspacePicker.tsx` (114), `primitives.tsx` (134); `app-shell/WorkspaceSwitcher.tsx` (321), `CompactWorkspaceSwitcher.tsx` (284), `SendToWorkspaceDialog.tsx` (279), `SendResourceToWorkspaceDialog.tsx` (262) | Local + remote workspace creation, session transfer, resource export/import |

### 3.1 Settings pages (11)

`pages/settings/settings-pages.ts` maps subpage IDs → lazily-imported components; every page is
`React.lazy`. `SettingsNavigator.tsx` (173) drives navigation.

| Subpage ID | File | Total lines | Purpose |
|---|---|---|---|
| `app` | `AppSettingsPage.tsx` | 393 | App-level toggles, updates, notifications, telemetry |
| `ai` | `AiSettingsPage.tsx` | **1,262** | LLM connections, API keys, OAuth (Claude/ChatGPT/Copilot/Pi), default thinking level |
| `appearance` | `AppearanceSettingsPage.tsx` | 564 | Theme mode, colour theme picker, font, language |
| `input` | `InputSettingsPage.tsx` | 130 | Auto-capitalisation, send-message key, spell check |
| `workspace` | `WorkspaceSettingsPage.tsx` | 550 | Workspace defaults, remote server, network proxy |
| `permissions` | `PermissionsSettingsPage.tsx` | 318 | Permission modes + tool policies |
| `labels` | `LabelsSettingsPage.tsx` | 171 | Label CRUD + ordering |
| `messaging` | `MessagingSettingsPage.tsx` | 913 | Platform connections, bindings, access control |
| `server` | `ServerSettingsPage.tsx` | 288 | Server mode config, home dir, status |
| `shortcuts` | `ShortcutsPage.tsx` | 155 | Keyboard shortcut reference/editor |
| `preferences` | `PreferencesPage.tsx` | 449 | User preferences (read/write via `readPreferences`/`writePreferences`) |

Supporting widgets in `components/settings/` (1,723 total): `SettingsRadioGroup.tsx` (292),
`SettingsMenuSelect.tsx` (286), `SettingsSegmentedControl.tsx` (189), `SearchableModelInput.tsx` (172),
`SettingsSection.tsx` (107), `SettingsRow.tsx` (103), `SettingsCard.tsx` (80),
`SettingsToggle.tsx` (77), `SettingsInput.tsx` (68), `SettingsEditRow.tsx` (57),
`SettingsSelect.tsx` (52), `SettingsTextarea.tsx` (37).

Also non-settings *info* pages: `SourceInfoPage.tsx` (472), `ProjectInfoPage.tsx` (443),
`SkillInfoPage.tsx` (258), `ChatPage.tsx` (759), `ShortcutsPage.tsx` (143).

---

## 4. Virtualization & performance-sensitive paths

### 4.1 There is no list virtualization

`rg` for `react-window`, `react-virtual`, `@tanstack/react-virtual`, `react-virtuoso`, `virtua`
across the whole repo (excluding `node_modules`) finds **no virtualisation library in any
`package.json` and no import anywhere**. The only hits are:

- `packages/ui/src/components/trajectory/trajectory-virtual-rows.ts` (88 lines) — a hand-written
  projector that computes a fixed-height window (`CONTENT_ROW_HEIGHT`, `COLLAPSED_SUMMARY_HEIGHT`,
  `REQUEST_BOUNDARY_HEIGHT`) and a visible slice (`computeVirtualRowWindow`, `projectVirtualRows`),
  consumed only by `TrajectoryTable.tsx:12,92-132`.
- `packages/ui/src/components/trajectory/TrajectoryTable.module.css` — CSS for that table.
- A repo doc, `docs/right-panel-audit-report.md:283`, **claims this virtualization is a shell**
  ("`const virtualRows = rows` … thousands of `<tr tabIndex={0}>` rendered; `projectVirtualRows`
  computes a height that is never used"). **INFERRED:** the doc is a prior internal audit and was not
  re-verified here beyond confirming that no third-party virtualizer exists.

Consequences for a rewrite:

| Long list | Handling today | Risk |
|---|---|---|
| Chat transcript | Full DOM. `ChatDisplay.tsx` renders every turn; scroll position maintained manually (`scrollTop`/`scrollHeight`/`clientHeight` math at `:1075-1093`, `scrollIntoView` at 9 sites, `rAF` debounce at `:1132-1161`) | Very long sessions render thousands of nodes |
| Session list | **Incremental paging, not windowing** (`SessionList.tsx` 794/870): `INITIAL_DISPLAY_LIMIT = 50`, `BATCH_SIZE = 50`, `MAX_SEARCH_RESULTS = 100` (`hooks/useSessionSearch.ts:17-19`); roving tabindex; grouping by `ChatGroupingMode = 'date' \| 'status' \| 'unread' \| 'project'` | |
| Trajectory ledger | Fixed-height row projector only (`trajectory-virtual-rows.ts`) | |
| Data tables | Full DOM (`@tanstack/react-table` without a virtualizer) | |
| Kanban | Full DOM per column | |
| File trees | Full DOM per folder expansion | |

### 4.2 Performance strategies that a rewrite must reproduce

Patterns were counted with `rg -o` and generic-aware patterns (`\buseMemo[<(]`, not `\buseMemo\s*\(`)
so that `useMemo<T>(…)` and `memo<T>(…)` are included.

| Strategy | Count (renderer) | Notes |
|---|---|---|
| `useCallback` | **678** (141 files) | dominant memo primitive |
| `useEffect` | 440 | |
| `useState` | 438 | |
| `useMemo` | **283** (114 files) | heaviest in `hooks/useSessionSearch.ts` (≥9) and `contexts/NavigationContext.tsx` |
| `useRef` | 91 | |
| `useAtomValue` / `useSetAtom` / `useAtom` | 83 / 70 / 25 = **178** jotai hook call sites | |
| `useStore()` | 6 | `App.tsx:319`, `AppShell.tsx:614`, `NavigationContext.tsx:185`, `lib/panel-triggers.ts:14`, `kanban/TaskEditor.tsx:559` |
| `useLayoutEffect` | 8 | |
| `React.memo` / `memo<…>(` | **4** — `ChatDisplay.tsx:2300` (`MemoizedMessageBubble`, custom comparator that **always** re-renders if either side `isStreaming`), `pages/ChatPage.tsx:37`, `components/markdown/StreamingMarkdown.tsx:101` (`MemoizedBlock`), `components/chat/AuthRequestCard.tsx:668` | Very low count: memoisation is done at the **atom-selector** layer instead |
| plain `atom(` / `atom<T>(` definitions | 54 / 37 = **91** | |
| `atomFamily(` definitions | **2** (both `atoms/sessions.ts`) | |
| `atomWithStorage(` definitions | **5** (→ `localStorage`) | |
| `useDeferredValue` | **0** | |
| `startTransition` / `useTransition` | **0** | |
| `useSyncExternalStore` | **0** | |
| **Virtualized lists** | **NONE** | no `react-virtuoso` / `react-virtual` / `react-window` / `useVirtualizer`; no `content-visibility` / `contain-intrinsic-size` in `index.css` |
| Streaming block-level memoisation | `components/markdown/StreamingMarkdown.tsx` — splits into blocks, hashes each (djb2), renders completed blocks from cache | |
| Renderer perf instrumentation | `App.tsx:970-978` records `agentEvent.process` and (via `rAF`) `stream.eventToPaint` samples through `lib/perf.ts` (222 lines) | |
| Streaming state kept out of React state | `event-processor/useEventProcessor.ts:80` — `useRef<Map<sessionId, StreamingState>>`; no React render per delta | |
| Layout-driven reactivity | **30** `ResizeObserver` sites (renderer + `packages/ui`) — the app reacts to *measured size*, not to a declarative layout system | |
| Atom-level render isolation | `atomFamily` + per-session atoms; **no `sessionsAtom` array exists** (`atoms/sessions.ts:231-237` documents its removal as a memory-leak fix) | |
| Metadata-write suppression | `atoms/sessions.ts:257-263` — `updateSessionAtom` compares every `SessionMeta` key with `Object.is` and **keeps the Map identity stable** when text deltas do not change list metadata, so session-list subscribers stay asleep | |
| Transactional bulk writes | `refreshSessionsMetadataAtom` (`atoms/sessions.ts:419-486`) performs all cross-atom writes in one jotai write → one React commit | |
| Lazy transcript loading | `getSessions()` returns `messages: []`; `ensureSessionMessagesLoadedAtom` / `forceSessionMessagesReloadAtom` (`:746`, `:757`) hydrate on demand, with a module-level promise dedupe map (`:223`). Stated rationale at `:402-405`: ~500 MB → ~50 MB for 300+ sessions | |
| Session cache eviction | `pruneSessionCacheAtom` (`atoms/sessions.ts:182-214`), timer at `App.tsx:321` — every 60 s; keeps entries < 2 min old, or < 8 sessions & < 15 min & ≤ 64 MB (`estimateTranscriptBytes`); never evicts active / streaming / loading / read-pinned / background-running sessions | |

---

## 5. State management architecture

### 5.1 Anatomy

| Layer | Location | Size |
|---|---|---|
| Server (Bun) | `packages/server-core` + `packages/pi-agent-server` (JSONL-over-stdio subprocess driving `@earendil-works/pi-coding-agent`) | — |
| Wire | WebSocket JSON-RPC, 401 channels / 58 namespaces (`packages/shared/src/protocol/channels.ts`) | 553 lines |
| Client transport | `apps/electron/src/transport/*` — `client.ts`, `routed-client.ts` (213), `chunked-rpc.ts` (main, 125) | 520 + 65 + 213 |
| Preload bridge | `src/preload/bootstrap.ts` → `window.electronAPI` (370 methods) | 474 lines |
| Event processor | `renderer/event-processor/*` — pure reducer | 15 files, 3,671 lines |
| Store | `renderer/atoms/*` (jotai) | 22 files, 3,099 lines |
| Contexts | `renderer/context/*` + `renderer/contexts/*` | 16 files, 3,488 lines |
| Components | `renderer/components/*` + `packages/ui` | — |

### 5.2 Event flow (ASCII)

```
                    ┌──────────────────────────────────────────────┐
                    │  Bun server (local ws://127.0.0.1:<port>     │
                    │  or remote ws(s)://…)                        │
                    │  packages/server-core  ·  401 RPC channels   │
                    │      │                                       │
                    │      └── pi-agent-server subprocess          │
                    │          (JSONL over stdio, Pi SDK)          │
                    └───────────────┬──────────────────────────────┘
                                    │  WS JSON-RPC push: sessions:event
                                    ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │ PRELOAD  apps/electron/src/preload/bootstrap.ts                    │
   │  WsRpcClient(local)  +  WsRpcClient(remote)  →  RoutedClient       │
   │  buildClientApi(client, CHANNEL_MAP) → 370 fns                     │
   │  contextBridge.exposeInMainWorld('electronAPI', api)   :474        │
   └───────────────┬────────────────────────────────────────────────────┘
                   │
                   ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │ RENDERER  App.tsx:938                                              │
   │   window.electronAPI.onSessionEvent(ev => { … })                   │
   │     • lifecycle events (session_created / session_deleted) handled  │
   │       directly  :945 / :964                                        │
   │     • everything else → processAgentEvent(agentEvent, atomSession,  │
   │                                            workspaceId)  :1004      │
   └───────────────┬────────────────────────────────────────────────────┘
                   ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │ event-processor  (PURE)                                            │
   │   useEventProcessor.ts:82  processAgentEvent(…)                    │
   │      streamingStates = useRef<Map<sessionId, StreamingState>>  :80 │
   │   processor.ts:67  processEvent(state, event) →                    │
   │      switch(event.type) → 45 handler cases                         │
   │      returns { state: SessionState, effects: Effect[] }            │
   │   handlers/text.ts (176) · handlers/tool.ts (258) ·                │
   │   handlers/session.ts (1,021) · types.ts (587)                     │
   └───────────────┬────────────────────────────────────────────────────┘
                   ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │ atoms  (jotai)                                                     │
   │   updateSessionDirect(sessionId, () => updatedSession)   :1011     │
   │   sessionAtomFamily · sessionMetaMapAtom · sessionIdsAtom          │
   │   write-only mutation atoms: appendMessageAtom,                    │
   │   updateStreamingContentAtom, updateSessionAtom, …                 │
   └───────────────┬────────────────────────────────────────────────────┘
                   ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │ components (useAtomValue / useSetAtom)  → React render             │
   │ effects: toast_error → sonner ; craft:restore-input → CustomEvent  │
   └────────────────────────────────────────────────────────────────────┘

   Mutations back up: component → window.electronAPI.<method>(…) →
   RoutedClient.invoke(channel) → WS JSON-RPC → server → pushes an event
   that re-enters the loop above.
```

### 5.2b Where the stream really comes from (correction)

The old "renderer talks JSONL to a subprocess" model is **gone from the renderer**. JSONL survives
only *behind* the server:

- `PiAgent` ("JSONL-over-stdio client driving the `packages/pi-agent-server` subprocess") is alive at
  `packages/shared/src/agent/pi-agent.ts:4,224,491` — **server-side**, not renderer-side.
- The **local** server is **not a separate Bun process**: `bootstrapServer()` is invoked *in-process*
  by the Electron main process (`apps/electron/src/main/index.ts:691`), which then hosts a
  `WsRpcServer` (`packages/server-core/src/bootstrap/headless-start.ts:380`). The standalone
  `packages/server/src/index.ts` (shebang `#!/usr/bin/env bun`) is the headless/remote/WebUI host.
  **INFERRED** from `main/index.ts:691` + `packages/server/src/index.ts:1-26`.
- `spawn` in `apps/electron/src/main` exists only for `node-pty` (`main/terminal-manager.ts:85`).
- `jsonl` appears in the renderer in **3 comment-only hits**.

### 5.3 Event vocabulary and reducer shape

**Two deliberately distinct unions:**

| Union | Arms | Where |
|---|---|---|
| `SessionEvent` (wire) | 52 arms / 51 distinct `type` strings | `packages/shared/src/protocol/dto.ts:385-437` |
| `AgentEvent` (processor input) | **48 arms**, exhaustive | `event-processor/types.ts:572-620` (file is 640 lines) |

Difference = exactly 3 arms handled *outside* the processor: `shell_killed` (`dto.ts:418`, consumed
by `handleBackgroundTaskEvent`), `session_created` (`dto.ts:429`), `session_deleted` (`dto.ts:428`).
`App.tsx:969` performs an unchecked widening: `const agentEvent = event as unknown as AgentEvent`.

`processEvent` (`processor.ts:67-250`) is an exhaustive `switch (event.type)` over those **48** arms,
terminated by `const _exhaustiveCheck: never = event` (`:243`).

- **Input**: `SessionState = { session: Session, streaming: StreamingState | null, durableCursor?: number }`
  (`types.ts:18-35`); `StreamingState = { messageIndex?, messageId?, content, turnId?, parentToolUseId? }`
- **Output**: `ProcessResult = { state: SessionState, effects: Effect[] }` (`types.ts:636-639`) —
  **there is no diff/patch object**; the whole `Session` is replaced.
- `Effect` union = **6 kinds**: `permission_request`, `credential_request`, `generate_title`,
  `permission_mode_changed`, `restore_input`, `toast_error` (`types.ts:625-631`).
- Guaranteed to always return **new references** (explicit rationale at `processor.ts:5-12`) so jotai
  atom subscribers fire.
- `advanceDurableCursor` (`:252-255`) enforces a monotonic `durableSeq` for resume
  (`durableOperationId` / `durableSeq` ride on `text_complete`, `tool_start`, `tool_result` —
  `types.ts:73-74, 95-96, 115-116`).
- Handlers: `handlers/text.ts` (176; `handleTextDiscard:20`, `handleTextDelta:38`,
  `handleTextComplete:106`) · `handlers/tool.ts` (258; 6 functions) · `handlers/session.ts`
  (**1,108 total lines**, **40 exported handlers**).
- `helpers.ts` (167) is **ID-based, never position-based** (`:4-5`): `findMessageByTurnId:23`,
  `findStreamingMessage:38`, `findAssistantMessage:60`, `findToolMessage:82`, `updateMessageAt:94`,
  `appendMessage:116` (dedupes by message id, `:122`), `insertMessageAt:144`, `clearRetryStatus:160`,
  `createEmptySession:172`.
- Effects are executed by `handleEffects` in `App.tsx` (`toast_error` → sonner; draft restore →
  `window.dispatchEvent(new CustomEvent('craft:restore-input'))`, `App.tsx:905`).
- Errors are additionally captured to Sentry in `useEventProcessor.ts:21-44` (deliberately outside the
  pure function).
- Two dispatch branches in `App.tsx`: **branch A** (`App.tsx:1000-1058`) when
  `atomSession.isProcessing === true` **or** the event is one of 13 `handoffEventTypes`
  (`App.tsx:839`) — the atom is treated as source of truth and `sessionMetaMapAtom` is only updated
  for handoff events; **branch B** (`App.tsx:1062-1084`) for the idle path. Both call the same three
  functions: `processAgentEvent` → `updateSessionDirect` → `handleEffects`, plus
  `handleBackgroundTaskEvent`.

**Reliable delivery:** the server assigns a per-client `seq`, the client sends `sequence_ack`
(`packages/server-core/src/transport/client.ts:853-860`), and a handshake ack carrying `stale:true`
triggers a full refresh — handled at `App.tsx:1107` (`onReconnected(isStale)`), which calls
`refreshSessionListMetadataFromServer` plus per-session `getSessionMessages` with 2 s / 4 s retries.
A separate watchdog (`hooks/useStaleSessionRecovery.ts`, 120 s threshold, keyed off
`trackSessionActivity` at `App.tsx:981`) recovers sessions stuck in `isProcessing`.

### 5.4 Atoms inventory (22 files, 3,099 total lines; **109 atom definitions**)

Counts are generic-aware `rg -o` matches over `atoms/`.

| File | Lines | `atom(` | `atomFamily(` | `atomWithStorage(` | Key exports |
|---|---|---|---|---|---|
| `atoms/sessions.ts` | **828** | 24 (2 private) | **2** | 0 | `sessionAtomFamily:148`, `backgroundTasksAtomFamily:813`, `sessionMetaMapAtom:157`, `sessionIdsAtom:162`, `loadedSessionsAtom:168`, `pinSessionCacheAtom:174`, `pruneSessionCacheAtom:182`, `activeSessionIdAtom:229`, `updateSessionAtom:243`, `updateSessionMetaAtom:275`, `replaceLoadedSessionAtom:296`, `appendMessageAtom:322`, `updateStreamingContentAtom:341`, `initializeSessionsAtom:366`, `refreshSessionsMetadataAtom:419`, `addSessionAtom:491`, `removeSessionAtom:518`, `syncSessionsToAtomsAtom:566`, `ensureSessionMessagesLoadedAtom:746`, `forceSessionMessagesReloadAtom:757`, `windowWorkspaceIdAtom:822`, `sendToWorkspaceAtom:828` |
| `atoms/workbench.ts` | 720 | **30** | 0 | 0 | surface model: `primarySurfaceAtom:232`, `foregroundSessionIdsAtom:237`, `workbenchStateAtom:239`, `sessionWorkbenchPresentationAtom:248`, `navigatorRevealRequestAtom:251`, `focusedSurfaceAtom:253`; derived `activeWorkbenchItemAtom:255`, `renderedWorkbenchItemAtom:261`, `workbenchFullWidthAtom:267`, `renderedSurfaceEntriesAtom:272`, `renderedSurfaceCountAtom:314`, `focusedSurfaceEntryIdAtom:316`, `primarySessionIdAtom:355`, `visibleSessionIdsAtom:359`, `foregroundSessionCountAtom:365`; actions `addForegroundSessionAtom:372`, `activateForegroundSessionAtom:389`, `removeForegroundSessionAtom:402`, `focusNextSurfaceAtom:415`, `focusPreviousSurfaceAtom:432`, `setPrimarySurfaceRouteAtom:449`, `openWorkbenchItemAtom:499`, `activateWorkbenchItemAtom:526`, `setWorkbenchItemBindingAtom:540`, `closeWorkbenchItemAtom:555`, `collapseWorkbenchAtom:581`, `toggleWorkbenchAtom:592`, `setCompanionPrimaryWidthAtom:607`, `setExpandedWorkbenchItemAtom:618`, `hydrateSurfaceStateAtom:637` |
| `atoms/browser-pane.ts` | 115 | 9 | 0 | 0 | `browserInstancesMapAtom:12`, `browserInstancesAtom:15`, `browserInstanceCountAtom:20`, `activeBrowserInstanceIdAtom:58`, `removedBrowserInstanceIdsAtom:61`, `activeBrowserInstanceAtom:64`, `updateBrowserInstanceAtom:71`, `removeBrowserInstanceAtom:86`, `setBrowserInstancesAtom:100` |
| `atoms/content-panel-ui.ts` | 66 | 8 | 0 | 0 | `filesPanelViewAtom:15`, `workbenchFocusBySessionAtom:18`, `updateWorkbenchFocusAtom:21`, `clearWorkbenchFocusAtom:32`, `chatFocusRequestAtom:47`, `changedFilesSelectedKeyBySessionAtom:50`, `filesPanelFocusRequestAtom:63`, `previewPanelSelectedKeyBySessionAtom:66` |
| `atoms/kanban.ts` | 62 | 8 | 0 | **3** | `kanbanProjectFilterAtom:20`, `workItemSearchAtom:23`, `workItemSortAtom:24`, `workItemStatusFilterAtom:28`, `workItemScheduledFilterAtom:29`, `workItemSelectionAtom:30`, `workItemViewWorkspaceAtom:31`, `kanbanEditorTargetAtom:39`, `kanbanColumnColorsAtom:46`, `kanbanLivePulseAtom:52`, `kanbanColumnStatusAtom:59` (last three via `atomWithStorage`) |
| `atoms/messaging.ts` | 78 | 4 | 0 | 0 | `messagingBindingsAtom:30`, `messagingBindingsBySessionAtom:32`, `setMessagingBindingsAtom:46`, `messagingDialogAtom:78` |
| `atoms/background-finished.ts` | 69 | 3 | 0 | **1** | `showBackgroundFinishedChipAtom:25` (storage), `backgroundFinishedAtom:40`, `pushBackgroundFinishedAtom:46`, `dismissBackgroundFinishedAtom:60` |
| `atoms/preview.ts` | 60 | 4 | 0 | 0 | `previewStateBySessionAtom:22`, `previewEntriesForSessionAtom:30`, `addPreviewEntryAtom:35`, `removePreviewEntryAtom:49` |
| `atoms/active-session.ts` | 34 | 2 | 0 | 0 | `lastActiveSessionIdAtom:23`, `activeSessionIdAtom:32` |
| `atoms/pages.ts` 23 · `atoms/overlay.ts` 14 · `atoms/automations.ts` 16 · `atoms/skills.ts` 16 · `atoms/sources.ts` 16 · `atoms/projects.ts` 10 · `atoms/personal-profile.ts` 5 · `atoms/workspace-avatar-colors.ts` 18 (1 storage) | — | 2/2/1/1/1/1/1/0 | 0 | 1 | entity caches loaded over RPC |
| tests (`atoms/__tests__/*`) | 949 | — | — | — | `workbench.test.ts` (353), `sessions.isolated.ts` (332), `browser-pane.test.ts` (120), `surface-content-types.test.ts` (82), `active-session.test.ts` (62) |

**⚠️ Naming collision to preserve:** two different modules export `activeSessionIdAtom` —
`atoms/sessions.ts:229` (plain) and `atoms/active-session.ts:32` (derived from
`workbenchActiveSessionIdAtom`).

**Split by concern:** transcript/session data = `sessionAtomFamily` (full `Session` incl.
`messages[]`), `backgroundTasksAtomFamily`, `sessionMetaMapAtom` (lightweight `SessionMeta`, no
messages), `sessionIdsAtom`, `loadedSessionsAtom`, `windowWorkspaceIdAtom`, `sendToWorkspaceAtom`,
`activeSessionIdAtom` ×2. Workbench/surface UI = all 30 in `workbench.ts` + `overlay.ts` +
`content-panel-ui.ts` + `preview.ts` + `browser-pane.ts`. Persisted UI prefs (`atomWithStorage` → `localStorage`, 5 total) = `showBackgroundFinishedChipAtom`,
`kanbanColumnColorsAtom`, `kanbanLivePulseAtom`, `kanbanColumnStatusAtom`,
`workspaceAvatarColorsAtom`.

**Single store:** `<JotaiProvider>` with **no `store` prop** (`main.tsx:125`) ⇒ the jotai default
store; `getDefaultStore()` is used only as a *type*. `useAtomCallback` / `useHydrateAtoms`: **0**.

### 5.5 Contexts (16 files, 3,488 total lines)

| File | Lines | Provides |
|---|---|---|
| `contexts/NavigationContext.tsx` | **1,283** | Global typed-route `navigate()`, `NavigationState`, URL-as-source-of-truth history (`pushState`/`popstate`), per-workspace URL restore, session auto-select + auto-delete-empty, surface/primary arbitration, per-workspace `localStorage` |
| `context/ThemeContext.tsx` | 607 | Resolved theme tokens + CSS var emission, mode/font, Shiki theme, per-workspace colour theme, preset/user theme loading, title-bar overlay. Two-tier persistence: `config.json` authoritative, `localStorage` a startup fast path (`:228`) |
| `context/AppShellContext.tsx` | 291 | ~70-field bag: workspace, `llmConnections`, `pendingPermissions`/`pendingCredentials` maps, `sessionOptions: Map<id, SessionOptions>`, session callbacks, draft accessors, permission/credential responders, source/skill/label lists. Helpers `useSession(id):216`, `useActiveWorkspace:224`, `usePendingPermission:233`, `usePendingCredential:241`, `useSessionOptionsFor:254` |
| `contexts/surface-url.ts` | 189 | `SURFACE_URL_VERSION='2'`, `parseSurfaceUrlParams` / `writeSurfaceUrlParams`, `legacySidebarToWorkbenchRoute` |
| `context/FocusContext.tsx` | 171 | 3 focus zones (`sidebar` \| `navigator` \| `chat`) + `FocusIntent` (`keyboard` \| `click` \| `programmatic`); feeds `actions/keybinding-context` |
| `context/DismissibleLayerContext.tsx` | 144 | Layer registry for Esc / back / Cmd+W dismissal ordering; bridged to non-React code via `lib/dismissible-layer-bridge` |
| `context/ModalContext.tsx` | 111 | Priority-ordered modal registry (topmost closes first on Cmd+W) |
| `context/EscapeInterruptContext.tsx` | 96 | Double-Esc interrupt (1st shows overlay, 2nd within 1 s interrupts the turn) |
| `context/SessionListContext.tsx` | 55 | Pure value context: session action callbacks + projects/labels/statuses |
| `contexts/navigation-history.ts` | 45 | `buildSemanticHistoryKey()`, `canRunInitialRestore()` |
| `contexts/navigation-reconcile.ts` | 31 | `normalizePanelRouteForReconcile()` |
| `context/StoplightContext.tsx` | 25 | macOS traffic-light left-padding compensation |
| tests | 440 | `surface-url.test.ts` (203), `navigation-reconcile.test.ts` (114), `navigation-history-key.test.ts` (58), `dismissible-layer-context.test.ts` (65) |

Provider nesting (`App.tsx:2121-2201`): `PlatformProvider → ShikiThemeProvider →
ActionRegistryProvider → FocusProvider → DismissibleLayerProvider → ModalProvider → TooltipProvider →
NavigationProvider → AppShell` (which holds `AppShellContext` + `SessionListContext`). Above it,
`main.tsx:122-131`: `StrictMode → Sentry.ErrorBoundary → JotaiProvider → MotionConfig → Root →
ThemeProvider`.

### 5.6 Renderer persistence

| Mechanism | Used? | Count | Detail |
|---|---|---|---|
| `localStorage` | **YES** | 56 occurrences / 16 files; 49 raw occurrences outside the playground, across 27 files | **Everything funnels through `lib/local-storage.ts` (133 lines)**: prefix `craft-`, **40 keys** in the `KEYS` registry (`:12-68`), `get:85`, `set:98`, `remove:109`, `getRaw:116`, `setRaw:123`, `getKeyString:131`. Raw `localStorage` outside that module exists only in `playground/*` and `main.tsx:34` (`i18nextLng`). |
| `sessionStorage` | **NO** | 0 | |
| `indexedDB` | **NO** | 0 | |
| RPC `readPreferences` / `writePreferences` | YES | 11 occurrences / 4 files | → `~/.craft-agent/preferences.json` (JSON-validated); call sites `PreferencesPage.tsx:109,143,169`, `SidebarProfile.tsx`, `lib/use-diff-viewer-settings.ts` |
| RPC `getDraft` / `setDraft` / `deleteDraft` / `getAllDrafts` | YES | 46 occurrences / 11 files | → `CONFIG_DIR/drafts.json`; renderer side `App.tsx:802` (all drafts at startup, into a ref — no re-render), `:1513`, `:1523`, `:1533`, `:1559-1568` (debounced save) |
| Theme preferences | hybrid | — | `config.json` authoritative + `localStorage` startup fast path |

**What lives in `localStorage`:** sidebar/navigator visibility & widths, sidebar mode, list/label/view
filters, expanded folders, collapsed items/groups, chat grouping mode, focus mode, session-files
expanded, theme fast path, panel layouts (`panelLayout:<key>`), workspace tabs, recent working
directories, TurnCard expansion (bounded LRU ≤ 100 sessions), last selected session, last settings
subpage, `showConnectionIcons`, `projectColorTreatment`, What's-New version, `workspaceUrl` +
`hiddenPanels` (per workspace slug), the 5 `atomWithStorage` keys, and `i18nextLng`.

Everything durable (sessions, transcripts, drafts, preferences, theme config) is behind RPC.

### 5.7 Hooks inventory (45 files, 6,346 total lines)

| Hook | Lines | Purpose |
|---|---|---|
| `useOnboarding.ts` | **947** | Onboarding wizard state machine (Welcome → Git Bash → API setup → credentials → Complete) |
| `useSessionSearch.ts` | **544** | Session filtering + fuzzy search, ripgrep content search (debounced, cancellable, `:313-328`), date grouping, collapsed-group pagination |
| `useEntityListInteractions.ts` | 338 | Composes `useRovingTabIndex` + `useMultiSelect` + optional search filtering; returns spreadable props |
| `keyboard/useRovingTabIndex.ts` | 295 | Roving-tabindex list keyboard nav (arrow/home/end/wrap, Enter/Space, scroll-into-view) |
| `useNotifications.ts` | 244 | OS notifications + **Canvas-drawn dock badge**; suppresses when window focused; respects hidden sessions |
| `useMultiSelect.ts` | 231 | Pure multi-select state functions: shift-range, cmd/ctrl toggle, keyboard extend |
| `useAutomations.ts` | 219 | Automation state: load from disk, live updates, test/toggle/duplicate/delete |
| `useWorkspaceIcon.ts` | 211 | Workspace icons as data URLs (CSP blocks `file://`), module-level cache |
| `useSessionMenuActions.ts` | 208 | Session context-menu side effects (share, refresh title, copy path, reveal, labels) + optimistic label state |
| `useDynamicStack.ts` | 185 | Callback ref computing per-badge `marginLeft` for equal-strip badge stacking (ResizeObserver + MutationObserver) |
| `useUpdateChecker.ts` | 156 | Auto-update: availability broadcast, download progress, install, per-version dismissal |
| `useTurnCardExpansion.ts` | 143 | Per-session TurnCard expansion, one localStorage key, bounded LRU (≤ 100) |
| `useResizeGradient.ts` | 120 | Cursor-following vertical gradient for a resize indicator (edge-clamped) |
| `useViews.ts` | 118 | Loads view configs, compiles Filtrex expressions once, returns a session evaluator |
| `useArtifacts.ts` 106 · `useEntitySelection.ts` 106 (generic atom-backed selection factory — the only `atom(` outside `atoms/`) · `useCalendarEntries.ts` 103 · `useStaleSessionRecovery.ts` 98 · `keyboard/useFocusZone.ts` 96 · `useBackgroundTasks.ts` 89 · `useWorkItems.ts` 89 · `useSessionActions.ts` 87 · `useHorizontalResizeGradient.ts` 87 · `useLabels.ts` 84 · `useWorkItemViewState.ts` 76 · `useStatuses.ts` 78 · `useDirectoryPicker.ts` 73 · `useTransportConnectionState.ts` 66 · `usePages.ts` 64 · `useWindowCloseHandler.ts` 63 · `useProjects.ts` 58 · `useTheme.ts` 46 · `useProjectColorTreatment.ts` 46 · `useKanbanColumnColors.ts` 50 · `useInView.ts` 47 · `useSessionOptions.ts` 49 · `useSession.ts` 44 · `useContainerWidth.ts` 27 · `useLinkInterceptor.ts` 26 · `useResizablePanels.ts` 19 · `useWorkItemEvents.ts` 33 · `keyboard/index.ts` 2 | | |
| tests | 575 | `useMultiSelect.test.ts` (335), `useOnboarding.test.ts` (171), `useSessionSearch.test.ts` (69) |

`actions/` (769 total): `definitions.ts` 258 (action catalog + default hotkeys + when-clauses),
`registry.tsx` 196 (`ActionRegistryProvider`; global keydown → `evaluateWhen`),
`keybinding-context.ts` 144 (**no React state, no re-renders** — the context is computed at keydown
from the DOM plus module refs), `types.ts` 25, `useAction.ts` 41, `useHotkeyLabel.ts` 34,
`index.ts` 6, `keybinding-context.test.ts` 65.

---

## 6. Native-feature usage requested from the renderer (main-process surface)

The renderer reaches the OS **only** through the 370-method bridge. Behind it: **24 raw `ipcMain`
registrations** — verified as **18 `ipcMain.handle` + 6 `ipcMain.on`** — plus the WebSocket RPC
server (`72 server.handle` registrations inside `main/handlers/`).

### 6.1 `ipcMain` registrations (24)

| # | Channel | Kind | File:line |
|---|---|---|---|
| 1 | `__get-web-contents-id` | `on` (sync) | `main/index.ts:539` |
| 2 | `__get-workspace-id` | `on` (sync) | `main/index.ts:542` |
| 3 | `__transport:status` | `on` | `main/index.ts:548` |
| 4 | `__client:validatePath` | `handle` | `main/index.ts:587` |
| 5 | `__dialog:showMessageBox` | `handle` | `main/index.ts:600` |
| 6 | `__dialog:showOpenDialog` | `handle` | `main/index.ts:607` |
| 7 | `workspace:remove` | `handle` | `main/index.ts:857` |
| 8 | `server:invokeOnServer` | `handle` | `main/index.ts:871` |
| 9 | `server:sendResourcesToRemote` | `handle` | `main/index.ts:895` |
| 10 | `session:transferToWorkspace` | `handle` | `main/index.ts:932` |
| 11 | `app:relaunch` | `handle` | `main/index.ts:1054` |
| 12 | `i18n:changeLanguage` | `handle` | `main/index.ts:1066` |
| 13 | `__get-ws-port` | `on` (sync) | `main/index.ts:1089` |
| 14 | `__get-ws-token` | `on` (sync) | `main/index.ts:1094` |
| 15 | `__get-workspace-remote-config` | `on` (sync) | `main/index.ts:1098` |
| 16–23 | `browser-toolbar:{navigate, go-back, go-forward, reload, stop, menu-geometry, hide, destroy}` | `handle` | `main/browser-pane-manager.ts:2370, 2375, 2380, 2385, 2390, 2395, 2419, 2425` |
| 24 | `__browser:invoke` | `handle` | `main/browser-pane-manager.ts:2446` |

Gating: registrations 1–6 are unconditional; 7–15 are inside `if (!isClientOnly)` (`index.ts:615`),
so in `CRAFT_SERVER_URL` thin-client mode only **9** `ipcMain` handlers exist. Browser-toolbar IPC is
always registered (`index.ts:522-523`).

### 6.2 Native / OS capability table

| Capability | Electron API | Main file:line | Renderer-visible channel(s) | GPUI port |
|---|---|---|---|---|
| File-open dialog | `dialog.showOpenDialog` | `main/index.ts:607` | `file:openDialog` → client capability `client:openFileDialog` → `bootstrap.ts:194` | ✅ native picker (rfd) |
| Folder picker | `showOpenDialog({properties:['openDirectory']})` | `main/index.ts:611` | `dialog:openFolder` (LOCAL_ONLY) | ✅ |
| Save dialog | — | — | — | **absent** |
| Open external URL | `shell.openExternal` | `window-manager.ts:160`, `platform.ts:29`, `handlers/system.ts:225`, `menu.ts:237`, `browser-pane-manager.ts:2219/2232` | `shell:openUrl` | ✅ (`open` crate) |
| Open path | `shell.openPath` | `platform.ts:30`, `bootstrap.ts:181` | `shell:openFile` | ✅ |
| Reveal in folder | `shell.showItemInFolder` | `platform.ts:31`, `bootstrap.ts:187` | `shell:showInFolder` | ✅ (explorer /select) |
| Native context menu (dev) | `Menu.buildFromTemplate().popup` | `window-manager.ts:308` | none | ⚠️ |
| Tray icon | — | — | — | **absent** |
| Global shortcuts | — | — | — | **absent** (accelerators are declarative `Menu` items with `registerAccelerator:false`, `menu.ts:109/115/242/287`) |
| Application menu (native) | `Menu.buildFromTemplate` / `setApplicationMenu` | `menu.ts:249/250` (null on win/linux `:55`) | pushes `menu:newChat` / `openSettings` / `keyboardShortcuts` | ✅ menu API |
| OS notification | `new Notification`, `isSupported`, `show` | `notifications.ts:10/60/65/79` (wired `index.ts:517`) | `notification:show`, `notification:getEnabled/setEnabled`, click→`notification:navigate` (`:113/118`) | ✅ |
| Auto-update | `electron-updater` `autoUpdater.{autoDownload, autoInstallOnAppQuit, checkForUpdates, quitAndInstall}` | `auto-update.ts:17/158/161/369/461`; launch `index.ts:1291` | `update:check/getInfo/install/dismiss/getDismissed` (`handlers/system.ts:272-295`) + pushes `update:available`, `update:downloadProgress` | ➖ needs a new updater |
| Deep links / protocol handler | `setAsDefaultProtocolClient`, `app.on('open-url')`, `requestSingleInstanceLock`, `second-instance` | `index.ts:240/244/327/342/346` | `deeplink:navigate`, internal `shell:openUrl` routing (`handlers/system.ts:215-222`) | ✅ registrar + single-instance |
| Window min/max/close/restore | `minimize/maximize/unmaximize/close/destroy/restore` | `handlers/system.ts:310-326`, `window-manager.ts:593/604/635/282/692` | `menu:minimize`, `menu:maximize`, `window:close/confirmClose/cancelClose` + `window:closeRequested` | ✅ |
| macOS traffic lights | `setWindowButtonVisibility`, `setWindowButtonPosition`, ctor `trafficLightPosition` | `window-manager.ts:763/768/773`, ctor `:247` | `window:setTrafficLights` (`handlers/workspace.ts:140`) | ⚠️ platform-specific |
| Windows title-bar overlay | `setTitleBarOverlay` + ctor option | `window-manager.ts:783/800`, ctor `:255-259` | `window:setTitleBarOverlay` (`handlers/workspace.ts:147`) | ⚠️ |
| Fullscreen | — | — | — | **absent** (only "focus mode" in-app DOM overlays) |
| Window chrome / material | `vibrancy`, `visualEffectState`, `backgroundMaterial` mica/acrylic, `frame`, `icon` | `window-manager.ts:237-284`, probe `:22` | — | ⚠️ per-OS |
| Window focus state | `getFocusedWindow`, `focus`/`blur` | `window-manager.ts:434-439`, `notifications.ts:266` | `window:getFocusState`, push `window:focusState` | ✅ |
| Screen geometry | `screen.getDisplayMatching`, `getCursorScreenPoint` | `window-manager.ts:224-225` | main-side only | ✅ |
| Power / keep-awake | `powerSaveBlocker.start('prevent-display-sleep')/stop/isStarted` | `power-manager.ts:9/42/46/94/103`, init `index.ts:1236` | `power:setKeepAwake` (`handlers/settings.ts:16`), `power:getKeepAwake` | ✅ |
| Printing | — | — | — | **absent** |
| Screen capture | `desktopCapturer` | — | — | **absent** |
| Page capture (thumbnails) | `webContents.capturePage(rect?, {stayHidden,stayAwake})` | `browser-pane-manager.ts:1446-1447`, `page-thumbnailer.ts:161` | `browser-pane:screenshot` (`handlers/browser.ts:148`) | ➖ |
| Clipboard (main-side) | none — CDP `navigator.clipboard` | `browser-cdp.ts:762/770` | via `__browser:invoke` `setClipboard`/`getClipboard` | ✅ |
| Clipboard (renderer-side) | `navigator.clipboard` ×30 | renderer/UI | direct | ✅ |
| Drag-out of files | — | — | — | **absent** (`startDrag` nowhere); inbound only via `webUtils.getPathForFile` (`bootstrap.ts:466-472`) |
| Theme (system) | `nativeTheme.shouldUseDarkColors` + `on('updated')` | `index.ts:531`, `platform.ts:33`, `window-manager.ts:431/522/235`, `browser-pane-manager.ts:390/1946` | `theme:getSystemPreference`, push `theme:systemChanged` | ✅ |
| Dock/taskbar badge | `app.dock.setIcon/setBadge`, `app.setBadgeCount`, `nativeImage`, `setOverlayIcon` | `index.ts:483/485/494`, `notifications.ts:183/223/236/239/246/290` | `badge:refresh`, `badge:setIcon`, pushes `badge:draw`, `badge:draw-windows` | ⚠️ — **the badge bitmap is rasterised on a canvas in the renderer** (`hooks/useNotifications.ts:27,85`) and pushed back to main |
| HTTP(S) proxy | `session.setProxy`, undici `setGlobalDispatcher`/`ProxyAgent` | `network-proxy.ts:122/102/119`, applied `index.ts:249/467` | `settings:setNetworkProxy` (`handlers/settings.ts:26`), `settings:getNetworkProxy` | ✅ (reqwest proxy) |
| Certificate handling | `app.on('certificate-error')`, `readFileSync` TLS cert/key | `index.ts:307-318`, `:672-682` | via `remote:testConnection` / `allowInsecureTls` | ⚠️ |
| Terminal PTY | `node-pty` `spawn`/`IPty` | `terminal-manager.ts:6/13-25/85-91/97-121` | `terminal:{create,getForWorkspace,write,resize,destroy,destroyForWorkspace}` (`handlers/terminal.ts:10-15`) + pushes `terminal:data`, `terminal:exit` | ⚠️ portable-pty |
| Embedded browser | `BrowserWindow` + **3× `BrowserView`**, `session.fromPartition('persist:browser-pane')` | `browser-pane-manager.ts:392/410/421/436/506-509/385` | `browserPane.*` (17 handles, `handlers/browser.ts:30-182`) + `__browser:invoke` + 3 pushes | ❌ **no native equivalent** — needs an embedded web engine |
| CDP debugging | `webContents.debugger.attach('1.3')` / `sendCommand` / `detach` | `browser-cdp.ts:113/160/151/126` | same capability surface | ❌ |
| `thumbnail://` custom protocol | `protocol.registerSchemesAsPrivileged` + `protocol.handle` + `nativeImage.createThumbnailFromPath` | `thumbnail-protocol.ts:127/155/93/108`; registered `index.ts:324/463` | renderer `<img src="thumbnail://thumb/<enc>">` | ❌ |
| Browser permissions | `ses.setPermissionCheckHandler` / `setPermissionRequestHandler` | `browser-pane-manager.ts:3318/3329` | indirect | ❌ |
| Browser downloads | `ses.on('will-download')`, `item.setSavePath`, `app.getPath('downloads')` | `browser-pane-manager.ts:3240/3171/3160-3182` | capability `getDownloads` | ❌ |
| i18n for native menus | `i18n.t` in `Menu` template + `changeAppLanguage` | `menu.ts:67-285`, persistence `index.ts:70-73`, rebuild `:1085-1086` | `i18n:changeLanguage` (`index.ts:1066`) | ✅ |
| Crash reporting | `@sentry/electron` `init`/`setUser`/`captureException`/`beforeSend` scrub | `index.ts:28/79/535/708/1250-1254/1474/1479` | none (renderer inits separately, `main.tsx`) | ⚠️ |
| OS keychain | `safeStorage.{isEncryptionAvailable, encryptString, decryptString}` | `credential-key-provider.ts:14/35/48/58`; installed `index.ts:427` | none | ✅ (keyring) |
| Shell env hydration | `spawnSync(user shell)` → `process.env` | `shell-env.ts:28/40/74/107`, called `index.ts:3-4` | none | ✅ |
| git / git-bash child process | `execSync` | `handlers/system.ts:110/155`, `terminal-manager.ts:51`, `index.ts:161` | `git:getBranch`, `gitbash:check`, `gitbash:browse`, `gitbash:setPath` | ✅ |
| Logging | `electron-log` `log.initialize()` | `logger.ts:1`, `index.ts:126` | none | ⚠️ |
| App lifecycle | `app.setName/quit/exit/relaunch`, `window-all-closed`, `before-quit`, `activate` | `index.ts:233/1334/1338/1466/1059/1060/1287/1288/1423/1316` | `app:relaunch` (`index.ts:1054`) | ✅ |

**Explicitly absent capabilities** (verified zero occurrences in `apps/` and `packages/`):
`Tray`, `globalShortcut`, `desktopCapturer`, Electron `clipboard` module, `startDrag`,
`showSaveDialog`, `powerMonitor`, `setCertificateVerifyProc`, `setThumbarButtons`/`setUserTasks`,
`setLoginItemSettings`, `systemPreferences`, `shell.trashItem`, printing / `printToPDF`,
`setFullScreen`.

### 6.3 RPC channel surface (the 401-channel contract)

| Namespace | Channels | Namespace | Channels |
|---|---|---|---|
| messaging | 45 | statuses | 3 |
| sessions | 33 | system | 3 |
| pages | 23 | shell | 3 |
| browserPane | 20 | auth | 3 |
| menu | 19 | gitbash | 3 |
| theme | 18 | preferences | 2 |
| window | 13 | caching | 2 |
| artifacts | 13 | tools | 2 |
| tasks | 12 | appearance | 2 |
| llmConnections | 11 | fs | 2 |
| file | 10 | views | 2 |
| projects | 9 | resources | 2 |
| automations | 9 | permissions | 2 |
| settings | 9 | power | 2 |
| server | 8 | releaseNotes | 2 |
| terminal | 8 | deeplink | 1 |
| onboarding | 8 | logo | 1 |
| sources | 8 | toolIcons | 1 |
| update | 7 | debug | 1 |
| skills | 6 | dialog | 1 |
| workItems | 6 | credentials | 1 |
| input | 6 | git | 1 |
| chatgpt | 5 | remote | 1 |
| copilot | 5 | workspaces | 4 |
| pi | 5 | labels | 4 |
| workspace | 5 | drafts | 4 |
| calendar | 5 | transfer | 4 |
| — | — | oauth | 4 |
| — | — | rtk | 4 |
| — | — | badge | 4 |
| — | — | notification | 4 |
| **TOTAL** | **401 across 58 namespaces** | | |

---

## 7. Quantification for a GPUI rewrite

### 7.1 LOC by UI area (measured; **total lines**, playground excluded)

**Authoritative corpus totals** (measured with `(Get-Content f).Count`, i.e. including blank lines):

| Corpus | Files | Total lines |
|---|---|---|
| `apps/electron/src/renderer` — everything | 619 | 120,523 |
| `apps/electron/src/renderer` — **production only** (excludes `playground/` and 65 test files) | **493** | **92,068** |
| `apps/electron/src/renderer/playground` — **dev-only, droppable** | 61 | 21,172 |
| renderer tests (`__tests__/`, `*.test.*`, `*.isolated.*`) | 65 | 7,283 |
| `packages/ui/src` — everything | 204 | 35,391 |
| `packages/ui/src` — **production only** | **163** | **30,355** |
| `packages/ui/src` tests | 41 | 5,036 |
| **COMBINED PRODUCTION UI SURFACE** | **656** | **122,423** |
| Combined incl. playground + tests (what exists today) | 884 | 166,914 |

**Per-area breakdown** (each row measured independently; `app-shell` root row excludes its own
`input/` and `kanban/` subdirectories to avoid double counting):

| Area | Files | Total lines |
|---|---|---|
| App shell root: layout, sidebar, top bar, session list, workbench tabs, resize sashes | 58 | **17,720** |
| Composer / input zone (`app-shell/input`) | 32 | **6,314** |
| Kanban / calendar / task editor (`app-shell/kanban`) | 25 | 6,060 |
| `app-shell/__tests__` | 5 | 340 |
| UI primitives (renderer `components/ui`) | 84 | **12,047** |
| UI kit (`packages/ui/src/components/ui`) | 16 | 3,244 |
| Chat / turn cards (`packages/ui/src/components/chat`) | 22 | **8,149** |
| Markdown (`packages/ui/src/components/markdown` 9,841 + renderer `components/markdown` 175) | 55 | **10,016** |
| Trajectory / Run views (`packages/ui/src/components/trajectory` 4,705 + `content-panels/TrajectoryPanel.tsx`) | 26 | **4,909** |
| Overlays & previews (`packages/ui/src/components/overlay` 4,259 + `content-panels` 1,628 + `preview` 123) | 40 | **6,010** |
| Code / diff viewers (`packages/ui/.../code-viewer` 990 + renderer `components/shiki` 252) | 12 | **1,242** |
| Annotations (`packages/ui/src/components/annotations`) | 27 | 1,969 |
| Terminal (renderer panel 67 + `packages/ui/.../terminal` 389) | 4 | 456 |
| Settings (11 pages + navigator 5,716 + widgets 1,723) | 30 | **7,439** |
| Onboarding | 11 | 1,945 |
| Messaging UI | 17 | 2,353 |
| Automations UI | 17 | 2,656 |
| Page surfaces (sandboxed HTML runtime) | 11 | 2,287 |
| Info / source / skill pages + non-settings routes (`components/info` 14 files/1,693 + 6 non-settings files under `pages/` totalling 2,290) | 20 | 3,983 |
| Projects / work items | 6 | 680 |
| Workspace management | 9 | 1,409 |
| API setup | 6 | 1,169 |
| App menus | 7 | 991 |
| Browser chrome (renderer side only) | 6 | 615 |
| Right sidebar / session files | 3 | 722 |
| Icons (renderer 11/545 + `packages/ui` 5/91) | 16 | 636 |
| Artifacts | 6 | 405 |
| Files viewer | 1 | 77 |
| Root files (`App.tsx` 2,229, `index.css` 1,328, `main.tsx` 132, browser-toolbar/empty-state, …) | 8 | ~4,200 |
| State: `atoms/` | 22 | 3,099 |
| State: `event-processor/` | 15 | 3,671 |
| State: `context/` + `contexts/` | 16 | 3,488 |
| Hooks | 45 | 6,346 |
| `lib/` + `utils/` + `config/` + `actions/` | 63 | 6,370 |

**Sizing rule of thumb (INFERRED):** the rewrite target is ≈ **122k lines** of React/TS UI, of which
≈ **12k** is test-free mechanical translation (i18n, atoms, pure helpers), ≈ **30k** is
framework-shaped rendering that maps 1:1 onto a native widget model, and ≈ **80k** is markup/
styling/interaction code whose cost depends almost entirely on how faithfully the Tailwind + CSS
token system can be reproduced.

Non-UI host code that the renderer depends on and a rewrite must re-implement or reuse:

| Component | LOC | Reuse in Rust? |
|---|---|---|
| `main/browser-pane-manager.ts` | **3,687** | ❌ must be replaced by an embedded web engine |
| `main/browser-cdp.ts` | **1,061** | ❌ |
| `main/index.ts` | **1,480** | partial |
| `main/window-manager.ts` | 806 | partial |
| `main/auto-update.ts` | 515 | ❌ new updater |
| `main/{menu,notifications,deep-link,logger,thumbnail-protocol,network-proxy,power-manager,terminal-manager,shell-env,platform,window-state,window-geometry,page-thumbnailer,page-thumbnail-host,credential-key-provider,chunked-rpc,network-proxy-utils}.ts` | ~3,000 | partial |
| `main/handlers/*` (7 files, 72 `server.handle`) | 888 | ❌ must be replaced by native command handlers |
| `transport/*` (client, routed-client, channel-map, build-api, codec) | ~860 | ✅ port to a Rust WS JSON-RPC client |
| `preload/*` | 527 | obsolete by construction |

### 7.2 Interactive widget types

Counts of *distinct interactive widget kinds* the UI must provide, derived from the primitive
inventory and usage counts.

**Distinct primitive control files:** **84** `.ts`/`.tsx` in `apps/electron/src/renderer/components/ui` — 79 at the top level + 5 under `__tests__/` — plus **14** (13 components + 1 barrel) in `packages/ui/src/components/ui`. Across all of `components/`, **254 of 285** `.tsx` files export a capitalised React component.

Grouped by widget kind (a kind may have several wrapper files):

| Kind | Wrapper files | Usage sites |
|---|---|---|
| Button (incl. icon buttons) | `button.tsx`, `TopBarButton.tsx`, `HeaderIconButton.tsx`, `PanelHeaderCenterButton.tsx`, `action-menu-item.tsx` | ubiquitous |
| Text input | `input.tsx` | — |
| Textarea | `textarea.tsx` | — |
| Rich text / contenteditable editor | `rich-text-input.tsx` (718), `EditPopover.tsx` (1,032), `packages/ui/.../markdown/TiptapMarkdownEditor.tsx` (357) | 2 editor stacks |
| Select / combobox | `select.tsx`, `CompactSourceSelector.tsx`, `CompactWorkingDirectorySelector.tsx`, `SourceSelectorPopover.tsx`, `SkillSelectorPopover.tsx`, `packages/ui/.../ui/FilterableSelectPopover.tsx` | `<Select` ×54 |
| Switch / toggle | `switch.tsx` | — |
| Checkbox / radio | `radio-group-navigation.ts` (radio only) — **no checkbox primitive** | — |
| Slider / progress | **none** | — |
| Tabs / segmented control | `tabs.tsx`, `components/settings/SettingsSegmentedControl.tsx` | — |
| Collapsible / disclosure | `collapsible.tsx`, `packages/ui/.../markdown/CollapsibleSection.tsx` | — |
| Dialog / modal | `dialog.tsx`, `rename-dialog.tsx`, `command.tsx` (`CommandDialog`) | `<Dialog` ×142 |
| Drawer / sheet | `drawer.tsx` → vaul | `<Drawer` ×44 |
| Popover | `popover.tsx`, `label-value-popover.tsx`, `EditPopover.tsx`, `HeaderMenu.tsx`, `packages/ui/.../ui/InlineMenuSurface.ts` | `<Popover` ×63 |
| Dropdown menu | `dropdown-menu.tsx`, `styled-dropdown.tsx`, `packages/ui/.../ui/{SimpleDropdown,StyledDropdown}.tsx`, `menu-context.tsx` | `<DropdownMenu` ×149 |
| Context menu | `context-menu.tsx`, `styled-context-menu.tsx` | `<ContextMenu` ×49 |
| Command / filterable list | `command.tsx`, `slash-command-menu.tsx` (634) | `cmdk` ×5 files |
| Tooltip | `action-tooltip.tsx`, `packages/ui/src/components/tooltip.tsx` | 406 `title=`/tooltip-ish sites |
| Toast | `sonner.tsx` | 373 `toast(` calls |
| Scroll area | `scroll-area.tsx` | — |
| Table (static) | `table.tsx` | — |
| Data table (sortable/selectable) | `data-table.tsx` + `data-table-features.ts` | 5 `@tanstack/react-table` files |
| Calendar / date picker | `calendar.tsx` (react-day-picker) | — |
| Time-grid calendar | `app-shell/kanban/CalendarView.tsx` (864) | custom |
| Colour picker | `color-picker.tsx`, `inline-color-picker-row.tsx` | — |
| Sortable / drag list | `sortable-list.tsx`, kanban board, `CalendarView` | dnd-kit + HTML5 |
| Resize handles / sashes | `resizable.tsx`, `horizontal-resize-handle.tsx`, `gradient-resize-handle.tsx`, `WorkbenchResizeSash.tsx` | — |
| Mentions / tag picker | `mention-menu.tsx` (674), `mention-badge.tsx`, `skill-mention-menu.tsx`, `label-menu.tsx` (414), `label-badge-row.tsx` | — |
| Entity list / row / panel | `entity-list.tsx`, `entity-row.tsx` (442), `entity-panel.tsx`, `entity-list-badge.tsx`, `entity-list-empty.tsx` | shared list abstraction |
| Avatar family | `avatar.tsx`, `avatar-group.tsx`, `workspace-avatar.tsx`, `skill-avatar.tsx`, `source-avatar.tsx` | — |
| Badge family | `badge.tsx`, `metadata-badge.tsx`, `window-header-badge.tsx`, `entity-list-label-badge.tsx` | — |
| Status / icon indicators | `status-icon.tsx`, `session-status-menu.tsx`, `source-status-indicator.tsx`, `connection-icon-utils.ts`, `components/icons/*` | — |
| Empty state | `empty.tsx`, `entity-list-empty.tsx`, `content-panels/PanelEmptyState.tsx` | — |
| Kbd hint | `kbd.tsx` | — |
| Field/label wrapper | `field.tsx`, `label.tsx` | — |
| Fading text / marquee | `fading-text.tsx` | — |
| QR code | `qrcode.react` | 2 |
| Canvas surface | `packages/ui/.../ui/BrowserShader.tsx`, badge rasteriser | 3 canvas sites |
| Terminal emulator | `content-panels/TerminalPanel.tsx` | 1 |
| Embedded browser | `BrowserView` triple + toolbar/empty-state HTML entries | 1 |
| Sandboxed HTML frame | `PageFrame.tsx`, `FilePreviewContent.tsx`, `OfficeFilePreview.tsx`, `MarkdownHtmlBlock.tsx`, `HTMLPreviewOverlay.tsx` | 6 |
| PDF viewer | `PdfFilePreview.tsx`, `PDFPreviewOverlay.impl.tsx` | 2 |
| Code editor | `ShikiCodeEditor.tsx` (react-simple-code-editor + shiki) | 1 |
| Diff viewer | `ShikiDiffViewer`, `UnifiedDiffViewer`, `MultiDiffPreviewOverlay`, `MarkdownDiffBlock` | 4 |
| Diagram renderer | `MarkdownMermaidBlock.tsx`, `MermaidPreviewOverlay.tsx` | 2 |
| Math renderer | `MarkdownLatexBlock.tsx`, katex | 2 |

**Distinct interactive widget kinds: ≈ 40** (plus 5 non-interactive presentation families).

### 7.3 Rewrite-difficulty summary (INFERRED)

Ranked by expected GPUI cost:

| Rank | Area | Why |
|---|---|---|
| 1 | **Embedded browser panel** (`BrowserView` ×3 + CDP + downloads/permissions + `thumbnail://`) | ~4,700 lines of main-process Chromium orchestration with **no native Rust GUI equivalent**; requires embedding CEF/WRY/WebView2 or dropping the feature |
| 2 | **Terminal panel** | xterm.js + node-pty; needs a Rust terminal emulator (e.g. alacritty_terminal) or an embedded terminal widget |
| 3 | **Rich markdown + tiptap editor stack** (~10,000 LOC in `packages/ui/markdown`) | react-markdown/remark/rehype/katex/shiki/mermaid/tiptap/ProseMirror: a browser-shaped document model with imperative NodeViews |
| 4 | **Tailwind class surface (~6,041 `className=` sites) + 265 CSS custom properties + 201 `color-mix()` + container queries + `backdrop-filter`** | No native equivalent; must be re-expressed in the target layout/style model |
| 5 | **Pervasive DOM measurement** (30 `ResizeObserver`, 38+20 `rAF`, 37+20 `getBoundingClientRect`, 73 offset/scroll reads) | The UI is reactive to *measured* geometry; GPUI needs an equivalent layout-observation model |
| 6 | **Overlay/annotation geometry engine** (`packages/ui/annotations` 1,969 + overlay 4,259) | Selection ranges, hit-testing, anchored islands, follow-up state machines |
| 7 | **Chat transcript streaming + scroll ritual** (`TurnCard.tsx` 3,047 + `ChatDisplay.tsx` 2,126) | Block-cached streaming markdown, stick-to-bottom, jump-to-turn by coordinate |
| 8 | **PDF / Office / image preview** | pdfjs canvas + text layer; office preview relies on an `<iframe srcDoc>` |
| 9 | **i18n** (2,238 keys × 7 locales, 2,322 `t()` sites) | Mechanical but large |
| 10 | **State layer** (~10,250 LOC: atoms + event-processor + contexts) | 45-event pure reducer + jotai graph — genuinely portable; this is the *cheap* part |
| 11 | **Transport** | Replace `ws` + Electron IPC with a Rust WS JSON-RPC client; 369 of 370 bridge methods already ride the socket |

### 7.4 Largest single files (rewrite hot-spots)

True LOC (`(Get-Content f).Count`).

| # | File | LOC | # | File | LOC |
|---|---|---|---|---|---|
| 1 | `components/app-shell/AppShell.tsx` | **4,044** | 14 | `kanban/KanbanBoardContainer.tsx` | 647 |
| 2 | `components/app-shell/input/FreeFormInput.tsx` | **2,508** | 15 | `right-sidebar/SessionFilesSection.tsx` | 627 |
| 3 | `components/app-shell/ChatDisplay.tsx` | **2,313** | 16 | `app-shell/LeftSidebar.tsx` | 595 |
| 4 | `kanban/TaskEditor.tsx` | 1,350 | 17 | `kanban/TaskTile.tsx` | 541 |
| 5 | `components/ui/EditPopover.tsx` | 1,117 | 18 | `input/CompactModelSelector.tsx` | 534 |
| 6 | `kanban/CalendarView.tsx` | 910 | 19 | `app-shell/ActiveOptionBadges.tsx` | 526 |
| 7 | `components/apisetup/ApiKeyInput.tsx` | 876 | 20 | `app-shell/CompactSessionListFilter.tsx` | 496 |
| 8 | `app-shell/SessionList.tsx` | 870 | 21 | `components/ui/entity-row.tsx` | 472 |
| 9 | `components/ui/rich-text-input.tsx` | 825 | 22 | `components/pages/PageView.tsx` | 470 |
| 10 | `components/ui/mention-menu.tsx` | 753 | 23 | `components/pages/SharePageDialog.tsx` | 464 |
| 11 | `components/ui/slash-command-menu.tsx` | 721 | 24 | `app-shell/MainContentPanel.tsx` | 463 |
| 12 | `app-shell/CompactSessionMenu.tsx` | 683 | 25 | `components/ui/label-menu.tsx` | 460 |
| 13 | `components/chat/AuthRequestCard.tsx` | 675 | — | largest `.ts`: `components/automations/types.ts` | 525 |

`packages/ui` counterparts: `chat/TurnCard.tsx` **3,362**, `chat/turn-utils.ts` 1,280,
`markdown/Markdown.tsx` 700, `ui/Island.tsx` 688, `markdown/MarkdownDatatableBlock.tsx` 659,
`overlay/AnnotatableMarkdownDocument.tsx` 584, `trajectory/trajectory-layout.ts` 466,
`markdown/TiptapSlashMenu.ts` 488, `markdown/TiptapBubbleMenus.tsx` 476.

### 7.5 Dead / unreferenced UI code (safe to drop in a rewrite)

| Item | LOC | Evidence |
|---|---|---|
| `components/ui/command.tsx` (cmdk wrapper) | 144 | 0 importers of `CommandDialog`/`CommandInput`/`CommandList`/`CommandEmpty`/`CommandGroup`/`CommandSeparator`/`CommandItem` outside the file itself |
| `components/ui/resizable.tsx` (react-resizable-panels wrapper) | 49 | 0 importers of `ResizablePanelGroup`/`ResizablePanel`/`ResizableHandle`; no import of the module path |
| `components/ui/gradient-resize-handle.tsx` | 57 | component defined, never imported |
| `components/ui/horizontal-resize-handle.tsx` | 81 | component defined, never imported |
| `main/onboarding.ts` (Electron main) | 171 | 8 `server.handle` registrations, **not** wired by `main/handlers/index.ts` (whose total is 72 handles = 39 system + 17 browser + 8 workspace + 6 terminal + 2 settings, excluding these 8); no importer |
| Root deps with **0 import sites repo-wide** | — | `js-yaml` (5.4.1), `semver` (7.8.5), `@vscode/ripgrep`, `@shikijs/cli`, `@tailwindcss/typography` (only referenced as a Tailwind `@plugin`), `@dnd-kit/helpers`, `prosemirror-model`/`-state`/`-view`/`-transform` and `prosemirror-highlight` (reached only through `@tiptap/pm`), `@tiptap/extension-text-style`, `@tiptap/extension-bubble-menu` (superseded by `@tiptap/react/menus`) |
| `@dnd-kit/dom` | — | playground only (`playground/registry/planner.tsx:3`) |

### 7.6 Stale comments / contract drift found

| Location | Claim | Reality |
|---|---|---|
| `main/window-manager.ts:276` | comment says the browser pane "uses WebContentsView" | It uses the **deprecated `BrowserView`** (`browser-pane-manager.ts:12,410,421,436`) and hard-asserts `addBrowserView` + `setTopBrowserView` exist (`:431-434`). `WebContentsView` appears exactly once repo-wide — in that comment |
| `apps/electron/src/shared/types.ts:82` `BROWSER_TOOLBAR_CHANNELS` | declares `OPEN_MENU: 'browser-toolbar:open-menu'` | No handler for that channel anywhere; the constant is unused and also **missing** `menu-geometry` and the real hide/destroy pair used by `preload/browser-toolbar.ts:11-23` == `browser-pane-manager.ts:121-133` |
| `settings.messaging` description string | "Connect Telegram, WhatsApp, Lark" | **5** platforms are implemented (telegram, whatsapp, lark, wechat, wecom) |
**Cheapest path through the contract:** keep the Bun server + the 401-channel WS protocol untouched,
reimplement only (a) a Rust WS JSON-RPC client matching `CHANNEL_MAP`, (b) ~24 native OS commands to
replace the raw `ipcMain` handlers, and (c) the UI itself in GPUI. The single hard blocker is the
embedded browser; the single largest hidden cost is the Tailwind/CSS visual system.
