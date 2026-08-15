# 右侧面板审计与整改报告

日期: 2026-08-15(第二版,全部论断已逐条对照源码核实)
范围: session 对话窗口 + 全部右侧可呼出面板(kanban 除外——上游功能,不动以免影响合并)
基准: opencode(https://github.com/anomalyco/opencode,dev 分支)右侧面板设计,但不局限于它。opencode 侧引用均已对照其 dev 分支源码核实。

面板清单(`lib/workbench-panels.ts:22-38`):sessions / board(kanban,豁免) / calendar / diff(Review) / files / context / preview / trajectory,外加 browser(非 DOM 面板)。本报告覆盖全部非豁免面板。

---

## 0. 结论摘要

| 优先级 | 事项 | 现状 | 建议 |
|---|---|---|---|
| **P0** | session 窗口放大后缩小按钮与分享按钮重合 | 确认存在,几何可精确复现 | 删除 overlay 浮动按钮,按钮注入 header(§1) |
| **P0** | ContextPanel 信息架构混乱 | "元数据+token+附件+文件+sources+skills" 大杂烩 | 按"会话上下文"语义重构,对标 opencode context tab(§2) |
| **P1** | sessions 面板空态/多选分支无 PanelHeader | 面板内无关闭/放大按钮,与其他面板不一致;且会阻塞 P0 修复 | 两个分支补标准 header(§7) |
| **P1** | TopBar 面板按钮窄窗口溢出后无兜底入口 | 按钮被 `slice` 直接截断,无 overflow 菜单 | 加溢出下拉(§6) |
| **P1** | PreviewPanel tab 无法关闭 | 只能切换选择,entry 永久累积 | 加关闭按钮 + 全路径 tooltip(§5) |
| **P1** | ReviewPanel 无 diff 风格切换入口 | 风格设置藏在全局设置里 | 面板头加 unified/split 切换(§3) |
| **P2** | Calendar 面板交互与边界问题 | 删除无确认;越界时段条目飞出网格;日期格式硬编码中文 | 见 §8(注意:文件在 `kanban/` 目录,先确认合并策略) |
| **P2** | 文件树交互与可访问性 | hover 才显 chevron、双击=单击、无键盘导航 | 见 §4 |
| **P2** | 各面板空态文案与重复入口 | sources/skills 与左侧导航重复 | 见 §2 |

---

## 1. P0 Bug:放大后"缩小"按钮与"分享"按钮重合

### 1.1 根因(已定位到行,本轮复核无误)

`ExpandedPanelOverlay.tsx:56-67` 在面板放大时渲染一个浮动 restore 按钮:

```tsx
<div className="pointer-events-none absolute right-3 top-2 z-[60] flex items-center gap-1">
  <div className="pointer-events-auto">
    <TopBarButton onClick={restore} aria-label={t('contentPanel.restore')}>
      <Minimize2 className="h-4 w-4" />
    </TopBarButton>
  </div>
</div>
```

而面板自身的 header(`PanelHeader.tsx:288` `h-[42px] pr-2`)在放大状态下**仍然渲染**其 actions 槽:

- **session 对话窗口**(ChatPage):`ChatPage.tsx:549-560` 构造 `shareButton`(DropdownMenu + PanelHeaderCenterButton),经 `headerActions`(`ChatPage.tsx:641-647`)传入 `PanelHeader actions`(`ChatPage.tsx:744、817`)。
- **bound 面板**(Review/Files/Context/Preview/Trajectory):header 只有 title + `BoundSessionBadge`,右端无 actions。

关键机制链(均已核实):

1. 放大时 `PanelSlot` 被 `display:none` 隐藏(`PanelSlot.tsx:144` 附近,`display: isExpanded ? 'none' : undefined`),它注入的 `expandButton`/`rightSidebarButton`(`PanelSlot.tsx:107-130` contextOverride)随之消失。
2. `ExpandedPanelOverlay` 绕过 PanelSlot 直接渲染内容,**没有提供任何 context override**;顶层 AppShell 的 context 值是 `rightSidebarButton: null`、`expandButton` 未设置(`AppShell.tsx:1713`)。
3. 于是放大后 ChatPage 的 header 右侧只剩 actions 槽的**分享按钮**,浮动缩小按钮正好压在它上面。

几何计算(全部来自代码中的固定尺寸):

- 浮动按钮:`right-3`(12px)+ `TopBarButton` 固定 28×28 → 占据 x∈[right-40, right-12],y∈[top+8, top+36]。
- header 按钮:`pr-2`(8px)+ `PanelHeaderCenterButton`(`p-1.5` + 16px 图标 ≈ 28px)→ 最右按钮 x∈[right-36, right-8],y 在 42px 高的 header 内垂直居中 ≈ [top+7, top+35]。

水平重叠约 24/28px,垂直几乎完全重叠。**这就是用户看到的重合。**

### 1.2 为什么是补丁叠补丁

`ExpandedPanelOverlay.tsx:56-60` 的注释记录了历史:`z-[60] > z-panel(50)`,因为此前 PanelHeader 的 actions 容器盖住了浮动按钮导致不可点击。那次修复只解决了"可点击",没有解决"视觉重叠"。当前 z-[60] 让浮动缩小按钮压在分享按钮**上面**,分享按钮被遮住且无法点击。

### 1.3 修复方案(推荐)

**删除 overlay 浮动按钮,把 restore/close 按钮注入 overlay 内面板的 header**,与 `PanelSlot` 的注入模式完全一致:

1. `ExpandedPanelOverlay.tsx`:
   - 删除 56-67 行的浮动按钮块。
   - 读取 `useAppShellContext()`,构造 override:`expandButton` = `PanelHeaderCenterButton`(Minimize2,onClick=restore),`rightSidebarButton` = 关闭按钮(X,onClick=restore)。
   - 用 `AppShellProvider value={contextOverride}` 包裹 `BoundPanelContent` / `MainContentPanel`。
2. 兼容性(已核实):
   - `PanelHeader` 解析链:`rightSidebarButton ?? contextRightSidebarButton`、`expandButton` 只读 context(`PanelHeader.tsx:127-132`)。
   - ChatPage 的 `rightSidebarButton` prop 直接来自 `useAppShellContext()`(`ChatPage.tsx:76-84`),overlay 内 context 被 override 后 prop 即 override 值 → 正常。
   - bound 面板 header 走 context fallback → 自动补位。
   - CalendarView 手动从 context 读 `rightSidebarButton, expandButton`(`CalendarView.tsx:98`)→ 同样自动受益,**无需改 kanban/ 目录任何文件**。
3. **前置依赖**:sessions 面板的空态/多选分支**没有 PanelHeader**(§7),注入按钮无处渲染。需先给这两个分支补 header,否则这两种内容在 overlay 里除 Esc 外没有任何恢复入口。
4. 效果:放大后 header 按钮顺序与停靠态一致 `[分享] [缩小] [X]`,各归其位;z-[60] hack 与 `pointer-events` 包裹一并删除;Esc(`ExpandedPanelOverlay.tsx:35-45`)不变。

验证:放大 session 面板 → 右上角应看到 [分享][缩小][X] 三个独立按钮;可用 CDP `elementFromPoint` 检查无遮挡。

---

## 2. P0:ContextPanel 重构

### 2.1 问题诊断(本轮复核,修正一处此前的错误论断)

`ContextPanel.tsx` 把六类内容平铺在一个滚动列表:Session 元数据(:130-160)、Token 用量(:163-177)、附件(:180-198)、最近文件(:201-219)、workspace sources(:222-247)、workspace skills(:250-271)。

"内容很奇怪"的具体原因:

- **无主次、无层级**:一屏六个 SectionTitle,前四类与 session 强相关,后两类是 workspace 级资源,与"会话上下文"语义混杂。
- **MetaRow 空值整行消失**(`ContextPanel.tsx:56-63` 区域),列表断断续续,看起来像 bug 而不是设计。opencode 的做法是缺值显示 `—`(其 `session-context-tab.tsx` stats 数组,value 缺省即 `"—"`)。
- **与左侧导航重复**:sources/skills 在左侧边栏已有专门入口,ContextPanel 重复一份且行为不一致(点击 `navigateFromPanel` 直接把当前面板导航走,面板内容被替换,丢失"上下文"定位)。
- **列表项是死文本**:附件、最近文件不可点击(`<li>` 裸文本);最近文件只显示 basename 且 `key={name}`(`ContextPanel.tsx:213-217`),同名文件 key 碰撞、无法区分。
- **token 用量无参照系**:只有 input/output/total 三个数字,无上限、无占比、无费用。opencode 的 context tab 展示 **limit / totalTokens / usage% / input / output / reasoning / cache(read/write) / 总成本 / 消息计数 / 创建时间 / 最后活动** 共 17 项统计 + 上下文组成分段条(system/user/assistant/tool/other 五色占比条)+ 系统提示词查看 + 原始消息检查器 + **会话导出**(`packages/app/src/components/session/session-context-tab.tsx`,已对照 dev 分支源码)。
- **无 session 时的拼贴感**(修正后的论断):会话区显示空态文案,但 sources/skills 两个 section **无条件渲染**(`ContextPanel.tsx:222-271`),形成"空态卡片下方挂着两串工作区列表"的拼贴;会话相关的一项没有、工作区级的全在,信息主次颠倒。
- **缺少真正重要的信息**:消息数、创建/更新时间、上下文占用率、成本、session 所属 project/task 等都没展示。

### 2.2 整改方案

**原则:面板只回答"当前会话在什么环境里、消耗了什么、带着什么上下文"。workspace 资源移出本面板(左侧已有单一入口)。**

新信息架构(对标 opencode context tab,按我们数据可得性裁剪):

```
Context
├─ Stats 网格(两列,缺值显示 —)
│   name / status / model / permissionMode / workingDirectory / labels
│   消息数 · 创建时间 · 最后活动 ·(若有)成本
├─ Context budget(进度条卡片)
│   上下文占用:total tokens vs limit,百分比
│   input / output /(若有)cache、reasoning 分项
│   (增强位)上下文组成分段条:system/user/assistant/tool 占比
├─ Attachments(可点击)
│   点击 → 走 link interceptor 预览(复用 AppShellContext.onOpenFile)
├─ Recently opened(可点击)
│   点击 → 预览;key 用 `file:${path}`;显示相对路径而非 basename
└─ (可选,默认折叠)Workspace
    sources / skills —— 若保留,折叠收起,点击行为与左侧导航一致
```

落地细节:

- 无 active session:整屏空态即可(面板语义就是会话上下文);不要空态+workspace 列表拼贴。若产品决定保留 workspace 区,则顶部放引导条"聚焦一个会话以查看其上下文",workspace 区折叠。
- Token 预算条需要 limit 值:先确认后端/元数据能否提供模型上下文上限(可参考 opencode `session-context-metrics.ts` 的取数方式);**拿不到就不虚构上限**,先展示 input/output/total + 扩展位。
- 会话导出(opencode 有,export 按钮 + toast)是低成本高价值增强,可列入 P2。

---

## 3. ReviewPanel(Review & Diff)

功能本身扎实(分组、±N 统计、diff 种类圆点、错误分支、消息加载防误报、scroll-to-change)。缺口(均已核实):

| 问题 | 位置 | 建议 |
|---|---|---|
| diff 风格(unified/split)无面板内入口;header 完全没有 actions 槽,只有 title+badge | `ReviewPanel.tsx:157`(`PanelHeader title badge`),`viewerSettings` 来自全局 `useDiffViewerSettings`(:84) | header actions 加紧凑切换按钮,直接写 `setViewerSettings` |
| 无全部折叠/展开 | — | header 加"折叠全部";文件多时刚需 |
| `setTimeout(120)` 硬编码等待渲染 | `ReviewPanel.tsx:125-127` | 改 `requestAnimationFrame` 双帧,消除偶发抖动 |
| 同文件多次修改分开展示(每个 change 一个卡片) | `ReviewPanel.tsx:170-244` | 保持默认;可加"按文件合并"可选模式,不改默认 |
| 无行级评论 | — | opencode 有行评论能力;增强项,入 backlog |

---

## 4. FilesPanel + SessionFilesSection

FilesPanel 包装简单合理(header + 过滤框 + 树)。问题集中在 `SessionFilesSection.tsx`(均已核实):

| 问题 | 位置 | 建议 |
|---|---|---|
| 双击与单击处理函数逐行相同(注释自述 "same as single click"),但 tooltip 却宣传 "double-click to open" | `:568-584`、`:346` | 双击改为外部打开(文件走系统默认应用,目录进文件管理器),单击保持应用内预览;消除 tooltip 与行为的矛盾 |
| 目录 chevron 只在 hover 显示(图标 hover 交换) | `:350-369` | chevron 常驻并随展开旋转;hover 交换对键盘/触屏不可发现 |
| 默认"全展开"(无 saved state 时收集全部目录路径) | `:513-521` | 改为默认展开前两层 + 保留"全部展开"入口;深目录首开成本高 |
| 无键盘导航与 `aria-expanded` | 树项 button(`:336-376`) | 加方向键导航与 aria 属性 |
| 右键菜单只有 Open / Show in file manager | `:383-398` | 加 Copy path(与 SessionMenu 惯例一致) |
| 加载失败 catch 后 `setFiles([])`,与真实空目录同文案 | `:524-529` | 加错误态文案与重试 |

另:旧右侧栏入口已全局关闭(`AppShell.tsx` `isRightSidebarVisible={false}`),`SessionFilesSection` 现在只有 FilesPanel 一个消费者。若确认旧右侧栏永不回归,可择机清理 `hideHeader` 分支与 `right-sidebar/` 死代码(记录,不在本次整改)。

---

## 5. PreviewPanel + FilePreviewContent

均已核实:

| 问题 | 位置 | 建议 |
|---|---|---|
| tab 无关闭按钮,entry 只能累积 | `PreviewPanel.tsx:82-105` | tab 加 hover 出现的 X;需要 preview atom 的移除 write 操作 |
| 点击已选中 tab 会 `setSelectedKey(null)` → 内容区变空态,tab 还在 | `PreviewPanel.tsx:92` | 点击已选中 tab 改为无操作(语义:tab 只切换不取消) |
| tab 无 tooltip,同名文件无法区分 | `:82-105` | 加 `title={entry.path}` |
| md entry 的 key 用 `md:${title}`,可碰撞 | `PreviewPanel.tsx:29-30` | key 加 id/时间戳 |
| 无"全部关闭" | — | header actions 加清空按钮(低频,P2) |
| 大文本/PDF 无上限保护 | `FilePreviewContent.tsx` | 超阈值(如 1MB)显示"文件过大,改外部打开"引导 |

参照:opencode 有 `context/closed-tabs.ts`(已关闭 tab 可恢复)——做关闭按钮时可顺手加"重新打开已关闭"的低成本高手感功能。

---

## 6. WorkbenchPanelButtons / TopBar 溢出与可发现性

均已核实:

| 问题 | 位置 | 建议 |
|---|---|---|
| 窄窗口按钮直接 `slice` 截断,被截断的面板(通常 trajectory/preview 侧)没有兜底入口 | `WorkbenchPanelButtons.tsx:139-142`、`TopBar.tsx:106-113` | 加 overflow「更多」下拉:截断按钮进菜单,行为一致(含 Shift/Alt replace 语义),菜单项带文本标签 |
| 可见数公式 `(innerWidth - 500) / 24` 估算左侧 chrome,与实际(clamp 侧栏 + 固定按钮)误差可达 ±100px | `TopBar.tsx:111-112` | 改为对右槽实测(同文件已有 badge 密度 ResizeObserver 先例 `:132-162`) |
| 按钮纯 icon + tooltip,可发现性弱 | `WorkbenchPanelButtons.tsx` | 维持 icon(空间约束);overflow 菜单带文本 |
| `open` 与 `focused` 只差透明度 0.6/1.0 + 一个底部圆点,三态难辨 | `:219-232` 区域 | focused 加底色/边框,open 加弱底色,background 保留圆点 |

---

## 7. Sessions 面板:空态/多选分支没有 PanelHeader(本轮新发现)

`MainContentPanel.tsx` 的 sessions 分支:

- **未选中会话的空态**(`:428-434`):裸 `<div>` + 一句 `session.noSessionSelected`,**无 PanelHeader**。
- **多选状态**(`:399-417`):`MultiSelectPanel` 内部(`MultiSelectPanel.tsx:81-202`)同样**无 PanelHeader**,只有居中内容。
- 只有选中会话后渲染的 `ChatPage` 才有标准 header(`:419-425`)。

后果:

1. **面板内无关闭/放大按钮**。PanelSlot 注入的 `expandButton`/`closeButton` 依赖 PanelHeader 的 context fallback 渲染;没有 header 就无处渲染。用户在这两种状态下无法从面板本身关闭/放大它(只能再点顶栏按钮),与其他所有面板不一致。
2. **阻塞 P0 修复**:§1.3 的注入式方案依赖"overlay 内内容必有 header"。这两个分支不补 header,注入按钮就没有落点,overlay 里只剩 Esc 可恢复。

建议:两个分支各补一个标准 `PanelHeader`(title 取面板名,空态可不设 badge;多选面板 title 可用"已选 N 项")。改动小,顺手统一。

---

## 8. Calendar 面板(本轮新增;注意合并策略)

`CalendarView.tsx` 位于 `components/app-shell/kanban/` 目录——与 kanban 同目录。**动手前先确认它是否与 kanban 一样跟随上游同步;若是,本节全部降级为"向上游提 issue",不在本地改。**以下问题均已核实:

| 问题 | 位置 | 建议 |
|---|---|---|
| 删除条目无确认,单击即删;且删除按钮与"创建会话"按钮等重并排常驻 | `CalendarView.tsx:147-151`(`handleDelete` 直接 `remove`)、`:220-240` | 删除改到悬停溢出菜单或加二次确认;主操作只留"创建会话" |
| 时段在 8:00–20:00 之外的条目:`hourTop` 算出负值或 >100%,absolute 定位飞出时间网格,无 clamp/过滤 | `:52-63`、`:317-325`、`:449-453` | 越界条目归入 all-day 条或 clamp 到边缘并标箭头;或按条目动态扩展 HOUR_START/END |
| 标题日期格式硬编码中文字面量 `'yyyy年M月d日'`,英文 locale 下仍是中文格式 | `:202-206` | 用 i18n 日期格式(date-fns locale 或 Intl.DateTimeFormat) |
| Week 视图标题与 Month 完全相同(`yyyy年M月`),看不出是哪一周 | `:203-204` | 周标题带起止日 |
| 计时条目固定按 1 小时渲染(`(hh+1)%24`),无时长概念 | `:320`、`:325` | 条目模型加 duration(破坏性,需协议配合,入 backlog) |

正向:header 按钮手动读 context(`:98`),§1 的 P0 修复对它零改动生效;Day/Week/Month 三视图与"条目独立于会话、按需创建会话"的设计清晰。

---

## 9. TrajectoryPanel

相对最完善:`TrajectoryView` 自带 toolbar/timeline/table/两级折叠/搜索/记录检查器,有单元测试(`packages/ui/src/components/trajectory/__tests__`)。仅一点:

- `DURATION_PREFERENCE_KEY` 直接读 `localStorage`(`TrajectoryView.tsx:20-27`),与项目统一 `storage` 工具的惯例不一致;低风险,建议统一。

结论:无需整改,仅记录惯例统一建议。

---

## 10. 与 opencode 对照表(opencode 侧已核实 dev 分支源码)

| 维度 | opencode(dev) | 本项目 | 差距/行动 |
|---|---|---|---|
| session 顶栏分享 | share 下拉(复制/更新/取消共享) | 同款已实现(`ChatPage.tsx:549-560`) | 无差距;修 §1 重叠即可 |
| 文件 tab | tab 可关闭,有 `context/closed-tabs.ts`(关闭后可恢复) | PreviewPanel tab 不可关 | §5:关闭按钮 + tooltip;(可选)恢复已关闭 |
| diff 查看 | review tab(e2e: `review-tab-switch.spec.ts`),风格切换在行内 | ReviewPanel 风格切换在全局设置 | §3:面板内加切换;行评论入 backlog |
| 上下文面板 | `session-context-tab.tsx`:17 项统计网格(含 limit/usage%/cache/成本/消息计数/时间)、组成分段条、系统提示词、原始消息 accordion、会话导出 | ContextPanel 六块平铺大杂烩 | §2 重构;统计网格与预算条优先;导出 P2 |
| 面板状态保持 | view scroll 按面板恢复(见 context tab 的 scroll restore) | selection/scroll 已 lift 到 atoms(content-panel-ui) | 无差距 |

---

## 11. 落地计划(建议顺序)

1. **P0-1**:`ExpandedPanelOverlay` 按钮注入重构(1 个文件)+ **sessions 空态/多选分支补 PanelHeader**(§7,前置依赖)。回归:放大/恢复、Esc、ChatPage 三处 header 渲染点(:744/:805/:817)、bound 面板、macOS stoplight 补偿。
2. **P0-2**:ContextPanel 重构(§2.2)。预算条先确认 limit 数据可得性,拿不到不虚构。
3. **P1**:TopBar overflow 菜单 + 实测宽度;PreviewPanel tab 关闭 + 点击语义修正;ReviewPanel 风格切换 + 折叠全部。
4. **P2**:文件树 a11y/双击语义/复制路径/错误态;Calendar 问题(先定合并策略);会话导出;TrajectoryView 存储惯例统一;死代码清理评估。

每一步独立可验证,互不阻塞;均不触碰 `kanban/`(§8 待策略确认)。

---

# 第二轮:面板系统机制与渲染层深挖

范围:面板堆栈机制(panel-stack/hidden-panels/compact/快捷键/sash/trigger)、Trajectory 渲染与数据层、预览/文件内容渲染层、Review 数据层 + browser 体系。共 33 条新发现,全部有 file:line 证据。

## 12. 面板系统机制(9 条)

| 优先级 | 问题 | 证据 | 建议 |
|---|---|---|---|
| **P0** | **compact 模式(<768px)打开 bound 面板(files/diff/context/preview)后渲染到屏幕外,用户毫无感知**——"开着但找不到"。`isDetailNavState` 对 `'other'` navigator 恒 false,compact 分支把聚焦面板包进 `CompactPanelTransition`,非激活槽 `x:100% + pointer-events:none + aria-hidden`;而 TopBar 按钮与快捷键在 compact 下均可用 | `nav-helpers.ts:35-37`、`PanelStackContainer.tsx:131-171`、`CompactPanelTransition.tsx:39,48-53`、`TopBar.tsx:267` | `isDetailNavState` 对 bound 面板返回 true,或 compact 分支对 bound 面板单独走可见分支 |
| **P0** | **非 workbench 面板(sources/skills/settings 等)被 LRU 驱逐进 hidden 集后无任何恢复入口,永久丢失**——`workbenchPanelKindForRoute` 对这些路由返回 null,顶栏无对应按钮;三个恢复入口都只按 workbench kind 匹配 | `hidden-panels.ts:96-106`、`AppShell.tsx:2105-2110`、`panel-triggers.ts:38-43`、`WorkbenchPanelButtons.tsx:113-123`、`workbench-panels.ts:44-58` | 加「已隐藏面板」溢出菜单,遍历 `hiddenPanelsAtom` 直接 `restorePanelAtom`(已支持任意 id) |
| **P1** | 放大 overlay 未纳入 overlay-detection,**Esc 双重副作用**:先中断正在生成的会话、再关闭 overlay(全局 capture keydown 先注册先执行) | `overlay-detection.ts:17-35`、`registry.tsx:96-97`、`AppShell.tsx:1273-1294`、`ExpandedPanelOverlay.tsx:40-48` | `hasOpenOverlay()` 纳入 `[data-expanded-panel-overlay]`,或 stopProcessing 的 enabled 显式排除 |
| **P1** | focusNext/focusPrev 只改数据焦点:**不 scrollIntoView、DOM 焦点不跟随**;多面板时出现"高亮 A、打字作用 B、Esc 中断 A"的歧义 | `panel-stack.ts:348-367`、`PanelStackContainer.tsx:75-84`、`PanelSlot.tsx:123-127`、`ChatDisplay.tsx:570-574` | focusedPanelId 变化时 scrollIntoView;PanelSlot 加 onFocusCapture 回写 |
| **P1** | Cmd+T(新会话面板)绕过 LRU,前台面板数无上限(>3),屏外面板无滚动兜底 | `AppShell.tsx:2021-2039`、`NavigationContext.tsx:783-786`、`panel-stack.ts:117-120`、`panel-constants.ts:25` | newPanel 路径同样走 LRU 驱逐 |
| **P2** | 面板宽度持久化链路完整(URL 编码+按 workspace 保存+重启恢复 ✓),**但任何开/关/恢复面板都把比例均分重置**,用户布局无法保持 | `NavigationContext.tsx:305-342`、`panel-stack.ts:137-141`、`hidden-panels.ts:165-170` | count 变化时按比例缩放而非均分;或 UI 提示宽度会重置 |
| **P2** | 快捷键覆盖不全:diff/files/context/preview/focusNext/focusPrev 有热键,**sessions/board/calendar/trajectory 没有**;trajectory 按钮排序靠尾,窄窗口被截断后**完全不可达** | `actions/definitions.ts:163-209`、`WorkbenchPanelButtons.tsx:139-142` | 补 trajectory 直达热键;tooltip 显示热键(配合 §6 溢出菜单) |
| **P2** | PanelResizeSash 有 min/max 钳制与双击复位,**但无键盘、无触屏**(仅 mouse 事件,无 role=separator/tabIndex) | `PanelResizeSash.tsx:26-30,80-88,133-160` | role="separator" + tabIndex + 方向键微调;改 pointer 事件 |
| **P2** | trigger 式打开的 replaced 分支**不保护 index-0 主会话**:聊天中点文件可把主会话面板原地替换成 preview(与 findPanelToEvict 的决策 #8 不一致) | `panel-triggers.ts:60-70`、`hidden-panels.ts:96-106` | replaced 分支复用跳过 index-0 的语义 |

## 13. Trajectory 面板(8 条,推翻第一轮"无需整改"的结论)

| 优先级 | 问题 | 证据 | 建议 |
|---|---|---|---|
| **P0** | **虚拟化是空壳**:`const virtualRows = rows`,projectVirtualRows 只算从未被使用的 height;千条消息全量渲染数千个 `<tr tabIndex={0}>`,每行都是 Tab 停靠点 | `TrajectoryTable.tsx:92-93,132`、`trajectory-virtual-rows.ts:28-37`、死代码 `TrajectoryTable.module.css:177-185` | 实现真窗口化或删脚手架;顺带删无引用的 TrajectoryCell/TrajectoryTurn/TrajectoryGroupHeader |
| **P0** | **布局派生 O(n²)**:每 cell 不可变追加数组;流式期间每次消息更新全量重算 snapshot→turns→rows,且 flattenTurnRecords 同帧被调两次 | `trajectory-layout.ts:386/417/435/466/498`、`TrajectoryPanel.tsx:44-55`、`TrajectoryView.tsx:88-90`、`TrajectoryTable.tsx:82` | 布局改原地 push;派生提升为 sessionId 键控的增量原子 |
| **P1** | 搜索无高亮/无计数/无结果间跳转;命中行被直接过滤消失;折叠汇总行无命中也保留 | `TrajectoryToolbar.tsx:90-105`、`trajectory-search-index.ts:94-102`、`TrajectoryTable.tsx:139-162` | 高亮+计数+方向键跳转;折叠行仅含命中时保留 |
| **P1** | **无跨面板联动**:cell 已带 sourceSeq(message.id)/callId(toolUseId),但 TrajectoryView 无任何导航回调;chat→review 有完整通路(reviewPanelFocusRequestAtom),trajectory→chat/review 全缺 | `TrajectoryView.tsx:29-35`、`trajectory-layout.ts:425/433/455`、`ReviewPanel.tsx:118-130` | 加 onOpenMessage/onOpenChange 回调,复用现有 atom 基建 |
| **P1** | 同源 `session.messages` 被三条管道各遍历一遍(ChatDisplay turns、Review activities、Trajectory snapshot),无共享 | `ChatDisplay.tsx:1313-1315`、`ReviewPanel.tsx:107-109`、`TrajectoryPanel.tsx:44-55` | groupMessagesByTurn 等提升为 sessionId 键控共享派生 |
| **P1** | `isProcessing` 传入后被解构丢弃,无 live 指示、不跟随最新;加载失败无 catch → IPC reject 落入"No records"**假空态** | `TrajectoryView.tsx:42`、`TrajectoryPanel.tsx:26-37,97-105`、`sessions.ts:663-676` | 消费 isProcessing;加错误态 |
| **P2** | 时间轴 4 种模式仅 2 种可达('time'/'actual' 死代码);idle 压缩开关是 hidden 按钮;无并发车道分配 | `trajectory-timeline.ts:16`、`TrajectoryView.tsx:118-123`、`TrajectoryToolbar.tsx:68-80` | 恢复开关或删死模式;time 模式做并发车道 |
| **P2** | inspector 无复制/导出/Esc 关闭;Raw/Payload 是大段 `<pre>` 只能手选 | `RecordInspector.tsx:263-269,343-382` | 各段加复制按钮,aside 挂 Esc |

## 14. 预览与文件渲染层(8 条)

| 优先级 | 问题 | 证据 | 建议 |
|---|---|---|---|
| **P0** | **消息 pop-out 去重塌缩**:所有 pop-out 用固定 title("消息预览"),identity 为 `md:${title}` → 连续 pop-out 多条只有最后一条存活 | `ChatDisplay.tsx:953`、`preview.ts:22-24,36-39` | title 带消息 id,或 PreviewEntry 加独立唯一键 |
| **P0** | **预览不随磁盘变化刷新**:effect 依赖仅 [filePath,type],一次性快照;唯一 watcher 只刷文件树不碰 preview;无"已修改"提示 | `FilePreviewContent.tsx:51-73`、`SessionFilesSection.tsx:536-556` | 订阅当前预览路径变更,加重载提示条 |
| **P0** | **超大文件无保护**:READ/READ_DATA_URL/READ_BINARY 三条 IPC 全部整读无 size 检查(附件路径却有 50MB 上限),数百 MB 文件全量过 IPC 卡死渲染进程 | `packages/server-core/src/handlers/rpc/files.ts:34-39,54-58,106-112` vs `:174,204-207`、`FilePreviewContent.tsx:60-70` | 读前 stat 限流,文本按行截断,图片降采样 |
| **P1** | 二进制误预览:非可预览扩展一律回落 'text',utf-8 强解无 NUL 嗅探 → 乱码渲染 | `FilePreviewContent.tsx:42-43`、`files.ts:38` | 前几 KB NUL 嗅探,二进制给错误态 |
| **P1** | 图片仅 object-contain 无缩放/下载;PDF 页固定 width=660,窄面板强制横向滚动 | `FilePreviewContent.tsx:83-85,99` | PDF 宽度自适应+缩放控件;图片补 zoom/外部打开 |
| **P1** | **markdown 相对链接必失败**[推测,代码推演未实测]:相对路径原样透传,服务端 validateFilePath 拒绝对路径 → 永久坏 tab | `link-target.ts:54-68`、`PreviewPanel.tsx:114`、`App.tsx:1784-1793`、`server-core utils.ts:86-87` | onFileClick 前以预览文件 dirname resolve 绝对路径 |
| **P2** | 过滤框无清除按钮/Esc、只匹配文件名不匹配路径、过滤时不自动展开命中祖先(命中文件藏在折叠目录里) | `FilesPanel.tsx:54-60`、`SessionFilesSection.tsx:99-103,596-605` | 清空+Esc、自动展开祖先、可选路径匹配 |
| **P2** | preview atom 无上限/LRU、注释("moves to front")与实现(追加到末尾)相反、工作区切换与删 session 都不清理 → Map 永久膨胀;重开文件 tab 跳末尾且 tab 行无 scrollIntoView;FileViewer.tsx 全库零引用(死代码) | `preview.ts:21,32-40`、`PreviewPanel.tsx:42-44,79`、`App.tsx:1874-1883` | LRU 上限+前插+scrollIntoView+删除时清理;删 FileViewer |

## 15. Review 数据层 + Browser 体系(8 条)

| 优先级 | 问题 | 证据 | 建议 |
|---|---|---|---|
| **P0** | **browser 加载失败/崩溃对用户完全不可见**:`did-fail-load` 仅 warn 日志,全仓无 `render-process-gone` 处理;崩溃时 `did-stop-loading` 不触发 → isLoading 永卡 true,toolbar 无限转圈;DTO 无 error 字段 | `browser-pane-manager.ts:3487-3489,3367-3390`、`dto.ts:810-829` | 监听 render-process-gone + did-fail-load 写 error 状态,toolbar 显示错误页/重试 |
| **P0** | **Review 纯只读**:change 卡片全部交互=展开/收起+文件头外部打开;无复制 diff、无回退、无跳回 chat 定位;发现问题唯一出路是外部编辑器手动改 | `ReviewPanel.tsx:217-233`、`DiffViewerControls.tsx:56-90` | 复制 diff 按钮;文件头加"定位到 chat 消息"(复用 reviewPanelFocusRequest 反向) |
| **P1** | Edit 变更 diff 无上下文行:只存 oldText/newText 片段现场合成 diff,看不到改动在文件中的位置;空 oldText 纯插入整段全绿 | `file-changes.ts:34-49`、`ShikiDiffViewer.tsx:124-132` | 采集时附前后上下文行,或展示带文件上下文的 diff |
| **P1** | 展开 section 全量渲染其所有 diff:Write 变更 modified=整文件,Shiki 高亮+整棵 DOM,数千行 Write 一展开即卡 | `ReviewPanel.tsx:172-178`、`file-changes.ts:58-66`、`ShikiDiffViewer.tsx:154-162` | 视口内懒挂载/超长 diff 行数截断+"加载更多" |
| **P1** | **Bash rm/mv 删除的文件完全不可见**;无路径字段的变更全部归并进一个 'unknown' section 互相混淆 | `file-changes.ts:20-67,10-12` | 收集 Bash 删除为 delete 类型;unknown 按 activity id 分组 |
| **P2** | 地址栏导航失败零反馈:30s 超时/非法 scheme 的 reject 被 `void api?.navigate()` 吞掉,输入框保留错误 URL 无提示 | `browser-pane-manager.ts:760-773`、`browser-toolbar.tsx:135-136`、`BrowserControls.tsx:201-210` | navigate 返回 {ok,error},失败 toast + 回写原 URL |
| **P2** | 两 diff viewer 不对等:UnifiedDiffViewer 无 language prop(LANGUAGE_MAP 死导入),解析失败降级为无行号裸 `<pre>` | `UnifiedDiffViewer.tsx:16,84-88,130-143`、`ShikiDiffViewer.tsx:43` | 统一 getLanguageFromPath;降级分支补行号或换 Shiki 兜底 |
| **P2** | agent 窗口与手动窗口区分太弱:仅 agentControlActive 时 badge 加 accent 边框;溢出菜单只有 title/hostname | `BrowserTabBadge.tsx:51`、`BrowserTabStrip.tsx:299-311`、`dto.ts:816-821` | badge/菜单常驻 owner 图标(agent 控制中/会话持有/手动) |

## 16. Calendar 补遗(本轮自查新发现,均位于 kanban/ 目录,动手前同样先定合并策略)

| 优先级 | 问题 | 证据 | 建议 |
|---|---|---|---|
| **P1** | **月视图单元格 "+" 快速新建按钮永久隐藏**:按钮用 `hidden group-hover:inline-flex`,但单元格及所有祖先都没有 `group` 类 → 永远不会显示,是个死按钮 | `CalendarView.tsx:505-515`(按钮)/`:478-484`(单元格无 group) | 单元格加 `group` 类,或去掉 hidden 改为常显 |
| **P2** | "+N more" 是纯 `<span>` 不可点击,看全天条目只能点日期数字 | `:560-564` | 点击打开同日的 popover |
| **P2** | 日 popover 里点条目**只是关闭 popover**,不进编辑;与月视图 chip 点击(openEdit)不一致,且 popover 内无任何操作按钮 | `:537-551` | 点击进编辑;或 popover 内补操作 |
| **P1** | header `paddingRight: 48` 给浮动缩小按钮让位,但仅在 `compensateForStoplight`(macOS 桌面)时生效——**Windows/Web 上放大的日历面板,浮动缩小按钮会压"新建条目"按钮**,与 §1 分享按钮同源 | `:584-591` | §1 注入式修复后删除此补偿;验证非 macOS 平台 |
| **P2** | 上/下翻按钮 aria-label 恒为 prevMonth/nextMonth,Day/Week 视图下语义错误 | `:595-610` | 按视图切换文案 |

## 17. 第二轮落地计划(并入第一轮 §11)

按"用户可感知的修复价值/改动面"排序:

1. **P0-A(机制层)**:compact  bound 面板不可见(§12-1)、非 workbench 面板丢失(§12-2)、Esc 双重副作用(§12-3)。均为小改动、高感知。
2. **P0-B(数据正确性)**:pop-out 塌缩(§14-1)、超大文件保护(§14-3)、browser 崩溃不可见(§15-1)。
3. **P0-C(性能)**:trajectory 虚拟化空壳 + O(n²)(§13-1/2,与 §13-5 共享派生一起做收益最大)、Review 展开全量渲染(§15-4)。
4. **P1**:预览刷新(§14-2)、Review 只读补强(§15-2 复制 diff + 跳 chat)、trajectory 联动(§13-4)+ isProcessing/错误态(§13-6)、Edit diff 上下文(§15-3)、Bash 删除可见(§15-5)、focus 跟随(§12-4)、Cmd+T 上限(§12-5)、Calendar 死按钮(§16-1/4)。
5. **P2**:其余各项随面板整改顺带做。

验证要点:compact 模式开各面板逐个点检;制造 browser 崩溃(kill 渲染进程)看 UI;千条消息的 trajectory 滚动帧率;连续 pop-out 两条消息;500MB 文件预览。

---

# 第三轮:UI/视觉层评审

方法:playground 实机截图(Calendar 明/暗两色、SessionItem 状态族)+ 全部面板组件样式逐行审计。截图证据:日历月视图(明/暗)、SessionItem States。

## 18.1 跨面板通用

| 优先级 | 问题 | 证据 | 建议 |
|---|---|---|---|
| **P1** | **空态视觉语言两套**:bound 面板统一用 `PanelEmptyState`(图标 6×6 + 标题 + 提示);sessions 面板空态与全局 fallback 是**裸灰字一句** `text-muted-foreground` 居中,无图标无层次,看起来像没做完 | `MainContentPanel.tsx:428-434,440-446` vs `PanelEmptyState.tsx` | 全部走 PanelEmptyState(补 header 时一并做,见 §7) |
| **P2** | 面板按钮三态(open/focused/background)只靠 0.6/1.0 透明度 + 一个 1px 圆点区分(§6 功能项的视觉面) | `WorkbenchPanelButtons.tsx:219-232` | focused 用底色块,open 用弱底色,background 保留圆点 |
| **P2** | PanelHeader 42px、标题 text-sm semibold、badge 紧随——全面板一致 ✓ 无问题 | `PanelHeader.tsx:288` | 保持 |

## 18.2 ContextPanel(纯样式审计)

| 优先级 | 问题 | 证据 | 建议 |
|---|---|---|---|
| **P1** | **MetaRow 双栏布局浪费窄面板宽度**:固定 128px 标签列(`w-32`),440px 最小面板下值列只剩 ~280px,workingDirectory 必然截断;标签列本身是大片无效空白 | `ContextPanel.tsx:56-63` | 改 opencode Stat 式"标签上值下"堆叠(label 12px weak / value 13px),或标签列缩到 `w-24` |
| **P1** | **区块容器语言不统一**:元数据/token 是卡片(`rounded-lg border bg-foreground/[0.02]`),附件/最近文件/sources/skills 是裸列表——一屏两种容器 | `:130-271` | 统一:会话相关全部进卡片,列表类全部裸排(或反之);配合 §2 重构一并定 |
| **P2** | labels 行是 MetaRow 之外手写的另一套 flex 布局(`:146-156`),与其他行不对齐,视觉上是孤儿 | — | 并入 MetaRow 体系或给 MetaRow 加 value 槽支持 chips |
| **P2** | SectionTitle(11px uppercase muted/70 + 图标)风格正确,但 `pt-3` 均匀节奏下六个区块视觉权重全等,无主次 | `:47-53` | §2 重构后用卡片层级替代均匀分节 |

## 18.3 ReviewPanel

| 优先级 | 问题 | 证据 | 建议 |
|---|---|---|---|
| **P2** | **同一信息三重编码**:kind 色点 + DiffKindLabel 文字 + Write/Edit 图标同时出现在一行 | `ReviewPanel.tsx:181-197` | 保留图标 + ±N 统计,色点与文字标签去其一 |
| **P2** | 展开区无位置锚点:多 change 卡片(pl-6 缩进、minHeight 200)堆叠滚动时没有 sticky 文件头,滚两张卡片后不知道自己在哪个文件 | `:200-244` | section 展开时文件名单独 sticky 于展开区顶部 |

## 18.4 PreviewPanel

| 优先级 | 问题 | 证据 | 建议 |
|---|---|---|---|
| **P2** | tab 图标一律 FileText,文件预览与消息 pop-out 两种 entry 无法从 tab 区分 | `PreviewPanel.tsx:96-99` | markdown entry 用消息/文档图标区分 |
| **P3** | tab `max-w-[16rem]`(256px)偏宽,加重关闭按钮(§5)后建议收到 10rem | `:88-93` | 配合 §5 一并改 |

## 18.5 FilesPanel / 文件树

| 优先级 | 问题 | 证据 | 建议 |
|---|---|---|---|
| ✓ | 树缩进参考线(left-13px 1px foreground/10)与 LeftSidebar 一致,层级可读 | `SessionFilesSection.tsx:419-423` | 无问题 |
| **P3** | 过滤框下缘与树第一行 hover 背景紧贴,无分隔 | `FilesPanel.tsx:54-66` | 树下加 pt-1 或过滤框区加底部分隔线 |
| — | chevron hover 闪切(§4 功能项)同时是视觉抖动源 | `:350-369` | 随 §4 一并改常驻 |

## 18.6 Calendar(截图验证,kanban/ 目录,动手前定合并策略)

| 优先级 | 问题 | 证据 | 建议 |
|---|---|---|---|
| **P1** | **中英混排直接可见**:标题"2026年8月"(硬编码)与 Today / Day Week Month / New Schedule 英文按钮同屏 | 截图 1;`CalendarView.tsx:202-206` | §8 已报,截图为证 |
| **P2** | **月视图条目 chip 无 hover 态、无 pointer 光标、无键盘可达**:`<div onClick>` 裸奔,看起来不可点却可点 | `:552-559`(chip className 无任何 hover/cursor 类) | 加 `cursor-pointer hover:` 提亮 + 改 `<button>` |
| **P2** | 翻页按钮用文本字形 `‹ ›`,全应用其他地方均为 lucide 图标;24px 触控目标偏小 | `:594-611` | 换 ChevronLeft/ChevronRight,按钮到 h-7 w-7 |
| **P3** | 暗色模式整体正常(截图 2 验证);today 的 accent/10 底色与 chip 的 accent/16 色块明度接近,today 仅靠圆圈区分 | 截图 2 | 可不动;若强化,today 加边框 |
| ✓ | 条目 chip 截断 + 右侧 10px tabular-nums 时间、weekday 大写表头、隔月日期降透明——均良好 | 截图 1/2 | 保持 |

## 18.7 Sessions 面板(SessionItem 截图验证)

| 优先级 | 问题 | 证据 | 建议 |
|---|---|---|---|
| ✓ | SessionItem(状态环 + 13px 标题 + 相对时间)状态族完整(8 个变体),视觉干净 | 截图 3 | 保持 |
| **P1** | 主内容区空态裸文本(见 18.1-1)是 sessions 面板最大的视觉短板 | `MainContentPanel.tsx:428-434` | 同 18.1-1 |

## 18.8 UI 层落地建议

UI 改动不单独开批次,**并入 §11/§17 的功能整改**:§2(ContextPanel 重构)带走 18.2 全部;§5(PreviewPanel tab)带走 18.4;§4(文件树)带走 18.5;§7(sessions header)带走 18.1-1/18.7;§8(Calendar)带走 18.6;§3(Review)带走 18.3;§6(顶栏三态)带走 18.1-2。唯一独立的视觉项是 ReviewPanel 的三重编码删减(18.3-1),一行删除级改动。

---

# 实施状态(2026-08-16)

第一、二轮 P0/P1 全部落地(18/18)。验证:全仓 typecheck、renderer 254 项测试、trajectory 30 项、browser-pane-manager 83 项(含 4 个新增用例)、7 语言 i18n 覆盖率(1782 键)全过。

| 批次 | 内容 | 落地文件 |
|---|---|---|
| P0-1 | 放大按钮注入(删除浮动按钮)、sessions 空态/多选补 header、空态统一 PanelEmptyState | ExpandedPanelOverlay、MainContentPanel |
| P0-A | compact bound 面板可见、Esc 双重副作用、隐藏面板恢复入口(=TopBar 溢出菜单:截断按钮+隐藏面板) | PanelStackContainer、overlay-detection、TopBar、WorkbenchPanelButtons |
| P0-B | pop-out 唯一 id(4 处入口)、50MB 读上限+1MB 文本截断+NUL 嗅探、browser loadError(did-fail-load/render-process-gone→错误条+重试+badge 警示) | preview.ts、ChatDisplay、PreviewPanel、server-core files.ts、FilePreviewContent、browser-pane-manager、dto.ts、BrowserControls、BrowserTabBadge |
| P0-2 | ContextPanel 统计网格重构(17 项 stat、workspace 区折叠、最近文件可点击) | ContextPanel(重写) |
| P0-C | trajectory 真窗口化+O(n²) 原地化+flatten 单次化+错误态+live 指示、Review 卡片 content-visibility 懒渲染 | packages/ui trajectory 8 文件+TrajectoryPanel、ReviewPanel |
| P1 | TopBar 实测宽度、PreviewPanel tab 关闭/无操作/tooltip/md 图标/scrollIntoView、ReviewPanel 风格切换+折叠全部+三重编码删减、文件树 chevron 常驻/双击外部打开/复制路径/错误态 | TopBar、PreviewPanel、ReviewPanel、SessionFilesSection |

## 未落地(需决策或后续)

- **Calendar 全部条目**(删除确认、越界时段、硬编码日期、+按钮死按钮、paddingRight 补偿):文件在 `kanban/` 目录,等合并策略确认。
- 会话导出、Review 行评论、Edit diff 上下文行、Bash 删除可见、preview LRU 上限、markdown 相对链接解析、图片/PDF 缩放、trajectory 跨面板联动、键盘导航/sash 可访问性 —— P2/backlog。

## 验证缺口

- 未做真机 Electron 目检(需人工启动 `electron:dev` 复核放大/恢复、compact 面板、browser 崩溃路径);代码层已验:typecheck、单测、DOM 结构推演。
- 新增 12 个 i18n 键已入 7 语言,覆盖率脚本通过。
