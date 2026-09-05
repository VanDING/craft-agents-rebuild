# CraftAgent Durable Agent Runtime 调研、实施与后续交接

> 更新时间：2026-08-27
>
> 历史实施分支：`codex/durable-runtime-phase-0-5`（已合并到 `main`）
>
> 当前性质：历史实施交接记录；Phase 0–5 已进入 `main`。现行架构合同以配套 ADR 和当前代码为准，本文中的“当前分支”“尚未提交”与中间缺口均按记录日期理解。
>
> 配套 ADR：[architecture/durable-agent-runtime.md](./architecture/durable-agent-runtime.md)

## 1. 文档目的

本文用于把本轮工作完整交接给下一位维护者，覆盖：

1. Pi、Maka、Codex 与 CraftAgent 源码调研得到的架构结论；
2. CraftAgent 原有执行模型的关键问题；
3. Phase 0–5 的原始演进计划；
4. 当前分支已经实现的内容；
5. 实施过程中的阶段性缺口及其最终闭环；
6. 推荐的继续实施顺序、验收标准和测试矩阵。

必须注意：本分支已完成新运行的 canonical semantic execution 切换，但没有删除旧 JSONL/Pi 文件；它们仍承担富 UI 元数据、provider continuation 与导出兼容职责，不能反向覆盖 runtime.db。

## 2. 调研对象与核心结论

调研对象：

- [Apache Maka](https://github.com/apache/maka)
- [Pi](https://github.com/earendil-works/pi)
- [OpenAI Codex](https://github.com/openai/codex)
- 当前 CraftAgent 仓库

### 2.1 跨项目形成的共同架构

Pi、Maka、Codex 从不同产品路径出发，但都在趋向同一个结构：

```text
持久化事实
  ↓ reduce
运行状态 / program counter
  ↓ project
模型上下文、UI、索引、统计
  ↓ restart
从事实重新归约
```

这本质上是数据库和操作系统中已经成熟的设计：

- write-ahead intent；
- append-only semantic facts；
- event sourcing / deterministic reduction；
- materialized projections；
- stable operation identity；
- crash recovery；
- fail-closed reconciliation。

Agent harness 的新问题主要不是“如何调用模型”，而是“如何在不可靠进程、外部副作用和多份派生状态之间维持可恢复的一致性”。

### 2.2 工具调用的正确边界

工具调用必须至少有两个持久化事务边界：

```text
preflight / permission / canonicalize
  ↓
T1: persist tool intent + complete next operation state
  ↓ commit success only
execute external effect
  ↓
T2: persist tool outcome + usage + complete next operation state
  ↓ commit success only
publish result to model/UI
```

关键不变量：

- T1 失败时，工具实现调用次数必须为零；
- T1 已存在但 T2 缺失，不代表工具没有执行；
- 恢复时不能仅因为“没有结果”就自动重试；
- 相同 operation ID 不能绑定不同工具或不同参数；
- 工具结果必须先完成 T2，才能进入下一次模型上下文。

### 2.3 “事件可重放”不等于“副作用可重放”

如果进程在外部调用成功后、T2 落盘前崩溃，持久化事实只能证明：

- T1 已提交；
- 外部调用可能执行，也可能未执行；
- 本地没有可信 outcome。

正确状态是 `unknown/reconcile_required`。恢复流程必须使用同一个 operation ID 或外部 reference 对账，而不是直接再次付款、发信、创建资源或执行写操作。

### 2.4 Runtime Host 应是唯一执行权威

最终架构中的权威关系应为：

```text
Runtime Host / runtime.db      唯一 durable execution authority
├── Pi session                provider continuation cache
├── session.jsonl             UI/export compatibility cache
├── renderer state            ephemeral projection
├── task run snapshots        projection / compatibility log
└── search/index/metrics      rebuildable projections
```

缓存可以保留，但缓存不能独立判断某个外部副作用是否已经发生。

## 3. CraftAgent 原有架构的主要问题

实施前，CraftAgent 已经具有多种持久化能力，但它们分别承担部分事实来源：

- `session.jsonl` 保存 Craft 消息和 UI 状态；
- `.pi-sessions` 保存 Pi provider session 和模型上下文；
- TaskRunner 使用独立 `run-log.jsonl`；
- renderer 保留流式和工具状态；
- 工具执行与持久化之间没有统一 T1/T2 边界。

由此产生的主要风险：

1. 多份状态都可能被误当作权威；
2. Pi 在工具 `execute()` 前就发出 `tool_execution_start`，UI 可能显示尚未 durable 的状态；
3. speculative prefetch 可能绕过 permission/T1 顺序；
4. 工具成功后、结果写回前崩溃时无法区分“未执行”和“未知”；
5. TaskRunner 曾把重启时的 `running` 节点重置为 `pending`，可能重复执行副作用；
6. session persistence 曾先 unlink 旧文件再 rename，存在丢失最后一份正确快照的空窗；
7. UI、模型上下文和持久化消息没有共享 canonical commit sequence。

## 4. 原始 Phase 0–5 计划

### Phase 0：契约与故障模型

目标：先固定语义，再写实现。

- 定义 semantic fact、operation state、tool operation identity；
- 定义 T1/T2 边界和 recovery matrix；
- 明确 `safe_replay`、`idempotent_keyed`、`reconcilable`、`never_auto_retry`；
- 写出不可破坏的不变量和 ADR；
- 建立 crash/fault-injection 测试模型。

### Phase 1：Canonical durable substrate

目标：建立 Runtime Host 拥有的持久化底座。

- workspace-local SQLite/WAL；
- immutable runtime events；
- mutable total operation state；
- tool operation table；
- usage ledger；
- projection cursor；
- CAS、幂等写入、事务化 T1/T2。

### Phase 2：统一副作用边界

目标：任何真实工具副作用都不能绕过 Runtime Host。

- permission/transform 在 T1 前完成；
- T1 成功前工具实现不可运行；
- T2 成功前结果不可进入模型；
- operation/idempotency identity 传递到外部系统；
- 禁止绕过边界的 speculative execution。

### Phase 3：从事实派生模型上下文和 UI

目标：把事实日志变成真正的读模型来源。

- deterministic model-context reducer；
- deterministic session/UI reducer；
- committed sequence/cursor；
- streaming partial 与 permanent semantic fact 分离；
- 在线 Pi context 和 renderer read path 逐步切换到 canonical projection。

### Phase 4：恢复与对账闭环

目标：进程重启后能够安全继续，而不是简单重新执行。

- 启动时扫描非终态 operation；
- 区分 definitely-not-dispatched、completed、unknown、corruption；
- unknown effect 对外可见；
- 提供外部查询、人工决策和 durable reconciliation；
- 只有在恢复决策持久化后才允许继续 run。

### Phase 5：迁移、切换与旧权威退役

目标：消除长期 dual truth。

- shadow write；
- parity/divergence metrics；
- 逐个切换 model/UI/task/usage read model；
- 历史数据回填但不伪造副作用证据；
- 将 `session.jsonl`、Pi session、TaskRunner log 降级为缓存或导出；
- 最终移除旧路径的独立执行权威。

## 5. 当前分支已经完成的内容

### 5.1 Phase 0：契约基线

已完成：

- durable runtime ADR；
- shared runtime types；
- recovery evidence/verdict matrix；
- fail-closed recovery 单元测试；
- run operation 与 individual tool operation 分离。

相关文件：

- `docs/architecture/durable-agent-runtime.md`
- `packages/shared/src/durable-runtime/types.ts`
- `packages/shared/src/durable-runtime/recovery.ts`
- `packages/shared/src/durable-runtime/recovery.test.ts`

### 5.2 Phase 1：SQLite/WAL 底座

已完成：

- workspace DB 路径：`<workspace>/runtime/runtime.db`；
- Bun 使用 `bun:sqlite`，Electron/Node 使用 `node:sqlite`；
- WAL、`synchronous=FULL`、foreign keys、busy timeout；
- `runtime_events`、`operations`、`tool_operations`、`usage_ledger`、`projection_cursors`；
- canonical JSON；
- immutable event identity/content 校验；
- expected state version/CAS；
- transactional T1/T2；
- recovery evidence、unsettled operation 和 cursor API。

相关文件：

- `packages/server-core/src/durable-runtime/sqlite-driver.ts`
- `packages/server-core/src/durable-runtime/canonical-json.ts`
- `packages/server-core/src/durable-runtime/store.ts`
- `packages/server-core/src/durable-runtime/store.test.ts`

### 5.3 Phase 2：Pi 工具 T1/T2 垂直链路

已完成：

- Runtime Host coordinator 和 workspace store registry；
- Pi subprocess JSONL prepare/outcome request-response；
- preflight、permission、argument transform 后执行 T1；
- T1 失败时不调用原工具；
- 原工具完成后执行 T2；
- T2 完成后才向 Pi 返回最终、可能经过 large-result transform 的结果；
- 关闭原 speculative tool prefetch；
- 为每个 tool call 生成稳定 tool operation ID 和 args hash。

相关文件：

- `packages/server-core/src/durable-runtime/coordinator.ts`
- `packages/server-core/src/durable-runtime/tool-identity.ts` — shared identity functions; production execution boundaries live in `coordinator.ts`.
- `packages/pi-agent-server/src/index.ts`
- `packages/shared/src/agent/pi-agent.ts`
- `packages/shared/src/agent/backend/types.ts`

### 5.4 Phase 3：提交后发布与 projection 基线

已完成：

- Pi 原始 `tool_execution_start` 在主进程缓冲；
- Runtime Host 完成 T1 后才释放 `tool_start`；
- T1/T2 committed sequence 传递到 adapter、SessionManager、protocol 和 renderer；
- tool/assistant messages 持久化 durable operation ID 和 seq；
- renderer 维护当前 durable cursor；
- 最终 assistant message 写入 canonical facts 后才发布；
- 实现 deterministic semantic/model-context reducer；
- 实现 legacy JSONL 与 canonical facts 的只读 divergence audit。

相关文件：

- `packages/server-core/src/durable-runtime/projection.ts`
- `packages/server-core/src/durable-runtime/audit.ts`
- `packages/shared/src/agent/backend/pi/event-adapter.ts`
- `apps/electron/src/renderer/event-processor/`

### 5.5 Phase 4：启动恢复安全基线

已完成：

- Runtime Host 启动时扫描未完成 operation；
- 没有未知副作用的中断 run 被安全 terminalize；
- T1 已提交但 T2 缺失的 run 进入 `recovery_parked`；
- 启动恢复不会自动重放外部副作用；
- legacy message cache 加载时将对应工具标成 `unknown`；
- recovery decision 作为 durable event 写入。

### 5.6 Phase 5：兼容层安全护栏

已完成：

- 文档明确 `runtime.db` 为新 run 的执行权威；
- `session.jsonl` 被定义为 UI/export compatibility cache；
- `.pi-sessions` 被定义为 provider continuation cache；
- session JSONL 写入改为 write → fsync → atomic rename → directory fsync；
- 不再先 unlink 最后一份正确快照；
- persistence error 不再静默吞掉；
- TaskRunner 重启时不再把 in-flight/cancelled node 自动变回 pending；
- 如果 TaskRunner node outcome 未知，自动 resume 会 fail closed。

## 6. 当前验证状态

已运行并通过：

- Shared TypeScript typecheck；
- Pi Agent Server typecheck；
- Server Core typecheck；
- Electron typecheck；
- durable store/dispatcher/coordinator/projection/audit/recovery 测试；
- TaskRunner 测试；
- Pi event adapter 和 tool registration 测试；
- session persistence queue 测试。

最近一次综合定向测试结果：226 pass，0 fail。后续增量复验：77 pass，0 fail。`git diff --check` 通过。

以下是当时验证阶段的分支位置；相关改动后来已提交并合并到 `main`：

```text
codex/durable-runtime-phase-0-5
```

## 7. 原始缺口清单（已完成）

以下内容保留为实施前的问题定义与验收依据；对应闭环均已完成，最终实现状态见第 13 节。

### P0：修复 unknown UI 语义（已完成）

当前恢复代码会设置：

```text
toolStatus = unknown
toolResult = recovery explanation
```

但 `packages/ui/src/components/chat/turn-utils.ts` 的 `getToolStatus()` 不识别 `unknown`，并会因为存在 `toolResult` 把它映射为 `completed`。这会向用户错误表达“工具已经完成”。

必须完成：

- ActivityStatus 增加 `unknown/recovery-required`；
- 明确视觉样式、提示信息和禁止直接 retry 的交互；
- unknown 不能被 spinner、completed 或 error 隐式替代；
- 增加 UI reducer 和 TurnCard 测试。

### P0：建立真正的 reconciliation API（已完成）

当前只能 park，不能解决 parked operation。

必须完成：

- 按 operation ID 获取 recovery evidence；
- tool adapter 提供 `queryExternal(operationId/externalReference)`；
- 支持 durable decision：completed、definitely-not-executed、failed、manual-abandon；
- decision 与 operation state 在同一事务提交；
- decision 后恢复 program counter；
- 管理员/用户确认 API 和 UI；
- 完整审计操作者、时间、证据和原因。

### P0：把 idempotency identity 传到真实工具（已完成）

目前 Runtime Host 生成并返回 `idempotencyKey`，但 Pi wrapper 调用原工具时没有把它传入外部 API 或统一 execution context。

必须完成：

- 扩展 tool execution context；
- 为支持 keyed idempotency 的 MCP/API/native tool 定义标准注入方式；
- 参数相同但 operation ID 不同的重试策略必须明确；
- 不支持 idempotency/reconciliation 的写工具默认 `never_auto_retry`。

### P1：让 canonical projection 成为在线读路径（已完成）

`projectModelContext()` 和 `projectDurableSession()` 当前只有实现和测试，尚未被在线 Pi context 或 SessionManager read path 使用。

必须完成：

1. 增加 shadow projection，与现有 Pi/session 输出逐 turn 比较；
2. 记录结构化 parity metrics，而不只是日志 warning；
3. 先切换 UI session read model；
4. 再切换新 turn 的 model context builder；
5. 保留 Pi provider continuation 所需的最小 cache；
6. 为 compaction、branch、steer、retry 和 background task 建立等价投影。

### P1：真正使用 projection cursor（已完成）

cursor 表和 API 已存在，但生产 projection 没有提交消费进度。

必须完成：

- 每个 projection 使用稳定名称和 persisted cursor；
- projection 更新和 cursor 推进满足原子性；
- 重启从 cursor 后增量归约；
- 检测 cursor ahead、event gap 和 schema incompatibility；
- 支持清空 projection 后从 seq 0 重建。

### P1：接通 live usage ledger（已完成）

usage 表和 dispatcher seam 已存在，但真实 Pi coordinator T2 没有写入 usage，assistant usage 仍主要存在 legacy message 中。

必须完成：

- 定义 provider request/response/attempt 的 usage identity；
- assistant/model outcome 与 usage 原子提交；
- tool-side usage 与 T2 原子提交；
- retry、cache read、compaction usage 去重；
- UI 成本统计改读 usage projection。

### P1：为模型调用增加 durable effect boundary（已完成）

当前记录了 run accepted 和最终 assistant message，但没有完整的：

```text
model_dispatch_committed → provider call → model_outcome_committed
```

必须完成：

- provider request identity；
- model effect pending state；
- response/usage/stop reason outcome；
- crash 后未知 provider attempt 的归约；
- 防止恢复时重复收费或错误计算 usage。

### P1：将 TaskRunner 纳入统一 Runtime Host（已完成）

当前 TaskRunner 仅增加了 fail-closed guard，仍使用独立 run-log。

必须完成：

- task run/node 使用 durable operation state；
- node spawn 采用 T1/T2 或明确的 child-operation 协议；
- TaskRunner run-log 降级为 projection/export；
- node output、verdict、repair budget 和 terminal event 从 canonical facts 派生。

### P2：迁移、回填和旧权威退役（生产切换基线已完成）

必须完成：

- legacy session inventory；
- 不伪造 tool dispatch 的安全回填规则；
- shadow-write feature flag；
- workspace/session 级 rollout；
- parity dashboard 和错误预算；
- rollback 只切换路由，绝不删除 `runtime.db`；
- 达到门槛后逐步移除 JSONL/Pi/TaskRunner 的独立 authority。

### P2：生产数据库生命周期（已完成）

必须补齐：

- schema v2+ 迁移测试；
- Electron 目标 Node 版本对 `node:sqlite` 的兼容验证；
- DB backup/restore；
- integrity check；
- retention、compaction/vacuum；
- 磁盘满、只读目录和损坏数据库处理；
- 敏感 tool args/result 的加密或脱敏策略。

### P2：真实进程级故障测试（已完成）

目前主要是单元级 fault injection。仍需端到端验证：

- T1 前 kill：工具调用次数为零；
- T1 后、effect 前 kill：恢复为 unknown，不自动运行；
- effect 成功后、T2 前 kill：不会重复付款/发信；
- T2 后、publish 前 kill：重启后结果可重新投影；
- assistant fact commit 后、JSONL 写入前 kill；
- SQLite busy、disk full、corruption；
- fsync/rename 失败；
- Runtime Host 与 Pi subprocess 非正常退出组合。

## 8. 推荐继续执行顺序

### Milestone A：先保证“未知就是未知”

1. 修复 unknown UI 映射；
2. 增加 recovery-required 卡片和禁止直接 retry；
3. 提供只读 recovery evidence API；
4. 增加 process-kill 集成测试。

验收标准：用户永远不会把 unknown 看成 completed，任何未知写副作用都不能通过普通 retry 重放。

### Milestone B：完成对账闭环

1. 定义 reconciliation adapter；
2. 选一个具备查询能力的外部工具做端到端样板；
3. durable commit reconciliation decision；
4. 恢复 run program counter；
5. 增加人工决策 UI 和审计。

验收标准：T1/T2 crash tail 能够在不重复副作用的情况下恢复到确定状态。

### Milestone C：接入 usage 与 model effect

1. provider request identity；
2. model dispatch/outcome events；
3. usage ledger 接入真实请求；
4. retry/compaction usage 去重；
5. 成本 UI 改读 projection。

验收标准：删除 legacy message usage 后，成本和 token 统计仍可完全重建。

### Milestone D：切换 UI read model

1. durable session projection shadow mode；
2. parity 指标；
3. persisted projection cursor；
4. UI 新 session 改读 projection；
5. 支持 rebuild 和 fallback。

验收标准：清空 UI projection 后可以从 runtime events 恢复相同的 committed session。

### Milestone E：切换 model context

1. 构造 canonical model context；
2. 与 Pi context 做 turn-by-turn semantic diff；
3. 覆盖 branch/compaction/steer/retry；
4. 新 run 切换 canonical context；
5. Pi session 降为 provider cache。

验收标准：重建 context 后模型看到的 committed semantic history 等价，partial/内部控制事件不会泄漏。

### Milestone F：统一 TaskRunner 并退役 dual truth

1. task node durable operation；
2. run-log projection；
3. legacy 回填；
4. rollout/rollback；
5. 关闭旧 authority 写入。

验收标准：所有执行状态都能追溯到 runtime facts，不再存在两个系统对“是否执行过”给出不同答案。

## 9. 建议测试命令

```bash
bunx tsc --noEmit -p packages/shared/tsconfig.json
bun run --cwd packages/pi-agent-server typecheck
bun run --cwd packages/server-core typecheck
bun run --cwd apps/electron typecheck
```

定向测试：

```bash
bun test \
  packages/shared/src/durable-runtime/recovery.test.ts \
  packages/server-core/src/durable-runtime/store.test.ts \
  packages/server-core/src/durable-runtime/dispatcher.test.ts \
  packages/server-core/src/durable-runtime/coordinator.test.ts \
  packages/server-core/src/durable-runtime/projection.test.ts \
  packages/server-core/src/durable-runtime/audit.test.ts \
  packages/server-core/src/tasks/TaskRunner.test.ts \
  packages/shared/src/sessions/__tests__/persistence-queue.test.ts \
  packages/shared/src/agent/__tests__/pi-event-adapter.test.ts \
  packages/pi-agent-server/src/tool-registration.test.ts
```

注意：当前 Bun 测试发现规则可能同时执行 `dist/server/...` 中的旧编译测试。分析失败时应先确认失败来自源码还是陈旧 dist 产物，不要直接修改源码来迎合旧构建输出。

## 10. 接手时必须检查的事项

1. 确认当前分支是 `codex/durable-runtime-phase-0-5`；
2. 当前工作树包含未提交实现，不要 reset 或覆盖；
3. 不要删除 workspace 的 `runtime/runtime.db`；
4. 不要把 legacy 缺少 T1 的 tool call 回填成“肯定已 dispatch”；
5. 新增写工具时默认 `never_auto_retry`，直到它声明并验证 recovery contract；
6. 任何自动恢复功能都必须先有 process-kill 测试；
7. 改动 projection 时同时验证从 seq 0 全量 rebuild 和 cursor 增量 rebuild；
8. 旧 JSONL/Pi cache 可以修复或重建，但不能反向覆盖 canonical runtime facts。

## 11. 最终判断

本分支已经完成 CraftAgent 数据库式 harness 的 Phase 0–5 生产切换基线。此前要求的三个闭环——unknown effect 对账、canonical facts 在线读模型、model/tool/task/usage 统一 Runtime Host 权威——均已实现，并通过 shadow parity、故障注入与进程崩溃矩阵验证。

后续工作属于生产运营与增量扩展，而非 Phase 0–5 遗留实现：持续观察 parity/error budget、按 provider 增加自动 reconciliation adapter，并在确认兼容消费者全部迁移后另行规划旧 JSONL/Pi 缓存退役。不得在缺少迁移证据时直接删除兼容文件。

## 12. 2026-08-26 中间实施快照（已由第 13 节取代）

本次在 `codex/durable-runtime-phase-0-5` 上继续完成了以下工作：

1. UI 将 `unknown` 保持为独立终态；即使存在 legacy `toolResult` 或 `isError` 也不会映射为 completed；存在 unknown 时禁止 branch/replay；
2. 增加只读 recovery evidence RPC，以及带 actor、reason、evidence、external reference 的原子 reconciliation commit；actor 由 RPC transport 身份派生，客户端不能伪造；
3. 增加桌面端人工核验对话框；除 `manual_abandon` 外必须提交外部观察证据，界面不提供普通 retry；
4. 定义 reconciliation adapter seam，并验证 adapter 使用稳定 operation/idempotency identity 查询外部系统；尚未注册具体生产 provider adapter；
5. durable identity 已贯穿 Pi subprocess、native tool context、MCP/API request `_meta["craft/durable-operation"]`，不会污染工具参数；
6. 增加真实 Bun 子进程 kill 测试：T1 前 kill 为零副作用；effect 后、T2 前 kill 会 parking 且不会重放；
7. assistant fact 与 provider-attempt usage 在同一 SQLite 事务提交；usage identity 去重，SessionManager 有 ledger 时以 canonical usage projection 覆盖 JSONL token/cost；
8. runtime schema 升至 v2，增加原子 materialized projection snapshot + cursor、CAS、cursor-ahead/event-gap/schema 检测、增量消费和 seq 0 rebuild；生产 session read path 已推进 canonical shadow cursor，同时保留 legacy fallback；
9. 增加 v1→v2 无损迁移测试，确认 canonical events 不丢失。
10. Pi 默认 model stream 已接入 provider-call T1/T2：T1 在 `streamSimple` 前提交；response content、stop reason、response ID 与 usage 在终止事件发布前原子提交；T2 同时生成可重建的 assistant fact；
11. 增加模型进程故障测试：provider effect 后、T2 前会 parking 且不重发；T2 后、publish 前 kill 可从 canonical facts 恢复 response 与 usage。
12. TaskRunner child spawn 已接入 durable T1/T2：在创建/发送 child session 前提交 T1，发送成功后以 child session ID 提交 T2；只要跨过 T1 而 T2 未提交，节点即使配置 retry 也不会自动重复派生；增加顺序与 fail-closed 测试。
13. runtime.db 增加生产生命周期基础能力：可执行完整 `integrity_check`、通过 `VACUUM INTO` 创建不覆盖既有文件的一致性备份，并将 busy、readonly、disk-full、corrupt、I/O failure 分类为结构化错误；真实备份恢复与损坏数据库 fail-closed 测试已通过。
14. canonical shadow read 增加结构化 parity report：生产 session read 会记录 canonical fact 数、legacy message 数、总差异、分类差异计数与 parity ratio，为 rollout gate/dashboard 提供稳定数据模型；当前仍只观测，不改变 UI authority。

本次定向验证持续通过，覆盖 durable store/coordinator/projection/process-crash、TaskRunner、Pi event adapter、session persistence、工具注册、UI recovery 与 RPC ownership；shared/server-core/ui/electron/pi-agent-server TypeScript 检查、i18n parity/sorted 与 `git diff --check` 均通过。

以上“仍未完成”清单已由下一节取代。

## 13. 2026-08-26 最终继续实施结果

在第 12 节基础上继续完成：

1. **Canonical model context 在线切换**：Runtime Host 生成带 cursor 的 committed semantic history；Pi 仅在 session idle、cursor 不回退且 legacy parity 为 100% 时采用，异常时安全回退 provider cache；当前 run 从 history 排除，避免重复 user message。
2. **分支与历史安全导入**：branch copy 使用 `legacy_context_imported`，明确标记 `legacy_cache_unverified` / `dispatchEvidence=false`；可以重建 user/assistant/tool transcript，但绝不会伪造 T1、operation state 或恢复授权。
3. **Utility model 全覆盖**：mini completion、title/summarization、`call_llm` 与 manual/automatic compaction 均拥有独立 durable run identity，并通过 AsyncLocalStorage 隔离并发请求的 model T1/T2。
4. **模型 unknown 闭环**：增加 durable provider-attempt reconciliation API 和桌面人工核验入口，支持“provider 未计费”“已计费但响应不可取回”“人工放弃”；actor 由 transport 派生，不伪造 usage、不自动重发。
5. **生产 reconciliation 样板**：注册 `task_node_dispatch` adapter，通过 task/run/node identity 查询权威 session registry；只有 child session 与已提交 user input 同时存在才判定 completed，部分创建、多匹配均要求人工核验。
6. **Canonical UI read authority**：rich JSONL metadata 作为 overlay 保留，但消息语义、顺序、tool input/outcome 与 durable cursor 来自 runtime.db；默认只切换 parity=100% 的 session。`CRAFT_DURABLE_SESSION_READ=shadow|legacy` 可只改路由回滚，`CRAFT_DURABLE_SESSION_CANARY` 支持 session/workspace 灰度。
7. **持久化 rollout 证据**：schema v3 增加 projection parity observations，按 projection/session/cursor 保存差异分类、ratio 与时间，可用于 dashboard/error budget；projection schema 变更自动从 immutable facts 重建，不永久卡在 legacy fallback。
8. **TaskRunner 权威切换**：run/node 状态、node output、verdict、repair counter、budget breach 与 terminal fact 先提交 runtime.db；run-log 与 node JSON 仅在 canonical commit 后更新。重启优先读 canonical facts，即使兼容文件缺失也能恢复已完成 output。
9. **数据库生命周期**：schema v1 可无损迁移到最新 v3；启动 integrity check；每日 `VACUUM INTO` 一致性备份；六小时维护检查；30 天陈旧可重建投影 retention；每周 VACUUM；校验后的原子 restore，失败自动回滚并保留 restore 前数据库。
10. **敏感载荷策略**：credential-shaped tool args/result/evidence 在进入 immutable facts 前递归脱敏；idempotency hash 仍基于原参数，兼顾身份精确性与 secret 不落盘。
11. **真实故障矩阵**：覆盖 T1 前 kill、T1 后 effect 前 kill、effect 后 T2 前 kill、tool/model T2 后 publish 前 kill，以及真实 SQLite competing writer、query-only readonly、max-page disk-full、corruption；所有未知副作用均 parking 且不自动重放。
12. **Windows 持久化语义**：session 文件继续执行 temp write → file fsync → atomic rename；仅对 Windows 明确不支持的 directory fsync 错误降级，其他 fsync/rename 错误仍 fail closed。

最终验证：

- 综合 durable/runtime/TaskRunner/Pi/UI/RPC 定向回归：`205 pass, 0 fail`；
- shared、server-core、pi-agent-server、electron、ui TypeScript：全部通过；
- i18n parity/sorted：通过；
- Electron `43.1.1` 与 Node `24.15.0` 的 `node:sqlite` 加载/查询：实测通过；
- `git diff --check`：通过。

### 13.1 权威边界

新运行的执行语义权威已经统一到 `runtime/runtime.db`：

```text
runtime.db
├── operation / model / tool / task facts     authority
├── usage ledger                              authority
├── projection snapshots / parity metrics     rebuildable
├── session.jsonl                             rich UI/export compatibility overlay
├── .pi-sessions                              provider continuation cache
└── TaskRunner run-log / node JSON             export compatibility projection
```

保留旧文件不是 dual authority：rollout/rollback 只改变读路由，旧缓存不得反向覆盖 canonical facts；immutable semantic facts 与 usage 不参与无人值守 retention，只有可重建投影会自动淘汰。
