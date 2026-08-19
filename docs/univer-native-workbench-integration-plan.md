# Craft Agent 原生能力工作台 —— 最终实施方案

- 作者：Craft Agent（与用户协作产出）
- 日期：2026-08-20
- 状态：已确认，待实施
- 关联仓库：`VanDING/craft-agents-rebuild`（基于 craft-ai-agents/craft-agents-oss 的个人重建 fork）

---

## 1. 背景与目标

本方案的起点是：把 **DSH（Dream Sheet × Univer Office）插件** 的核心能力做进 Craft Agent 的**原生能力**（非 MCP source），并同步对产品做一次**全局梳理与修剪**——收敛散落的视图，确立统一的界面与呈现模型。

经源码级调研，DSH 底层引擎建立在 **混淆闭源 + 90 天 license 轮换授权**体系上（`@univerjs-pro/*`、`@univer-cli/*` 指向私有 insiders registry），**不适宜**作为"原生可分发能力"的载体。因此本方案采用 **路线 B：用公开 Apache-2.0 开源包自建**，仅复用 DSH 的架构蓝图（隔离 worker、渲染、worktree）。

### 已确认决策（拍板清单）

| # | 决策 | 结论 |
|---|---|---|
| D1 | 路线 | **B：开源重做**（Apache-2.0 自建），不用 DSH 的闭源授权体系 |
| D2 | 版本基准 | `0.25.1` 稳定线（公开 npm latest，已实测 Bun 可跑）；不用 `1.0.0-insiders` 每日构建 |
| D3 | 界面车道 | **双车道**：主会话固定（main lane，锁定单例）+ 右侧拓展（right lane，一次聚焦一屏） |
| D4 | 右拓形式 | 固定右侧栏 + 内 tab 切换（非 drawer） |
| D5 | office 范围 | **先做 Spreadsheet + Docs（含 Slides 核心）**；Canvas/Base/关系表/PDF 为 Pro，本轮不做 |
| D6 | 其他 SDK | 本轮只做 office；思维导图/画图/图表等**后续独立迭代** |
| D7 | 浏览器承载 | **不嵌入右拓**，保持独立 BrowserView 呼出（作为"源/工具"非"呈现"） |
| D8 | 呈现承载 | **呈现组件全部走 renderer 原生**（不依赖浏览器内核） |
| D9 | 交互互通边界 | office/浏览器/files/preview 需互通；trajectory/context 纯呈现跟随会话 |
| D10 | doc-tools | 保留 pdf/img/ical/doc-diff/markitdown；xlsx/docx-tool 降为兜底 |
| D11 | git 策略 | 开 `feat/univer-workbench` 分支，分批 commit，不自动 push（本次按用户明确要求单独推 doc） |

---

## 2. 修正后的 Univer 能力边界（源码 + 官方双确认）

用户曾提到"Univer 官方支持 Spreadsheet/Docs/Slides/Canvas/Relational Table/PDF"——**产品层面成立，但需区分开源版与 Pro 版**。已核对官方文档 + 仓库 `packages/`：

| 能力 | 开源版（本方案采用） | Pro 版（闭源受控） |
|---|---|---|
| Spreadsheet | ✅ | — |
| Docs | ✅ | — |
| Slides | ✅ 核心编辑 | 图表/打印增强 |
| Canvas (Board) | ❌ | ✅ `@univerjs-pro/boards` |
| Relational Table (Base) | ❌ | ✅ `@univerjs-pro/bases` |
| PDF 导出/打印 | ❌ | ✅ `@univerjs-pro/pdfs` / `print` |
| XLSX/DOCX 导入导出 | ✅ | 高级格式 Pro |
| 实时协作 | ❌ | ✅ |

> 开源仓库 `packages/` 确认**不含** base/board/pdf/print 相关包；这些均在 Pro。因此本方案 P0/P1 明确 **Spreadsheet + Docs + Slides 核心**。CSV/TSV 导出 Univer 原生支持；PDF 需求缺口用现有 `pdf-tool` 兜底。

---

## 3. 目标架构

### 3.1 界面模型（双车道 + 统一右拓容器）

```
┌───────────────────────────────┬─────────────────────────────────┐
│  main lane（锁定 + 单例）      │  right lane（右拓，一次一屏）      │
│                               │                                 │
│  会话 Session                  │  tab: 看板/日历/轨迹/上下文/      │
│  （不可驱逐、不可并排）          │       files/diff/office/         │
│                               │       sources/skills/settings     │
│                               │                                 │
│                               │  可调宽 / 可折叠 / 可全屏           │
└───────────────────────────────┴─────────────────────────────────┘
```

**车道机制**（`apps/electron/src/renderer/atoms/panel-stack.ts` 已预留 `PanelLaneId`/`PANEL_LANE_POLICIES` 结构，只需扩展）：

```ts
export type PanelLaneId = 'main' | 'right'
export const PANEL_LANE_POLICIES = {
  main:  { id:'main',  order:0, allowedTypes:[会话型],   locked:true,  singleton:true },
  right: { id:'right', order:1, allowedTypes:[全部其他], locked:false, singleton:false },
}
```

- `main` lane：会话，**锁定 + 单例**（不被 LRU 驱逐）。
- `right` lane：拓展，**一次聚焦一个**（复用现有 `focusedPanelIdAtom` 语义；多面板折叠为 tab）。
- 复用现有：`PanelResizeSash`（调宽）、`ExpandedPanelOverlay`（全屏）、`hidden-panels.ts` LRU（折叠/恢复）。

### 3.2 呈现承载模型（D7/D8）

**不依赖浏览器内核。** 统一右拓容器是 renderer 原生框架，内部**按内容类型选承载**：

| 内容类型 | 承载方式 | 举例 |
|---|---|---|
| 数据/文档**交互**（需 JS + 与会话互通） | **renderer 原生组件** | Univer Viewer、datatable/spreadsheet、思维导图 |
| 静态**权威呈现** | 现有原生 preview block | `html-preview`(沙箱禁JS)/`pdf-preview`/`image-preview` |
| 真实**网页承载**（源/工具） | 独立 BrowserView（不嵌入） | browser 自动化、登录态页面 |

> 关键约束：`html-preview` 用 sandboxed iframe（`sandbox` 无 `allow-scripts`），**禁 JS**。因此一切交互式内容（包括 Univer）**必须**走 renderer 原生组件通道，不能塞进 html-preview。renderer 是完整 Electron+React 应用，具备完整 JS 能力。

### 3.3 原生能力容器（交互互通模型）

- 载体：**bound-session** 机制（已存在，`activeSessionIdAtom`）+ `PreviewPanel`/新增 `OfficePanel` + `ReviewPanel`（merge/discard 审批）。
- 三类能力：
  - **交互互通型**（需与 agent 会话双向协作）：office、browser、files、preview
  - **纯呈现型**（只读、跟随会话）：trajectory、context、diff
  - **管理型**（独立会话管理）：board、calendar、sources、settings、projects

---

## 4. 里程碑拆解

### 里程碑 A：双车道界面改造（优先）

| 步骤 | 内容 | 源码锚点 | 风险 |
|---|---|---|---|
| A1 | 车道机制：`main` 锁定单例 + `right` 一次一屏 | `atoms/panel-stack.ts` | 中；核心布局 |
| A2 | 右拓容器：固定右侧栏 + tab + 可调宽/折叠/全屏 | `AppShell.tsx`/`PanelStackContainer.tsx`/`PanelResizeSash`/`ExpandedPanelOverlay` | 中 |
| A3 | 视图归类：board/日历/轨迹/上下文/office/浏览器/设置收拢进右侧 | `lib/workbench-panels.ts`（扩展 `office` kind） | 低 |
| A4 | 交互互通通道：确立"原生组件交互型 vs preview 呈现型"双通道 | renderer 原生组件挂载点 | 低 |

### 里程碑 B：Univer Office 原生能力

| 步骤 | 内容 | 说明 |
|---|---|---|
| B1 | Headless 引擎 | `packages/univer`；`preset-sheets-node-core@0.25.1`+`preset-docs-node-core`+Slides 核心；**Bun 构建**（规避 opentype.js CJS 命名导出问题，已实测） |
| B2 | `univer_*` 工具族 | 注册进 pi-agent-server（`tool-defs.ts` 机制）：status/unit/import/inspect/execute/export |
| B3 | 交互式 Viewer | renderer 挂载 `@univerjs/preset-sheets`（前端 UI preset，公开版）到 `OfficePanel`/`PreviewPanel`；`onReadFile` IPC 载入 xlsx/docx/univer |
| B4 | Worktree 隔离 + 审批 | 写操作先进文件级快照（不引入 pro collab-worktree），`ReviewPanel` 复用 merge/discard 授权 |
| B5 | 收敛 doc-tools | 保留 pdf/img/ical/doc-diff/markitdown；xlsx/docx-tool 降兜底；CSV/TSV 原生导出 |

### 建议顺序

```
A1（前端，先做）→ 并行 B1+B2（后端）→ A2+A3 → B3+B4 → B5
```

---

## 5. 风险与验收

| 风险 | 对策 |
|---|---|
| 车道改造影响核心布局 | A1 小步 + 键盘导航/拖拽回归；先保 `main` 锁定语义 |
| 交互式 SDK 体积 | office preset 按需懒加载、code-split（只加载用到的类型） |
| 开源版能力缺口（Canvas/Base/PDF） | 本轮明确不做；CSV/TSV 自导出；PDF 用 pdf-tool 兜底；列为远期 Pro 评估 |
| worktree 安全 | 文件级快照 + 授权审批（复用现有 permission 机制） |
| BrowserView 原生层级遮挡 | **本轮不嵌入**浏览器，规避该问题（D7） |

**里程碑 A 验收**：主会话固定在左不可驱逐；右侧一次呼出一个拓展面板并可切换/折叠/全屏；board/日历/轨迹/上下文全部可进右拓。
**里程碑 B 验收**：`univer_*` 工具可无头创建/编辑 xlsx（含公式自动重算，已实测）；renderer 会话内可交互查看/编辑 office 文档；写操作需审批合入。

---

## 6. 明确不做 / 远期

- **本轮不做**：Canvas(Board)、Relational Table(Base)、PDF 导出、实时协作（均为 Pro）；浏览器嵌入右拓；思维导图/画图/图表 SDK。
- **远期（独立迭代）**：其他能力 SDK（Excalidraw、MindElixir/markmap、ECharts/Recharts）；如需 Base/Board/worktree-collab，评估与 Univer 洽谈 Pro license（商业/授权决策，非技术决策）。

---

## 7. 交付与 git 策略

- 本方案文档以此文件形式交付，**单独提交并推送到 origin**（`VanDING/craft-agents-rebuild`，SSH），不混入其他未跟踪文件（如 docs/system-prompt-per-turn-analysis.md）。
- 后续代码落地开 `feat/univer-workbench` 分支，分批 commit，不自动 push（除非用户明确要求）。

---

## 附录：本次梳理结论（Q1–Q4）

1. **浏览器不作为面板视图**（D7）：BrowserView 原生层级 z-order 恒在最上，嵌入右拓会遮挡面板 DOM/动画，且它是"源/工具"而非"呈现"。保持独立呼出最优。
2. **呈现不统一依赖浏览器**（D8）：现有一切 preview 均为 renderer 原生 React 组件（无 `<webview>`），已是最优轻量方案；全盘浏览器化会引入进程开销、跨进程序列化、交互重写，是架构倒退。统一右拓容器是"原生框架 + 按内容类型选承载"。
3. **整体视图逻辑**：主会话 + 右侧一次一屏（D3/D4），收拢散视图为统一右拓车道。
4. **交互互通边界**：office/浏览器/files/preview 需互通；trajectory/context 纯呈现（跟随会话即可）+ diff 部分交互（审批）。源码 `activeSessionIdAtom` + bound-panel + `ReviewPanel` 已提供现成载体。
