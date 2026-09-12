# GPUI Ecosystem & Capability Assessment — Migration Feasibility for a Native AI Agent Workbench

**Research date:** 2026-09-12 (all data pulled live on this date unless a source date is given)
**Subject:** Can a complex Electron/React AI-agent workbench (multi-panel layout, long chat transcripts, markdown + code highlighting, rich text/markdown editing, file trees, data tables, embedded web browser, PDF preview, image rendering, drag & drop, i18n incl. Chinese/CJK IME, custom theming, embedded terminal) be rebuilt natively on GPUI?

**Method note.** Every claim below is sourced to a live URL fetched on 2026-09-12, or to a dated primary artifact (Cargo.toml, crates.io API record, GitHub issue/PR). Where I could not verify something I say so explicitly in §9. Third-party narrative sources (notably the `gpui-archipelago` blog) are marked as partisan; the quotes they reproduce are attributable and are cross-checked against crates.io/GitHub API data.

---

## 0. Executive verdict

| Question | Answer |
|---|---|
| Is GPUI real, maintained, and usable by third parties today? | **Yes, but not as a normal dependency.** The engine is under heavy daily development inside Zed's monorepo (last commit `2026-09-12T06:26:23Z`). The *published artifact* is ~11 months stale. |
| Is GPUI on crates.io? | **Yes — `gpui` v0.2.2, published 2025-10-22.** 325 days old at time of writing. Only 7 versions have ever existed. |
| **License verdict** | **GPUI itself is Apache-2.0 — safe to link in a proprietary/Apache-2.0 app.** Zed's *higher-level* crates (`editor`, `markdown`, `ui`, `terminal`, `language`, `project`, `workspace`) are **GPL-3.0-or-later**. The license boundary is exactly the boundary between "raw UI toolkit" and "anything that makes it an app". This is the single most important finding. |
| Can GPUI host this app? | **Mostly yes.** ~10 shipping apps already look almost exactly like this one (agent workbenches with terminals, diffs, markdown). Every requirement has a shipping precedent **except an embedded browser panel**. Not turnkey — you assemble it. |
| Biggest risk | **Distribution/governance is the top risk, and it is coupled to capability.** Four competing distributions exist (`gpui-unofficial`, `gpui-pre-*`, `gpui-ce`, raw git); crates.io `gpui` is stale and `gpui_platform` — which Zed's README tells you to use — is **not published at all**. Most headline capabilities (accessibility, notifications, Mica, wasm) exist **only in git**. Also: **no software rendering** (CPU GPU adapters are rejected), **no usable embedded webview**, and **no RTL/i18n**. |
| Overall recommendation | **Viable but conditional, and narrower than "GPUI can do it" implies.** Gate on: (1) a non-crates.io distribution pin; (2) any Zed crate above `gpui`/`gpui_platform` being GPL-3.0-or-later; (3) real GPUs on every deployment target; (4) whether the browser panel needs arbitrary third-party sites; (5) budgeting to hand-build the editor, markdown, i18n, a11y and webview layers. Run the six spikes in §8.3 first. |

---

## 1. Upstream GPUI: what it actually is, and how you consume it

### 1.1 The standalone repo does not exist

`https://github.com/zed-industries/GPUI` → **HTTP 404** (verified 2026-09-12). The repo `zed-industries/gpui` also does not exist. GPUI has **never** had a standalone repository; it has only ever lived at `crates/gpui` inside `github.com/zed-industries/zed`. The marketing site is `https://gpui.rs`, which links back into the monorepo.

Zed monorepo state (GitHub API, 2026-09-12):

| Field | Value |
|---|---|
| Stars | 90,135 |
| Forks | 10,565 |
| Open issues | 3,159 |
| `pushed_at` | `2026-09-12T06:26:23Z` (**today**) |
| GitHub license field | `NOASSERTION` (because the repo carries **two** license files: `LICENSE-APACHE` and `LICENSE-GPL`, plus a `legal/` directory) |

There is an **official Zed-maintained awesome list**: `zed-industries/awesome-gpui` — 1,271★, CC0-1.0, created 2024-02-01, last push **2026-09-11** ("Awesome projects, built with or with GPUI!"). A community umbrella index, `gpui-archipelago` (112 catalogued downstream projects: 71 apps, 7 forks, 28 libraries, 4 tooling, 2 resources), self-describes as "still extremely alpha".

### 1.2 crates.io status — the central structural problem

From `https://crates.io/api/v1/crates/gpui` (live, 2026-09-12):

| Field | Value |
|---|---|
| Latest version | **0.2.2** |
| Published | **2025-10-22T03:56:29Z** |
| Published by | `mikayla-maki` (Mikayla Maki — Zed engineer) |
| License (metadata) | **Apache-2.0** |
| Total downloads | 271,859 |
| Recent (90-day) downloads | 152,693 |
| Description | "Zed's GPU-accelerated UI framework" |
| Homepage | `https://gpui.rs` |
| `documentation` | `null` (no docs.rs link declared, though docs.rs does build it) |
| Version count | **7, ever** |

Full version history: `0.1.0` (2022-06-23, **MIT**, an 8-line placeholder by an unrelated user `ghost_105469`, yanked 2025-10-22), `0.1.0-test` (yanked), `0.2.0` (2025-10-09), `0.2.0-test.4` (yanked), `0.2.1` (2025-10-14, yanked then unyanked same day), `0.2.1-test3` (yanked), `0.2.2` (2025-10-22).

The 0.2.x line was Zed's **first and only** real publication of GPUI. Zed's own satellite crates are frozen at the same instant: `gpui-macros` 0.2.2, `gpui_util` 0.2.2, `gpui_collections` 0.2.2, `gpui_sum_tree` 0.2.2, `gpui_refineable` 0.2.2, `gpui_semantic_version` 0.2.2, `gpui_http_client` 0.2.2, `gpui_media` 0.2.2 — all `2025-10-22`.

**Meanwhile `crates/gpui/Cargo.toml` on `main` still says `version = "0.2.2"`** while the code has moved enormously (see §1.5). So the version number no longer identifies the code.

### 1.3 Why you cannot simply `cargo add gpui` — the Cargo constraint

Cargo **forbids publishing a crate that has `git` or `path` dependencies**. GPUI's own dependency graph contains git-pinned forks:

```toml
# crates/gpui/Cargo.toml (main, 2026-09-12)
font-kit = { git = "https://github.com/zed-industries/font-kit",
             rev = "94b0f28166665e8fd2f53ff6d268a14955c82269",
             package = "zed-font-kit", version = "0.14.1-zed", optional = true }
```

This is why the ecosystem fragmented (§3.2): anyone building a *library* on GPUI cannot publish to crates.io while depending on the git version. Zed solved this for the 0.2.x publish by renaming internal crates to crates.io-legal names (`collections`→`gpui_collections`, `util`→`gpui_util`, `http_client`→`gpui_http_client`, `refineable`→`gpui_refineable`, `sum_tree`→`gpui_sum_tree`, `semantic_version`→`gpui_semantic_version`) and publishing forks as `zed-font-kit`, `zed-xim`, `zed-scap`. The published 0.2.2 dependency blob confirms this.

### 1.4 How you actually consume GPUI today (four options)

| Distribution | Version / cadence | Steward | License | Notes |
|---|---|---|---|---|
| **Upstream git** (rev-pinned) | Zed release tags `v1.12.0`…`v1.20.0-pre` | Zed Industries | Apache-2.0 | The canonical path. Frequent breaking changes. Last Zed app tag `v1.20.0-pre` (2026-09-09). |
| **`gpui-unofficial`** | 47 versions; current `1.19.2` stable, `1.20.0-pre` | Nate Butler (`iamnbutler`) | Apache-2.0 (per crate) | "publishes gpui releases on zed release tags". Mirrors ~10 sibling crates (`gpui-platform-gpui-unofficial`, `gpui-windows-…`, `gpui-linux-…`, `gpui-wgpu-…`, `media-…`, `util-…`, `refineable-…`, `gpui-shared-string-…`). 5,099 downloads for the main crate. Last publish 2026-09-09. |
| **`gpui-pre-*`** (Longbridge) | `0.3.0`–`0.3.4`, published 2026-09-03 → 2026-09-07 | Jason Lee (`huacnlee`) | Apache-2.0 "with Zed's license and notices intact" | Descriptions literally read *"Zed's `gpui_util` crate (**gpui-pre snapshot of zed@6916400**)"*. Publisher on crates.io is `huacnlee` alone. Backs the `gpui-kit` umbrella. ~15.3k downloads each already. |
| **`gpui-ce`** (Community Edition) | crates.io default/max = **`0.2.2`, published 2026-08-28** by `philocalyst` (Miles Wirht); earlier `0.3.2`/`0.3.3` (2025-12-27, by `iamnbutler`) are now **yanked** | `gpui-ce` org (steward *Philocalyst*; founded by Nate Butler) | Apache-2.0 | A genuine hard fork, "periodically synced up with upstream", with open RFCs. Repo: **1,044★, 123 forks, pushed 2026-09-12T02:06:44Z (today)**. 8,502 downloads. README: *"For now, it is mostly API compatible, but this is changing!"* |
| **`gpui-box`** / **`kael`** | `gpui-box` 0.1.x; `kael` 0.4 | `fran0220` / `Augani` | MIT / Apache-2.0 | Independent cohorts. `kael` (formerly `adabraka`/`adabraka-ui`) advertises **webviews, gradients, form controls**, wasm support. |

**Practical answer:** for a production app you pin a git rev of `zed-industries/zed`, or you pin one of the mirrors. `gpui-kit`'s own workspace does the following, which is the most instructive real-world pattern:

```toml
# longbridge/gpui-kit Cargo.toml (main, 2026-09-12)
gpui = { package = "gpui-pre", version = "0.3.1" }
gpui_platform = { package = "gpui-pre-platform", version = "0.3.1",
                  features = ["font-kit", "x11", "wayland", "runtime_shaders"] }
gpui_web = { package = "gpui-pre-web", version = "0.3.1" }
```

**A concrete defect worth knowing before you start:** `crates/gpui/README.md` on `main` instructs you to add `gpui_platform = { version = "*" }`, but **`gpui_platform` is not published to crates.io** — `https://crates.io/api/v1/crates/gpui_platform` returns **404**, and a search for `gpui-platform` returns only third-party republishes (`gpui-platform-gpui-unofficial` by `iamnbutler`, `bezel-gpui-platform`, `fc-gpui-platform`, `open-gpui-platform`). So the official onboarding path does not work as written against crates.io. You must either pin the stale pre-split `gpui = "0.2.2"` (which has no `gpui_platform`, no accessibility, no `system_notifications`, and Taffy 0.9 rather than 0.13) or pull from git/a mirror. This is the single clearest illustration of the distribution problem in §1.2.

### 1.5 The published crate is ~11 months behind `main`

Comparing `crates.io gpui 0.2.2` (Oct 2025) against `crates/gpui/Cargo.toml` on `main` (Sept 2026):

| Aspect | Published 0.2.2 | `main` today |
|---|---|---|
| `accesskit` dependency | **absent** | **present** (`accesskit.workspace = true`, re-exported) |
| `taffy` | `=0.9.0` | `=0.13.0` |
| macOS bindings | `cocoa`, `objc` (legacy) | `objc2`, `objc2-metal` |
| New crates | — | `gpui_shared_string`, `gpui_platform`, `gpui_web`, `gpui_wgpu`, `gpui_macos`, `gpui_windows`, `gpui_linux`, `gpui_apple` |
| wasm target | present but thin | full `gpui_web` crate with `wasm-bindgen`, `web-sys`, `wasm_thread` fork |
| Features | `bench-support` n/a | `profiler`, `stacker`, `screen-capture`, `runtime_shaders` |
| Renderers | Blade + Metal | Blade + Metal + **wgpu** (also for web) |
| Examples | — | `a11y`, `system_notifications`, `grid_layout`, `list_example`, `mouse_pressure`, `tab_stop`, `opacity`, `window_shadow`, `move_entity_between_windows` |

**Consequence:** anything you read about GPUI's published crate is ~11 months out of date, and several headline capabilities (accessibility, wasm/web, wgpu backend) **only exist in git**.

### 1.6 Official Zed stance on third-party GPUI use

The strongest official statement is on `https://gpui.rs` itself:

> "Today, it's Zed's UI framework. **Tomorrow, it's yours!** We'd love your help making that happen."
> "gpui is an open source project. We welcome contributions, but **for the near future gpui is tied to Zed**, so contributions will need to be made there and kept in sync with it."

And `crates/gpui/README.md` (main, 2026-09-12):

> "GPUI is still in active development as we work on the Zed code editor, and is still pre-1.0. **There will often be breaking changes between versions.** You'll also need to use the latest version of stable Rust."
> "Currently, the best way to learn about these APIs is to **read the Zed source code** or drop a question in the Zed Discord."

The README is now genuinely *readable* and documents standalone use:

```rust
fn main() {
    gpui_platform::application().run(|cx: &mut App| { /* ... */ });
}
```

Note the README recommends `gpui = { version = "*" }` — a literal wildcard.

**The one formal commitment on release engineering.** In September 2026, after a public escalation (see §6.3), Zed's official account replied:

> "Hey Jason, we will start working on infra to automatically publish GPUI releases by the end of the month. For now, GPUI will remain in the Zed repo, but we're aiming for more frequent releases as a goal."

As of 2026-09-12 that pipeline has **not** shipped and the deadline (end of Sept 2026) has not yet passed. This is the single deliverable to watch.

**The pullback.** A Zed Discord message reproduced on HN (thread 47003569, 2026-02-13) reads:

> "Hey y'all, GPUI develoment is getting some major brakes put on it. We gotta focus on some business relevant work in 2026, and so I'm going to be pushing off anything that isn't directly related to Zed's use case from now on. However, Nate, former employee #1 at Zed, has started a little side repo that people can keep iterating on if they're interested: https://github.com/gpui-ce/gpui-ce. I'm also a maintainer on that one…"

**Important nuance, and a correction to the popular narrative.** The claim "Zed stopped GPUI development" is **too strong**. What stopped was *external-facing* work (publishing, non-Zed use cases). The *engine* kept moving fast inside the monorepo — see the August 2026 changelog in §4. Do not conflate the two.

---

## 2. Licensing — the critical decision factor

### 2.1 Zed's repo is dual-licensed, and GitHub cannot classify it

Zed's root contains **both** `LICENSE-APACHE` (10,768 bytes) and `LICENSE-GPL` (34,357 bytes). GitHub therefore reports `NOASSERTION`. The repo README states the policy verbatim:

> "Zed source code is licensed **primarily under GPL-3.0-or-later**, with **Apache-2.0 components where marked**."

It is **GPL-3.0**, not AGPL. (One widely-read HN comment ([bayesnet, 2026-04-29](https://news.ycombinator.com/item?id=47951815)) says "AGPL/GPL" — the AGPL part is incorrect.)

### 2.2 The per-crate license boundary (the decisive table)

Each crate declares its own SPDX license in its `Cargo.toml`. Verified by fetching each file on 2026-09-12:

| Crate | `license =` | Verdict for a proprietary/Apache-2.0 app |
|---|---|---|
| **`crates/gpui`** | **`Apache-2.0`** | ✅ Safe. Also `publish = true`. |
| **`crates/gpui_platform`** | **`Apache-2.0`** | ✅ Safe. This is the entry point (`gpui_platform::application()`). |
| **`crates/gpui_wgpu`** | **`Apache-2.0`** | ✅ Safe. |
| **`crates/gpui_web`** | **`Apache-2.0`** | ✅ Safe. |
| `crates/editor` | **`GPL-3.0-or-later`** | ❌ Viral. |
| `crates/markdown` | **`GPL-3.0-or-later`** | ❌ Viral. |
| `crates/ui` | **`GPL-3.0-or-later`** | ❌ Viral. |
| `crates/terminal` | **`GPL-3.0-or-later`** | ❌ Viral. |
| `crates/language` | **`GPL-3.0-or-later`** | ❌ Viral. |

`crates/gpui/LICENSE-APACHE` is a 20-byte pointer file whose entire content is the string `../../LICENSE-APACHE` — i.e. GPUI is "an Apache-2.0 component, marked", inheriting the repo-root Apache text.

Corroboration from an independent commercial consumer: Longbridge's `gpui-kit` README states, under **License: Apache-2.0**:

> "Built on [GPUI](https://github.com/zed-industries/zed), the UI framework from Zed Industries, **also Apache-2.0**. The `gpui-pre-*` crates are snapshots of it, published with Zed's license and notices intact."

### 2.3 What this means precisely

If you link **only** `gpui` + `gpui_platform` (+ their Apache-2.0 satellite crates), you are in the same position as linking any Apache-2.0 dependency: you may ship a closed-source or Apache-2.0 product, must retain copyright/attribution notices and the Apache text, and get an express patent grant. **No copyleft obligation attaches.**

If you link **`editor`, `markdown`, `ui`, `terminal`, `language`, `project`, `workspace`, `rope`, or `multi_buffer`**, then because Rust statically links these into one binary, the combined work is a derivative of GPL-3.0-or-later code. GPL-3.0 §5 requires the *entire* combined work be licensed GPL-3.0-or-later and that you offer corresponding source to recipients. **An Apache-2.0-licensed product cannot do this without becoming GPL-3.0-or-later.** There is no linking exception in any of these crates that I could find, and no alternate commercial license offered by Zed Industries.

Practical consequence: **the useful part of Zed is off-limits.** Zed's own text editor, markdown renderer, syntax-highlighting pipeline, terminal widget and UI kit are all exactly the components this app needs, and all are GPL. GPUI hands you a `div`, flexbox/grid layout, text shaping, GPU rendering, and an element/entity model — and nothing above that.

### 2.4 Residual license risk to flag

There is a live, community-raised provenance concern about third-party component libraries. HN commenter `bayesnet` (2026-04-29):

> "I took a look at gpui-component a while ago when assessing GPUI for a project I was working on. IANAL but was dissuaded because it's almost certainly not compliant with the Zed license — gpui-component 'borrows' gpui code patterns lifted straight from the main zed repo, which therefore must be AGPL/GPL (unlike the gpui-only which is Apache IIRC)."

This was serious enough that `gpui-kit` v0.6.1 (2026-09-09) shipped PR **#2936** titled *"gpui-pre: Audit licenses before publishing and state GPUI's origin"*. `gpui-kit` now declares Apache-2.0. My assessment: snapshots of **GPUI itself** under Apache-2.0 are legitimate (GPUI *is* Apache-2.0). The residual risk is whether any *non-GPUI* Zed code (e.g. patterns from GPL `crates/ui`) was copied into `gpui-component`/`gpui-base`. **I could not resolve this from public sources — it requires a code-provenance audit before you depend on it.** Flagged as UNVERIFIED.

---

## 3. Ecosystem inventory

### 3.1 The major players

| Project | URL | Stars | Last push | License | What it is |
|---|---|---|---|---|---|
| **Zed monorepo** (home of GPUI) | `github.com/zed-industries/zed` | 90,135 | 2026-09-12 | GPL-3.0-or-later + Apache-2.0 parts | The engine. |
| **`longbridge/gpui-kit`** (formerly `gpui-component`) | `github.com/longbridge/gpui-kit` | **14,299** | 2026-09-11 | Apache-2.0 (README; GitHub says NOASSERTION) | The de-facto standard component library + application framework. |
| **`iamnbutler/gpui-unofficial`** | `github.com/iamnbutler/gpui-unofficial` | 50 | 2026-09-09 | — | crates.io mirror of upstream Zed release tags. |
| **`gpui-ce/gpui-ce`** | `github.com/gpui-ce/gpui-ce` | **1,044** | 2026-09-12 | Apache-2.0 | Community Edition hard fork. |
| **`remorses/gpuix`** | `github.com/remorses/gpuix` | **1,773** | 2026-09-10 | Apache-2.0 | **React/TypeScript bindings for GPUI.** No Electron, no webview. |
| `zed-industries/awesome-gpui` | same | 1,271 | 2026-09-11 | CC0-1.0 | Official curated list. |
| `gpui-archipelago` | `gpui-archipelago.github.io` | — | 2026-09 | — | Community cross-fork index: **112 projects**. |
| `iamnbutler/gpuikit` | same | 169 | 2026-09-09 | Apache-2.0 | A *different*, older toolkit. Name collides with Longbridge's `gpui-kit`. |
| `far0220/gpui-box` | same | 9 | 2026-09-12 | MIT | Independent distribution cohort + component kit. |
| `Augani/kael` | same | — | 2026 | Apache-2.0 | Formerly `adabraka`/`adabraka-ui`; **webviews**, gradients, wasm. |
| `Far-Beyond-Pulsar/WGPUI` | same | — | 2026 | — | Warp's fork: GPUI ported to a single cross-platform backend. |

### 3.2 `gpui-component` → `gpui-kit`: the important one

`https://api.github.com/repos/longbridge/gpui-component` **301-redirects** to repo id `814684486` = **`longbridge/gpui-kit`**. This is a rename + restructure, not a merge; the 14,299 stars accrued under the old name. The `gpui-component` *crate* still exists (0.6.1, 2026-09-09) inside the new umbrella.

`gpui-kit` architecture (from its README, 2026-09-12):

```
gpui-kit             The one crate applications depend on
├── gpui-base        Unstyled behavior, state, and infrastructure
└── gpui-component   GPUI Component: the complete styled UI system
    gpui-shell       JavaScript/TypeScript runtime hosted by Rust
```

Claimed capabilities, verbatim from the README:

- **60+ UI Components** — "Forms, navigation, overlays, feedback, layout, and more"
- **Production Ready** — "Used to build Longbridge Pro from day one and continuously refined in a **publicly shipped commercial desktop application**."
- **120 FPS**
- **Data Tables** — "Virtual scrolling, fixed and resizable columns, sorting, and cell selection across **hundreds of thousands of rows**."
- **Virtual Lists** — "Render only the visible range, **including lists whose items have different sizes**."
- **Code Editor** — "**Stable performance at 200K lines with Tree-sitter highlighting and LSP diagnostics, completion, and hover.**"
- **Dock Layout** — "Resizable panels, draggable tabs, nested splits, and edge docks — all **serializable**."
- **Rich Content** — "**Native Markdown and HTML rendering**, syntax highlighting, and built-in charts."
- **JavaScript Extensions** — "`gpui-shell` lets a shipped Rust host load panels and business logic as scripts, with every capability granted explicitly." (embedded **QuickJS**; "describes UI layouts into an arena without WebViews or HTML")
- **Cross Platform** — macOS, Windows, Linux

Version cadence: `gpui-component` 0.1.0 (2025-02-06) → 0.2.0 (2025-10-09) → 0.3.0 (2025-10-24) → 0.4.0 (2025-11-17) → 0.5.0 (2025-12-08) → 0.5.1 (2026-02-05) → **0.6.0 (2026-09-03)** → **0.6.1 (2026-09-09)**. 115,079 total downloads. The `gpui-kit` facade crate is only ~9 days old at time of writing (first published 2026-09-03). Note `gpui-component-assets` is stale at 0.5.1 (2026-02-05).

**Churn warning, from the maintainer's own notes:** the v0.4.0 release notes are titled **"Break Change"** and list 17 renames — `Modal`→`Dialog`, `Drawer`→`Sheet`, `Indicator`→`Spinner`, `Dropdown`→`Select`, `TextInput`→`Input`, `FormField`→`Field`, `column`→`columns`, `cleanable` semantics inverted, `TableDelegate` signature changes. Expect to absorb breaking renames per minor version.

Its dependency choices are also informative: the workspace pins `ropey = "=2.0.0-beta.1"`, `syntect 5.3.0`, `lsp-types 0.97.0`, `tree-sitter`, and `rust-i18n 4.2.0` — i.e. **it reimplements the editor with permissively-licensed crates rather than reusing Zed's GPL `crates/editor`.** That is a deliberate license-avoidance architecture, and it is the pattern you would need to copy.

### 3.3 `gpuix` — React on GPUI (directly relevant to an existing React codebase)

- 1,773★, Apache-2.0, created 2026-01-29, pushed 2026-09-10, homepage `https://gpuix.dev`.
- Description: *"Node.js & React bindings for Zed's GPUI. Build memory efficient native apps with React and no Electron."*
- Architecture: React reconciler → atomic mutation batch (`applyBatch(json)`) → Rust `RetainedTree` → `GpuixView::render()` → GPUI elements. Desktop via **napi-rs**; browser via **wasm-bindgen**. "No Electron, no web views."
- Ships `@gpuix/native`, `@gpuix/react`, `@gpuix/cli`. `bunx @gpuix/cli new my-app` needs **no Rust toolchain** for consumers.
- **Native components already implemented:** `<div>`, `<text>`, `<code>` (Syntect highlighting in Rust), `<diff>` (unified, word-level, collapsible, virtualized), `<markdown>` (GFM: headings, lists, tables, block quotes, fenced code, strikethrough, task lists, autolinks), `<input>`, `<textarea>`, `<virtual-list>`, `<img>` (PNG/JPEG/WebP/GIF/SVG/BMP/TIFF/ICO/Netpbm; local path, data URL, or http(s)), `<svg>` (tintable icons), `<anchored>`.
- Events include **`onFileDrop`** with absolute Unicode filesystem paths from the OS.
- Window options include **`titlebarTransparent`**, **`windowBackground: "blurred"`** (macOS vibrancy), `trafficLightX/Y`, plus automatic macOS menu bar with ⌘Q/⌘H/⌘M/⌘W.
- Packaging/updating: **`cargo-packager`** (`.app`/`.dmg`, NSIS `.exe`, AppImage) with signed auto-update from GitHub Releases via `checkUpdate()` on `@gpuix/native`. Sizes reported: 82 MB (Bun) / 34 MB (Hermes) `.app`.
- **Hot reload:** `bun --hot` remounts React on the same window; in-browser React Fast Refresh preserves `useState` and scroll position without re-creating the GPUI canvas.
- Note it pins **a GPUI fork as a git submodule**, and its browser example needs nightly Rust + `wasm-bindgen-cli` and cross-origin isolation headers (`COOP: same-origin`, `COEP: require-corp`) because the Wasm uses shared memory.
- Friction it documents honestly: *"GPUI defaults text color to black, not white. Unlike CSS, GPUI does not inherit `color` from parent elements."* and *"GPUIX styles look like CSS but are not CSS"* — no shorthand values, `boxShadow` is a structured object, `div` is block not flex, no `<button>`, no `white-space: pre` (GPUI text only has `normal` and `nowrap`).

### 3.4 Other libraries and tools worth knowing

- **`gpui-pdf`** (inside `packetThrower/zorite`) — *"Page-virtualized PDF viewing built on the pure-Rust **hayro** rasterizer — zoom, navigation, full-text search, and bounded memory, with no native dependencies."*
- **`gpui-wry`** (Longbridge, `crates/webview` in `gpui-kit`) — a wry-backed webview crate in the gpui-kit workspace.
- **`gpui-video-player`** — GStreamer-backed video for GPUI (2,904 downloads; last release 2025-11-19).
- **`gpui-flow`** — React-Flow-style node editor. **`ferrum-flow`** — node editor framework.
- **`gpui-hooks`** — React-style hooks. **`gpui-tea`** — Elm architecture. **`declarative-gpui`** — a declarative `ui!` macro.
- **`gpui-storybook`** — Storybook-like harness. **`gpui-router`** — routing (stale: last 2025-12-30).
- **`gpui-symbols`** (AprilNEA) — native SF Symbols. **`gpui-tokio-bridge`** — run tokio tasks in GPUI context. **`swr-gpui`** — SWR-style data fetching for GPUI.
- **`ruviz-gpui`**, **`gpui-liveplot`**, **`gpui-px`**/**`gpui-d3rs`** — plotting/charting.
- **`Bezel`** (crabtalk) — SwiftUI-lean components. **`base-gpui`** — port of Base UI headless components.
- **`Kael`** — fork with **webviews**, gradients, data tables, dotLottie, wasm.
- **`Slag`** (`tangled.org/liminal.rip/slag`) — *"Scriptable, hot-reloadable GPUI framework"*. The closest thing to a hot-reload story.
- **`gpuix-svelte`** — Svelte custom renderer for GPUI (2026-09-02).
- **`gpui-mobile`** (`itsbalamurali`) — third-party iOS (Metal) / Android (Vulkan) effort.
- **`gpui-ce` ecosystem:** `gpui_ce_components`, `yororen_ui`.
- **Longbridge `rust-i18n` 4.2.2** (3.35M downloads, updated 2026-09-08) — the de-facto Rust i18n crate, by the same org as `gpui-kit`.

### 3.5 Apps already built with GPUI that resemble the target workload

This is the strongest single piece of feasibility evidence. All from `gpui-archipelago`'s manifest (112 projects) and HN:

| App | What it is | Why it matters here |
|---|---|---|
| **Waku** (`egoist/waku`, waku.sh) | "A fast, native desktop app for working with local coding agents" — Show HN 2026-08-16 | **Direct analogue of the target app.** Author: *"I built this because I got frustrated with those Electron Apps performance."* |
| **Arbor** (`penso/arbor`) | "Run agentic coding workflows in a fully native desktop app for Git worktrees, terminals, and diffs" | Agent workbench with terminal + diffs |
| **Hadron** (`s0lda/hadron`) | "Run a swarm of AI coding agents side by side — each in its own git worktree… live token telemetry" | Multi-agent panels |
| **OxiMux** (`nhtera/OxiMux`) | "Multi-agent development cockpit… spawn isolated Git worktrees, run CLI coding agents… review every change through a built-in Git UI" | Same shape |
| **Zeron** (`zeronsh/comet`) | "Controls coding agents… keeps all sessions on your device… control from a different device" | Multi-device sessions |
| **Rabbitty**, **Lumi**, **hunk**, **Codux**, **TokenMonitor** | Agent terminals, Codex orchestrators, token usage trackers | Same domain |
| **Moeka** | "All-in-one WYSIWYG Markdown editing engine with workspaces, live diff and integrated Agent terminal" | Markdown editing + agent terminal |
| **Zorite** (`packetThrower/zorite`) | "Markdown daily journal with WYSIWYG and raw-Markdown editing — wiki-linked pages, **embedded PDFs**, Mermaid diagrams, whiteboards, and LaTeX math, on macOS, Windows, and Linux" | **PDF + markdown + multi-platform, in one GPUI app** |
| **Vellum**, **velotype** (567★) | WYSIWYG Markdown editors | Markdown editing |
| **Zedis** (`vicanso/zedis`, 2,074★) | Redis GUI; Show HN 2025-12-31 | Data tables, JSON, cross-platform |
| **termy** (423★), **tty7**, **Seance**, **zTerm** | GPU-rendered terminals with tabs/splits | **Embedded terminal** |
| **Zed itself** (90,135★) | Long-scrolling transcripts? No — but multi-panel, editor, terminal, markdown preview, GPU text at 120 FPS | The existence proof |
| **OpenLogi** (`AprilNEA/OpenLogi`, 20,724★) | Logitech Options+ alternative, local-first, HID++ | Large commercial-grade GPUI app |
| **sonora** (1,035★), **hummingbird** (603★), **Pawse**, **rox**, **vleer**, **Cadence** | Music players | Media, long lists |
| **spread** (`samuelcolvin/spread`) | Fast local spreadsheet viewer | **Data grid** |
| **Futureboard Studio** | DAW: "Native GPUI, React WebUI, Rust DSP" | Hybrid GPUI + React |
| **Navop**, **based**, **DBFlux**, **dbui**, **pgui**, **zqlz**, **RED**, **OpenMango** | Database workbenches | Trees, tables, editors |
| **nohrs**, **zex** | File explorers (Finder alternative) | **File trees** |
| **Loungy**, **Fast Forward**, **Steward**, **hi5** | Launchers / window switchers / menubar apps | Native integration, always-on |
| **Monocurl**, **opencut** | Video/animation editors | Media pipelines |
| **Oxide** | "A binary-first browser that runs WebAssembly modules instead of HTML/CSS/JS" | Interesting counter-example to webview need |

**Interpretation:** every single capability in the target app's list has at least one shipping GPUI app demonstrating it — *except* an embedded web browser (see §4.5). The "can GPUI host this app" question is empirically answered yes.

---

## 4. Capability deep-dive

### 4.1 Text input & IME (CJK) — **PARTIAL, and this is the sharpest risk in the whole assessment**

**There is no text-input widget in GPUI, published or on `main`.** The published `gpui` 0.2.2 API surface (docs.rs item list, `https://docs.rs/gpui/0.2.2/gpui/all.html`, page built 2026-08-15) exposes only primitives: traits `EntityInputHandler`, `InputHandler`; structs `ElementInputHandler`, `UTF16Selection`, `TextLayout`, `ShapedLine`, `LineWrapper`, `InteractiveText`; fns `canvas`, `div`. **No widget type, and no `accessibility` module.**

This is confirmed by Zed's own code. `crates/ui_input/src/ui_input.rs` states:

> "//! It can't be located in the `ui` crate because it **depends on `editor`**."

and `crates/ui_input/src/input_field.rs`: *"It wraps a single line [`Editor`] and allows for common field properties like labels, placeholders, icons, etc."* It reaches the editor through a runtime-injected `ERASED_EDITOR_FACTORY: OnceLock<fn(&mut Window, &mut App) -> Arc<dyn ErasedEditor>>`. In other words **Zed's own text input is not a widget — it is a thin shell over the GPL `editor` crate.** Both `crates/ui` and `crates/ui_input` are `license = "GPL-3.0-or-later"`, and Zed's root `Cargo.toml` sets `[workspace.package] publish = false`, so neither is consumable.

**Consequence for a proprietary app:** you implement `EntityInputHandler` yourself on GPUI primitives, or you take `gpui-base`/`gpui-component` 0.6.1 (Apache-2.0), which re-export `input::{Input, InputBase, Textarea, Editor, InputStyles}` (`https://docs.rs/gpui-base/latest/gpui_base/`).

The `gpui` crate root module list (fetched from `crates/gpui/src/gpui.rs`, `main`, 2026-09-12) contains no `text_input` or `ime` module:

```
action, app, arena, asset_cache, assets, bounds_tree, color, colors, debug_overlay,
element, elements, executor, platform_scheduler, geometry, gestures, global, input,
inspector, interactive, key_dispatch, keymap, path_builder, platform, prelude,
profiler, queue, scene, shared_uri, spring, style, styled, subscription,
svg_renderer, tab_stop, taffy, test, text_system, util, view, window
```

You get primitives: `window.handle_input(...)`, `ElementInputHandler`, key dispatch, `FocusHandle`, and a `text_system`. A text input is something you (or a library) build. `crates/ui`'s `TextInput` exists but is **GPL-3.0-or-later**. `gpui-component`'s `Input`/`Textarea` and gpuix's `<input>`/`<textarea>` are the permissive alternatives.

**IME is genuinely wired on all three platforms — via three different stacks:**

- **Windows (Win32 IMM32).** `crates/gpui_windows/src/events.rs` routes `WM_IME_STARTCOMPOSITION → handle_ime_position`, `WM_IME_COMPOSITION → handle_ime_composition`, `WM_INPUTLANGCHANGE → handle_input_language_changed`; `draw_window()` calls `update_ime_enabled`. It wraps `ImmGetContext`/`ImmReleaseContext` in an `ImeContext`, reads `ImmGetCompositionStringW(..., GCS_CURSORPOS, ...)` and `GCS_COMPATTR`, guards with `should_use_ime_cursor_position()` ("Keep the cursor adjacent to the inserted text by only using the suggested position if it's adjacent to unconverted text", `ATTR_INPUT`), and positions the candidate window with `ImmSetCandidateWindow` using `dwStyle: CFS_POINT`. The `Win32_UI_Input_Ime` Windows feature is enabled in the root manifest.
- **macOS (AppKit text-input protocol).** `insertText:` / `setMarkedText:` / `doCommandBySelector:` against `crates/gpui_macos/src/platform.rs` and `keyboard.rs` (`MacKeyboardLayout`). *(The NSTextInputClient class name itself is inferred, not directly fetched.)*
- **Linux X11 (XIM).** `crates/gpui_linux/src/linux/x11/client.rs` has `enable_ime()`, `reset_ime()`, `update_ime_position(bounds)` (returns early `if state.composing || state.ximc.is_none()`), `create_ic`/`set_ic_values`/`reset_ic`, `InputStyle::PREEDIT_CALLBACKS`, and a `PreeditAttributes`→`SpotLocation` for candidate placement. Dead keys are handled separately via xkbcommon `compose_state`.
- **Linux Wayland:** `text-input-v3` (PR #60589 body: *"**Scope:** Linux **X11** only. Wayland uses `text-input-v3` and is unchanged."*).
- **wasm:** `gpui_web` enables the web-sys `CompositionEvent` feature.

**But there is a steady stream of unfixed CJK bugs, and one is a direct functional hazard for an agent app.** The `area:controls/ime` label has exactly **12 open issues** as of 2026-09-12. The most important:

| Issue / PR | Status | What it means for you |
|---|---|---|
| **#41576** *"Prevent KeyDown events during IME composition on Linux"* | **CLOSED as `not_planned` (2026-04-24)**; the fixing PR **#39915 closed, NOT merged (2026-03-30)** | **The most dangerous finding.** On Linux, pressing Enter mid-composition can be dispatched as a key event and **fire an action — e.g. send a message in an Agent panel.** The PR body argued it only brought Linux to macOS parity ("This aligns Linux behavior with macOS, which already checks for marked text before dispatching key events") and was still rejected. Treat Linux IME key routing as the weakest platform. |
| #61270 *"Complete pending key bindings before IME input"* | **MERGED 2026-07-29** (fixes #56043) | macOS multi-stroke bindings (`ctrl-x k`) were being intercepted by the Japanese IME. Fixed on macOS only. |
| **#62764** *"Pending multi-stroke keybindings (`Ctrl+K`) are intercepted by IME"* | **OPEN, S2, since 2026-08-17** | The **Windows** equivalent of #61270 is still open (Rime/Weasel). |
| #56327 *"Chinese Input Method Editor (IME) Interferes with Editor"* | OPEN, assigned, updated 2026-07-07 | Reporter root-caused two defects on Windows: `WM_KEYDOWN` (via `ToUnicode`/`prefer_character_input`) **and** `WM_CHAR` both insert because *"`WM_KEYDOWN` does not check the IME composition state"* → double-inserted characters; plus a DirectWrite panic slicing `&text[utf8_offset..(utf8_offset+run.len)]` mid-multibyte. |
| #60578 / PR #60589 | issue open; **fix PR OPEN since 2026-07-08** (updated 2026-08-19) | X11 Chinese IME **permanently breaks** after a transient `XIMClientError` and does not recover. |
| #62661 | OPEN, S2, 2026-08-15 | macOS non-activating panels: `setMarkedText:` commits but **no candidate window** appears. |
| #59193 *"Text shifts vertically when using Chinese IME on Windows"* | OPEN, S2, since 2026-06-12 | Layout corruption during composition. |
| #56149 | OPEN, S3, 2026-05-08 | IME candidate window appears at the top of the screen in the integrated terminal. |
| #27179 | OPEN, S2, **since 2025-03-20** | Linux X11 dead keys: `'`+`c` yields `ć` instead of `ç`. |
| #62058, #61937 | OPEN, S3 | macOS: backtick inserted at the previous position after a click; menu bar flashes/closes with a Chinese IME. |
| **#19940** *"Add word segmentation support for CJK languages"* | OPEN, **since 2024-10-30, 20 👍** | **No word-level navigation or selection for CJK.** Double-click-to-select-word, ctrl-arrow word motion etc. do not work properly for Chinese/Japanese/Korean. For a text-heavy CJK app this is a real usability gap, not cosmetic. |
| #63428 | OPEN, 2026-08-29 | CJK font fallback is not configurable. |
| PR #63405 | OPEN, created 2026-08-29 | macOS CJK IME intermittently dead. Root cause is instructive: `is_ime_input_source_active()` *"returned `false` for any ASCII-capable input source, which incorrectly disabled the IME for sources that compose CJK text despite being ASCII-capable — **most notably WeChat IME's main source (`com.tencent.inputmethod.wetype`)**."* |

**The honest third-party assessment.** Zhiwei Ma, building the `zTerm` terminal emulator on GPUI + `gpui-component` ([DEV.to, 2026-01-24](https://dev.to/zhiwei_ma_0fc08a668c1eb51/building-a-gpu-accelerated-terminal-emulator-with-rust-and-gpui-4103)):

> "**IME Support** — Supporting Chinese/Japanese/Korean input methods was tricky. Cursor positioning, candidate window placement, and composition state handling all behave differently across platforms. **GPUI's documentation is sparse here, so I ended up reading Zed's source code.**"

**Verdict on IME: PARTIAL, and the weakest SUPPORTED-adjacent axis.** CJK input *works* — Zed has Chinese users, GPUI apps with CJK input ship, and all three platforms have real, non-trivial IME code including candidate-window positioning. But there is no widget, docs are thin enough that practitioners read the source, there are 12 open IME issues, and two of them are things you will hit immediately: **Enter-during-composition firing actions on Linux (accepted as won't-fix)** and **no CJK word segmentation**. If Chinese input is a first-class requirement, prototype this on day one and treat it as a go/no-go gate.

Cross-toolkit context (from a parallel survey): CJK IME is an *active, unfixed bug area in essentially every* Rust-native toolkit — Blitz/Blitz issues #272, #287 and open PRs #843/#844; egui issues #3532, #4486, #2317, #7974, #7975; iced PR #3290 and issue #3189. GPUI is not an outlier; it is arguably ahead because it ships inside a real editor with CJK users.

### 4.2 Rich text / markdown rendering — **PARTIAL: available, but the good Zed one is GPL**

- Zed's `crates/markdown` — **GPL-3.0-or-later**. It uses `pulldown-cmark` + `html5ever` + `markup5ever_rcdom` + a `mermaid_render` crate, and depends on `gpui`, `language` (GPL), `theme`, `ui` (GPL), `settings`. **Not usable in a proprietary app.** It also drags in the whole Zed settings/theme/UI stack.
- **Permissive alternatives that exist today:**
  - `gpui-component`'s markdown/HTML renderer, and `gpui-kit`'s documented examples `example-markdown`, `example-html`, `example-stream-markdown` (streaming markdown — directly relevant to a chat transcript).
  - **gpuix's `<markdown>`** — GFM implemented in Rust on top of GPUI, "headings, lists, tables, block quotes, fenced code, strikethrough, task lists, and autolinked bare URLs", with a themable `metrics` object (heading sizes, row heights, gutter widths). Apache-2.0.
  - `gpui-kit` "Native Markdown and HTML rendering" — note the *HTML* renderer is native, not a webview.
- **Verdict:** markdown rendering is a solved problem in the permissive layer, but you are choosing a third-party renderer, not reusing Zed's. Streaming/incremental markdown for chat is explicitly demonstrated (`example-stream-markdown`).

### 4.3 Embeddable Zed editor — **NOT PRACTICAL (legal + architectural)**

`crates/editor/Cargo.toml` declares `license = "GPL-3.0-or-later"` and its dependency list is an almost complete tour of Zed: `project`, `lsp`, `language`, `multi_buffer`, `rope`, `workspace`, `ui`, `ui_input`, `markdown`, `theme`, `settings`, `rpc`, `client`, `db`, `git`, `dap`, `language_detection`, `snippet`, `text`, `sum_tree`, `buffer_diff`, `edit_prediction_types`, `vim_mode_setting`, `zed_actions`, plus four tree-sitter grammars. It also has `publish.workspace = true` and no `version` beyond `0.1.0`.

Two independent blockers:
1. **License:** GPL-3.0-or-later propagates to your binary.
2. **Coupling:** it pulls the LSP client, project model, multi-buffer, git integration, DAP debugger, collab RPC and the GPL `ui` crate. It is not an embeddable component; it is Zed's editor with Zed's world attached.

The permissive path is what `gpui-component`/`gpui-kit` did: build an editor from `ropey` + `tree-sitter` + `syntect` + `lsp-types`. `gpui-kit` advertises "Stable performance at 200K lines with Tree-sitter highlighting and LSP diagnostics, completion, and hover" on that stack. **That is the realistic route, and it means writing/choosing an editor — not embedding Zed's.**

### 4.4 Syntax highlighting — **SUPPORTED (via permissive crates)**

- `tree-sitter` is a plain Rust crate; `gpui-component` exposes `tree-sitter` and per-language `tree-sitter-<language>` features.
- `syntect 5.3.0` is used by `gpui-kit` and by gpuix's `<code>` element, which computes highlighting **in Rust** with themeable colors and fixed row heights ("the block's height is known before highlighting runs") — a good design for chat transcripts since layout never shifts when highlighting arrives late.
- No GPUI-specific tree-sitter glue is needed beyond rendering styled ranges; you paint text runs yourself.
- **Caveat:** gpuix bundles a limited language list (Rust, TypeScript, TSX, JS, JSX, Python, Go, JSON, Bash, TOML, YAML, Markdown, HTML, CSS, C) — you would extend it for full coverage.

### 4.5 Embedded web browser / webview — **MISSING in core; PARTIAL via third parties; the one hard gap**

This is the weakest area and the one place where the answer is a genuine no-in-core.

- **Zed core has no webview, and upstream has actively declined two attempts to add one:**
  - Issue **#21208 "Webview via Extensions"** — **OPEN, created 2024-11-26, last updated 2026-09-09, 427 👍 / 449 reactions, 28 comments.** Maintainer `notpeter` (2024-11-26): *"there is still significant work to be done here and it's **likely still a ways off**."*
  - **PR #13730** (by `huacnlee` — the same Longbridge maintainer — 2024-07-02) exported `raw_window_handle` for wry plus a `gpui --example webview`. **CLOSED WITHOUT MERGE the same day.** The author's own close reason is the definitive statement of the problem: wry *"can't be covered by other element… **input cursor always stays inside the WebView**… Windows can't start, panic `BorrowMutError`."*
  - **PR #54433** (2026-04-21) *"gpui: Add WebView element backed by wry + WebKitGTK"*, feature-gated — **CLOSED WITHOUT MERGE 2026-04-23.** Its body documents Windows/macOS/X11 working and **Wayland impossible inline** (wry's `build_as_child` is X11-only; there is no `wl_subsurface` path).
  - Verified by absence in `main`: the `crates/gpui/src/gpui.rs` module list and the `[[example]]` list contain no webview, and **no `gpui-wry` / `gpui-webview` / `gpui-cef` / `gpui-servo` crate exists upstream.**
- **The only working third-party option has a disqualifying limitation for an in-panel browser.** Longbridge's `crates/webview` (in `gpui-kit`) README states:
  > "A webview supports for GPUI, based on Wry… **still experimental with limited features**… The WebView **will render on top of the GPUI window**, any GPUI elements behind the WebView bounds will be covered… **Only supports macOS and Windows currently.** Recommend using in a separate window or Popup layer."

  Note also that its published artifact is `gpui_ce_components_webview` 0.2.0 (2026-08-29, **11 downloads**). **Consequence:** a webview cannot be *clipped, overlaid, scrolled with, or z-ordered against* GPUI content. A resizable browser panel that participates in your dock layout, that you can overlay a command palette on top of, or that animates in and out, is **not achievable** with the current approach — the webview is a hole punched on top of everything. This is a compositing/z-order problem, not a webview-creation problem (wry 0.57.0, 2026-09-08, *does* support non-Tauri windows via `HasWindowHandle`/winit).
- **`Kael`** (the former `adabraka` fork) advertises "**webviews**, form controls" as a built-out general-purpose feature — unverified in practice, and it would carry the same compositing constraint.
- **No render-HTML-natively substitute is production-ready:**
  - **Blitz** (Dioxus): README says *"currently in a beta state… usable for making apps if you are an early adopter and willing to live on the bleeding edge. But there are also still many bugs and missing features."* Newest `0.3.0-beta.2` (2026-08-24); stable `0.2.1` (2025-10-08). Pipeline is `blitz-dom` (Stylo + Taffy + Parley) → `blitz-paint` → `anyrender` → `blitz-renderer-vello`. Its 2026 CSS status page lists **`position: static`, `position: fixed`, `position: sticky`, `overflow: auto`, container queries, `text-overflow`, `line-clamp`, 3D transforms, SVG fill/stroke styling** as unsupported. Losing sticky/fixed/`overflow:auto` alone breaks sticky headers, floating panels, and auto-scrolling chat panes. **No GPUI backend exists and I found no gpui+blitz experiment.** ❌
  - **Servo** became embeddable as a library: the `servo` crate **0.5.0 (2026-08-17, MPL-2.0)**, first published 2026-04-13, with `webgl`/`webgpu`/`vello` features. Plausible, but **no GPUI integration found.** ⚠️ UNVERIFIED
  - **Verso** (`versotile-org/verso`) drives `versoview` as an **external binary process** (`tauri-runtime-verso`); no mobile, macOS-only app menus. Process-level, not in-process. ⚠️
- **Zed renders its Markdown preview natively, not in a webview — CONFIRMED.** Introduced by **PR #11556 "Introduce a new `markdown` crate" (as-cii, May 2024)**; the crate paints its own text and highlights (e.g. PR #62963 fixes paint order in `HighlightedLine::paint`), and PR #64112 (2026-09-12) adds Select-All / Copy-as-HTML. Zed also auto-previews md/SVG/CSV (PR #58752) and tabular data (PR #63369) — all native. Separately, **Zed's answer for PDF is "open in the system viewer"** — PDF viewer PRs #51040/#51870 were closed.
- **Practical options for the browser panel, honestly stated:** (a) a **separate native window** hosted by wry and positioned near your GPUI window — works, but it is not an in-panel browser and will not move/scroll with your layout; (b) accept a full-bleed webview that covers the panel region and is shown/hidden, with no GPUI content above it — workable for a dedicated maximized browser view, not for a docked panel with overlays; (c) if the "browser" only needs authenticated web content you control or mostly-static docs, `gpui-kit`'s **native HTML renderer** or a `reqwest` + readability + markdown pipeline sidesteps the problem entirely.
- **This is the single feature that requires the most bespoke engineering, and the strongest argument for keeping a webview-capable shell (Tauri/Qt/Avalonia) if the browser panel is load-bearing.**

### 4.6 PDF rendering — **SUPPORTED, and better than expected**

- **`hayro`** — pure-Rust PDF interpreter/rasterizer by Laurenz Stampfl. crates.io: **v0.7.1, published 2026-06-05, license `Apache-2.0 OR MIT`, 2.13M total downloads / 1.32M recent.** MSRV 1.92. Crates: `hayro`, `hayro-syntax`, `hayro-interpret`, `hayro-svg`, `hayro-jpeg2000`, `hayro-jbig2`, `hayro-ccitt`, `hayro-postscript`, `hayro-cmap`.
- Its own README is candid: *"An experimental, work-in-progress PDF interpreter and renderer… There are still certain features and edge cases that `hayro` currently doesn't support (for example rendering knockout groups or PDFs with non-embedded CID-fonts). However, the vast majority of common features is supported… `hayro` is able to handle the 1400+ PDFs in our test suite… most notably performance, which has not been a focus at all so far."*
- **There is already a GPUI integration:** `gpui-pdf`, inside `packetThrower/zorite` — *"Page-virtualized PDF viewing built on the pure-Rust hayro rasterizer — zoom, navigation, full-text search, and bounded memory, with no native dependencies."* And Zorite is a shipping multi-platform GPUI app with "embedded PDFs".
- **There is no GPUI PDF example or crate upstream.** Zed's own answer is **"open in the system viewer"** — PDF viewer PRs #51040 / #51870 were closed.
- **Alternative engines:**
  - `pdfium-render` **0.9.4, 2026-09-06** (MIT OR Apache-2.0, MSRV 1.61, 2.32M downloads, actively maintained) — production-grade, but **ships/loads the C++ Pdfium binary** (Chromium's PDF engine): bundling, signing and per-platform artifact management become your problem. Gives text selection, forms and annotations for free.
  - `mupdf` **0.8.0, 2026-06-22** — **AGPL-3.0. This is a license landmine for a closed-source app**; do not use it without a commercial MuPDF licence.
  - `pdf-rs` — pure Rust but far less complete than hayro.
- **Effort estimate (revised to be explicit):**
  - **~1–2 weeks** for a read-only page pager: render page → RGBA → `RenderImage`, virtualize per page, off-thread rasterization. This is the `gpui-pdf` happy path.
  - **+2–4 weeks** for text selection, full-text search and internal links — these require your **own text extraction and hit-testing**, because hayro explicitly scopes selection/search/annotations/forms out.
  - **+1–2 weeks** of cross-platform binary bundling and signing if you go the PDFium route instead (which then gives selection/forms for free).
  - **Long tail:** CJK and non-embedded CID fonts, JBIG2, knockout groups — hayro's documented unsupported cases. If your PDFs are CJK-heavy or print-production files, validate against a real corpus early.
- **Verdict: SUPPORTED with a real but bounded effort.** A reference implementation already ships in a multi-platform GPUI app (`gpui-pdf` inside Zorite), so this is engineering, not research.

### 4.7 Virtualized long lists / scroll performance — **SUPPORTED, this is GPUI's home turf**

- Primitives in `crates/gpui/src/elements`, **verified present in the published 0.2.2 API index**: `uniform_list()` + `UniformList` + `UniformListScrollHandle` + `UniformListScrollState` + `UniformListDecoration`; **and** variable-height `list()` + `List` + `ListState` + `ListOffset` + `ListScrollEvent` + `ListAlignment` / `ListSizingBehavior` / `ListMeasuringBehavior` / `ListHorizontalSizingBehavior`; plus `ScrollHandle`, `ScrollAnchor`, `ScrollStrategy`, `ScrollDelta`, `Deferred`, `DeferredScrollToItem`.
- **Two API corrections to watch for:** `ListAlignment` in 0.2.2 is `{Top, Bottom}` only — **there is no `Center`** — and there is **no `Scrollable` trait** in gpui 0.2.2 (that is a Zed-internal `ui`-crate concept, and `ui` is GPL). Published 0.2.2 also lacks a set of newer `ListState` helpers that exist on `main` (`remeasure`, `remeasure_items`, `scroll_to_end`, `set_follow_mode`, `is_scrolled_to_end`, `pause_following_tail`, `with_uniform_item_height`, `FollowMode`) — which matters for a chat transcript that follows the tail.
- `gpui-kit` claims **Data Tables** with "virtual scrolling… across hundreds of thousands of rows" and **Virtual Lists** that "render only the visible range, **including lists whose items have different sizes**". gpui-base exposes `VirtualList`, `TreeState`/`Tree` ("An unstyled, virtualized tree element") and `Scrollbar`.
- Zed itself is the proof: it renders long documents and its terminal/editor scroll at 120 FPS, and Zed's blog documents optimizing the Metal pipeline to hold 120 FPS (`https://zed.dev/blog/120fps`). **Official performance budget, from `CONTRIBUTING.md`: "Frames must take no more than 8ms (120fps)."**
- **Known performance issues — real, with numbers:**
  - **#58900 "Slow and choppy scrolling when text is selected/highlighted" — OPEN**, created 2026-06-09, updated 2026-09-11, labels `area:performance` + `area:editor`, **severity S2**. This is precisely a long-transcript/scrolling-highlighted-text scenario.
  - **#21403 "Completions and code actions should not use uniform lists" — STILL OPEN since 2024-12-02** (updated 2026-03-27, S2): *"The solution is to dynamically size the list elements … by using `list` instead of `uniform_list`. **I'd do that myself, but the list API is very different from the `uniform_list` one**"* — i.e. the variable-height `List` API is awkward enough that Zed itself deferred the migration for 21+ months. **Budget for learning `list()` properly; it is not a drop-in for `uniform_list`.**
  - #46728 macOS fullscreen rendering regression — CLOSED 2026-03-05 (33 comments, S2, reach:many users): *"In fullscreen while scrolling, Zed is rendering at 60fps … while in a window it can easily do 120fps."* #47401 (large repo, 60,000 files) CLOSED `not_planned` 2026-08-28: *"the code editor will hang with the mac pinwheel of doom."*
  - **Concrete per-frame cost evidence — PR #63145 (SomeoneToIgnore, staff) MERGED 2026-09-09:** *"`BufferSnapshot::chunks` re-ran the tree-sitter highlight query over the requested range on every call, so **scrolling and cursor movement paid the full query cost per frame**."* Benchmarks on a 10K-line Rust file: `editor_render_highlighted` 1.7377 ms → 1.4597 ms (−14.9%); with minimap 12.407 ms → 9.3213 ms (−24.9%); *"GPUI reports window draw mean 0.81 ms → 0.68 ms and p99 1.06 ms → 0.76 ms without the minimap, and mean 5.14 ms → 4.12 ms, p99 6.12 ms → 4.75 ms with it."* **Read this as a warning: if you naively re-highlight on every frame, you will pay for it. Cache highlighting per visible range.**
  - In-flight: PR **#63800 "gpui: Incremental view rendering with a view tree"** (mikayla-maki, staff), OPEN draft, created 2026-09-05.
- **Also real, from practitioners:**
  - Zhiwei Ma (zTerm): *"Initially, I was triggering a render on every PTY event. Running `cat` on a large file would freeze the terminal. Adding a **4ms batching interval** to coalesce multiple events before rendering made a huge difference."* → **For a streaming chat transcript, coalescing updates is mandatory.**
  - **wasm hazard:** gpui-base's `OngoingScrollExt` docs state gpui "delimits scroll gestures with `std::time::Instant`, which is unimplemented on wasm32: **the first wheel event over an axis-locked scroll area panics with 'time not implemented on this platform' and takes the whole application down**, leaving the canvas unresponsive."
  - GPUI's text system only supports `white-space: normal` (wrap) and `nowrap` — **there is no `pre`**. To render code with preserved newlines you split on `\n` and render one row per line (gpuix documents exactly this workaround).
  - Variable-height virtual lists need a scroll model you maintain (a prefix sum of row heights) for `scrollToItem`; gpuix documents this, and that `HighlightStyle.background_color` paints square corners only, so search highlighting is painted manually.
  - Beware duplicate `GlobalElementId`s in list rows: GPUI's a11y guide warns that in **release builds**, nodes with duplicate global IDs (e.g. from a `text!()` macro inside a `.map()`) are **silently dropped**.

### 4.8 Accessibility — **SUPPORTED (and this is a big change since 2025)**

GPUI integrates **AccessKit** directly. From the crate root: `pub use accesskit; pub use accesskit::Action as AccessibleAction; pub use accesskit::{Orientation, Role, Toggled};` and there is an in-repo guide `crates/gpui/src/_accessibility.rs` ("Accessibility in GPUI").

The documented API surface (fetched 2026-09-12):
- `div().id("x").role(Role::Button)` — nodes with a `GlobalElementId` **and** a non-`None` role are reported to assistive tech.
- `.on_a11y_action(AccessibleAction::Increment, |_, window, cx| …)` — respond to assistive-tech actions. `.on_click()` automatically registers `AccessibleAction::Click`.
- `Element::a11y_synthetic_children` + `A11ySubtreeBuilder` — let a custom text-editor element present `Role::TextInput` with `Role::TextRun` children, set `character_lengths`, and set `accesskit::TextSelection` (anchor/focus + `character_index`). This is exactly the machinery a custom markdown editor or chat transcript needs to be screen-reader-legible.
- `Text::new_inaccessible()` to exclude decorative text; `text!()` IDs derive from source location (with a documented footgun).
- There is an official example: `crates/gpui/examples/a11y.rs`.

Supporting evidence from the upstream changelog (August 2026 digest): **"Native accessibility identifiers (`.accessibility_id(...)` in v1.16.1 for AX, UIA, AT-SPI)"** — i.e. macOS Accessibility, Windows UI Automation, and Linux AT-SPI are all wired up. `gpui-kit` 0.6.1 also shipped accessibility fixes.

**Platform coverage is all three, not VoiceOver-only.** The workspace pins `accesskit = "0.24.0"`, `accesskit_macos = "0.26.0"`, `accesskit_unix = "0.22"`, `accesskit_windows = "0.34"`, wired per-platform (`gpui_macos`→accesskit_macos, `gpui_windows`→accesskit_windows, `gpui_linux`→accesskit_unix). PR **#61926 "gpui: Expose accessibility identifiers to platform clients" MERGED 2026-08-07** adds `accessibility_id(...)` and documents the mapping exactly: *"UIA `AutomationId` on Windows, `AXIdentifier` on macOS, and AT-SPI `AccessibleId` on Linux stacks whose deployed adapter exposes it."* (Zed is one accesskit minor behind: latest is 0.25.0, 2026-08-29.)

**The real API names** (not `accessibility_role`): `Element::a11y_role` / `.role(Role::…)` / `.aria_label()` / `.aria_level()` / `.aria_toggled()` / `.aria_numeric_value()` / `.aria_position_in_set()` / `.aria_keyshortcuts()`, `Element::a11y_synthetic_children` + `A11ySubtreeBuilder`, `Text::new_inaccessible`. Official example: `crates/gpui/examples/a11y.rs`.

Landing history: PR #51097 (cameron1024, staff) was created 2026-03-09, kept as a draft, and **closed unmerged 2026-05-07**; PR #54398 (huacnlee) closed unmerged 2026-04-21; **PR #56065 "gpui: Accesskit support" MERGED 2026-05-27** — and its scope statement is important: *"This PR **ONLY** adds AccessKit support to GPUI, and doesn't touch Zed… the first step to addressing #41138."* Follow-ups: #59429 (a11y settings UI, merged 2026-06-17), #60397 (landmarks + menu improvements, merged 2026-07-13; F6 landmark nav; `.aria_keyshortcuts()` "not yet reported to screen readers").

### **The caveat is much more serious than "unproven in the field" — this supersedes the earlier draft of this section**

I initially treated the widely-cited HN claim that GPUI is "opaque to screen readers" as *stale*, because AccessKit integration now exists. **That was too generous. The accurate picture is that a11y landed in `main` in May 2026 but Zed itself remains largely inaccessible, behind an opt-in flag:**

- **Zed's official position: no accessibility documentation page exists at all.** Both `https://zed.dev/docs/accessibility` and `docs/src/accessibility.md` return **404**.
- The best quotable staff statement, from PR **#59429**: *"accessibility features require zed to be launched with the **`ZED_EXPERIMENTAL_A11Y=1`** env var"* and *"**The main Zed UI is still largely inaccessible**, though a handful of shared components will now report themselves, but **the experience is suboptimal**."*
- **Issue #41138 "Windows: Screen reader accessibility missing completely" — OPEN since 2025-10-24**, 12 👍: *"Zed is absolutely inaccessible for screen reader users on Windows. Tested with latest JAWS and NVDA versions… **Zed is absolutely silent**."*
- **Issue #7895 "Accessibility: Voice Over Support" was CLOSED as `not_planned` on 2025-12-19.**
- **26 open issues** under the `area:accessibility` label, including #46817 (colourblind line statuses, S2), #48285 (macOS Voice Control typing in terminal, S2), #55835 (macOS menu bar + Japanese IME, S3), #57626 (markdown heading levels, S3), and #10647 (configurable mouse bindings, 229 👍).
- A GPUI macOS crash (SIGABRT) when an a11y client queried `AXFrame` on a closing window (root cause: `accesskit_macos::PlatformNode::frame` unwrapping `view.window()`) was filed as #61825 and closed 2026-07-29 — i.e. the a11y integration is young enough to still be shaking out crashes.

**Revised verdict: accessibility is PARTIAL, not SUPPORTED.** The *machinery* is genuinely good — a full AccessKit-backed tree with roles, ARIA-style properties, actions, synthetic children, text runs and text selection, wired to all three platform APIs, with a well-written in-repo guide and a working example. What is missing is *proof*: Zed's own UI is still "largely inaccessible" behind an experimental env var, Windows screen-reader support is reported as completely absent, and VoiceOver support was explicitly declined as a wontfix. **If accessibility is a compliance requirement (public-sector procurement, ADA/Section 508, EN 301 549), GPUI is not currently a defensible choice without a substantial independent effort — and you should assume you are building the a11y layer for your components yourself, then validating with NVDA/JAWS/VoiceOver.**

**Note on which crate actually ships a11y:** the published crate that contains it is **`gpui-pre` 0.3.4 (2026-09-07)** — Longbridge's snapshot, depending on `accesskit ^0.24.0` and exposing `_accessibility`, `Role`, `AccessibleAction`, `Toggled`, `A11yCallbacks`, `A11ySubtreeBuilder`. **Its crates.io owner is `huacnlee`, not the zed-industries team — it is not an official Zed crate.** Zed's own published `gpui 0.2.2` has **no accessibility whatsoever** (§4.8, opening).

### 4.9 Native integration

| Feature | Status | Evidence / API |
|---|---|---|
| **Native notifications** | ✅ **BUILT IN** (better than expected) | **Commit `de827bc`, PR #61189, 2026-07-17** "gpui: Add system notification platform APIs": `App::set_app_identity`, `show_system_notification`, `dismiss_system_notification`, `on_system_notification_response`; types `SystemNotification { tag, title, body, actions }`, `SystemNotificationAction`, `SystemNotificationResponse`. Linux via `notify-rust 4.18`; macOS via `objc2-user-notifications` + `UNUserNotificationCenter` (**requires a real `.app` bundle**); Windows via WinRT toasts + AUMID registry. Example: `crates/gpui/examples/system_notifications.rs`. *In `main` only, not in published 0.2.2.* |
| **Native file dialogs** | ✅ **BUILT IN — no `rfd` needed** | `Platform::{prompt_for_paths, prompt_for_new_path, reveal_path, open_with_system}` + `PathPromptOptions`. On Linux this routes through XDG portals (`ashpd`). |
| **Deep links / URL schemes** | ✅ **BUILT IN** | `Platform::{open_url, on_open_urls, register_url_scheme}` — both opening URLs and **registering/receiving** a custom scheme. |
| **OS drag & drop** | ✅ **SUPPORTED (in + out)** | `ExternalDragPayload` in core; gpuix `onFileDrop` delivers `paths` — "absolute Unicode filesystem paths" from Finder/OS. Changelog: "outbound drag-and-drop (`wl_data_source`, v1.15.0)" for Wayland. |
| **Keychain / secrets** | ✅ **BUILT IN** | `Platform::{write_credentials, read_credentials, delete_credentials}` (Linux: `oo7` + XDG `org.freedesktop.portal.Secret`). |
| **Menu bar** | ✅ SUPPORTED | `crates/gpui/examples/set_menus.rs`; gpuix auto-installs the macOS app menu (⌘Q/⌘H/⌥⌘H/⌘M/⌘W) and documents that macOS takes the app-menu title from the *executable*, so only a real `.app` bundle fixes it. **There is deliberately no Edit menu** — a menu key equivalent is consumed by AppKit before the window sees the key, so an Edit menu carrying ⌘C would steal the keystroke from text selection. |
| **Clipboard / images** | ✅ SUPPORTED | Changelog: "async clipboard access, **image paste**, streaming `Fetch` response bodies (v1.17.2)" on web; `x11-clipboard` on Linux. |
| **Screenshots / capture** | ✅ SUPPORTED | `screen-capture` feature via `zed-scap`. |
| **System tray** | ❌ **MISSING in core** | No tray module in `crates/gpui/src/gpui.rs` or `platform.rs`. `crates/gpui/src/platform/system_tray.rs` **404s on upstream `main`** (it exists only in a fork, `XDeme1/zed`). Third-party: `domenkozar/gpui-tray` (7★, created 2026-08-29, Apache-2.0), or the fork `fc-gpui` 0.9.0 (2026-08-31, advertising "system tray, global hotkeys, notifications"). Or use `tray-icon`/`muda` directly. |
| **Global shortcuts** | ❌ **MISSING in core** | No API found. Use `global-hotkey`. GPUI has `keymap`/`key_dispatch` for *in-app* shortcuts only. |
| **Single instance** | ❌ **MISSING in core** | No API found. `Platform::on_reopen`/`activate` exist but there is no instance guard. Use `single-instance`. |
| **Auto-update** | ❌ **NOT REUSABLE (and GPL)** | `crates/auto_update/` is **GPL-3.0-or-later**, depends on Zed-internal crates (`client`, `db`, `release_channel`, `workspace`) **and Zed's own cloud endpoint** `/releases/{channel}/{version}/asset`. Mechanism is bespoke: macOS = download DMG → `hdiutil attach -nobrowse` → `rsync -av --delete --exclude Icon?`; Linux = tarball → `rsync` into `~/.local` expecting `…/libexec/zed-editor`; Windows = silent installer + `tools/auto_update_helper.exe`. Polls hourly (15 min on nightly); `ZED_UPDATE_EXPLANATION` disables it for distro packages. **Not Sparkle, not GitHub Releases. Do not copy it into proprietary code.** Use `self_update`, or the `cargo-packager` + GitHub Releases pattern gpuix documents. |

### 4.10 Multi-window, titlebars, vibrancy

All of the following type names are verified from `crates/gpui/src/platform.rs` on `main`.

- **Multi-window: SUPPORTED.** `App::open_window(WindowOptions, …)`; example `move_entity_between_windows` moves a view between windows; PR #36548 allows the application to keep running after all windows are closed.
- **Window kinds: SUPPORTED and richer than expected.** `WindowKind::{Normal, PopUp, AnchoredPopup(PopupOptions), Floating, Dialog, LayerShell}`. Wayland `LayerShell` means you can build panels/docks/overlays correctly on Wayland. `WindowVisibility` handles occlusion.
- **Custom titlebar: SUPPORTED.** `TitlebarOptions { title: Option<SharedString>, appears_transparent: bool, traffic_light_position: Option<Point<Pixels>> }`; `WindowDecorations::{Server, Client}` (plus `Decorations::Client { tiling }`); `WindowOptions::app_owns_titlebar_drag` (macOS). On Linux, `WindowButtonLayout` / `WindowButton` are parsed from the GNOME `button-layout` setting (`MAX_BUTTONS_PER_SIDE = 3`), so you respect the user's desktop convention. gpuix surfaces this as `titlebarTransparent`, `trafficLightX`, `trafficLightY`. Also `crates/gpui/examples/window_shadow.rs`, `opacity.rs`, `window_movable.rs`, `grid_layout.rs`.
- **macOS vibrancy AND Windows Mica are both SUPPORTED — this corrects my earlier "Windows acrylic/mica UNVERIFIED".** `WindowBackgroundAppearance::{Opaque, Transparent, Blurred, MicaBackdrop, MicaAltBackdrop}`. `Blurred` is documented as "not always supported"; **`MicaBackdrop` / `MicaAltBackdrop` are the Windows 11 Mica and Mica Alt materials.** `WindowAppearance::{Light, VibrantLight, Dark, VibrantDark}` maps to macOS `NSAppearance`, with `Platform::set_window_appearance` to change it at runtime. gpuix exposes `windowBackground: "opaque" | "transparent" | "blurred"` and ships a dedicated `blurred-window` example ("A macOS frosted-glass surface using GPUI's native vibrancy backdrop and transparent titlebar").
- **Native macOS window tabs:** `tabbing_identifier` on `WindowOptions`.
- **Simple fullscreen on macOS (v1.17.2):** `Window::toggle_simple_fullscreen()` — borderless fullscreen without creating a new Mission Control space.
- **Background frame throttling (v1.17.2):** `WindowOptions::inactive_frame_interval`; plus `Animation::fps(...)` to cap refresh rate on high-Hz displays.

### 4.11 Video / audio / animated images

- **Animated GIF and animated WebP: SUPPORTED — verified by merged PRs, not inference.** **PR #21274 (2024-11-28) "GIF images now play when opened"** and **PR #20778 (2024-12-06)** added animated WebP (decoding frames into `image::Frame`). `crates/gpui/src/platform.rs` defines `ImageFormat::{Png, Jpeg, Webp, Gif, Svg, Bmp, Tiff, Ico, Pnm}` and imports `image::codecs::gif::GifDecoder`; `Image::use_render_image(...) -> Arc<RenderImage>` is the intended path for decoded frames. Known issue: high CPU when playing GIFs (#21563, opened 2024-12-04, closed 2026-03-30).
- **Video: MISSING in core; third-party exists.** `gpui-video-player` (`cijiugechu`) — "A video player library for gpui applications, built on top of **GStreamer**" (2,904 downloads; last release 2025-11-19 — **stale**). `open.cut`/`opencut` builds "a GStreamer-backed player and timeline editor" in GPUI, and Monocurl does media work — so it is done, but GStreamer is a heavy distribution dependency. `gpui_media` (Zed's macOS media bindings, Apache-2.0) is macOS-only.
- **Audio: MISSING in core.** Use `rodio`/`cpal` (as music-player apps like sonora, hummingbird, Pawse, rox presumably do). Note `gpui_media` exists for macOS media handling.

### 4.12 Fonts, shaping, bidi, emoji, i18n

- **Shaping/text stack.** GPUI has a `text_system` module. Per-platform: macOS uses **CoreText** (`core-text` dep in 0.2.2); Windows uses **DirectWrite** (README: "Windows — no features are required. Windowing uses Win32 and text uses DirectWrite"); Linux uses **`cosmic-text`** (0.14.0 in 0.2.2; the newer `gpui_wgpu` pins **`cosmic-text = "0.19.0"`**). `gpui_wgpu` also depends on **`swash`** and **`unicode-bidi`**. So: shaping via CoreText/DirectWrite on the two commercial platforms (both are full HarfBuzz-class shapers with proper CJK/emoji/variable-font support), and cosmic-text+swash+rustybuzz on Linux.
- **CJK font fallback:** platform text systems handle it; on Linux `cosmic-text` provides fallback chains. `font-kit` (Zed's fork `zed-font-kit 0.14.1-zed`, published to crates.io) provides font enumeration. **Caveat from the README itself:** on macOS, *"glyph rasterization needs `font-kit`. Without it, GPUI falls back to a placeholder text system that lays text out but renders no glyphs."* — a silent-failure footgun if you forget the feature.
- **Bidi/RTL: PARTIAL, and incomplete. Now verified (previously flagged UNVERIFIED).** Tracking issue **#31102 "RTL Right-to-Left Text Input/Rendering Support"** is **OPEN** (created 2025-05-21, updated 2026-08-29, **173 reactions**, label `area:internationalization`), and the core rendering bug **#7465 "Lines with RTL text aren't rendered correctly"** has been **OPEN since 2024-02-06** (101 reactions). There is an active 2026 PR series — **#57237** (Windows DirectWrite RTL glyph runs), **#57239** (bidi line mapping/caret), **#57240** (bidi-safe decoration painting), **#57241** (editor visual selection), **#60115** (gpui_wgpu: forces cosmic-text base direction to LTR, which is a *tell* that full bidi is not yet handled). Terminal RTL #24949; cursor #20545. **Net: no complete RTL/bidi support.** If Arabic/Hebrew is required, this is a genuine blocker, not a polish item.
- **CJK font fallback:** issue **#8971 "Fallback font family for CJK (non-ascii)"**; a `buffer_font_fallbacks` setting exists and is only *recently* honoured on the wgpu path (**PR #54878**). Flatpak-specific font-visibility issue #20026.
- **Emoji:** rendering has been repeatedly buggy — PR #51569 ("Fix emoji rendering in SVG preview") and PR #44197 (cherry-pick of #43856, "Further fix extraction of font runs from text runs") indicate font-run splitting for emoji/fallback has been fixed more than once.
- **Font weight:** issue **#14175 "Font weight does not change if set under a value of 500"** — a real limitation for fine typographic control. **Font features:** PR #27808 ("Add support for setting font features on Linux") is platform-specific. **Variable-font axes: no support found — UNVERIFIED.**
- **i18n / localization: MISSING upstream, and Zed itself is not localized. Now verified (previously flagged UNVERIFIED).** Issue **#7409 "Localization and support for different locales"** is **OPEN** (created 2024-02-05, updated 2026-08-30, **143 👍 / 147 reactions**, 43 comments, label `area:internationalization`). i18n pull requests were **closed unmerged**: **#7433** (2024-02-06, a `rust-i18n` draft), **#51798** (2026-03-18, Fluent — **closed 4 minutes after opening**), #21134. Two RFCs exist: discussion **#43592 "Localization/i18n RFC"** and **#46963 "Proposal: Internationalization (i18n) Support for Zed UI Menus"**. **GPUI provides no locale API and no i18n primitives.**
- **The clearest possible evidence that i18n must be built outside Zed:** the community localizes Zed by **patching release binaries**. **`LI-NA/zed-i18n`** — *"extracts UI strings from release versions of Zed and applies translations to create multilingual builds"* — is pinned to **Zed v1.19.2**, ships 13 languages (including zh-CN and zh-TW), adds its own `ui_locale` setting, **re-points the auto-update endpoint**, and states it is a *"community project unaffiliated with Zed Industries and is not officially endorsed."* Also relevant: `easy-gpui-l10n` 0.1.0 (2026-08-24, CSV-first localization for GPUI, 18 downloads).
- **Recommendation for a third-party app:** use **`rust-i18n` 4.2.2** (3.35M downloads, updated 2026-09-08, by Longbridge — the `gpui-kit` org, which pins `rust-i18n = "4.2.0"`) or **`fluent`** yourself, behind a context accessor. GPUI neither helps nor hinders here; i18n is entirely your layer.
- **Pluralization/formatting, locale-aware dates/numbers:** not provided; use `fluent`/`icu` crates.

### 4.13 Printing — **MISSING**

No print support in GPUI core (no print module in the crate root; no examples; no issues found claiming support). You would need to render to an image/SVG and hand off to the OS print dialog yourself, or shell out. **Effort: high and bespoke.** If printing is a hard requirement, this is a genuine gap.

### 4.14 Testing — **SUPPORTED (better than most Rust GUI stacks)**

- `#[gpui::test]` macro plus `TestAppContext` ("provides ways of simulating common platform input") and `VisualTestContext`, behind the `test-support` feature.
- Deterministic scheduling is a first-class design goal. Zed co-founder Nathan Sobo on HN (2025-10-27): *"GPUI has a mature scheduling story, letting you 'block' the main thread on spawned tasks with async/await. It also comes with a **deterministic random test scheduler** for driving out timing bugs."*
- `proptest` is re-exported behind `test-support`; the crate root re-exports `bench` and `property_test` macros, and defines `bench_group!`/`bench_main!` over Criterion.
- Benchmarks: `bench-support`/`profiler` features, `GpuSpecs`, on-screen debug histograms (v1.17.2), and "deterministic test settling (`BenchAppContext::settle()`, v1.17.2)".
- **Ready-made UI harnesses exist:**
  - **`gpui-storybook`** — Storybook-like library for GPUI apps.
  - **gpuix automation** — `testId` + `connectTest(renderer)` giving a **Playwright-shaped** API: `app.getByTestId('composer').fill('hello')`, `.click()`, `app.screenshot({path})`, plus **`app.clock.pause()` / `app.clock.fastForward(200)`** for deterministic animation testing. Works in vitest, in a browser page (`globalThis.gpuix`), and against a child process. This is the most mature testing story I found in the ecosystem, and it is Apache-2.0.
- **Snapshot/screenshot testing** in Zed itself: UNVERIFIED (I did not confirm a Zed-side visual-regression harness).

### 4.15 Hot reload / dev experience / compile times

**Hot reload: MISSING (with one declined attempt), but PARTIAL at the React/script layer.**
- **There is no merged GPUI hot reload.** The one serious attempt was **PR #41508 "gpui: Hot-reloading with subsecond" (someone13574) — created 2025-10-30, CLOSED 2025-12-20, never merged** (assignee mikayla-maki, 31 reactions). Its own scope caveat is telling: *"it only works for the tip crate (ie. the one with `main.rs`), so it will be of limited usefulness to zed … but may be useful to other people working in single-crate projects or in gpui examples."* There is no merged-then-reverted attempt.
- **`runtime_shaders` is NOT UI hot reload** — it is a macOS-only build knob that compiles Metal shaders at runtime instead of build time (`build.rs`), and carries a file-top `//TODO: deprecate "runtime-shaders" and "macos-blade"`.
- **The practically meaningful hot-reload story is at the React layer:** gpuix with `bun --hot` "remounts React on the same window" on save; in-browser React Fast Refresh preserves `useState`, composer text, sidebar selection and scroll position without re-creating the GPUI canvas or re-fetching the ~19 MB Wasm module. gpuix documents the rules for making this work (do not call `import.meta.hot.accept("./your-app", …)` in the entry file; keep the native import out of any Refresh boundary).
- **Alternative:** `gpui-shell` (QuickJS/TypeScript inside the Rust host) is a *scripting* escape hatch that gives reload-without-recompile for panels and business logic, under a capability model. `Slag` ("Scriptable, hot-reloadable GPUI framework") and `crepuscularity-runtime` v0.4.19 ("hot-reload engine … UNSTABLE; in active development") are early third-party efforts.

**Compile times: POOR, acknowledged, and now quantified — but a from-scratch figure does not exist.**
- **Best hard number, incremental:** PR **#62059 "Speed up `cargo build -p zed` compilation" (SomeoneToIgnore, staff) MERGED 2026-08-01**: *"With sccache disabled and project fully built, `touch crates/editor/src/editor.rs` and `cargo build -p zed` took time Before (5e1fd392f6): **13.19s** After: **11.85s** (−10.2% speed up)"* — achieved by splitting the crate graph (`editor → picker_preview → search → project_panel → open_path_prompt → recent_projects → title_bar → collab_ui → zed` became `editor → picker_preview → search → agent_ui → sidebar → zed`).
- **No from-scratch wall-clock figure is published.** Zed's `CONTRIBUTING.md` and `docs/src/development/{macos,linux,windows}.md` are all silent. A community thread (Discussion #17065 "How long does it take for you to build zed-git?") exists but I could not retrieve its contents. **UNVERIFIED — measure it yourself.**
- **Mitigations Zed already ships** (root `Cargo.toml`), which tell you how bad the naive case is: `[profile.dev] incremental = true, codegen-units = 16, debug = "limited"`; a mirrored `[profile.dev.build-override]` whose comment says *"without this cargo will compile **~400 crates twice**"*; `[profile.release] lto = "thin", codegen-units = 1`; a dedicated **`[profile.release-fast]`** (lto = false, codegen-units = 16) for fast release iteration; proc-macros at `opt-level = 3`; per-crate `codegen-units = 1`. The workspace has **~215 members**. A clippy comment notes *"Running ./script/clippy can take several minutes."*
- `gpui-kit` similarly tunes `[profile.dev] codegen-units = 16` with explicit per-package `opt-level = 3` overrides for `gpui-pre`, `taffy`, `resvg`, `rustybuzz`, `ttf-parser`, `tree-sitter`, `ropey`, `syntect`, `quickjs-*` and others, and notes QuickJS alone: *"without these two a debug build spends roughly three times as long in every script render."*
- **Practical read:** dependency-heavy first builds will be long (wgpu + naga + taffy + resvg/usvg + tree-sitter + cosmic-text + platform SDKs + `bindgen` on macOS), and incremental builds of a large app are in the ~10 s+ range for a *single touched file* even in Zed's own hand-tuned setup. Two documented DX papercuts from Zed's macOS dev docs: opening the repo inside a dev build causes continual rebuilds, and macOS Gatekeeper build verification adds seconds per iteration.
- **Countervailing DX positive:** the published `gpui` 0.2.2 crate ships **23 examples**, including `uniform_list`, `list_example`, `text`, `text_wrapper`, `a11y`, `input`, `tree`, `grid_layout` — so the primitive surface is discoverable.

### 4.16 Packaging / signing

**How Zed ships.** Zed distributes via `zed.dev/download` plus native package managers (macOS/Linux/Windows), and its repo carries `Dockerfile-distros`, `Dockerfile-cross`, `corgi.toml`/`corgi-patches` and `script/` release tooling. Zed's own auto-update mechanism is **UNVERIFIED** in detail (I did not fetch the updater code; historically it uses Sparkle on macOS and an auto_update crate).

**What a third-party GPUI app must do — and there is a documented path.** gpuix's README is effectively a packaging cookbook:
- **`cargo-packager`** (`cargo install cargo-packager --locked`), formats: macOS `"app"` then `"dmg"`, Windows `"nsis"`, Linux `"appimage"`. Packager builds **host OS only** — run it on macOS, Linux, and Windows.
- Icons must be a real `.icns` (iconset via `sips` + `iconutil`); a 1024 PNG is rejected with `No matching IconType`.
- Signing is automatic when `CARGO_PACKAGER_SIGN_PRIVATE_KEY` and `..._PASSWORD` are set; `cargo packager signer generate` produces the keypair.
- **Auto-update:** host bundles + `.sig` files on GitHub Releases; the app calls `checkUpdate(version, { endpoints: ['https://github.com/OWNER/REPO/releases/latest'], pubkey })`. Gotchas documented: macOS updater needs the **`.app.tar.gz`** (not `.app`, not `.dmg`); a missing sibling `.sig` is an error; the repo must be public or GitHub 404s; `downloadAndInstall()` does **not** relaunch.
- **Notarization** (macOS `notarytool`, Windows EV/OV code signing) is not provided by any GPUI tool; you do it in CI yourself — the same as any native app.
- Single-binary shipping works: `bun build --compile app.tsx --outfile dist/app` produces a self-contained binary carrying the renderer.
- Alternative: **`cargo-dist`** (used widely in the Rust ecosystem) is not documented for GPUI but is stack-agnostic.

### 4.17 GPU requirement / software rendering / remote desktop — **HARD GPU REQUIREMENT; NO SOFTWARE FALLBACK**

This is a **corrected and much more severe** finding than a first reading suggests.

Zed's own documentation states the requirement plainly:
- **Linux:** *"**Zed requires a GPU to run effectively. Under the hood, we use Vulkan**…"* Failure mode: `Zed failed to open a window: NoSupportedDeviceFound`.
- **Windows:** *"**Zed requires a DirectX 11 compatible GPU to run**… If you're running Zed inside a virtual machine, it will use the emulated adapter provided by your VM. While Zed will work in this environment, performance may be degraded."*
- **SwiftShader is not mentioned anywhere** in Zed's docs.

The wgpu backend **deliberately refuses CPU adapters.** `crates/gpui_wgpu/src/wgpu_context.rs`:
- `instance()` requests `wgpu::Backends::VULKAN | wgpu::Backends::GL`.
- Adapter selection sorts `DiscreteGpu > IntegratedGpu > Other > VirtualGpu > Cpu`.
- **`new_rejecting_software()` exists and explicitly skips `DeviceType::Cpu`** with the log message `"Skipping software renderer"`.
- If nothing qualifies: `anyhow::bail!("No GPU adapter found that can configure the display surface")`.

**Detection exists; fallback does not.** `GpuSpecs { is_software_emulated, device_name, driver_name, driver_info }` lets you *observe* that the GPU is `llvmpipe`-class — but you cannot then degrade to CPU rendering, because the adapter was already rejected. `WgpuContext::device_lost()` does handle driver crash / suspend-resume by recreating the context.

**Blade is no longer the Linux path.** PR **#46758** *"gpui: Remove blade, reimplement linux renderer with wgpu"* (zortax) — `gpui_linux`'s `wayland`/`x11` features now pull in `gpui_wgpu`. (Historically the Linux port was Blade, PR #7343 by kvark. `github.com/zed-industries/blade`'s README now 404s on both `main` and `master`.) Windows uses **D3D** (DX11 required per docs); macOS uses **Metal**.

**Remote desktop is a known, open failure.** Issue **#26692** *"Zed does not work in Remote Desktop session on windows"*, and RFC discussion **#50972** *"[RFC] Native CPU/software renderer fallback on Windows via WARP"*. *(Titles and URLs verified via search; I was rate-limited before reading their bodies — flagged.)* Related: #30876 and discussion #36522 (unsupported GPU on RK3588), #39806 (Raspberry Pi V3D corruption).

**Bottom line:** GPUI **can detect and refuse** a software GPU; it **cannot degrade to CPU rendering**, and there is no WARP/SwiftShader/llvmpipe path. For a product that must run in VMs, over RDP, in Citrix/AVD, or on old corporate laptops with basic display adapters, this is a **hard compatibility cliff**, not a performance caveat. **This is now the second-largest risk in the assessment after the webview**, and it is the one place where Electron has a structural advantage that GPUI cannot currently match. Test a real RDP session and a GPU-less VM before committing.

### 4.18 Mobile / wasm / other targets

- **Web/wasm: actively being built, not yet officially shipped.** `crates/gpui_web/Cargo.toml` is a real, Apache-2.0, `publish = true` crate targeting `cfg(target_family = "wasm")`, depending on `gpui`, `gpui_wgpu`, `scheduler`, `wasm-bindgen`, `wasm-bindgen-futures`, `web-sys`, `js-sys`, `console_error_panic_hook`, with a `multithreaded` feature using a **forked `wasm_thread`** (`github.com/zed-industries/wasm_thread`, rev-pinned). The `web-sys` feature list is broad and includes **`CompositionEvent`** (IME), **`DragEvent`/`DataTransfer`** (drag & drop), **`Clipboard`/`ClipboardItem`**, **`ResizeObserver`**, `VisualViewport`, `ReadableStream`, `IdleDeadline`, `MediaQueryList`.
- `gpui_platform` routes wasm to `gpui_web`; `gpui` itself has `#[cfg(target_family = "wasm")]` dependency blocks and `#[cfg(not(target_family = "wasm"))] pub use pollster::block_on;`.
- Changelog (Aug 2026): "Web Runtime APIs: async clipboard access, image paste, streaming `Fetch` response bodies (v1.17.2), background worker fetch requests (v1.14.2)"; digest headline: "Rust UI in the browser"; "compiling native GPUI applications directly to WebAssembly and hosting them smoothly in the browser practical without custom web shims."
- **But Zed's README still says:** "Other platforms are not yet available: Web ([tracking discussion](https://github.com/zed-industries/zed/discussions/26195))." So: *working, demoware, not productized.* Real-world proof it runs: gpuix ships a browser canvas build with WebGPU ("The ChatGPT example rendered in a browser canvas with WebGPU"), requiring nightly Rust, `wasm-bindgen-cli 0.2.127`, shared memory, and COOP/COEP headers. Web build size ~19 MB Wasm.
- **Mobile: third-party only.** `gpui_apple` was "extracted to prepare the foundation for upcoming **iOS/iPadOS** runtimes" and "initial touch APIs" landed in v1.12.0 (Aug 2026 digest) — so mobile is *groundwork*, not a target. `itsbalamurali/gpui-mobile` is a third-party iOS (Metal) / Android (Vulkan) attempt. Codux is described as "spanning desktop, mobile, and headless hosts", which suggests a third-party mobile path exists. **Do not plan on official mobile.**

---

## 5. Comparative context

*(This section integrates a parallel survey of alternative stacks; where a claim rests on a source I did not personally open, the source is given so it can be checked.)*

### 5.1 The candidates, scored against this app's needs

| Stack | Version / date (live-verified 2026-09-12) | License | Webview | Terminal | PDF | CJK IME 2026 | 3rd-party widgets | Mobile/WASM | Verdict for this app |
|---|---|---|---|---|---|---|---|---|---|
| **Electron** (baseline) | **44.3.0, 2026-09-09** — Chromium **152.0.7977.78**, Node 24.20.0; supporting 44/43/42; nightly 46 on Chromium 155 | MIT | ✅ iframe / `WebContentsView`; **`<webview>` explicitly discouraged by Electron's own docs** ("undergoing dramatic architectural changes… We currently recommend to not use the `webview` tag") | ✅ xterm.js + node-pty | ✅ PDF.js | ✅ Solved | ✅ Huge | ❌ mobile / ✅ wasm-ish | **Zero unknowns.** The baseline to beat |
| **Tauri v2** | **2.11.5, 2026-07-01**. **Tauri v3 does not exist** — max_version is 2.11.5 and the newest blog posts are "Tauri Board Elections 2026" (Jun 30, 2026) and "Experimental Tauri Verso Integration" (Mar 17, 2025) | **Apache-2.0 OR MIT** | ✅ System webview — but **four engines**: WebView2 (Windows, self-updating), WKWebView (macOS/iOS), webkit2gtk (Linux), Android WebView | ✅ sidecar + web | ✅ web | ✅ Solved (delegates to OS) | ✅ Huge (the web) | ✅ iOS/Android | **Lowest-risk real migration.** Reuses your React UI; "minimal app < 600KB". Cost = per-OS webview divergence (Tauri's own webview-versions page concedes the Linux list is "a very incomplete list"; Ubuntu 22.04 → webkitgtk 2.36) |
| **Avalonia 12** | **12.0.0 shipped 2026-04-07** (".NET 10 + SkiaSharp 3.0"); 122M builds / 2.1M projects claimed; 19 staff | **MIT core**; commercial components paid | ✅ **WebView open-sourced for 12.0** (`AvaloniaUI/Avalonia.Controls.WebView`; "native platform web rendering: no Chromium bundling") | ⚠️ via webview | ⚠️ 3rd-party | ⚠️ Unverified | ✅ Good (+paid) | ✅ | **The only credible non-web rewrite.** Also: "the first .NET UI framework to ship a native Linux accessibility backend" (AT-SPI2). Hard parts (Rich Text Editor, Tree Data Grid, Markdown Viewer, Charts) are **paid** components |
| **Qt 6.11** | 6.11.0 2026-03-23; **6.11.2 2026-08-18**; 6.11.3 due 2026-09-24. No Qt 7 | **LGPLv3 / GPLv3 / commercial**; a specific module set is **GPL-only, not LGPL** (Qt Graphs, Quick 3D, Virtual Keyboard, Wayland Compositor, GRPC, MQTT, …) | ✅ QtWebEngine = **Chromium 140.0.7339.264** with security backports from 151 | ✅ QTermWidget | ✅ QtPdf | ✅ Mature | ✅ Largest | ✅ | **Technically the best fit.** QtWebEngine/QtPdf/QTermWidget/QSS/Linguist cover everything. cxx-qt 0.10.0 (2026-08-24, MIT OR Apache-2.0) for Rust. Cost = C++-first + standing LGPLv3 compliance (dynamic linking, relink rights, notices) |
| **GPUI** (+ `gpui-kit` / gpuix) | Engine commits **today**; crates.io artifact frozen at **0.2.2 (2025-10-22)** | **GPUI Apache-2.0**; Zed crates above it **GPL-3.0-or-later** | ⚠️ **Weak** — `gpui-wry` / wry child view; nothing in core | ✅ Multiple shipping GPU terminals | ✅ `hayro` + `gpui-pdf` | ⚠️ **12 open IME issues**; works but see §4.1 | ✅ 112 catalogued projects; ~10 direct analogues | ⚠️ wasm working/not productized; mobile groundwork only | **Viable and genuinely native**, gated on the IME/webview/RDP spikes |
| **Dioxus** + Blitz | dioxus stable **0.7.10 (2026-07-30)**, 0.8.0-alpha.1 (2026-07-31); **Blitz 0.1.1** (dev line 0.3.0-beta.2) | MIT OR Apache-2.0 | ⚠️ wry yes / **Blitz no** | ❌ | ❌ | ❌ **Broken** — Blitz issues #272, #287; PRs **#843/#844 still open 2026-09-08** | ❌ | ✅ | **Not on Blitz.** README: *"currently in a beta state… many bugs and missing features."* CSS status page: `position:static`, **`fixed`, `sticky`, `overflow:auto`**, container queries, `text-overflow`, `line-clamp`, 3D transforms, SVG fill/stroke all **unsupported** — fatal for sticky headers and auto-scrolling transcripts. `dioxus-native` parity issue #4479 still missing `element.scrollTo`, raw DOM access, `History`. Dioxus-on-wry is a viable Tauri variant |
| **Slint** | **1.17.1, 2026-07-07**; license string `GPL-3.0-only OR LicenseRef-Slint-Royalty-free-2.0 OR LicenseRef-Slint-Software-3.0`; royalty-free tier **excludes Embedded Systems**; commercial embedded from $1.00/device | GPL-3 / royalty-free / commercial | ❌ **No webview element at all** — issue **#3930 open since 2023-11-14**, `roadmap`, 31 👍 | ❌ | ❌ | ⚠️ issue **#8716** (2025-06-17): **UI freezes entirely** switching to Microsoft Pinyin on Win10; #2658 Sogou candidate window misplacement; PR #13193 (2026-09-03) concedes C++ backends leave "any CJK input source out of reach" | ⚠️ Small | ✅ | **No** — no webview, and you would pay a licence while still writing the editor, PDF viewer and terminal |
| **Iced** | **0.14.0, 2025-12-07**, MIT, MSRV 1.88 | MIT | ❌ | ❌ | ❌ | ❌ **CRASH** — PR **#3290** *"Fix IME preedit slicing"* (opened 2026-03-22, **still open**, touched 2026-09-08): *"the composing string was sliced directly with byte ranges, which can panic if the IME returns a range that is not on a valid UTF-8 boundary"* | ⚠️ `iced_aw` 0.14.1 — but 0.14 **dropped** grid, modal, split, floating_element, cupertino that existed in 0.12 | ⚠️ | **No.** A panic on Chinese input is disqualifying. README: *"Iced is currently experimental software."* |
| **egui** | **0.36.2, 2026-09-08**, MIT OR Apache-2.0 | MIT/Apache-2.0 | ❌ | ❌ | ❌ | ❌ **8 open IME issues**, oldest 2022: #3532 (Chinese punctuation, open since 2023-11-06), #4486, #2317 (Microsoft Pinyin on Win11), #7974/#7975 (2026-03-13, Korean on macOS/X11) | ⚠️ Medium | ✅ WASM | **No.** README: *"having a very large UI in a scroll area (with very long scrollback) can be slow, as the content needs to be laid out each frame"* — exactly your long-chat-transcript requirement. Non-goal: "Native looking interface" |
| **Floem** | **crates.io 0.2.0, 2024-11-14** (repo pushed 2026-06-21) — ~22 months stale | MIT | ❌ | ❌ | ❌ | ⚠️ Unverified | ❌ | ❌ | **No.** Pre-1.0, single-vendor, stale crate, no widgets in the areas you need |
| **SwiftUI + WinUI 3** | macOS 26 / Xcode 26; **Windows App SDK 2.4.0, 2026-08-13** | WinAppSDK MIT; Apple SDKs proprietary | ✅ WKWebView / WebView2 | ⚠️ per-platform | ✅ PDFKit / Windows.Data.Pdf | ✅ Native | ✅ per-platform | ❌ | **No** for this app — ~2× work: two view layers, two a11y stacks (UIA vs NSAccessibility), two IME stacks (AppKit input methods vs TSF), and four separate hard-widget integrations |
| **Flutter desktop / Uno** | Flutter **3.47** | BSD / MIT | ⚠️ uneven on desktop | ⚠️ packages | ⚠️ packages | ⚠️ Unverified | ✅ Large | ✅ | Dark horse if you accept a non-native look |

### 5.2 Reading of the comparison

- **If the goal is "same app, less memory, no Chromium bundle":** **Tauri v2** is the rational answer, and it is a migration of the *shell*, not the UI. Tauri 2.11.5 is current (2026-07-01) and **there is no v3**. Accept the per-OS webview divergence as a permanent tax.
- **If you want a genuinely native, non-web rewrite and your team is .NET-shaped:** **Avalonia 12.0** is the strongest option — MIT core, a real native webview that was open-sourced in 12.0, the first Linux AT-SPI2 accessibility backend in .NET, and commercial components (Rich Text Editor, Tree Data Grid, Markdown Viewer) that map directly onto this app's hard parts. Budget for those licences.
- **If full-OS integration and maximum native maturity outrank migration cost:** **Qt 6.11** hosts every requirement natively (QtWebEngine Chromium 140 + 151 backports, QtPdf, QTermWidget, mature CJK IME, Qt Linguist for i18n, QSS theming), at the price of a C++-first codebase and a standing LGPLv3 compliance burden (dynamic linking, relink rights, notices; static linking effectively off the table, which collides with App Store distribution).
- **If native GPU rendering in Rust is the actual goal:** **GPUI** is the only Rust stack whose native text/list/terminal story is proven at this app's shape — because `gpui-kit` and gpuix already built the pieces and ~10 agent-workbench apps ship on it. Nothing else in Rust comes close for this workload.
- **Hard exclusions, on evidence rather than taste:**
  - **Iced** — an open PR fixing a *panic* when typing Chinese (PR #3290), still open after ~6 months, on a framework whose README says "currently experimental software".
  - **egui** — eight open IME issues dating to 2022, plus its own README conceding that very long scrollback is slow precisely because it relayouts every frame.
  - **Blitz / Dioxus-native** — `position:sticky`/`fixed`/`overflow:auto` unimplemented, and CJK IME repairs still open as of 2026-09-08.
  - **Slint** — no webview element has existed since issue #3930 was opened on 2023-11-14.
  - **Floem** — stale, thin, single-vendor.
- **Cross-cutting observation worth surfacing:** **CJK IME is the universal weak axis across essentially every Rust-native toolkit in 2026.** egui, Iced, Slint, Blitz and GPUI all have open CJK-IME defects (GPUI's are documented in §4.1). The only stacks with a *solved* CJK input story are the ones that delegate text entry to a browser engine or to Qt/AppKit: Electron, Tauri, Qt, Avalonia, SwiftUI/WinUI. If Chinese input is a first-class requirement for a global user base, that is the single most clarifying fact in this whole study — and it argues either for a webview-based shell, or for accepting a hand-tuned IME effort on GPUI.
- **Governance note, two days old:** on **2026-09-10 Dioxus Labs announced it is joining Cognition**. The team continues Dioxus, Blitz, Taffy and Subsecond and says it "will be investing heavily in Dioxus-Native and Blitz" (with Blitz lead Nico Burns going full-time), but also that "we will naturally have less time to devote entirely to Dioxus". Treat the Blitz investment claim as promising and unproven; a vendor claim that Cloudflare "leveraged Blitz as the core engine of their new agentic web browser" is **unverified**.

### 5.2 Reading of the comparison

- **If the goal is "same app, less memory, no Chromium bundle":** Tauri v2 is the rational answer, and it is a migration of the *shell*, not the UI. Tauri v2.11.5 is current (2026-07-01) and there is no v3.
- **If the goal is genuinely native rendering and GPU-fast UI:** GPUI is the only Rust option whose *native* text/list/terminal story is proven at this app's shape — largely because `gpui-kit` and gpuix have already built the pieces, and because ~10 agent-workbench apps already ship on it.
- **If the webview panel is load-bearing** (arbitrary third-party sites, OAuth flows, embedded docs that need real JS/CSS): that is GPUI's weakest axis and the strongest reason to prefer Tauri/Qt/Avalonia. If the "browser" is really an authenticated web app you control, or mostly static docs, GPUI is fine.
- **Iced, egui and Blitz should be ruled out on CJK-IME and rich-text grounds specifically.** That is a concrete, sourced disqualification, not a taste judgement.

---

## 6. Community sentiment

### 6.1 The recurring complaints, with sources

**"The capability layer is too thin — it's a framework for building frameworks."**
- `landr0id`, HN, 2026-05-03 ([48001979](https://news.ycombinator.com/item?id=48001979)): *"Their GUI system (GPUI) is not very mature for use outside of Zed. GPUI is basically a UI framework in the truest sense: a framework for building UI… frameworks/components. It has core functionality for async execution, an ECS for grabbing shared resources, and a div. **It's basically like building a website with div and basic CSS.**"* … *"Up until sometime late 2025 GPUI wasn't even on crates.io, and it seems like the GPUI-component ecosystem still promotes using git deps. **It was also in 'read the code for docs' state for a very long time**"* … *"there were weird things missing too like the **Scrollbar was located in Zed's UI component crates instead of core GPUI**. Arbitrary text selection also is not possible, which is something I really value about egui."*
- `Vanuan`, HN, 2026-09-04 ([49569760](https://news.ycombinator.com/item?id=49569760)): *"this is the first 'problem' you hit when you start learning GPUI. The 'capability' layer is so thin that **GPUI should be treated as a framework to build frameworks**, not a standalone OOTB platform like Qt or Electron… it create[s] conditions for **extreme fragmentation** that is only comparable to Web Browser wars. So until some committee emerges to bring us 'HTML5' of GPUI or Zed coughs up resources to take back GPUI reigns, the chaos will continue."*

**Vendor lock-in / monorepo / breaking changes.**
- `jenadine`, HN, 2025-05-07 ([43916888](https://news.ycombinator.com/item?id=43916888)): *"GPUI is built specifically for Zed. It is in its monorepo without separate releases and **lots of breaking changes all the time**. It is pretty tailored to making a text editor rather than being a reusable GUI framework."*
- `jenadine`, same day ([43918129](https://news.ycombinator.com/item?id=43918129)): *"it still pulls `gpui` directly from the Zed monorepo via a git dependency… **Until they split it out, version it properly, and stop breaking stuff all the time, it's hard to treat GPUI as a serious general-purpose option.**"*
- `yencabulator`, HN, 2026-07-30 ([49113797](https://news.ycombinator.com/item?id=49113797)): *"isn't it kinda scary to write a lot of code on top of GPUI that's effectively only serving Zed?"*
- `luca-ctx`, HN, 2026-08-13 ([49288519](https://news.ycombinator.com/item?id=49288519)): *"I experimented with gpui from zed, that was **even harder to work with**."*

**Accessibility (now stale).**
- `andrewl-hn`, HN, 2025-10-27 ([45721492](https://news.ycombinator.com/item?id=45721492)): *"it's **opaque to screen readers**. At the moment if you want to have good accessibility story you should probably look at Slint or Qt."* — **Superseded**: AccessKit integration now exists in `main` (§4.8). Still a useful signal that this was a long-standing gap.

**The counterweight — genuine enthusiasm and a specific technical compliment.**
- `nathansobo` (Zed co-founder, GPUI author), HN, 2025-10-27 ([45724506](https://news.ycombinator.com/item?id=45724506)): *"GPUI has a mature scheduling story, letting you 'block' the main thread on spawned tasks with async/await. It also comes with a **deterministic random test scheduler** for driving out timing bugs."*
- `jpgvm`, HN, 2026-08-16 ([49316674](https://news.ycombinator.com/item?id=49316674)): *"I built my first 'real' GUI app recently… **I used GPUI** and the one-dark theme from Zed and it's super smooth, the code is super easy to understand and I love the way it looks… as a Rust dude I definitely grokked it easily."*
- `the__alchemist`, 2025-10-27: *"because of its origin as being purpose built for the Zed editor, this immediately gives it credibility."*
- `shdh`, 2026-04-30: *"The best thing about Zed is GPUI."*
- `shubham_sinha`, 2026-08-16: *"**GPUI is going to be react for Rust ecosystem.** Everyone seems to be on Rust & GPUI bandwagon these days."*

**The skeptic's ceiling argument.**
- `wolvesechoes`, HN, 2025-10-28: *"Truth is Rust doesn't have, and will not have anytime soon anything comparable to Qt or VCL/LCL."*

### 6.2 Biggest thread

HN **#45719004 "Rust cross-platform GPUI components"** (longbridge/gpui-component) — **515 points, 218 comments, 2025-10-27**. This is where most third-party evaluation happened. Notably, there was **no** comparable HN thread for the `gpui` crate itself when 0.2.2 landed — the ecosystem's attention went to the component library, not the engine.

### 6.3 The September 2026 governance rupture (the "315-Day Vacuum")

Primary-ish source: [gpui-archipelago, "The 315-Day Vacuum", September 2026](https://gpui-archipelago.github.io/news/315-day-vacuum/) — **partisan community outlet** ("every fork is an island", "still extremely alpha"). The specific quotes it reproduces are attributable and consistent with API data I independently verified.

What happened, with dates:
- By **2026-09-02**, **315 days** had passed since the last official GPUI crates.io release, with **523 commits** piled up on upstream `main`. (My own crates.io data: 0.2.2 is 325 days old on 2026-09-12. Consistent.)
- **Jason Lee (`huacnlee`)**, lead maintainer of `gpui-component` (Longbridge), publicly called this out and gave a 24-hour ultimatum.
- When no release came, he republished Zed's GPUI crates himself as **`gpui-pre-*`** — `0.3.0` through `0.3.3` all pushed on **2026-09-03** (apparently manually; the promised CI was not yet running) — and unveiled the **GPUI Kit** restructuring (`gpui-kit` facade + `gpui-base` + `gpui-component` + `gpui-shell`).
- **Zed's official response:** *"Hey Jason, we will start working on infra to automatically publish GPUI releases by the end of the month. For now, GPUI will remain in the Zed repo, but we're aiming for more frequent releases as a goal."*
- The article also documents that the community had already solved this via `gpui-unofficial`, and that Lee had rejected it. In **April 2026** he closed `gpui-component` issue **#2234** (switch to `gpui-unofficial`) as "not planned": *"No, I don't think that is good choice. There was gpui-ce before, and now gpui-unofficial. However, I was never optimistic about them from the beginning. **These projects just create problems without fixing them**; I don't think it's worth wasting time on them. Only projects validated by real-world applications will generate continuous real-world demand…"* In **May 2026** he closed PR **#2404** unmerged with a single word: *"No!"*
- A community summary the article quotes from `cosoc`: *"The community wants independence, but lacks a unifying leader. The engine team has no one focused on driving external progress. The ecosystem library authors aren't willing to risk backing uncertain branches. Zed has the resources, but their eyes are elsewhere. Verdict: **It's a long road ahead. Choose your dependencies carefully.** Meeting adjourned."*
- A **naming collision** followed: Longbridge's `gpui-component`→`gpui-kit` rebrand clashes with Nate Butler's pre-existing **`gpuikit`** repo (169★, created 2023-10-04, still active).

**How to read this.** Treat the article's *framing* (who was unreasonable) as opinion. Treat the *facts* — dates, crate names, the 523-commit gap, the quoted Zed commitment, the rejected PRs — as reliable, because they match my independent crates.io and GitHub API data. The practical takeaway is the last quote: **choose your dependency deliberately, and know which harbour's rules you are accepting.**

---

## 7. Synthesis: capability matrix

Verdicts: **SUPPORTED** = shipping, evidenced; **PARTIAL** = possible but you build it and/or it is rough; **MISSING** = not available, build from scratch or use a non-GPUI crate. See §7.1 for the five verdicts that changed during research.

| # | Requirement | Verdict | Best available path | License of that path | Notes / risk |
|---|---|---|---|---|---|
| 1 | Multi-panel resizable layout | **SUPPORTED** | `gpui-kit` Dock Layout ("resizable panels, draggable tabs, nested splits, edge docks — all serializable") | Apache-2.0 | Or hand-roll with `div`/Taffy flex+grid |
| 2 | Long scrolling chat transcripts | **SUPPORTED (with care)** | `uniform_list` / `list()` (both in published 0.2.2) / `gpui-kit` virtual lists / gpuix `<virtual-list>` | Apache-2.0 | **Must coalesce streaming updates** (zTerm needed ~4 ms batching). The variable-height `List` API is awkward enough that Zed deferred using it for 21+ months (#21403). Open S2 perf bug #58900 on scrolling highlighted text. Official budget: **8 ms/frame**. Published 0.2.2 lacks `ListAlignment::Center` and has no `Scrollable` trait |
| 3 | Markdown + code highlighting | **PARTIAL** | `gpui-base`/`gpui-component` 0.6.1 (`text::markdown`, `text::html`, `TextView`, `MarkdownPlugin`, `MarkdownExtensions`, `TableData`), or gpuix `<markdown>` + `<code>` (Syntect, Rust-side) | Apache-2.0 | Zed's `crates/markdown` is **GPL + unpublished** — unusable. Streaming markdown demonstrated (`example-stream-markdown`). Both good options depend on `gpui-pre` (Longbridge's snapshot), **not** on crates.io `gpui 0.2.2` |
| 4 | Rich text / markdown editing | **PARTIAL** | `gpui-component`'s editor as a mode of `InputState` (`InputMode::CodeEditor`) on `ropey =2.0.0-beta.1` + `tree_sitter ^0.26.13` + `lsp-types ^0.97` | Apache-2.0 | Zed's `crates/editor` is **GPL-3.0-or-later, unpublished, and has 41 internal Zed deps** (incl. `workspace`, `project`, `client`, `rpc`, `dap`) — not viable. No third party embeds it (issue #8804 → Discussion #8805, no staff commitment). WYSIWYG markdown editors do ship on GPUI (Moeka, Vellum, Zorite, velotype) |
| 5 | File trees | **SUPPORTED** | `gpui-component` Tree; shipping file explorers (`nohrs`, `zex`) | Apache-2.0 | — |
| 6 | Data tables | **SUPPORTED** | `gpui-component` DataTable: "virtual scrolling, fixed and resizable columns, sorting, cell selection across hundreds of thousands of rows" | Apache-2.0 | — |
| 7 | **Embedded web browser** | **MISSING in core; third-party is NOT usable as a docked panel** | Nothing satisfactory. `gpui-kit`'s wry webview **covers** GPUI content, **macOS+Windows only**, "still experimental with limited features" | Apache-2.0 | **The hardest gap.** Upstream **declined two PRs** (#13730, #54433 closed unmerged) and issue #21208 (427 reactions) says a webview is "still a ways off". Blitz is not a substitute. Workable only as a **separate window** or a full-bleed view with nothing above it |
| 8 | PDF preview | **SUPPORTED** | `hayro` (pure Rust) + `gpui-pdf` reference impl (page-virtualized, zoom, search, bounded memory) | `Apache-2.0 OR MIT` (hayro) | Effort: ~1–2 weeks pager; **+2–4 weeks** for selection/search (hayro scopes those out); `pdfium-render 0.9.4` fallback adds binary bundling but gives forms free. **`mupdf` is AGPL-3.0 — avoid.** Zed's own answer is "open in system viewer" |
| 9 | Image rendering | **SUPPORTED** | GPUI `img` / `Image::use_render_image() -> Arc<RenderImage>`; `image` crate; `resvg`/`usvg` for SVG | Apache-2.0 | `ImageFormat::{Png, Jpeg, Webp, Gif, Svg, Bmp, Tiff, Ico, Pnm}` from path, data URL, or http(s). Set both width and height or the box jumps on decode |
| 10 | Drag & drop from OS | **SUPPORTED** | gpuix `onFileDrop` → absolute Unicode paths from Finder/OS; Wayland outbound via `wl_data_source` | Apache-2.0 | In-app DnD is yours (gpuix documents pointer-capture semantics) |
| 11 | i18n incl. Chinese/CJK input | **PARTIAL — the sharpest risk** | `rust-i18n` 4.2.2 (or `fluent`) for strings; platform IME (Win32 IMM32 / XIM / Wayland text-input-v3 / AppKit) for input | MIT/Apache-2.0 | **No i18n in GPUI or Zed at all** (#7409 open, 143 reactions; i18n PRs #7433 and #51798 closed unmerged; the community localizes Zed by **patching release binaries**). **12 open `area:controls/ime` issues**, incl. Enter-during-composition firing actions on Linux (#41576 **closed not_planned**) and **no CJK word segmentation** (#19940, open since 2024-10). **No reusable text-input widget exists at all** — Zed's own input wraps the GPL `editor` crate |
| 12 | Custom theming | **SUPPORTED** | Tailwind-ish `Styled` API; `gpui-component` semantic themes + multiple sizes; gpuix theme tokens incl. CSS Color 4 (`oklch`, `lab`), two-stop linear gradients | Apache-2.0 | GPUI text does **not** inherit `color` (defaults to black) — a real footgun. No radial/conic/multi-stop gradients |
| 13 | Embedded terminal | **SUPPORTED** | `alacritty_terminal` + GPUI (zTerm, termy, tty7, Seance, Zed itself); Zed's `crates/terminal` is **GPL** so use `alacritty_terminal` | Apache-2.0 (alacritty_terminal) | Cross-platform PTY (Windows ConPTY vs Unix) is the fiddly part, per zTerm |
| 14 | Accessibility | **PARTIAL — materially weaker than it first appears** | AccessKit in `main` only: `Role`, `.aria_*`, `on_a11y_action`, `a11y_synthetic_children`, `accessibility_id`; accesskit_macos/unix/windows | Apache-2.0 | **Published `gpui 0.2.2` has NO accessibility at all.** Landed in `main` 2026-05-27 (#56065). Zed staff (PR #59429): *"**The main Zed UI is still largely inaccessible**"*, behind `ZED_EXPERIMENTAL_A11Y=1`. #41138 (Windows screen readers "absolutely silent") **open since 2025-10**, 12 thumbs; **#7895 VoiceOver closed `not_planned`**. 26 open a11y issues. No a11y docs page exists |
| 15 | System tray | **MISSING in core** | `domenkozar/gpui-tray` (7★, new) or `tray-icon`/`muda` | Apache-2.0 / MIT | Immature third-party |
| 16 | Notifications | **SUPPORTED (built in)** | `App::show_system_notification` / `dismiss_system_notification` / `on_system_notification_response` (PR #61189, 2026-07-17) | Apache-2.0 | Linux `notify-rust`; macOS `UNUserNotificationCenter` (**needs a real `.app` bundle**); Windows WinRT toasts + AUMID. `main` only, not in published 0.2.2 |
| 17 | Deep links / URL schemes | **SUPPORTED (built in)** | `Platform::{open_url, on_open_urls, register_url_scheme}` | Apache-2.0 | Both opening URLs and **registering/receiving** a custom scheme. Only the single-instance guard is missing |
| 18 | Native file dialogs | **SUPPORTED (built in — no `rfd` needed)** | `Platform::{prompt_for_paths, prompt_for_new_path, reveal_path, open_with_system}`, `PathPromptOptions` | Apache-2.0 | Linux routes through XDG portals (`ashpd`). Also built in: keychain (`Platform::{write,read,delete}_credentials`) |
| 19 | Global shortcuts / single instance | **MISSING in core** | `global-hotkey`, `single-instance` | MIT/Apache-2.0 | Straightforward but yours to build |
| 20 | Auto-update | **MISSING and NOT reusable (GPL)** | gpuix's pattern: `cargo-packager` + signed GitHub Releases + `checkUpdate()`/`downloadAndInstall()`; or `self_update` | MIT/Apache-2.0 | Zed's `crates/auto_update` is **GPL-3.0-or-later** and hard-wired to Zed's cloud endpoint. **Do not copy it** |
| 20b | Multi-window, titlebars, vibrancy | **SUPPORTED** | `App::open_window`; `TitlebarOptions`; `WindowDecorations::{Server,Client}`; `WindowKind::{Normal,PopUp,AnchoredPopup,Floating,Dialog,LayerShell}`; `WindowBackgroundAppearance::{Opaque,Transparent,Blurred,MicaBackdrop,MicaAltBackdrop}`; `WindowAppearance` for `NSAppearance` | Apache-2.0 | **Windows Mica and Mica Alt ARE supported** (corrects an earlier UNVERIFIED flag). `Blurred` is "not always supported". macOS `tabbing_identifier` for native window tabs |
| 21 | Video / audio | **PARTIAL (video) / MISSING (audio)** | `gpui-video-player` (GStreamer, **stale since 2025-11**) or build on GStreamer/ffmpeg; audio via `rodio`/`cpal` | MIT/Apache-2.0 | No video/audio API in GPUI; no ffmpeg/gstreamer/rodio dep anywhere in `gpui*`. Issue #21691 shows "completed" but no implementation found. GStreamer is a heavy distribution dependency |
| 22 | Animated GIF / animated WebP | **SUPPORTED** | Merged: PR **#21274** (2024-11-28) "GIF images now play when opened"; PR **#20778** (2024-12-06) animated WebP; `Image::use_render_image()` | Apache-2.0 | Known high-CPU-while-playing issue #21563 (closed 2026-03-30) |
| 23 | Fonts: CJK fallback, emoji, weight | **PARTIAL** | CoreText (macOS) / DirectWrite (Windows) / cosmic-text 0.19 + swash (Linux, wasm); `font-kit` for enumeration | Apache-2.0 | macOS **renders no glyphs** without the `font-kit` feature — silent footgun. CJK fallback issue #8971; `buffer_font_fallbacks` only recently honoured (PR #54878); emoji run-splitting fixed repeatedly (#51569, #44197); **weight does not change below 500** (#14175); font features Linux-only (#27808); **variable-font axes unsupported/UNVERIFIED** |
| 24 | RTL / bidi shaping | **MISSING / PARTIAL** | `unicode-bidi` present in `gpui_wgpu`; 2026 PR series in flight (#57237, #57239, #57240, #57241, #60115) | Apache-2.0 | **Verified incomplete, not just unproven.** Tracking issue **#31102** open (173 reactions); core bug **#7465** open since 2024-02-06 (101 reactions); #60115 forces cosmic-text base direction to **LTR**. If Arabic/Hebrew is required, treat as a blocker |
| 25 | Printing | **MISSING** | Render to SVG/PDF and hand off; or shell out | — | No core support found |
| 26 | Testing incl. snapshot | **SUPPORTED (harness) / PARTIAL (snapshots)** | `#[gpui::test]` + `TestAppContext` (`seeds`, `iterations`, `retries`, `SEED`/`ITERATIONS` env), `VisualTestContext` on `main`, deterministic scheduler, `BenchAppContext::settle()`; **gpuix Playwright-shaped automation with a virtual clock**; `gpui-storybook`; gpui-kit's **a11y-tree-driven** test protocol | Apache-2.0 | Screenshot testing exists (`zed_visual_test_runner`, `MATCH_THRESHOLD = 0.99`, PR #45259) but is **macOS-only, feature-gated, and baselines are gitignored — not CI-reproducible**. Third-party snapshot harnesses are embryonic (`gpui-shot` 0.0.1, 14 downloads). Published `test-support` drags Linux windowing backends in even for headless logic tests |
| 27 | Hot reload | **MISSING (Rust) / PARTIAL (React & script)** | gpuix + `bun --hot` (React remount; Fast Refresh preserves `useState` and scroll); `gpui-shell` (QuickJS); `Slag` | Apache-2.0 | The one serious attempt, **PR #41508 "Hot-reloading with subsecond", was CLOSED unmerged** (2025-12-20). `runtime_shaders` is a macOS Metal shader knob, **not** UI hot reload. A Rust-side change is always a recompile |
| 28 | Compile times | **PARTIAL — quantified as poor-but-mitigated** | `codegen-units=16` + per-crate `opt-level=3` overrides (Zed's and gpui-kit's tuned profiles); `[profile.release-fast]` | — | Measured incremental: `touch crates/editor/src/editor.rs` + `cargo build -p zed` = **13.19 s → 11.85 s** after PR #62059 (2026-08-01). Zed's dev profile mirrors `build-override` because *"cargo will compile **~400 crates twice**"*; workspace has **~215 members**. **No from-scratch figure published — benchmark it yourself** |
| 29 | Packaging / signing | **PARTIAL (solvable)** | `cargo-packager` (.app/.dmg, NSIS, AppImage) + `.sig` + GitHub Releases; `bun build --compile` for a single binary; `cargo-dist` | MIT/Apache-2.0 | Nothing in GPUI helps. Zed's own pipeline: `script/bundle-mac` + notarization; `script/bundle-windows.ps1` + **Azure Trusted Signing**; Linux **`.tar.gz` only** (no official deb/rpm/AppImage) and requires **two binaries**. Flatpak scripts exist but "Zed's current Flatpak integration exits the sandbox on startup" |
| 30 | GPU-less / RDP / VM | **MISSING — hard GPU requirement, no software fallback** | Adapter selection rejects `DeviceType::Cpu` (`new_rejecting_software()`); `GpuSpecs.is_software_emulated` detects but does **not** fall back | — | Zed docs: Linux *"**requires a GPU**… we use Vulkan"*; Windows *"requires a DirectX 11 compatible GPU"*. Failure: `No GPU adapter found that can configure the display surface`. **Issue #26692 "Zed does not work in Remote Desktop session on windows"**; RFC #50972 proposes WARP fallback (not shipped). **Second-largest risk after the webview; test RDP + a GPU-less VM before committing** |
| 31 | Mobile | **MISSING (hooks only)** | `Platform::{on_app_lifecycle, on_memory_warning, gestures}` + software-keyboard fields exist; `gpui_apple` extracted; third-party `gpui-mobile` 0.1.0 | Apache-2.0 (Zed) / **GPL-3.0-or-later OR AGPL-3.0-or-later OR Apache-2.0** (`gpui-mobile`) | `crates/gpui_ios`, `gpui_android`, `gpui_mobile` **all 404 upstream**. Note the AGPL option in the third-party crate. Do not plan on official mobile |
| 32 | Web/wasm | **PARTIAL (working, not productized)** | `gpui_web` + `gpui_wgpu` (`WebBackendPreference::{Auto, WebGpu, WebGl}`); gpuix ships a browser build | Apache-2.0 | Zed README still says Web "not yet available". Needs nightly Rust, `wasm-bindgen-cli`, shared memory, COOP/COEP. ~19 MB Wasm. **Known defect: axis-locked scroll panics on wasm32** (`std::time::Instant` unimplemented) |

**Score (corrected):** 15 SUPPORTED · 11 PARTIAL · 7 MISSING-or-hard-blocked · 0 UNVERIFIED-at-the-verdict-level. (Row **20b** is a row inserted during revision and is numbered that way deliberately rather than renumbering the whole table. Mixed verdicts are counted as PARTIAL.)

**The five findings that changed the verdict during research** (recorded because they show how misleading a first pass can be):
1. **Accessibility was SUPPORTED-by-evidence-in-git; it is PARTIAL in reality.** `main` has a genuinely good AccessKit tree, but Zed's own UI is *"still largely inaccessible"* behind `ZED_EXPERIMENTAL_A11Y=1`, Windows screen-reader support is reported as completely absent, and VoiceOver support was closed `not_planned`.
2. **GPU-less/RDP was UNVERIFIED; it is a hard blocker.** GPUI explicitly **rejects CPU adapters** and has no software rasterizer, with an open issue for RDP on Windows.
3. **The webview was "PARTIAL via third party"; it is effectively MISSING for a docked panel.** The available webview *covers* GPUI content and is macOS+Windows only, and two upstream PRs were closed unmerged.
4. **RTL was UNVERIFIED; it is verified-incomplete** (issues #31102 open with 173 reactions, #7465 open since Feb 2024).
5. **Compile times were UNMEASURED; they are now quantified** (≈12 s incremental for one touched file in Zed's own tuned setup, ~215-crate workspace, ~400 crates compiled twice without the dev-profile mirror).

---

## 8. Decision guidance

### 8.1 What makes GPUI attractive here
1. **The license is workable** — GPUI itself is Apache-2.0 with an express patent grant, so a proprietary/Apache-2.0 product can link it. The GPL contamination risk is entirely avoidable by staying below `crates/editor`.
2. **The exact app shape already ships on GPUI.** Waku, Arbor, Hadron, OxiMux, Zeron, Rabbitty, hunk, Moeka, Zorite, Zedis — agent workbenches, terminals, markdown editors, PDF viewers, data grids. This is not speculative.
3. **Perf-critical axes are GPUI's strengths:** GPU-rendered text, virtualized lists, 120 FPS, terminals, long documents.
4. **If you are React-shaped, gpuix is a genuine bridge** — same React model, reconciler → retained tree → GPU, with `bun --hot` Fast Refresh, Playwright-shaped tests and a virtual clock.

### 8.2 What makes it expensive
1. **Distribution risk is the top risk.** `gpui` on crates.io has been frozen for ~11 months; `gpui_platform` (which the official README tells you to use) is not published at all; and every serious consumer picks a private harbour (`gpui-unofficial`, `gpui-pre-*`, `gpui-ce`, or a git rev). Watch for Zed's automated publish pipeline by end of Sept 2026.
2. **You cannot reuse Zed.** Editor, markdown, terminal, syntax pipeline: all GPL-3.0-or-later and all unpublished. You buy `gpui-component`/`gpui-kit` (which reimplemented them permissively) or you build them.
3. **Breakage is normal.** `gpui-kit` 0.4.0 was literally titled "Break Change" with 17 renames; GPUI consolidated `Render`+`RenderOnce` into `View` at v1.12.0; the rustc baseline moved to 1.97.
4. **The webview panel is effectively unsolved.** Upstream declined two PRs; the only third-party webview covers GPUI content, cannot be overlaid or clipped, and is macOS+Windows only. This is a bespoke subproject, not an integration.
5. **No software rendering.** GPUI rejects CPU adapters outright. VMs, RDP, Citrix/AVD and GPU-less machines are a hard compatibility cliff, with an open issue for Windows RDP.
6. **Accessibility is present but not usable as-is.** The machinery exists in `main` only; Zed's own UI is "largely inaccessible" behind an experimental flag, Windows screen readers are reported silent, and VoiceOver was declined as wontfix. Treat accessibility as a layer you build.
7. **CJK IME and i18n are both DIY.** Twelve open IME issues including an accepted-wontfix Linux Enter-during-composition bug and no CJK word segmentation; and zero i18n support anywhere in the stack.
8. **Build times.** ~12 s incremental for one touched file in Zed's own hand-tuned setup, a ~215-crate workspace, and ~400 crates compiled twice without a dev-profile override.

### 8.3 Suggested de-risking sequence (cheap before expensive)
Each of these is a genuine go/no-go gate, ordered by information-per-hour:
1. **Spike 1 (days): CJK IME.** A GPUI window with a `gpui-component` `Input`. Type Chinese with Microsoft Pinyin (Windows 11), macOS Pinyin, and Fcitx5 (Wayland) *and* X11. Verify preedit, candidate-window placement at the caret, **that Enter during composition does not fire your send action on Linux**, and no memory growth.
2. **Spike 2 (days): RDP + GPU-less.** Run over Windows RDP to a VM, and on a machine with no discrete GPU. Expect failure; confirm whether it is a clean error or a hang. This is the most likely reason to abandon GPUI.
3. **Spike 3 (days): the webview panel.** Try `gpui-kit`'s webview and a wry child window. Concretely test: can you overlay a command palette on it? Can it be clipped by a parent? Does it survive window resize and workspace switch? Decide whether your "browser panel" really needs arbitrary third-party sites.
4. **Spike 4 (days): accessibility.** Build a screen with roles and ARIA properties, then run NVDA (Windows) and VoiceOver (macOS) against it. Confirm whether `ZED_EXPERIMENTAL_A11Y`-style gating applies to third-party apps.
5. **Spike 5 (days): build time and pin.** Measure cold and incremental build times with your dependency set on one pinned rev, including `gpui-kit`, `tree-sitter`, and a webview.
6. **Spike 6 (1–2 weeks): a vertical slice** — dock layout + virtualized transcript with streaming + markdown + code highlight + terminal, using `gpui-kit` and/or gpuix.
7. **Only then** commit to a distribution and a licence posture, and get legal review of whichever component library you pick (§2.4).

### 8.4 Honest bottom line

GPUI can host this application — every capability on the list has a shipping precedent except an embedded browser panel. It is not a drop-in, it is not a stable library, and it does not come with the pieces you would most like to reuse. What it gives you is a fast, genuinely native GPU renderer with a real element/entity model, working multi-platform IME plumbing, a working (if young) AccessKit a11y tree, working virtualization, notifications, file dialogs and Mica/vibrancy, and a permissively-licensed widget ecosystem that has already built most of your UI.

What it costs you is: pinning a fast-moving distribution nobody officially supports; absorbing breaking changes; and building or auditing four things yourself — **an editor, a markdown renderer, a webview host, and your i18n/a11y layers** — plus accepting two hard environmental limits (**no software rendering**; **no complete RTL**) and one awkward-but-real one (**CJK IME is workable but has an accepted-wontfix Enter bug on Linux and no word segmentation**).

If the browser panel must render arbitrary third-party sites inside your dock layout, or if you must support RDP/VDI or accessibility compliance, **GPUI is not the right answer today** — Tauri v2 is the lower-risk path and still gets you Rust without rewriting the UI. If native rendering, memory footprint and GPU-fast text are the point, and your deployment targets are ordinary GPU-equipped desktops, **GPUI is the only Rust option with a proven track record at exactly this app's shape** — and the decision should be gated on the six spikes above rather than on any further reading.

---

## 9. Explicit non-verifications and caveats

Things I could **not** verify, stated plainly so they are not mistaken for findings. Items struck through were **resolved during research** and are now settled elsewhere in this report.

1. ~~Windows acrylic/mica~~ — **RESOLVED: supported.** `WindowBackgroundAppearance::{MicaBackdrop, MicaAltBackdrop}` exist in `crates/gpui/src/platform.rs` (§4.10).
2. ~~RDP / GPU-less-VM behaviour~~ — **RESOLVED: it is a hard blocker, not an open question.** GPUI rejects `DeviceType::Cpu`, has no software rasterizer, and issue #26692 documents Zed not working in a Windows Remote Desktop session (§4.17).
3. ~~RTL/bidi correctness~~ — **RESOLVED: verified incomplete.** Issues #31102 (open, 173 reactions) and #7465 (open since 2024-02-06) (§4.12).
4. ~~Published compile-time measurements~~ — **PARTIALLY RESOLVED.** Incremental figure now known (13.19 s → 11.85 s for one touched file, PR #62059). **A from-scratch build figure is still unpublished and unmeasured** — benchmark it yourself (§4.15).
5. **Emoji and variable-font axis rendering quality** — still unverified. Font-run splitting for emoji has been fixed repeatedly (#51569, #44197), which implies fragility, but I have no correctness data. Variable-font axes: no support found anywhere.
6. **Whether real screen-reader UX (VoiceOver/NVDA) works** — the answer is now *documented as bad* rather than unknown: Zed staff say the main UI is "still largely inaccessible" and #41138 reports Windows screen readers are "absolutely silent". What remains unverified is specifically **whether a third-party app that implements its own a11y tree would fare better than Zed does** — that depends on your own implementation, not on GPUI.
7. **`cx`/closure borrow-checker ergonomics complaints** — a parallel survey found **no** verified first-party evidence. Do not repeat this as a known pain point.
8. **Zed's own auto-update mechanism** — **RESOLVED in outline**: `crates/auto_update` is GPL-3.0-or-later, uses Zed's own cloud endpoint, macOS DMG + `hdiutil` + `rsync`, Windows silent installer + `tools/auto_update_helper.exe`. **Not** Sparkle, **not** GitHub Releases, and **not reusable in a proprietary app** (§4.9).
9. **Zed UI localization status** — **RESOLVED: there is none.** Issue #7409 open since 2024-02-05 (143 reactions); i18n PRs closed unmerged; the community localizes Zed by patching release binaries (§4.12).
10. **`gpui-component`'s code-provenance/licence cleanliness** — the §2.4 concern is real and community-raised, and `gpui-kit` PR #2936 ("Audit licenses before publishing") shows it was taken seriously, but I could not independently audit whether GPL-licensed Zed code was copied. **Requires legal/code review before you depend on it.**
11. **Zed issue #21208's comment thread** — I confirmed the issue, its open status, its creation/update dates and its 427-reaction count, and I have maintainer `notpeter`'s quote from search results, but GitHub rate-limiting prevented reading the full thread. Its comments may contain a more recent Zed position on webviews than I have seen.
12. **The bodies of discussion #43592 / #46963 (i18n RFCs), #50972 (WARP RFC), and issues #26692 / #43206** — titles and URLs verified via search; bodies not retrieved (API rate limit). The RDP and WARP findings rest on verified titles, not full text.
13. **`gpui-ce`'s version numbering** is confusing and I may be misreading intent: crates.io currently shows default/max `0.2.2` (published 2026-08-28 by `philocalyst`) while `0.3.2`/`0.3.3` (published 2025-12-27 by `iamnbutler`) are yanked. I report the API facts without claiming to know the release strategy.
14. **The `gpui-archipelago` "315-Day Vacuum" article is a partisan community source.** I treated its narrative and characterisations as opinion; the dates, crate names and reproduced quotes are cross-checked against crates.io/GitHub API data and are consistent.
15. **`zed-industries/gpui` (lowercase) and `zed-industries/gpui-component`** — 404 / not verified to exist. The canonical component library is Longbridge's.
16. **`hexy`, `gpui-calculator`, `HyperApp`, `Cake`, `RustDesk`** as GPUI apps — no evidence found. Treated as unconfirmed.
17. **Reddit (r/rust) sentiment is entirely absent** from this report: `reddit.com/search.json` was blocked in this environment. Its absence is a collection gap, not evidence of no discussion.
18. **Whether any closed-source party embeds `crates/editor`** — no evidence of any embedder, open or closed. Issue #8804 was converted to Discussion #8805 with no staff commitment.
19. **Whether `ZED_EXPERIMENTAL_A11Y=1` is still required on today's `main`** — that string was found only in PR #59429's body text; I did not verify it against current source.
20. **Whether Zed's visual regression tests are CI-gated** — inferred as *not* CI-reproducible from the docs stating baselines are gitignored; no workflow file was read.
21. **`NSTextInputClient` as the literal macOS class name** — inferred from `insertText:` / `setMarkedText:` / `doCommandBySelector:` usage, not directly fetched.
22. **A "gpui + blitz" experiment** — searched, none found. Absence is not proof.
23. **`docs.rs` was unreachable from one research sandbox** (every fetch errored), so some API type names were read from `main`-branch source instead. Note that docs.rs would in any case reflect the stale `gpui 0.2.2`, not `main`.

### Corrections to premises that turned out to be false
- **There is no February-2025 "GPUI: …" blog post.** Enumerating `https://zed.dev/blog/tagged/gpui` yields only: "Leveraging Rust and the GPU…" (2023-03-07), "GPUI 2 is now in production" (2024-01-03), "Why the big rewrite?" (2024-01-23), "Ownership and data flow in GPUI" (2024-01-25), and "How We Rebuilt Settings in Zed" (2025-12-12). The real 2025 event was the **silent crates.io publication** in October 2025, which produced no dedicated Hacker News thread of its own.
- **The widely-repeated claim that "GPUI is opaque to screen readers" is not simply stale.** It was true through 2025; AccessKit landed in `main` on 2026-05-27; but Zed's own staff still describe the main UI as "largely inaccessible" (§4.8). Both the original criticism and the optimistic correction are partly right.
- **`gpui_platform`, which `crates/gpui/README.md` explicitly tells you to depend on, is not on crates.io at all** (`https://crates.io/api/v1/crates/gpui_platform` → 404). The README's recommended `gpui_platform = { version = "*" }` is therefore **not satisfiable today** from crates.io; only third-party republishes exist (`gpui-platform-gpui-unofficial`, `bezel-gpui-platform`, `fc-gpui-platform`, `open-gpui-platform`). This is a concrete, checkable defect in GPUI's own onboarding documentation and it reinforces §1.4's conclusion.
- **The webview question was answered "no" twice, by name.** PR #13730 (by Longbridge's `huacnlee`) and PR #54433 were both closed unmerged; the first author's own close reason explains why (§4.5). This is stronger evidence than "the issue is still open".

### Honest note on `gpui.rs` inconsistency
`https://gpui.rs` still shows `Application::new()` in its Hello World, while `crates/gpui/README.md` (main) instructs `gpui_platform::application()`. Either the site is stale or both work; I did not verify which. Treat the site's examples as potentially out of date relative to `main`.

---

## Appendix A — Primary artifacts fetched (all 2026-09-12 unless noted)

- `https://crates.io/api/v1/crates/gpui`, `/versions`, `/0.2.2/dependencies`
- `https://crates.io/api/v1/crates/gpui-ce`, `/hayro`
- `https://crates.io/api/v1/crates?q=gpui_&per_page=100&sort=downloads`
- `https://api.github.com/repos/zed-industries/zed` (+ `/contents/`, `/contents/crates/gpui`, `/contents/crates/gpui/docs`, `/contents/legal`)
- `https://api.github.com/repos/zed-industries/awesome-gpui`
- `https://api.github.com/repos/longbridge/gpui-kit` (and `longbridge/gpui-component` → 301 to the same repo id)
- `https://api.github.com/repos/gpui-ce/gpui-ce`
- `https://api.github.com/repos/remorses/gpuix`, `https://api.github.com/repos/iamnbutler/gpui-unofficial`, `https://api.github.com/users/iamnbutler`
- `https://api.github.com/repos/zed-industries/GPUI` → **404**
- Raw files: `zed/README.md`, `zed/Cargo.lock` listing, `zed/crates/gpui/Cargo.toml`, `gpui/README.md`, `gpui/LICENSE-APACHE`, `gpui/src/gpui.rs`, `gpui/src/_accessibility.rs`, `crates/gpui_platform/Cargo.toml`, `crates/gpui_wgpu/Cargo.toml`, `crates/gpui_web/Cargo.toml`, `crates/editor/Cargo.toml`, `crates/markdown/Cargo.toml`, `crates/ui/Cargo.toml`, `crates/terminal/Cargo.toml`, `crates/language/Cargo.toml`, `longbridge/gpui-kit/{README.md,Cargo.toml}`, `gpui-ce/README.md`, `remorses/gpuix/README.md`, `LaurenzV/hayro/README.md`
- `https://gpui.rs`
- `https://hn.algolia.com/api/v1/search?query=gpui&tags=story`, `https://hn.algolia.com/api/v1/items/49315709`
- `https://gpui-archipelago.github.io/news/315-day-vacuum/`, `.../news/august-digest/`, `.../manifest/`
- `https://dev.to/zhiwei_ma_0fc08a668c1eb51/building-a-gpu-accelerated-terminal-emulator-with-rust-and-gpui-4103`

## Appendix B — AccessKit a11y API (verbatim signatures from `main`)

```rust
// crate root re-exports
pub use accesskit;
pub use accesskit::Action as AccessibleAction;
pub use accesskit::{Orientation, Role, Toggled};

// usage
div().id("my-slider")
     .role(Role::Slider)
     .on_a11y_action(AccessibleAction::Increment, |_extra, _window, _cx| { /* ... */ });

// custom element presenting as a text input with text runs
impl Element for MyCustomTextField {
    fn a11y_role(&self) -> Option<Role> { Some(Role::TextInput) }
    fn a11y_synthetic_children(&mut self, _prepaint: &mut Self::PrepaintState,
                               builder: &mut A11ySubtreeBuilder) {
        let mut run = accesskit::Node::new(Role::TextRun);
        run.set_value(self.text.clone());
        run.set_character_lengths(self.text.chars().map(|c| c.len_utf8() as u8).collect());
        let run_id = builder.synthetic_node_id(0);
        builder.push_child(run_id, run);
        let caret = accesskit::TextPosition { node: run_id, character_index: self.cursor };
        builder.parent_node().set_text_selection(accesskit::TextSelection { anchor: caret, focus: caret });
    }
}
```
