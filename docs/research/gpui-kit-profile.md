# GPUI Kit — Technical Profile & Migration-Feasibility Study

**Research date:** 2026-09-12 (all figures are as of this date)
**Method:** live GitHub REST API, crates.io API, `gpui-kit.com` docs, plus a shallow clone of the repository inspected on disk.
**Pinned revision inspected:** `84f57fdfcb4910623fb0bb7f795b077e249f9271` (`main`, committed 2026-09-12 00:32:39 +0800, subject `kit: Add support mobile applications in GPUI Kit (#3045)`).
**Local checkout used for source reading:** `E:\craft-agents\docs\research\.scratch\gpui-kit` (scratch only; safe to delete).

> Honesty note: everything below is sourced from the URLs/paths quoted. Where I could not verify something, it is explicitly marked **[UNVERIFIED]** or **[NOT FOUND]**. I did not compile the project, so build-weight numbers are estimates derived from crate sizes and `Cargo.lock`, not from a measured build.

---

## 0. Headline finding — the "relationship" question is answered by a repo rename

`gpui-kit` and `gpui-component` are **not two projects**. `https://github.com/longbridge/gpui-component` now **redirects** to `https://github.com/longbridge/gpui-kit`.

Evidence:

- `GET https://api.github.com/repos/longbridge/gpui-component` returns HTTP 200 with the body of the **gpui-kit** repo (`"name":"gpui-kit"`, `"full_name":"longbridge/gpui-kit"`, `"id":814684486`). GitHub serves redirects for renamed repos on the API.
- `https://gpui-kit.com/releases` v0.6.0 notes: *"The repository and ecosystem are now named **GPUI Kit**, and the documentation has moved to [gpui-kit.com](https://gpui-kit.com). GPUI Component remains the styled component layer within the toolkit. ([#2927](https://github.com/longbridge/gpui-kit/pull/2927))"*
- crates.io: `gpui-component` 0.6.0/0.6.1 have `"repository":"https://github.com/longbridge/gpui-kit"`; `gpui-component` 0.5.1 and earlier had `"repository":"https://github.com/longbridge/gpui-component"` and homepage `https://longbridge.github.io/gpui-component`.
- `gpui-component` 0.6.1's crates.io description is literally *"GPUI Component: the styled component library of GPUI Kit, with 60+ desktop UI components for GPUI."*

**So:** `gpui-component` was promoted from "the project" to "the styled layer of a larger project", and the repository took the new umbrella name. There is no fork/derivation to untangle — it is one continuous codebase.

---

## 1. Identity & maturity

### 1.1 Repository (GitHub API, `https://api.github.com/repos/longbridge/gpui-kit`)

| Field | Value |
| --- | --- |
| `description` | "Rust GUI components for building fantastic cross-platform desktop application by using GPUI." |
| `created_at` | 2024-06-13T13:45:39Z |
| `pushed_at` | 2026-09-11T16:32:41Z |
| `updated_at` | 2026-09-12T07:16:12Z |
| `default_branch` | `main` |
| `stargazers_count` | **14,299** (site widget shows 14.3k / "14287 stars" — slightly stale) |
| `forks_count` | **873** |
| `subscribers_count` | 44 (watchers) |
| `open_issues_count` | **94** (GitHub counts PRs here; see below for true issue count) |
| `size` | 27,405 KB |
| `language` | Rust |
| `topics` | `desktop-application`, `gpui`, `rust`, `uikit` |
| `license` | `"key":"other","spdx_id":"NOASSERTION"` — **GitHub's classifier failed**; the repo ships `LICENSE-APACHE` (10,496 bytes, header `Copyright 2024 - 2026 Longbridge <https://longbridge.com>`), and crates.io reports `"license":"Apache-2.0"` for every published crate. Treat as **Apache-2.0**. |
| `homepage` | `http://gpui-kit.com` |
| `has_discussions` | true |
| `archived` | false |

**True open issue count:** `https://api.github.com/search/issues?q=repo:longbridge/gpui-kit+is:issue+is:open` → `"total_count":75`. (The 94 in the repo payload includes open PRs.)

### 1.2 crates.io

`https://crates.io/api/v1/crates/gpui-kit`

| Crate | Latest | Versions | Created | All-time downloads | License | Edition |
| --- | --- | --- | --- | --- | --- | --- |
| **`gpui-kit`** | 0.6.1 | 3 (0.1.0, 0.6.0, 0.6.1) | 2026-09-03 | **7,035** | Apache-2.0 | 2024 |
| **`gpui-component`** | 0.6.1 | 26 | 2025-02-06 | **115,079** (55,679 recent) | Apache-2.0 | 2024 |
| `gpui-base` | 0.6.1 | — | — | 1,721 (v0.6.1 alone) | Apache-2.0 | 2024 |
| `gpui-kit-assets` | 0.6.1 | — | — | — | Apache-2.0 | 2024 |
| `gpui-wry` | 0.6.1 | — | — | — | Apache-2.0 | 2024 |
| `gpui-fps` | 0.6.1 | — | — | — | Apache-2.0 | 2024 |
| `gpui-component-macros` | 0.6.1 | — | — | — | Apache-2.0 | 2024 |
| `gpui-shell` | 0.6.1 | **not published** (`publish = false`) | — | — | Apache-2.0 | 2024 |
| `gpui-component-shell` | 0.6.1 | **not published** (`publish = false`) | — | — | Apache-2.0 | 2024 |

Curio: `gpui-kit` **0.1.0** (published 2026-09-03T02:32:19Z, 13 downloads) is a name-reservation stub — `"has_lib":false`, `bin_names:["gpui-kit"]`, 3 lines of Rust, `repository: null`, description "A Rust crate for GPUI components." 0.6.0 followed the same day.

All crates are published by `huacnlee` (Jason Lee, user id 5518, Longbridge).

### 1.3 Release history (GitHub releases, `https://api.github.com/repos/longbridge/gpui-kit/releases`)

| Tag | Published | Notes |
| --- | --- | --- |
| `v0.2.0` | 2025-10-09 | "🚀 First release version to crates.io." Previous tags were date-style (`v20250925`). |
| `v0.3.0` | 2025-10-24 | Adds `AppMenuBar`, `Tree`; docs site goes online at `longbridge.github.io/gpui-component`. |
| `v0.3.1` | 2025-10-27 | Patch. |
| `v0.4.0` | 2025-11-17 | Large breaking-change release: `Modal`→`Dialog`, `Drawer`→`Sheet`, `Indicator`→`Spinner`, `Dropdown`→`Select`, `TextInput`→`Input`, `FormField`→`Field`. |
| `v0.4.1` | ~2026-01 | Sidebar/slider/table/theme fixes. |
| `v0.5.0` | 2025-12-08 (crates.io) | — |
| `v0.5.1` | 2026-02-05 | Last release under the `gpui-component` repo name. |
| **`v0.6.0`** | **2026-09-03** | **Rebrand + re-architecture.** New `gpui-base`, `gpui-kit` facade, `gpui-shell` JS runtime, `gpui-fps`, `gpui-wry` split-out; `Command`, `NativeMenu`, `StatusBar`, `Pagination`, `Stepper`, `HoverCard`, `AlertDialog`, `FocusTrap`, `Combobox`, `Rating`, `ProgressCircle`, `Shimmer`, chat components (`Message`, `MessageScroller`, `Bubble`, `Attachment`, `Marker`), `NavStack`, `Editor`/`EditorState` split from `Input`. |
| **`v0.6.1`** | **2026-09-09** | Multi-cursor editing, bracket auto-pair, smart indent, headless UI testing (`gpui_kit::test`), Markdown frontmatter plugin, a11y fixes, monospace font fallback. |

### 1.4 Contributors

`https://api.github.com/repos/longbridge/gpui-kit/contributors?per_page=100` — top contributors by commits: `huacnlee` (1,355), `madcodelife` (426), `ylinwind` (35), `ihavecoke` (29), `zanmato` (28), `xda2023` (24), `lurenjia534` (18), `hlcfan` (16), `Moulberry` (16), `suxiaoshao` (15), `Copilot` (13, bot), `sunli829` (13), `dependabot[bot]` (11). 100+ contributors were returned; **the project is effectively single-maintainer-led** (huacnlee authored ~62% of listed commits).

### 1.5 Who uses it / production readiness

- README: *"**Production Ready**: Used to build Longbridge Pro from day one and continuously refined in a publicly shipped commercial desktop application."* and *"GPUI Kit has powered [Longbridge Pro](https://longbridge.com/desktop) from day one."*
- v0.6.0 release notes repeat the claim.
- **[UNVERIFIED]** I found no independent confirmation (no third-party binary inspection, no Longbridge engineering blog post located). Treat "powers Longbridge Pro" as a vendor claim that is plausible and consistently repeated, but not independently corroborated.
- `https://gpui-kit.com/apps` ("App Stories") lists third-party apps built with the kit (e.g. via PR #2951 "Add five apps to the app stories page"). I did not enumerate every entry.

**Verdict on production usability:** the crate is versioned `0.x`, ships breaking changes between minor versions (0.4.0 renamed ~8 public APIs), and has a **6-month release gap** between 0.5.1 (2026-02-05) and 0.6.0 (2026-09-03) that was then followed by a hard rebrand + crate split. It is genuinely used in a commercial desktop app and has real CI, but a consumer must expect API churn and must track `gpui-pre` snapshot bumps weekly. It is "production-used", not "production-stable".

---

## 2. Relationship to GPUI, gpui-component, GPUIX

### 2.1 It depends on GPUI through Longbridge's own republished snapshot family

`https://raw.githubusercontent.com/longbridge/gpui-kit/main/Cargo.toml` (`[workspace.dependencies]`):

```toml
gpui = { package = "gpui-pre", version = "0.3.1" }
gpui_platform = { package = "gpui-pre-platform", version = "0.3.1", features = ["font-kit", "x11", "wayland", "runtime_shaders"] }
gpui_web = { package = "gpui-pre-web", version = "0.3.1" }
gpui_macros = { package = "gpui-pre-macros", version = "0.3.1" }
reqwest_client = { package = "gpui-pre-reqwest-client", version = "0.3.1" }
sum-tree = { package = "gpui-pre-sum-tree", version = "0.3.1" }
reqwest = { package = "gpui-pre-reqwest", version = "0.12.15", ... }
```

**It pins a version, not a git rev.** `gpui-pre = "0.3.1"` from crates.io.

What `gpui-pre` actually is — `https://crates.io/api/v1/crates/gpui-pre/0.3.1`:

```
"description": "Zed's GPU-accelerated UI framework (gpui-pre snapshot of zed@801c087)",
"homepage": "https://gpui.rs",
"repository": "https://github.com/zed-industries/zed",
"license": "Apache-2.0",
"crate_size": 5277130,
"linecounts": { "Rust": { "code_lines": 58013, "files": 87 } }
```

**Does it vendor or fork GPUI? No — with one nuance.**

- There is **no GPUI source in the repository** (no `crates/gpui` member; the workspace members are `crates/{kit,base,component,component-macros,component-shell,assets,fps,story,story-web,shell,webview}` plus examples — see `Cargo.toml`).
- README: *"Built on [GPUI](https://github.com/zed-industries/zed), the UI framework from Zed Industries, also Apache-2.0. The `gpui-pre-*` crates are snapshots of it, published with Zed's license and notices intact."*
- `CONTRIBUTING.md`: *"The `gpui-pre` crates publish version-aligned snapshots of upstream GPUI, not a separately developed version."* and *"They must remain compatible with upstream and **must not carry behavioral patches**, so that we can continue updating directly from upstream and use the official GPUI crates when appropriate."*
- `.github/workflows/release-gpui.yml` runs weekly (cron `9 8 * * 1` = Monday 08:09 UTC) and drives `script/bump-gpui.ts`, which builds and tests gpui-kit against the staged snapshot before publishing. *"If an upstream API change breaks compatibility, publication is paused and GPUI Kit is updated to support the new API."*

**Nuance:** Longbridge *publishes* GPUI under a different crate name because Zed does not publish `gpui` to crates.io (`gpui-pre`, `gpui-pre-platform`, `gpui-pre-wgpu`, `gpui-pre-apple`, `gpui-pre-linux`, `gpui-pre-windows`, `gpui-pre-macos`, `gpui-pre-web`, `gpui-pre-macros`, `gpui-pre-media`, `gpui-pre-perf`, `gpui-pre-scheduler`, `gpui-pre-util`, `gpui-pre-collections`, `gpui-pre-http-client`, `gpui-pre-zlog`, `gpui-pre-ztracing`, … — 26 `gpui-pre-*` packages in `Cargo.lock`). Publishing is a repackaging act, not a fork, and the code is asserted to be unmodified.

There is exactly **one** acknowledged downstream patch in the tree: `[patch.crates-io] rquickjs = { path = "crates/shell/rquickjs-compat" }`, which routes LLRT's `rquickjs` dependency onto Longbridge's `quickjs-jit` fork so the shell and LLRT share one VM. That affects `gpui-shell` (unpublished), **not** GPUI or the component library.

### 2.2 GPUIX

**I searched the entire checkout (all `.rs`, `.toml`, `.md`) and found zero references to GPUIX** (no `guix`, `gpui_x`, `gpui-x` identifiers or documentation mentions). **[NOT FOUND]** — I can neither confirm nor construct any relationship between `gpui-kit` and GPUIX.

### 2.3 What kind of thing is it?

It is **all four**, layered deliberately. From `https://gpui-kit.com/docs/`:

| Crate | Role | Analogy given in README |
| --- | --- | --- |
| `gpui` (`gpui-pre`) | Renderer / windowing / text stack | "HTML + Tailwind CSS" |
| **`gpui-base`** | Unstyled behavior, state, focus, overlays, virtual lists, dock *infrastructure*, semantic design tokens | [Base UI](https://base-ui.com) |
| **`gpui-component`** | The complete styled UI system (60+ controls, themes, DataTable, Dock, code editor, charts) | shadcn's styled layer |
| **`gpui-kit`** | Umbrella facade: one dependency, re-exports GPUI + base + component + assets | — |
| **`gpui-shell`** | Scriptable JS (QuickJS) application runtime hosted by Rust | — |

`gpui-kit` is therefore a **component library + design system + application framework + scaffolding**, with a stated architecture rule (`CLAUDE.md`, `docs/ARCHITECTURE.md`): *"Behavior belongs to the foundation. Presentation belongs to the application."*

---

## 3. Full component inventory

Sources: `crates/component/src/lib.rs` (module list), `crates/base/src/lib.rs` (`pub use` list), per-module `pub struct|enum|trait` extraction over `crates/component/src/**/*.rs`, plus `https://gpui-kit.com/component` and `website/component/*.md` descriptions.

**Counts:** `crates/component/src/lib.rs` declares **66 public modules**; `website/component/` has **72 component doc pages**; the marketing claim everywhere is **"60+"**. Both are defensible depending on whether compat shims (`resizable`, `history`, `searchable_list`, `virtual_list`) and doc-only entries (`Image`, `FocusTrap`, `Root`, `Theme`) are counted.

### 3.1 Inventory table

| # | Component (doc name) | Rust type(s) | Module path | Capability (one line) |
| --- | --- | --- | --- | --- |
| 1 | Accordion | `Accordion`, `AccordionItem` | `component/src/accordion.rs` | Collapsible content panels |
| 2 | Alert | `Alert`, `AlertVariant` | `component/src/alert.rs` | Callout with variants |
| 3 | AlertDialog | `AlertDialog` | `component/src/dialog/alert_dialog.rs` | Modal interrupting confirmation |
| 4 | Attachment | `Attachment`, `AttachmentMedia/Content/Title/Description/Actions/Group`, `AttachmentStatus` | `component/src/attachment.rs` | File/media attachment chips with lifecycle states + previews |
| 5 | Avatar | `Avatar`, `AvatarGroup` | `component/src/avatar/{avatar,avatar_group}.rs` | Avatar image w/ fallback; stacked group |
| 6 | Badge | `Badge` | `component/src/badge.rs` | Count/status badge |
| 7 | Breadcrumb | `Breadcrumb`, `BreadcrumbItem` | `component/src/breadcrumb.rs` | Path trail |
| 8 | Bubble | `Bubble`, `BubbleContent`, `BubbleGroup`, `BubbleReactions`, `BubbleVariant`, `BubbleReactionSide` | `component/src/bubble.rs` | **Chat message bubble** w/ alignment + reactions |
| 9 | Button | `Button`, `ButtonVariant`, `ButtonRounded`, `ButtonCustomVariant`, `ButtonVariants` | `component/src/button/button.rs` | Buttons, 5 variants, 4 sizes |
| 10 | ButtonGroup | `ButtonGroup` | `component/src/button/button_group.rs` | Attached button cluster, horizontal/vertical |
| 11 | ButtonIcon | `ButtonIcon`, `ButtonIconVariant` | `component/src/button/button_icon.rs` | Icon-only button |
| 12 | DropdownButton | `DropdownButton` | `component/src/button/dropdown_button.rs` | Split button w/ independent trigger |
| 13 | Toggle / ToggleGroup | `Toggle`, `ToggleGroup`, `ToggleVariant`, `ToggleVariants` | `component/src/button/toggle.rs` | Two-state pressable; single/multi group |
| 14 | Calendar | `Calendar` | `component/src/time/calendar.rs` | State-driven date grid, matchers, custom item render |
| 15 | Carousel | `Carousel`, `CarouselContent/Item/Previous/Next/Pagination/PaginationItem`, `CarouselState`, `CarouselEvent` | `component/src/carousel/*` | Composable carousel (state.rs is 78 KB) |
| 16 | Chart: Area | `AreaChart` | `component/src/chart/area_chart.rs` | Area chart |
| 17 | Chart: Bar | `BarChart` | `component/src/chart/bar_chart.rs` | Bar chart |
| 18 | Chart: Candlestick | `CandlestickChart` | `component/src/chart/candlestick_chart.rs` | OHLC / candlestick (finance) |
| 19 | Chart: Line | `LineChart` | `component/src/chart/line_chart.rs` | Line chart |
| 20 | Chart: Pie | `PieChart` | `component/src/chart/pie_chart.rs` | Pie/donut |
| 21 | Chart: Radar | `RadarChart`, `RadarLabel` | `component/src/chart/radar_chart.rs` | Radar/spider |
| 22 | Chart: Sankey | `SankeyChart`, `SankeyLabel` | `component/src/chart/sankey_chart.rs` | Sankey flow |
| 23 | Plot (low-level) | `Plot`, `StrokeStyle`, scales `ScaleBand/Linear/Ordinal/Point`, shapes `Arc/Area/Bar/Line/Pie/RadialLine/Sankey/Stack`, `PlotAxis`, `Grid`, `PlotLabel`, `Tooltip`, `CrossLine`, `Dot`, `Text` | `component/src/plot/**` | d3-style plotting primitives |
| 24 | Checkbox | `Checkbox` | `component/src/checkbox.rs` | Binary check |
| 25 | Clipboard | `Clipboard` | `component/src/clipboard.rs` | Copy-to-clipboard button |
| 26 | Collapsible | `Collapsible` | `component/src/collapsible.rs` | Expand/collapse region |
| 27 | ColorPicker | `ColorPicker` | `component/src/color_picker.rs` | Formats, presets, alpha |
| 28 | Combobox | `Combobox`, `ComboboxState`, `ComboboxEvent`, `ComboboxTriggerContext` | `component/src/combobox.rs` (58 KB) | Autocomplete + searchable dropdown |
| 29 | Command | `Command`, `CommandItem`, `CommandGroup`, `CommandState`, `CommandEntry` | `component/src/command/*` (state.rs 94 KB) | **Command palette** |
| 30 | DescriptionList | `DescriptionList`, `DescriptionItem`, `DescriptionText` | `component/src/description_list.rs` | Key/value display |
| 31 | Dialog | `Dialog`, `DialogHeader/Title/Description/Content/Footer/Close/Action`, `DialogButtonProps`, `DialogFooterButton` | `component/src/dialog/*` | Declarative modal |
| 32 | Dock | `DockArea`, `DockSkin`, `Panel`, `PanelView`, `PanelHandle`, `PanelStyle`, `PanelControl`, `TabPanel`, `DragPanelPreview` | `component/src/dock/*` (tab_panel.rs 61 KB) | **Docking**: resizable panels, draggable tabs, nested splits, edge docks, serializable |
| 33 | Empty | `Empty`, `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`, `EmptyContent` | `component/src/empty.rs` | Empty-state composition |
| 34 | Form | `Form`, `Field`, `FieldBuilder` | `component/src/form/*` | Form container + typed fields + validation |
| 35 | GroupBox | `GroupBox`, `GroupBoxVariant` | `component/src/group_box.rs` | Titled bordered group |
| 36 | HoverCard | `HoverCard` | `component/src/hover_card.rs` | Delayed rich hover overlay |
| 37 | Icon | `Icon`, `IconName`, `IconNameExt` | `component/src/icon.rs` | SVG icon element; `icon_named!` macro |
| 38 | Input | `Input`, `InputContentType`, `AnyInputState`, `MaskPattern` | `component/src/input/input.rs` (42 KB) | Single-line text, masks, validation, number entry |
| 39 | Textarea | `Textarea` | `component/src/input/textarea.rs` | Multi-line, rows, soft wrap, auto-grow, chat submit |
| 40 | Editor | `Editor`, `EditorState`, LSP popovers `CompletionMenu`, `HoverPopover`, `DiagnosticPopover`, `CodeActionMenu` | `component/src/input/editor.rs`, `input/popovers/*` | **Code editor** |
| 41 | NumberInput | `NumberInput`, `NumberStep`, `StepAction` | `component/src/input/number_input.rs` | Numeric stepper |
| 42 | OtpInput | `OtpInput` | `component/src/input/otp_input.rs` | Multi-cell OTP |
| 43 | SyntaxHighlighter | `SyntaxHighlighter`, `Language` (enum), `LanguageRegistry`, `LanguageConfig`, `HighlightTheme`, `SyntaxColors` | `component/src/highlighter/*` | Tree-sitter highlighting engine (64 KB) |
| 44 | Kbd | `Kbd` | `component/src/kbd.rs` | Keyboard shortcut chip |
| 45 | Label | `Label`, `HighlightsMatch` | `component/src/label.rs` | Form label + match highlighting |
| 46 | Link | `Link` | `component/src/link.rs` | Link-like control |
| 47 | List | `List`, `ListState`, `ListEvent`, `ListDelegate`, `ListItem`, `ListSeparatorItem`, `Loading` | `component/src/list/*` | Sections, search, selection, infinite scroll |
| 48 | Marker | `Marker`, `MarkerIcon`, `MarkerContent`, `MarkerVariant`, `MarkerLoadingStyle` | `component/src/marker.rs` | Conversation status/loading/separator row |
| 49 | Menu (PopupMenu) | `PopupMenu`, `PopupMenuItem` | `component/src/menu/popup_menu.rs` (50 KB) | Menus w/ icons, shortcuts, submenus |
| 50 | ContextMenu | `ContextMenu`, `ContextMenuState`, `ContextMenuExt` | `component/src/menu/context_menu.rs` | Right-click menus |
| 51 | DropdownMenu | `DropdownMenuPopover`, `DropdownMenu` (trait) | `component/src/menu/dropdown_menu.rs` | Attached dropdown |
| 52 | AppMenuBar | `AppMenuBar` | `component/src/menu/app_menu_bar.rs` | In-window menu bar |
| 53 | NativeMenu | `NativeMenu` (+ `macos.rs`, `windows.rs`, `fallback.rs`) | `component/src/native_menu/*` | **OS-native menus**: AppKit `NSMenu` on macOS, Win32 popup menus on Windows |
| 54 | Message | `Message`, `MessageGroup`, `MessageAvatar/Header/Content/Footer`, `MessageAlignment` | `component/src/message.rs` | Composable chat message |
| 55 | MessageScroller | `MessageScroller`, `MessageScrollerState` | `component/src/message_scroller.rs` | **Tail-following virtualized transcript**: `append`, `prepend`, `splice`, `scroll_to_item`, `is_following_tail`, `is_scrolled_up`, unread jump button, bottom fade |
| 56 | Notification | `Notification`, `NotificationList`, `NotificationSettings`, `NotificationType`, `NotificationDelivery` | `component/src/notification.rs` (65 KB) | Toasts, placement/width, dismiss callbacks, optional OS notification-center delivery |
| 57 | Pagination | `Pagination` | `component/src/pagination.rs` | Page navigation |
| 58 | Popover | `Popover` | `component/src/popover.rs` | Anchored floating surface |
| 59 | Progress | `Progress`, `ProgressCircle` | `component/src/progress/*` | Linear + circular progress, animated states |
| 60 | Radio / RadioGroup | `Radio`, `RadioGroup` | `component/src/radio.rs` | Single-select set |
| 61 | Rating | `Rating` | `component/src/rating.rs` | Star rating |
| 62 | Resizable | `ResizablePanel`, `ResizablePanelGroup`, `ResizableState`, `ResizablePanelEvent`, `h_resizable`, `v_resizable`, `resizable_panel` | `component/src/lib.rs` compat shim → `gpui_base::resizable` | Split panes w/ drag handles |
| 63 | Root | `Root` | `component/src/root.rs` (23 KB) | **Required window-level host** for theme, sheets, dialogs, notifications, Tab navigation |
| 64 | Scrollable | `Scrollable`, `ScrollableElement` | `component/src/scroll/scrollable.rs` (37 KB) | Scroll container, axis locking, scrollbar modes |
| 65 | SearchableList | `SearchableListState`, `SearchableVec`, `SearchableGroup`, `SearchableListDelegate` | `component/src/searchable_list/*` | Filterable list backing Select/Combobox |
| 66 | Select | `Select`, `SelectState`, `SelectEvent`, `Caret` | `component/src/select.rs` (36 KB) | Dropdown selection, searchable, confirm/cancel |
| 67 | Separator | `Separator`, `SeparatorStyle` | `component/src/separator.rs` | Divider |
| 68 | Settings | `Settings`, `SettingPage`, `SettingGroup`, `SettingItem`, `SettingField`, `SettingFieldType`, `NumberFieldOptions`, `RenderOptions` | `component/src/setting/*` | Settings UI with grouped pages/fields (incl. `SettingFieldElement` trait) |
| 69 | Sheet | `Sheet`, `SheetSettings` | `component/src/sheet.rs` | Edge slide-in panel |
| 70 | Shimmer | `ShimmerText`, `ShimmerStyle`, `ShimmerSpread` | `component/src/shimmer.rs` (22 KB) | Theme-aware loading text sweep |
| 71 | Sidebar | `Sidebar`, `SidebarGroup`, `SidebarHeader`, `SidebarFooter`, `SidebarMenu`, `SidebarMenuItem`, `SidebarToggleButton`, `SidebarCollapsible`, `SidebarItem` | `component/src/sidebar/*` (mod.rs 26 KB) | Navigation sidebar, collapsible modes, context menus |
| 72 | Skeleton | `Skeleton` | `component/src/skeleton.rs` | Loading placeholder |
| 73 | Slider | `Slider` | `component/src/slider.rs` | Range slider, linear/log scale, reverse |
| 74 | Spinner | `Spinner` | `component/src/spinner.rs` | Loading spinner |
| 75 | StatusBar | `StatusBar` | `component/src/status_bar.rs` | Left/center/right status strip |
| 76 | Stepper | `Stepper`, `StepperItem` | `component/src/stepper/*` | Step progress |
| 77 | Switch | `Switch` | `component/src/switch.rs` | On/off toggle |
| 78 | Table (lightweight) | `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableCaption` | `component/src/table/table.rs` | Declarative table |
| 79 | DataTable | `DataTable`, `TableState`, `TableDelegate`, `TableEvent`, `TableVisibleRange`, `Column`, `ColumnGroup`, `ColumnFixed`, `ColumnSort` | `component/src/table/*` (state.rs 106 KB) | **Virtual rows *and* columns**, sorting, filtering, fixed/resizable columns, cell selection, multi-row headers, custom row heights, stripes, batched export |
| 80 | Tabs | `Tab`, `TabBar`, `TabVariant` | `component/src/tab/*` (tab_bar.rs 40 KB) | Tabbed content w/ animated indicator, dropdown overflow |
| 81 | Tag | `Tag`, `TagVariant` | `component/src/tag.rs` | Label/category chip |
| 82 | TextView | `TextView`, `TextViewStyle`, `TextViewPlugin`, `Text`, `FrontmatterPlugin` | `component/src/text/*` (window_selection.rs 89 KB) | **Markdown + HTML rendering** |
| 83 | Theme | `Theme`, `ThemeMode`, `ThemeRegistry`, `ThemeConfig`, `ThemeColor`, `ThemeToken(s)`, `ActiveTheme`, `MotionTokens`, `ColorTokens`, `RadiusTokens`, `SpacingTokens`, `TypographyTokens`, `ShadowTokens` | `component/src/theme/*` | Theming / design tokens |
| 84 | TitleBar | `TitleBar` | `component/src/title_bar.rs` | Custom window title bar + window controls |
| 85 | Tooltip | `Tooltip` | `component/src/tooltip.rs` | Hover/focus tooltip |
| 86 | Tree | `Tree` | `component/src/tree.rs` | Hierarchical tree view |
| 87 | VirtualList | `VirtualList`, `VirtualListScrollHandle`, `h_virtual_list`, `v_virtual_list` | `component/src/virtual_list.rs` | Variable-size virtualized list |
| 88 | WindowBorder | `WindowBorder`, `window_border`, `window_paddings` | `component/src/window_border.rs` | Rounded/bordered app window shell |
| 89 | WindowExt / IndexPath / Sizing / Styled / Disableable | `WindowExt`, `IndexPath`, `Size`, `Sizable`, `StyleSized`, `Disableable`, `ThemeStyled`, `ElementExt::AnyChildElement` | `component/src/{window_ext,index_path,sizing,styled,component_traits,element_ext}.rs` | Cross-cutting traits |
| 90 | FocusTrap | `FocusTrapElement` | `component/src/lib.rs` → `gpui_base::FocusTrapElement` | Trap Tab focus in a container |
| 91 | Image (documented) | *(no `Image` struct)* — GPUI's `img()` re-exported as `gpui_kit::img` + `ImageSource`, `ObjectFit` | doc: `website/component/image.md`; story: `crates/story/src/stories/image_story.rs` | Image display with fallbacks/loading. **Not a component-crate type.** |

### 3.2 `gpui-base` primitives (unstyled counterparts)

`crates/base/src/lib.rs` re-exports ~150 public names. Notable: `Accordion*`, `AlertDialog*`, `Avatar*`, `Button`/`ButtonStyles`, `Calendar`/`CalendarState`/`CalendarItem`, `Checkbox*`, `Collapsible`, `ColorPicker`/`ColorPickerState`/`ColorSwatch`/`HslaSliders`, `Combobox`, `DatePicker`, `Dialog*`/`DialogHandle`, `FocusTrapElement`, `HoverCard`/`HoverCardState`, `History`, `Input`/`InputState`/`InputBase`/`InputStyles`, `Textarea`/`TextareaState`, `Editor`/`EditorState`, `Link`, `NavStack`/`NavStackState`/`NavPage`/`NavMotion`, `NumberInput`, `OtpInput`/`OtpState`, `Pagination`/`PaginationState`, `Popover`/`PopoverState`/`Popup`, `Positioner`/`Align`, `Progress`, `Radio`, `RadioGroup`, `ResizablePanel*`, `Scrollbar*` (86 KB), `Select`, `SelectableText`, `Sheet`, `Slider*`, `Switch*`, `Table*`, `Tabs`/`Tab`, `TextSelection*` (136 KB — window-level cross-widget selection), `TextView*`/`Text`/`markdown()`/`html()`/`MarkdownPlugin`/`MarkdownExtensions`, `Theme`/`ThemeAppearance`, `Toast`/`ToastManager`/`ToastStack`, `Toggle`/`ToggleGroup`, `Tooltip*`, `Tree`/`TreeState`/`TreeEntry`, `UndoHistory`, `VirtualList`, `AutoScroll`, `Disableable`/`Selectable`/`FocusableExt`, `Motion` (`Easing`, `Keyframes`, `Spring`, `Stagger`, `Presence`, `Transition`, `MotionReveal`, …).

### 3.3 Deep dives on the areas called out in the brief

**Text input / Textarea / editor, IME & CJK — SUPPORTED.**
`crates/base/src/input/` is the engine: `base/state.rs` (370 KB!), `base/element.rs` (123 KB), `editor/display_map/text_wrapper.rs` (57 KB), `editor/lsp/*` (completions, hover, definitions, code actions, semantic tokens, document colors), `editor/search.rs`, `editor/indent.rs`, `editor/decorations.rs`, `editor/diagnostics.rs`, `editor/auto_close.rs`. IME is explicit: `element.rs` — *"Move the IME marked range (tracked against the original text) into the display text"*; `state.rs` — *"The marked range is the temporary insert text on IME typing."*; `undo_manager.rs` — *"…perform one logical edit through several changes (IME composition…)"*. CJK is explicitly claimed in the comparison table (`CJK Support: Yes` vs egui "Bad"). `crates/base/src/input/base/rope_ext.rs` uses `metric_utf16`/`metric_chars` ropey features. Rope is `ropey = "=2.0.0-beta.1"` (a **pinned beta** — note the risk).

**Rich text / Markdown renderer — SUPPORTED (render-only).**
`gpui_base::text` (`text_view.rs` 106 KB, `node.rs` 140 KB, `inline.rs` 49 KB, `inline_flow.rs` 60 KB, `state.rs` 50 KB) renders Markdown and HTML: `markdown()`, `html()`, `MarkdownNode`, `MarkdownPlugin`, `MarkdownExtensions` (`frontmatter()`, `mdx()`, `block_parser()`, `block_renderer()`, `plugin()`, `parser_revision()`), `CodeBlock`, `TableData`, inline/local images, math blocks (via plugin), horizontal-scrolling tables, source-preserving copy, link clicks, `max_lines`, multi-click selection, incremental parsing, async parsing. HTML via `html5ever 0.27` + `markup5ever_rcdom` (parsed to the same node tree, `format/html.rs` 27 KB + a vendored `html5minify` 29 KB). **Rendering only — there is no WYSIWYG rich-text *editor*.**

**Code editor + syntax highlighting — SUPPORTED, unusually deep.**
`Editor`/`EditorState` with line numbers, gutter, indent guides, code folding (`FoldRange`, `FoldMap`, `DisplayMap`), decorations, diagnostics, inline completions, semantic tokens, document colors, hover, code actions, LSP via `lsp-types 0.97` (`features = ["proposed"]`), search/replace with `SearchSession`/`SearchMatcher`, transaction-based undo (`UndoHistory`, `InputEdit`), multi-cursor + column selection (v0.6.1), bracket auto-pair + smart indent (`AutoClosingPair`, `BracketPair`, `IndentationRules`). Highlighting via `tree-sitter 0.26.13` with **39 opt-in per-language Cargo features** (astro, bash, c, cmake, cpp, csharp, css, diff, ejs, elixir, erb, go, graphql, html, java, javascript, jsdoc, kotlin, lua, make, markdown, markdown-inline, php, proto, python, ruby, rust, scala, sql, svelte, swift, toml, tsx, typescript, yaml, zig, + json), plus `syntect 5.3` in the workspace for non-tree-sitter paths. Claim: "stable performance at 200K lines".

**Tables / data grids — SUPPORTED.** `DataTable` + `TableState` (106 KB) as above; `Table` for simple declarative tables; `List`/`ListState`/`ListDelegate`; `VirtualList`/`h_virtual_list`/`v_virtual_list` (base `virtual_list.rs` 35 KB). Marketing: *"hundreds of thousands of rows"*.

**Trees, tabs, docking/panels/splitters — SUPPORTED (strongest area).**
`Tree` (component) over `gpui_base::Tree`/`TreeState`/`TreeEntry` (21 KB), virtualized, expansion + selection, context menus, drag & drop for list items. `Tab`/`TabBar`. Docking is a full two-layer system: pure-data `LayoutTree`/`NodeKind::{Split,Tabs}`/`NodeId`/`PanelId` in `crates/base/src/dock/{layout/*,dock_area.rs (151 KB),tab_group.rs (66 KB),drag.rs,state.rs,state_convert.rs,registry.rs,test_support.rs}` and a styled skin `DockSkin` in `crates/component/src/dock/`. Features: serializable tiles, tab groups, split resizing, drag/drop placement, undo/redo, animated drop placeholders, edge snapping, `LayoutChanged` events, panel zoom, layout locking, panel registry for persisted `panel_name`.

**Menus, context menus, command palette — SUPPORTED.** `PopupMenu`, `ContextMenu` + `ContextMenuExt`, `DropdownMenu`, `AppMenuBar`, `NativeMenu` (macOS AppKit / Windows Win32 / fallback), async submenus, and `Command`/`CommandState` palette.

**Modals/dialogs/sheets/popovers/tooltips — SUPPORTED.** `Dialog` (declarative), `AlertDialog`, `Sheet`, `Popover`, `HoverCard`, `Tooltip`, `FocusTrap`, `Popup` (low-level, base), all hosted by `Root`.

**Notifications/toasts — SUPPORTED.** `Notification` + `NotificationList` + `NotificationSettings` (`NotificationDelivery` implies OS notification-center delivery), and an independent `gpui_base::toast::{Toast, ToastManager, ToastStack}` stack with motion.

**Charts/plots — SUPPORTED.** 7 high-level charts + a d3-like `plot` module.

**Date/time pickers, calendars — SUPPORTED.** `Calendar`, `DatePicker`/`DatePickerState`, `DateRangePreset`/`DateRangePresetValue`, `chrono 0.4.38`, `time/utils.rs`.

**Form controls — SUPPORTED.** Checkbox, Switch, Radio/RadioGroup, Slider, Select, Combobox, NumberInput, OtpInput, Input, Textarea, ColorPicker, Rating, Toggle/ToggleGroup, plus `Form`/`Field`. **Tri-state checkbox is MISSING** — open issue [#2857](https://github.com/longbridge/gpui-kit/issues/2857) requests it ("Current implementation of CheckBox component supports only true/false states").

**Progress, spinner, skeleton — SUPPORTED.** `Progress`, `ProgressCircle`, `Spinner`, `Skeleton`, `Shimmer`.

**Avatars, badges, tags — SUPPORTED.** `Avatar`/`AvatarGroup`, `Badge`, `Tag`, `Kbd`, `Marker`.

**SVG/icon system — SUPPORTED.** `Icon` + `IconName` enum (`crates/component/src/icon.rs`), `icon_named!` proc macro, `IconNameExt`, SVG-bytes support in icon slots (v0.6.1, PR #2980). `gpui-kit-assets` bundles **1,830 SVG files** (Lucide), embedded via `rust-embed`, served through `gpui_kit::assets::Assets`.

**Image / media viewers — PARTIAL.** No dedicated `Image` type in `gpui-component`; the doc page documents GPUI's `img()` (`gpui_kit::img`, `ImageSource`, `ObjectFit`) plus sizing. Markdown supports inline and local images, and `AvatarImage` exists. There is **no** zoom/pan image viewer, no gallery/lightbox, no video element (**[NOT FOUND]** any `video`/`media` player in gpui-kit; `gpui-pre-media` is a GPUI-level crate but not surfaced by the kit).

**Webview embedding — PARTIAL, and outside `gpui-kit`.**
Separate published crate `gpui-wry` (`crates/webview/`, depends on `wry = { package = "lb-wry", version = "0.53.3" }` — Longbridge's mirror of Tauri's wry). `crates/webview/README.md` states plainly: *"This still a experimental with limited features"*, *"The WebView will render on top of the GPUI window, any GPUI elements behind the WebView bounds will be covered."*, *"Only supports macOS and Windows currently."* and *"we recommend using the webview in a separate window or in a Popup layer."* API: `WebView`, `WebViewElement`, `WebViewHandle` (`load_url`, `back`, `show`, `hide`, `visible`, `bounds`, `raw`). **`gpui-kit` has no `webview` feature and does not depend on `gpui-wry`** — an app must add it explicitly. No Linux support.

**Drag & drop — PARTIAL.** GPUI's `on_drag`/`drop_target` are used internally (dock tabs `base/src/dock/{drag.rs,tab_group.rs}`, list items `component/src/list/list_item.rs`, table columns `component/src/table/state.rs`, sliders, resize handles). There is **no generic, reusable DnD abstraction** exposed by the kit (no `DndContext`/draggable-sortable API).

**PDF — MISSING.** No PDF crate in any `Cargo.toml`; no PDF renderer/viewer/thumbnailer. The only `pdf` strings in the tree are illustrative attachment filenames (`AttachmentTitle::new("report.pdf")` in `crates/component/src/attachment.rs` story/test code).

**Theming system (light/dark, tokens, density, typography) — SUPPORTED.**
`Theme` global + `ActiveTheme` (`cx.theme()`), `ThemeMode`, `ThemeRegistry` (`load_themes_from_str`, `watch_dir`, `themes()`, `sorted_themes()`, `default_themes()`), JSON theme config with a published `.theme-schema.json` (32 KB) at the repo root. Semantic tokens split into `ColorTokens`, `RadiusTokens`, `SpacingTokens`, `TypographyTokens`, `TextStyleToken`, `ShadowTokens`, `MotionTokens`, plus `SemanticThemeConfig` with gradient backgrounds and global radius consistency. Size system `Size::{xs,sm,md,lg}` via `Sizable`. **The library ships one built-in theme set** (`crates/component/src/theme/default-theme.json`, 14 KB, `"name": "Default"` with `"Default Light"` / `"Default Dark"` variants) — the 21 JSON files in `/themes` (adventure, alduin, asciinema, aurora, ayu, catppuccin, everforest, fahrenheit, flexoki, gruvbox, harper, hybrid, jellybeans, kibble, macos-classic, mellifluous, molokai, solarized, spaceduck, tokyonight, twilight) are **embedded only in the story gallery** (`crates/story/src/embedded_themes.rs`), **not in the published crate**. Density is expressed via `Size` + spacing tokens; there is no explicit "compact/comfortable" density mode.

**i18n/localization — SUPPORTED (narrow).** `rust-i18n 4.2` with `rust_i18n::i18n!("locales", fallback = "en")` in `crates/component/src/lib.rs`; locale file `crates/component/locales/ui.yml` covering `Calendar, DatePicker, Select, ComboBox, Dock, ColorPicker, Dialog, Command, List, Input, Settings, Pagination, Carousel`. Built-in languages: **`en`, `zh-CN`, `zh-HK`** (docs say three; the file also carries `zh-TW` and `it` keys). Apps add/override via `rust_i18n::extend!(gpui_component)` with deep-merge priority; `gpui_kit::component::{set_locale, locale}` re-exported. Caveat documented: the active locale is not tracked by GPUI, so views must `cx.notify()` after switching.

**Accessibility — PARTIAL, actively improving.**
`accessibility_role` / accessible-label usage appears across ~30 files: `base/src/{accordion,button,calendar,checkbox,color_picker,date_picker,dialog,editor,input,link,list,number_input,pagination,progress,radio,radio_group,select,slider,switch,tab,table,tabs,tooltip}.rs` and `component/src/menu/{menu_item,popup_menu}.rs`, `component/src/carousel.rs`. v0.4.0 release notes explicitly say *"docs: Remove incorrect `Accessibility` section"*, implying the docs previously over-claimed. v0.6.1 added dialog-close-button and calendar-item accessibility (PRs #2969, #2996). There is a macOS-specific shim `crates/base/src/macos_accessibility.rs` exposing `install_window_hit_test_forwarder` — a **workaround**, suggesting native a11y hit-testing is not transparent. There is also `docs/ACCESSIBILITY-UI-TESTING.md` and `crates/shell/src/a11y.rs`. Open issue [#2838](https://github.com/longbridge/gpui-kit/issues/2838) is the maintainer's own TODO: *"base: Add complete keyboard navigation to Tabs"* — i.e. tab-list keyboard nav is **not yet complete**.

---

## 4. Public API and application bootstrap

### 4.1 Dependency + entry point

```toml
[dependencies]
gpui-kit = "0.6"
```

`gpui-kit`'s `default = ["component", "assets"]`. `application()` comes from `gpui_platform` and is re-exported at the kit root for non-mobile targets.

From `crates/kit/src/lib.rs` (doctest, verbatim):

```rust
use gpui_kit::*;

actions!(hello, [Quit]);

struct Hello;
impl Render for Hello {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().child("Hello, World!")
    }
}

fn main() {
    gpui_kit::application().run(|cx| {
        gpui_kit::init(cx);
        cx.spawn(async move |cx| {
            cx.open_window(WindowOptions::default(), |_, cx| cx.new(|_| Hello))
                .expect("failed to open window");
        })
        .detach();
    });
}
```

From `README.md` (the styled path — note `Root::new(view, window, cx)` is **mandatory** as the first view of every window):

```rust
use gpui_kit::component::button::*;
use gpui_kit::component::*;
use gpui_kit::*;

pub struct HelloWorld;
impl Render for HelloWorld {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().v_flex().gap_2().size_full().items_center().justify_center()
            .child("Hello, World!")
            .child(Button::new("ok").primary().label("Let's Go!")
                .on_click(|_, _, _| println!("Clicked!")))
    }
}

fn main() {
    gpui_kit::application().run(move |cx| {
        gpui_kit::init(cx);            // must be called before any component feature
        cx.spawn(async move |cx| {
            cx.open_window(WindowOptions::default(), |window, cx| {
                let view = cx.new(|_| HelloWorld);
                cx.new(|cx| Root::new(view, window, cx))   // first level must be a Root
            }).expect("Failed to open window");
        }).detach();
    });
}
```

Assets: `gpui_kit::application().with_assets(gpui_kit::assets::Assets)` for the bundled Lucide set.

### 4.2 Composition / app shell

There is a **real full-shell example**: `examples/dock/src/main.rs` (`cargo run -p example-dock`). It wires `AppTitleBar` + `DockSkin::dock_area("main-dock", Some(5), window, cx)` + `DockArea` + `StatusBar`, binds `shift-escape`→`ToggleZoom` and `ctrl-w`→`ClosePanel`, subscribes to `DockEvent::LayoutChanged` to persist layout to `target/docks.json` (debug) / `docks.json` (release), and re-uses the story gallery's component views (`AccordionStory`, `DataTableStory`, `SidebarStory`, …). `examples/sidebar`, `examples/window_title`, `examples/root_borderless`, `examples/dialog_overlay`, `examples/focus_trap`, `examples/table_in_scrollable` cover the other shell pieces.

### 4.3 Example apps in the repo

Workspace members (`Cargo.toml`) + `examples/`:

- Gallery: `crates/story` (default member; `cargo run`), `crates/story-web` (WASM).
- `examples/`: `ai_recipes` (`gpui-kit-recipes`), `app_assets`, `brush` (`example-brush`), `dialog_overlay`, `dock` (`example-dock`), `editor` (`example-editor`), `focus_trap`, `fps_monitor`, `hello_world`, `html` (`example-html`), `input`, `large-text` (`example-large-text`), `markdown` (`example-markdown`), `markdown_table`, `root_borderless`, `sidebar`, `stream-markdown` (`example-stream-markdown`), `system_monitor`, `table_in_scrollable`, `text_max_lines`, `text_selection`, `tooltip_top_edge`, `webview`, `window_title`.
- JS/gpui-shell: `examples/js_dock`, `examples/js_story`, `examples/js_todolist` (no Cargo.toml — script bundles).
- `examples/ai_recipes/README.md` describes an **isolated consumer** that depends only on `gpui-kit`, with `script/check-ai {docs,rust,shell,all}` as an acceptance gate — a notably rigorous scaffold for AI-assisted development.

### 4.4 Testing API

`gpui_kit::test` (feature `test-support`) + `#[gpui_kit::test]`: headless windows, native input dispatch, scoped queries (`window.find("...").click("input", cx)`, `.expanded()`, `.value()`), `TestAppContext::wait_for`, `render_frame`, snapshots. Test targets in `crates/kit/Cargo.toml`: `window, lifecycle, components, input, ui, controls, interactions, rendering (Metal-only, harness=false), disclosure, overlays, menu, collections, date_picker, dock, search`. Issue #3047 contains a complete working example of this API (a failing regression test), which is good evidence it is really usable.

### 4.5 Agent-facing skills

`README.md`: `npx skills add longbridge/gpui-kit` installs two skills — `gpui-kit` (setup, component catalog, GPUI mechanics, coding guides) and `gpui-kit-design-guides`. Sources live in `skills/`. Also `/llms-full.txt` and per-page `.md` routes on the docs site, plus `.claude/`, `CLAUDE.md`.

---

## 5. Documentation site (`https://gpui-kit.com`)

Built with **Astro** (migrated from VitePress in v0.6.1, PR #2926). Source of truth is `website/`. Sitemap: `https://gpui-kit.com/sitemap.xml`. LLM dump: `https://gpui-kit.com/llms-full.txt` and `https://gpui-kit.com/llms.txt`.

**Site structure (4 sections × 2 locales, EN + zh-CN):**

**A. `/docs/*` — 14 pages** (`website/docs/*.md`): `index` (GPUI Kit overview + quick example), `installation`, `getting-started`, `design-guides`, `coding-guides`, `test`, `mobile`, `i18n`, `assets`, `context`, `element_id`, `fps`, `comparison`, `fonts`.

- **installation** — macOS 15+ / Xcode CLT; Windows 10+ (`script/install-window.ps1`); Linux (`./script/bootstrap`); **Rust 1.90+**; `gpui-kit = "0.6"`; plus a `[profile.dev.package] opt-level = 3` recipe for `gpui-pre`, `gpui-component`, `gpui-kit`, `gpui-kit-assets`, `gpui-pre-macros`, `gpui-pre-platform`, `rustybuzz`, `taffy`, `ttf-parser` because debug builds are otherwise unusably slow.
- **getting-started** — setup/usage.
- **design-guides** — normative product/interaction design rules ("requirements, not optional inspiration" per `CLAUDE.md`); terminology rules for Chinese docs/UI.
- **coding-guides** — architecture + coding conventions.
- **test** — `TestAppContext`, native UI interactions, layout assertions, CI.
- **mobile** — **experimental iOS** via `gpui-pre-mobile`, maintained in the Longbridge fork `https://github.com/longbridge/gpui-mobile` (pinned `rev = "0b882efdac7f524e0bb0b1d4c886b2aa752f9f20"`), requires `gpui-pre = "=0.3.4"` + `gpui-pre-wgpu`; the manifest's `0.1.0` does **not** imply a crates.io release. Plan is to move to community `gpui-mobile` once GPUI ships as a crate.
- **i18n** — as described in §3.3; explicitly documents the `extend!` namespace trick, deep-merge priority, and the "must `cx.notify()` after `set_locale`" gotcha.
- **assets** — bundled icons + custom assets.
- **context / element_id** — GPUI `Window`/`Context` and `ElementId` concepts.
- **fps** — the `gpui-fps` HUD: what MAX FPS means, why it is *derived* from frame cost rather than counted, and what each row measures.
- **fonts** — system fonts, theme fonts, per-element overrides, bundling custom fonts, WASM; monospace fallback (v0.6.1 PR #3009).
- **comparison** — hand-maintained table vs Iced / egui / Qt 6 (see §7).

**B. `/component/*` — 72 pages** (`website/component/*.md`), the styled component gallery, plus `/component` index grouping them as Basic (30) / Form (10) / Layout (12) / Advanced (12).

**C. `/base/*` — 8 pages + 44 primitive pages** (`website/base/*.md`, `website/base/primitives/*.md`): `index`, `getting-started`, `dock`, `history`, `motion`, `text-selection`, `text-view`, `virtual-list`, plus primitives (accordion, alert-dialog, avatar, button, calendar, checkbox, collapsible, color-picker, combobox, date-picker, dialog, editor, hover-card, input, link, nav-stack, number-input, otp-input, pagination, popover, popup, progress, radio, radio-group, resizable, scrollbar, select, sheet, slider, switch, table, tabs, textarea, toast, toggle, toggle-group, tooltip, tree).

**D. `/shell/*` — 15 pages** (`website/shell/*.md`) documenting the QuickJS runtime: `index`, `getting-started`, `api`, `capabilities`, `dependencies`, `dock`, `elements`, `engine`, `examples`, `host-module`, `hosting`, `overlays`, `performance`, `state`, `styling`. Key quotes: *"Makes a Rust GPUI application extensible in JavaScript, rendered by GPUI itself — no WebView, no DOM."*; `capabilities` = *"The default-deny model, the fs / storage / clipboard / process surface… what the sandbox withholds."*; `engine` = QuickJS behind an internal seam.

**E. Non-doc pages:** `/` (landing), `/apps` (App Stories — third-party apps), `/contributors`, `/releases`, `/skills`. Each doc page also has a `.md` twin and there is a full `llms-full.txt`.

**FAQ / roadmap / limitations pages: [NOT FOUND]** as dedicated pages. Limitations are scattered: the WebView README, `website/docs/mobile.md` ("experimental"), `website/docs/comparison.md` footnotes, and open GitHub issues. There is no public roadmap page or milestone plan in the repo payload (`"has_projects": false`, no milestones returned).

---

## 6. Platform support

| Platform | Status | Evidence |
| --- | --- | --- |
| **macOS** | Supported, primary. aarch64 + x86_64. Requires macOS 15+. | `CLAUDE.md` "Platform Support"; `website/docs/installation.md`; `crates/component/Cargo.toml` `core-text = "=21.0.0"` + objc2 AppKit for NativeMenu; `crates/base/src/macos_accessibility.rs`; CI runs macOS incl. a Metal-only `rendering` test target. |
| **Windows** | Supported, x86_64. Windows 10+. | `CLAUDE.md`; `script/install-window.ps1`; `crates/component/Cargo.toml` `windows` crate features + `resvg` for Win32 menu icons; v0.6.1 PR #2974 "Constrain uxtheme loading to System32". |
| **Linux** | Supported, x86_64. X11 + Wayland features both enabled (`gpui_platform` features `["font-kit","x11","wayland","runtime_shaders"]`). | `Cargo.toml`; `script/bootstrap`, `script/install-linux.sh`; CI. |
| **Web / WASM** | Supported for the docs gallery. | `crates/story-web`, `gpui-pre-web`, `gpui_kit::web`, `wasm_stub.rs` for highlighter; site examples are WASM embeds. |
| **iOS / Android** | **Experimental / not in `gpui-kit`.** | `website/docs/mobile.md`; `gpui_base::is_mobile()`; `crates/kit` gates `application` and `platform` behind `not(any(target_os="ios", target_os="android"))`. |

### Known platform-specific issues (from the open-issue tracker and code)

1. **Wayland: no window decorations.** [Issue #3035](https://github.com/longbridge/gpui-kit/issues/3035) — *"(TitleBar) There are no window decorations on Wayland"*: on GNOME/Wayland there are no close/minimize buttons and `TitleBar` does not render. Reported 2026-09-10, 3 comments, still open.
2. **Linux/Wayland pointer interaction.** [Issue #2825](https://github.com/longbridge/gpui-kit/issues/2825) — `div().on_hover()` / `on_click()` not firing on Manjaro 26 + niri, and the hosted Button demo "stuck" after selecting from an options menu.
3. **Windows native menu hardening.** v0.6.1 restricted `uxtheme` DLL loading to System32 (PR #2974) — implies a prior DLL-search-order concern.
4. **WASM/WebGPU.** [Issue #2848](https://github.com/longbridge/gpui-kit/issues/2848) — the WASM gallery logs *"WebGPU canvas configured with a different format than is preferred by this device ("rgba8unorm")"* → extra copy, performance impact, on the docs site.
5. **WebView is macOS + Windows only and always draws above GPUI content** (`crates/webview/README.md`).
6. **Fonts.** v0.6.1 PR #3009 added a fallback to an installed monospace font when the default is missing; PR #2933 bundles IBM Plex Sans so `.SystemUIFont` resolves on the web. `website/docs/fonts.md` documents system/theme/custom/WASM font paths.
7. **macOS accessibility shim** (`install_window_hit_test_forwarder`) suggests a11y hit-testing needs platform work.

### IME / CJK / font-fallback notes

- IME composition is modelled explicitly as a "marked range" in `gpui-base` (`input/base/{state,element,undo_manager,mask_pattern}.rs`) and the shell notes that *"testing, scrolling, and IME are entirely in Rust"* (`docs/gpui-shell.md`). The underlying platform IME integration comes from GPUI/Zed.
- CJK is an explicit differentiator in the comparison table (`CJK Support: Yes`, with egui marked `Bad`), consistent with a Chinese-market vendor (Longbridge) shipping a CJK-first trading app.
- `mask_pattern.rs` comments note that mappings are 1-char→1-char with equal UTF-16 length "so the IME…" behaves — i.e. masked inputs were designed around IME.
- I did **not** independently test CJK input on Windows/Linux. **[UNVERIFIED]** beyond source comments and vendor claims.
- Font fallback: `crates/component/src/theme/mono_font.rs` + the v0.6.1 fallback PR; the docs comparison footnote calls the text stack "Rope" (ropey), and `website/docs/fonts.md` is the reference.

---

## 7. Dependency footprint & build weight

### 7.1 Direct, notable dependencies

**`gpui-base`** (`crates/base/Cargo.toml`): `gpui`(=gpui-pre 0.3.1), `gpui_macros`, `anyhow`, `aho-corasick`, `chrono 0.4.38`, `futures`, `instant`, `lsp-types 0.97 (proposed)`, **`markdown 1.0`**, **`html5ever 0.27`**, **`markup5ever_rcdom 0.3`**, `ropey = "=2.0.0-beta.1"`, `regex`, `schemars 1`, `serde`/`serde_json`, `smallvec`, `sum-tree`(=gpui-pre-sum-tree), `tracing`, `unicode-segmentation`, `web-time`; native: `smol`; wasm: `async-channel`; macOS: `raw-window-handle`, `objc2`, `objc2-app-kit`, `objc2-foundation`.

**`gpui-component`** (`crates/component/Cargo.toml`): `gpui-base`, `gpui-component-macros`, **`gpui-kit-assets`** (always — pulls `rust-embed 8.7.2` + the icon set), `gpui_macros`, `regex`, `anyhow`, `notify 7`, `ropey`, **`rust-i18n 4.2`**, `schemars`, `serde`/`serde_json`/`serde_repr`, `smallvec`, `sum-tree`, `tracing`, `log`, **`markdown 1.0`**, `enum-iterator`, `itertools`, `once_cell`, `paste`, `uuid`, **`num-traits`**, optional `rust_decimal`, `chrono`, `lsp-types`, `instant`, native `smol`; optional tree-sitter + **36 grammar crates**; macOS `core-text = "=21.0.0"` + objc2 app-kit/foundation; **Windows: `resvg 0.45.1` + the `windows` crate (GDI/GDI+/COM/menus)**.

**`gpui-kit`** (`crates/kit/Cargo.toml`): only `gpui`, `gpui-base`, optional `gpui-component`, optional `gpui-kit-assets`, `gpui_platform` (non-mobile), `gpui_web` (wasm). Very thin (~435 LOC, 2 files per crates.io).

**`gpui-shell`** (unpublished, `publish = false`): `gpui-base`, `gpui-fps`, `gpui_platform`, **git-only** deps on `https://github.com/longbridge/quickjs-jit` (`quickjs-jit`, `quickjs-jit-runtime`, `quickjs-jit-stdlib`, pinned revs `9a83a7f9…` and `605da483…`), `cap-std 4`, `fs2`, `sha2`, `wait-timeout`, optional `reqwest`, `tungstenite`; plus `[patch.crates-io] rquickjs = { path = "crates/shell/rquickjs-compat" }` in the workspace.

**`gpui-wry`**: `wry = { package = "lb-wry", version = "0.53.3" }` (a Longbridge mirror of Tauri wry) — **unusual**: a non-upstream registry package name.

### 7.2 Does it pull in the whole Zed codebase?

**No.** It pulls the `gpui-pre-*` snapshot family only — 26 packages (`gpui-pre`, `-apple`, `-collections`, `-derive-refineable`, `-http-client`, `-http-client-tls`, `-linux`, `-macos`, `-macros`, `-media`, `-perf`, `-platform`, `-refineable`, `-reqwest`, `-reqwest-client`, `-scheduler`, `-shared-string`, `-sum-tree`, `-util`, `-util-macros`, `-web`, `-wgpu`, `-windows`, `-zlog`, `-ztracing`, `-ztracing-macro`), which is Zed's `crates/gpui*` subtree re-published. `gpui-pre` itself is 58,013 Rust LOC across 87 files, 5.28 MB packed. No `zed`, no `editor`, no `language`, no `project`, no `collab`.

### 7.3 Build-weight estimate

| Metric | Value | Source |
| --- | --- | --- |
| `Cargo.lock` package count | **1,227** | `grep -c '^\[\[package\]\]' Cargo.lock` (whole workspace incl. shell/tests/examples) |
| `gpui-component` crate size on crates.io | 596 KB | crates.io 0.6.1 |
| `gpui-component` code | 61,684 Rust LOC / 214 files + 1,351 Scheme LOC / 17 files | crates.io `linecounts` |
| Local `crates/component/src` | 72,804 lines | on-disk count |
| `gpui-base` crate size | 626 KB | crates.io |
| `gpui-base` code | 65,652 Rust LOC / 149 files | crates.io |
| Local `crates/base/src` | 73,578 lines | on-disk count |
| `gpui-kit` crate size | 92.7 KB (435 LOC) | crates.io |
| `gpui-pre` crate size | **5.28 MB**, 58,013 LOC | crates.io |
| Bundled icons | **1,830 SVG files** | `crates/assets` |
| `gpui-shell` source | 71,232 lines (unpublished) | on-disk |

**Estimate:** a minimal `gpui-kit` GUI app compiles GPUI + wgpu + rustybuzz/taffy/ttf-parser/resvg + the component library + `rust-embed`ed icons. Count on **hundreds of crates and a multi-minute clean debug build**; the project's own docs devote a section to `opt-level = 3` overrides precisely because unoptimized debug builds of GPUI are slow enough to be a problem. Enabling `tree-sitter-languages` adds 36 grammar crates (each a C compile). The comparison table claims a **12 MB** minimum release binary for a hello-world (vs egui 5 MB, Iced 11 MB, Qt 20 MB).

---

## 8. Gaps & risks for an agent-workbench desktop app

Target app profile assumed: multi-panel, long scrolling transcripts, markdown + code rendering, embedded browser, PDF preview, file trees, data tables, rich text editing.

| Capability | Verdict | Evidence |
| --- | --- | --- |
| **Multi-panel shell** | **SUPPORTED** | `DockArea`/`DockSkin`/`LayoutTree`/`TabGroup`/`Panel`, edge docks, nested splits, serializable layout, drag reorder, undo/redo, zoom, lock; `examples/dock/src/main.rs` is a working shell; `StatusBar`, `Sidebar`, `TitleBar`, `Resizable`. |
| **Long scrolling transcripts** | **SUPPORTED** | `MessageScroller` (`append`/`prepend`/`splice`/`is_following_tail`/`scroll_to_item`/jump button) + `Message`/`Bubble`/`Marker`/`Attachment`; `VirtualList` variable-size; v0.6.1 fixed selection drag-autoscroll in virtualized lists. |
| **Markdown rendering** | **SUPPORTED** | `TextView` + `markdown()`; incremental parsing, tables w/ horizontal scroll, inline/local images, math & frontmatter plugins, `MarkdownPlugin`/`MarkdownExtensions`, source-preserving copy, window-level cross-widget selection. |
| **Code rendering + syntax highlighting** | **SUPPORTED** | `SyntaxHighlighter` + tree-sitter, 39 language features, `HighlightTheme`, code-block styling; `Editor` for editable code. |
| **Embedded browser** | **PARTIAL — high risk** | `gpui-wry` is a *separate, unpublished-in-kit* crate; **experimental**; **macOS + Windows only**; the webview **draws on top of** all GPUI content (no clipping/compositing), so it must live in its own window or a popup layer. No Linux. |
| **PDF preview** | **MISSING** | No PDF dependency or renderer anywhere; only the word "report.pdf" in an `Attachment` story. Would have to be built (e.g. `pdfium`/`mupdf` bindings) or deferred to the webview. |
| **File trees** | **PARTIAL** | `Tree`/`TreeState`/`TreeEntry` (virtualized, expansion, selection, context menus) exists, but it is a *generic* tree: there is **no filesystem-backed file tree**, no lazy directory loading, no OS file-picker (no `rfd` or equivalent anywhere in the tree — **[NOT FOUND]**), and no path/icon/file-type mapping. Icons exist (1830 SVGs) but no `file-type → IconName` mapping layer. |
| **Data tables** | **SUPPORTED** | `DataTable` + `TableState`: virtual rows *and* columns, sorting, filtering, fixed/resizable columns, cell selection, multi-row headers, custom row heights, batched export. |
| **Rich text editing (WYSIWYG)** | **MISSING** | Two separate things exist: `Editor` (a *code* editor over a Rope with LSP/tree-sitter) and `TextView` (read-only rendering). There is no rich-text document model, no inline formatting commands, no collaborative/WYSIWYG editor. **This is the biggest structural gap for a chat/agent app that needs rich composition.** |
| **Command palette / quick actions** | **SUPPORTED** | `Command`/`CommandState` (94 KB state) — filtered command list. |
| **Menus / context menus / native menus** | **SUPPORTED** | `PopupMenu`, `ContextMenu`, `DropdownMenu`, `AppMenuBar`, `NativeMenu` (AppKit + Win32). |
| **Dialogs / sheets / popovers / tooltips** | **SUPPORTED** | `Dialog`, `AlertDialog`, `Sheet`, `Popover`, `HoverCard`, `Tooltip`, `FocusTrap`, hosted by `Root`. |
| **Notifications / toasts** | **SUPPORTED** | `Notification` + `Toast`/`ToastStack` + optional OS notification-center delivery. |
| **Charts** | **SUPPORTED** | 7 charts + `plot` primitives (scales, shapes, axes, grid, labels, tooltips, crosshair). |
| **Theming / light-dark / tokens** | **SUPPORTED** (one built-in theme set) | `Theme`/`ThemeMode`/`ThemeRegistry`, semantic token groups, JSON schema, `sync_system_appearance`. Extra themes exist but live in the story gallery, not the crate. |
| **i18n** | **SUPPORTED but narrow** | Built-in `en`, `zh-CN`, `zh-HK`; app-level `extend!` deep-merge; `set_locale`/`locale`. You own all non-component strings. |
| **Accessibility** | **PARTIAL** | Role/label APIs used across ~30 modules and improving each release, but a maintainer-owned TODO for Tabs keyboard nav is open (#2838), docs once over-claimed a11y, and macOS needs a hit-test shim. Native screen-reader parity is **[UNVERIFIED]**. |
| **Drag & drop (generic)** | **PARTIAL** | Used internally for dock tabs, list items, table columns, sliders, resize handles; **no reusable public DnD/sortable abstraction**. |
| **Web / WASM target** | **SUPPORTED** (with caveats) | `crates/story-web`, `gpui_kit::web`, `wasm_stub.rs`; WebGPU format warning on the docs site. |
| **Mobile** | **MISSING from the crate** | Experimental `gpui-pre-mobile` via a git dependency in a separate Longbridge fork. |

### Cross-cutting risks

1. **API churn.** `0.x` with documented mass renames (0.4.0) and a 0.6.0 re-architecture that split crates and moved modules (`TextView` moved to `gpui-base` with a compat facade; `Resizable` is now a compat shim in `component/src/lib.rs`). Budget for migration work every minor.
2. **Single-vendor, single-maintainer.** `huacnlee` = ~62% of commits; the project exists to serve Longbridge Pro. Roadmap items you need may be lower priority than vendor needs.
3. **GPUI is a moving snapshot.** Weekly automated `gpui-pre` republishing; when upstream breaks, *"publication is paused and GPUI Kit is updated"* — meaning you can be pinned on an older GPUI until Longbridge catches up. `gpui-pre` is an unofficial repackaging, so you inherit whatever Zed changes without a stability contract.
4. **Pinned beta / pinned exact deps.** `ropey = "=2.0.0-beta.1"`, `core-text = "=21.0.0"` — exact pins in your dependency graph.
5. **Non-upstream packages.** `lb-wry` (webview), `quickjs-jit` (git-only, shell), `rquickjs` patched to a local path. Supply-chain review needed; `gpui-shell` cannot be used from crates.io at all.
6. **Windows `resvg` + `windows` crate and macOS `core-text`/`objc2` are unconditional** for `gpui-component`, so cross-compiling and CI matrix cost is real.
7. **`Editor` fold state is not publicly controllable** — open issue #2826 asks for `EditorState::set_fold_candidates`/`set_folded_ranges`; today consumers must reach into private fields or impersonate a syntax highlighter.
8. **Search layout allocates for all match ranges** — open issue #3017 (`layout_search_matches`, `crates/base/src/input/base/element.rs#L800`) will hurt on large transcripts/code documents until fixed.
9. **Wayland window decorations are broken today** (#3035) — a shipping blocker for Linux desktop if you need custom chrome.
10. **Docs quality is high but example embeds are clipped** (#2997) and some docs lag the code (CLAUDE.md still says "GPUI: Git version from Zed repository" while the manifest uses crates.io `gpui-pre`).

---

## 9. Explicit uncertainty register

| Item | Status |
| --- | --- |
| GPUIX relationship | **[NOT FOUND]** — zero references in the checkout or docs. No relationship established either way. |
| `gpui-component` 0.4.0 on crates.io | **[UNVERIFIED]** — the versions array was truncated in my fetch; the GitHub `v0.4.0` release exists (2025-11-17). crates.io reports 26 versions total. |
| Exact "number of components" | Vendor says "60+"; `lib.rs` has 66 modules; the docs have 72 component pages; my table lists 91 rows including sub-components and utility traits. No single authoritative number. |
| Longbridge Pro as consumer | Vendor claim, repeated in README/site/release notes. **[UNVERIFIED]** independently. |
| Third-party app list on `/apps` | Not enumerated. |
| Build time / binary size on this machine | **[UNVERIFIED]** — no build performed. 12 MB figure is the project's own comparison-table claim. |
| IME behaviour on Windows/Linux in practice | **[UNVERIFIED]** — source-level evidence only. |
| Accessibility parity with native toolkits | **[UNVERIFIED]** — role/label usage exists; no audit performed, no screen-reader testing. |
| Whether all 21 `/themes/*.json` are usable by an app | They are embedded only in `crates/story`; an app must supply its own theme JSON (supported via `ThemeRegistry::load_themes_from_str`/`watch_dir` and the published `.theme-schema.json`). |
| Open-issue severity distribution | I sampled the newest ~10 open issues; 75 are open. Not exhaustively triaged. |

---

## 10. Bottom line

`gpui-kit` is the **renamed, re-architected continuation of `gpui-component`** by Longbridge, and it is a genuinely substantial Rust desktop framework: ~130 KB of first-party Rust across `gpui-base` (unstyled behavior) and `gpui-component` (styled system), built on an **unmodified weekly snapshot of Zed's GPUI** republished as `gpui-pre 0.3.1` (Zed rev `801c087`). It is not a GPUI fork and it does not vendor Zed.

For an agent-workbench app it covers a surprising amount out of the box — **dockable multi-panel layout, virtualized tail-following chat transcripts, Markdown+code rendering with tree-sitter, a real DataTable, command palette, menus, overlays, notifications, charts, theming, and a headless UI test harness** — all of which are rare to find in one Rust GUI stack.

Its hard gaps are equally clear: **no PDF, no rich-text (WYSIWYG) editor, no generic drag-and-drop abstraction, no filesystem file-tree or file picker, and an experimental macOS/Windows-only WebView that always paints above GPUI content**. Add to that a single-vendor 0.x project with documented breaking renames, exact-pinned beta dependencies, an unofficial GPUI repackaging you must track weekly, and today-broken Wayland window decorations. The realistic migration posture is: **adopt for the shell/data/chat-rendering core, plan to build PDF + file-tree + rich-text yourself, and design the embedded-browser panel around a separate window rather than an in-layout webview.**
