# 通用内容工作台（Content Workbench）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 借鉴 opencode 右侧边栏的交互模式（MIT 协议，SolidJS→React 翻译），将 CraftAgent 从"主内容区只能并列会话 + overlay 弹层"的信息架构，改造为**通用内容工作台**：顶栏平铺三态入口 + 前台面板栈（≤3）与后台面板集（无限）并存，绑定会话的面板（Review/Diff、文件树、Context、Preview）自动跟随活跃会话，所有 overlay 弹层收敛为面板，面板可一键展开为 overlay 全屏。

**Architecture:** 完全基于现有 route-driven 面板架构（URL 为唯一事实源：`?panels`/`?fi`/`?route`），复用 `PanelStackContainer`/`PanelResizeSash`/`MainContentPanel`/`SessionFilesSection`/`ShikiDiffViewer`/`collectFileChangesFromActivities`/`useAction`。不引入 SolidJS/kobalte 代码；opencode 仅借鉴两个纯逻辑文件（宽度 clamp、diff 分类）与 tabs/空状态 UI 结构。所有新功能为 DOM 面板级，浏览器保持独立 OS 窗口。

**Tech Stack:** React 19、jotai、motion、Tailwind v4、Electron ^43、TypeScript/Bun monorepo。

---

## 背景事实（已核实，勿重复调查）

### 现有架构事实
- `PanelStackEntry` 为 route-based（`atoms/panel-stack.ts:38`），`allowedTypes` 已含 `['session','source','settings','skills','other']`；`pushPanelAtom` 可推入任意 `ViewRoute`
- `PanelSlot.tsx:143` 用 `navStateOverride` 渲染 `MainContentPanel`，按 `NavigationState` 输出：会话 / 来源 / 设置 / 技能 / 自动化 / 项目 / **Kanban（route `board`）** / **Calendar（route `calendar`）**（`MainContentPanel.tsx:384-399`）。**注意：board/calendar 是独立 route 前缀**（`route-parser.ts:107` 明示 "Encoded as its own prefix"，非 `sessions/board`，避免与 `{filter}/session/{id}` 详情解析冲突）；会话 route 前缀为 `allSessions`/`flagged`/`inbox` 等 filter（`routes.ts:96-103`）
- **PanelSlot.tsx:61** 渲染时硬调用 `parseRouteToNavigationState(entry.route)`——绑定面板新 route 必须可解析，否则 `navStateOverride=null` 时 MainContentPanel 回退全局导航（`MainContentPanel.tsx:71`）——**必须新增 PanelSlot 按 panelType 分流**（见 Task 1 Step 5）
- `navigation-reconcile.ts:19`：未知 route 在 URL 恢复时**原样保留**（不报错）——不会崩溃，但会掩盖"面板渲染错内容"问题
- 焦点机制：URL 唯一事实源。`syncUrl()`（`NavigationContext.tsx:280-320`）写 `?panels`（全部面板 route+proportion）/`?fi`（聚焦索引）/`?route`/`?sidebar`；`reconcileFromUrlParams`（:402-471）→ `reconcilePanelStackAtom`（保 id、设聚焦）；`focusedSessionIdAtom` 从聚焦面板 route 派生（`panel-stack.ts:119`）
- `visibleSessionIdsAtom`（`panel-stack.ts:130`）：前台所有面板的会话集合，驱动"后台会话完成 chip"（`App.tsx:1050`）
- 空会话清理：`NavigationContext.tsx:486-499`，会话从 `visibleSessionIds` 消失时自动删除空会话——**后台化面板会让会话"消失"，必须修复防误删**
- TopBar 右侧布局（`TopBar.tsx:230-328`）：`[BrowserTabStrip(动态折叠 badges)] [list/board/calendar 按钮组] [+ DropdownMenu(会话面板/浏览器窗口)] [Help]`；props 已有 `currentView`/`onNavigateToView`/`onAddSessionPanel`/`onAddBrowserPanel`
- overlay 弹层三处：
  - ChatDisplay 本地 `useState<OverlayState>`（:976），触发点 :1015-1039、:1839-1888（MultiDiff / Markdown pop-out / activity）
  - App.tsx `linkInterceptor.previewState` → `FilePreviewRenderer`（:2160-2215，image/pdf/code/json/markdown），`lib/link-interceptor.ts` 管理
  - `@craft-agent/ui` 的 preview overlays 均有 `embedded` 模式（playground 已验证）
- 面板调宽：`PanelResizeSash` + `resizePanelsAtom`，`PANEL_MIN_WIDTH=440`（`panel-constants.ts:16`）；面板比例（proportion 规范化，和=1）随 URL 持久化
- 快捷键：`actions/definitions.ts` + `useAction` 注册体系；`KeyboardShortcutsDialog` 自动展示
- 文件树：`right-sidebar/SessionFilesSection.tsx`（递归树+watcher+context menu，当前仅用于 `SessionInfoPopover`）
- Diff 数据：`lib/file-changes.ts` 的 `collectFileChangesFromActivities`/`getFirstFileChangeIdForActivity`；`packages/ui` `MultiDiffPreviewOverlay` 内嵌 `ShikiDiffViewer`
- 浏览器：`main/browser-pane-manager.ts`（3636 行，BrowserView 架构，独立 BrowserWindow），**无"后台/最小化"状态概念**；`BrowserInstanceInfo` 无状态字段
- `lib/local-storage.ts`：`get/set/remove(key, value, suffix?)`，支持 per-workspace suffix
- 键盘焦点原语：`hooks/keyboard/useFocusZone.ts`、`useRovingTabIndex.ts`

### opencode 借鉴清单（MIT，dev 分支）
| opencode 文件 | 借鉴方式 |
|---|---|
| `session-panel-width.ts`（clamp/首帧防抖） | 纯逻辑翻译为 TS 函数；**注意**：本项目面板宽度是 proportion 体系（非绝对 px），clamp 已有（PANEL_MIN_WIDTH），实际借鉴点为"resize 首帧防抖"与"比例持久化默认值" |
| `review-diff-kinds.ts`（add/del/mix 分类） | 纯逻辑直搬 |
| `session-file-list-v2.tsx`（文件名过滤） | 逻辑参考（UI 用现有 SessionFilesSection） |
| `session-side-panel.tsx` / `review-panel-v2.tsx`（tabs 结构/空状态/header） | UI 结构翻译（SolidJS JSX→React JSX，Tailwind 类名沿用） |
| **不借鉴** | diff 渲染（ShikiDiffViewer 更强）、文件树、快捷键体系、浏览器 |

---

## 语义决策（讨论结论汇总，用户已确认）

1. **DOM 面板级**，非 OS 窗口、非 dock 嵌套；浏览器保持独立 OS 窗口，仅顶栏平级入口
2. **功能窗口全部平级**：会话 / 看板 / 日历 / Review-Diff / 文件树 / Context / Preview / 浏览器，顶栏靠右平铺按钮（不分组）
3. **视图拆开**：list/board/calendar 三按钮语义统一为"面板 toggle"（已有则聚焦，无则新建）；Shift/Alt+点击 = 替换当前聚焦面板内容（保留旧"全屏切换"习惯）
4. **绑定类面板**（Review/文件树/Context/Preview）：内容跟随**活跃会话**（`activeSessionId` = 聚焦会话，聚焦面板非会话时保持"最后活跃会话"不漂移，自动跟随）
5. **前台栈 ≤3，后台集无限**：打开第 4 个 → LRU（最久未用）移入后台；后台面板点击唤出（前台满则挤最旧回后台）；顶栏按钮三态（未开/前台聚焦/后台圆点）；后台面板会话 = 后台会话语义（完成出 chip）；后台集 localStorage 持久化（per workspace）；**修复空会话误删**
6. **面板→overlay 展开**：面板 header 展开按钮 → 全屏弹层（复用现有 overlay 容器），Esc 还原，内容组件同实例
7. **Preview 面板 per-session**：打开文件（linkInterceptor.previewState 收敛）+ 对话展开（ChatDisplay 全部 MarkdownOverlayState pop-out/turn details/activities）统一收纳
8. **overlay 弹层消亡**：ChatDisplay 的 MultiDiff/Markdown overlay 与 App.tsx 文件预览 overlay 全部收敛为面板
9. **Kanban/Calendar**：不单独做 dock 集成；作为平级面板（route `board`、`calendar`，独立前缀）；需窄面板适配验证
10. **面板数量**：前台最多 3 个（3×PANEL_MIN_WIDTH=1320px 的物理约束）
11. i18n：全部新文案走 `apps/electron` 的 locale 文件（沿用现有 key 命名），通过 `lint:i18n:*` 校验

---

### Task 1: PanelType 扩展 + route 解析

**Files:** `apps/electron/src/renderer/atoms/panel-stack.ts`、`apps/electron/src/shared/route-parser.ts`、`apps/electron/src/shared/routes.ts`

- [x] **Step 1: PanelType 扩展**

在 `panel-stack.ts:16` 扩展 `PanelType`：`'session' | 'source' | 'settings' | 'skills' | 'other' | 'diff' | 'files' | 'context' | 'preview'`

- [x] **Step 2: 新增绑定面板 route 常量**

在 `shared/routes.ts` 增加 view route 常量：`'diff'`、`'files'`、`'context'`、`'preview'`（复用现有 route 工厂风格，单段前缀，与 `board`/`calendar` 同惯例）。这些 route 不含 session id（绑定面板内容由活跃会话决定，不编码进 URL）

- [x] **Step 3: route-parser 支持新 route**

`shared/route-parser.ts` 的 `parseRouteToNavigationState` 增加四个新 route 分支（`first === 'diff'` 等，与 `board`/`calendar` 分支并列），返回 `{ navigator: 'other', ... }` 形态；`buildRouteFromNavigationState` 同步支持回写

- [x] **Step 4: getPanelTypeFromRoute 扩展**

`panel-stack.ts:65` 的 switch 增加 `case 'diff'/'files'/'context'/'preview'` 返回对应 PanelType（`panel-stack.ts:69-80` 现返回 'other'）

- [x] **Step 5: PanelSlot 集中分流（关键，防刷新错渲染）**

`PanelSlot.tsx` 增加内容渲染器映射：按 `entry.panelType` 分流——绑定类型（diff/files/context/preview）→ 渲染对应 content-panels 组件（ReviewPanel 等，Task 6-9 实现）；其他类型 → 现有 `MainContentPanel` 路径（:143）。同时处理 `parseRouteToNavigationState` 返回 null 的兜底（绑定类型 route 解析失败视为非法 → 渲染空态提示而非全局导航）。**此步骤是 Task 6-9 各"PanelSlot 分支"的统一落点**（不再散落各 Task）

- [x] **Step 5: 单元测试**

`atoms/__tests__/` 新增 `panel-stack-content-types.test.ts`：验证 push 新类型面板、route↔panelType 互转、现有 `panel-stack-lanes.test.ts` 全部保持通过

### Task 2: 活跃会话记忆原子

**Files:** `apps/electron/src/renderer/atoms/active-session.ts`（新增）、`apps/electron/src/renderer/contexts/NavigationContext.tsx`

- [x] **Step 1: 新增 `atoms/active-session.ts`**

```ts
// 派生：当前聚焦会话（focusedSessionIdAtom）
activeSessionIdAtom
// 最后活跃会话（聚焦面板非会话时保持不漂移）
lastActiveSessionIdAtom
// 订阅 focusedSessionIdAtom 变化，非 null 时写入 lastActiveSessionIdAtom
syncActiveSessionEffectAtom（或在 NavigationContext 的 effect 中实现）
```

- [x] **Step 2: NavigationContext 挂载同步 effect**

在现有聚焦路由监听（:384-392 附近）增加 effect：`focusedSessionId` 非 null 时写入 `lastActiveSessionIdAtom`；`activeSessionIdAtom = focused ?? last`

- [x] **Step 3: TopBar 的 activeSessionId 语义对齐**

现有 `activeSessionId` prop（TopBar.tsx:45）改由 `activeSessionIdAtom` 提供（AppShell 内已近似，需确认来源统一）

- [x] **Step 4: 单元测试**

`atoms/__tests__/active-session.test.ts`：聚焦会话变化跟随、聚焦非会话面板时保持最后活跃、空态（无面板）返回 null

### Task 3: 顶栏平铺三态按钮组

**Files:** `apps/electron/src/renderer/components/app-shell/TopBar.tsx`、`apps/electron/src/renderer/components/app-shell/AppShell.tsx`、`apps/electron/src/renderer/contexts/NavigationContext.tsx`

- [x] **Step 1: 替换视图按钮组为平铺功能按钮组**

替换 `TopBar.tsx:236-263` 的 list/board/calendar 分组容器为平铺按钮组（22px 规格，沿用 `TopBarButton` + `Tooltip`）：会话、看板、日历、Review、文件树、Context、Preview、浏览器（lucide icons：`MessageSquare`/`LayoutGrid`/`CalendarDays`/`GitCompareArrows`/`FolderTree`/`ListFilter`/`FileText`/`Globe`）

- [x] **Step 2: 按钮三态状态派生**

新增派生逻辑（TopBar props 或直接读 atoms）：按钮状态 = 未打开 / 前台聚焦（`isActive`）/ **后台存在**（半亮 + 底部圆点，`cn` 条件类）。**判定用 `parseRouteToNavigationState` 而非字符串前缀**：会话按钮 = `navigator==='sessions' && viewMode 非 board/calendar`（会话 route 前缀是 `allSessions`/`flagged`/`inbox` 等 filter，非 `sessions`）；看板/日历按钮 = route `board`/`calendar`；绑定面板按 PanelType

- [x] **Step 3: 点击语义**

普通点击：面板已在前台→聚焦；在后台→唤出（Task 5）；未打开→push 新面板。`Shift/Alt`+点击：替换当前聚焦面板内容（`updateFocusedPanelRouteAtom`）。浏览器按钮：**复用 `BrowserTabStrip` 现有打开/聚焦逻辑**（有实例则聚焦对应窗口，无则 `onAddBrowserPanel` 新建）

- [x] **Step 4: 空间与响应式**

按钮组放 `BrowserTabStrip` 与 `[+]` 之间；窗口窄时按钮收进 `[+]` DropdownMenu（`TopBar.tsx:264-280` 扩展菜单项，复用现有 menu 结构）；沿用现有 ResizeObserver 密度逻辑（:101-131）评估可容纳数

- [x] **Step 5: AppShell 接线**

`AppShell.tsx` 实现 `onNavigateToView` 的新语义（:2330 附近现有调用点改为统一 `openPanel(type)` 处理函数），新增 `openPanel` handler（push/聚焦/唤出/替换）

### Task 4: 面板快捷键

**Files:** `apps/electron/src/renderer/actions/definitions.ts`、`apps/electron/src/renderer/components/app-shell/AppShell.tsx`

- [x] **Step 1: definitions 新增 action**

新增 `panel.diff`、`panel.files`、`panel.context`、`panel.preview`、`panel.toggle`（聚焦/新建对应面板）。**不新增循环类 action**——`panel.focusNext`/`panel.focusPrev` 已存在（definitions.ts），直接复用，勿重复定义

- [x] **Step 2: useAction 注册**

`AppShell.tsx` 用 `useAction` 注册各 handler（复用 Task 3 的 `openPanel` 逻辑）；确认 `KeyboardShortcutsDialog` 自动展示新条目（现有机制无需改动）

### Task 5: 前台栈 + 后台集（LRU）

**Files:** `apps/electron/src/renderer/atoms/panel-stack.ts`、`apps/electron/src/renderer/atoms/hidden-panels.ts`（新增）、`apps/electron/src/renderer/contexts/NavigationContext.tsx`、`apps/electron/src/renderer/App.tsx`

- [x] **Step 1: 新增 `atoms/hidden-panels.ts`**

```ts
hiddenPanelsAtom: { id, route, panelType, hiddenAt }[]   // 不占布局
MAX_FOREGROUND_PANELS = 3
// 打开：pushPanelAtom 包装——前台满 3 时，hiddenAt 最早的移入后台集
openPanelAtom(route, { replaceFocused?: boolean })
// 唤出：hiddenPanels 中移除，push 到前台（前台满则挤最旧入后台）
restorePanelAtom(id)
// 关闭：前台关闭（closePanelAtom 现状）；后台直接移除
closeHiddenPanelAtom(id)
// LRU 排序辅助（hiddenAt 时间戳）
```

`pushPanelAtom` 增加前台上限断言；保留原 `pushPanelAtom`（多会话并列场景仍可用）

- [x] **Step 2: localStorage 持久化 + 恢复时机**

`hidden-panels.ts` 用 `lib/local-storage` 的 `get/set`（suffix=workspace id）持久化后台集（route + panelType 数组）。**恢复时机两处**：(a) App 启动路由恢复（NavigationContext reconcile 附近）；(b) **工作区切换时**——NavigationContext 已有 per-workspace URL 持久化/恢复（`storage.set(KEYS.workspaceUrl, url.search, workspaceSlug)`，:322-324），后台集恢复必须挂到同一切换机制，否则切工作区后后台集张冠李戴

- [x] **Step 3: 历史穿越去重（back/forward 一致性）**

TopBar Back/Forward 走 history pushState 穿越面板历史；后台集存 localStorage 不在 URL。**场景**：前台满 3 挤 1 入后台 → URL 剩 3 个 → Back 回到"4 前台"历史 → 该面板既在前台又留在后台集 → 重复。**对策**：`reconcileFromUrlParams`（或 `reconcilePanelStackAtom`）恢复前台后，将前台 route 与后台集**去重合并**（前台存在的从后台移除），保证任何历史穿越下状态唯一

- [x] **Step 4: 空会话清理修复**

`NavigationContext.tsx:486-499`：`prevVisibleSessionIdsRef` 判断改为"前台+后台会话全集"（hiddenPanels 的 route 也解析 session id 纳入集合），防止后台化空会话被误删

- [x] **Step 5: 后台 chip 语义**

后台面板会话**不计入** `visibleSessionIdsAtom`（维持现有"不在任何前台面板 = 后台会话"语义，`App.tsx:1050` 无需改动）——即后台化会话完成任务时自然出 chip

- [x] **Step 6: 单元测试**

`atoms/__tests__/hidden-panels.test.ts`：LRU 挤出顺序、唤出交互、上限 3 断言、持久化序列化

### Task 6: Review-Diff 面板

**Files:** `apps/electron/src/renderer/components/content-panels/ReviewPanel.tsx`（新增）、`apps/electron/src/renderer/lib/diff-kinds.ts`（新增）

- [x] **Step 1: diff 分类逻辑（opencode 借鉴）**

翻译 `review-diff-kinds.ts` 为 `lib/diff-kinds.ts`：按 FileChange 的 add/del/mix 状态分类（`computeChangeStats` 复用 `MultiDiffPreviewOverlay.tsx:123` 的现有统计逻辑，不重写 diff 计算）

- [x] **Step 2: ReviewPanel 组件**

输入 `sessionId`（= activeSessionId）；数据流：session activities → `collectFileChangesFromActivities`（`lib/file-changes.ts:15`）→ 分组（复用 `createFileSections` 逻辑，`MultiDiffPreviewOverlay.tsx:98`）→ 列表项（add/del/mix 着色 + 文件路径 + ±N 统计）→ 点击项内嵌 `ShikiDiffViewer`（`embedded` 渲染，参考 `MultiDiffPreviewOverlay` embedded 分支）；空状态（无变更时的引导文案）；header 显示绑定的会话名。
**消息异步加载**：activities 由 `session.messages` 派生，messages 为异步加载（现有 `ensureSessionMessagesLoadedAtom`，AppShell 已用）——ReviewPanel 挂载时触发加载，加载中显示占位，避免空态误报"无变更"

- [x] **Step 3: 会话活动数据 hook**

activities 由会话消息派生（renderer `Session` 含 `messages`，`groupMessagesByTurn`/activity 提取逻辑在 ChatDisplay 内，`@craft-agent/ui` 导出）；从 ChatDisplay 抽出为共享 hook（候选：`lib/file-changes.ts` 同目录的 `useSessionActivities(session)` 或直接复用现有提取函数，执行时以 ChatDisplay 实际数据流为准）

- [x] **Step 4: PanelSlot 渲染分支**

`PanelSlot.tsx` 增加分支：`entry.panelType === 'diff'` → `<ReviewPanel sessionId={activeSessionId} />`（Task 1 扩展后）

### Task 7: 文件树面板

**Files:** `apps/electron/src/renderer/components/content-panels/FilesPanel.tsx`（新增）

- [x] **Step 1: FilesPanel 组件**

包装 `SessionFilesSection`（`hideHeader` + `sessionId=activeSessionId` + `sessionFolderPath` 从活跃会话 meta 取）；文件名过滤条（借鉴 opencode `session-file-list-v2.tsx` 的过滤逻辑，UI 用现有组件与样式）

- [x] **Step 2: PanelSlot 渲染分支**

`entry.panelType === 'files'` → `<FilesPanel />`

### Task 8: Context 面板

**Files:** `apps/electron/src/renderer/components/content-panels/ContextPanel.tsx`（新增）

- [x] **Step 1: ContextPanel 组件**

数据源（已核实，全部现有）：**sources/skills 是 workspace 级**（`LoadedSource` 仅含 `workspaceId`，`packages/shared/src/sources/types.ts:501`，无 session 关联字段），故展示结构为：
- 当前 workspace 的 `sourcesAtom` + `skillsAtom`（分组列表，每项可跳转：复用 `navigate` 到对应 source/skill route）
- 当前活跃会话元数据（`sessionMetaMap`：workingDirectory、attachments、permissionMode、status、labels——字段以 `SessionMetadata` 为准，`packages/core/src/types/session.ts:46`）
- 不虚构"会话关联的 sources"（该字段不存在）；如需会话级过滤留作后续

- [x] **Step 2: PanelSlot 渲染分支**

`entry.panelType === 'context'` → `<ContextPanel />`

### Task 9: Preview 面板（打开文件 + 对话展开）

**Files:** `apps/electron/src/renderer/atoms/preview.ts`（新增）、`apps/electron/src/renderer/components/content-panels/PreviewPanel.tsx`（新增）

- [x] **Step 1: per-session preview 状态**

`atoms/preview.ts`：`previewStateBySessionAtom: Map<sessionId, PreviewEntry[]>`（PreviewEntry = `{ type: 'file', path } | { type: 'markdown', content, title }`，对齐 ChatDisplay 的 `MarkdownOverlayState` 与 App.tsx 的 `FilePreviewState`）

- [x] **Step 2: PreviewPanel 组件**

渲染当前 activeSessionId 的 preview 条目列表（tab 或堆叠列表）+ 内容区：file → `FilePreviewRenderer` 同款渲染（image/pdf/code/json/markdown 分派，`App.tsx:2200-2215` 的 `FilePreviewRenderer` 逻辑抽到共享组件或直接复用）；markdown/activity → 渲染 pop-out 内容（复用 ChatDisplay 的 markdown 渲染组件 `Markdown`/`DocumentFormattedMarkdownOverlay`）

- [x] **Step 3: PanelSlot 渲染分支**

`entry.panelType === 'preview'` → `<PreviewPanel />`

### Task 10: overlay 收敛（弹层消亡）

**Files:** `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`、`apps/electron/src/renderer/App.tsx`、`apps/electron/src/renderer/lib/link-interceptor.ts`

- [x] **Step 1: ChatDisplay MultiDiff overlay → diff 面板**

`:1839-1870` 的 `setOverlayState({type:'multi-diff'...})` 触发点改为：**触发型打开策略**——若 diff 面板已存在则聚焦；不存在且前台满 3 → 替换最旧面板并 toast 提示（避免挤走用户正看的会话面板的突兀感，与 Task 5 主动打开的 LRU 策略并列）；focusedChangeId 通过 diff 面板 focus atom 传入实现定位滚动；删除 `MultiDiffOverlayState` 及对应渲染（:2081）

- [x] **Step 2: ChatDisplay Markdown/activity overlay → preview 面板**

`:1015-1039`（pop-out/turn details）与 `:1879-1888`（activity）改为写入 `previewStateBySessionAtom` **并触发 preview 面板打开（同 Step 1 触发型策略：已存在则聚焦，满 3 替换最旧 + toast）**；删除 `MarkdownOverlayState`/`OverlayState` 与渲染分支（:2004-2098）

- [x] **Step 3: App.tsx 文件预览 → PreviewPanel**

`linkInterceptor.previewState`（App.tsx:2160）改为：打开文件时写入当前会话的 preview 状态并 push preview 面板（无会话时 fallback：现有全局 overlay 保留一次或打开无绑定 preview 面板——执行时定，倾向保留 fallback 分支）；`FilePreviewRenderer` 抽为共享组件供 PreviewPanel 复用

- [x] **Step 4: 删除死代码**

ChatDisplay 中 overlay 相关 imports（`CodePreviewOverlay` 等仅 overlay 用到的引用清理）、App.tsx 中不再使用的 overlay 分支；`npm` 级 lint 清理

### Task 11: 面板 → overlay 全屏展开

**Files:** `apps/electron/src/renderer/atoms/overlay.ts`（新增）、`apps/electron/src/renderer/components/app-shell/PanelHeader.tsx`（或 content-panels 共享 header）、`apps/electron/src/renderer/App.tsx`

- [x] **Step 1: overlay 状态**

`atoms/overlay.ts`：`expandedPanelIdAtom`（记录展开的面板 id，同一实例不重渲染——内容组件仍挂面板 DOM，overlay 容器通过 portal 渲染同一组件树）

- [x] **Step 2: 面板 header 展开按钮**

各 content-panel 与 ChatPage 面板 header 增加展开按钮（icon `Maximize2`）；点击 → `setExpandedPanelId`；overlay 容器（复用现有 `PreviewOverlay` 容器或 `Dialog`）全屏渲染该面板内容；Esc/关闭按钮还原并聚焦原面板。
**实现约束（防双实例）**：展开时面板槽位 `display:none`（不卸载，保住 DOM 状态）；面板内本地 UI 状态（选中 diff、滚动位置等）展开前后一致性通过**提升到全局 atoms** 保证（ReviewPanel 的选中项、PreviewPanel 的当前条目等随 Task 6/9 一并放入 atoms）

- [x] **Step 3: overlay 容器接入**

App.tsx 挂载 `ExpandedPanelOverlay`（portal），内容 = 由 `expandedPanelIdAtom` 定位的面板组件实例（通过现有 panelStack 渲染分支复用，保证同一组件实例）

### Task 12: 交互细节（opencode 借鉴 + 打磨）

**Files:** `apps/electron/src/renderer/components/content-panels/`、`apps/electron/src/renderer/lib/`、locale 文件

- [x] **Step 1: resize 首帧防抖**

翻译 opencode `session-panel-width.ts` 的"首帧防抖"（resize 时 rAF 合并写 proportion），接入 `PanelResizeSash` 的 mousemove 处理（`PanelResizeSash.tsx:69-93`）；clamp 逻辑已有（PANEL_MIN_WIDTH），不硬搬 px 体系

- [x] **Step 2: 面板打开默认比例**

新面板打开时默认 proportion（如 0.35），复用 `pushPanelAtom` 的 normalize（`panel-stack.ts:98`）

- [x] **Step 3: 面板 header 统一**

content-panels 共享 header 组件：标题 + 绑定会话指示（会话名 chip）+ 关闭按钮 + 展开按钮（Task 11）；沿用现有 `PanelHeader` 样式

- [x] **Step 4: 焦点管理**

面板打开/聚焦时 `useFocusZone` 圈定（复用现有 `hooks/keyboard/useFocusZone.ts`）；`inert` 折叠语义：面板关闭即卸载（现有行为），后台面板不渲染

- [x] **Step 5: 动画与 motion-reduce**

面板切换/打开轻量 motion 过渡（AnimatePresence，现有模式）；`prefers-reduced-motion` 降级（项目现有 `motion` 用法对齐）

- [x] **Step 6: i18n**

新增文案全部入 **`packages/shared/src/i18n/locales/`**（en/zh-Hans/de/ja/pl/es/hu 共 7 个，key 遵循 `contentPanel.*`/`panel.*` 命名），通过 `bun run lint:i18n:parity`、`lint:i18n:sorted`、`lint:i18n:coverage` 校验

### Task 13: Kanban/Calendar 窄面板适配验证

**Files:** `apps/electron/src/renderer/components/app-shell/kanban/KanbanBoardContainer.tsx`（如有需要）

- [x] **Step 1: 验证**

将 `board`、`calendar` push 为面板（Task 1 已支持），在 ~440px 宽下人工验证 KanbanBoard/CalendarView 渲染（列横向滚动/压缩）；若不可用，做最小适配（容器 overflow-x-auto）

- [x] **Step 2: 记录结论**

无论适配与否，在代码注释/本计划追加验证结论（决定是否保留看板/日历平铺按钮）

### Task 14: 验证与回归

**Files:** 全部涉及文件

- [x] **Step 1: 静态检查**

`bun run typecheck:electron`、`bun run lint:electron`、`bun run typecheck:ui`（packages/ui 若改动则一并）、`bun run lint:ui`

- [x] **Step 2: 单元测试**

`bun test`（现有 `atoms/__tests__/*` 含新增测试全部通过；`panel-stack-lanes.test.ts` 等回归）

- [x] **Step 3: i18n 校验**

`bun run lint:i18n:parity`、`bun run lint:i18n:sorted`、`bun run lint:i18n:coverage`

- [x] **Step 4: 手动场景清单（electron:dev）**

- 顶栏平铺按钮三态（未开/前台/后台圆点）
- 会话 + 看板 + 日历同时并列（三个面板）
- 打开第 4 个 → LRU 挤旧入后台；后台按钮点击唤出；刷新后前台/后台都恢复
- **历史穿越一致性**：开 4 面板挤 1 入后台后按 Back 回到 4 面板历史 → 无"面板既在前台又在后台"重复（Task 5 Step 3 去重）
- **工作区切换**：切工作区 → 后台集随工作区隔离切换（Task 5 Step 2）
- **被动触发满员**：3 个前台时点消息里的 diff/展开 → 替换最旧 + toast，不挤走当前聚焦会话
- Review 面板跟随活跃会话（切会话内容更新；Review 自身聚焦不闪）
- **ReviewPanel 消息异步加载**：未加载完显示占位，不误报"无变更"
- Preview 面板：打开文件 / turn pop-out / activity 展开不再弹 overlay
- diff 点击定位（focusedChangeId 滚动）
- 面板展开 overlay 全屏 + Esc 还原
- 快捷键直达各面板（`panel.focusNext`/`panel.focusPrev` 复用验证）
- 后台化会话完成任务出 chip；新建空会话后台化不被误删
- 浏览器按钮行为与现状一致
- motion-reduce 下动画降级

---

## 验证命令汇总

```bash
bun run typecheck:electron
bun run lint:electron
bun test   # 至少 atoms/__tests__ 相关
bun run lint:i18n:parity && bun run lint:i18n:sorted && bun run lint:i18n:coverage
bun run electron:dev   # 手动场景清单（Task 14 Step 4）
```

### Task 13 验证结论（2026-08-10 实施时记录）

- **Kanban（board）**：列容器原为 `flex min-w-0 flex-1`，窄面板（~440px）下列会被压碎。
  已做最小适配：列 `min-w-[260px]` + 面板根容器 `overflow-x-auto`——窄面板下整板横向滚动，全宽下列仍弹性伸展；DragOverlay 为 fixed 定位，不受 overflow 裁剪。
- **Calendar（calendar）**：7 列 `minmax(0,1fr)` 网格自适应压缩，单元格内容 truncate + `+N` 溢出指示，440px 下可用，无需适配。
- **结论**：保留看板/日历平铺按钮（决策 #9 维持）。

## 风险与对策

| 风险 | 对策 |
|---|---|
| ChatDisplay 2390 行，overlay 收敛改动面大 | 分步：先加面板渲染分支（不删 overlay），行为等价后删死代码；Task 10 Step 1-3 各自独立可回退 |
| 后台化改变"会话可见性"语义，影响通知/清理 | Task 5 Step 4-5 明确语义：前台 chip 判定不变，仅空会话清理纳入后台集 |
| back/forward 历史穿越与后台集失步（面板重复） | Task 5 Step 3：reconcile 时前台/后台去重合并 |
| 工作区切换后后台集错位 | Task 5 Step 2：恢复挂到 NavigationContext 工作区切换机制（:322 已有 per-workspace URL 恢复） |
| Kanban/日历窄面板不可用 | Task 13 验证并最小适配；失败则从平铺按钮暂移除（决策记录在案） |
| 绑定面板在无活跃会话时（无任何会话面板） | 空状态引导（"打开一个会话"），不崩溃 |
| `linkInterceptor.previewState` 是全局状态，per-session 化可能破坏链接拦截 | Task 10 Step 3 保留 fallback 分支（无会话时维持全局 overlay） |
| URL `?panels` 编码兼容旧格式 | 前台栈编码不变；仅新增 route 字符串，旧会话 route 不受影响 |
| 绑定面板 route 刷新后解析失败渲染错内容 | Task 1 Step 5：PanelSlot 按 panelType 分流 + 非法 route 空态兜底 |

## 交付物清单

- 新增：`atoms/active-session.ts`、`atoms/hidden-panels.ts`、`atoms/preview.ts`、`atoms/overlay.ts`（与既有 `fullscreenOverlayOpenAtom` 合并）、`atoms/content-panel-ui.ts`、`lib/diff-kinds.ts`、`lib/workbench-panels.ts`、`lib/panel-triggers.ts`、`lib/use-session-activities.ts`、`lib/use-diff-viewer-settings.ts`、`components/content-panels/`（ReviewPanel/FilesPanel/ContextPanel/PreviewPanel/FilePreviewContent/BoundSessionBadge/PanelEmptyState/bound-panel-content）、`components/app-shell/WorkbenchPanelButtons.tsx`、`components/app-shell/ExpandedPanelOverlay.tsx`、`atoms/__tests__/`（active-session/hidden-panels/panel-stack-content-types）
- 修改：`panel-stack.ts`、`routes.ts`、`route-parser.ts`、`TopBar.tsx`、`AppShell.tsx`、`NavigationContext.tsx`、`PanelSlot.tsx`、`PanelResizeSash.tsx`、`PanelHeader.tsx`、`ChatDisplay.tsx`、`App.tsx`、`AppShellContext.tsx`、`SessionFilesSection.tsx`、`actions/definitions.ts`、`packages/ui`（computeChangeStats/createFileSections 导出）、locale 文件（7 语言，共 1751 key）
- 借鉴（翻译）：opencode `review-diff-kinds.ts`、`session-panel-width.ts`（防抖部分）、`session-side-panel.tsx`/`review-panel-v2.tsx`（UI 结构，间接：tabs/空状态结构）

---

## 实施增量修订记录（与计划正文的差异及决策）

| # | 位置 | 差异 | 决策 / 理由 |
|---|---|---|---|
| R1 | Task 1 Step 3 | `parseRouteToNavigationState` 对绑定 route 返回 `{ navigator: 'other', panel: BoundPanelType }`（比计划的 `{navigator:'other',...}` 多一个 `panel` 字段） | 无 `panel` 字段无法经 `buildRouteFromNavigationState` 无损回写 route（round-trip 需要子类型）；`types.ts` 新增 `OtherNavigationState` + `isOtherNavigation`，`getNavigationStateKey` 补分支 |
| R2 | Task 1 Step 5 | PanelSlot 分流经 `content-panels/bound-panel-content.tsx` 中央分发器（计划允许"统一落点"） | Tasks 6-9 各分支均落在同一分发器，而非散落 PanelSlot；非法 route 空态兜底在分发器内 |
| R3 | Task 2 | `activeSessionIdAtom = focused ?? last`；`lastActiveSessionIdAtom` 由 NavigationContext 的 focusedPanelIdAtom 订阅写入 | 与计划一致；测试通过直接写 `lastActiveSessionIdAtom` 模拟 effect 行为 |
| R4 | Task 5 | `MAX_FOREGROUND_PANELS` 定义在 `panel-stack.ts`（hidden-panels 引用）而非 hidden-panels 内 | 避免循环依赖（panel-stack 不能依赖 hidden-panels）；`pushPanelAtom` 超限仅 console.warn（dev 断言，不硬阻断，Cmd+T 多会话并列仍可用） |
| R5 | Task 5 | 隐藏集额外持久化 `proportion`，唤出时按原比例恢复（计划只要求 route+panelType） | 恢复后比例不回跳 0（0 会导致新面板贴最小宽）；旧持久化数据缺字段时回退 `DEFAULT_PANEL_PROPORTION` |
| R6 | Task 6 | `computeChangeStats`/`createFileSections`/`FileSection` 从 `packages/ui` 导出复用（计划"复用逻辑"） | 直接导出避免复制 diff 计算；`packages/ui` 改 3 文件（组件 + 2 个 barrel） |
| R7 | Task 9 | PreviewPanel 中 json 文件以语法高亮代码渲染（ShikiCodeViewer）而非 JSONPreviewOverlay 树视图 | 嵌入式 JSON 树视图自带 overlay header 与面板 header 重复；json 仍走 classifyFile 的 json 分类，可读性等价 |
| R8 | Task 10 | activity overlay（Bash/MCP 卡片）收敛为 preview 面板的 markdown 条目，内容用 `formatActivityAsMarkdown` | 计划 Step 2 明确要求 activity 收敛；卡片式 ActivityCardsOverlay 随 overlay 删除（决策 #8 "弹层消亡"） |
| R9 | Task 10 | App.tsx 文件预览：有活跃会话 → preview 面板；无活跃会话 → 保留全局 overlay fallback | 按计划"倾向保留 fallback 分支"执行；打开的文件归入"活跃会话"的 preview 栈（链接拦截器无会话上下文，已知限制） |
| R10 | Task 11 | `atoms/overlay.ts` 已存在（`fullscreenOverlayOpenAtom`，workspace 创建用）→ 合并新增 `expandedPanelIdAtom` | 未覆盖既有导出 |
| R11 | Task 11 | 展开按钮经 AppShellContext `expandButton` 槽 + PanelHeader 上下文回退注入所有面板 header（含 ChatPage）；`rightSidebarButton` 同样改为上下文回退 | 修复内容面板此前无关闭按钮的问题（PanelHeader 只读 prop）；单一落点，各面板零改动 |
| R12 | Task 12 Step 4 | 焦点管理：绑定面板不注册 useFocusZone 区域 | 多个同类型面板并存时 zone id 冲突（FocusContext 按 id 注册）；点击聚焦已由 PanelSlot pointerdown 覆盖，验证无回归 |
| R13 | Task 12 Step 4 | 面板打开动画：绑定面板内容 opacity 淡入（0.15s），`prefers-reduced-motion` 直接渲染 | 不动 flex 布局（避免打开时布局跳动）；会话面板沿用既有行为 |
| R14 | 前置修复 | 分支上既有 `lint:electron` 10 个 error（kanban shadow 类 / ProjectInfoPage 直连 openFile / playground 无效 disable） | 审计命令要求 lint:electron 通过，逐项修复（shadow-tinted/outline/shadow-minimal 等），0 error |
| R15 | Task 4 | `panel.toggle` 语义：关闭当前聚焦的绑定面板，否则重开最近使用的绑定面板 | 计划对 panel.toggle 语义未细化，取此最小可用语义并在 definitions 注释说明 |
| R16 | 全流程 | 全部新文案在引入时就写入 7 语言 locale（不等到 Task 12） | 保持 parity/sorted/coverage 三检全程绿；Task 12 复核通过 |

> 注：`lint:electron` 与 `lint:ui` 尚有若干既有 warning（exhaustive-deps / no-localstorage——后者为计划指定的 localStorage 持久化方案，与既有 `workspaceUrl` 同模式；`packages/ui` 的 eslint 在本机 typescript-estree 加载失败，`bun run lint:ui` 不可用，属环境问题，未改动 ui lint 配置）。
