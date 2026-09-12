# GPUIX / gpui-kit / 原生前端迁移可行性深度评估

- 日期：2026-09-12
- 性质：探索性技术评估（**未修改任何产品代码**）
- 范围：GPUIX、gpui-kit、上游 GPUI 生态；craft-agents 前端架构；四条迁移路径的逐项可行性
- 证据基线：
  - GPUIX `remorses/gpuix` main @ `18e695e`（2026-09-10），本地检出 `docs/research/gpuix-scratch/gpuix`
  - gpui-kit `longbridge/gpui-kit` main @ `84f57fdf`（2026-09-12），本地检出 `docs/research/.scratch/gpui-kit`
  - 上游 GPUI：Zed monorepo `crates/gpui`、crates.io `gpui 0.2.2`、`gpui-pre 0.3.1`
  - craft-agents 本仓库当前工作树
- 详细调研附件：`docs/research/gpui-profile.md`、`docs/research/gpui-kit-profile.md`、`docs/research/gpui-ecosystem-and-gaps.md`、`docs/research/craft-renderer-inventory.md`

---

## 0. 结论先行

### 0.1 三个必须先纠正的前提

**前提一：GPUIX 不是 Rust UI 框架，它是"React 渲染器替换"。**

GPUIX 的公开 API 100% 是 TypeScript/JSX。它通过 napi-rs 把 React 的 reconciler 接到 Zed 的 GPUI 上：React 收集变更 → `applyBatch(json)` → Rust `RetainedTree` → 每帧 `build_element()` → GPUI 布局（Taffy flexbox）→ GPU 绘制。没有 `View`/`Render` trait，没有 `Entity<T>`/`Context<T>`，状态就是 `useState`。

所以"迁移到 GPUIX"**不等于**"用 Rust 重写"，而是"把 React 从 DOM 渲染改到 GPU 渲染，宿主运行时从 Chromium 换成 Bun/Node"。

**前提二：GPUIX 与 gpui-kit 不是同一类东西，它们是两条互斥的路。**

| | GPUIX | gpui-kit |
|---|---|---|
| 语言 | TypeScript/JSX + 一个封闭的 Rust 桥 | 纯 Rust |
| 宿主运行时 | Bun / Node（必须另有 JS 运行时） | 无，单一二进制 |
| GPUI 依赖 | `remorses/zed` **整个 Zed 仓库的个人 fork**（git submodule + 路径依赖） | crates.io `gpui-pre 0.3.1`（Zed 上游快照，每周自动重发布） |
| 组件层 | 12 个宿主元素 + 少量 headless 原语 | 66 模块 / 90+ 组件，含 Dock、DataTable、Editor、MessageScroller |
| 成熟度 | v0.7.0，单作者 320/337 commits，19 个未消费 changeset | 0.6.1，14.3k star，26 个版本，Longbridge Pro 生产使用 |
| 许可 | Apache-2.0 | Apache-2.0（**但有未决的 GPL 溯源风险，见 0.2**） |

**前提三（最关键，且是修正）：许可边界比表面复杂得多。**

- **GPUI 本体是 Apache-2.0**，四个独立来源验证：`crates/gpui/Cargo.toml` 的 `license = "Apache-2.0"` + `publish = true`、`crates/gpui/LICENSE-APACHE`、crates.io 元数据、以及 Longbridge 用 GPUI 发布闭源商业产品 Longbridge Pro 的事实。
- **但 Zed 仓库是 GPL-3.0-or-later 为主**（README 原文："licensed primarily under GPL-3.0-or-later, with Apache-2.0 components where marked"）。分界线正好落在"纯 UI 工具包"与"让它成为一个应用的东西"之间：

| 许可 | crates |
|---|---|
| ✅ Apache-2.0（安全） | `gpui`、`gpui_platform`、`gpui_wgpu`、`gpui_web`、`gpui_macos/windows/linux/apple` + 支撑 crate |
| ⛔ GPL-3.0-or-later（传染） | **`editor`、`markdown`、`markdown_preview`、`ui`、`ui_input`、`terminal`、`language`、`project`、`workspace`、`rope`、`multi_buffer`**、`auto_update` |

**因为 Rust 是静态链接，只要引入 Apache 层之上的任何一个 crate，整个二进制就变成 GPL-3.0-or-later。** 而 Zed 的编辑器、Markdown 渲染器、终端、UI 组件库——**恰好就是本项目最想要的那部分**——全部不可用。Zed 根 `Cargo.toml` 还设了 `[workspace.package] publish = false`，所以它们是"不可发布"而非仅仅"GPL"。

**未决风险**：HN 上有评论指称 `gpui-component`「借用了直接从 Zed 主仓库搬来的代码模式」（那些代码是 GPL）。`gpui-kit` v0.6.1 确实发过一个 PR #2936「gpui-pre: Audit licenses before publishing and state GPUI's origin」并声明 Apache-2.0。对 GPUI 本身做快照是合法的（GPUI 确实是 Apache-2.0），**但 `gpui-component`/`gpui-base` 是否混入了 GPL 的 Zed 代码，目前未有结论，依赖前需要法务/溯源审计。**

### 0.2 直接回答

**问题一：整套迁移到 GPUIX 的可能性？**

> **技术可行，但产品上不可接受；成本上是最差的一条路。**

它需要重写 **142,183 行** UI 逻辑（两个包合计，不是移植，是重写），同时**保留**全部 Node/JS 运行时复杂度，最终收益却只有"没有 Chromium"。而本项目最复杂的 UI 恰好落在 GPUIX 的硬缺口上：109 处嵌套滚动（GPUIX 架构性禁止）、无多窗口、无内嵌浏览器、无富文本编辑、剪贴板仅纯文本、无自定义字体加载、无 PDF；CSS 主题引擎的 267 个 token / 241 处 `color-mix()` 无法表达。

**问题二：迁移到原生前端的可能性？**

> **可行，而且比 GPUIX 有价值得多。但必须先回答三个"一票否决"问题**（见 0.4），**并且要认清：在 2026 年，能满足本项目全部需求的方案里，Tauri v2 是唯一"今天就能全绿"的；GPUI 是唯一"性能与原生度最高但有三处硬阻塞"的。**

决定性证据是：**本项目的前端与运行时之间已经存在一条语言无关的 IPC 边界。** renderer 不直接 `fetch`、不开 WebSocket，所有约 300 个 API 方法通过 `window.electronAPI` 走 `WsRpcClient` → JSON over WebSocket → `packages/server`。协议（`packages/shared/src/protocol/types.ts`）包含握手、readiness、带序号的事件重放、断线重连、capability 协商。`apps/webui/src/adapter/web-api.ts` 已经证明一份 337 行的适配器就能让完全不同的宿主（浏览器）跑同一套前端。

**这意味着：换掉 Electron 壳，不需要动这 142k 行 UI，也不需要动 Pi 运行时。**

### 0.3 路线总览

| 路线 | 内容 | 结论 |
|---|---|---|
| **A** | 全套迁移到 GPUIX（React→GPU，宿主 Bun） | ❌ 不建议。重写量大、收益小、踩满 GPUIX 硬缺口 |
| **B** | 全套迁移到 gpui-kit（纯 Rust 重写 UI + 保留 Node 运行时） | ⚠️ 长期愿景成立，**18–28 人月**；需先过 0.4 的前两关 |
| **C** | 原生外壳 + 双引擎（gpui-kit 壳 + 现有 React 经 WebView/WS RPC） | ⚠️ 技术上最优雅，但被 gpui-kit 的 webview 限制（**不可裁剪/不可停靠，仅 macOS+Windows**）约束，且须接受 Markdown/富文本编辑器永久留在 WebView |
| **D** | **Tauri v2 壳（保留 React 前端与服务端）** | ✅ **唯一"今天全绿"的去 Electron 方案，风险最低** |
| **E** | 混合：Tauri v2 壳（面板/浏览器/终端）+ 逐步原生化高性能视图 | ✅ 兼顾短期与长期，推荐 |

**推荐执行顺序：D（立即去 Electron）→ 并行做 0.4 的 spike → 若 spike 通过，按模块逐步原生化（E→B）；路线 C 仅在 spike 全部通过且接受 webview 限制时考虑。**

### 0.4 四个"一票否决"问题（任何原生路线开工前必须实测/决策）

这些不是"风险提示"，而是**可能直接终结整条路线**的硬约束。前三条**必须用可运行的 spike 回答，不能靠读文档**；第四条是一个必须做出的产品决策。

| # | 问题 | 为何致命 | Spike 内容 |
|---|---|---|---|
| **1** | **CJK IME 是否真的可用？** | 本项目有 `zh-Hans`/`ja` locale，composer 里有专门的 IME 组合态处理代码（`isEscapeDuringComposition`）。中文输入是一等公民 | 用拼音输入法在 macOS + Windows 实测：组合态高亮、候选词、组合中退格、组合中 Esc、光标定位、粘贴中文。**另需专测 Linux：issue #39915「Linux 上 IME 组合期间按 Enter 会触发 action」被 closed unmerged，其 issue #41576 被 closed `not_planned`——意味着组合中按 Enter 可能直接发出消息** |
| **2** | **目标机器有 GPU 吗？** | GPUI **无软件渲染回退**：`gpui_wgpu` 的 `new_rejecting_software()` 显式跳过 `DeviceType::Cpu`，失败即 `"No GPU adapter found"`。**issue #26692「Zed 在 Windows 远程桌面会话中无法工作」** | 在 RDP / Citrix / AVD / 虚拟机 / 无独显笔记本上启动最小 GPUI 窗口 |
| **3** | **内嵌浏览器面板怎么办？** | 上游**两次拒绝了 webview PR**（#13730、#54433）。唯一可用的第三方（gpui-kit `crates/webview`）自述：「**将渲染在 GPUI 窗口之上，WebView 边界后的任何 GPUI 元素都会被覆盖**」「目前仅支持 macOS 和 Windows」——**不能被裁剪、叠加、z-order 或停靠**。而本项目 `browser-pane-manager.ts` 是 136 处引用的重功能面板（含 CDP 自动化） | 验证 webview 能否被裁剪/覆盖；若不能，确认"浏览器面板必须是独立窗口"是否可接受；确认 Linux 是否放弃 |
| **4** | **Composer 与 Markdown 渲染块怎么办？** | **Composer** 是手写 `contentEditable`（`rich-text-input.tsx` 825 行 + `FreeFormInput.tsx` 2,508 行），依赖 DOM `Selection`/`Range` + `innerHTML`，**没有非 DOM 运行模式**；**Markdown 渲染块**约 5,000–6,000 行。GPUIX 只有纯文本 `input`/`textarea`；gpui-kit 的 `Editor` 是代码编辑器、`TextView` 是只读渲染 | 决定：这两部分是否**永久**留在 WebView？（注：ProseMirror 编辑器本体在生产中未被使用，已从成本中排除） |

**只有前两关全过，路线 B/C 才成立**（第 2 关不过则 GPUI 直接出局）；**第 4 关的答案决定路线 C/E 的形态**（编辑器留在 WebView 是它们的成立前提）。

---

## 1. 事实基线（逐项源码实证）

### 1.1 craft-agents 前端规模（**修正：UI 是两个包，不是一个**）

> **修正说明**：本报告初稿把迁移主语写成 `apps/electron/src/renderer` 的 110,430 行。**这是低估**。React UI 实际分布在**两个**源码树，且一起打成一个 bundle。忽略 `packages/ui` 会**少算约 29%**。

| 树 | 导入方式 | 文件数（`.ts`/`.tsx`） | 总行数 | 非空行数 |
|---|---|---:|---:|---:|
| `apps/electron/src/renderer` | `@/…`（vite alias） | 619 | 120,523 | **110,430** |
| `packages/ui/src` | `@craft-agent/ui`（+ `./motion`、`./chat`、`./markdown`…） | 204 | 35,391 | **31,753** |
| **合计 UI 面** | | **823** | **155,914** | **142,183** |
| ─ 其中**生产代码**（剔除 `playground/` 与全部 `__tests__`） | | 656 | **122,423** | — |

**行数口径说明（重要）**：本报告统一使用**非空行**（`Get-Content \| Where-Object { $_.Trim() -ne '' }`），因为它是"需要重写的有效代码"的更诚实近似。`Measure-Object -Line` 会静默丢弃空行，全仓库约 9% 的差异即来源于此；`Get-Content \| Measure-Object`（无 `-Line`）则给出总行数。两种口径都列出，避免混用。

**迁移主语应取哪个数**：**生产代码 656 文件 / 122,423 行（总行数）**，或等价的非空约 108,000 行。`playground/`（61 文件 / 21,172 行）是仅开发用的组件实验场，构建产物虽声明为入口但重写可直接丢弃；`__tests__`（106 文件 / 12,319 行）随重写一同作废。

`packages/ui` **不是可选项**：renderer 在 **127 个文件**中导入它 **143 次**（`from '@craft-agent/ui'` ×103、`from '@craft-agent/ui/motion'` ×24，加子路径）。

其它层：

| 层 | 文件数 | 行数 | 说明 |
|---|---:|---:|---|
| ├ `renderer/components` | 369 | 65,654 | 含 `app-shell` |
| ├ `renderer/playground` | 61 | 21,172 | **仅开发用**（占 renderer 的 17.6%），构建产物声明为独立入口，重写可丢弃 |
| ├ `renderer/pages` | 22 | 8,006 | |
| ├ `renderer/hooks` | 45 | 6,346 | |
| ├ `renderer/lib` | 45 | 4,585 | |
| ├ `renderer/event-processor` | 15 | 3,671 | |
| ├ `renderer/atoms` | 22 | 3,099 | |
| ├ `main`（Electron 主进程） | — | ~16,149 | 原生能力宿主 |
| └ `preload` | 2 | ~460 | 桥（体积小，契约大） |
| `packages/shared` | 475 | ~4,274 KB | 协议、i18n、配置、类型 |
| `packages/server-core` | 161 | ~1,562 KB | RPC 服务端、handlers |
| `apps/webui`（浏览器客户端） | 12 | ~36 KB | **仅适配器层**，复用 electron renderer |

**单一最大文件**：`components/app-shell/AppShell.tsx`（193 KB / **3,778 行**）。其后 `input/FreeFormInput.tsx`（111 KB / 2,295 行）、`packages/ui/chat/TurnCard.tsx`（3,047 行）、`ChatDisplay.tsx`（99 KB）、`kanban/TaskEditor.tsx`（62 KB）。

**Vite 有四个构建入口**（不是 1 个）：`main`（应用）、`playground`（仅开发）、`browser-toolbar` 与 `browser-empty-state`（后两个是**内嵌浏览器 `BrowserView` 的 chrome 与空态页**——这再次说明浏览器面板是一个成体系的子系统，而非一个 iframe）。

### 1.2 DOM / 浏览器 API 耦合度实测

对 `apps/electron/src/renderer` 全量 grep：

| API | 命中数 | 迁移含义 |
|---|---:|---|
| `window.*` | 772 | 其中 `electronAPI` **626** |
| `document.*` | 125 | 直接 DOM 操作 |
| `localStorage` | 55 | 需替代持久化 |
| `querySelector` | 40 | 直接 DOM 查询 |
| `requestAnimationFrame` | 37 | 帧调度 |
| `getBoundingClientRect` | 36 | 布局测量 |
| `innerHTML` / `dangerouslySetInnerHTML` | 28 | HTML 注入 |
| `ResizeObserver` | 23 | 尺寸观察 |
| `navigator.clipboard` | 19 | 剪贴板 |
| `onDrop` / `onDragStart` / `onDragOver` | 12 | HTML5 DnD |
| `getElementById` | 9 | |
| `document.createElement` | 8 | |
| `getComputedStyle` | 6 | |
| `MutationObserver` | 6 | |
| `contentEditable` | 5 处（3 组件） | **富文本编辑器** |
| `createPortal` | 4 | |
| `IntersectionObserver` | 4 | |
| `matchMedia` | 3 | |

**关键发现一：`contentEditable`（renderer 侧）。** `apps/electron/src/renderer/components/ui/rich-text-input.tsx`（36 KB）不是 Tiptap，是**手写的 contentEditable 富文本输入框**：inline mention `<span contenteditable="false">` 徽章、零宽空格光标修正、`innerHTML` 读写、DOM 光标定位、`<div>` 当换行、粘贴长文本自动转附件。

**关键发现二（二次修正）：Tiptap / ProseMirror 的真实定位。**

> 这一条我改了两次，最终结论是**第一次的判断方向对，第二次的"更正"过了头**：
>
> | 版本 | 表述 | 判断 |
> |---|---|---|
> | 初稿 | 「`@tiptap/*` 是死依赖，可清理」 | ❌ 错误——它们是真实声明的依赖 |
> | 二稿 | 「ProseMirror 富文本子系统是路线 A/B 的硬阻塞（约 60 文件 / 360 KB）」 | ❌ **过度**——把"在导入图中可达"当成了"必须重写" |
> | 本稿 | 见下 | ✅ 经导入图逐边核验 |
>
> **核验方法**：一次扫描 `apps/` + `packages/` 全部 `.ts/.tsx` 的 import 语句，构建 **8,844 条导入边**，再对每个文件做反向查找。

事实链：

1. `packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx`（**405 行**）是真正的 ProseMirror/Tiptap 编辑器（导入 12 个 `@tiptap/*` 包 + KaTeX）。
2. 它在 `markdown/index.ts` 与 `packages/ui/src/index.ts` 中**被导出**。
3. 生产代码导入的是 barrel `@craft-agent/ui/markdown`，且只取 `Markdown` / `CodeBlock` 等具名导出——`ChatDisplay.tsx:25`、`TurnCard.tsx:30`、`SystemMessage.tsx:14`、`UserMessageBubble.tsx:19`、`InlineExecution.tsx:14`、`RecordInspector.tsx:16`、`AnnotatableMarkdownDocument.tsx:2`、`Info_Markdown.tsx:13` 等。
4. **`TiptapMarkdownEditor` 在生产代码中只有一个导入者：`playground/registry/planner.tsx:30`——仅开发用的组件实验场。**
5. `extensions/TiptapImageBlock.tsx`（160 行）是**真正的死代码**：除自身定义外零导入者。
6. 逐文件反向查找结果：该目录**47 个非测试文件中只有 1 个（`TiptapImageBlock.tsx`）生产零引用**；其余都能从 barrel 到达——但"到达"不等于"被使用"。

**因此修正后的成本口径**（这直接改变路线 A/B 的估计）：

| 部分 | 行数 | 路线 A/B 是否必须重写 |
|---|---:|---|
| **Composer**：`rich-text-input.tsx`（825）+ `FreeFormInput.tsx`（2,508） | **~3,300** | ✅ **是**。手写 contentEditable，生产核心路径，无替代 |
| **Markdown 渲染块**：`Markdown.tsx`（700）、`MarkdownDatatableBlock`（720）、`CodeBlock`（236）、`MarkdownSpreadsheetBlock`（319）、`MarkdownImageBlock`（283）、`MarkdownMermaidBlock`（270）、`MarkdownHtmlBlock`（265）、`MarkdownJsonBlock`（207）、`MarkdownDocBlock`（189）、`MarkdownDiffBlock`（128）、`MarkdownPdfBlock`（11+252）、`MarkdownLatexBlock`（43）、`linkify.ts`（319）等 | **~5,000–6,000** | ✅ **是**（渲染侧） |
| **ProseMirror/Tiptap 编辑器本体**（`TiptapMarkdownEditor` 405 + `TiptapBubbleMenus` 533 + `TiptapSlashMenu` 545 + `TiptapCodeBlockView` 325 + extensions） | ~2,500 | ❌ **否**。生产中未被使用，应在 tree-shaking 中移除 |
| **合计真实富文本成本** | **~8,300–9,300 行** | 而非二稿暗示的"约 60 文件 / 400 KB 子系统" |

**建议核实项**：在 Vite 生产构建产物中 grep `prosemirror` / `tiptap`，确认它们确实没有进入生产 chunk。若**确实进入了**，说明 barrel 导出破坏了 tree-shaking，那是一个可独立修复的打包问题（例如改为深路径导出），而不是迁移成本。

**结论**：GPUIX 只有纯文本 `input`/`textarea`，gpui-kit 的 `Editor` 是代码编辑器而 `TextView` 是只读渲染——**两者都承接不了本项目 Composer 的富文本编辑语义**，这一点仍然成立。但需要重写的是约 **8,300–9,300 行**（Composer + 渲染块），而非整个 ProseMirror 子系统。

### 1.3 第三方 UI 库集成点（比预期集中）

| 库 | 命中 | 集成点集中度 |
|---|---:|---|
| `motion`（Framer Motion） | 329 | 分散，API 面窄 |
| `lucide-react` | 196 | 纯 SVG 图标，易替换 |
| `react-i18next` | 190 | 框架无关 |
| `jotai` | 130 | 框架无关 |
| `sonner`（toast） | 66 | 24 个文件，浅 |
| `shiki` | 63 | 代码高亮 |
| `cmdk` | 15 | 命令面板 |
| `@radix-ui/*` | 14 | **仅 3 个文件** |
| `vaul` | 11 | drawer |
| `@dnd-kit/*` | 11 | **仅 `sortable-list.tsx` 1 个文件** |
| `react-pdf` | 7 | PDF 预览（另有 `MarkdownPdfBlock`） |
| **`@tiptap/*` + `prosemirror-*`** | 12 个包 / 约 2,500 行 | **在生产代码中未被使用**（唯一消费者是 dev playground）；**已从重写成本中排除**，见 §1.2 关键发现二 |
| `react-resizable-panels` | 2 | 面板尺寸 |

好消息：Radix 与 dnd-kit 高度集中，理论上可用少量适配层替换。坏消息：`contentEditable` 富文本输入、Shiki 高亮管线、PDF 渲染是真正的深水区。

### 1.4 CSS 表达能力实测

| CSS 特性 | 命中数 | GPUI/GPUIX 情况 |
|---|---:|---|
| `color-mix()` | 241 | ❌ 无对应 |
| 渐变 | 135 | ⚠️ GPUI 支持渐变但能力有限；GPUIX 仅两段线性 |
| CSS 自定义属性 | **267 个 token / 943 处 `var(--…)`** | ⚠️ 需重建为代码侧数据结构 |
| `calc()` | 63 | ❌ 无 |
| `transition:` | 41 | ⚠️ 有动画 API，但需重写 |
| `animation:` | 31 | ⚠️ 同上 |
| `backdrop-blur` | 22 | ⚠️ macOS vibrancy / Windows Mica |
| `@container` | 20 | ❌ 无 |
| `@keyframes` | 15 | ⚠️ 需重写为 GPUI 动画 |
| `@media` | 10 | ⚠️ 需手动实现响应式 |

主题引擎（`docs/theme-engine-design.md`）核心机制是「双锚点派生」：所有灰阶、`--secondary`、`--muted`、`--border`、`--card`、气泡色都由 `--foreground` + `--background` 经 `color-mix` / `oklch(from …)` 派生，共 6 层自由度（色彩/形状/材质/排版/图标/密度）。

**GPUI 侧有 `Theme`/`Metrics`/`SyntaxPalette` + token 分组 + 目录热加载（gpui-kit `theme-schema.json`），所以"主题引擎"这件事本身是可做的**；但**派生计算必须从 CSS 移到代码侧**（Rust 用 `oklab`/`palette` 类库，或在 JS 侧预计算）。这对路线 D 无影响（仍是 WebView），对路线 B 是一块明确的自研工作。

### 1.4b 【新发现】生产 bundle 中已存在约 683 KB 死代码

这一项**与迁移无关，是当前生产构建就可修复的问题**，但它同时证明了 §1.2 关键发现二的判断。

**核验方法**：直接分析已存在的生产构建产物 `apps/electron/dist/renderer/`（由 `bun run electron:build:renderer` 生成，Vite + Rolldown）。

| 实测项 | 数值 |
|---|---|
| 主 chunk `assets/src-CGxzVikD.js` 大小 | **1,923 KB** |
| 该 chunk 在 `index.html` 中的加载方式 | `<link rel="modulepreload">` —— **每次启动必加载** |
| chunk 内 ProseMirror/Tiptap 首次与末次匹配的字节跨度 | **约 668 KB** |
| 跨度内确实包含库代码（非仅字符串） | `Schema` ×28、`Fragment` ×22、`NodeType` ×23、`MarkType` ×13、`Transform` ×11 —— 是真实实现 |
| 生产样式表 `assets/src-pNAiEWdQ.css` | 70 KB，其中 **99 条含 `tiptap`/`ProseMirror` 的规则占 15.5 KB（22%）** |
| 该 CSS 是否被 `index.html` 引用 | **是**（`<link rel="stylesheet">`） |
| **合计无用载荷** | **约 683 KB（668 KB JS + 15.5 KB CSS）** |

**根因**（三条叠加）：

1. `packages/ui/package.json` **没有 `"sideEffects"` 字段** → 打包器无法确认哪些模块可安全移除。
2. `packages/ui/src/index.ts`（barrel）**re-export 了 `TiptapMarkdownEditor`** → 生产代码从这个 barrel 取 `Markdown` 等具名导出时，打包器必须先把整棵 markdown 子树纳入模块图。
3. `TiptapMarkdownEditor.tsx` **直接 `import './tiptap-editor.css'`** —— 这是一个**副作用导入**，使整棵子树被判定为不可移除。

**另一个独立问题**：`playground` 是 Vite 的正式构建入口之一，因此**4 个 HTML 入口全部进入生产产物**——`playground.html`（5 KB）+ `playground-DROHI_ig.js`（**728 KB**）+ 其 1,710 KB sourcemap 都在 dist 里。它也不应出现在发布产物中。

**建议修复（独立于任何迁移决策）**：

1. 在 `packages/ui/package.json` 增加 `"sideEffects": ["**/*.css"]`（或精确列出），让打包器能安全摇树。
2. 把 `TiptapMarkdownEditor` 从 `packages/ui/src/index.ts` 主 barrel 中移出，改为独立深路径导出（`@craft-agent/ui/tiptap-editor`），仅 playground 使用。
3. 生产构建去掉 `playground` 入口（或在 vite config 中按 `mode` 条件包含）。
4. 复验：`bun run electron:build:renderer` 后确认主 chunk 中 `prosemirror`/`tiptap` 归零、`playground*` 不再出现在 dist。

**与迁移的关系**：这**证明**了 §1.2 关键发现二的结论（ProseMirror 编辑器在生产路径中未被使用），并把"重写 ProseMirror"从路线 A/B 的成本中彻底排除。同时它说明：**GPUIX/原生迁移能省下的体积，在现状下就已经被这部分死代码稀释了**——治理打包比换渲染器更能立刻改善启动成本。
### 1.5 滚动与虚拟化实测

| 项 | 实测 |
|---|---:|
| 滚动容器（`overflow-y-auto` / `<ScrollArea>`） | **109 处**，最集中的文件 5 处 |
| 列表虚拟化库（react-window / react-virtual / Virtualizer） | **0** |

两个含义：

1. **109 处滚动容器**与 GPUIX 的「嵌套滚动完全不支持」正面冲突。GPUI 上游原生支持滚动容器与虚拟列表，但**嵌套滚动依然是需要注意的领域**。
2. **当前完全没有列表虚拟化**——长会话转录、会话列表、数据表格全是朴素渲染。**这既是当前项目的性能债，也意味着任何原生方案的虚拟列表（GPUI `uniform_list`/`list()`、gpui-kit `VirtualList`/`MessageScroller`）在这里都是净收益而非迁移成本。**

### 1.6 通信边界（迁移可行性的决定性证据）

```
┌──────────────────────────────┐        ┌───────────────────────────────┐
│  Renderer (Electron/浏览器)   │        │  packages/server (headless)    │
│  React 142k LOC (2 包)        │        │  会话 / Pi Runtime / 工具 / 权限 │
│                              │        │  工件 / sources / automations   │
│  window.electronAPI (626 处)  │        │                               │
│         │                    │        │                               │
│  WsRpcClient ─────────────────┼── WS ──┼─▶ WsRpcServer                  │
│  (server-core/transport)     │  JSON  │   401 个 channel             │
└──────────────────────────────┘        └───────────────────────────────┘
```

实测事实：

- renderer 中 `WebSocket` 出现 **0 次**——**所有服务端交互都走 RPC 桥**。
- **channel / 方法契约的精确计数（三个不同的数字，回答三个不同的问题）**：

  | 量 | 数量 | 含义 |
  |---|---:|---|
  | `RPC_CHANNELS` 叶子常量 | **401** channel / 58–61 命名空间 | **服务端可提供的全部能力**（`packages/shared/src/protocol/channels.ts`）。最大域：messaging 45、sessions 33、pages 23、browserPane 20、menu 19、theme 18、window 13、artifacts 13、tasks 12、llmConnections 11、file 10、projects 9、automations 9、settings 9、server 8、terminal 8、onboarding 8、sources 8、update 7 |
  | `CHANNEL_MAP` 条目 | **370**（324 `invoke` + 46 `listener`） | 客户端 SDK 暴露的具名方法数（`channel-map.ts`） |
  | 实际被调用的方法 | **321** 个不同方法名 / **626** 处文本出现 / 114 个文件 | 生产代码真正用到的子集 |

  **对新建宿主的直接含义**：`CHANNEL_MAP` 只覆盖 401 个 channel 中的一部分，且其中 321 个才被真正调用。任何新客户端（Rust / Tauri / 第三方）应当**以 `RPC_CHANNELS`（401）为完整契约**来生成绑定，而不是照抄 `CHANNEL_MAP`（370）——否则会漏掉没有客户端方法包装的 channel。
- 协议（`packages/shared/src/protocol/types.ts`）是纯 JSON 信封：`handshake` / `handshake_ack` / `request` / `response` / `event` / `error` / `sequence_ack`，`PROTOCOL_VERSION = '1.0'`。包含**每客户端单调 `seq`、500 条事件环形缓冲、30s TTL、断线重连 `reconnectClientId`、`stale` 全量刷新标志、`serverVersion`、服务端 `registeredChannels` 协商、capability 协商**。
- `routing.ts` 定义 `LOCAL_ONLY_CHANNELS`（必须本地宿主执行）与 `REMOTE_ELIGIBLE_CHANNELS`（跟随 workspace 归属），并有穷尽性 CI 测试。`LOCAL_ONLY` 含 `terminal.*`（8）、`window.*`（13，含 `OPEN_SESSION_IN_NEW_WINDOW`、`SET_TRAFFIC_LIGHTS`、`FOCUS_STATE`）、`file.OPEN_DIALOG`、`dialog.OPEN_FOLDER`、`workspaces.*`、`remote.TEST_CONNECTION` 等。
- **`apps/webui` 已跑通该模式**：`src/adapter/web-api.ts`（337 行）用 `WsRpcClient + buildClientApi(CHANNEL_MAP)` 构建完整 `ElectronAPI`，只覆写 `LOCAL_ONLY` 部分。

**这条边界的语言无关性是本次评估最重要的资产。** 任何宿主（Rust、Tauri、第三方）只需实现 `WsRpcClient` 的等价物（握手 + JSON 请求/响应 + 事件订阅 + 重连 + seq ack），复用完全相同的 401 个 channel，**零服务端改动**。

### 1.7 Electron 独占能力清单（原生外壳必须自研或替换）

| 能力 | 实现位置 | 规模 | GPUI 生态可替代性 |
|---|---|---|---|
| 内嵌浏览器面板 | `main/browser-pane-manager.ts`（136 引用）+ `handlers/browser.ts`（62）+ `browser-cdp.ts` | 大 | ❌ **硬阻塞**（见 0.4-3） |
| 终端 | `terminal.*` channel + node-pty（**在服务端**） | 中 | ✅ `alacritty_terminal`；多个 GPUI 终端已上线 |
| 窗口管理 / 多窗口 | `main/window-manager.ts`（64）+ `handlers/system.ts`（34） | 中 | ✅ GPUI 原生支持多窗口 + 自定义标题栏 |
| 托盘 / 通知 / 徽章 | `notifications.ts`（9）、`setDockIconWithBadge` | 小 | ✅ GPUI 内建 `system_notifications`（仅 git，未发布） |
| 应用菜单 / 快捷键 | `main/menu.ts`（8）+ 19 个 `menu.*` channel | 小 | ✅ gpui-kit `NativeMenu`（AppKit/Win32） |
| 文件对话框 / 深链 / 钥匙串 | — | 小 | ✅ GPUI 内建 |
| 自动更新 | `update.*`（7 channel） | 小 | ⚠️ `crates/auto_update` 是 **GPL**，不可用；需自研 |
| 窗口材质 | `SET_TRAFFIC_LIGHTS` 等 | 小 | ✅ macOS vibrancy **与 Windows Mica/Mica Alt**（`WindowBackgroundAppearance::{Blurred, MicaBackdrop, MicaAltBackdrop}`） |
| Sentry | `@sentry/electron` | 小 | ⚠️ 需换 Rust SDK |

**补充（来自逐项清单核验）**：

- **内嵌浏览器是完整子系统，不是 iframe。** `main/browser-pane-manager.ts` **3,687 行** + `main/browser-cdp.ts` **1,061 行**：一个无边框 `BrowserWindow` 承载**三个** `BrowserView`（toolbar / page / native-overlay，硬断言 `addBrowserView` + `setTopBrowserView`），分区 `persist:browser-pane`，并通过 CDP 控制无障碍树。用的是**已废弃的 `BrowserView` 而非 `WebContentsView`**。这解释了 Vite 为何有 `browser-toolbar` 与 `browser-empty-state` 两个额外入口。**这是整份评估中最重的单一重写阻塞。**
- **终端是 renderer 里的 xterm.js**（`@xterm/xterm` 6 + addon-fit）+ **main 里的 node-pty**，另有一个非 xterm 的静态 ANSI 日志视图。
- **没有 ⌘K 全局命令面板。** `components/ui/command.tsx`（cmdk 包装，144 行）**全仓库零导入者**——是死代码。
- **面板拖拽调整是手写的**（`AppShell.tsx` 里 `useState` 宽度 + `document` mousemove + rAF，clamp 360–600px）；`resizable.tsx`（react-resizable-panels 包装，49 行）、`gradient-resize-handle.tsx`（57）、`horizontal-resize-handle.tsx`（81）**全是死代码**。
- **真正 OS 绑定的原生面很小**：`ipcMain` 注册仅 **24 个**（18 `handle` + 6 `on`；15 个在 `main/index.ts`，9 个在 `browser-pane-manager.ts`），另有 `main/handlers/` 里 72 个 `server.handle`。**这 24 个才是原生外壳必须重写的东西**，而非 401 个 channel。
- **注意**：**本地服务器是 Electron main 的进程内服务**（`main/index.ts` 调用 `bootstrapServer`），不是独立 Bun 进程。因此换成 Tauri/GPUI 外壳时，**服务端必须改为独立进程或远程服务**——这是路线 D/E 的一个明确架构改动（好消息是 `packages/server` 已支持独立运行）。
- **已具备但零使用**（repo-wide 零命中，不必为迁移实现）：Tray、`globalShortcut`、`desktopCapturer`、main 进程 `clipboard`、`startDrag`（文件拖出）、`showSaveDialog`、`powerMonitor`、`setLoginItemSettings`、`systemPreferences`、`shell.trashItem`、**打印/printToPDF**、`setFullScreen`。
- **一个只在 Chromium 存在的 API**：转录内搜索用 **CSS Custom Highlight API**（`CSS.highlights.set` + `new Highlight()`，`ChatDisplay.tsx` 6 处）。这是**任何**原生方案都没有对应物的浏览器专有 API（GPUI/gpui-kit/Tauri 的 WebView 除外）。

---

## 2. GPUIX 能力矩阵（逐项对照）

来源：GPUIX README 3069 行 + `packages/native` 22,436 行 Rust + `packages/react` 16,155 行 TS。

### 2.1 宿主元素与样式

**支持元素（全部）**：`div`、`text`、`code`、`diff`、`markdown`、`input`、`textarea`、`virtual-list`、`img`、`svg`、`anchored`、`canvas`（仅类型，未实现）。

**样式子集**：display（flex/grid）、gap、grid*、width/height/min/max、padding/margin、position、top/right/bottom/left、background/backgroundColor、color、opacity、cursor、pointerEvents、borderRadius、borderWidth、borderColor、boxShadow（结构体）、hover、active。

**明确不支持**：任何简写字符串（`"0 16px"`、`"1px solid #fff"`）、`calc()`、`white-space: pre`、`letterSpacing`、多种 boxShadow、border-style、radial/conic/repeating/多段渐变、`@container`、`@media`。

**语义陷阱**：`div` 默认 block 不是 flex（不显式 `display:"flex"` 则 flex 属性静默失效）；无 `<button>`；**`color` 不继承**（未设 color 的文字画黑色）；`<text>` 不能嵌套 `<text>`；flex 子项收缩需 `minWidth: 0`。

### 2.2 逐项能力对照（修正版）

| craft-agents 能力 | 用量 | GPUIX 状态 | 备注 |
|---|---|---|---|
| **CJK / 中文 IME** | 核心 | ⚠️ **实现存在但 CJK 零测试** | 全仓库 grep 无任何 CJK 码点；只有 `"é🙂"` 的 UTF-16 偏移测试 |
| **富文本输入框** | 36 KB + 111 KB | ❌ 仅纯文本 `input`/`textarea` | **必须重写，工作量最大** |
| 长篇会话转录滚动 | 99 KB | ✅ `<virtual-list>` `alignment="bottom"` + `followTail` | 净收益 |
| **嵌套滚动** | **109 处** | ❌ **架构性禁止** | 需重新设计布局（GPUI 上游亦受限） |
| Markdown 渲染 | react-markdown | ✅ 原生 `<markdown>` GFM | 可替代（Zed 的 GPL，GPUIX 是 MIT Comet 移植） |
| 代码高亮 | shiki | ✅ `<code>` Syntect（**非 tree-sitter**） | 语法集/主题不同；首次高亮在帧线程编译语法（TS 12ms / wasm 133ms） |
| Diff 查看 | @pierre/diffs | ✅ 原生 `<diff>` 虚拟化 | 净收益 |
| 数学公式 | katex | ❌ 无 | 需自研/降级 |
| Mermaid | beautiful-mermaid | ❌ 无 | 需预渲染 |
| **PDF 预览** | react-pdf | ❌ 零支持 | 生态有 `hayro` + `gpui-pdf` 参考实现，但 GPUIX 未接 |
| 图片预览 | sharp | ✅ PNG/JPEG/WebP/GIF/SVG/BMP/TIFF/ICO/PNM | 可替代 |
| 图标 | lucide 196 处 | ✅ `<svg>` 单色（**必须设 `style.color`**） | 可迁移 |
| 数据表格 | data-table.tsx | ❌ 无原生表格 | 需自研 |
| 看板 / 拖拽排序 | dnd-kit | ⚠️ 无原生 DnD，需手写指针捕获 | 需自研 |
| 面板拖拽调整 | react-resizable-panels | ⚠️ 需手写 | 可自研 |
| 命令面板 | cmdk | ⚠️ 需组合 | 需自研 |
| 上下文菜单 | Radix | ❌ 无 `onContextMenu`（用 `onAuxClick`） | 需自研 |
| **原生应用菜单** | 19 channel | ⚠️ 仅 macOS 自动菜单；**应用自定义菜单未实现** | 阻塞 |
| **系统托盘 / 通知** | — | ❌ 零支持 | 阻塞 |
| **多窗口** | 13 channel | ❌ **明确 TODO** | 阻塞 |
| 窗口控件 | 自定义标题栏 | ❌ 仅标题；**Wayland 下连拖拽都不行** | 阻塞 Linux |
| **内嵌浏览器** | 136 引用 + CDP | ❌ **零 webview 支持** | **阻塞** |
| 剪贴板 | 富文本复制 | ⚠️ **仅纯文本** | 降级 |
| 主题引擎 | 267 token | ⚠️ `Theme`/`Metrics` 可覆盖，无 CSS 变量/color-mix | 需重建派生模型 |
| **自定义字体加载** | 品牌字体 | ❌ **无 font loading API** | 阻塞 |
| i18n | **7 语言 / 2,238 个 key**（`en.json` 叶节点实测） | ⚠️ 无内建（JS 侧可自实现） | 非阻塞，但托管于 `packages/shared`，与 UI 层解耦 |
| 无障碍 | — | ⚠️ **main 已实现但 0.7.0 未发布**；浏览器端 no-op | 需等发布 |
| 动画 | motion 329 处 | ✅ `motion.div` 原生插值 | 15 个 keyframes 需重写 |
| 打印 / 视频音频 | — | ❌ 无 | 阻塞 |

### 2.3 GPUIX 成熟度实测

| 指标 | 值 |
|---|---|
| 版本 | 0.7.0（2026-09-01） |
| 首次可用发布 | 0.1.0 被 npm 标记 deprecated（"Broken: unresolved `workspace:^`"） |
| 发布节奏 | 0.2/0.3/0.4 同日（08-23），0.5.0+0.5.1（08-26），0.6.0（08-29），0.7.0（09-01）——**10 天 6 个功能版本** |
| commit 分布 | 01:12, 02:4, 03:46, 04–07:~1, **08:233**, 09:41 → **69% 集中在单月，中间 4.5 个月停摆** |
| 贡献者 | remorses 320 / 337 |
| `AGENTS.md` 政策 | 「除非你是 remorses 或 monotykamary，不要开 PR，请开 issue」 |
| 未消费 changeset | **19 个**（含 a11y、`onFileDrop`、`checkUpdate`、HTTP `<img>`）→ main 显著领先 npm 发布物 |
| 代码健康度 | 22,436 行 Rust 中 **0 个 `todo!()`/`unimplemented!()`**，仅 2 处 TODO 注释 |
| 社区 fork | `Ernxst/gpuix`、`AzureZee/gpuix`、`khromov/gpuix-svelte` |
| 平台产物 | macOS **仅 arm64**、Linux **仅 x86_64**、Windows **仅 x86_64** |
| GPU 要求 | **强制**；无软件渲染回退；Linux 上截图/测试渲染器不可用 |
| 文档 | `gpuix.dev` 实际就是 README（`index.mdx` 直接 import README）；`/guides/hermes` 404 |

**结论：晚期 alpha / 早期 beta。** 工程风格严谨（零 stub、有 GPU 测试渲染器、有完整 chat/timeline/mail 示例），但治理与发布成熟度不足以承载已发布产品的前端。

### 2.4 GPUIX 的性能叙事需要谨慎对待

GPUIX 公布的实测数据（方法可复现）：

- `applyBatch` 在 10k 轮对话挂载中占 **626 ms / 850 ms**——**JSON 反序列化是主要成本，不是 React**。
- `StyleDesc` 单结构 **1,392 字节**；22.1 万次操作的挂载会在解析前预留 312 MB。
- 优化后：parse+apply 127.1 → 30.1 ms，堆 churn 900.5 → 104.0 MB，分配 1,476,196 → 186,090，RetainedTree 224.5 → 42.6 MB，每元素字节 3,116 → 592。
- MessagePack 只有 1.24x，被否决。
- Timeline 平移（3,259 片段 / 26 轨道）：p50 **7.7 ms**（裁剪）vs 92 ms（仅 memo）。
- 空闲 CPU 73% → 1%。

**含义**：GPUIX 确实能做到流畅，但代价是**每次 commit 全量重发样式 JSON**，样式在 Rust 侧 hash-cons。对 `AppShell.tsx` 这种 193 KB 单文件、267 个主题 token 全量展开的 UI，样式对象体积会非常可观，需从一开始就按"样式对象必须稳定引用"设计——这与 React 里"随便写 inline style"的习惯直接冲突。

---

## 3. gpui-kit 能力矩阵（纯 Rust 路线的现实基础）

`gpui-component` → `gpui-kit` 是**同一次仓库改名 + 重架构**（`longbridge/gpui-component` 301 跳转到 `longbridge/gpui-kit`），不是两个项目。

### 3.1 它已经有的（且质量高）

| 组件 | 类型 | 对本项目的价值 |
|---|---|---|
| **Dock** | `DockArea`/`DockSkin`/`Panel`/`TabPanel`（61 KB） | 多面板工作台、边缘停靠、嵌套分割、可序列化布局、拖拽重排、undo/redo、缩放、锁定 |
| **MessageScroller** | `MessageScroller`/`MessageScrollerState` | `append`/`prepend`/`splice`/`scroll_to_item`/`is_following_tail`/`is_scrolled_up`/跳转按钮/底部渐隐——**专为聊天转录设计** |
| **Message / Bubble / Marker / Attachment** | 一整套 | 会话消息、状态行、附件 |
| **DataTable** | `DataTable`/`TableState`（**106 KB**） | 虚拟行**与**虚拟列、排序/过滤/固定列/可调列宽/单元格选择/多级表头/自定义行高/斑马纹/批量导出 |
| **Editor** | `Editor`/`EditorState`（`base/state.rs` **370 KB**） | 代码编辑器：行号、gutter、折叠、诊断、内联补全、语义 token、LSP（`lsp-types 0.97`）、多光标、列选择、括号配对 |
| **SyntaxHighlighter** | tree-sitter 0.26.13 + 36 语言 feature | 真 tree-sitter |
| **TextView** | `TextView`/`TextViewPlugin`（89 KB） | Markdown + HTML 渲染，表格、图片、数学、frontmatter、源码保留复制、增量解析 |
| **Command** | `CommandState`（94 KB） | 命令面板 |
| **Menus** | `PopupMenu`（50 KB）、`ContextMenu`、`NativeMenu` | 上下文菜单 + **原生应用菜单** |
| **Notification** | `NotificationList`（65 KB） | toast + 可选系统通知中心 |
| **Charts** | 7 种图 + plot 原语 | Run Overview 指标可视化 |
| **Theme** | token 分组 + `theme-schema.json` + 目录热加载 | 主题引擎 |
| **i18n** | `rust-i18n`，内建 en / zh-CN / zh-HK | 中文支持 |
| **测试** | `gpui_kit::test` + `#[gpui_kit::test]` | 无头 UI 测试 |
| 其它 | Sidebar、Tree、TabBar、Settings、Sheet、Table、VirtualList、Scrollable、Resizable、Form、Select、Combobox、Calendar、ColorPicker、OtpInput、Carousel、Accordion… | 90+ 组件 |

**完整多面板 app shell 示例已存在**：`examples/dock/src/main.rs`（`AppTitleBar` + `DockSkin::dock_area` + `DockArea` + `StatusBar`，快捷键绑定，布局持久化到 JSON）。

### 3.2 它没有的（必须自研）

| 缺口 | 严重度 | 说明 |
|---|---|---|
| **富文本（WYSIWYG）编辑** | 🔴 最高 | `Editor` 是基于 Rope 的**代码**编辑器，`TextView` 是**只读**渲染。没有富文本文档模型，没有 inline 格式命令。这正是 `rich-text-input.tsx` 需要的 |
| **可裁剪/可停靠的内嵌 WebView** | 🔴 高 | `gpui-wry`/`crates/webview` 是独立 crate，实验性，**仅 macOS + Windows**，且**总是绘制在 GPUI 之上**（见 0.4-3） |
| **PDF 预览** | 🟠 中 | gpui-kit 本身零 PDF 依赖。**但 GPUI 生态有解法**：`hayro` 0.7.1（纯 Rust）+ 参考实现 `gpui-pdf`（页级虚拟化、缩放、全文搜索）。属"可自研但需工作量" |
| 文件系统树 / 文件选择器 | 🟠 中 | 有 `Tree`/`TreeState`，但无文件系统后端、无懒加载、无 OS 文件选择器（连 `rfd` 都没有）、无文件类型→图标映射。**GPUI 本体已内建文件对话框** |
| 通用 DnD 抽象 | 🟠 中 | dock tab / list item / table column 内部有拖拽，但无公开可复用抽象。**GPUI 本体已支持 OS 文件拖入**（`ExternalDragPayload`） |
| 无障碍完整性 | 🟠 中 | role/label API 存在且在改进，但维护者自己的 issue #2838「Tabs 完整键盘导航」未修；macOS 需要 `install_window_hit_test_forwarder` 补丁。**上游 GPUI 更差，见 3.4** |
| 自动更新 | ⚪ 低 | `crates/auto_update` 是 **GPL**，需自研 |

### 3.3 工程与供应链风险

| 风险 | 证据 |
|---|---|
| **GPL 溯源未决** | 见 0.1 前提三。依赖前需法务审计 |
| 0.x API 剧变 | v0.4.0 release notes 标题就是「Break Change」，17 处重命名（`Modal`→`Dialog`、`Drawer`→`Sheet`、`TextInput`→`Input`…）；v0.6.0 拆 crate |
| 单厂商主导 | `huacnlee` 占 ~62% commits，为 Longbridge Pro 路线图服务 |
| GPUI 是"非官方周更重打包" | `gpui-pre` = `zed@801c087` 快照，每周一 cron 重发布；**"若上游 API 变更破坏兼容，发布暂停"**——可能被钉在旧 GPUI 上 |
| 精确钉版 beta 依赖 | `ropey = "=2.0.0-beta.1"`、`core-text = "=21.0.0"` |
| 非上游包与 git 依赖 | `wry` 用 Longbridge 镜像 `lb-wry`；`quickjs-jit` 是 git 依赖；`[patch.crates-io] rquickjs` 本地路径 |
| 构建重量 | `Cargo.lock` 1,227 个包；`gpui-component` 61,684 行 + `gpui-base` 65,652 行 + `gpui-shell` 71,232 行 |
| Linux 现实阻塞 | issue #3035：GNOME Wayland 下无窗口装饰 / `TitleBar` 不工作 |

### 3.4 上游 GPUI 的真实状态（修正：比 GPUIX 描述的更严峻）

**分发是最大的结构性问题，且与能力耦合。**

| 事实 | 含义 |
|---|---|
| `github.com/zed-industries/GPUI` **HTTP 404**，不存在 | GPUI 从未有独立仓库，只存在于 Zed monorepo `crates/gpui` |
| crates.io `gpui` = **0.2.2，发布于 2025-10-22** | **325 天未更新**，历史上只有 7 个版本 |
| **`gpui_platform` 根本不在 crates.io（404）** | 而 Zed 自己的 README 让你依赖它——**官方上手路径按文档走不通** |
| `main` 领先已发布 crate ~11 个月 | **无障碍、`system_notifications`、Mica、wasm、整个 crate 拆分，都只存在于 git** |
| 存在**四套互相竞争的发行版** | 上游 git、`gpui-unofficial`（47 版本，镜像 Zed release tag，作者是前 Zed 员工）、`gpui-pre-*`（Longbridge 快照）、`gpui-ce`（Community Edition fork，1,044★，Apache-2.0） |
| Zed 官方立场 | gpui.rs：「Today, it's Zed's UI framework. Tomorrow, it's yours!」但也说「for the near future gpui is tied to Zed」；README：「still pre-1.0. There will often be breaking changes.」 |
| 唯一的正式承诺 | 在 Longbridge 的 `huacnlee` 公开抗议"315 天真空期"后，Zed 官方账号回复「we will start working on infra to automatically publish GPUI releases by the end of the month」——**截至今日该流水线未上线** |
| 一次 Zed Discord 发言（2026-02） | GPUI 开发「getting some major brakes put on it… anything that isn't directly related to Zed's use case」，并指向 `gpui-ce` |

**细微之处**：引擎本身在 monorepo 内仍在快速演进；**停滞的是对外发布与非 Zed 用例的支持**。

**无障碍（必须下调评级）**：`main` 的 AccessKit 树确实是完整的（`Role`、`.aria_*`、`on_a11y_action`、`a11y_synthetic_children`，接 macOS AX / Windows UIA / Linux AT-SPI）。**但已发布的 `gpui 0.2.2` 完全没有无障碍**（2026-05-27 才进 main）。Zed 员工在 PR #59429 说：「accessibility features require zed to be launched with the **`ZED_EXPERIMENTAL_A11Y=1`** env var」，且「**The main Zed UI is still largely inaccessible**…the experience is suboptimal」。issue **#41138「Windows: 屏幕阅读器完全缺失」**自 2025-10 开放（JAWS/NVDA 完全无声）；**#7895 VoiceOver 被 closed `not_planned`**；26 个开放 a11y issue；无 a11y 文档页。

> **如果无障碍是合规要求，GPUI 目前不具备可辩护性。**

**其它值得知道的事实**：
- 有真实性能缺陷：live resize/文本选择滚动 #58900（开放，S2）；变高 `list()` API 难用到 Zed 自己**延迟了 21+ 个月**才采用（#21403）；官方预算 **8 ms/帧**；`BufferSnapshot::chunks` 曾**每帧**重跑 tree-sitter 高亮，直到 PR #63145（2026-09-09）。
- 编译时间已量化：`touch crates/editor/src/editor.rs` + `cargo build -p zed` = **13.19 s → 11.85 s**（PR #62059 后），工作区约 215 个 crate。
- **无热重载**：PR #41508「Hot-reloading with subsecond」被 closed unmerged（2025-12-20）。**唯一真实的热重载故事是 GPUIX + `bun --hot`（React Fast Refresh 保留 `useState` 与滚动位置）。**

---

## 4. 路线评估

### 路线 A：整套迁移到 GPUIX ❌

**形态**：保留 `packages/server` 与 Node 运行时，把 122k 行生产 UI 重写为 GPUIX JSX，宿主换 Bun，Electron 主进程能力改由 Rust/napi + `@gpuix/native` 提供。

| 工作项 | 规模 |
|---|---:|
| 重写生产 UI（656 文件 / 122,423 总行；`playground` 21,172 行与 `__tests__` 12,319 行可丢弃） | **~122,000 行** |
| **Composer**：`rich-text-input.tsx`（825）+ `FreeFormInput.tsx`（2,508）手写 contentEditable → GPUIX 原生组合 | 从零设计，1.5–3 人月 |
| **Markdown 渲染块**（约 5,000–6,000 行；ProseMirror 编辑器本体生产中未用，可排除） | 1.5–3 人月 |
| 重写 chat / turn card 层（`packages/ui/chat`，`TurnCard.tsx` 单文件 3,362 行、`turn-utils.ts` 1,280 行） | 1–2 人月 |
| 重写 Trajectory 视图 + 面板（4,909 行）、settings（7,439 行）、overlays/previews（6,010 行） | 2–4 人月 |
| **重建 Tailwind/CSS 视觉系统**：~**6,041 处 `className=`**（renderer 4,905 + ui 1,136）、265 个 CSS 自定义属性、201 处 `color-mix()`、11 处 `@container`、8 个 `@property`、9 处 `backdrop-filter`、51 处 `box-shadow` | **2–4 人月（最容易漏算的一项）** |
| 自研 PDF / Mermaid / KaTeX / 表格 / DnD / 终端（xterm.js → 原生终端） | 3–5 人月 |
| 重建状态层（`processEvent` reducer 覆盖 48 个 `AgentEvent` 分支、109 个 atom 定义、178 处 `useAtom*`、16 个 context） | 1–2 人月（可移植，相对便宜） |
| 内嵌浏览器面板（`browserPane` 20 channel + 4 个 Vite 入口中的 2 个 + CDP + 3,687/1,061 行主进程） | **GPUIX 无法实现** |
| 原生外壳 24 个 `ipcMain` 等价物 + 服务端改为独立进程 | 中等 |
| **合计** | **11–19 人月（乐观）** |

**结论：不建议。** 它同时承担"重写 UI"与"保留 JS 运行时"两个成本，只换来"没有 Chromium"；且硬缺口（无内嵌浏览器、无多窗口、无富文本编辑、嵌套滚动禁止、仅纯文本剪贴板）**正好落在本项目最复杂的几个功能上**。

**唯一合理用法**：作为**特定高性能面板**的实验渲染后端（时间线、图表、Run Map）。

### 路线 B：整套迁移到 gpui-kit（纯 Rust 重写）⚠️

**形态**：Rust 二进制用 gpui-kit 渲染全部 UI；`packages/server`（Pi Runtime）保留为 sidecar 或远程服务，通过 WS JSON-RPC 通信。

**比路线 A 有实质优势**：

1. gpui-kit 已提供**多面板 Dock、聊天转录滚动、DataTable、代码编辑器、tree-sitter 高亮、命令面板、原生菜单、通知、图表、i18n（含中文）**——覆盖 UI 中最大最有价值的部分。
2. 纯 Rust 单二进制，无 JS 运行时。
3. 上游 GPUI 是 crates.io 上的 Apache-2.0 包，供应链比 GPUIX 的"个人 Zed fork"干净。

**但必须先过 0.4 的三关，且仍有明确缺口**：

- **富文本编辑器**：最深的单点缺口，需自研富文本文档模型 + inline 格式 + mention 原子节点 + 光标/IME 交互。
- **内嵌浏览器**：`gpui-wry` 总是画在最上层、仅 macOS+Windows。当前 `browser-pane-manager.ts` 是含 CDP 自动化的重要功能。
- **PDF**：gpui-kit 无，但生态有 `hayro` + `gpui-pdf` 可集成。
- **无障碍**：上游未发布且 Zed 自称 "largely inaccessible"。
- **RDP/VDI**：无软件渲染回退。
- **GPL 溯源**：需法务审计。

**成本估算修正**：UI 层 **18–28 人月**。三次调整：初稿 12–24（基于 110k 行 + 误判 ProseMirror 为阻塞）→ 因 Markdown/富文本子系统缺口上调 → 因 UI 实为两个包上调 → **因 ProseMirror 编辑器本体在生产中未被使用而下调**。净结果仍高于初稿，因为 Tailwind/CSS 视觉系统与内嵌浏览器是初稿完全漏算的两项，外加 gpui-kit 0.x 破坏性升级的持续成本。

**结论**：作为长期终局成立，作为一次性项目风险过高。**应该是"逐步原生化"的终点，不是起点。**

### 路线 C：原生外壳 + 双引擎（gpui-kit 壳 + WebView 承载复杂面板）⚠️

```
┌─────────────────────────────────────────────────────────────┐
│  原生外壳进程 (Rust + gpui-kit)                               │
│  · 窗口 / 标题栏 / 原生菜单 / 通知 / 快捷键 / 多窗口             │
│  · Dock 多面板布局、Sidebar、StatusBar（gpui-kit 原生）         │
│  · 会话列表 / 数据表格 / 图表（gpui-kit 原生，直连 RPC）         │
│  · WebView 承载复杂面板：Composer / 浏览器 / PDF / Mermaid      │
│  WsRpcClient 的 Rust 等价实现（复用 401 个 channel）            │
└──────────────────────────┬──────────────────────────────────┘
                           │ WS JSON-RPC (protocol v1.0)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  packages/server（完全不变）                                   │
│  Pi Runtime · 会话 · 工具 · 权限 · 工件 · sources · automations │
└─────────────────────────────────────────────────────────────┘
```

**优点**：零服务端改动；复杂面板复用现有 React；`apps/webui` 已证明薄适配器模式可行；原生收益（窗口/菜单/多窗口/托盘）立刻兑现；每迁移一个面板就删一块 WebView，**终局自然收敛到路线 B，每步可交付可回滚**。

**致命约束**：**gpui-kit 的 WebView 不能被裁剪、叠加或停靠，总是绘制在 GPUI 内容之上。** 这意味着"WebView 作为 Dock 里的一个面板"这个核心设想**不成立**——WebView 面板只能做成独立窗口或全屏弹层。

**在这个约束下路线 C 的可行变体**：把 Composer 做成**独立输入窗口/弹层**（这在 UX 上其实可接受，甚至可做成"命令面板"式体验），浏览器面板做成独立窗口。若产品上不能接受，路线 C 破产。

### 路线 D：Tauri v2 壳（保留 React 前端与服务端）✅

**形态**：Tauri v2 替换 Electron，前端（142k 行 React）与后端（`packages/server`）几乎不变。

| 维度 | 结论 |
|---|---|
| 工作量 | **最小**，1–3 人月 |
| 收益 | 二进制从 ~200 MB → ~600 KB 壳 + WebView；内存显著下降；无 Chromium 更新负担 |
| **关键优势** | **它是 2026 年唯一"今天就能满足全部需求清单"的方案**：WebView 可嵌套可裁剪可 z-order（浏览器面板、PDF、Mermaid、KaTeX、富文本 composer 全部照旧）；CJK IME 由各平台 WebView 保证（WebView2/WKWebView/webkit2gtk）；无障碍由 WebView 提供；无 GPU 强制要求（RDP/VDI 可用） |
| 风险 | 各 OS WebView 行为分歧（WebKit/WKWebView vs WebView2 vs WebKitGTK）；需重实现 `LOCAL_ONLY` 的 30+ channel（终端、文件对话框、托盘、菜单、深链、更新、CDP 浏览器面板）；Tauri v3 不存在，v2 API 会长期稳定 |
| 与目标的关系 | 它**不是"原生 UI"**，但它是"去 Electron"性价比最高、风险最低的手段 |

**结论：推荐作为第一优先。** 它把"我们必须自己解决 CJK IME / 无障碍 / webview / PDF / GPU"这一整类问题**转化为"交给操作系统 WebView"**。

### 路线 E：混合（推荐终局）

**D 打底 + 按模块逐步原生化**：

1. 先用 Tauri v2 去 Electron（1–3 人月），收益立刻兑现，风险最低。
2. 并行完成 0.4 的三个 spike，以及第 6 节的可选 spike（无障碍、构建时间、纵切）。
3. Spike 通过后，把**性能最敏感、DOM 最不必要**的面板逐个改为 GPUI 原生渲染——候选顺序：Run Map / 时间线 / 图表 → 会话列表 → 数据表格 → 代码/diff 查看。**Composer 与浏览器面板永远留在 WebView。**
4. 新增能力优先用 Rust 写（终端、文件树、长列表），不新增 WebView 面积。

这条路线的判断依据是：**本项目的复杂度不在"渲染性能"，而在"输入法 + 富文本 + 内嵌浏览器 + PDF"这四件 WebView 天生擅长、Rust GUI 天生不擅长的事。**

---

## 5. 横向对照：所有候选栈对本项目需求的实测打分

来源：`docs/research/gpui-ecosystem-and-gaps.md` §5.1（2026-09-12 实时核验）。这张表是本次评估中最有决策价值的一页。

| 栈 | 版本 / 日期 | 许可 | WebView | 终端 | PDF | **CJK IME 2026** | 三方组件 | 结论 |
|---|---|---|---|---|---|---|---|---|
| **Electron**（现状基线） | 44.3.0, 2026-09-09（Chromium 152 / Node 24.20） | MIT | ✅ iframe / `WebContentsView`（Electron 官方已不建议 `<webview>`） | ✅ xterm.js + node-pty | ✅ PDF.js | ✅ **已解决** | ✅ 巨大 | **零未知量。要被超越的基线** |
| **Tauri v2** | **2.11.5, 2026-07-01（无 v3）** | Apache-2.0 OR MIT | ✅ 系统 WebView（四引擎：WebView2 / WKWebView / webkit2gtk / Android） | ✅ sidecar + web | ✅ web | ✅ **已解决（委托给 OS）** | ✅ 巨大（整个 Web） | **风险最低的真实迁移**。复用现有 React UI；最小应用 < 600 KB。代价 = 各 OS WebView 行为分歧 |
| **Avalonia 12** | 12.0.0, 2026-04-07（.NET 10 + SkiaSharp 3.0） | MIT 核心；商业组件付费 | ✅ 12.0 起 WebView 开源 | ⚠️ 经 webview | ⚠️ 三方 | ⚠️ 未验证 | ✅ 好（+付费） | **唯一可信的非 Web 重写**。首个 .NET Linux AT-SPI2 无障碍后端。但 Rich Text Editor / Tree Data Grid / Markdown Viewer / Charts 都是**付费**组件 |
| **Qt 6.11** | 6.11.2, 2026-08-18 | LGPLv3 / GPLv3 / 商业 | ✅ QtWebEngine = Chromium 140 + 151 安全回移 | ✅ QTermWidget | ✅ QtPdf | ✅ **成熟** | ✅ 最大 | **技术上最贴合**。代价 = C++ 优先 + 长期 LGPLv3 合规负担（静态链接基本不可行，与 App Store 分发冲突） |
| **GPUI**（+ gpui-kit / GPUIX） | 引擎今日有提交；crates.io 冻结在 **0.2.2（2025-10-22）** | GPUI Apache-2.0；其上是 **GPL-3.0-or-later** | ⚠️ **弱**（wry 子视图；核心无） | ✅ 多个已上线 GPU 终端 | ✅ `hayro` + `gpui-pdf` | ⚠️ **12 个开放 IME issue** | ✅ 112 个已编目项目；~10 个直接同类 | **可行且真正原生**，但受 IME / webview / RDP 三个 spike 门控 |
| Dioxus + Blitz | dioxus 0.7.10；Blitz 0.1.1 | MIT OR Apache-2.0 | ⚠️ wry 可以 / **Blitz 不行** | ❌ | ❌ | ❌ **坏**（PR #843/#844 截至 2026-09-08 仍 open） | ❌ | **不可用于 Blitz**。`position: fixed/sticky/overflow:auto`、container query、`line-clamp` 全不支持——对 sticky header 与自动滚动转录是致命的 |
| Slint | 1.17.1, 2026-07-07 | GPL-3 / 免版税 / 商业 | ❌ **完全没有 webview 元素**（issue #3930 自 2023-11-14 开放） | ❌ | ❌ | ⚠️ issue #8716：Win10 切到微软拼音时 **UI 完全冻结** | ⚠️ 小 | **不可用** |
| Iced | 0.14.0, 2025-12-07 | MIT | ❌ | ❌ | ❌ | ❌ **崩溃**（PR #3290「Fix IME preedit slicing」自 2026-03-22 开放至今） | ⚠️ | **不可用。输入中文会 panic 是取消资格级缺陷** |
| egui | 0.36.2, 2026-09-08 | MIT OR Apache-2.0 | ❌ | ❌ | ❌ | ❌ **8 个开放 IME issue，最早 2022 年** | ⚠️ 中 | **不可用**。README 自述「很长的滚动回看会变慢，因为每帧都要重新布局」——正是长会话转录的需求 |
| Floem | crates.io 0.2.0, 2024-11-14（约 22 个月未更新） | MIT | ❌ | ❌ | ❌ | ⚠️ 未验证 | ❌ | **不可用** |
| SwiftUI + WinUI 3 | macOS 26 / WinAppSDK 2.4.0 | — | ✅ | ⚠️ | ✅ | ✅ 原生 | ✅ | **不可行**——两套视图层、两套 a11y、两套 IME，约 2 倍工作量 |

### 5.1 这张表最重要的两条结论

**结论一：CJK IME 是 2026 年所有 Rust 原生工具包的共同弱轴。**

egui、Iced、Slint、Blitz、GPUI **全部**有开放的 CJK IME 缺陷。**只有把文本输入委托给浏览器引擎或 Qt/AppKit 的栈才有"已解决"的中文输入故事**：Electron、Tauri、Qt、Avalonia、SwiftUI/WinUI。

> 「如果中文输入是对全球用户的一等需求，那这是整份研究里最具澄清力的一条事实——它要么指向基于 webview 的外壳，要么意味着必须在 GPUI 上接受一次手工调优的 IME 工程。」
>
> 对本项目尤其致命的一点补充：**本项目 composer 的 IME 正确性直接决定"消息是否会被误发送"**（GPUI 在 Linux 上组合中按 Enter 会触发 action，且该修复 PR 被 `not_planned` 关闭）。

**结论二：如果目标是"同一个应用、更少内存、不打包 Chromium"，Tauri v2 是理性答案。**

它是**外壳**的迁移，不是 UI 的迁移。（对照：Tauri v2.11.5 是当前版本，**不存在 v3**。）

### 5.2 社区对 GPUI 的最有价值批评（供参考，非决定项）

- `landr0id`（HN, 2026-05-03）：「GPUI 基本上是真正意义上的 UI 框架：**一个用来构建 UI 框架的框架**……**就像用 div 和基础 CSS 建网站**」「很长一段时间处于『读代码当文档』的状态」「**滚动条竟然在 Zed 的 UI crates 里而不在核心 GPUI**」「任意文本选择也做不到」。
- `Vanuan`（HN, 2026-09-04）：「能力层太薄，**GPUI 应当被当作构建框架的框架**，而不是 Qt 或 Electron 那样的开箱即用平台……这为**极端碎片化**创造了条件，只有浏览器大战可以类比。」
- `jenadine`（HN, 2025-05-07）：「GPUI 是专门为 Zed 构建的，在 monorepo 里没有独立发布，**一直有大量破坏性变更**……在它们把它拆分出来、正确版本化、不再一直破坏东西之前，很难把 GPUI 当作严肃的通用选项。」
- 反方（有价值）：GPUI 作者 `nathansobo`：「GPUI 有成熟的调度故事……还带有**确定性随机测试调度器**用于逼出时序 bug。」——这一点确实优于多数 Rust GUI 栈，也解释了 GPUIX 为何能有可靠的 GPU 截图测试。
- `shubham_sinha`（2026-08-16）：「**GPUI 将成为 Rust 生态的 React**。」

**注意**：`andrewl-hn` 在 2025-10 说的「对屏幕阅读器不透明」已被 AccessKit 集成部分推翻——**但只推翻了 main 分支，未推翻已发布版本**（见 3.4）。

---

## 6. 关键风险清单（按严重度）

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| 1 | **CJK IME 在所有 Rust 原生方案上均未验证** | 若中文输入有问题，一切原生路线归零 | **第 0 号任务，见 0.4-1** |
| 2 | **GPUI 无软件渲染，RDP/VDI/无 GPU 机器不可用** | 企业/远程办公场景直接不可用 | 见 0.4-2；若必须支持则排除 GPUI |
| 3 | **GPUI webview 不可裁剪/停靠，且无 Linux** | 浏览器面板与内嵌 composer 方案受阻 | 见 0.4-3；考虑独立窗口 UX |
| 4 | **Composer（手写 contentEditable，~3,300 行）与 Markdown 渲染块（~5,000–6,000 行）无原生替代** | 路线 A/B 的富文本成本（约 3–6 人月） | 见 0.4-4；路线 C/E 把它们留在 WebView |
| 5 | **GPL 传染边界** | 引入 Zed 的 editor/markdown/ui/terminal 即整包 GPL | 严格限定在 Apache 层；`auto_update` 也不可用 |
| 6 | **gpui-kit GPL 溯源未审计** | 潜在许可风险 | 依赖前法务审计（PR #2936 已做部分工作） |
| 7 | **GPUI 分发停滞（crates.io 落后 325 天，`gpui_platform` 未发布）** | 想要的能力常只在 git | 若走 GPUI，接受 git 依赖或依赖第三方快照（引入对应风险） |
| 8 | **无障碍不可辩护** | 合规风险 | 若为硬需求，排除 GPUI |
| 9 | GPUIX 依赖个人 Zed fork，数天一重钉 | 供应链与可维护性 | 不用 GPUIX 做主 UI |
| 10 | gpui-kit 0.x 破坏性升级 | 持续维护成本 | 钉版本 + 升级回归测试；关注 #3035 |
| 11 | 267 token 主题引擎无 CSS 等价物 | 视觉体系需重新实现 | 派生计算移到代码侧；路线 D 不受影响 |
| 12 | 109 处嵌套滚动 | 布局需重新设计 | 原生面板各自独立滚动反而更自然 |
| 13 | 无自定义字体加载（GPUIX） | 品牌与排版 | gpui-kit 路线不受限 |
| 14 | 无多窗口（GPUIX）；GPUI 原生支持 | 现有多窗口功能 | 排除 GPUIX |

---

## 7. Spike 清单（按顺序执行，全部可在一周内完成）

| # | Spike | 判定标准 |
|---|---|---|
| 1 | **CJK IME**（macOS + Windows + Linux） | 拼音输入全过程可用；**Linux 上组合中按 Enter 不得发出消息** |
| 2 | **RDP / 无 GPU 环境** | 在远程桌面与虚拟机中能启动并渲染 |
| 3 | **WebView 叠加/裁剪** | 能否把 WebView 限制在面板区域内；若不能，确认独立窗口 UX 可接受 |
| 4 | **无障碍**（NVDA / VoiceOver） | 若能读出会话列表与消息内容则通过；否则明确这是可接受的取舍 |
| 5 | **构建时间与产物体积** | 完整 GPUI 应用冷构建时间与 release 体积是否可接受 |
| 6 | **纵切（1–2 周）** | 用 gpui-kit Dock + RPC 客户端跑通：列会话 → 开会话 → 流式响应 → 工具审批，**并在其中用 WebView 承载真实的 ProseMirror 编辑器**（这一步同时验证 0.4-4） |
| 7 | **Tauri v2 对比纵切（并行）** | 同样流程，用 Tauri v2 实现，比较工作量与体验 |

**第 7 项必须与第 6 项并行做。** 只测 GPUI 不测 Tauri，会失去唯一"今天全绿"的对照基线，容易把一个可接受的方案误判为不可接受，或反之。

---

## 8. 最终建议

### 8.1 立即可做的四件事（零风险，不需要决策）

1. **实测 CJK IME**（Spike 1）。这是所有路线的共同前提，且成本极低。
2. **量化 Composer 与 Markdown 渲染块的原生化成本**（约 8,300–9,300 行；ProseMirror 编辑器本体已排除）。建议先做一次"如果只能保留 20%，保留哪 20%"的能力盘点，明确哪些必须有、哪些可降级。~~同时核实 tree-shaking~~ → **已核实完毕，见 §1.4b：tree-shaking 没有生效，668 KB ProseMirror 代码确实进入了主 chunk**，因此第 3 项是确定要做的。**本报告不修改任何代码。**
3. **清理生产产物中约 683 KB 的死代码**（见 §1.4b）——这是**唯一一项不需要任何架构决策、当天就能做完、且立刻可量化收益**的工作：`packages/ui/package.json` 补 `"sideEffects"`、把 `TiptapMarkdownEditor` 移出主 barrel、生产构建去掉 `playground` 入口。复验方式：`bun run electron:build:renderer` 后确认主 chunk 内 `prosemirror`/`tiptap` 归零。
4. **把 RPC 契约固化为正式的"前端可替换"边界**。`RPC_CHANNELS`（401 channel）+ `CHANNEL_MAP`（370 方法）+ `routing.ts` 已事实上承担该角色，但它是 TypeScript 私有的。把 channel 列表与 payload 类型导出为语言无关的 schema（JSON Schema 或类似），让任何宿主（Rust、Tauri、第三方客户端）生成绑定；并把既有"新增 channel 未分类则 CI 失败"的机制扩展为"新增 channel 未定义 schema 则 CI 失败"。**这是所有后续路线的公共前置投资，无论最终选哪条都值得做。**

### 8.2 路线推荐

| 目标 | 推荐 |
|---|---|
| **降低 Electron 成本、改善启动/内存/体积** | **路线 D（Tauri v2）**——唯一今天全绿 |
| **真正的原生 UI 体验** | 路线 E：D 打底 → Spike 全过 → 按模块原生化 |
| **最小二进制与最大性能，且目标机器都有 GPU、不需要无障碍、可接受独立窗口浏览器** | 路线 B（先做 Spike 1–5） |
| **想尝试 GPUIX 的 GPU 渲染** | 仅用于**单个高性能面板**实验（时间线、图表、Run Map），不碰主 UI |

### 8.3 明确不推荐

- **不要把 142k 行 UI 整体重写到 GPUIX。** 三条路线里投入产出比最差：成本最高（11–19 人月起）、收益最小（仅去掉 Chromium）、且正面撞上 GPUIX 的每一个硬缺口。
- **不要在 Spike 1（CJK IME）完成前启动任何原生 UI 项目。** 本项目有 `zh-Hans`/`ja` locale，composer 里已有专门的 IME 组合态处理代码。**"CJK IME 是 2026 年所有 Rust 原生 GUI 工具包的共同弱轴"**——Iced 有一个修复"输入中文时 panic"的开放 PR，egui 有 8 个自 2022 年起的 IME issue，Blitz/Dioxus 的 CJK IME PR 截至 2026-09-08 仍是 open，而 GPUI 在 Linux 上组合中按 Enter 会触发 action。这不是某一家的问题，是整条技术路线的当前状态。
- **不要把无障碍当作"以后再说"。** 若它是合规要求，GPUI 今天不具备可辩护性（已发布版本零无障碍，Zed 自称 main UI "largely inaccessible"）。

---

## 附录 A：关键结论的证据位置

| 结论 | 证据 |
|---|---|
| GPUI 是 Apache-2.0 且已发布 | `zed/crates/gpui/Cargo.toml`：`license = "Apache-2.0"`、`publish = true`、`version = "0.2.2"` |
| Zed 的 editor/markdown/ui/terminal 是 GPL | Zed README 双许可声明；逐文件核验；`[workspace.package] publish = false` |
| gpui-kit webview 总是画在最上层、仅 macOS+Windows | **本报告作者已在本地检出中直接核验** `docs/research/.scratch/gpui-kit/crates/webview/README.md` 原文："The WebView will render on top of the GPUI window, any GPUI elements behind the WebView bounds will be covered. / Only supports macOS and Windows currently. / So, we recommend using the webview in a separate window or in a Popup layer." |
| Tauri v2 为当前版本且无 v3 | crates.io / npm 实测：`2.11.5`（2026-07-01）为 max_version |
| GPUI 与 Zed 的许可分界 | Zed README 双许可声明；逐文件核验 `crates/{editor,markdown,ui,ui_input,terminal,language,project,workspace,rope,multi_buffer,auto_update}` |
| GPUI 无软件渲染 | `gpui_wgpu::new_rejecting_software()` 跳过 `DeviceType::Cpu`；issue #26692（Windows 远程桌面） |
| 上游两次拒绝 webview PR | PR #13730、#54433 closed unmerged；issue #21208（427 reactions） |
| crates.io `gpui` 落后 main 约 11 个月 | crates.io `gpui 0.2.2`（2025-10-22）；`gpui_platform` 在 crates.io **404** |
| GPUIX 是 React 渲染器而非 Rust 框架 | `gpuix/README.md` 架构章节；`packages/native/Cargo.toml`（唯一 manifest，GPUI 为路径依赖） |
| GPUIX 依赖个人 Zed fork | `gpuix/.gitmodules`：`url = https://github.com/remorses/zed.git`，`branch = gpuix` |
| GPUIX 嵌套滚动禁止 | `gpuix/AGENTS.md`：`## Nested scrolling is not supported` |
| GPUIX 无 webview / 多窗口 / 托盘 / 通知 / PDF | `gpuix/README.md` `## Status`；全仓库 grep 零命中 |
| GPUIX a11y 未发布 | `.changeset/accessibility-aria-props.md` 未消费；0.7.0 CHANGELOG 无 a11y 条目 |
| 前端与运行时已解耦 | renderer 中 `WebSocket`/`XMLHttpRequest`/`EventSource`/`ipcRenderer` **全为 0 命中**；`window.electronAPI` **626** 处文本 / **321** 个不同方法 / 114 文件；`RPC_CHANNELS` = **401 channel**；`CHANNEL_MAP` = **370 方法**；`ipcMain` 注册仅 **24** 个 |
| 已存在异质宿主先例 | `apps/webui/src/adapter/web-api.ts`（337 行 + `WsRpcClient` + `buildClientApi`） |
| 协议语言无关且完整 | `packages/shared/src/protocol/types.ts` |
| 服务器可独立运行 | `packages/server/src/index.ts` 头注释；`package.json`（`bin: craft-server`，TLS 环境变量） |
| 富文本输入框是手写 contentEditable | `apps/electron/src/renderer/components/ui/rich-text-input.tsx` |
| **ProseMirror 编辑器在生产中未被使用** | `TiptapMarkdownEditor.tsx`（405 行）的唯一导入者是 `playground/registry/planner.tsx:30`（仅开发用）；`extensions/TiptapImageBlock.tsx`（160 行）除自身外零导入者。核验方法：一次扫描构建 **8,844 条导入边**后反向查找 |
| 共享 Markdown 渲染管线 | `packages/ui/src/components/markdown/Markdown.tsx`（700 行），electron 与 webui 共用 |
| 109 处滚动容器 / 零虚拟化 | renderer 全量 grep；`react-window`/`react-virtual`/`@tanstack/react-virtual`/`react-virtuoso` 均 **0 文件且 0 依赖条目** |
| **~6,041 处 Tailwind `className=`** | renderer 4,905 + packages/ui 1,136；另有 265 个 CSS 自定义属性（524 个定义点）、879 处 `var(--)`、201 处 `color-mix()`、15 个 `@keyframes`、11 处 `@container`、8 个 `@property`、9 处 `backdrop-filter`、47 条滚动条规则 |
| gpui-kit 有 Dock/MessageScroller/DataTable/Editor | `crates/component/src/lib.rs` 66 模块；`tab_panel.rs` 61 KB、`table` 106 KB、`base/input/base/state.rs` 370 KB |
| gpui-kit 用 crates.io 快照而非 fork | `Cargo.toml`：`gpui = { package = "gpui-pre", version = "0.3.1" }`；`CONTRIBUTING.md` |
| PDF 生态有解 | `hayro` 0.7.1 + `gpui-pdf` 参考实现 |
| **生产 bundle 含 ~683 KB 死代码** | 实测已存在的 `apps/electron/dist/renderer/`：主 chunk `src-CGxzVikD.js` 1,923 KB（`index.html` 中 `modulepreload`，启动必载），其中 ProseMirror/Tiptap 首末匹配跨度 **668 KB**；样式表 99 条 tiptap/ProseMirror 规则占 70 KB 中的 **15.5 KB**（`index.html` 直接 link）；`playground-DROHI_ig.js` **728 KB** 亦在 dist 内 |
| 死代码根因（三条叠加） | `packages/ui/package.json` **无 `sideEffects` 字段**；`packages/ui/src/index.ts`（barrel）re-export `TiptapMarkdownEditor`；`TiptapMarkdownEditor.tsx` 含副作用导入 `./tiptap-editor.css` |
| 跨度内是库代码而非字符串 | `Schema` ×28、`Fragment` ×22、`NodeType` ×23、`MarkType` ×13、`Transform` ×11 |

## 附录 B：Tiptap / ProseMirror —— 三次表述的最终结论

> **最终结论**：这些包**是真实声明的依赖**（初稿说"死依赖"是错的），但其**编辑器在生产代码中未被使用**（二稿说"是硬阻塞"是过度的）。

导入清单（`packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx`）：

```
@tiptap/react                  @tiptap/starter-kit
@tiptap/extension-placeholder  @tiptap/extension-task-list
@tiptap/extension-mathematics  @tiptap/extension-image
@tiptap/extension-file-handler @tiptap/markdown
tiptap-markdown                katex
shiki（经 TiptapCodeBlockView）
```

**关键事实（经 8,844 条导入边全量扫描核验）**：

| 事实 | 证据 |
|---|---|
| `TiptapMarkdownEditor`（405 行）在生产代码中唯一导入者 | `playground/registry/planner.tsx:30` —— **仅开发用的组件实验场** |
| 生产代码导入的是 barrel 且只取具名导出 | `@craft-agent/ui/markdown` → `Markdown` / `CodeBlock` 等；`ChatDisplay.tsx:25`、`TurnCard.tsx:30`、`SystemMessage.tsx:14`、`UserMessageBubble.tsx:19`、`RecordInspector.tsx:16`、`Info_Markdown.tsx:13`、`AnnotatableMarkdownDocument.tsx:2` |
| 该目录**真正的死代码**只有 1 个文件 | `extensions/TiptapImageBlock.tsx`（160 行）除自身定义外零导入者 |

**迁移含义**：

1. **不需要重写 ProseMirror 编辑器**——生产路径不经过它。应确认 Vite 生产产物中没有 `prosemirror`/`tiptap`；若存在，那是 barrel 导出破坏 tree-shaking 的**打包问题**，可用深路径导出独立修复。
2. **需要重写的是**：Composer（`rich-text-input.tsx` 825 行手写 contentEditable + `FreeFormInput.tsx` 2,508 行）+ Markdown 渲染块（约 5,000–6,000 行），合计约 **8,300–9,300 行**。
3. **仍然成立的一点**：GPUIX 只有纯文本 `input`/`textarea`，gpui-kit 的 `Editor` 是代码编辑器而 `TextView` 是只读渲染——**两者都承接不了 Composer 的富文本编辑语义**。
## 附录 C：本报告明确未能验证的事项

1. `gpui-component`/`gpui-base` 是否混入了 GPL 的 Zed 代码——**需法务/溯源审计**。
2. CJK IME 在任何 GPUI 应用中的实际运行表现——**无公开证据，必须自测**。
3. emoji 与可变字体的渲染质量。
4. `ZED_EXPERIMENTAL_A11Y=1` 在今天的 main 上是否仍是必需。
5. HTTP 被限流的若干 issue/discussion 正文（标题已核验）。
6. Reddit 社区舆情**完全缺失**（本环境无法访问 reddit.com）——这是采集缺口，不是"没有负面评价"的证据。
7. `gpui-ce` 的版本号策略（默认 0.2.2 而 0.3.x 被 yank）。
8. gpui-kit 的构建时间与产物体积**未实测**（未执行构建）。
9. Windows/Linux 上 IME 与原生屏幕阅读器的一致性——仅源码级证据。
### 已在报告内更正的五处（均由后续核验推翻初稿判断）

初稿、二稿、终稿之间共有五处实质更正。**如实列出**，因为它们决定了成本估计的量级。

| # | 初稿/二稿的判断 | 核验结果 | 对成本估计的方向 |
|---|---|---|---|
| 1 | `@tiptap/*` / `prosemirror-*` 是**死依赖** | ❌ 错误。它们是**真实声明的依赖** | — |
| 2 | （二稿更正）ProseMirror 富文本子系统是路线 A/B 的**硬阻塞**（约 60 文件 / 360 KB） | ❌ **过度**。编辑器本体在生产代码中**未被使用**（唯一消费者是 dev playground） | ↓ **下调** |
| 3 | UI 规模 = `renderer` 的 110,430 行 | ❌ 不完整。UI 分布在**两个**包：`renderer` + `packages/ui/src`，生产口径 **656 文件 / 122,423 总行** | ↑ **上调约 29%** |
| 4 | RPC 契约 = 357 channel | ❌ 混用三个不同的量。`RPC_CHANNELS` = **401**；`CHANNEL_MAP` = **370 方法**；**实际调用 321 个** | 影响接口实现，非成本 |
| 5 | （二稿补充）CSS 系统成本未量化 | ✅ 新发现：**~6,041 处 Tailwind `className=`**、265 个自定义属性、201 处 `color-mix()`、11 处 `@container` 是**最容易漏算**的一项 | ↑ **上调** |

**净效果**：终稿的路线 A 估计为 **11–19 人月**、路线 B 为 **18–28 人月**（初稿为 6–10 / 12–24）。五处更正中有四处使"原生重写"变贵，一处使其变便宜；**净方向是变贵**，因此"保留前端、只换壳"（路线 D/E）的相对优势比初稿更强。

### 方法论教训（值得记录）

- **行数口径会骗人**：`Get-Content | Measure-Object -Line` **静默丢弃空行**，全仓库误差约 **9%**。本报告统一使用**非空行**并同时给出总行数；任何 LOC 数字都应声明口径。
- **"在导入图中可达" ≠ "被使用"，但"未被使用"也 ≠ "不占体积"**。这是本报告最有价值的一条教训，含两个方向：barrel 导出会让一个文件在依赖图里可达却从不执行（所以我二稿高估了它的重写成本）；但反过来源代码里"没有 import"**也不代表**它不在产物里——ProseMirror 就是这样，生产代码一次都没调用，却因 `sideEffects` 缺失 + 副作用 CSS 导入而**实实在在占了主 chunk 的 668 KB**。判定死代码必须同时做**反向导入查找**和**构建产物核验**，两者缺一不可。
- **统计范围必须显式声明**：初稿的错误 1 与错误 3 都源于我把 grep 范围写成 `apps/electron/src`，而 UI 实际横跨两个包。范围声明应当是结论的一部分。
