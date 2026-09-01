# Craft Agents 性能优化专项：影响优先实施计划

> **状态：** 提议中的精简规划，尚未开始实施
> **规划日期：** 2026-09-01
> **原则：** 优先解决影响最大、证据最明确的问题；每完成一项立即复测，体验达标即停止，不预建完整性能平台。
> **证据边界：** 优先级基于评估当日源码和已有本地构建产物的静态审视。构建产物可能早于当前工作区，实际收益必须在各任务开始前后使用相同环境验证。

## 一、调整结论

上一版规划过于系统化，把长期可能需要的性能基础设施、Catalog/FTS、完整负载矩阵和持续门禁提前纳入了当前专项。

这些方向并非错误，但现在缺少足够证据证明都值得实施。当前更合适的方式是：

```text
解决最高影响问题
      ↓
用最小成本验证收益
      ↓
性能是否已经可接受？── 是 → 停止专项
      │
      否
      ↓
处理下一个已确认瓶颈
```

本专项不追求一次建立完整性能治理体系，只处理能够明确改善用户体验的问题。

## 二、当前优先级

| 顺序 | 问题 | 影响范围 | 证据强度 | 决策 |
| --- | --- | --- | --- | --- |
| 1 | Renderer 首屏加载过重 | 所有 Desktop 启动 | 高 | 立即处理 |
| 2 | 长会话流式更新随历史长度退化 | 长任务、长会话、持续输出 | 高 | 紧接处理 |
| 3 | Desktop 启动阶段串行初始化较多 | 多 workspace、多 session 用户 | 中 | 前两项后测量决定 |
| 4 | JSONL 全量重写产生写放大 | 超长会话、工具输出密集任务 | 中 | 只有测到明显 I/O/卡顿才处理 |
| 5 | Chat/Trajectory 完整窗口化 | 超长历史、超大 Trajectory | 低至中 | 出现真实规模问题再做 |
| 6 | Catalog、FTS、统一性能平台 | 极大 workspace、长期治理 | 低 | 当前不做 |

## 三、任务 1：降低 Renderer 首屏负载

### 为什么排第一

该问题影响每一次 Desktop 启动，不依赖用户是否有长会话或大量 workspace。

评估时已有本地构建产物显示：

- `main.cjs` 约 45.8MB；
- renderer 全部 JS 约 19.2MB；
- `index.html` 初始 module/preload 依赖约 8.8MB 未压缩 JS；
- renderer 源码几乎没有业务组件级动态加载边界。

这些数字只作为调查依据。任务开始时先重新构建一次，生成准确的当前基线。

### 只做这些

1. 生成一次 Vite bundle report，确认初始 chunk 的真实组成；
2. 将普通聊天首屏不需要的重模块改为按需加载，优先检查：
   - Settings；
   - Trajectory/Context/Map；
   - Review/Diff；
   - PDF、Spreadsheet、Document preview；
   - Browser UI；
   - Automation 与 Messaging 设置界面；
3. Shiki 只加载实际使用的语言和主题；
4. 确认 production 不加载无必要的 React DevTools 代码；
5. 不在本任务中重构 AppShell、路由架构或 main process。

### 最小验证

- 修改前后各执行同一份 production renderer build；
- 记录初始 preload JS 总量和最大 chunk；
- packaged 或 production build 冷启动各测试 5 次；
- 验证普通聊天、Settings、Trajectory、PDF/Diff 首次打开正常。

### 完成条件

满足下列任一条件即可认为有价值：

- 初始 preload JS 减少至少 40%；
- 冷启动至首屏可交互时间降低至少 20%；
- 明确移除一个占初始 chunk 20% 以上的非首屏模块。

若 bundle 已经不是启动主因，停止继续拆包，转向任务 2 或启动初始化分析。

## 四、任务 2：消除长会话流式更新的完整历史成本

### 为什么排第二

当前服务端已经将 delta 合并为约 50ms 一批，但 renderer 每批仍可能：

1. 在线性消息数组中查找 streaming message；
2. 复制完整 `messages` 数组；
3. 更新整个 session atom；
4. 对完整历史重新执行 `groupMessagesByTurn()`；
5. 重新计算 ChatDisplay 中依赖 `allTurns` 的内容。

虽然 UI 首次只显示最近 20 个 turn，但限制的是 DOM，不是完整历史上的计算成本。这是证据最明确的算法级瓶颈。

相关代码：

- `apps/electron/src/renderer/event-processor/handlers/text.ts`；
- `apps/electron/src/renderer/event-processor/helpers.ts`；
- `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`。

### 只做这些

1. 将当前 streaming response 与 committed message history 分离；
2. delta 只更新当前 streaming turn，不复制完整历史；
3. `text_complete`、`error` 或 `interrupted` 时再合并进正式 messages；
4. 为当前 streaming `turnId` 保存直接引用或索引，避免每批 `findIndex()`；
5. 让历史 turn projection 在 delta 阶段保持稳定，只更新最后一个 turn；
6. 不同时重写全部 event processor，也不在此任务引入通用 normalized entity store。

### 最小验证

建立一个简单、一次性的 benchmark fixture：

- 100、1,000、5,000 条历史消息；
- 固定 20 次/秒的合并 delta；
- 持续输出 30 秒；
- 记录单批 reducer/projection 时间、long task 和 renderer heap。

### 完成条件

- 5,000 条历史消息下，delta handler/projection p95 不超过 8ms；
- 100 条与 5,000 条历史消息的单批成本不再近似线性增长；
- 30 秒持续输出没有超过 100ms 的 renderer long task；
- complete、interrupt、error、tool event、session reload 行为保持一致。

任务 2 完成后进行一次人工体验复核。若启动、会话切换和流式输出已经顺畅，专项在这里结束。

## 五、条件任务 3：缩短 Desktop 启动关键路径

只有在任务 1 完成后，冷启动仍明显偏慢，才进入本任务。

### 先测什么

只需在现有日志/perf 工具上增加几个时间点：

- `app.whenReady`；
- `bootstrapServer` 开始/结束；
- `SessionManager.initialize` 开始/结束；
- database integrity/recovery；
- session metadata load；
- Messaging 初始化；
- initial window create；
- renderer ready。

不建设通用跨进程 trace 平台。

### 决策规则

只有单个阶段满足以下任一条件才优化：

- 占冷启动时间超过 20%；
- p95 超过 300ms；
- 随 workspace/session 数量明显增长。

### 可能动作

- 将非关键数据库 maintenance 延后到首窗之后；
- Desktop 首窗与后台服务完全 ready 解耦；
- Messaging provider 按启用状态延迟初始化；
- 缓存或减少重复 session metadata/plan 扫描。

必须保留：

- 必要 recovery 在新任务执行前完成；
- Headless 的 Automation/Scheduler 启动语义；
- Durable Runtime 对未知副作用的保护。

## 六、条件任务 4：降低 JSONL 写放大

只有出现以下证据才进入：

- 长会话流式或 turn 完成时可见卡顿；
- `session.jsonl` 写入占主进程明显 CPU 或 I/O；
- 单次持久化 p95 超过 100ms；
- 退出等待主要耗时来自完整 JSONL flush。

优先采用低风险调整：

1. 确认 streaming delta 不会触发不必要的完整持久化；
2. 合并同一 turn 内的 compatibility writes；
3. 大型工具结果继续使用截断或外置文件；
4. 仅在证据证明仍不足时，考虑让 SQLite canonical commit 承担即时耐久性、JSONL 降为低频投影。

本轮不直接设计新的 session catalog、journal 或存储格式。

## 七、当前明确不做

以下项目从当前性能专项移除：

- 通用跨进程性能追踪平台；
- 完整的 S/M/L/Extreme fixture 矩阵；
- 多机器性能 CI；
- session catalog 与 FTS 搜索迁移；
- Chat 与 Trajectory 同时全面窗口化；
- Browser、Messaging、Watcher 的预防性重构；
- 为性能目的拆分 `SessionManager`；
- 全仓性能 lint 和统一预算系统；
- 8 小时 soak test，除非已发现疑似泄漏。

这些工作只有在当前最高影响问题解决后，仍有真实数据支持时才重新评估。

## 八、实施节奏

不采用固定的 Phase 0–4 大计划，改为两个必做任务和两个条件任务：

```text
任务 1：Renderer 首屏减重
    ↓ 复测
任务 2：长会话 streaming 热路径
    ↓ 复测 + 人工体验
是否已达标？── 是 → 结束
    │
    否
    ↓
任务 3：定位并缩短启动关键路径
    ↓ 复测
任务 4：仅在有 I/O 证据时处理 JSONL
```

每个任务只要求：

1. 修改前数据；
2. 一项明确假设；
3. 最小范围实现；
4. 修改后同口径数据；
5. 是否继续下一项的结论。

## 九、建议的首批提交

建议从两个独立 PR 开始：

1. `perf: lazy-load non-chat renderer modules`
2. `perf: isolate streaming turn updates from message history`

不要先创建独立的 performance framework PR。测量代码直接跟随对应优化提交，只保留后续仍有使用价值的少量埋点。

## 十、停止条件

性能专项满足以下条件即可结束，无需继续完成所有条件任务：

- 普通冷启动没有明显长时间白屏或不可交互阶段；
- 2,000-turn 级别会话切换和滚动流畅；
- 5,000 条历史消息下持续流式输出无明显卡顿；
- 没有证据表明主进程 I/O、内存或搜索仍构成主要用户问题。

专项成功的标准不是完成一套完整性能架构，而是用尽可能少的改动消除主要用户感知问题。
