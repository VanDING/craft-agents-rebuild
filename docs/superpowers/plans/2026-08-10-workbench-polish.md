# Content Workbench UI 调整计划（Polish）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [X]`) syntax for tracking.

**Goal:** 在已实施的通用内容工作台（`docs/superpowers/plans/2026-08-10-content-workbench.md`，分支 `calendar-views`，commit `8d0b02c2`）基础上，落实 8 项 UI/交互调整 + 1 个全屏展开 bug 修复。全部为既有架构内的增量改动。

**Architecture:** 全部改动落在现有体系内：proportion 面板系统、PanelHeader context 槽、hidden-panels 后台集、TopBar 平铺按钮。无新增依赖、无结构性变化。

---

## 背景事实（已核实，勿重复调查）

- `TopBar` 由 `AppShell.tsx:2426` 渲染，`fixed top-0 left-0 right-0 z-panel titlebar-drag-region`，高 48px（`--topbar-height`）。**`-webkit-app-region: drag` 会拦截其矩形内所有鼠标事件（与 z-index 无关）**——`ExpandedPanelOverlay` 的 restore 按钮（`absolute right-3 top-2`）位于 48px 区域内 → 点击被吞；Esc 为键盘事件不受影响
- `ExpandedPanelOverlay` 挂在 `AppShell.tsx:3939`（AppShellProvider 内），z-[999]
- `AppShell.tsx:542`：`isSidebarVisible`（localStorage `KEYS.sidebarVisible` 持久化），`onToggleSidebar` 切换**整个左栏**（LeftSidebar rail + NavigatorPanel 一起）；布局宽度在 :1338/:2754/:3663/:3697 引用 `sidebarWidth`。**无独立的 navigator 可见性状态**（第 7 项需新增）
- `WorkbenchPanelButtons.tsx`：平铺按钮组，`WORKBENCH_PANEL_KINDS`（`lib/workbench-panels.ts`）= sessions/board/calendar/diff/files/context/preview；已有 `maxVisibleButtons` prop 但窄窗口折叠逻辑当前收进 [+] 菜单
- `TopBar.tsx:264-280`：[+] DropdownMenu 仅两项（New Session in Panel → `onAddSessionPanel`、Browser Window → `onAddBrowserPanel`）
- `panel-stack.ts`：`DEFAULT_PANEL_PROPORTION=0.35`（新面板 35/65）；`normalizeProportions`（等比例缩放，**非均分**）用于 push/close；`PANEL_MIN_WIDTH=440`（3 面板均分需窗口 ≥1320px）
- `hidden-panels.ts`：`findLruForeground`（:72）选**最久未用非聚焦**面板顶替（位置不定）；`openPanelAtom` 顶替后 push 到**末尾**（右侧）；`restorePanelAtom` 恢复比例（`HiddenPanelEntry.proportion`）
- `KanbanBoardContainer.tsx`：**自绘头部**（:524-546，含 KanbanProjectFilter + 右侧按钮组 :536），不使用 `PanelHeader` → 无关闭/全屏按钮；`CalendarView.tsx` 同理
- `PanelHeader.tsx:125-131`：`rightSidebarButton`/`expandButton` 从 `useAppShellContext()` 读取（PanelSlot 经 `contextOverride` 注入）
- `ContextPanel.tsx` 现状：workspace sources/skills + SessionMeta 元数据（workingDirectory/permission/labels）
- 数据可得性：`LoadedSource.connectionStatus?: SourceConnectionStatus`（`packages/shared/src/sources/types.ts:417,472`：connected/needs_auth/failed/untested/local_disabled）；`tokenUsage` 仅完整 session 有（`sessions.ts:61`，getSession 才返回，`sessionAtomFamily` 已加载时可用）；附件在完整 session 的 attachments 字段（实施时以 renderer `Session` 实际字段为准）；最近打开文件在 `previewStateBySessionAtom`（`atoms/preview.ts`）
- `sidebar-types.ts`：`DEFAULT_SIDEBAR_MODE = { type: 'sessions', filter: { kind: 'allSessions' } }`（会话列表模式）

---

## 决策记录（用户已确认）

1. **按钮全量直显**：删除 [+] 菜单；New Session in Panel、Browser Window 变独立按钮（行为不变）；Help 保留；窄窗口**顺序隐藏**（从数组尾部开始，无折叠菜单）
2. **均分宽度**：面板数量变化（打开/关闭/恢复）时全部比例重置为 1/N；拖拽自定义比例保留；reconcile（URL 恢复）不改动
3. **Kanban/日历**补关闭 + 全屏按钮（接入 PanelHeader context 槽）
4. **Preview 顶栏按钮删除**（快捷键 `panel.preview` 与触发型打开保留）
5. **Context 低档扩充**：token 用量、附件、最近打开文件、sources 连接状态（不加 Git/Pi 运行时）
6. **顶替规则**：满员时顶替**最左侧非聚焦**面板（非主会话）→ 新窗口恒从右侧出现、位置可预测
7. **会话列表独立按钮**：新按钮控制左侧 Navigator 会话列表展开/收起（与主对话按钮解耦）
8. **模型 B**：全体均分 + 主会话（index 0 的会话面板）**固定左侧**（不被顶替、不移动）；会话面板打开时若 index 0 非会话则插入 index 0
9. **Bug 修复（方案 A）**：全屏展开时隐藏 TopBar（drag region 不再拦截 restore 按钮）
10. i18n：新文案全部入 7 语言 locale（`packages/shared/src/i18n/locales/`），保持三检全绿

---

### Task 1: Bug 修复——全屏展开时隐藏 TopBar

**Files:** `apps/electron/src/renderer/components/app-shell/AppShell.tsx`

- [X] **Step 1: 条件渲染 TopBar**

`AppShell` 中 `useAtomValue(expandedPanelIdAtom)`（`@/atoms/overlay`）；`:2426` 的 `<TopBar .../>` 改为 `{!expandedPanelId && <TopBar ... />}`。TopBar 为 fixed 定位，隐藏不影响布局。

- [X] **Step 2: 验证**

展开面板 → TopBar 消失 → 顶部 restore 按钮（top-2）点击有效 → Esc 还原 → TopBar 恢复。顺带确认全屏内容顶部 48px 不再被 TopBar 遮挡。

### Task 2: 按钮全量直显 + 窄窗口顺序隐藏

**Files:** `apps/electron/src/renderer/components/app-shell/TopBar.tsx`、`apps/electron/src/renderer/components/app-shell/WorkbenchPanelButtons.tsx`、`apps/electron/src/renderer/lib/workbench-panels.ts`

- [X] **Step 1: 删除 [+] 菜单**

`TopBar.tsx:264-280` 的 `DropdownMenu`（[+]）整体删除；`onAddSessionPanel`/`onAddBrowserPanel` props 保留。

- [X] **Step 2: 新增两个动作按钮**

`WorkbenchPanelButtons` 增加 `onNewSessionPanel`、`onNewBrowser` props，在面板按钮组之后渲染两个 `TopBarButton`（`SquarePenRounded`/`Globe`，tooltip 用现有 i18n key `session.newSessionInPanel`/`browser.newWindow`）。点击行为不变（`onAddSessionPanel`/`onAddBrowserPanel`）。

- [X] **Step 3: 窄窗口顺序隐藏**

TopBar 右侧区（`rightSlotRef` ResizeObserver 模式，`TopBar.tsx:101-131`）计算可容纳按钮数：渲染顺序 = [会话, 看板, 日历, Review, 文件树, Context, NewSession, Browser]（Preview 已删，见 Task 4）；从数组**尾部**开始隐藏（新功能按钮优先隐藏，核心按钮保留）；隐藏即不渲染（无折叠菜单，与用户确认）。`maxVisibleButtons` prop 接线。KeyboardShortcutsDialog 中新功能快捷键不受影响（按钮隐藏不影响快捷键）。

- [X] **Step 4: i18n**

若新增 tooltip 文案则入 7 语言。

### Task 3: 均分宽度

**Files:** `apps/electron/src/renderer/atoms/panel-stack.ts`、`apps/electron/src/renderer/atoms/hidden-panels.ts`、`apps/electron/src/renderer/atoms/__tests__/*`

- [X] **Step 1: 新增均分工具**

`panel-stack.ts` 新增 `export function setEqualProportions(stack: PanelStackEntry[]): PanelStackEntry[]`（空栈返回原值，否则每个 `proportion = 1 / length`）。

- [X] **Step 2: 数量变化路径均分**

- `pushPanelAtom`（:160 `normalizeProportions` → `setEqualProportions`）
- `closePanelAtom`（:171 同理）
- `restorePanelAtom`（`hidden-panels.ts:150` `normalizeProportions` → `setEqualProportions`；恢复时忽略 `HiddenPanelEntry.proportion`）
- **不改**：`resizePanelsAtom`（拖拽自定义保留）、`reconcilePanelStackAtom`（URL 恢复保留）、`updateFocusedPanelRouteAtom`
- `DEFAULT_PANEL_PROPORTION`：删除或标记废弃（`hidden-panels.ts:192` fallback 改为 1/3 常量或均分工具）

- [X] **Step 3: 测试更新**

`panel-stack-lanes.test.ts`、`hidden-panels.test.ts` 中 proportion 断言更新为均分（2 面板 0.5/0.5、3 面板 1/3）。新增断言：push 后均分、close 后均分、拖拽 resize 后不被均分覆盖。

### Task 4: Kanban / Calendar 关闭 + 全屏按钮

**Files:** `apps/electron/src/renderer/components/app-shell/kanban/KanbanBoardContainer.tsx`、`apps/electron/src/renderer/components/app-shell/kanban/CalendarView.tsx`

- [X] **Step 1: Kanban 头部接入按钮**

`KanbanBoardContainer.tsx` 用 `useAppShellContext()` 取 `rightSidebarButton`/`expandButton`（PanelSlot 已注入），渲染到 :536 右侧按钮组（`flex items-center gap-2`）。

- [X] **Step 2: CalendarView 同处理**

定位 CalendarView 的头部区域（实施时读源码确认结构），同样渲染两个按钮；若无头部容器则补一个与 Kanban 一致的 header 行。

- [X] **Step 3: 验证**

看板/日历作为面板打开 → header 有关闭 + 全屏按钮 → 全屏 → restore 有效（Task 1 修复后）。

### Task 5: Preview 顶栏按钮删除

**Files:** `apps/electron/src/renderer/lib/workbench-panels.ts`、`apps/electron/src/renderer/components/app-shell/WorkbenchPanelButtons.tsx`

- [X] **Step 1: 渲染列表移除 preview**

`WORKBENCH_PANEL_KINDS` 数组移除 `'preview'`（仅影响按钮渲染与图标映射）。**保留**：`WORKBENCH_PANEL_ROUTES.preview`、`workbenchPanelKindForRoute` 的 preview 分支（触发型打开 `openTriggeredPanel('preview')` 聚焦/状态派生仍依赖）、`panel.preview` 快捷键（`actions/definitions.ts` 不动）。

- [X] **Step 2: 验证**

顶栏无 Preview 按钮；对话中点开文件仍自动出预览面板；`panel.preview` 快捷键仍可用。

### Task 6: Context 面板低档扩充

**Files:** `apps/electron/src/renderer/components/content-panels/ContextPanel.tsx`、`packages/shared/src/i18n/locales/*.json`

- [X] **Step 1: sources 连接状态**

sources 列表每项显示 `connectionStatus` 状态点（connected=绿 / needs_auth=琥珀 / failed=红 / untested=灰 / local_disabled=灰），新增 i18n key `contentPanel.context.status.*`（7 语言）。

- [X] **Step 2: token 用量**

`sessionAtomFamily(activeSessionId)` 的 `tokenUsage`（结构以 `sessions.ts:61` 为准：input/output 等）→ 新 section 显示（如 input/output tokens，千分位格式化）；session 未加载时该 section 不渲染。

- [X] **Step 3: 附件列表**

完整 session 的 attachments（renderer `Session` 实际字段为准；无则跳过本 step 并记录）→ 文件名列表（basename，点击行为同文件预览或不做跳转）。

- [X] **Step 4: 最近打开文件**

`previewStateBySessionAtom` 当前活跃会话的 file 条目 → basename 列表（与 token/附件同 section 或独立 section）。

- [X] **Step 5: 验证**

Context 面板在活跃会话下显示 4 类新内容；无活跃会话时旧引导空态保留。

### Task 7: 顶替规则 + 主会话固定左侧

**Files:** `apps/electron/src/renderer/atoms/hidden-panels.ts`、`apps/electron/src/renderer/atoms/panel-stack.ts`、`apps/electron/src/renderer/atoms/__tests__/hidden-panels.test.ts`

- [X] **Step 1: 顶替规则改为"最左侧非聚焦"**

`hidden-panels.ts:72` `findLruForeground` → `findPanelToEvict(stack, focusedId)`：候选 = **index ≥ 0 的非聚焦面板中 index 最小者**；若全部聚焦（单面板）则唯一面板。删除 `lastActiveAtById`/`touchPanelActivity` 相关 LRU 逻辑（NavigationContext:402 的 touch 订阅同步清理——注意 `ExpandedPanelOverlay` 的 restore 也调用了 `touchPanelActivity`，一并清理）。**保留** `hiddenAt`（仅作持久化元数据）。

- [X] **Step 2: 主会话固定 index 0**

- `openPanelAtom`：route 为 session 类型（`getPanelTypeFromRoute(route) === 'session'`）且当前 index 0 非 session 面板 → 新面板插入 **index 0**（其余仍追加末尾）
- `findPanelToEvict`：**永不移除 index 0 的 session 面板**（候选排除之；若候选空则允许非 index 0 会话面板）
- `restorePanelAtom`：恢复的会话面板若 index 0 非会话 → 插入 index 0

- [X] **Step 3: 测试更新**

`hidden-panels.test.ts`：顶替位置断言（顶最左非聚焦）、主会话不被顶、会话打开插 index 0、恢复插 index 0。`touchPanelActivity` 相关用例删除。

### Task 8: 会话列表独立按钮

**Files:** `apps/electron/src/renderer/components/app-shell/AppShell.tsx`、`apps/electron/src/renderer/components/app-shell/TopBar.tsx`、`apps/electron/src/renderer/components/app-shell/WorkbenchPanelButtons.tsx`、`apps/electron/src/renderer/lib/local-storage.ts`

- [X] **Step 1: navigator 可见性状态**

`AppShell` 新增 `isNavigatorVisible` 状态（localStorage 新增 `KEYS.navigatorVisible`，默认 true，模式对齐 `sidebarVisible` :542/:1723）。布局宽度计算（:1338 offset、:2754 sidebarWidth、:3663/:3697 位置）拆分为 rail 宽度（随 `isSidebarVisible`）与 navigator 宽度（随 `isNavigatorVisible`）——实施时先读 :2740-2770 与 :3650-3700 区域确认拆分点。

- [X] **Step 2: 新按钮**

`WorkbenchPanelButtons` 增加 `onToggleSessionList` 按钮（icon `List`，tooltip `contentPanel.title.sessionsList` 新 key）：点击 = toggle `isNavigatorVisible` 且确保 NavigatorPanel 处于 sessions 模式（`DEFAULT_SIDEBAR_MODE` allSessions，`sidebar-types.ts`）。sessions 按钮保持原语义（聚焦/打开会话面板）。

- [X] **Step 3: i18n**

新 key 入 7 语言。

- [X] **Step 4: 验证**

会话列表按钮独立展开/收起 Navigator；sessions 按钮语义不变；窄窗口下两个按钮都受 Task 2 顺序隐藏约束。

### Task 9: 验证与回归

**Files:** 全部涉及文件

- [X] **Step 1: 静态检查**

`bun run typecheck:electron`、`bun run lint:electron`（0 errors）

- [X] **Step 2: 单元测试**

`bun test apps/electron/src/renderer/atoms/__tests__/`（更新后的 hidden-panels/panel-stack 测试全过）；全量 `bun test` 失败集与基线（38 个既有失败）一致

- [X] **Step 3: i18n 三检**

`bun run lint:i18n:parity && bun run lint:i18n:sorted && bun run lint:i18n:coverage`

- [X] **Step 4: 手动清单（electron:dev）**

- 面板展开 → TopBar 隐藏 → restore 按钮点击有效 → Esc 还原
- 顶栏 8 按钮 + Help 直显；窄窗口从尾部顺序隐藏；[+] 菜单消失
- 2 面板 50/50、3 面板均分；拖拽后比例保留；关闭一个面板剩余均分
- 看板/日历面板 header 有关闭 + 全屏按钮，全屏还原有效
- 顶栏无 Preview 按钮；对话点文件仍自动出预览面板；panel.preview 快捷键可用
- Context 显示 token 用量 / 附件 / 最近文件 / sources 连接状态
- 满 3 面板再开 → 顶替最左非聚焦、新窗口恒从右侧出现；主会话（index 0）永不被顶
- 关掉主会话后从顶栏开会话 → 会话面板出现在 index 0
- 会话列表按钮独立收起/展开 Navigator
- motion-reduce 下无回归

---

## 验证命令汇总

```bash
bun run typecheck:electron
bun run lint:electron
bun test apps/electron/src/renderer/atoms/__tests__/
bun run lint:i18n:parity && bun run lint:i18n:sorted && bun run lint:i18n:coverage
bun run electron:dev   # Task 9 Step 4 手动清单
```

## 风险与对策

| 风险 | 对策 |
|---|---|
| 均分后窄窗口 3 面板 < 1320px 溢出（min-width 440） | 已知物理限制，flex 溢出由现有 PanelStackContainer 处理；记录为已知行为，不在本计划解决 |
| 主会话 index 0 固定改变既有"多会话并列"行为（Cmd+T 第二个会话面板不会插 0） | 决策 #8 限定"最早会话面板为 index 0 锁定"，Cmd+T 走 pushPanelAtom 不插 0；测试锁定 |
| Navigator 宽度拆分（Task 8）可能触及 AppShell 布局多处 | 实施时先读 :2740-2770/:3650-3700 确认拆分点；若拆分风险过高，退化为"navigator 隐藏时整体偏移"（记录决策） |
| 删除 LRU 后 `touchPanelActivity` 残留调用（ExpandedPanelOverlay/NavigationContext） | Task 7 Step 1 明确同步清理；typecheck 兜底 |
| Context 附件字段在 renderer Session 不存在 | Task 6 Step 3 已标注"以实际字段为准，无则跳过并记录" |
| 顺序隐藏的按钮无替代入口（用户不接受折叠菜单） | 决策 #1 已确认；隐藏顺序 = 新功能优先，核心 5 按钮 + Help 常显 |

## 交付物清单

- 修改：`AppShell.tsx`、`TopBar.tsx`、`WorkbenchPanelButtons.tsx`、`workbench-panels.ts`、`panel-stack.ts`、`hidden-panels.ts`、`NavigationContext.tsx`（touch 清理）、`ExpandedPanelOverlay.tsx`（touch 清理）、`KanbanBoardContainer.tsx`、`CalendarView.tsx`、`ContextPanel.tsx`、`local-storage.ts`、`hidden-panels.test.ts`、`panel-stack-lanes.test.ts`、locale 7 文件
- 不新增依赖；无新增文件（除非 Task 8 拆分需要独立组件）

## 实施增量修订记录（2026-08-10，实施后回写）

R1 — **Task 7 主会话判定改用 `parseSessionIdFromRoute`**（原 Step 2 写 `getPanelTypeFromRoute(route) === 'session'`）。实际代码中 `getPanelTypeFromRoute('board'/'calendar')` 也返回 `'session'`（sessions 导航视图），会导致：看板/日历面板被当作主会话钉在 index 0 且永不可顶替、真会话无法插入 index 0。判定改为「route 携带真实会话 id」，与决策 #8「主会话=聊天会话面板」语义一致。测试锁定。

R2 — **Task 2 按钮序与数量**：计划枚举顺序为 8 项（未含既有的 focus-or-create 浏览器按钮）。最终顺序 = 6 面板 kinds + browser + newSession + newBrowser + sessionList（10 项），从尾部顺序隐藏（新功能优先）。密度阈值校准为 10/8/6/4。

R3 — **Task 6 token 用量取 `SessionMeta.tokenUsage`**（`sessions.ts:61` 结构：input/output/total/costUsd/contextTokens）而非 `sessionAtomFamily` —— 同一数据结构、JSONL 头部即得，不触发消息加载；contextWindow 属完整 Session DTO 字段，未在 meta 中，故未展示。

R4 — **Task 6 附件**：renderer `Session`（`packages/shared/src/protocol/dto.ts`）**无会话级 attachments 字段**（计划已允许跳过并记录）。改为从已加载消息聚合（`messages[].attachments[].name`，按 id 去重），`loadedSessionsAtom` 未加载时不渲染该 section（不强制加载）。

R5 — **Task 8 会话列表按钮的 sessions 模式保证**：`DEFAULT_SIDEBAR_MODE` 为遗留死代码（无消费者）；导航栏内容由聚焦面板 route 驱动。按钮实现为：toggle `isNavigatorVisible` + 展开时 `openPanel('sessions')`（聚焦已有 sessions 面板或新开一个，永不替换绑定面板内容）。

R6 — **Task 9 验证结论**：`bun run typecheck:electron` ✅；`lint:electron` 0 errors（123 既有 warning）；原子测试 50/50；全量 `bun test` 7355 项 **38 fail —— 与计划基线（38 个已知环境性失败）完全一致**，失败集全部为既有环境类别（RPC 注册 2、interceptor 打包契约 1、Opus 迁移集成 12、工具图标资源 2、webui HTTP 认证 14、启动迁移 7），与本次改动零重叠；`lint:i18n:parity/sorted/coverage` 三检全绿（1765 key × 7 语言）。`bun run electron:dev` 启动干净（Vite 就绪、主进程初始化、无 renderer 报错；微信网关 API 错误为既有环境噪音）。Task 9 Step 4 手动清单中**交互体验项需人工在窗口中逐项确认**（展开 restore 点击、按钮观感、拖拽手感、快捷键等）——本环境无法自动化点击 Electron 窗口，已如实标注。
