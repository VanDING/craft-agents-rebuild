# UI 与动效审视 · 2026-09-06

本轮只审视，未修改产品 UI 或交互代码。目标是在当前风格内提高精致度与一致性。

后续修复及验证结果见 [UI 与动效修复](ui-refinement-2026-09-06.md)。本报告与下方截图保留审视时的状态。

整体判断：主界面的轻表面、紧凑列表、系统字体和低饱和强调色值得保留。偏离最明显的是 Run，且不只是审美差异：颜色和字体桥接均存在可复现的失效。其次是看板的多重颜色强调、局部控件绕开公共样式，以及内外层切换节奏不一致。

## 审视方法与覆盖边界

阅读桌面 renderer、共享 UI、WebUI 和 viewer 的主题/动效入口及主要界面实现；启动独立的 Vite Playground，在 Chromium 中渲染代表组件与 Run 的真实组件，使用合成会话数据，不访问真实会话内容。

| 区域 | 本轮覆盖 | 判断 |
| --- | --- | --- |
| 全局主题、颜色、字体、阴影 | 源码 + 浏览器计算样式 | 有公共规范，但局部消费方式失效 |
| 主框架、侧栏、工作台 | 源码；会话列表代表组件截图 | 基本风格应保留；外层已有动效 |
| 聊天、TurnCard、输入与状态提示 | TurnCard 截图 + 相关动效源码 | 保留内容优先的主风格，局部密度可调整 |
| Run Overview / Trajectory / Context / Map | 四视图真实组件渲染；Map 800/420px、浅/深色 | 本轮主要问题集中区 |
| Files、Terminal、Artifacts、Preview | 源码；文档全屏预览截图 | 工具语义允许差异，公共控件需要统一 |
| 项目列表、看板、日历 | 代表组件截图 + 源码 | 看板颜色负担偏重；列表窄屏处理不足 |
| 设置与消息平台连接 | 公共设置组件和页面源码 | 结构总体一致；Messaging 页面预览受 provider 错误阻断 |
| Automations | 卡片截图 + 编辑/列表源码 | 折叠态接近主风格；展开态的小标题偏密 |
| Onboarding | Welcome 截图 + 公共组件源码 | 大留白和品牌标志有场景依据，可保留 |
| 浏览器面板与空状态 | Playground 框架截图 + 生产组件源码 | 工具栏一致；默认提示列表偏长 |
| Dialog / Popover / Tabs | 源码 + Dialog 计算样式 | 声明与实际动效存在冲突 |
| WebUI / viewer | CSS、MotionConfig 入口源码 | 共享问题会传播；未做真机或完整分享页验收 |

这是一轮跨模块审视与代表场景验证，不代表所有页面、真实数据规模、主题预设和运行中状态均已完成视觉验收。未测帧率，不把静态观察描述为性能结论。Messaging Playground 的 `useNavigation must be used within NavigationProvider` 是预览阻断，不据此判断生产页面坏掉。

## 应保留的视觉基线

- 表面以背景色及少量 foreground 混色分层；可交互元素使用轻微悬停底色。
- `shadow-minimal` 承担卡片轻抬升；更强阴影用于浮层和拖拽。
- 文字与图标优先表达信息，accent 表达当前选择；状态色用于有意义的状态。
- 紧凑列表、简洁的聊天正文、文档阅读时更宽松的留白。
- 已建立的 60 / 100 / 160 / 220 / 280ms 动效时长和响应式弹簧。
- 工作台 Tab 活动背景、侧栏展开和日历视图切换已经有可复用的实现。

不要把所有界面改成同一种密度。图、终端、代码差异、文档、看板具有不同的信息结构；应统一控件、文字层级和状态规则。

## 优先处理的问题

### 1. P1 · Map 颜色声明失效，节点视觉结构丢失

**已复现。** `TrajectoryMapView.module.css` 有 57 行使用 `hsl(var(...))`；当前 `--background`、`--foreground`、`--accent` 等是完整的 OKLCH/color-mix 颜色，而非 HSL 分量。组合后的颜色无效。

浏览器实测节点 `backgroundColor = rgba(0,0,0,0)`、`boxShadow = none`，画布 `backgroundImage = none`；`CSS.supports('color', 'hsl(oklch(0.62 0.13 293))') = false`。文字继承默认色，而写死的 `#9b7ad5` / `#d59642` 仍生效，关系色比节点本身更突出。

**方向：** 先改用合法的现有主题变量与透明度表达，恢复表面/边界/选择状态。不要仅把目前失效的所有装饰恢复出来：代码中还叠加了网格、点阵、4px 色条、外圈和大模糊阴影，恢复后也应做减法。建议中性节点、单一轻边界；当前会话与选中节点使用不同的细节标识；关系类型通过线型、图标和小标签表达，减少紫橙色的大面积竞争。

定位：`packages/ui/src/components/trajectory/TrajectoryMapView.module.css:1`。

### 2. P1 · Map 的常驻详情栏挤占地图，缩放使标题无法阅读

**已复现。** 420px 外框中，可用内容宽 418px，详情栏 260px，地图只有 158px；同一组三节点样本在 800px 时约 53%，缩窄后约 9%。详情栏初始就存在，因为默认选中当前会话。

低于 62% 时虽然隐藏了预览和元信息，但标题仍随整个画布缩小，不能解决阅读问题。5% 的最小缩放适合看拓扑分布，不适合充当默认阅读状态。

**方向：** 窄面板默认优先地图，详情按需作为覆盖层或替换视图打开；宽面板再提供并排 inspector。初次定位以当前节点的可读性为先，将“显示全部”保留为显式操作。低缩放使用真正的简化节点表达，避免缩小整段文档。断点应依据地图和详情的最小可用宽度确定。

定位：`TrajectoryMapView.tsx:88`、`:100` 与样式中的 `.inspector`、`@container trajectory`。

### 3. P1 · Run 字体桥接为空，工具栏和事件正文意外变大

**已复现。** `trajectory-theme.css` 写了 `--dsw-font-family: inherit`，这会继承同名自定义属性，并不会取得元素的 `font-family`。父级未定义该属性时，依赖它的字体简写变量也失效。

浏览器中 `--dsw-font-family` 和 `--dsw-font-xxs-12` 均为空；原本分别设计为 11/12px 的过滤按钮和表格均变成 `15px / 22.5px`。时间轴与若干标签仍使用明确的 8/9px 代码字体，造成比例割裂。

**方向：** 接入真实字体栈变量，或拆开 font-family / font-size / line-height。修复后重新判断密度，而不是根据失效后的画面再加一层字号覆盖。代码信息用 mono，普通标题与内容跟随用户字体设置。

定位：`packages/ui/src/components/trajectory/trajectory-theme.css:7`、`TrajectoryTable.module.css:20`、`TrajectoryToolbar.module.css:58`。

### 4. P1 · 一批局部主按钮使用了主题中不存在的 primary 色

**计算样式与源码确认。** 多处使用 `bg-primary`、`text-primary`、`text-primary-foreground`，但桌面与共享主题没有相应颜色定义。浏览器样本中 `bg-primary` 为透明，`text-primary` 继承正文颜色；对照 `bg-accent` 正常得到主题紫色。

影响位置包括 Artifact 接受操作、TaskTile 添加操作、WorkItemEditor 等。它们可能呈现为没有主次区分的文字按钮，和公共 Button 的 `bg-foreground text-background` 不一致。

**方向：** 先按操作语义复用公共 Button 或已有 foreground/accent 变量。是否增加兼容别名需要单独决定，不能为了让类名生效就把所有主操作统一染紫。另有 `border-border-strong` 引用也需要一并清理或定义。

定位：`apps/electron/src/renderer/components/artifacts/ArtifactCard.tsx:137`、`components/app-shell/kanban/TaskTile.tsx:534`、`components/app-shell/kanban/WorkItemEditor.tsx`。

### 5. P2 · Run 的卡片、徽章和次要文字层级过密

**视觉判断 + 源码。** Overview 同时出现指标卡、环境信息表、Run shape 容器、Run brief 卡、Needs attention 容器和底部入口卡。Context 又采用概览卡、分类容器、内嵌原文底色和徽章。很多信息不需要独立的边框或阴影。

Overview 的 `text-[10px] ... text-muted-foreground/65`、Inspector 的 `/50`、`/60` 等，在已经偏淡的文字色上再次减弱。Context 原文使用 10px，Map 的比例/元数据为 9/10px。浅色下可读性比聊天正文弱得多。

**方向：** Overview 保留关键指标区，环境信息折叠次要字段；“无异常”使用安静的状态行；分类内容用分组标题和轻分隔线。正文以 12–13px 作为起点，辅助信息 11–12px；8–10px 限于极少量图表刻度，不承担重要操作或长文本。最终以实际中英文与主题对比度验证，不做全局机械替换。

定位：`TrajectoryOverview.tsx:108`、`TrajectoryContextView.tsx:138`、`:211`、`RecordInspector.tsx:52`。

### 6. P2 · 看板同时使用多套颜色强调

**视觉判断 + 源码。** 彩色列标题、整列底色、项目色条、卡片项目染色、状态徽章和运行强调同时存在。颜色分别表达列、项目、任务状态、运行状态，读者需要不断切换解释。主列表与聊天要安静得多。

**方向：** 优先测试“中性列背景 + 小面积列状态标识 + 项目色条”的组合；降低列标题实心色块权重。项目 tint 作为可选表达，避免与列底色叠加。运行时突出一个活动标记即可。保留项目自定义色能力，不把所有颜色去掉。

定位：`components/app-shell/kanban/KanbanColumn.tsx:115`、`:181`，`TaskTile.tsx:145`。

### 7. P2 · 看板列编辑器强制深色，破坏浅色模式连续性

**源码确认，未对该弹层单独截图验收。** 自定义列的 Popover 显式带 `dark`，同时指定背景模糊、饱和度和固定 8px 圆角。公共浮层已有主题背景、圆角和阴影规则。

**方向：** 跟随当前主题并使用公共 Popover 表面；保留颜色选择器的彩色内容。删除按钮使用 destructive 语义色，避免再引入独立 red 色。

定位：`apps/electron/src/renderer/components/app-shell/kanban/KanbanColumn.tsx:263`。

### 8. P2 · 同级内容切换缺少统一节奏

**源码确认 + Run 点击检查。** 工作台外层 Tab 使用活动背景弹簧，打开内容面板有 160ms 入场；Run 四个子视图却直接条件挂载，指示线也是即时替换。RecordInspector 的 Tab 指示器有动效，但 inspector 本体直接出现/消失。项目 List/Board/Calendar 的外层替换没有共享过渡；日历自己的 Day/Week/Month 已有过渡。

**方向：** 同级视图保留容器，只做短淡入与活动指示器移动；详情展开/关闭才需要短距离位移或尺寸过渡。保持滚动、筛选、地图位置及焦点，不通过每次重新挂载来制造动效。日历现有实现应复用其语言，必要时缩短串行退出+进入的总等待。

定位：`TrajectoryView.tsx:322`、`RecordInspector.tsx:237`、`ContextWorkbenchTabs.tsx:124`、`SurfaceSlot.tsx:210`、`ProjectManagementSurface.tsx`、`CalendarView.tsx:893`。

### 9. P2 · 浮层动效声明与全局禁用规则冲突

**已复现普通 Dialog。** Dialog/Popover 包装器带 `animate-in` / `animate-out` 类，但全局 CSS 对多种 Radix 浮层设 `animation: none !important`。普通 Dialog 实测 `animationName = none`、`animationDuration = 0s`，尽管 `transitionDuration` 是 0.22s。仅添加 duration 类并不能产生入场。

**方向：** 先明确哪些浮层需要动效，再在基础组件层统一实现并清理冲突。普通确认框可用遮罩淡入 + 很轻的内容淡入；高频菜单保持近乎即时。不要直接删除全局禁用规则而激活所有历史缩放/滑入类。还需确认生成 CSS 中的动画工具类有效。

定位：`apps/electron/src/renderer/index.css:880`、`components/ui/dialog.tsx:42`、`components/ui/popover.tsx:35`。

### 10. P2 · 窄屏信息布局需先改善，再考虑动效

**源码确认；列表宽屏已截图。** WorkItemList 保留 `min-w-[760px]` 的六列表格，窄面板会横向滚动。Map 的问题更严重，见第 2 项。Run 内部不同详情模式对窄屏的处理也不一致：RecordInspector 已支持覆盖整个区域，Map 仍并排。

**方向：** 列表在窄宽度保留任务名与状态，将项目/到期/进度改为次行或详情。统一“宽屏并排、窄屏替换”的 inspector 规则。Tab 操作区缩减次要动作并保留溢出入口，不用更小字体解决空间不足。WebUI 的移动端 1.2 倍缩放需在真机上复验这些布局。

定位：`WorkItemListView.tsx:134`、`RecordInspector.tsx:237`、`apps/webui/src/index.css`。

### 11. P3 · 空状态缺少按场景分级的规范

**视觉判断 + 源码。** 普通 PanelEmptyState 是带渐变/双边界图标容器的居中引导；Context 无数据时只有一句文字；Browser 则有大卡片和整列提示按钮。浏览器示例把大量快捷提示同时展示，首屏像教学目录。

**方向：** 区分首次使用、无内容、无搜索结果、加载失败。首次使用可带少量示例；普通无数据用图标和两行文案；失败提供恢复动作。浏览器只展示少量代表提示，其余展开。Onboarding 的更大留白合理，应保留。

定位：`components/content-panels/PanelEmptyState.tsx`、`TrajectoryContextView.tsx`、`packages/ui/src/components/ui/BrowserEmptyStateCard.tsx:41`。

### 12. P2 · 动效规范已存在，但局部实现与减少动态效果支持仍需收口

**源码确认，尚未运行全部状态的动态验收。** Map 140ms、Trajectory 120ms、SettingsRadioGroup 本地 spring、SessionFilesSection 的本地时长等仍绕开公共规范。JS 驱动的 BrowserControls 渐变进度条使用 `backgroundPosition` 和无限 repeat，却没有组件级 reduced-motion 分支；全局 CSS 无法停止 JS 持续改写样式，MotionConfig 也不应被当作所有非 transform 动画的停止开关。

**方向：** 保留合理的持续运行反馈，但同一局部区域只需一个主要活动信号；完成后停止。手动拖拽、滚轮缩放立即跟随指针；定位当前节点、适配全部等按钮操作可短暂平滑。对 JS 重复动画显式处理 reduced motion。迁移动效常量时，不把所有动画都换成弹簧。

定位：`packages/ui/src/lib/motion.ts`、`styles/motion.css`、`components/ui/BrowserControls.tsx:289`、`apps/electron/src/renderer/components/right-sidebar/SessionFilesSection.tsx`。

## 建议的克制动效规则

以下是沿用已有规范的实施起点，尚未实现或宣称通过动态验收。

| 场景 | 建议 | 避免 |
| --- | --- | --- |
| 悬停、按下、状态颜色 | 100ms；颜色/透明度为主 | 列表整行放大、位置漂移 |
| Run 同级视图、筛选模式 | 100–160ms 淡入；指示器短距离移动 | 内容整页横飞、长时间等退出 |
| 用户展开详情/分组 | 160–220ms；小幅位移或高度变化 | 流式更新时持续重排动画 |
| 小浮层 | 100–160ms；轻微淡入，可选 2–6px | 大幅缩放、明显弹跳 |
| Dialog | 160–220ms；背景淡入、内容轻入场 | 强制给所有菜单同样重量 |
| 工作台/侧栏 | 保留已有响应式弹簧；拖动调整时直跟 | 拖拽也用弹簧追赶鼠标 |
| Map 定位/适配按钮 | 160–220ms 视口过渡 | 滚轮、拖拽自动缓动 |
| 地图节点折叠 | 有必要时 160ms 连贯重排 | 每条边依次绘制、节点逐一弹入 |
| 运行中反馈 | 一个稳定 spinner/小状态标记 | 同区域持续脉冲+扫光+闪烁 |
| reduced motion | 保留清楚的静态状态，禁用位移及循环 | 只改 CSS 时长而遗漏 JS repeat |

## 后续实施顺序与验收点

1. **修基础：** Map 合法颜色、Run 字体变量、primary 引用。验收计算样式及浅/深色，不先叠加装饰。
2. **修布局：** Map 的窄面板 inspector、初始可读比例；再统一 Run 四视图的标题、工具栏、留白和文字层级。
3. **做减法：** 收敛 Overview/Context 的卡片层数、看板的重复颜色、浮层主题偏离和空状态密度。
4. **补切换：** Run 视图、inspector 与分组展开。沿用既有 token，保留滚动/焦点/选择状态。
5. **补跨端验收：** 桌面浅/深色，窄/宽工作台，WebUI 真机，中/英文，长标题、很多节点、空/错误/加载/运行中状态，以及 reduced motion。

初步视觉矩阵使用 420 / 560 / 800px 面板宽度。地图另测单节点、多分支、多子任务及持续更新；字体和颜色还需检查用户字体/主题预设。测试遵循仓库要求：只跑涉及行为的必要聚焦测试，不因本次文档审视运行全套测试。

## 视觉证据

所有图片均为当前代码的渲染样本，不是修改后的设计稿。Run 使用合成的两轮会话与三节点关系，不代表真实业务数据规模。

| 图片 | 用途 |
| --- | --- |
| [Map · 800px](assets/ui-audit-2026-09-06/run-map.png) | 颜色失效及节点阅读比例 |
| [Map · 420px](assets/ui-audit-2026-09-06/run-map-narrow.png) | 常驻详情挤占画布 |
| [Map · 深色窄面板](assets/ui-audit-2026-09-06/run-map-dark.png) | 深色下同样存在布局与表面问题 |
| [Run Overview](assets/ui-audit-2026-09-06/run-overview.png) | 卡片与元数据层级 |
| [Run Trajectory](assets/ui-audit-2026-09-06/run-trajectory.png) | 字体桥接失败后的字号比例 |
| [Run Context](assets/ui-audit-2026-09-06/run-context.png) | 分类、原文与徽章密度 |
| [看板](assets/ui-audit-2026-09-06/kanban-board.png) | 多重颜色编码 |
| [项目列表](assets/ui-audit-2026-09-06/work-item-list-view.png) | 更安静的表格视觉基线 |
| [会话列表](assets/ui-audit-2026-09-06/entity-list-sessions.png) | 应保留的紧凑风格 |
| [TurnCard](assets/ui-audit-2026-09-06/turn-card.png) | 应保留的内容与工具摘要层级 |
| [自动化卡片](assets/ui-audit-2026-09-06/automation-card.png) | 折叠态的轻表面 |
| [文档预览](assets/ui-audit-2026-09-06/document-overlay.png) | 合理的阅读场景差异 |
| [浏览器空状态](assets/ui-audit-2026-09-06/browser-frame-playground.png) | 提示列表占据首屏 |
