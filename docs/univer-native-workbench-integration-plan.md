# CraftAgent 全局界面收敛与 Artifact Workbench —— 重规划 v2

- 日期：2026-08-22（2026-08-24 更新）
- 状态：实施中（M1/M1.5/M2/M3/M4 核心实现及当前平台真实窗口验收已完成；M1.5 的 saved view/history/detail peek 增强已落地；M5–M6 与跨平台 packaged smoke 待继续）
- 当前工作分支：`codex/right-panel-audit-replan`
- 本文取代：2026-08-20 版“Craft Agent 原生能力工作台 —— 最终实施方案”
- 核心原则：**产品界面与呈现模型优先，文档引擎可替换；Univer 是候选实现，不是产品架构本身。**

---

## 0. 结论先行

本轮真正要解决的不是“把 Univer 接进 CraftAgent”，而是以下产品问题：

1. 现有 session、board、calendar、diff、files、context、preview、trajectory、sources、skills、settings 等视图缺少稳定的层级与归属；
2. 面板、预览、文件变化与 Agent 产物之间没有统一生命周期；
3. Agent 可以生成文件，但生成结果缺少像参考截图那样的**会话内呈现、持续预览、人工修订、接受或丢弃**闭环；
4. 当前单车道多面板 + LRU 模型把“导航”“主任务”“上下文工具”“产物”混成了同一种面板。

因此，新的实施主线是：

> **先建立统一 Surface 模型和通用 Artifact Workbench，再把 Univer、现有 doc-tools 或其他编辑/渲染引擎作为适配器接入。**

### 重规划后的决策

| # | 决策 | 结论 |
|---|---|---|
| R1 | 第一目标 | 全局梳理与修剪视图，建立稳定的界面与呈现模型 |
| R2 | 产品抽象 | 使用通用 `Artifact`，不在产品状态和 UI 协议中写死 `Univer` 或 `Office` |
| R3 | 主界面 | 单一 Primary Surface；`session`、`project-management`、管理页按语义占据主区，不再都是并排 peer panel |
| R4 | 上下文区域 | 固定、可调宽、可折叠的 Context Workbench；一次显示一个 tab，可全屏 |
| R5 | 会话内产物 | Agent 产物以可回放的 Artifact Card 留在对应 Turn，可展开、打开工作台、全屏和审阅 |
| R6 | 浏览器 | 保持独立 BrowserWindow，不嵌入 DOM 工作台 |
| R7 | 产物安全 | 使用 CraftAgent 自有 draft revision、版本校验和原子提交；不依赖 Univer Pro worktree |
| R8 | 标准文件交付 | Agent 优先直接生成 `.xlsx/.docx/.pptx`；只有内部模型与交付格式不同时才需要“导出” |
| R9 | Univer 定位 | 推荐作为 Sheet 的首个交互式引擎；不是全套 Artifact 的唯一引擎 |
| R10 | 功能范围 | 能独立实现的 UI、审阅、生成、验证、预览先实现；Pro 专属能力设置显式决策门，不伪装成 OSS 能力 |
| R11 | 现有 doc-tools | 全部保留并增强，包括 `xlsx-tool`、`docx-tool`、`pptx-tool`、`pdf-tool`、`img-tool`、`ical-tool`、`doc-diff`、`markitdown` |
| R12 | Git | 只在当前分支实施；不切分支、不自动提交、不推送 |
| R13 | 项目管理视图 | Projects、Board、Calendar 属于同一 Project Management Surface；Board 与 Calendar 是同级投影，Gantt/Timeline 暂不实现，只保留可扩展 view contract |
| R14 | 项目管理导航 | 全局侧栏只保留一个 Projects 入口和真实项目子项；Overview/List/Board/Calendar 只在 Surface 页头切换，固定在右上角 |
| R15 | Plane 借鉴边界 | 借鉴 WorkItem、Layout/View、History、Intake 等领域设计并独立实现；不嵌入 Plane 本体、不复制 AGPL 代码、不引入其多服务部署栈 |

### 0.1 当前实施快照

截至 2026-08-24，当前分支已经落地 M1–M4 的核心结构，但**整份 M0–M6 路线图没有全部完成**：

- 新增 `ProjectManagementView = 'overview' | 'list' | 'board' | 'calendar'`，从 `SessionsNavigationState` 移除 Board/Calendar view mode；
- canonical route 改为 `/projects/board`、`/projects/calendar`；旧 `/board`、`/calendar` 作为一个迁移窗口内的兼容别名；
- TopBar 的 Board、Calendar peer 按钮收敛为单一 Projects 入口；Surface 内使用 Overview/List/Board/Calendar 同级切换；
- 全局侧栏只保留 Projects 单一入口及真实项目子项，不再重复显示 List、Board、Calendar；“跳到该项目会话”保留在项目列表上下文菜单；
- Overview/List/Board/Calendar 的同级切换器统一固定在各自页头右上角；左侧只放当前视图的范围、筛选、日期和创建动作；
- `projects/gantt` 当前明确无效，不注册路由、不显示入口、不创建占位页面；
- 新增权威 `PrimarySurfaceState + WorkbenchState`；旧 `panelStackAtom`、hidden-panel/LRU 状态和等宽 peer panel 布局已删除；
- desktop 使用“弹性 Primary + 固定宽 Workbench”，Workbench 支持 typed tabs、激活/关闭、折叠、360–960px 调宽和全屏；只有 active item 挂载；
- compact 模式中 Workbench 替换 Primary，并通过返回动作折叠；Board/Calendar 被正确识别为 Project Management detail；
- `activeSessionId` 只由 Primary Session 与其 sticky memory 决定，Workbench 获得焦点不再篡改全局导航；
- 新 URL 协议使用 `sv=2 + route/workbench/wa/wo/ww`；旧 `panels/fi/sidebar` 和 hidden bound-panel 状态只在恢复时迁移，不再写回；
- 已移除“新面板打开 Session”、Shift/Alt 替换 peer panel 等失效入口；新窗口仍是独立、明确的动作；
- 旧 `?sidebar=files|history` 深链迁移为 Workbench 的 `files|trajectory`，主进程到 renderer 的兼容字段已补齐；
- M1/M1.5 自动化回归已通过 Electron/Shared/Server 类型检查、单元测试、renderer/main/preload 构建、i18n parity/sort/coverage 与 Electron lint；当前平台真实 Electron 窗口 E2E 已执行，跨平台 packaged smoke 仍待执行；
- M1.5 已完成 `WorkItem` 契约、版本化原子存储、公共 query/filter/sort/selection、RPC 与跨窗口变更广播；Board 已改为 durable WorkItem，List 已成为同级视图，Calendar 聚合带日期 WorkItem 与独立日程；
- 旧 Board 可见顶层 Session 只迁移一次，之后普通会话不会被隐式当成任务；Task/TaskRunner 流程显式创建或同步 WorkItem，任务可无 Session 或关联多个 Session；
- M1.5 增强已新增持久化 `WorkItemViewDefinition`：List/Board/Calendar 共用命名视图、默认视图、scope/filter/search/sort/schedule 条件，并支持创建、更新、设为默认与删除；
- M1.5 增强已新增原子写入的 `WorkItemEvent` 历史：创建、修改、状态迁移、关联/解除关联与删除均记录结构化 before/after，并区分 user、agent、automation、system actor；旧数据升级不会伪造历史；
- M1.5 增强已把任务详情改为 Project Surface 内响应式 detail peek，底层投影保持挂载；详情支持编辑、父子/依赖关系、Agent 会话动作和 Activity 时间线，并用 canonical work-item route 支持恢复与 back/forward；
- M2 已完成引擎无关 Artifact 领域、不可变 revision、写租约、CAS/原子接受、崩溃恢复、Turn Card、Workbench、普通文件适配、用户专属 accept/discard 和 canonical Agent tools；
- M3 已增强 XLSX/DOCX/PPTX 结构化生成与 inspect，Presentation 增加 bounds、overlap/overflow/off-page lint 和 SVG 联系表；Office 草稿使用 MarkItDown 生成绑定 revision 的本地 Markdown preview；
- Office 文件打开也会进入 Artifact Workbench；真实 XLSX 已自动化验证“draft → validate → preview → ready → accept”，接受前不触碰最终路径；doc-tools 全量 22 项及额外 DOCX/XLSX/PPTX preview smoke 均通过；
- M4 已完成 Univer OSS Sheet adapter、Headless/renderer snapshot 操作、懒加载编辑器、typed mutation、只读接受态和真实窗口“编辑→保存→提交→接受”闭环；
- 当前尚未完成的是跨平台 packaged smoke、M5 的其他内容引擎决策，以及 M6 的高保真 Office 商业决策门。

### 0.2 里程碑状态（不得把“本轮完成”误读为“全计划完成”）

| 里程碑 | 当前状态 | 剩余工作 |
|---|---|---|
| M0 规划冻结与基线 | 设计契约及当前平台关键指标已记录 | 把指标固化为预算，并补跨平台基线 |
| M1 全局 Surface 收敛 | **核心实现、自动化回归及当前平台 UI/E2E 完成** | 跨平台 packaged smoke |
| M1.5 Project WorkItem | **核心迁移及 saved view/history/detail peek 增强完成并通过自动化与 Playground 回归** | Gantt 仍只预留；丰富 filter operator、批量编辑及 PM-P2+ 能力按真实需求推进 |
| M2 Artifact Card + Draft Review | **完成并通过聚焦回归及当前平台主闭环 E2E** | 补历史 Turn/多会话专项矩阵与跨平台 smoke |
| M3 标准 Office 直接生成 | **完成并通过聚焦回归** | 更高保真视觉预览属于后续 provider/引擎增强，不阻塞标准文件交付 |
| M4 Univer OSS Sheet | **核心实现、构建与当前平台真实窗口 E2E 完成** | 大表降级、跨平台 packaged smoke 与长期性能预算 |
| M5–M6 其他引擎与商业门 | 未开始 | 按各自验收条件推进 |

---

## 1. 参考截图真正值得实现的是什么

用户提供的两个 DSH × Univer 截图分别展示了 Slide 与 Sheet。它们吸引人的部分可以拆成两个层次。

### 1.1 与具体编辑器无关的产品闭环

这些能力可以在 CraftAgent 内完整实现，不依赖 Univer：

- Agent 创建或修改产物后，会话内立即出现 Artifact Card；
- 卡片显示文件名、路径、类型、草稿名、状态与版本；
- 卡片可折叠、恢复、全屏；
- 当前 Turn 的草稿持续更新，历史 Turn 保留当时状态；
- 用户可以继续用自然语言要求 Agent 修改；
- 用户可以人工打开编辑器修改；
- 草稿可以“接受当前版本”或“丢弃”；
- 产物与对应 session 隔离，不跨会话串状态；
- Agent 在提交前可 inspect、render、lint，并把验证结果留在会话中。

### 1.2 依赖内容引擎的编辑能力

下面的能力取决于选用的文档引擎，无法只靠 UI 外壳获得：

- Excel 风格公式、格式、图表、数据验证、透视表；
- Word 风格分页、页眉页脚、复杂表格与版式；
- PowerPoint 风格图层、形状、图表、转场、播放和母版；
- Office 文件的高保真导入、编辑后再导出；
- 文档内部历史、实时协作、changeset 合并；
- Base、Board 等复合 Unit。

### 1.3 CraftAgent 的呈现选择

参考截图把完整编辑器长期嵌在聊天流中。CraftAgent 采用更稳健的三层形态：

1. **Artifact Card**：留在会话 Turn 中，负责状态、缩略预览、验证摘要和审阅入口；
2. **Context Workbench**：持久、可调宽的交互编辑区，负责常规查看与编辑；
3. **Fullscreen Surface**：复杂 Sheet/Doc/Slide 的深度编辑。

宽屏可以让卡片懒加载内嵌预览，但完整编辑器的权威实例默认在 Workbench/Fullscreen，避免聊天滚动区同时挂载多个重型编辑器。

---

## 2. DSH × Univer Office 可复用性评估

参考项目：[dream-num/dsh-univer-office](https://github.com/dream-num/dsh-univer-office)。截至本次核查，公开版本为 `0.2.9`，仓库源码标注 Apache-2.0。

### 2.1 可以复用的部分

- Artifact/Turn 卡片的产品思路；
- draft → ready → merged/discarded 的状态机；
- “Client 只是状态投影，服务端状态才是权威真相”的边界；
- 工具返回结构化 artifact/worktree/unit 标识，不解析 Bash 文本；
- Viewer、后台 worker、Host service、浏览器 Client 分层；
- inspect、lint、screenshot 各自证明不同事实的验证思路；
- 用户才拥有 merge/discard 决策权。

这些理念应重新实现为 CraftAgent 自己的领域模型，而不是把 DSH 插件作为运行依赖。

### 2.2 不能直接移植的部分

虽然仓库外壳是 Apache-2.0，但截图中的完整能力并不是纯公开 Univer OSS 组合：

- `.npmrc` 把 `@univerjs`、`@univerjs-pro`、`@univer-cli` 指向 `insider-npm-registry.univer.work`；
- Viewer、Gateway、协作 worktree、历史、Office exchange、Slide/Base/Board 等依赖大量 `1.0.0-insiders` 与 `@univerjs-pro/*` 包；
- Worker 源码内明确包含“90-day development license”，并注明需要轮换；
- 源码构建需要私有 registry；npm 发布物通过预构建 Viewer/Gateway/Worker 携带运行能力；
- `dsh-univer-office@0.2.9` 发布包解包约 157 MB，且依赖 DSH 的 Cordis、session、tools、attachment 和 webServer 接口；
- Apache-2.0 只覆盖仓库自身源码，不能推定其 Pro 依赖、预构建产物或开发 license 可被复制到 CraftAgent。

### 2.3 结论

| 路线 | 结论 |
|---|---|
| 把 DSH 插件直接嵌进 CraftAgent | 拒绝；Host API、运行时、体积、授权和版本都不合适 |
| 复制其 Gateway/Viewer/License | 拒绝；不可维护且存在明确授权风险 |
| 复制 Apache Client 组件 | 技术上可研究，但与 DSH API 强耦合；优先按 CraftAgent 设计重写 |
| 复用产品交互与进程边界 | 推荐；这是 DSH 最有价值、也最可持续的部分 |
| 商业接入 Univer Pro | 保留为独立商业决策门；需官方稳定 SDK、书面授权和成本评估 |

**结论：截图的产品体验可以实现；截图中的完整 Office 功能不能通过移植公开仓库无条件获得。**

---

## 3. Univer 开源仓库是否“功能齐全”

参考：[dream-num/univer](https://github.com/dream-num/univer)、[Univer Pro 能力说明](https://docs.univer.ai/guides/pro)。截至 2026-08-22，公开稳定线为 `0.25.1`；DSH 使用的是 `1.0.0-insiders`。

Univer 是可组合 Office SDK，不是 Microsoft Office 的完整开源替代品。官方仓库当前也明确区分 OSS 与 Pro。

| 能力 | Univer OSS | Pro/商业层 | 对本项目的判断 |
|---|---|---|---|
| Sheets 基础编辑 | workbook、range、公式、数值格式、过滤/排序、数据验证、条件格式、批注、超链接、表格、绘图等 | — | OSS 最成熟，适合作为首个交互式引擎 |
| Sheets 高级能力 | — | 导入导出、打印、图表、透视表、sparkline、outline、shape、增强公式、历史与协作 | 参考截图中的可编辑图表并非纯 OSS 能力 |
| Docs | 文档模型、基础编辑 UI、列表、链接、批注、drawing、quick insert | DOCX exchange、打印、增强表格/列表、分栏、callout、code、quote、shape、协作 | 可做基础编辑实验，但不能承诺完整 Word 体验 |
| Slides | 开源 presentation model/UI 包 | Pro slide model/UI、PPTX exchange、图表、表格、shape editor | 官方仍说明处于开发中；不作为生产主线 |
| Base | 可利用通用插件架构自行构建 | 完整 Base 模型、字段、公式、workbench UI | 不能把架构扩展点等同于现成功能 |
| Board/Canvas | 通用 drawing/render 基础 | Board、mind、table、chart、print 等 | DSH 截图级能力依赖 Pro |
| Headless | Node.js Headless、Facade、基础公式和自动化 | server calculation、协作服务、changeset replay | OSS 可用于 Sheet snapshot 操作 |
| XLSX/DOCX/PPTX import/export | 不提供开箱即用的高保真实现 | exchange server/client | 不能作为 OSS 里程碑验收 |
| Collaboration/worktree/history | 不提供 DSH 那套完整实现 | Pro collaboration/history/worktree | CraftAgent 需要自建本地 draft revision |

官方来源：

- [Univer OSS/Pro 能力矩阵](https://github.com/dream-num/univer#-what-you-can-build)
- [Headless Univer](https://docs.univer.ai/guides/sheets/getting-started/node)
- [Sheets 导入导出](https://docs.univer.ai/guides/sheets/features/import-export)
- [Docs 导入导出](https://docs.univer.ai/guides/docs/features/import-export)
- [Slides 当前状态](https://docs.univer.ai/guides/slides)

### 3.1 引擎路线判断

| 路线 | 优点 | 代价 | 决策 |
|---|---|---|---|
| Univer OSS 混合路线 | Electron/React 可嵌入、Sheet 成熟、浏览器与 Headless 同构、Apache-2.0 | Office exchange 与大量高级功能缺失 | **推荐**，先用于 Sheet |
| Univer Pro | 最接近 DSH 完整效果 | 商业许可、服务端组件、版本和体积成本 | 商业决策门，不进入默认实现 |
| ONLYOFFICE Docs | OOXML 编辑和转换功能完整 | DocumentServer、AGPL-3.0 或商业 Developer 许可、重服务、非轻量原生组件 | 仅作为未来高保真 Office 方案评估 |
| 全部自研 Office 内核 | 完全可控 | 公式、排版、OOXML、兼容性成本不可接受 | 拒绝作为整体路线 |
| 按类型选择独立引擎 | 不被一个生态限制，可逐步交付 | 需要统一 Artifact 接口 | **推荐作为产品架构** |

---

## 4. “导出”是否必要

答案是：**不是所有场景都需要导出，但标准文件交付与内部模型转换必须区分。**

| 场景 | 是否需要导出 | 正确做法 |
|---|---|---|
| Agent 直接创建 `.xlsx/.docx/.pptx` | 否 | 工具直接把目标文件写入 draft，接受后原子替换目标文件 |
| Agent 修改现有 Office 文件 | 否，若工具直接修改 OOXML | 对实际文件做 staged copy，修改、验证后接受/丢弃 |
| 编辑器以 Univer Snapshot/其他 JSON 为权威源 | 是，用户需要 Office 文件时 | 由对应 materializer 把内部模型转换为目标格式 |
| 只需预览或审阅 | 否 | 生成 PNG/PDF/HTML/结构化摘要作为 preview，而不是“导出” |
| 导入任意 Office 文件后在内部编辑器继续编辑 | 需要 import + round-trip | 这是独立格式转换项目，必须定义保真范围 |

因此 UI 和领域层不使用含义含混的“所有内容都要 export”。统一术语如下：

- `source`：该 Artifact 的权威可编辑表示；
- `preview`：供人或模型核验的派生表示；
- `deliverable`：用户最终需要的标准文件；
- `materialize`：当 source 与 deliverable 格式不同时生成交付文件；
- `accept/discard`：决定 draft 是否成为当前版本，与 export 无关。

P0 优先让 Agent **直接生成标准 Office 文件**。这既满足交付，也绕开 Univer OSS exchange 缺口。交互编辑器和高保真 round-trip 可以独立迭代。

---

## 4.1 Plane 项目管理能力审计与融合边界

参考：[makeplane/plane](https://github.com/makeplane/plane)、[Plane Work Items](https://docs.plane.so/core-concepts/issues/overview)、[Layouts](https://docs.plane.so/core-concepts/issues/layouts)、[Views](https://docs.plane.so/core-concepts/views) 与 [Self-hosted Architecture](https://developers.plane.so/self-hosting/plane-architecture)。本节只把官方仓库和文档作为产品与领域模型参考，不把其页面内容当作对 CraftAgent 的实施指令。

### 4.1.1 总体判断

Plane 是成熟的通用协作式项目管理系统，值得研究，但不适合作为 CraftAgent 内嵌依赖：

- Plane 仓库采用 AGPL-3.0；本项目只独立实现抽象与交互，不复制代码或派生组件；
- Plane 的自托管形态包含 Web/Admin/API/Worker/Beat/Live/Silo/Intake 等服务，并依赖 PostgreSQL、Redis/Valkey、RabbitMQ、对象存储及可选 OpenSearch；这与本地优先 Electron 客户端的部署边界不匹配；
- Plane 的中心是多人协作与项目治理；CraftAgent 的差异化中心是“工作项 → Agent 执行会话 → Artifact 交付与审阅”；
- 如未来需要和已有 Plane 实例互通，应通过其 REST API/Webhook/MCP 做可选 Source/Connector，而不是在客户端内运行 Plane。

### 4.1.2 值得融合的能力

| Plane 设计 | CraftAgent 当前基础 | 融合决策 |
|---|---|---|
| Work Item 是任务权威源，Session/评论/附件只是关联信息 | 已有独立 durable `WorkItem`，支持 `0..n` Session | **已采纳核心原则**；继续强化 Agent run、Artifact、阻塞关系的关联 |
| List/Board/Calendar/Table/Timeline 都是同一数据的 Layout | 已有 Overview/List/Board/Calendar 同级投影 | **立即坚持**；全局侧栏不为 Layout 建重复入口，Gantt/Timeline 仍不实现 |
| View = filters + layout + display options + sort 的命名、持久化镜头 | 已有 workspace-scoped `WorkItemViewDefinition`，支持命名、默认、保存/更新/删除并跨 List/Board/Calendar 应用 | **已完成核心能力**；后续按真实使用补更丰富 operator 与 display options |
| 丰富过滤器与明确 operator | 当前 query 只有项目、状态、列、日期、搜索等基础条件 | **渐进采纳**；先补 `is/is-not/is-empty/before/after/between`，不引入 PQL |
| Work Item 详情保留 Activity/Transition/History | 已有持久化 `WorkItemEvent`，记录 actor、上下文和结构化 before/after | **已完成核心能力**；后续可增加评论、人工摘要与事件聚合展示 |
| 详情以 side peek/modal/full screen 保持列表上下文 | 已有 Surface 内响应式 detail peek，底层投影保持挂载，并通过 canonical route 恢复详情 | **已完成核心能力**；详情不占用 Artifact Workbench |
| Module 把大项目拆成有目标、有周期、有进度的工作包 | 当前只有 Project 与 parent/dependency | **中期采纳为 Project Group/Module**；先证明一个 WorkItem 可归属多个 group 的需求 |
| Cycle 是限定时间的执行批次 | 当前有日期、状态和 Calendar | **中期可选**；映射为 Agent work cycle，不默认强迫所有项目采用 sprint |
| Project/Work Item Update 用 On Track/At Risk/Off Track 建状态时间线 | Agent 已有会话与运行事实，但缺少项目级摘要 | **中期采纳**；优先让 Agent 从 WorkItem/run/artifact 事实生成可审阅快照 |
| Intake 先进入 Triage，再接受/拒绝进入项目 | Sources、Automations、New Session 都可能产生工作请求 | **后期采纳**；建立统一 Work Intake，防止外部输入直接污染 active backlog |
| Analytics 从状态、周期、模块和 Intake 聚合 | 当前数据量与单用户场景有限 | **延后**；先提供 Overview 的少量可行动指标，拒绝先造大而全 Dashboard |

### 4.1.3 明确暂不融合

- 多租户组织、复杂 RBAC/permission scheme、SSO 与计费；
- 多人实时光标、评论线程、订阅者、通知 Inbox 与 emoji reaction；
- Customers/CRM、工时计费、投票、公开发布空间；
- Plane 的 Django/API/Worker/消息队列/数据库部署架构；
- 为“功能齐全”一次性加入 Epics、Initiatives、Milestones、Releases、Cycles、Modules、Analytics 等全部名词；
- 在依赖语义、日期拖拽与关键路径算法未完成前显示空的 Timeline/Gantt 入口。

### 4.1.4 Plane 启发的项目管理实施顺序

```text
PM-P0  导航收敛：全局只有 Projects；四种当前 Layout 在页头右上角切换
  ↓
PM-P1  ✓ WorkItemViewDefinition：跨 List/Board/Calendar 共用并持久化 filter/sort/scope
  ↓
PM-P1  ✓ WorkItemEvent：Activity / Transition / History，明确 user/agent/automation/system actor
  ↓
PM-P1  ✓ Surface 内 detail peek + 父级/依赖编辑；批量编辑与 richer filter operators 后续按需推进
  ↓
PM-P2  Project health update + 少量可行动 Overview 指标
  ↓
PM-P2  Module / optional Cycle（经真实 Agent 项目验证后再建模）
  ↓
PM-P3  Work Intake / Triage 与可选 Plane API Connector
  ↓
Gate   Timeline/Gantt、关键路径、多人协作与大规模 Analytics
```

这一路线吸收 Plane 最强的“领域模型与镜头”能力，但保持 CraftAgent 的产品辨识度：项目管理不是独立终点，而是组织 Agent 工作、执行证据与 Artifact 交付的控制面。

---

## 5. 全局 Surface 模型

统一界面不等于“所有页面都进右侧栏”。正确做法是按任务语义决定位置。

```text
┌──────────────┬──────────────────┬────────────────────────────┬──────────────────────┐
│ Global Nav   │ Navigator        │ Primary Surface            │ Context Workbench    │
│ 工作区/入口   │ 列表/筛选/选择     │ 当前主任务                   │ 当前主任务的上下文工具   │
│              │                  │ session / project mgmt     │ files / diff / ...   │
│              │                  │ management page            │ artifact / preview   │
└──────────────┴──────────────────┴────────────────────────────┴──────────────────────┘
                                         │
                                         ├─ Turn Artifact Card
                                         ├─ Fullscreen Surface
                                         └─ External BrowserWindow
```

### 5.1 现有视图归类

| 视图 | 新归属 | 说明 |
|---|---|---|
| Session/Chat | Primary Surface | 单一主任务，不被 LRU 驱逐 |
| Projects/List/Board/Calendar | Project Management Primary Surface | 全局侧栏只有 Projects；四种视图仅在 Surface 页头右上角切换，是同一 WorkItem 集合的同级投影 |
| Gantt/Timeline | Project Management 扩展点 | 当前不实现、不显示空入口；view contract 与任务字段允许以后新增 |
| Sources/Skills/Settings | Management Primary Surface | 保留 navigator + detail 语义，不与 session 上下文混用 |
| Files | Context Workbench | 跟随 active session，可 pin |
| Diff/Review | Context Workbench | 文本文件变化查看；不承担 Artifact accept/discard 事务 |
| Context | Context Workbench | 只展示当前主任务上下文，移除与全局导航重复的内容 |
| Trajectory | Context Workbench | 跟随当前 session，只读 |
| Preview | Context Workbench + Artifact Card | 普通文件预览统一进入 Artifact/Preview 体系 |
| Sheet/Doc/Slide/其他产物 | Artifact Workbench | `artifact` 是通用类型，具体引擎由 kind 决定 |
| Browser | External BrowserWindow | 保持现有独立进程与登录态，不进入 DOM 分栏 |

### 5.2 状态模型

不继续用一个 `PanelStackEntry[]` 同时模拟主区、右区和后台。目标状态应明确拆分：

```ts
interface PrimarySurfaceState {
  route: ViewRoute
  kind: 'session' | 'project-management' | 'management'
}

type ProjectManagementView = 'overview' | 'list' | 'board' | 'calendar'

interface ProjectManagementSurfaceState {
  scope: { type: 'workspace' } | { type: 'project'; projectId: string }
  view: ProjectManagementView
}

interface WorkbenchState {
  open: boolean
  activeItemId: string | null
  items: WorkbenchItem[]
  width: number
  expandedItemId: string | null
}
```

关键规则：

- Primary 同时只有一个；session 的后台运行属于 session 领域状态，不再通过隐藏 UI panel 表达；
- Workbench 可以保留多个 tab，但同时只挂载一个重型交互视图；
- Workbench tab 可以绑定 session，也可以 pin 为 workspace 级；
- `activeSessionId` 由 Primary Session 决定，不能再由“当前任意 focused peer panel”反推；
- 桌面端 Workbench 固定在右侧，可调宽、折叠、全屏；
- `<768px` 紧凑模式下 Workbench 替换 Primary 显示并提供返回，不强行固定分屏；
- full screen 与 docked 视图共享同一 item 状态，避免重挂载丢失编辑内容。

Project Management 的 `view` 是已启用视图的显式联合类型，而不是任意字符串。未来实现 Gantt/Timeline 时扩展同一个 view registry；当前不把未实现视图加入路由、导航或空白占位页。

Project Management 的页头也只有一个布局契约：右侧固定放全局投影切换器，左侧放当前投影自己的 scope/filter/search/create/date controls。全局侧栏只承担进入 Projects 和选择真实项目，不重复承载 Layout 导航。

### 5.3 URL 与持久化迁移

当前 `?panels=`、`?fi=`、旧 `?sidebar=` 和 hidden-panels localStorage 需要一次显式迁移：

1. 第一个真实 session 或当前 focused 主视图映射为 Primary；
2. 最近一个 bound panel 映射为 Workbench active item；
3. 其他旧 bound panel 去重后进入 Workbench tabs，不继续并排；
4. hidden session 不恢复成隐藏 UI panel；session 的运行与持久化继续由 session 领域负责；
5. 老链接至少保留一个发布周期的解析兼容；新链接使用明确的 primary/workbench 参数；
6. 不同时运行两套权威状态；迁移解析器保留一个发布周期，确认遥测/回归后再删除兼容入口。

Board/Calendar 先做一项独立的兼容迁移：旧 `/board`、`/calendar` 仍可解析，但 canonical route 改为 `/projects/board`、`/projects/calendar`。旧书签和持久化 panel 可恢复，新生成的 URL 不再把它们编码为 Sessions view mode。

### 5.4 Project Management 数据边界

界面归并不等于立即伪造统一数据。当前代码中 Board 把顶层 Session 投影为任务，而 Calendar 使用与 Session 独立的 workspace calendar entry。第一阶段先统一 Surface、路由和入口；随后再引入明确的 `WorkItem` 领域模型：

```ts
interface WorkItem {
  id: string
  projectId?: string
  title: string
  description?: string
  statusId: string
  columnId?: string
  startAt?: string
  dueAt?: string
  progress?: number
  dependencyIds: string[]
  parentId?: string
  sessionIds: string[]
  primarySessionId?: string
  isMilestone?: boolean
  createdAt: number
  updatedAt: number
}
```

- `statusId` 与 `columnId` 必须分离：现有 Board 已允许任务位于 In Progress 列但保留 Needs Review 状态，合并会破坏现有语义；
- `startAt/dueAt` 接受 `YYYY-MM-DD` 或 ISO 本地/带偏移日期时间；date-only 永远保持 date-only，不能因 UTC 转换跨日；
- Board 按 column/status 投影；
- Project Calendar 按 start/due/milestone 投影；
- 未来 Gantt 才消费 duration/dependencies/progress；
- Session 是 WorkItem 的执行与对话记录，关系为 `0..n`，不再等同于任务本身；`primarySessionId` 只表示从任务进入时优先打开的会话；
- 全局日历可以聚合 WorkItem、独立日程、自动化和提醒，但 Project Calendar 默认只显示项目范围来源。

`WorkItem` 迁移前不把独立 CalendarEntry 强行改写为 Session，也不基于 Session 时间戳制作“伪甘特图”。

迁移已按四个可验证切片落地，运行时只有 WorkItem 一个任务权威源：

1. **M1.5-a（完成）**：建立共享契约、版本化原子存储、关系校验、公共查询、RPC/广播和 renderer hook；
2. **M1.5-b（完成）**：首次读取时把旧 Board 可见顶层 Session 一次性迁为 durable WorkItem；Board 所有读写改按 item id 执行，WorkItem 先持久化再 best-effort 镜像主 Session；
3. **M1.5-c（完成）**：Calendar 聚合有日期的 WorkItem 与独立 CalendarEntry，并提供 project/workspace scope；新增 List，同 Board/Calendar 共用 filter/sort/selection；
4. **M1.5-d（完成）**：移除 renderer legacy adapter；迁移 marker 写入后不再从新 Session 隐式推导任务，只有显式 Task 流程会注册 WorkItem。

---

## 6. 通用 Artifact Workbench

### 6.1 Artifact 领域模型

Artifact 代表“Agent 与用户共同生产、可预览、可验证、可接受或丢弃的结果”，不等于文件扩展名，也不等于 Univer Unit。

```ts
type ArtifactKind =
  | 'spreadsheet'
  | 'document'
  | 'presentation'
  | 'data'
  | 'diagram'
  | 'pdf'
  | 'image'
  | 'html'
  | 'text'

interface ArtifactDescriptor {
  id: string
  sessionId: string
  workspaceId: string
  kind: ArtifactKind
  engineId: string
  sourcePath: string
  baseRevision: string | null
  draftRevision: string | null
  status: 'current' | 'draft' | 'ready' | 'accepted' | 'discarded' | 'conflict'
  capabilities: ArtifactCapabilities
  previews: ArtifactPreview[]
  deliverables: ArtifactDeliverable[]
}
```

产品 UI 只消费 Descriptor 和 capabilities，不直接判断 `@univerjs/*`、Python 工具或具体文件格式。

### 6.2 生命周期

```text
用户请求
  ↓
创建 Artifact draft（记录 base revision）
  ↓
Agent 或用户编辑 source
  ↓
inspect / calculate / lint / render / screenshot
  ↓
ready（等待审阅，不改 current）
  ├─ revise → 回到 draft
  ├─ accept → compare-and-swap + 原子替换 → accepted
  └─ discard → 丢弃 draft → discarded
```

规则：

- Agent 可以创建、编辑、验证和提交 ready；
- accept/discard 是用户 UI 动作；如保留 Agent 工具，也必须显式用户请求并走审批；
- 文本 `ReviewPanel` 继续服务普通代码 diff；Artifact Review 使用独立状态与 UI；
- 每次工具结果写入结构化 `artifactId/revision/status/kind/preview` 事件，会话卡片可回放；
- 不从 Bash 输出或自然语言猜测产物状态。

### 6.3 本地事务与并发

P0 不实现 CRDT 或实时协作，采用清晰的本地单写者协议：

- draft 保存于 CraftAgent 管理的 revision 目录或同目录安全临时文件；
- manifest 记录 `baseRevision`、内容 hash、目标路径和生成器版本；
- accept 使用 compare-and-swap，当前文件变化时进入 `conflict`，不覆盖；
- 文件提交使用 write-to-temp + fsync/close + atomic rename；
- Office 二进制写入扩展 `FileSystemInterface`，禁止用 UTF-8 `writeFile` 代替；
- 交互编辑器 dirty 时持有写租约，Agent 修改需要等待、保存或创建新 draft；
- 崩溃后可以发现未终结 draft，允许恢复或丢弃；
- preview、deliverable 与 source 都带 revision，防止用户审阅 A、最终却提交 B。

---

## 7. 引擎无关架构

### 7.1 Engine Contract

```ts
interface ArtifactEngine {
  readonly id: string
  readonly kinds: readonly ArtifactKind[]
  probe(input: ArtifactInput): Promise<ArtifactCapabilities>
  createDraft(request: CreateArtifactRequest): Promise<ArtifactRevision>
  inspect(request: InspectArtifactRequest): Promise<ArtifactInspection>
  apply(request: ApplyArtifactOperationsRequest): Promise<ArtifactRevision>
  render(request: RenderArtifactRequest): Promise<ArtifactPreview[]>
  materialize?(request: MaterializeRequest): Promise<ArtifactDeliverable>
  dispose(artifactId: string): Promise<void>
}
```

`apply` 必须是有 schema 的 discriminated union；禁止把任意 JavaScript、Facade 表达式或 shell 作为 `artifact_execute` 透传。

### 7.2 首批 Engine

| Engine | 权威 source | P0/P1 能力 | 限制 |
|---|---|---|---|
| Existing Preview Engine | 原始文件 | image/pdf/text/code/json/markdown/html 预览 | 只读 |
| Office Binary Engine | `.xlsx/.docx/.pptx` | 直接生成/修改、inspect、静态 preview、标准文件交付 | 当前工具能力较基础，需增强 |
| Univer Sheet Engine | `IWorkbookData` versioned snapshot | Sheet 交互编辑、基础公式、格式、过滤、验证、条件格式、Headless 操作 | 不承诺 XLSX exchange、chart/pivot/print/history |
| Document Engine | 待 spike：Univer Docs OSS 或独立富文本模型 | 基础文档交互、结构化生成、DOCX materializer | 不承诺 Word 全保真 round-trip |
| Presentation Engine | 先采用结构化 deck spec + PPTX 生成与渲染 | Agent 生成、缩略图/联系表、布局 lint、标准 PPTX 交付 | 完整 WYSIWYG 编辑器是后续大项目 |
| Data/Diagram Engine | 独立 data-grid / diagram SDK | Base-like 数据、图表、画布按需实现 | 不等待 Univer Base/Board |

### 7.3 Agent 工具

权威注册点是 `packages/session-tools-core/src/tool-defs.ts`。建议工具面向 Artifact 领域，而不是面向某个 SDK：

- `artifact_status`：只读，列出 artifact/revision/capability；
- `artifact_create`：创建 typed draft；
- `artifact_inspect`：只读结构化检查；
- `artifact_apply`：按 kind 使用严格 operation schema 修改；
- `artifact_render`：生成 preview/screenshot；
- `artifact_submit`：将 draft 标记为 ready；
- `artifact_materialize`：仅当 source 与 deliverable 不同才调用；
- accept/discard 默认只作为用户 RPC；若暴露给 Agent，必须 `safeMode: block` 且需要明确审批。

底层现有 `xlsx-tool`、`docx-tool`、`pptx-tool` 可以先由 Office Binary Engine 调用，之后逐步迁入 typed handlers。Pi、Session MCP 和其他 backend 从 canonical registry 派生，不分别维护工具清单。

---

## 8. 分阶段实施计划

### M0：规划冻结与基线（短阶段）

当前状态：**设计契约完成，当前平台关键指标已记录。** 已记录真实窗口 shell/editor ready、进程树 RSS 与 Univer lazy chunk；下一步把它们固化为可回归预算，并补跨平台基线。Project Management 与 Surface 类型已进入代码；不再为已删除的 peer-panel 模型增加运行时 feature flag。

目标：先把产品语义和迁移契约定死，不安装 Univer。

- 确认 Surface 分类表；
- 定义 `PrimarySurfaceState`、`ProjectManagementSurfaceState`、`WorkbenchState`、`ArtifactDescriptor` 和状态机；
- 将现有 Board/Calendar 从 Sessions view mode 迁入 Project Management view registry，兼容旧路由；
- 定义旧 URL/localStorage 迁移规则；
- 为现有面板、doc-tools、构建体积和启动内存记录基线；
- 为风险较高的后续 Artifact/Engine 接入增加独立 feature flag；Surface 状态本身保持单一权威源。

验收：设计类型和状态转移测试通过；不存在“全部其他视图都塞右栏”的模糊项。

### M1：全局 Surface 收敛（核心里程碑）

当前状态：**核心实现、自动化回归和当前平台真实窗口 E2E 完成。** 下列条目均已进入当前分支；M1 仍需跨平台 packaged smoke 才标记最终完成。

目标：不依赖 Office 引擎，先完成真正的产品梳理。

- 把单一 `panelStackAtom` 拆成 Primary + Workbench；
- session/project-management/management 进入 Primary；
- Projects、Board、Calendar 收敛为同一 Project Management Surface 的 `overview/board/calendar` 同级视图；
- 移除 TopBar 中 Board、Calendar 两个 peer Surface 入口，改为单一 Projects 入口和 Surface 内视图切换；
- 全局左侧栏移除 List/Board/Calendar 重复入口，只保留 Projects 与真实项目子项；
- Overview/List/Board/Calendar 的投影切换器统一置于页头右上角，视图局部动作统一留在左侧；
- Gantt/Timeline 本阶段不实现、不显示入口，只确保以后扩展 view registry 无需再次改写全局导航；
- files/diff/context/trajectory/preview 进入 Workbench；
- Workbench 支持 tab、固定右栏、调宽、折叠、全屏；
- compact 模式实现替换式导航；
- TopBar 散落按钮收敛为 Workbench launcher + tabs；
- 完成 URL、back/forward、workspace 恢复和快捷键迁移；
- 保持独立 BrowserWindow。

验收：

- Primary 永远只有一个；
- Workbench 一次只挂载一个重型视图；
- 后台 session 不依赖隐藏 panel；
- 老 URL 可迁移，新 URL 可回放；
- desktop/compact、键盘焦点、全屏与恢复都有测试。

### M1.5：Project WorkItem 领域收敛

当前状态：**核心迁移及 saved view/history/detail peek 增强完成，并通过相关自动化与 Playground 回归。** Board/List/Calendar 已消费同一 durable WorkItem 集合；一次性旧数据迁移与 Session/TaskRunner 单向兼容同步已落地。命名/默认视图、actor-aware 领域历史、响应式详情侧栏和 work-item canonical route 已落地；更丰富的 filter operator、批量编辑与 PM-P2+ 能力不属于本轮。

目标：在不阻塞 Artifact 主线的前提下，让项目管理各视图逐步消费同一任务模型。

- 定义 `WorkItem` 与 Project、Session、CalendarEntry 的关联和迁移策略；
- Board 从“Session 即 Task”迁到 WorkItem projection；
- Calendar 支持 project scope 与 workspace aggregate scope；
- List/Board/Calendar 共用 query、filter、sort 与 selection；
- 为未来 Gantt 预留日期、进度和依赖字段，但不开发 Gantt renderer、路由入口或交互。

验收：修改一个 WorkItem 后，List/Board/Calendar 的现有投影一致；一个任务可以没有 Session，也可以关联多个执行 Session。

### M2：通用 Artifact Card + Draft Review

目标：先复刻截图最有价值的交互闭环。

实施状态（2026-08-24）：**已完成核心实现、聚焦回归和当前平台主闭环 E2E。** Artifact manifest/revision、事件、RPC、canonical Agent tools、Turn Card、Workbench、租约、CAS、原子接受与恢复均已落地；真实窗口已验证 Sheet 草稿编辑、保存、提交、接受和最终文件更新。

- 建立 Artifact Service、revision manifest、事件协议和恢复逻辑；
- 会话 Turn 渲染统一 Artifact Card；
- 卡片支持折叠、打开 Workbench、全屏、状态、验证摘要；
- 实现 draft/ready/revise/accept/discard/conflict；
- 实现版本 hash、写租约、CAS、原子提交和崩溃恢复；
- 普通 preview 文件也接入 Artifact Card，消除 PreviewPanel 的无限孤立 tab；
- accept/discard 使用独立 Artifact Review，不复用文本 ReviewPanel 的数据模型。

验收：用 text/json/image/pdf 先完成完整闭环；关闭并重启应用后 draft 与历史卡片状态仍正确。

### M3：标准 Office 文件直接生成与验证

目标：回答“Agent 能否直接生成文件”——可以，并先把这条路径做好。

实施状态（2026-08-22）：**已完成本阶段验收。** 三类 Office CLI 已支持结构化生成与 inspect；Presentation 具备布局 lint 和 SVG 联系表；Office Artifact 使用本地 MarkItDown preview。真实 XLSX 已跑通不经 Univer export 的完整 review/accept 事务，DOCX/XLSX/PPTX 均有生成、结构加载和人可见 preview smoke。

- 增强 `xlsx-tool`：batch range、公式、样式、合并、条件格式、数据验证、图表、图片和结构化 inspect；
- 增强 `docx-tool`：样式、表格、图片、页眉页脚、分节、页面设置和模板；
- 增强 `pptx-tool`：主题、布局、文本框、shape、图片、表格、图表、notes、元素 bounds；
- 增加跨平台 preview/render spike，优先使用可分发的本地实现；外部 LibreOffice/ONLYOFFICE 只能作为可选 provider；
- Presentation 增加 overlap/overflow/off-page lint 和联系表；
- 所有生成先进入 Artifact draft，验证后由用户接受；
- 保留 markitdown 与现有工具回归测试。

验收：Agent 可直接交付 `.xlsx/.docx/.pptx`，不经过 Univer export；每种文件都有结构检查和人可见 preview。

### M4：Univer OSS Sheet Engine

目标：加入第一个成熟的交互式 Artifact Engine，而不是改造产品架构。

实施状态（2026-08-24）：**核心实现、构建与当前平台真实窗口 E2E 已完成。** `artifact-engine-univer`、Headless/renderer adapter、lazy editor、typed mutation、只读接受态、资源释放和最终文件事务已经落地；后续工作是大表降级、跨平台 packaged smoke 与长期性能预算。

- 创建 `packages/artifact-engine-univer`；
- renderer 懒加载 `@univerjs/preset-sheets-core@0.25.1`；
- Headless 使用 `@univerjs/preset-sheets-node-core@0.25.1`；
- 所有 `@univerjs/*` 精确锁定同一版本；
- source 使用 versioned `IWorkbookData` snapshot；
- 支持基础公式重算、range inspect 和 typed mutation；
- 建立 renderer dirty state 与 Agent draft 写租约；
- 验证 Electron main CJS bundle、renderer Vite、standalone server 打包和资源释放；
- chart 先作为独立 chart Artifact 或 preview，不冒充 Univer OSS 原生可编辑 chart。

验收：同一 snapshot 可在 Headless 和 renderer 往返，公式结果一致；冲突不会静默覆盖；不把 `.xlsx` import/export 写入本阶段验收。

### M5：Docs、Slides、Data、Diagram 的独立决策

目标：尽量实现有价值的能力，但不被 Univer 的产品边界绑住。

- Docs：对比 Univer Docs OSS 与独立富文本引擎，按分页需求、数据模型、导出保真和体积做 spike；
- Slides：生产默认仍走 deck spec + PPTX generation + preview/lint；Univer OSS Slides 只在实验 flag 下验证；
- Data/Base：优先复用 CraftAgent 自身数据模型、SQLite 和 data-grid，而非等待 Univer Pro Base；
- Diagram/Board：评估独立 canvas/diagram engine，作为 Artifact kind；
- Chart：作为可嵌入 Sheet/Doc/Slide 的共享 Artifact/asset，而不是绑定某个 Office SDK。

验收：每个引擎单独证明价值、体积和可维护性；不要求所有 Artifact 共用同一 SDK。

### M6：高保真 Office 商业决策门

只有在以下需求成为硬要求时进入：

- 任意 XLSX/DOCX/PPTX 高保真导入、编辑、再导出；
- 可编辑图表、pivot、sparkline、复杂 Word 排版、完整 Slide 编辑；
- 协作、文档内部历史、changeset/worktree；
- 与 DSH 当前 Pro Viewer 接近的功能覆盖。

候选：

1. 与 Univer 商议 Pro 正式授权和稳定版本；
2. 评估 ONLYOFFICE Developer/DocumentServer 集成、部署和许可证；
3. 接受按类型自研的长期成本。

在商业、授权、包体、离线和跨平台条件确认前，不进入实现。

---

## 9. 当前代码落点与影响范围

### 9.1 Surface 迁移

- `apps/electron/src/renderer/atoms/workbench.ts`：Primary/Workbench 唯一权威状态、路由分类、迁移与动作；
- `apps/electron/src/renderer/atoms/active-session.ts`
- `apps/electron/src/renderer/contexts/NavigationContext.tsx`
- `apps/electron/src/renderer/contexts/surface-url.ts`
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
- `apps/electron/src/renderer/components/app-shell/SurfaceContainer.tsx`
- `apps/electron/src/renderer/components/app-shell/SurfaceSlot.tsx`
- `apps/electron/src/renderer/components/app-shell/ContextWorkbenchTabs.tsx`
- `apps/electron/src/renderer/components/app-shell/WorkbenchResizeSash.tsx`
- `apps/electron/src/renderer/components/app-shell/ExpandedWorkbenchOverlay.tsx`
- `apps/electron/src/renderer/components/projects/ProjectManagementSurface.tsx`
- `apps/electron/src/renderer/components/projects/ProjectManagementViewTabs.tsx`
- `apps/electron/src/renderer/lib/surface-launchers.ts`
- `apps/electron/src/shared/routes.ts`
- `apps/electron/src/shared/route-parser.ts`
- `apps/electron/src/shared/types.ts`
- `apps/electron/src/main/deep-link.ts`、`apps/electron/src/main/window-manager.ts`、`packages/shared/src/protocol/dto.ts`：旧 sidebar 深链透传与迁移兼容。

已删除而非继续兼容的运行时实现：`panel-stack.ts`、`hidden-panels.ts`、`PanelStackContainer.tsx`、`PanelSlot.tsx`、`PanelResizeSash.tsx`、`ExpandedPanelOverlay.tsx`。旧 URL/localStorage 仅由迁移函数读取。

### 9.2 WorkItem 数据层

- `packages/shared/src/work-items/types.ts`：canonical `WorkItem`、mutation 与 query 契约；
- `packages/shared/src/work-items/storage.ts`：`work-items/items.json` v1 原子 CRUD、关系/环校验与损坏数据 fail-closed；
- `packages/shared/src/work-items/query.ts`：List/Board/Calendar 共用 query/filter/sort/selection；
- `packages/server-core/src/handlers/rpc/work-items.ts`、`packages/shared/src/protocol/*`：RPC、远端允许列表与 workspace change broadcast；
- `apps/electron/src/renderer/hooks/useWorkItems.ts`：renderer collection 与跨窗口刷新；
- `packages/server-core/src/sessions/SessionManager.ts`：Task/TaskRunner 与主 Session 元数据到 WorkItem 的单向兼容同步；删除 Session 时只解除关联、不删除任务；
- `apps/electron/src/renderer/components/app-shell/kanban/KanbanBoardContainer.tsx`：durable WorkItem Board，零 Session 快速建任务、按需创建执行会话；
- `apps/electron/src/renderer/components/app-shell/kanban/WorkItemListView.tsx`、`WorkItemEditor.tsx`：List 投影、批量选择与通用任务编辑；
- `apps/electron/src/renderer/components/app-shell/kanban/CalendarView.tsx`：WorkItem 与独立 CalendarEntry 聚合投影。

### 9.3 Artifact UI 与状态

- M1 已新增 `atoms/workbench.ts`；Artifact 权威状态由 shared manifest + server RPC 持有，renderer 使用 `useArtifacts` 投影，不再复制第二份权威 atom；
- 已新增通用 `ArtifactCard`、`ArtifactTurnCards`、`ArtifactWorkbench`；accept/discard 事务直接属于 Artifact Workbench/Card；
- `bound-panel-content.tsx` 增加通用 artifact dispatcher，而不是 `OfficePanel` 特判；
- 普通可预览文件与 Office 文件通过 `registerCurrentArtifact` 进入同一 Workbench；`FilePreviewContent.tsx` 作为轻量 renderer adapter 复用；
- `ReviewPanel.tsx` 保持文本 diff 职责。

### 9.4 Agent 与服务端

- `packages/session-tools-core/src/tool-defs.ts`：canonical schemas、safeMode、readOnly、handlers；
- `packages/session-tools-core/src/context.ts`：typed Artifact callback 与结果接口；二进制工具只写受管 `editablePath`，原子提交集中在 shared Artifact store；
- `packages/shared/src/agent/pi-agent.ts`：继续使用 canonical proxy，不单独定义工具；
- `packages/server-core`：Artifact Service、revision store、RPC 与 watcher；
- `scripts/build-server.ts`、`scripts/electron-build-main.ts`：新增 workspace package 和运行依赖；
- `apps/electron/resources/scripts/*_tool.py`：Office Binary Engine 的第一阶段实现。

---

## 10. 验证矩阵

### 10.1 单元测试

- Surface 分类、状态转移、compact 行为；
- URL/localStorage 迁移；
- Artifact 状态机和非法转移；
- path scope、revision hash、CAS、原子提交；
- typed operation schema；
- safe/read-only/mutating 工具分类一致性。

### 10.2 集成测试

- Agent 工具事件 → Artifact Card → Workbench 恢复；
- draft → ready → revise/accept/discard；
- renderer dirty 与 Agent 写入冲突；
- 应用崩溃/重启后的 draft 恢复；
- Office 文件生成、inspect、preview 与 accept；
- Headless/renderer Sheet snapshot 往返与公式结果。

### 10.3 UI/E2E

- Primary/Workbench 切换、折叠、调宽、全屏；
- 历史 Turn 卡片默认折叠且状态不漂移；
- 多 session 状态隔离；
- desktop/compact、键盘导航与 back/forward；
- 重型编辑器不因 dock/fullscreen 切换而丢失未保存内容。

### 10.4 构建与性能

- Electron 主进程 CJS bundle；
- renderer Vite code split、CSS/theme、worker；
- standalone server package copy；
- macOS/Windows/Linux packaged smoke；
- 首次打开延迟、bundle 增量、常驻内存、多 Artifact dispose；
- 大 Sheet、长 Doc、多页 Slide 的 preview 上限与降级策略。

---

## 11. 明确不做与停止条件

### 当前不做

- 不直接移植 DSH 的 Pro Gateway、Viewer、worktree 或 embedded license；
- 不把全部视图强塞进右侧栏；
- 不用一个 `PanelStackEntry[]` 继续模拟所有 Surface；
- 不把任意 JavaScript/Facade/shell 暴露为通用 `execute` 工具；
- 不在 Univer OSS 上承诺 XLSX/DOCX/PPTX 高保真 exchange；
- 不把实验性 Slides 当作生产编辑器；
- 不提前删除或降级现有 doc-tools；
- 不把 permission prompt 当成文件事务系统。

### 停止条件

出现以下任一情况时暂停对应引擎，而不阻塞 Artifact Workbench 主线：

- 需要私有 registry、轮换 license 或来源不明确的预构建代码；
- 依赖不能进入 Electron/standalone server 的发布物；
- Office round-trip 无法给出明确保真矩阵；
- 交互编辑与 Agent 写入无法做到冲突检测；
- 一个引擎的包体、内存或启动成本超过预设预算且无可靠懒加载/卸载路径。

---

## 12. 最终优先级

```text
P0  全局 Surface 收敛
 ↓
P0  Project Management 入口/路由收敛（Gantt 仅预留）
 ↓
P0  通用 Artifact Card + Draft Review
 ↓
P0  标准 Office 文件直接生成、验证、预览
 ↓
P1  Univer OSS Sheet 交互引擎
 ↓
P1  ✓ Project saved views + WorkItem activity/history/detail peek
 ↓
P1  Docs / Presentation 独立引擎验证
 ↓
P2  Data / Diagram / Chart 复合能力
 ↓
Gate 高保真 Office / Pro / 外部 DocumentServer
```

这条顺序保证：即使最终不用 Univer，核心产品改造和大部分 Agent 产物体验仍然成立；如果采用 Univer，也只需要实现一个 Engine Adapter，而不用再次重写全局界面。

---

## 附录：对本轮四个问题的直接回答

1. **核心是否应该是全局梳理与修剪？**
   - 是。新版规划已把它放在 P0，并纠正了“所有视图进右栏”的过度收敛。统一的是 Surface 语义、状态和生命周期。

2. **DSH 截图效果能否实现？**
   - 卡片、持续预览、全屏、草稿、验证、接受/丢弃、历史 Turn 等产品闭环可以实现；Sheet 基础交互也可用 Univer OSS 实现。完整图表、PPT、Office exchange、历史/worktree 等若要求同等能力，需要 Univer Pro、其他 Office 服务，或显著的自研投入。

3. **导出是否必要，Agent 能否直接生成文件？**
   - Agent 可以并且应该优先直接生成标准文件，此时不需要额外导出。只有内部编辑模型与交付格式不同，或要求导入后 round-trip 时，才需要 materialize/import-export 适配器。

4. **Univer 仓库功能是否齐全，能否尽量都实现？**
   - 仓库的 Sheet OSS 很强，Docs 基础可用，Slides 仍在演进；图表、pivot、Office exchange、打印、协作、历史、完整 Slide/Base/Board 等关键能力位于 Pro。新版规划采用按类型选引擎，因此能实现的能力不会因为 Univer OSS 边界而被整体卡住。

5. **Plane 有哪些能力值得融合？**
   - 优先融合 saved view、丰富 filter、WorkItem activity/history、Surface 内 detail peek；随后再评估项目健康快照、Module、可选 Cycle 与 Intake。Plane 本体采用 AGPL 且依赖重型多服务架构，因此只借鉴领域模型并独立实现；未来互通走可选 API/Webhook/MCP Connector。
