# Craft Agents 性能优化专项审视与实施规划

> **状态：** 提议中的专项规划，尚未开始实施
> **评估日期：** 2026-09-01
> **适用范围：** Desktop/Electron、Renderer、Server Core、Durable Runtime、会话持久化、搜索、构建与性能门禁
> **证据边界：** 本文基于评估当日的本地源码、工作区结构和已有 `apps/electron/dist` 产物进行静态审视。未执行正式 packaged benchmark、生产遥测分析或完整构建，因此文中“已确认”仅表示代码路径或复杂度已确认；实际耗时、内存占用和收益必须由 Phase 0 基线验证。评估时工作区存在未提交变更，正式基线必须固定 commit、依赖锁文件和工作区指纹。

## 一、总体结论

本项目的性能专项不应从零散的 `memo`、缓存或局部重构开始。当前最值得优先处理的是三条主链路：

1. 长会话流式更新随历史长度退化；
2. Desktop 冷启动加载和解析体量过大；
3. JSONL 持久化、启动扫描与搜索仍受文件数量和会话长度约束。

项目已经具备若干正确的性能基础：

- session 列表仅加载元数据，正文按需加载；
- Chat 首屏仅渲染最近 20 个 turn；
- 服务端将流式 delta 合并为约 50ms 一批；
- session persistence 采用 500ms 防抖；
- Durable Runtime 使用 SQLite/WAL，canonical facts 与兼容投影已经有清晰边界；
- renderer 和 server-core 已有轻量 perf 工具与少量关键埋点。

当前主要缺口不是完全没有优化，而是：

- 缺少代表性负载模型；
- 缺少 packaged 环境端到端测量；
- 缺少统一性能预算和 CI 回归门禁；
- 若干热路径虽然限制了 DOM 数量，却没有限制完整历史上的计算和复制成本；
- 兼容层持久化仍承担与 canonical runtime 重叠的高成本工作。

专项应遵循以下顺序：

```text
可重复测量
    ↓
首屏与启动边界
    ↓
长会话流式热路径
    ↓
持久化、Catalog 与搜索规模化
    ↓
次级子系统与持续性能治理
```

## 二、评估范围与规模

本轮重点审视以下区域：

| 区域 | 主要职责 | 性能关注点 |
| --- | --- | --- |
| `apps/electron/src/main` | Electron 主进程、窗口、Browser pane、RPC 桥接 | 启动解析、初始化顺序、子系统延迟加载、主进程阻塞 |
| `apps/electron/src/renderer` | Desktop/WebUI 共用产品界面 | 首屏包体、状态订阅、流式更新、长列表、Markdown/代码渲染 |
| `packages/ui` | TurnCard、Markdown、Trajectory、通用组件 | 组件重渲染、动态高度列表、语法高亮、复杂内容渲染 |
| `packages/server-core` | SessionManager、RPC、搜索、Durable Runtime | 启动扫描、事件扇出、同步 I/O、数据库查询、会话生命周期 |
| `packages/shared` | session storage、配置、agent 与通用工具 | JSONL 读写、watcher、缓存、完整历史复制 |
| 构建脚本 | Electron、Pi server、preload、worker 构建 | 单体 bundle、重复构建、source map、增量缓存 |

抽样范围内约有 1,485 个 TypeScript/TSX 文件、292,916 行代码。复杂度中心包括：

| 文件 | 约计行数 | 性能相关职责 |
| --- | ---: | --- |
| `packages/server-core/src/sessions/SessionManager.ts` | 8,935 | session 生命周期、持久化、事件、恢复、工具、Sources |
| `apps/electron/src/renderer/components/app-shell/AppShell.tsx` | 3,697 | 产品主壳与多面板协调 |
| `apps/electron/src/main/browser-pane-manager.ts` | 3,230 | BrowserView/CDP 生命周期 |
| `packages/ui/src/components/chat/TurnCard.tsx` | 3,032 | 单 turn 的复杂展示、活动、注释、Markdown |
| `packages/shared/src/config/storage.ts` | 2,781 | 配置与持久化 |
| `packages/shared/src/agent/pi-agent.ts` | 2,633 | agent runtime |
| `packages/pi-agent-server/src/index.ts` | 2,374 | Pi subprocess server |
| `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` | 2,086 | 消息分组、搜索、滚动、流式显示 |

文件体量本身不是性能结论，但它们同时也是状态和生命周期协调中心，应优先通过测量确认其热路径。

## 三、关键发现

### 3.1 P0：缺少统一、可回归的性能基线

现有 `packages/shared/src/utils/perf.ts` 支持 span、mark、p50/p95 和最近样本；`apps/electron/src/renderer/lib/perf.ts` 支持 session switch 测量。这些工具具备复用价值，但当前存在以下限制：

- 默认仅在 debug/dev 环境启用；
- main、renderer、subprocess 各自保存数据，没有统一 trace identity；
- 数据只保存在内存或日志中；
- 没有固定 fixture、冷/热启动口径和 packaged runner；
- 没有基准结果归档、基线比较和 CI 阻断规则；
- 没有系统采集 long task、GC、FPS、文件写入量和 retained heap。

在此状态下，无法可靠回答：

- 45MB main bundle 对启动贡献多少；
- session 扫描、数据库检查、Messaging 初始化各占多少；
- 5,000 条历史消息下每批 delta 的真实成本；
- JSONL 写放大何时成为用户可感知问题；
- Browser、watcher 或消息网关是否值得优先优化。

因此 Phase 0 是专项前置门禁，而不是可选的辅助工作。

### 3.2 P0：流式更新仍随完整历史退化

服务端已经在 `SessionManager.queueDelta()` 中合并 delta，避免每个 token 都产生 IPC/WS 事件。这是正确的第一层限流。

renderer 收到每一批 delta 后仍会执行：

1. 按 `turnId` 在线性 `messages` 数组中查找 streaming message；
2. 复制完整消息数组；
3. 创建新的 session 对象并写入 per-session atom；
4. 使 `ChatDisplay` 的 `allTurns` 缓存失效；
5. 对完整历史重新运行 `groupMessagesByTurn()`；
6. 更新当前聊天组件树。

关键路径位于：

- `apps/electron/src/renderer/event-processor/handlers/text.ts`；
- `apps/electron/src/renderer/event-processor/helpers.ts`；
- `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`。

Chat 首屏虽然只截取最后 20 个 turn，但只是限制了最终渲染数组，没有限制完整历史上的查找、复制和 turn projection。因此长会话持续输出的成本仍可能接近 O(N) 每批。

该问题是本专项最明确、最值得优先消除的算法级热路径。

### 3.3 P0：首屏静态加载边界不足

评估时已有本地构建产物显示：

| 产物 | 静态大小 |
| --- | ---: |
| `apps/electron/dist/main.cjs` | 约 45.8MB |
| renderer 全部 JS | 约 19.2MB / 322 个文件 |
| `index.html` 初始 module 与 preload 依赖 | 约 8.8MB 未压缩 JS |
| source map | 约 44.7MB，正式打包配置排除 |

这些数字可能来自当前工作区之前的构建，仅用于识别调查方向，不能作为正式基线。

renderer 中几乎没有业务组件级 `React.lazy()` 或运行时动态导入边界。Settings、Trajectory、Review/Diff、PDF、Spreadsheet、Browser UI、Automation、Messaging、Markdown 与高亮能力大量汇入共享依赖。

主进程通过 esbuild 生成单一 CJS bundle。虽然 Pi runtime 和 WhatsApp worker 已经使用 subprocess/bundle 隔离，但主进程仍包含大量非首窗关键能力。

第一阶段必须先生成 Vite/Rollup 和 esbuild metafile，再决定具体拆分对象，不能仅依据 chunk 名称或 `node_modules` 目录大小判断。

### 3.4 P1：Desktop 启动具有 workspace/session 规模效应

`SessionManager.initialize()` 会对全部 workspace 串行执行：

- Durable Runtime database integrity check；
- 数据库维护；
- interrupted operation recovery；
- ConfigWatcher 和 AutomationSystem 初始化；
- session metadata 加载。

session 列表已经只读取 JSONL header，但每个 session 仍涉及：

- 目录枚举；
- `.tmp` 检查和可能的清理；
- JSONL 第一行读取与解析；
- workspace status 校验；
- plan 目录扫描以计算 `planCount`；
- metadata 排序和 ManagedSession 构造。

Desktop 当前把“后台能力全部 ready”和“首窗可交互”绑定得较紧。Headless/Automation 确实需要启动时立即具备调度能力，但 Desktop 可以在不破坏恢复语义的前提下拆分关键启动与后台初始化里程碑。

### 3.5 P1：JSONL 兼容投影存在全量写放大

`packages/shared/src/sessions/persistence-queue.ts` 已经通过以下方式保护正确性：

- 500ms debounce；
- 每 session 串行写；
- 写临时文件后原子 rename；
- 文件 fsync；
- 支持的平台上执行目录 fsync；
- 合并外部 metadata 修改，避免覆盖其他实例或手工编辑。

但每次持久化仍会：

- 将全部 message 重新 `JSON.stringify()`；
- 生成完整 `lines` 数组；
- 拼接完整 JSONL 字符串；
- 重写完整文件；
- 执行耐久化同步。

其成本随会话总长度增长。对大型工具输出、长 Markdown 和多轮 agent 任务，写入量和 CPU/GC 都可能明显放大。

专项不得通过简单取消 fsync 或改成不可靠 append 来换取速度。正确方向是继续完成 canonical runtime 切换：

- 即时耐久性由 SQLite canonical facts、usage 和 T1/T2 状态承担；
- `session.jsonl` 明确降为 UI/export compatibility projection；
- compatibility projection 在 turn 完成、idle、退出或显式导出时生成；
- 通过 cursor、dirty marker、parity audit 和重建测试保证兼容层可恢复。

### 3.6 P1：Chat 与 Trajectory 尚未真正窗口化

Chat 当前采用反向分页：首次显示最近 20 个 turn，向上滚动时每次增加 20 个。这降低了首次 DOM 规模，但存在两个边界：

- 已加载的旧 turn 不会被移出 DOM；
- 搜索会自动扩展 `visibleTurnCount` 到最早命中位置，并可能挂载大量历史内容。

因此它是渐进渲染，不是窗口化。

Trajectory 的 virtual rows 当前没有形成真正的 viewport window。千级和万级记录下，表格布局、焦点节点和 inspector 数据都会成为风险。

这两处应采用动态高度、可定位的 virtualization，并在实现时保护：

- 反向滚动位置；
- 流式 sticky-bottom；
- 搜索结果跳转；
- 注释锚点和文本选择；
- 键盘焦点与可访问性；
- 展开活动后的动态高度修正。

### 3.7 P1：renderer 中仍有多个完整数组扫描与复制点

除 text delta 外，tool/status/complete/error/annotation 等事件也会对 `messages` 执行 `findIndex()`、`some()` 或 `map()`。单次事件成本通常可接受，但在并发 agent、工具密集型 workflow 和长会话中会叠加。

建议为每个 loaded session 维护可校验的运行时索引：

- `messageId → index`；
- `turnId → assistant/streaming message index`；
- `toolUseId → tool message index`；
- `taskId → background tool index`。

索引只作为可重建缓存，canonical message array 仍保持现有序义。所有 append、replace、branch 和 reload 操作必须有索引一致性测试。

### 3.8 P2：Session catalog 与搜索仍依赖文件系统投影

当前跨会话搜索已经使用 ripgrep 和快速字符串检查，尽量避免对不相关行执行 `JSON.parse()`，这是合理优化。

但随着 session、message 和 workspace 数量增长：

- session list 启动仍需扫描目录和 header；
- `planCount` 仍需扫描每个 session 的 plan 目录；
- 搜索延迟依赖磁盘、文件碎片、杀毒软件和 JSONL 规模；
- metadata 与 message search 使用不同扫描路径，难以形成统一增量更新。

建议建立可重建的 workspace-local catalog/FTS projection，JSONL/ripgrep 保留为重建、兼容和诊断路径。该方案不得让搜索索引成为 canonical source。

### 3.9 P2：Browser、Messaging 与 watcher 需要测量后决策

Browser pane manager、CDP、Messaging Gateway、配置 watcher 和多窗口事件广播均具有潜在成本，但静态代码不足以确认它们是当前主要瓶颈。

专项第一阶段应记录：

- Browser pane 创建、导航、截图、DOM 提取和 idle detach；
- 每 workspace watcher 数量、事件速率和重复 reload；
- Messaging provider 初始化时间与常驻内存；
- 一个 agent event 的 WS、Messaging 和多窗口 fan-out 数量；
- 多窗口/多 session 下的序列化字节数。

没有数据证明前，不应先对这些子系统进行大规模重构。

## 四、性能目标与首版预算

以下预算是专项的首版验收目标，不是当前实测结果。Phase 0 完成后允许基于真实基线修订一次；修订后的预算进入 CI，不再随单次实现任意调整。

### 4.1 用户感知指标

| 场景 | 建议目标 |
| --- | ---: |
| Windows packaged 冷启动至首窗可交互 | p50 ≤ 1.8s，p95 ≤ 2.5s |
| packaged 温启动至首窗可交互 | p95 ≤ 1.5s |
| 切换至 2,000-turn 会话并显示最近内容 | p95 ≤ 250ms |
| 5,000 条历史消息下 delta 接收到可见绘制 | p95 ≤ 50ms |
| 10,000 行 Trajectory 首次显示 | ≤ 200ms |
| 1,000 sessions / 100,000 messages 搜索 | p95 ≤ 1s |

### 4.2 主线程与内存指标

| 场景 | 建议目标 |
| --- | ---: |
| 5,000 条历史消息下流式 handler | p95 ≤ 8ms/批 |
| 30 秒持续流式输出 | 不出现 >100ms renderer long task |
| 稳定流式阶段 | ≥55 FPS，掉帧需可归因 |
| 10,000 行 Trajectory | 常驻 DOM 行数 ≤200 |
| 打开并关闭大型会话后 retained heap | 回落至峰值增量的 20% 以内 |
| 1 小时持续运行 | 无单调、不可回收的 session/turn/DOM 增长 |

### 4.3 I/O、包体与工程效率指标

| 场景 | 建议目标 |
| --- | ---: |
| 初始 renderer 预加载 JS | 相比正式 Phase 0 基线减少 ≥50% |
| 非首屏重依赖 | 不进入初始 preload graph |
| streaming delta | 不触发完整 JSONL fsync |
| compatibility JSONL 全量生成 | 正常流式阶段每 turn 最多一次 |
| 性能回归门禁 | p95 恶化 >10% 或内存恶化 >15% 阻断 |
| benchmark 波动 | 固定环境下变异系数应受控，并报告异常样本 |

绝对预算若受测试机器差异影响，应同时保留相对基线门禁。两者中任一失败均需要解释，不能只选择更有利的一项。

## 五、代表性负载模型

Phase 0 必须建立版本化 fixture，禁止依赖开发者个人 workspace。

### 5.1 Workspace/session 规模

| 档位 | Workspaces | Sessions | 用途 |
| --- | ---: | ---: | --- |
| S | 1 | 100 | 普通开发与 PR 快速门禁 |
| M | 5 | 1,000 | 主分支规模测试 |
| L | 10 | 10,000 | 启动、catalog 与搜索压力测试 |

### 5.2 会话规模

| 档位 | Turns | 内容 |
| --- | ---: | --- |
| Short | 20 | 普通文本和少量工具 |
| Medium | 200 | Markdown、代码块、工具结果、附件元数据 |
| Long | 2,000 | 多次 compaction、Trajectory、annotations |
| Extreme | 10,000 | 搜索、窗口化、索引和内存压力测试 |

### 5.3 运行负载

- 1、4、10 个并发 processing session；
- 每秒 5、20、50 个合并后 agent event；
- 纯文本、tool-heavy、browser-heavy、artifact-heavy 四种 workflow；
- 200KB 截断上限附近的大工具结果；
- 1 小时 soak 和 8 小时低频长运行；
- 多窗口同时查看同一 workspace；
- Windows Defender/普通消费级 SSD 条件下的文件 I/O 场景。

Fixture generator 必须固定随机种子，并记录 schema、生成器版本和数据摘要。

## 六、实施路线

### Phase 0：性能基线与门禁基础

**预计：3–4 个工作日。**

交付项：

1. 建立 fixture generator 与标准数据集；
2. 建立 packaged Electron benchmark runner；
3. 建立跨进程 trace ID 和统一事件格式；
4. 增加启动时间点：
   - process start；
   - app ready；
   - RPC/server ready；
   - SessionManager metadata ready；
   - window created；
   - DOM ready；
   - React mounted；
   - messages ready；
   - first chat paint；
5. 增加流式时间点：
   - delta received；
   - event reduced；
   - atom committed；
   - React commit；
   - browser paint；
6. 采集 CPU、RSS、heap、GC、long task、FPS、I/O bytes、fsync count；
7. 生成 Vite/Rollup 与 esbuild metafile；
8. 输出机器可读 JSON、Chrome trace、bundle report；
9. 建立 baseline compare，但首个 PR 只报告、不阻断；
10. 基线稳定后启用预算门禁。

完成条件：

- 同一 commit 连续运行结果可重复；
- 冷启动与温启动口径明确；
- main、renderer、Pi subprocess 事件能在同一时间线上关联；
- 所有后续 PR 都能用相同命令比较前后结果。

### Phase 1：首屏与启动优化

**预计：1 周。**

工作包：

1. 为以下模块建立真正的懒加载边界：
   - Settings；
   - Trajectory/Context/Map；
   - Review/Diff；
   - PDF/Spreadsheet/Document preview；
   - Browser UI；
   - Automation editor；
   - Messaging settings/connect dialogs；
2. Shiki 只按实际语言和主题加载；
3. 检查并移除 production 首屏不必要的 React DevTools 载入；
4. 根据 metafile 延迟 main-process 非关键模块；
5. 拆分 Desktop 启动里程碑：
   - `runtime_minimum_ready`；
   - `first_window_interactive`；
   - `background_services_ready`；
6. 保留 Headless 的 scheduler/automation 强启动语义；
7. 数据库维护分级：启动轻量检查，完整维护后台运行；
8. 对首窗前同步 I/O 建立 lint/审查清单。

完成条件：

- 初始 renderer preload graph 减少至少 50%；
- Settings、PDF、Diff、Trajectory 等不再进入普通聊天首屏；
- cold/warm startup 达到预算或形成有证据的剩余瓶颈清单；
- Headless automation 恢复测试全部保持通过。

### Phase 2：流式状态隔离与长会话渲染

**预计：1–2 周。**

目标结构：

```text
Committed message store
          +
Per-session streaming turn atom
          ↓
Incremental turn projection
          ↓
Virtualized turn list
```

工作包：

1. streaming delta 不再复制完整 committed message history；
2. `text_complete` 时才把 streaming response 提交为正式 message；
3. 建立 `messageId`、`turnId`、`toolUseId`、`taskId` 运行时索引；
4. 将 `groupMessagesByTurn()` 改为增量 projection；
5. 拆分 `ChatDisplay` 的订阅边界：
   - turn list；
   - search controller；
   - scroll controller；
   - input/follow-up；
   - artifact/navigation actions；
6. 对 TurnCard、Markdown、Shiki 建立 React Profiler benchmark；
7. Chat 实现动态高度窗口化；
8. Trajectory 实现真正 row virtualization；
9. 搜索跳转通过 logical index 定位，不通过挂载全部历史实现；
10. 增加长会话、流式、注释和反向滚动的行为契约测试。

完成条件：

- 5,000 条历史消息下每批 delta 的 reducer/projection 成本不随完整历史线性增长；
- streaming 只重渲染当前 turn 及必要状态；
- Chat 和 Trajectory 常驻 DOM 有明确上限；
- sticky-bottom、搜索、annotations、branch、tool cards 行为无退化。

### Phase 3：持久化、Catalog 与搜索规模化

**预计：1–2 周。**

工作包：

1. 建立 workspace-local session catalog projection；
2. catalog 保存：
   - session header metadata；
   - plan count；
   - last final message metadata；
   - search projection cursor；
3. session list 从 catalog 读取，目录扫描降为重建/审计路径；
4. 建立增量 FTS projection；
5. JSONL/ripgrep 保留为兼容、诊断和重建路径；
6. canonical SQLite 承担即时耐久性；
7. JSONL 生成改为 turn/idle/quit/export 边界；
8. 增加 projection dirty marker、cursor、version 与 parity audit；
9. 增加 catalog/FTS 损坏后的自动重建测试；
10. 对 SQLite query plan、index 命中和 WAL 维护建立 benchmark。

完成条件：

- session list 不再随 session 文件数量执行逐目录 plan scan；
- 搜索达到规模预算；
- delta 阶段不存在完整 JSONL 全量重写；
- crash recovery、T1/T2、usage ledger 和 compatibility parity 测试全部通过。

### Phase 4：次级子系统与工程效率

本阶段只处理 Phase 0/1 数据证明确有收益的项目：

- Browser pane/CDP idle detach、截图、DOM 提取和内存释放；
- Messaging provider 延迟初始化与 fan-out 批处理；
- watcher 合并、事件去重与重复 reload；
- 多窗口事件序列化与 payload 复用；
- main/preload/Pi server/WA worker 增量和并行构建；
- source map 的 dev/CI/release 分级；
- affected-package typecheck/test/build；
- 长时间运行的 heap snapshot diff 和资源泄漏门禁。

## 七、推荐 PR 序列

避免跨越多个不变量的大爆炸式修改。建议按以下 PR 推进：

1. `perf-harness-and-budgets`
2. `renderer-bundle-boundaries`
3. `startup-critical-path`
4. `streaming-state-isolation`
5. `incremental-turn-projection`
6. `chat-and-trajectory-virtualization`
7. `session-catalog-projection`
8. `jsonl-write-amplification`
9. `performance-ci-gates`

每个 PR 必须同时提交：

- 修改前固定基线；
- 修改后同负载数据；
- 正确性与恢复测试；
- p50/p95/p99、内存、I/O 和 bundle 变化；
- 对 Durable Runtime、Headless 和 compatibility projection 的影响说明；
- 若未达到预算，说明剩余瓶颈和是否应继续投入。

## 八、风险与约束

| 风险 | 约束与缓解 |
| --- | --- |
| 为启动速度推迟必要恢复 | runtime minimum ready 必须完成未知副作用处理和必要 recovery 后才允许执行新任务 |
| JSONL 降频导致兼容层陈旧 | canonical cursor、dirty marker、turn/quit flush、显式导出前强制同步 |
| 虚拟化破坏滚动与注释 | 先建立行为契约和 E2E fixture，再替换列表实现 |
| streaming atom 与 committed history 分叉 | complete/interrupted/error/reconnect 必须有确定的合并和回滚规则 |
| runtime index 失配 | 索引只作缓存，支持从 message array 重建，并增加随机操作一致性测试 |
| 过早拆分 main bundle增加部署复杂度 | 先用 metafile定位；优先动态导入和已有 subprocess 边界 |
| benchmark 噪声导致错误门禁 | 固定机器、预热、重复样本、异常值规则和变异系数检查 |
| 只优化 Desktop 损害 Headless | Desktop 与 Headless 使用独立启动预算和恢复测试 |

## 九、专项原则

1. **先测量，后决定。** 除已明确的 O(N) 热路径和全量重写外，不凭文件大小直接重构。
2. **用户感知优先。** 首窗、会话切换和流式顺滑度优先于纯构建速度。
3. **先消除规模复杂度。** O(N)、O(文件数) 和全量复制优先于常数级微优化。
4. **耐久性不可交换。** 不得以减少 fsync 为由削弱 user message、T1/T2、usage 或副作用状态可靠性。
5. **投影不是事实源。** Catalog、FTS、turn index 和 JSONL compatibility cache 必须可重建。
6. **Desktop 与 Headless 分开验收。** Desktop 优先首窗，Headless 优先 runtime/automation ready。
7. **以 p95、long task 和内存回落验收。** 平均值不足以代表真实体验。
8. **优化必须可撤销。** 每一阶段保持清晰边界，避免无法隔离收益和风险的大型重写。

## 十、启动建议

专项第一批应从以下两项开始：

1. `perf-harness-and-budgets`：建立可信基线、fixture、trace 和报告；
2. `renderer-bundle-boundaries`：根据 metafile建立首屏懒加载边界。

两项风险较低，且能为后续流式状态、窗口化和持久化重构提供可信验收基础。完成 Phase 0 前，不建议并行开展多个核心性能重构，以免无法判断收益来源和回归责任。
