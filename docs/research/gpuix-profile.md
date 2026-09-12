# GPUIX — Technical Profile for Migration Feasibility

**Research date:** 2026-09-11/12 (all API responses and fetches captured on that date)
**Subject:** `remorses/gpuix` — https://github.com/remorses/gpuix — docs at https://gpuix.dev/
**Method:** GitHub REST API, raw.githubusercontent.com, gpuix.dev, registry.npmjs.org, crates.io API, plus a
shallow clone of `main` into `docs/research/gpuix-scratch/gpuix` for source-level grep.
**Pinned revision inspected:** `18e695ed0ee8121a7793413ca795e08eda2a13df` (2026-09-10T14:48:47Z, "Size input and
textarea rows from style.fontSize and style.lineHeight.")

---

## 0. Headline verdict

**GPUIX is not a Rust UI framework and not a GPUI fork. It is a React/TypeScript renderer that drives Zed's GPUI
through a napi-rs addon.** The public API is 100% TypeScript/JSX; there is no published Rust crate
(`crates.io/api/v1/crates/gpuix-native` → `{"errors":[{"detail":"crate `gpuix-native` does not exist"}]}`). The
Rust half (`packages/native`, 22,436 LOC) is a closed bridge crate published only as prebuilt `.node` binaries
inside npm packages.

Maturity: **late-alpha / early-beta, single-maintainer, ~3 weeks of usable releases.** Version 0.7.0, first
usable npm publish 2026-08-23, seven releases total, 19 unconsumed changesets on `main` (i.e. `main` is
materially ahead of what npm ships). The author's own docs invent nothing about being WIP but the repo's
`AGENTS.md` "TODO" list, the count of open PRs replacing core primitives, and the "do not open a PR unless you
are remorses or monotykamary" policy are all early-stage signals.

---

## 1. What GPUIX is

### 1.1 Repository metadata

Source: `https://api.github.com/repos/remorses/gpuix`, fetched 2026-09-11.

| Field | Value |
|---|---|
| `full_name` | `remorses/gpuix` |
| `description` | "Node.js & React bindings for Zed's GPUI. Build memory efficient native apps with React and no Electron" |
| `homepage` | `https://gpuix.dev` |
| `license` | Apache-2.0 (`LICENSE`, 11,338 bytes; `packages/react/package.json` and `packages/native/package.json` both set `"license": "Apache-2.0"`) |
| `default_branch` | `main` |
| `created_at` | 2026-01-29T14:52:57Z |
| `pushed_at` | 2026-09-10T14:49:46Z |
| `updated_at` | 2026-09-12T07:20:49Z |
| `stargazers_count` | **1,773** |
| `forks_count` | 51 |
| `subscribers_count` | 9 |
| `open_issues_count` | **30** (this GitHub counter includes pull requests) |
| `size` | 3,512 KB (excluding the `zed` submodule) |
| `topics` | `gpui`, `zed` |
| `language` | `Rust` (GitHub's classifier — but the *public* surface is TypeScript) |
| `has_discussions` | `false` (issues only) |
| `archived` | `false` |

### 1.2 Language mix

`https://api.github.com/repos/remorses/gpuix/languages`:

```
Rust        929,099 bytes
TypeScript  618,406 bytes
JavaScript   25,598 bytes
MDX          16,260 bytes
HTML          1,192 bytes
```

Counting only first-party source trees I inspected in the clone:

- `packages/native/src/**/*.rs` — **22,436 lines**
- `packages/react/src/**/*.{ts,tsx}` — **16,155 lines**

### 1.3 Crate / package names and versions

| Artifact | Name | Version | Registry |
|---|---|---|---|
| Rust crate | `gpuix-native` (edition 2021, `crate-type = ["cdylib","rlib"]`) | 0.7.0 | **not on crates.io** |
| npm | `@gpuix/native` | 0.7.0 | npm |
| npm | `@gpuix/react` | 0.7.0 | npm |
| npm | `@gpuix/cli` | 0.1.1 | npm (published independently) |
| Root workspace | `gpuix` (private, bun workspaces: `cli`, `packages/*`, `examples`, `example-app`) | — | private |

`@gpuix/react` dependencies (published 0.7.0): `@gpuix/native ^0.7.0`, `react-reconciler ^0.31.0`,
`eventsource-parser ^4.1.0`, `zod ^4.4.3`. Peer: `react ^18.0.0 || ^19.0.0`.

### 1.4 Release cadence

`https://registry.npmjs.org/@gpuix/react` → `time`:

| Version | Published (UTC) | Note |
|---|---|---|
| 0.1.0 | 2026-03-02T18:56:07Z | **deprecated on npm:** "Broken: unresolved workspace:^ on @gpuix/native. Use 0.2.0 instead." |
| 0.2.0 | 2026-08-23T09:51:21Z | |
| 0.3.0 | 2026-08-23T13:41:43Z | same day |
| 0.4.0 | 2026-08-23T15:22:09Z | same day |
| 0.5.0 | 2026-08-26T19:21:24Z | browser/WebGPU renderer |
| 0.5.1 | 2026-08-26T19:50:39Z | |
| 0.6.0 | 2026-08-29T15:58:43Z | |
| 0.7.0 | 2026-09-01T13:49:23Z | `dist-tags.latest` |

**Six feature releases in ten days.** The repository predates the first working release by ~7 months
(created January, first non-broken publish 23 August).

### 1.5 Commit activity

Last ten commits from `https://api.github.com/repos/remorses/gpuix/commits?per_page=10` — every one authored by
`remorses` (Tommy D. Rossi, `beats.by.morse@gmail.com`), with some co-authored by "Mateo M. `<hello@mateo.sh>`":

| SHA | Date | Subject |
|---|---|---|
| `18e695e` | 2026-09-10T14:48:47Z | Size input and textarea rows from `style.fontSize` and `style.lineHeight` (issue 63) |
| `f24d270` | 2026-09-10T14:48:37Z | Point `@gpuix/react/floating` at a public barrel, drop `useFocusTrap` from docs |
| `a8141d6` | 2026-09-08T13:42:35Z | Point zed at in-place GPUI image updates (submodule 5f672a20b1 → 81c99f816b) |
| `833d77f` | 2026-09-08T11:48:22Z | Add `onFileDrop` for Finder and OS file drops |
| `7cb458e` | 2026-09-08T10:03:08Z | Speed up PNG encoding in debug native builds |
| `2e77997` | 2026-09-08T10:03:00Z | Keep an element's style when React hides it |
| `e02a607` | 2026-09-08T09:37:02Z | Remove `useFocusTrap` from `@gpuix/react/floating` |
| `eac7181` | 2026-09-07T16:03:17Z | Return `getElementBounds` as `{ x, y, width, height }` |
| `fa53608` | 2026-09-07T16:00:55Z | Parse GitHub Releases in `checkUpdate`; drop `latest.json` |
| `246a160` | 2026-09-07T15:52:09Z | Add `checkUpdate()` on `@gpuix/native` using GPUIX HTTP |

Cadence is multiple commits per day in bursts, all from one person.

**Total commits on `main`: 337** (verified by `git rev-list --count HEAD` after unshallowing the clone in
`docs/research/gpuix-scratch/gpuix`). This cross-checks exactly against the contributor API
(320 + 9 + 7 + 1 = 337).

Commits per month (`git log --format=%ad --date=format:%Y-%m`):

| Month | Commits |
|---|---:|
| 2026-01 | 12 |
| 2026-02 | 4 |
| 2026-03 | 46 |
| 2026-04 | 0 |
| 2026-05 | 1 |
| 2026-06 | 0 |
| 2026-07 | 0 |
| 2026-08 | **233** |
| 2026-09 (to the 10th) | 41 |

**69% of all commits landed in a single month (August 2026)**, with three completely idle months (April, June,
July) between the initial March scaffold and that burst. The repository was effectively dormant for ~4.5 months
and then developed at high intensity.

### 1.6 Contributors

`https://api.github.com/repos/remorses/gpuix/contributors?per_page=100&anon=1`:

| Login | Commits |
|---|---|
| `remorses` | **320** |
| `oxura` | 9 |
| `chrissm79` | 7 |
| `monotykamary` | 1 |

Plus `mateo-m` (author of PRs #50–#53) and "Mateo M." as commit co-author, who do not appear in the
contributor list. `AGENTS.md` states the policy explicitly: *"Unless you are **remorses** or **monotykamary**, do
not open a pull request. Open an issue."*

### 1.7 Production-ready or experimental?

**Experimental / early.** Concrete evidence:

- Version 0.7.0; `@gpuix/cli` still 0.1.1; the 0.1.0 npm release is marked **deprecated as broken**.
- `AGENTS.md` "Current Status → TODO" still lists items that block normal desktop apps (multiple windows, window
  resize/minimize, app-declared menus, Canvas, background syntax highlighting).
- 19 unconsumed `.changeset/*.md` files on `main` — the published 0.7.0 (2026-09-01) is **behind** `main`,
  including for accessibility and `onFileDrop`.
- Open PRs propose *replacing core primitives* (`getNativeWindowHandle`, direct image pixel updates,
  filter/backdrop-filter/blend modes).
- Community forks already diverge: `Ernxst/gpuix` (DOM/CSS-parity fork, announced in issue #48),
  `AzureZee/gpuix` ("A community fork of GPUI…"), `khromov/gpuix-svelte` (Svelte renderer over `@gpuix/native`).
- Single primary author (320 of ~337 commits).

---

## 2. Architecture: relationship to zed-industries/GPUI

### 2.1 It is a binding layer, not a fork

`AGENTS.md` (repo root, 68 KB) states: **"GPUIX is a thin layer on GPUI"** and *"`gpui::ListState`, `gpui::div`,
`gpui::Window` and the rest are the real API; GPUIX only translates a React tree into calls on them."*

GPUIX does **not** vendor or fork `gpui` itself. Instead it pins a fork **of the whole Zed repository** and
consumes its crates by path:

`https://raw.githubusercontent.com/remorses/gpuix/main/.gitmodules`:
```ini
[submodule "zed"]
	path = zed
	url = https://github.com/remorses/zed.git
	branch = gpuix
```

Pinned pointer (`git ls-tree HEAD zed` in the clone): **`81c99f816b4a5f69d3c014774068034c24d1d7af`**
(`160000 commit`, i.e. a gitlink to `remorses/zed` branch `gpuix`).

Earlier pins are visible in the changelog: `@gpuix/react@0.2.0` item 9 says "GPUI upgrade to zed `d5dc01f2`";
the 2026-09-08 commit message records a fast-forward "from 5f672a20b1 to 81c99f816b".

### 2.2 Cargo wiring

`packages/native/Cargo.toml` — the whole GPUI dependency graph is path-based into the submodule:

```toml
gpui = { path = "../../zed/crates/gpui", default-features = false, features = ["profiler"] }
# desktop target adds font-kit:
gpui = { path = "../../zed/crates/gpui", default-features = false, features = ["font-kit", "profiler"] }
gpui_platform = { path = "../../zed/crates/gpui_platform", default-features = false,
                  features = ["font-kit", "wayland", "x11"] }
reqwest_client = { path = "../../zed/crates/reqwest_client" }
http_client  = { path = "../../zed/crates/http_client" }
gpui_macos   = { path = "../../zed/crates/gpui_macos", default-features = false, features = ["font-kit"] }
# wasm32-unknown-unknown instead uses:
gpui_platform = { path = "../../zed/crates/gpui_platform", default-features = false }
```

There is **no root `Cargo.toml`**; `packages/native/Cargo.toml` is the only one in the repo (verified with a
recursive search for `Cargo.toml`, depth 3).

Toolchain pin — `rust-toolchain.toml`:
```toml
[toolchain]
# must match zed's rust-toolchain.toml for the pinned gpui revision
channel = "1.97.1"
profile = "minimal"
```

### 2.3 Bridge mechanism

Two bridges over the same Rust renderer:

- **Desktop:** napi-rs 3 with features `["napi8", "serde-json"]`, `crate-type = ["cdylib","rlib"]`.
- **Browser:** wasm-bindgen pinned exactly (`wasm-bindgen = "=0.2.127"`), target `wasm32-unknown-unknown`,
  nightly Rust + `rust-src`.

Protocol (README "Architecture" / "Mutation API"):

```
React (JS) --applyBatch(json)--> Rust RetainedTree --GpuixView::render()--> build_element() --> GPUI elements
```

`interface NativeRenderer { applyBatch(json: string): Array<number> }` is the **single** transport method
(0.6.0 item 4 removed the separate mutation methods). Element ids are JS-allocated counter integers. Events
travel back through a `ThreadsafeFunction` (desktop) or wasm-bindgen callback; Rust stores only *whether* an
element has a listener (`setEventListener`) — closures stay in a JS-side registry keyed by
`(elementId, eventType)`.

### 2.4 Fork-only GPUI patches are required

GPUIX depends on behaviour that is not upstream. `AGENTS.md` documents the escalation order (search GPUI →
search Zed issues → **"Fix it in the `remorses/zed` fork as a normal GPUI change, and bump the submodule"** →
only then add GPUIX code). Known fork-only work:

- The embedded macOS run loop: `AGENTS.md` — *"The embedded macOS run-loop extension comes from the pinned
  GPUIX fork."* README — macOS uses `MacPlatform::new_embedded()` and pumps AppKit on Node's main thread.
  An upstream PR exists under branch `gpui-macos-embedded`.
- Effect-layer render passes (PR #52 body: "The zed bump brings the effect layer render passes in gpui (Metal,
  wgpu, DirectX)"). The same stack is open upstream as zed-industries/zed#63771–#63773.
- In-place GPUI image updates (`remorses/zed#4`, merged into the `gpuix` branch, commit `81c99f816b`).

**Migration implication:** GPUIX is coupled to a personal Zed fork. Consuming it is not "depend on GPUI" — it is
"depend on a person's fork of Zed, re-pinned every few days," unless you build only against the published
prebuilt `.node` binaries (which is the supported path).

---

## 3. Public API surface

### 3.1 The Rust side (not public API)

`packages/native/src/` (all files read/listed):

```
lib.rs            3.8 KB   module exports
renderer.rs     249.4 KB   GpuixRenderer, GpuixView, build_element(), apply_styles(), motion clock, automation
retained_tree.rs 32.9 KB   RetainedTree, intern_style, sweep_styles
element_tree.rs   9.6 KB   ElementDesc, EventPayload
style.rs         15.8 KB   StyleDesc, DimensionValue
theme.rs         32.1 KB   Theme, Metrics, SyntaxPalette, ThemeOverride, MetricsOverride, SyntaxOverride
motion.rs        13.6 KB   motion.div interpolation
automation.rs    11.4 KB   bounds_tracker, track_own_bounds, automation tree
test_renderer.rs 44.2 KB   TestGpuixRenderer
accessibility.rs  7.8 KB   apply_accessibility(), role_from_aria(), apply_a11y_click()
app_menu.rs       5.2 KB   macOS NSApp menu installation
color.rs          5.2 KB   csscolorparser 0.8.3 wrapper
updater.rs       61.4 KB   cargo-packager-updater 0.2.3 port
custom_elements/{input 78.5, code 14.5, diff 33.1, img 12.9, anchored 13.4, markdown 4.5, mod 20.2} KB
text/{search 47.3, paint 29.5, selection 21.6, runs 3.8, mod 0.9} KB
syntax/{mod 39.3, cache 7.5} KB
markdown/{render 27.2, parser 24.2, mod 0.3} KB
diff/mod.rs 32.5 KB
```

There is **no** GPUI-style `View`/`Render` trait, `Entity<T>`, `Context<T>`, `observe`/`subscribe`, or
`App::new()` visible to users. Those are GPUI internals that GPUIX translates into. The Rust crate is generated
into `packages/native/index.d.ts` by napi-rs on every build (`AGENTS.md`: *"Auto-generated files (do NOT edit
manually)"*).

### 3.2 `@gpuix/native` 0.7.0 — generated TS surface

From `packages/native/index.d.ts`:

```ts
export declare class GpuixRenderer { … }
export declare class TestGpuixRenderer { … }
export declare function checkUpdate(currentVersion: string, options: CheckUpdateOptions): Promise<AvailableUpdate | null>
export declare function hasTestGpuixRenderer(): boolean
export interface AvailableUpdate   { … }
export interface CheckUpdateOptions { … }
export interface DebugFrameOverlayStats { currentMs, p90Ms, p99Ms, maxMs, frames, samples }
export interface EdgeInsets   { top, right, bottom, left }
export interface ElementBounds { x, y, width, height }
export interface EventModifiers { … }
export interface EventPayload { … }
export interface HighlightMatch / HighlightRect
export interface UpdaterHeader
export interface WindowInsets { safeArea, ime, effective }
export interface WindowOptions
export interface WindowSize
```

`GpuixRenderer` methods (`index.d.ts:27…`): `applyBatch(json)`, `tick()`, `getWindowInsets()`,
`setDebugFrameOverlay(mode)`, `getDebugFrameOverlayStats()`, `activateWindow()`, `setWindowTitle(title)`,
`focusNext()`, `focusPrevious()`, `focusNextWithin(elementId)`, `focusPreviousWithin(elementId)`,
`scrollTo(elementId, x, y)`, `scrollToItem(elementId, index, offsetInItem?)`, `getScrollOffset(elementId)`,
`getElementBounds(id)`, `getAllText()`, `getPaintedText()`, `captureScreenshot(path)`.

`TestGpuixRenderer` adds `flush()`, `dragSelect(x1,y1,x2,y2)`, `getPaintedText()`, etc.

**Not present in 0.7.0** (they are open PRs): `getNativeWindowHandle()` and `getElementPaintState()` (PR #61),
`updateImage()` / `clearImage()` (PR #62).

### 3.3 `@gpuix/react` 0.7.0 — public exports

`packages/react/src/index.ts` in full:

- Renderer: `createRoot`, `flushSync`, `createRenderer`, `enableAutomation`, `render`, `resetRender`,
  `startFrameLoop`
- Hooks: `GpuixContext`, `useGpuix`, `useGpuixRequired`, `useWindowInsets`, `useWindowSize`, `useTextSearch`,
  `findRanges`
- Components: `Select*`, `Combobox*`, `Tooltip*` (headless, Base-UI-shaped), `motion`
- Misc: `handleGpuixEvent`, `GpuixRenderer`, `applyMacCpuThrottleFromEnv`, `MAC_CPU_THROTTLES`, `readMacCpuThrottle`
- Subpath exports: `./jsx-runtime`, `./jsx-dev-runtime`, `./testing`, `./select`, `./combobox`, `./tooltip`,
  `./floating`, `./automation`

### 3.4 How you build an app

Entry point is `render(<App/>, options)` at the end of a `.tsx` file. Real snippet from the README:

```tsx
import { useState } from 'react'
import { render } from '@gpuix/react'

function App() {
  const [count, setCount] = useState(0)
  return (
    <div style={{ padding: 24, backgroundColor: '#1a1a1a', height: '100%' }}>
      <div
        onClick={() => setCount((c) => c + 1)}
        style={{ padding: 12, borderRadius: 8, cursor: 'pointer',
                 backgroundColor: '#232323', hover: { backgroundColor: '#2c2c2c' } }}
      >
        <text style={{ color: '#e2e2e2' }}>Count: {count}</text>
      </div>
    </div>
  )
}

render(<App />, { title: 'My App', width: 800, height: 600 })
```

`render()` options (README "Usage" table): `title`, `width`, `height`, `titlebarTransparent`,
`windowBackground` (`"opaque"` default / `"transparent"` / `"blurred"`), `transparent`, `trafficLightX`,
`trafficLightY`, `appName`, `focus` (default `true`), `show` (default `true`), plus `onKeyDown` / `onKeyUp`
renderer-level callbacks (0.7.0 item 3) and `debugFrameOverlay`.

`render()` is **idempotent** — the first call owns the window; later calls only remount React (this is how
`bun --hot` works). `createRenderer()`, `createRoot()`, `startFrameLoop()` remain public for tests and custom
hosts.

TypeScript config requires `"jsxImportSource": "@gpuix/react"` — without it DOM types are used and
`<virtual-list>`, `<markdown>`, `<code>`, `style.hover` all fail to typecheck.

### 3.5 State, async, events

- **State:** plain React (`useState`, `useReducer`, refs, context). No Rust-side entity model.
- **Async:** normal JS promises/timers. On **macOS** `startFrameLoop` calls `renderer.tick()` at a fixed rate
  (~125 fps default, `{ frameMs }` to change, `.stop()` to end); each tick drains only ready AppKit events.
  On **Windows and Linux** GPUI runs its normal *blocking* native event loop on a dedicated Rust UI thread and
  `tick()` does not pump it — it only reports whether the UI thread is still inside `Platform::run`
  (README lines 865–872). Warning in README: never drive `tick()` from `setImmediate` — 73% CPU idle vs 1%.
- **Events:** JS-registry; Rust only knows a listener exists. Full supported list (README "Supported Events"):
  `onClick`, `onAuxClick`, `onMouseDown`, `onMouseUp`, `onMouseEnter`, `onMouseLeave`, `onMouseMove`,
  `onMouseDownOutside`, `onKeyDown`, `onKeyUp`, `onFocus`, `onBlur`, `onScroll`, `onFileDrop`, `onChange`,
  `onSubmit`, `onToggleFile` (`<diff>`), `onShowMore` (`<diff>`), `onLineClick` (`<diff>`), `onLinkClick`
  (`<markdown>`).
- **Pointer capture** is armed by the press when the same node listens for `onMouseDown` **and** `onMouseMove`
  (HTML `setPointerCapture` semantics); left button only.
- **Focus:** React element ids map to persistent `gpui::FocusHandle`s so focus survives rerenders; `tabIndex={0}`
  puts a div in the Tab order. Since 0.7.0 GPUIX no longer binds Tab itself — apps own Tab behaviour.
- **Animation:** `motion.div` with `initial`/`animate`/`transition`; Rust interpolates and requests GPUI frames
  without a React render per frame. Numeric targets only: `width`, `height`, `top`, `right`, `bottom`, `left`,
  `opacity`, `borderRadius`.

### 3.6 Elements and styles

Supported elements (README "Supported Elements"): `div`, `text`, `code`, `diff`, `markdown`, `input`,
`textarea`, `virtual-list`, `img`, `svg`, `anchored`, and `canvas` *(planned — typed, not implemented)*.

Styles are CSS-*like*, not CSS. Notable deviations documented in the README:
`div` is block not flex (must set `display: "flex"`); flex children need `minWidth: 0`; no shorthand values
(`padding`, `margin`, `border` take numbers only); `boxShadow` is a structured object; **no `<button>`**
(use `<div onClick>` with `cursor: "pointer"`); do not nest `<text>` in `<text>`; `<input>` has no default
inner padding; `white-space: pre` is unsupported (GPUI has only `normal` and `nowrap`); GPUI does **not**
inherit `color` — every `<text>` needs an explicit color or it paints black.

---

## 4. Examples

Enumerated from the clone with line counts. `example-app/` is the copyable starter; `examples/` holds the demos
(the README table omits `infinite-chat`, which does exist).

| Path | Lines | What it demonstrates | State |
|---|---|---|---|
| `example-app/app.tsx` | 534 | The starter todo app, one file: `<virtual-list>`, native `<input>` composer, `motion.div` sidebar, tinted `<svg>` icons, `hover`/`active`, `testId` hooks | **complete** (has `app.test.tsx` 212 lines, `web.ts`, `screenshot.ts`, 11 SVG icons, tsconfig, README) |
| `examples/counter.tsx` | 120 | Smallest app: state, events, hover | complete |
| `examples/blurred-window.tsx` | 136 | macOS frosted glass: GPUI native vibrancy + transparent titlebar + translucent React surfaces | complete |
| `examples/chat.tsx` | 1,844 | Full ChatGPT-style client: transparent titlebar, animated sidebar, markdown transcript, composer, streams (`eventsource-parser`), diff + GFM table inside an assistant turn | **complete**, the flagship demo. Tests: `chat.test.tsx` 284, `chat.perf.test.tsx` 226 |
| `examples/infinite-chat.tsx` | 607 | Bidirectional history paging: prepend without moving the reader, `getListScrollTop`, `scrollToItem` with in-row offset | complete; `infinite-chat.test.tsx` 262. **Not listed in the README example table.** |
| `examples/timeline.tsx` | 1,382 | Video-editor timeline: clip drag between tracks, edge trim with snapping, playhead scrub, marquee select, zoom-under-pointer, two-axis pan with frozen ruler + track column, over 3,259 clips across 26 tracks (`timeline-data.ts` 160) | complete; `timeline.test.tsx` 418, `timeline.perf.test.tsx` 192 |
| `examples/mail.tsx` | 1,195 | Superhuman-style 3-pane mail client; hardcoded data | complete (demo data only) |
| `examples/native-text.tsx` | 179 | `<markdown>`, `<code>`, `<diff>` with a tab switcher; cross-element selection | complete |
| `examples/diff.tsx` | 832 | Diff viewer composed from `<div>`/`<text>` in JS, as a comparison baseline for native `<diff>` | complete; `diff.test.tsx` 321 |
| `examples/web-chat.tsx` | 16 | Browser entry wrapping the chat app | thin wrapper, intentional |
| `examples/web-infinite-chat.tsx` | 15 | Browser entry for infinite chat | thin wrapper |
| `examples/web.html` / `web-infinite-chat.html` / `web.css` | 21 / 21 / 40 | Browser hosts + isolation-header CSS | complete |
| `examples/bench-serialization.ts` | 393 | Mutation-wire benchmark | dev tool |
| `examples/profile-chat-scroll.tsx` | 47 | `INTERACT=1` / `MOUNT_ONLY=1` profiling harness | dev tool |
| `examples/compile-chat.ts` | 220 | `bun build --compile` + `cargo-packager` + icon generation | build tool |
| `packages/native/examples/hello.rs`, `bench_serde.rs` | — | Pure-Rust GPUI sample (no JS) and the MessagePack bench | dev tool |

**No stubs.** Every example is a working, substantial app. The performance examples are automated profiles
asserting p95 draw/flush ms.

Test inventory (counted by attribute/`it(` in the clone): Rust `#[test]`/`#[gpui::test]` occurrences **236**;
`@gpuix/react` `it(` blocks **373**; `examples` **56**; `example-app` **6**. PR #62 (2026-09-09) reports actual
runs of "Native library: **233 passed**", "React: **409 passed**", "Examples: **48 passed**".

---

## 5. Docs site structure

### 5.1 What exists

`https://gpuix.dev/llms.txt` (fetched) declares the entire page index:

```
- [React bindings for GPUI, Zed's GPU-accelerated UI framework](https://gpuix.dev/index.md)
- [Changelog](https://gpuix.dev/changelog.md)
```

Plus `https://gpuix.dev/llms-full.txt` (all docs in one file) and `https://gpuix.dev/docs.zip` (every page as
`.md`). The site is built with the Holocron docs framework (`@holocron.so/vite`), Spiceflow, Vite 8, deployed to
Cloudflare Workers (`website/wrangler.jsonc`).

`website/docs.json` navigation declares exactly:

- Tab **Docs** → group *Overview* → page `index`; group *Guides* → page `guides/hermes`
- Tab **Changelog** (changelog source: the GitHub releases page)
- Tabs **GitHub** and **npm** (external links)

Source files present in the repo:

| Path | Content |
|---|---|
| `website/src/index.mdx` | **42 lines, and the body is literally `import Readme from '../../README.md'` + `<Readme />`** — the docs "Home" page *is* the 3,069-line README |
| `website/src/guides/hermes.mdx` | The only guide: running GPUIX on `hermes-node` instead of Bun/Node |
| `website/src/changelog/intro.mdx` | Changelog intro prose |
| `website/src/server.tsx` | Spiceflow server |

**Verified defect:** `https://gpuix.dev/guides/hermes` and `https://gpuix.dev/guides/hermes.md` both return
**HTTP 404** ("Page not found — The page `/guides/hermes.md` doesn't exist or was moved") even though the nav in
`docs.json` lists it and the source `.mdx` exists. The only reachable guide route appears broken in production.

### 5.2 Consequences for a migration study

There is **no** separate "getting started", "concepts", "components", "styling/layout", "platform support",
"limitations", or "roadmap" page. All of that content lives in **one gigantic README**, and the docs site is a
thin renderer of it. Practical implications:

- The README (113,460 bytes, 3,069 lines, 130+ headings) is the *de facto* and explicitly declared **public API
  contract**: `AGENTS.md` — *"README is the public API contract … Document every user-facing feature, element,
  prop, event, renderer option, public method, and behavior change in `README.md` in the same change."*
- Real internal design/roadmap documents live in `docs/` and `plans/`, not on the site:
  `docs/custom-elements-plan.md`, `docs/native-test-renderer-plan.md`,
  `docs/native-text-components-plan.md`, `docs/serialization-benchmark.md`, `docs/visual-screenshot-plan.md`,
  `plans/ios.md` (43 KB), plus `AGENTS.md` (68 KB — the single most useful engineering document in the repo).
- `README.md` is the best "getting started" content: `## Quickstart` (line 17), `### Build from scratch` (33),
  JSX setup (42), entry file (63), run (100), ship a binary (109), wrap in `.app` with cargo-packager (122),
  auto-update (195), examples table (310).
- Section map of the README (headings I extracted): Architecture 406, Mutation API 462, Event Flow 474,
  Packages 503, Building 509, Usage 544, macOS menu bar 591, Background launch 630, Let an agent drive the app
  673, flushSync 737, Debug frame overlay 759, Hot reload 801, Native animations 879, Scrolling 1006,
  Virtual lists 1133, Performance model 1327, Text input 1442, Accessibility 1522, Focus and keyboard
  navigation 1570, Headless controls 1680, Text selection 1941, Text highlighting and search 1980,
  Native text components 2135, Supported Elements 2270, Images and icons 2287, Supported Events 2406,
  Supported Styles 2484, Automation 2685, Testing 2889, Developing the Rust side 2983, **Status 3025**,
  Documentation 3063, License 3067.

---

## 6. Platform support

### 6.1 Published targets

`packages/native/package.json` → `napi.targets`, and `.github/workflows/ci.yml` matrix (the repo requires them
to be identical):

| OS | Target | Renderer | CI build flags |
|---|---|---|---|
| macOS | `aarch64-apple-darwin` | **Metal** | default features (`test-support`) |
| Linux | `x86_64-unknown-linux-gnu` | **Vulkan / wgpu** | `build:release --target …` → `--no-default-features` (no test-support) |
| Windows | `x86_64-pc-windows-msvc` | **Direct3D** | default features (`test-support`) |

`@gpuix/react@0.6.0` changelog item 6 states this explicitly: **"Intel macOS, arm64 Linux, and arm64 Windows
have no prebuilt packages."** Browser adds `wasm32-unknown-unknown` (WebGPU, WebGL2 fallback).

**No mobile target.** iOS is a design document only (`plans/ios.md`), whose own "Risks" section says
`gpui_ios` is not merged, *"IME completeness is unproven"*, and file picker and momentum scroll are missing.
Android is not mentioned anywhere.

### 6.2 Platform caveats found in source

**macOS**
- Uses `MacPlatform::new_embedded()` and pumps AppKit on Node's main thread; the embedded run-loop extension
  exists only in the `remorses/zed` fork.
- `startFrameLoop` ticks `renderer.tick()` at ~125 fps; **never** drive it from `setImmediate` (73% CPU idle vs
  1%) — README, uppercase IMPORTANT.
- Requires `xcodebuild -downloadComponent MetalToolchain` (Xcode 26 no longer ships the Metal compiler).
- Traffic-light clearance is **86 px** (`AGENTS.md`).
- Menu bar: GPUI never calls `NSApplication.setMainMenu:`; GPUIX's `app_menu.rs` installs App/Window menus so
  `⌘Q`, `⌘H`, `⌥⌘H`, `⌘M`, `⌘W` exist. There is **deliberately no Edit menu** — an AppKit key equivalent is
  consumed before the window sees the key, which would steal `⌘C`/`⌘V`/`⌘X`/`⌘A` from text selection and
  `<input>`.
- The application menu *title* comes from the executable name, so a dev run shows `bun`.

**Windows**
- GPUI runs its blocking native event loop on a dedicated Rust UI thread; `tick()` only reports liveness.
- Per-Monitor V2 DPI awareness is set at runtime before GPUI creates a window (0.7.0 item 5) because a `.node`
  cannot ship an exe manifest (`Cargo.toml` comment).
- Last-window-close quits the process (0.7.0 item 6).
- Test renderer works through DirectX; **`createTestRoot({ width, height })` does not size the window on
  Windows yet** (0.7.0 release note, tracked as issue #21).
- Earlier history included `ERR_DLOPEN_FAILED` from a statically imported `TaskDialogIndirect`/`u_strlen`
  (0.5.0 item 14) — now fixed.

**Linux**
- Vulkan/wgpu. CI installs `libfontconfig-dev libwayland-dev libxkbcommon-x11-dev libx11-xcb-dev libssl-dev
  libzstd-dev libvulkan1 vulkan-validationlayers`.
- **GNOME/Mutter has no titlebar, close, minimize or maximize button at all** — open issue **#49**. Cause
  documented by the reporter: `gpui_linux` starts a window as `WindowDecorations::Client`
  (`gpui_linux/src/linux/wayland/window.rs:612`), creates a `zxdg_toplevel_decoration_v1` (`window.rs:279`) but
  **never calls `set_mode`**, and GPUIX never calls `request_decorations`; Mutter advertises no decoration
  manager at all, so nothing draws chrome. `start_window_move` / `minimize` / `zoom` are **not bound** in
  `@gpuix/native`'s `index.d.ts`, so a custom titlebar cannot even drag the window on Wayland.
- `focus` and `show` render options are **ignored on Linux** (0.6.0 item 2; `AGENTS.md` integration-test note).
- `captureScreenshot` / GPU test renderer are **unavailable on Linux** — "Linux stays unavailable until GPUI
  ships its pending wgpu headless renderer" (0.5.0 item 26; `docs/visual-screenshot-plan.md:22,274`).

**Browser / wasm**
- Nightly Rust + `wasm-bindgen-cli --version 0.2.127 --locked`; Wasm module ~**19 MB**.
- The page **must be cross-origin isolated**: `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` on the top-level document (shared memory).
- No AccessKit adapter → all `role`/`aria-*` props are **no-ops** in the browser.
- No HTTPS/updater: `checkUpdate` is desktop-only.
- The Wasm half is a singleton that must never re-evaluate (`WebGpuixRenderer::init` fails with
  `"GPUIX web is already running"`).

### 6.3 GPU requirement, software fallback, headless

- **A GPU is required.** All renderers are surface-backed (Metal / D3D / Vulkan-wgpu / WebGPU-WebGL2).
  `docs/visual-screenshot-plan.md` records that GPUI's `WgpuRenderer::new()` requires window/display handles and
  `draw()` pulls `surface.get_current_texture()`, so it "is not an offscreen renderer"; making it headless would
  require forking/extending `gpui_wgpu`.
- **No software-rendering fallback exists in GPUIX.** No `llvmpipe`/`swiftshader`/software path anywhere in the
  repo. (On Linux you can of course supply a software Vulkan ICD; issue #49's reporter ran under
  `wgpu/Vulkan via lavapipe` — that is Mesa, not GPUIX.)
- **Headless:** only partially. `TestGpuixRenderer` exists to run tests without a visible window, but on macOS it
  is GPU-backed through GPUI's `VisualTestAppContext` + `MacPlatform` + Metal, opening an offscreen window at
  `-10000,-10000`; on Windows it uses DirectX; on Linux it is unavailable. A truly windowless/headless renderer
  is not implemented.
- Reporting: `hasTestGpuixRenderer()` lets you detect availability (added 0.7.0 item 4).

---

## 7. Capability gaps for a desktop chat / workbench app

Legend: **SUPPORTED** = implemented and documented with tests; **PARTIAL** = works with caveats or is
unverified; **MISSING** = no implementation found; **UNKNOWN** = could not verify.

| # | Capability | Status | Evidence (file:line / URL) |
|---|---|---|---|
| 1 | **Text input / IME / CJK** | **PARTIAL — implemented, unverified for CJK** | `packages/native/src/custom_elements/input.rs:1` header "Native single-line and multiline text editors with platform IME support". Full `impl EntityInputHandler` at `input.rs:1485`: `text_for_range:1486`, `selected_text_range:1498`, **`marked_text_range:1510`**, `unmark_text:1516`, `replace_text_in_range:1521`, `replace_and_mark_text_in_range:1556` — i.e. marked-text/preedit is genuinely wired, not stubbed. README:1444-1446 "native caret, text selection, IME composition, clipboard actions, undo/redo, grapheme-safe deletion and mouse positioning". Browser keyboard+IME goes through GPUI's hidden `[data-gpui-input]` textarea (`AGENTS.md`). **But:** the only IME test is `ime_offsets_are_relative_to_replacement_text` (`input.rs:2018`), which asserts UTF-16↔UTF-8 offsets for `"é🙂"` (`utf16_offset_to_utf8`). **A grep for any CJK codepoint (`[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]`) across all `.rs`/`.ts`/`.tsx` in the repo returned zero hits.** No pinyin/Japanese/Korean IME session is exercised anywhere. → *Must be hands-on tested with a Chinese IME before relying on it.* |
| 2 | **Text selection** | **SUPPORTED** | README §"Text selection" (line 1941): every painted string is selectable/copyable including inside `<code>`, `<diff>`, `<markdown>`; cross-element drags; `userSelect: "none"` opts out (inherits); `renderer.getSelectedText()`, `clearSelection()`. Implemented in `text/selection.rs` (21.6 KB) + `text/paint.rs` via a **paint-order** registry (`AGENTS.md` "Text rendering: one funnel"). |
| 3 | **Clipboard (copy/paste)** | **PARTIAL — plain text only** | Copy: `text/paint.rs:638-652` `use gpui::{ClipboardItem, DispatchPhase, KeyDownEvent}` → `cx.write_to_clipboard(ClipboardItem::new_string(text))`. Editors: `custom_elements/input.rs:1082` (write) and `:1100` `cx.read_from_clipboard().and_then(\|item\| item.text())`; test `desktop_paste_uses_the_platform_clipboard_action` at `input.rs:1976`. Only `ClipboardItem::new_string` is used → **no HTML/RTF/image clipboard items, no rich paste, no `onPaste` event, no clipboard history**. Copying joined text across interpolated runs was fixed in 0.5.0 (item 21). |
| 4 | **Scrollable containers / virtualization** | **SUPPORTED with a hard constraint** | `overflow: "hidden"｜"scroll"` with persistent scroll state; `scrollTo`, `scrollToItem`, `getScrollOffset`; `<virtual-list>` virtualizes via GPUI `list()`; perf model table at README:1329. **Constraint: nested scrolling is not supported at all** — `AGENTS.md` "Nested scrolling is not supported": never put a scroll container inside another (`overflow: "scroll"`, `<virtual-list>`, and `<diff>` all qualify), because GPUI delivers the same wheel event to both hitboxes and there is no API to disable list scroll. `overflow-x: scroll` is allowed inside a vertical scroller *only* with `restrict_scroll_to_axis()`. |
| 5 | **Markdown / rich text** | **SUPPORTED** | `<markdown source=… onLinkClick=…>`: GFM — headings, lists, tables, block quotes, fenced code, strikethrough, task lists, autolinked bare URLs (README:2215). Rust: `markdown/parser.rs` (pulldown-cmark 0.12) + `markdown/render.rs`. Theming via `theme` prop and `theme.metrics` (`mdHeadingSizes`, `mdTableCellPadding`, …). Bundled code languages: Rust, TypeScript, TSX, JavaScript, JSX, Python, Go, JSON, Bash, TOML, YAML, Markdown, HTML, CSS, C. |
| 6 | **Embedded webview (browser panel)** | **MISSING** | Zero `CEF`/`WebView`/`iframe`/`chromium` implementations (grep matched only false positives like "gracefully"/"Spiceflow"). PR #61 body states its scope: *"No CEF, WebView, terminal, native-child host, callbacks…"* — that PR only proposes `getNativeWindowHandle()` so *an application* could host a native child itself, and it is **unmerged**. `plans/ios.md:158` mentions WKWebView only for iOS App-Store strategy. **A built-in browser panel is not achievable today.** |
| 7 | **SVG / icons** | **SUPPORTED (two different paths)** | `<svg source={rawSvg} style={{color}}>` uses GPUI's **monochrome icon renderer**, drawn as one shape and tinted by `style.color` — `style.color` is **required** or nothing paints; `currentColor` in the file is not `style.color`; `fill="#000"`/`stroke="#000"` preferred. Desktop may also pass `src` (filesystem path or `data:image/svg+xml,…`). Full-colour SVG is available through `<img>`. |
| 8 | **Image rendering (PNG/JPEG/WebP…)** | **SUPPORTED** | README:2295 — `<img>` "loads **PNG, JPEG, WebP, GIF, SVG, BMP, TIFF, ICO, and Netpbm** from disk, data URLs, or http(s)". Data URLs accept base64 and percent-encoded. Remote URLs go through GPUI's image cache and Zed's `reqwest_client` (no temp files). `objectFit` = `contain`(default)/`cover`/`fill`/`scaleDown`/`none`. Must set **both** `width` and `height` (no intrinsic sizing before decode); `borderRadius` clips the bitmap but a parent `overflow: hidden` does **not** clip an `<img>`. Failed load → placeholder, no crash, no spinner. |
| 9 | **PDF rendering** | **MISSING** | Zero `PDF`/`pdf` hits across all `.rs`/`.ts`/`.tsx`/`.md`. No PDF element, no PDF backend dependency. |
| 10 | **Code editor widget** | **PARTIAL** | `<code code={} language={} path={} showLineNumbers />` is a **read-only** syntax-highlighted block: exactly one row per line at an exact line height, no wrapping (its own horizontal scroller), no surface of its own. `<input>`/`<textarea>` are plain-text editors with **no highlighting**. There is **no editor widget** with gutter/diagnostics/LSP/multi-cursor/folding/search. |
| 11 | **Syntax highlighting engine** | **SUPPORTED — Syntect, not tree-sitter** | `Cargo.toml`: `syntect 5.3` + `two-face 0.5.2`, `regex-onig` on desktop / `regex-fancy` on wasm. The planned tree-sitter stage in `docs/native-text-components-plan.md:225` ("Stage 2 — Tree-sitter syntax highlighting") was **not shipped**. **Docs are stale here:** `examples/native-text.tsx:5,25` and two test titles (`markdown.test.tsx:18`, `showcase.test.tsx:19`) still say "Tree-sitter" — they are wrong. Perf: grammar regexes compile lazily **on the frame thread** on first highlight — Oniguruma ~12 ms TypeScript / ~1.6 ms Rust; wasm fancy-regex ~133 ms TypeScript. Moving Syntect off the frame thread is the **top item on `AGENTS.md`'s High Priority TODO**. |
| 12 | **Drag & drop (OS files in)** | **PARTIAL — added 2026-09-08, unreleased** | `onFileDrop` commit `833d77f`, changeset `.changeset/on-file-drop.md`. Payload `{ paths: string[], x, y }` (absolute Unicode paths; non-Unicode paths are dropped, deliberately, via `Path::to_str` not `to_string_lossy`). Works on `div`, `text`, `img`, `svg`, `input`, `textarea`, `code`, `markdown`, `diff`, `anchored`; **`<virtual-list>` does not take it** (wrap it). **Desktop only.** |
| 13 | **Drag & drop (out to OS) / internal DnD** | **PARTIAL** | No OS drag-out. Internal drags are hand-rolled with pointer capture (`examples/timeline.tsx`): put `onMouseDown`+`onMouseMove`+`onMouseUp` on the grabbed element; a full-window overlay mounted on the press cannot arm capture. |
| 14 | **Context menus** | **MISSING (native)** | No `onContextMenu` in `packages/react/src/types/host.ts`. Right-click is detected via `onAuxClick` + `event.isRightClick` (0.5.0 item 18 — added precisely because "a context menu had no event to hang on"). Menus must be built from `SelectContent`/`ComboboxContent`/`<anchored>`. `contextMenu` appears only as a doc-comment value in `element_tree.rs:38`. |
| 15 | **Native menus (app-declared)** | **MISSING** | README Status line 3051: `- [ ] App-declared menus and menu callbacks`. Only the auto-installed macOS App+Window menus exist (`app_menu.rs`). |
| 16 | **System tray** | **MISSING** | Zero hits for `tray`/`system tray`/`tray icon`. |
| 17 | **Notifications** | **MISSING** | Zero notification API. `notification` appears only as mock UI labels in `examples/mail.tsx` and a plan phrase. |
| 18 | **Multi-window** | **MISSING (explicit TODO)** | README Status line 3057: `- [ ] Multiple windows`. `packages/native/src/renderer.rs:130`: `/// TODO: Scope by renderer/window ID when multi-window support is added.` `render()` is idempotent and owns exactly one window. (PR #64 proposes wlr-layer-shell surfaces — still single-surface.) |
| 19 | **Window chrome / custom titlebar** | **PARTIAL** | Available: `titlebarTransparent`, `windowBackground` `"opaque"｜"transparent"｜"blurred"`, `trafficLightX/Y`, `setWindowTitle`, `appName`. Missing: README Status line 3056-ish `- [ ] Window controls - resize, minimize (title already works)`; on Windows/Linux `titlebar_transparent` feeds `gpui::TitlebarOptions` which is macOS-only, and Linux decorations are unmanaged (issue #49). |
| 20 | **Transparency / vibrancy** | **PARTIAL — macOS only** | `windowBackground: "blurred"` is "the macOS vibrancy backdrop" (README options table; `examples/blurred-window.tsx`; 0.7.0 item 7). `"transparent"` exists cross-platform but with a documented trap: *"Do not paint `#00000000` over a blurred window. A transparent GPUI quad punches through Metal to the desktop"* (`AGENTS.md`). |
| 21 | **Accessibility** | **PARTIAL — implemented on `main`, NOT in published 0.7.0** | `packages/native/src/accessibility.rs` (227 lines) implements `apply_accessibility()`, `role_from_aria()` (a ~90-token ARIA→`AccessKit Role` map), `apply_a11y_click()` (registers `AccessibleAction::Click` so VoiceOver Press fires the JS `click` handler), and props `aria-label`, `aria-description`, `aria-id` (`AXIdentifier`/UIA AutomationId), `aria-valuetext`, `aria-expanded`, `aria-selected`, `aria-level`. Default roles: `<text>`→Label, `<input>`→TextInput, `<textarea>`→MultilineTextInput, `<img>`→Image (alt as label). Target APIs: *"the macOS AX tree, Windows UIA, and Linux AT-SPI through AccessKit"* (README:1524). **BUT** `.changeset/accessibility-aria-props.md` is **unconsumed**, and the 0.7.0 CHANGELOG has **no** mention of accessibility/aria/AccessKit → **the published 0.7.0 npm packages do not have it**; it will land in the next release. **Browser/wasm has no AccessKit adapter — props are no-ops there.** No screen-reader test; only `packages/react/src/__tests__/accessibility.test.tsx` (7.8 KB) and Rust unit tests for the role map. |
| 22 | **Theming** | **SUPPORTED (scoped)** | `theme` prop on `<code>`, `<diff>`, `<markdown>`, `<input>`: `appearance` (`dark`/`light`), `accent`, `syntax` palette, and `metrics`. Rust `theme.rs` (32 KB): `Theme`, `SyntaxPalette`, `Metrics` (~28 fields: `code_text_size`, `code_line_height`, `diff_line_height`, `diff_gutter_width`, `md_heading_sizes: [f32;4]`, `md_table_cell_padding`, …), `ThemeOverride`, `MetricsOverride`, `SyntaxOverride`. Design says layout numbers must live in `Metrics`, never Rust constants (`AGENTS.md`). No global app-level theme object for plain `div`/`text` beyond style props. |
| 23 | **Fonts** | **PARTIAL — no font loading API** | `style.fontFamily` / `fontWeight` / `fontSize` / `lineHeight` / `textDecoration` exist and reach GPUI (`renderer.rs:5095 el.font_family(...)`), font stack is `font-kit` on macOS and cosmic-text on wgpu/web. **However, a repo-wide grep for `load_font`/`register_font`/`FontFace`/`add_font` found nothing** — there is no API to ship or register a custom font file. You can only name fonts already installed on the OS. That is a real gap for a branded app. |
| 24 | **Emoji** | **UNKNOWN** | No colour-emoji handling anywhere in GPUIX; `emoji` appears only in a search-test name (`text/search.rs:799 fn matches_containing_an_emoji`) and as `🙂` inside a UTF-16 offset assertion in `input.rs`. Whether colour emoji render depends on GPUI's font fallback (unverified — the `zed` submodule was not checked out in my clone). |
| 25 | **Animated images (GIF)** | **PARTIAL** | `<img>` animation works because GPUI's `ImgState` holds the frame index and now gets a stable element id — `AGENTS.md`: *"`<img>` had no id, which is why an animated GIF never left frame zero"*; fixed in 0.6.0 item 1 ("Animated GIFs retain frame state"). No Lottie / APNG / animated-WebP evidence. There is an open TODO to move data-URL base64 decoding off the paint path (`custom_elements/img.rs:96`). |
| 26 | **Video playback** | **MISSING** | Zero video/mp4/decoder hits; "video" appears only in the timeline example's mocked clip data (`examples/timeline-data.ts`). |
| 27 | **Localization / RTL** | **MISSING / UNKNOWN** | Zero `i18n`/`localization`/`locale` hits. Zero RTL/bidi support (`direction`, `rtl`, `bidi` — no matches; the one `rtl` grep hit was inside a WAV filename). Text handling uses `unicode-segmentation` for graphemes only. GPUI itself may do bidi shaping; unverified. |
| 28 | **Printing** | **MISSING** | No printing, no PDF export, no page layout. The only capture path is `captureScreenshot(path)` → PNG, and that is **macOS/Windows only** (Linux unavailable until GPUI ships a headless wgpu renderer). |
| 29 | **Performance characteristics claimed** | **Measured, with published numbers** | See §7.1 below. |

### 7.1 Published performance numbers

From README and `docs/serialization-benchmark.md` (all measured on an M-series Mac unless noted):

- **Draw-time overlay** (`debugFrameOverlay: 'full'`) reports `currentMs`, `p90Ms`, `p99Ms`, `maxMs`, `frames`,
  `samples`. The README is emphatic that it is **draw time, not FPS**: "`8.3 MS` is about 120 Hz."
- **Scroll cost model** (README:1329 table): a wheel event calls `cx.notify` on the single `GpuixView`, which
  rebuilds the tree; `gpui::list()` then re-renders every *visible* item. Cost is the visible rows, not list
  length.
- **Un-virtualized pan surface:** on 3,259 clips across 26 tracks, one wheel-pan frame is **p50 7.7 ms culled**
  vs **92 ms with `memo` alone and no culling** — a 12× difference. The README warns the memo-only number looks
  like 0.6 ms if you forget `renderer.flush()`.
- **Mount:** a 10,000-turn chat mount was **850 ms**, of which **`applyBatch` 626 ms** (Rust parsing mutation
  JSON), `FiberNode` 31 ms, `JSON.stringify` 26 ms.
- **Mutation wire format** (`docs/serialization-benchmark.md`), before → after:

  | Metric | before | after |
  |---|---:|---:|
  | parse and apply | 127.1 ms | **30.1 ms** |
  | heap churn | 900.5 MB | **104.0 MB** |
  | allocations | 1,476,196 | **186,090** |
  | retained tree | 224.5 MB | **42.6 MB** |
  | bytes per element | 3,116 B | **592 B** |

  `StyleDesc` is **1,392 bytes**; inlining it in `BatchOp::SetStyle` reserved 312 MB for a 221,764-op mount.
  MessagePack was measured at only **1.24×** and rejected — "the codec is the smallest lever."
- **Automation:** `getAutomationTree()` on a 5k-row tree went from ~110 ms to ~22 ms.
- **Search:** a root-scoped `highlight` query over a 1,000-turn chat costs ~2 ms per keystroke.
- **Idle CPU:** `startFrameLoop()` dropped idle CPU from ~73% to ~1% (0.2.0 item 7).
- **Rebuild loop** (README:2992, M-series Mac, after touching one file): `cargo check --lib` 1.5 s,
  `cargo build --lib` 4.9 s, `bun run build:debug` (napi) ~2 s, one vitest screenshot file ~2 s →
  **"Rust edit to fresh PNGs is about 4 seconds."**

---

## 8. Build & distribution

### 8.1 How you consume it

**npm only.** Three published packages: `@gpuix/react` (TS/JS), `@gpuix/native` (prebuilt `.node` per platform +
a wasm build), `@gpuix/cli` (scaffolder).

- The Rust crate is **not on crates.io** (`crates.io/api/v1/crates/gpuix-native` → 404).
- There is no root `Cargo.toml`; the only manifest is `packages/native/Cargo.toml`, whose GPUI dependency is a
  **relative path into a git submodule** (`path = "../../zed/crates/gpui"`). So even a git dependency
  (`gpuix = { git = ... }`) would not resolve GPUI unless the submodule is checked out — building from source
  means cloning the repo **with submodules** and matching Rust 1.97.1 (+ Xcode Metal Toolchain on macOS).
- The supported path avoids Rust entirely: `bunx @gpuix/cli new my-app` downloads only `example-app/` and
  installs published deps. README: *"There is no repository clone, native build, or Rust toolchain."*
- Runtimes: **Bun** recommended and used throughout (`bun --hot`, `bun build --compile`); **Node.js 18+**
  declared in prerequisites and CI tests `node -e "require('./packages/native')"` on Node 24; **hermes-node**
  is an experimental third runtime (`hermes/`, 12 MB exe + 22 MB `.node` sidecar, requires a locally rebuilt
  `hermes-node` because the v0.0.2 macOS release exports zero `napi_*` symbols).
- Install size was a real problem: 0.5.0 item 13 documents `@gpuix/native` shipping **185 MB** of all six
  binaries because a `*.node` glob defeated `optionalDependencies`; fixed to ~8× smaller.

### 8.2 Targets

Desktop: `aarch64-apple-darwin` (Metal), `x86_64-unknown-linux-gnu` (Vulkan/wgpu), `x86_64-pc-windows-msvc`
(Direct3D). Browser: `wasm32-unknown-unknown`. **No mobile, no Intel macOS, no arm64 Linux/Windows.**

### 8.3 Binary size

| Artifact | Size | Source |
|---|---|---|
| Bun-compiled chat `.app` | **82 MB** | README |
| Hermes chat `.app` | **34 MB** | README |
| `hermes-node` runtime exe | 12 MB | `hermes/README.md` |
| `gpuix-native.darwin-arm64.node` sidecar | **22 MB** | `hermes/README.md` |
| `app.cjs` (React + GPUIX, production) | 453 KB | `hermes/README.md` |
| `app.bundle` (Hermes bytecode) | 266 KB | `hermes/README.md` |
| exe + native total | **33 MB** | `hermes/README.md` |
| Browser Wasm | **~19 MB** | README (0.5.0 changelog) |

Packaging: `cargo-packager` (`formats`: macOS `"app"`/`"dmg"`, Windows `"nsis"`, Linux `"appimage"`);
`cargo packager --release --config packager.json`. Note the README's warning that packager only builds the
**host** OS and `--release` is the packager profile, not `cargo build --release`.

Auto-update: `checkUpdate(currentVersion, { endpoints, pubkey })` on `@gpuix/native`, a port of
`cargo-packager-updater 0.2.3` into `packages/native/src/updater.rs` (61 KB) using Zed's `reqwest_client` rather
than a second TLS stack. Hosted on GitHub Releases, minisign-verified (`minisign-verify 0.2`).
`downloadAndInstall()` replaces files but **does not relaunch**. Desktop only.

### 8.4 Build times

Only the incremental dev loop is published (see §7.1). CI is documented as dominated by GPUI:
`ci.yml` comment — *"Every extra target is a full gpui build, and gpui is most of the wall clock of this
workflow."* No end-to-end cold build time is published.

### 8.5 CI

`.github/workflows/ci.yml` (the only workflow), triggers `push` to `main` (ignoring `**/*.md`, `LICENSE`,
`**/*.gitignore`, `docs/**`) and all pull requests:

| Job | Runner | What it does |
|---|---|---|
| `build` (matrix ×3) | macos-latest / ubuntu-latest / windows-latest | checkout **with `submodules: recursive`**; setup bun; Rust from `rust-toolchain.toml`; `xcodebuild -downloadComponent MetalToolchain` on macOS; cargo cache; apt Linux deps; `bun install`; build `.node`; build `@gpuix/react`; `bun compile-chat.ts`; tar the chat binary; upload `.node` + example artifacts |
| `test` | macos-latest | react suite, build react, examples suite, `example-app` typecheck, CLI test + build |
| `test-windows` | windows-latest | loads the binding with **Bun and Node**, asserts `TestGpuixRenderer` renders a non-empty PNG via DirectX, then react + examples suites |
| `publish-cli` | ubuntu-latest | publishes `@gpuix/cli` if the version is not already on npm (via `sigillo`) |
| `publish` | ubuntu-latest, needs build+test+test-windows | nightly Rust + wasm target + `wasm-bindgen-cli 0.2.127`; `napi create-npm-dirs` + `napi artifacts`; publishes `@gpuix/native` then `@gpuix/react`; attaches `example-chat-*` to the GitHub release |

Release mechanics (from `AGENTS.md`): changesets are mandatory, `CHANGELOG.md` is never hand-edited, versions
are never bumped by hand, `prepublishOnly` refuses to run outside CI, publish order is
per-platform packages → `@gpuix/native` → `@gpuix/react`, and **the GitHub release must be created before the
publish job runs** or the example binaries are silently skipped.

Note: `RUSTFLAGS` is deliberately **not** set to `-D warnings` in CI.

---

## 9. Maturity signals

### 9.1 Unimplemented-marker count

Across all 22,436 lines of `packages/native/src/**/*.rs`:

- `todo!(` / `unimplemented!(` — **0 occurrences**.
- Comment markers: exactly **2**:
  - `packages/native/src/renderer.rs:130` — `/// TODO: Scope by renderer/window ID when multi-window support is added.`
  - `packages/native/src/custom_elements/img.rs:96` — `// TODO: Replace JSON data URLs with binary mutations to keep base64 decoding off paint.`

The codebase is unusually clean of stubs; work is deferred through explicit design documents and Status
checkboxes instead.

### 9.2 Roadmap / TODO

README `## Status` (line 3025) — unchecked items:

```
- [ ] App-declared menus and menu callbacks
- [ ] Canvas element
- [ ] Multiple windows
- [ ] React Refresh during `bun --hot` (needs a Bun runtime transform)
- [ ] Hot reload of the native `.node` addon
```

`AGENTS.md` "Current Status" adds priorities:

- **High:** "Background highlighting — move Syntect off the frame thread once there is a way to request a
  repaint from a background task"
- **Medium:** "Canvas — custom drawing element (`<canvas>` is typed, not implemented)"
- **Low:** "Window controls — resize, minimize (title already works)"; "Multiple windows"; "React Refresh on
  desktop" (blocked on oven-sh/bun#40179); "Native hot reload" (a `.node` cannot unload); "DevTools — React
  DevTools integration"; "Animations — Interpolated style transitions"

Also documented as unsupported rather than roadmap: nested scrolling, multiple fonts registration, headless
Linux rendering, `white-space: pre`, radial/conic/repeating gradients, multi-shadow and letter-spacing
(open issue #60).

### 9.3 Open issues and PR themes

`open_issues_count` = 30 (includes PRs). The items I could read (the API rate-limited before page 2) show
these themes:

**Bug reports**
- **#63** *"textarea and input ignore lineHeight and fontSize, the row is always 26px"* — filed 2026-09-09 by
  `xyaman`, reproduces on `@gpuix/react`/`@gpuix/native` 0.7.0 macOS arm64; **fixed on `main` 2026-09-10** by
  commit `18e695e`.
- **#60** *"Expose text tracking, layered/inset shadows, and border styles in StyleDesc"* — `letterSpacing` and
  multiple `box-shadow` values cannot be expressed on 0.7.0; `boxShadow` accepts exactly one structured shadow.
- **#49** *"Missing window decorations on GNOME / Wayland"* — detailed root-cause report; no titlebar at all on
  Ubuntu's default session.

**Feature / API requests**
- **#47** accessibility (now fixed by the pending `accessibility-aria-props.md` changeset).
- **#48** a heads-up from the maintainer of the `Ernxst/gpuix` fork, which is where the a11y layer first landed.

**Open pull requests** (all unmerged at research time)
- **#64** `feat: Open a window as a wlr-layer-shell surface via WindowOptions.layerShell` (Linux/Wayland
  layer-shell, external contributor).
- **#62** `feat(native): add direct image pixel updates` — `updateImage(elementId, w, h, bgra)` /
  `clearImage`; involves an additional Zed fork bump.
- **#61** `feat(native): expose native integration snapshots` — `getNativeWindowHandle()`,
  `getElementPaintState(id)`.
- **#50–#53** a stacked series from `mateo-m`: CSS value styles + linear gradients + motion-to-auto-height;
  gradient easing; `filter` / `backdrop-filter` / `mask-image` / blend modes via effect layers; accessibility
  layer for DOM parity. They explicitly note the zed submodule had to point at a *different* personal fork
  (`mateo-m/zed`) until `remorses/zed#5–#7` merged, and that Windows/Linux were never exercised locally.

### 9.4 Author's own framing

- Repo description: *"Node.js & React bindings for Zed's GPUI. Build memory efficient native apps with React and
  no Electron."*
- README's first line: *"React bindings for GPUI — Zed's GPU-accelerated UI framework."*
- `AGENTS.md`: *"GPUIX is a thin layer on GPUI."*
- The word "experimental"/"WIP" does not appear in the README. The honest signals are structural (v0.x, 19
  unreleased changesets, single author, unchecked Status boxes).
- `AGENTS.md` also documents that some of the codebase is **ported from another project**:
  `text/`, `syntax/`, `markdown/`, `diff/`, `theme.rs`, `custom_elements/code.rs`, `custom_elements/diff.rs`,
  and the caret-blink part of `custom_elements/input.rs` are ported from **Comet**
  (https://github.com/zeronsh/comet, MIT), recorded in `THIRD_PARTY_NOTICES.md` (4,014 bytes).

### 9.5 Unreleased work on `main` (19 changesets)

`.changeset/*.md` files present but not yet consumed into a release — i.e. **`main` is ahead of npm 0.7.0**:

```
accessibility-aria-props.md   add-text-decoration.md      docs-hermes-runtime.md
fix-embedded-primary-clicks.md  fix-hot-reload-events.md  fix-input-line-height.md
fix-live-automation-mouse-panic.md  fix-macos-tick-starvation.md
fix-textarea-enter-newline.md  img-http-src.md            input-center-and-clip.md
keep-alive-on-runtime-error.md  keep-style-on-hide.md     native-check-update.md
on-file-drop.md  readme.md  runtime-error-overlay.md
select-items-and-library-apis.md  smaller-input-caret.md
```

So **accessibility, `onFileDrop`, `checkUpdate`, the input line-height fix, `text-decoration`, HTTP `<img>`
sources and the runtime error overlay are all implemented on `main` but absent from the latest published
0.7.0.**

---

## 10. What I could not verify (explicit uncertainty)

1. **Total commit count — RESOLVED.** A background `git fetch --unshallow` reported a network timeout on the
   ref update, but the object transfer had completed: `git rev-list --count HEAD` = **337**, and the per-month
   distribution is in §1.5. This matches the contributor API sum exactly. I did not obtain a per-commit listing,
   only the count and the month histogram.
2. **Whether CJK/IME input actually works.** This is the single most important unverified item for a
   Chinese-input-heavy app. The `EntityInputHandler` implementation, including `marked_text_range`
   (preedit) and `replace_and_mark_text_in_range`, is genuinely present — but there is **no CJK codepoint
   anywhere in the repository's source or tests**, and no IME session is simulated. Verification requires a
   hands-on test on macOS and Windows with a real Pinyin IME.
3. **Content of the published 0.7.0 npm tarball vs `main`.** I inferred the gap from the 19 unconsumed
   changesets and the absence of those features from the 0.7.0 CHANGELOG section. I did **not** download and
   diff the 0.7.0 tarball.
4. **The pinned GPUI source itself.** The `zed` submodule was not initialized in my clone (a
   `--depth 1` clone without `--recursive`), so I could not read `zed/crates/gpui` to confirm the GPUI version,
   the fork's actual delta against upstream, or GPUI's own emoji/bidi/font-fallback behaviour. All GPUI claims
   here come from GPUIX's `Cargo.toml`, `rust-toolchain.toml`, README, `AGENTS.md`, and commit messages.
5. **Remaining open issues.** A GitHub API rate limit (HTTP 403) stopped me from paging past the first 40 open
   items, so I read roughly issues/PRs #48–#64 and #1/#2/#20/#21/#25/#30–#36/#40 by reference only.
6. **Star history / community discussion.** Searches surfaced only aggregator pages
   ([trendshift](https://trendshift.io/repositories/175797), [Best of JS](https://bestofjs.org/projects/gpuix),
   [libhunt](https://www.libhunt.com/r/gpuix), relatedrepos) plus non-English blog aggregation
   ("Electron 淘汰！新的跨端框架来了！"). I found **no** authoritative author blog post, X/Twitter thread, or
   Hacker News discussion about GPUIX.
7. **GPU/driver matrix and minimum hardware.** No requirement statement exists beyond the backend names, and no
   Intel-Mac/arm64-Linux/arm64-Windows commitment.
8. **Broken docs route.** `https://gpuix.dev/guides/hermes` and `/guides/hermes.md` both return 404 even though
   `website/docs.json` lists the page and `website/src/guides/hermes.mdx` exists; either the route path differs
   or the guide is broken in production. I could not retrieve it.

---

## 11. Decision-relevant synthesis for a desktop chat/workbench migration

**What GPUIX is good at, per its own evidence:** a single-window, GPU-rendered, React-authored desktop app with
a virtualized long list, native text input, cross-element text selection, markdown/code/diff rendering,
headless overlays, pointer-capture drag interactions, and an unusually complete automation/testing story
(`createTestRoot`, `connectTest`, `launch`, locators, deterministic clock, `captureScreenshot`). The chat,
timeline, mail and infinite-chat examples are real, large, non-stub applications.

**Hard blockers for a workbench-style product, as of 0.7.0 on `main`:**

| Blocker | Status |
|---|---|
| Embedded webview / built-in browser panel | **MISSING** — no CEF/WebView; the enabling primitive (`getNativeWindowHandle`) is an unmerged PR |
| Multi-window | **MISSING** — explicit TODO in README and in `renderer.rs:130` |
| Window resize / minimize controls | **MISSING** — explicit TODO; on Linux/Wayland not even window dragging is bound |
| Native context menus, app menus, tray, notifications | **MISSING** — right-click must be hand-built from `onAuxClick` + `<anchored>` |
| Nested scrolling | **Hard architectural constraint** — one scroll parent only |
| Custom font loading | **MISSING** — only OS-installed families |
| PDF / video / printing | **MISSING** |
| Rich (HTML/image) clipboard | **MISSING** — plain text only |
| Real code editor widget | **MISSING** — `<code>` is a read-only highlighted block |
| Accessibility | Implemented on `main`, **not in published 0.7.0**; no-op in browser |
| CJK IME | **Unverified** — implementation present, zero CJK fixtures |
| Platform coverage | macOS arm64 only on Mac; no arm64 Windows/Linux; Linux has no window decorations on GNOME and no test renderer |

**Stack-change cost:** GPUIX is a *replacement* for the whole renderer, not an embeddable add-on. It requires
React 18/19 + `react-reconciler`, a Bun or Node host, JSX intrinsic elements that are **not** DOM elements
(`div` is block, no `<button>`, no `color` inheritance, no CSS strings/`calc()`), `jsxImportSource: "@gpuix/react"`,
and a Rust/napi addon that cannot hot-reload. Any existing DOM/CSS component library, `position: fixed` layout,
CSS shorthand, `white-space: pre`, or nested-scroller design would need reworking.

**Governance risk:** 320 of ~337 commits from one person; the GPUI dependency is a *personal fork of the entire
Zed repository* re-pinned every few days; `AGENTS.md` asks external contributors **not** to open PRs; and two
independent community forks already exist. The published binaries insulate you from the fork only as long as you
never need an unshipped capability — and several of the capabilities a workbench needs (a11y, `onFileDrop`,
native-window handles) are exactly the unshipped ones.

---

## 12. Source index

**Primary endpoints fetched**
- https://api.github.com/repos/remorses/gpuix
- https://api.github.com/repos/remorses/gpuix/contents/
- https://api.github.com/repos/remorses/gpuix/commits?per_page=10
- https://api.github.com/repos/remorses/gpuix/contributors?per_page=100&anon=1
- https://api.github.com/repos/remorses/gpuix/languages
- https://api.github.com/repos/remorses/gpuix/tags?per_page=40
- https://api.github.com/repos/remorses/gpuix/issues?state=open&per_page=40
- https://registry.npmjs.org/@gpuix/react
- https://crates.io/api/v1/crates/gpuix-native (404)
- https://raw.githubusercontent.com/remorses/gpuix/main/README.md
- https://gpuix.dev/ , https://gpuix.dev/llms.txt , https://gpuix.dev/changelog.md

**Local clone** (`docs/research/gpuix-scratch/gpuix`, `main` @ `18e695e`, shallow):
`.gitmodules`, `rust-toolchain.toml`, `package.json`, `CHANGELOG.md`, `AGENTS.md`, `THIRD_PARTY_NOTICES.md`,
`.github/workflows/ci.yml`, `.changeset/*`, `plans/ios.md`, `docs/*.md`, `website/docs.json`,
`website/src/{index.mdx,server.tsx,guides/hermes.mdx,changelog/intro.mdx}`,
`packages/native/{Cargo.toml,package.json,index.d.ts,src/**}`, `packages/react/{package.json,src/**}`,
`cli/package.json`, `examples/**`, `example-app/**`, `hermes/README.md`, `scripts/web.ts`.

**Referenced external links**
- Zed / GPUI: https://github.com/zed-industries/zed/tree/main/crates/gpui
- Pinned fork: https://github.com/remorses/zed (branch `gpuix`)
- Upstream GPUI PRs mentioned: zed-industries/zed#63771, #63772, #63773, #63201, #63068, #24327, #50768, #62775
- Ported-from project: https://github.com/zeronsh/comet (MIT)
- Community forks: https://github.com/Ernxst/gpuix , https://github.com/AzureZee/gpuix ,
  https://github.com/khromov/gpuix-svelte
- Aggregators: https://trendshift.io/repositories/175797 , https://bestofjs.org/projects/gpuix ,
  https://www.libhunt.com/r/gpuix
