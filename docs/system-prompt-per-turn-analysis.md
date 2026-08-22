# 分析报告：Agent 每轮重复发送 System Prompt 是否必要

日期：2026-08-16
范围：CraftAgent（pi-agent-server + Pi SDK）↔ DeepSeek Harness（dsh）对比；结合 LLM API 无状态性、前缀缓存经济学、标杆 agent 设计

---

## 0. 结论先行（TL;DR）

**"每轮重复发送 system prompt"不是一个冗余设计，而是三个不同层面的事，必须拆开看：**

| 层面 | CraftAgent 行为 | 是否必要 | dsh 对比 |
|---|---|---|---|
| L1 发给模型 API | 每个请求都携带完整 system prompt | **必要**——chat API 无状态，模型注意力需要前缀；dsh 也每轮携带，只是**日志不记录** | 同（`agent.ts:486-493` 每请求带 `system`） |
| L2 进程内 IPC | 主进程每轮重新组装并完整重发 systemPrompt | 非必须但成本可忽略；价值是支持运行时动态更新 | 无 IPC（单进程内 assemble） |
| L3 轨迹视图记录 | 每个请求拍一次 prompt 快照，每轮显示一条 system 记录 | **设计选择**（为 prompt diff，对齐 VanDSH）；dsh 是"仅变更时记录" | 12813 事件中仅 1 条 `request/header` |

**核心判断**：
1. 你的观察"dsh 只在第一轮发送 system prompt"是对**日志策略**的误读——dsh 每个 API 请求都带 system（其 `request/header` 事件只在 `initial`/`change` 时落一条，`usage.cacheReadTokens` 逐轮递增 1152→23296 证明前缀每轮重发且被服务端缓存命中）。
2. 重复发送本身**几乎不花钱**：DeepSeek 缓存命中 ¥0.02/M vs 未命中 ¥1/M（50 倍价差）。真正烧钱的是**前缀不稳定**（system/tools 里混入每轮变化的内容 → 全量缓存失效 + 1.25–2× 写缓存惩罚）。
3. CraftAgent 的设计**方向正确**：issue #862 已实现"稳定前缀 + volatile 内容放 user 消息尾部"，与 Claude Code 官方工程原则（static first, dynamic last）一致。真正该做的是**前缀稳定性审计**和**轨迹快照的变更式存储**，而不是"不重复发送"。

---

## 1. 本地证据：CraftAgent 每轮发送的完整链路

### 1.1 主进程：每轮重新组装 + IPC 完整重发

`packages/shared/src/agent/pi-agent.ts:2082-2166`，每条 `prompt` 消息都携带完整 systemPrompt：

```ts
const systemPrompt = getSystemPrompt(...);           // 每轮重新计算
const stableParts = this.promptBuilder.buildStableContextParts();  // 稳定块
const volatileParts = this.promptBuilder.buildVolatileContextParts(...); // volatile 走尾部
const fullSystemPrompt = [systemPrompt, ...stableParts].filter(Boolean).join('\n\n');
this.send({ type: 'prompt', ..., systemPrompt: fullSystemPrompt, ... });
```

**关键注释（issue #862）**——设计者已经明确知道缓存机制：

> "System prompt carries only stable context (issue #862): the system block is pi-ai's cache prefix before all history, so anything volatile here re-stamps the prefix every turn and drops cacheRead to 0. Volatile blocks ride the user-message tail instead."

即：**每轮重发是有意的**，但内容被刻意约束为稳定字符串（工作区能力、工作目录等），时间/日期/session 状态等易变内容放 user 消息尾部，不污染缓存前缀。

### 1.2 pi-agent-server：每轮经 SDK 扩展钩子注入

`packages/pi-agent-server/src/index.ts:1462-1467`：

```ts
if (msg.systemPrompt) { setCraftSystemPrompt(msg.systemPrompt); }  // 每轮更新
```

`craft-resource-loader.ts` 的 `before_agent_start` 扩展钩子在**每一轮**把 prompt 注入 SDK。为什么必须每轮？注释写得很清楚——这是 **Pi SDK 的契约**：

> "agent-session.js assigns `state.systemPrompt = _systemPromptOverride ?? _baseSystemPrompt` each turn and clears `_systemPromptOverride` after each run, so the hook must re-supply it."

### 1.3 Pi SDK：system prompt 是"每轮状态"，不是"会话状态"

`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`（源码级验证）：

```js
async _runAgentPrompt(messages) {
  ...
  finally {
    this._systemPromptOverride = undefined;   // ← 每轮 run 结束即清空 override
    ...
  }
}
// before_agent_start 扩展返回 systemPrompt → 临时覆盖（901-908 行）
// _rebuildSystemPrompt 仅在工具变更时重建 base（643/1778 行）
```

所以：SDK 层面 system prompt 就是**每轮重新求值**的（base 持久，override 每轮清空）。harness 每轮注入不是多余的防御，而是 SDK 规定的调用方式。

### 1.4 轨迹视图：每请求一个快照（这就是你看到的"每轮重复"）

`packages/pi-agent-server/src/index.ts:1257-1290`——`capturePromptSnapshot()` 在每次 `message_end`（每轮请求完成）时：

```ts
const requestSeq = capturePromptSnapshot(piSession);   // 每请求一个 seq
forwardedEvent = { ..., requestSeq, promptSnapshot: snapshot.prompt };
```

- 快照是有界环形：`PROMPT_SNAPSHOT_LIMIT = 50`（超过 50 轮后最早的被逐出，轨迹历史回看时该轮 system 只剩占位文本）。
- UI 侧：`packages/ui/src/components/trajectory/trajectory-snapshot.ts:106-120` 按 `requestSeq` 收集 prompt；`trajectory-layout.ts:366-378` **每个 request 无条件生成一条 system 记录**（`System prompt (N chars)`）。
- 注释明确这是设计意图："trajectory view's request-header grouping and prompt diff"。

即：**轨迹里每轮一条 system 记录 = 为支撑"请求分组 + 相邻 prompt diff"（VanDSH 的 `promptDetail/previousPromptDetail` 同款能力）而做的每请求快照**。

### 1.5 对照：dsh 的"每轮也发，但按变更记录"

`/Users/van/projects/deepseek-harness/packages/core/agent-loop/src/agent.ts:458-493`：

```ts
const header = canonicalHeader({ config, ... system, ... tools });
if (!this.requestHeaderLogged) {
  this.session.append('request/header', { header, reason: 'initial' });   // 仅首次
  this.requestHeaderLogged = true
} else if (baseline === undefined || !headerEquals(baseline, header)) {
  this.session.append('request/header', { header, reason: 'change' });    // 仅变更
}
const request = deepFreeze({
  ...header.config,
  messages: boundaryMessages,
  ...header.system !== undefined ? { system: header.system } : {},        // ← 每请求都带
  ...header.tools !== undefined ? { tools: header.tools } : {},
  ...
});
```

实测验证（`/Users/van/Downloads/session.jsonl`，12813 事件）：
- `request/header` 恰好 **1 条**，reason=`initial`（该会话 system 全程未变）；
- 每个 step 的 `usage.cacheReadTokens` 递增：1152 → 1408 → 3840 → 13440 → 23296 → …——**只有"每轮把 system+历史完整重发"才会产生持续增长的缓存读取**。若 system 只在第一轮发送，第二轮起不会有任何 cache read。

---

## 2. 理论层：为什么"每轮发送"是必然，成本真相是什么

### 2.1 Chat API 无状态性：system 必须每请求携带

所有主流 chat/completions API（OpenAI、Anthropic、DeepSeek、Google、Pi SDK 背后的 provider 网关）都是**无状态 HTTP 接口**：服务端不保存你的会话，每个请求必须自带完整上下文（system + 全部历史）。模型推理时 system prompt 与历史消息一样参与注意力计算——**它必须出现在请求里，不存在"只发一次"的协议**。唯一的例外形态（OpenAI Assistants/Responses 的 server-side thread）也仅是服务端替你存消息，每次 run 时指令文本仍会被重新注入该次请求的上下文。

结论：**"每轮重复发送 system prompt"在 L1 层面不存在优化空间，dsh 与 CraftAgent 在这层完全一致。**

### 2.2 前缀缓存经济学：重复发送 ≈ 免费，前缀不稳定才贵

三家主流 provider 全部提供自动或半自动的**前缀缓存**（缓存按请求前缀做字节级匹配，命中的部分按折扣价计费）：

| Provider | 机制 | 缓存命中价 | 失效窗口 |
|---|---|---|---|
| DeepSeek | 自动磁盘缓存，按"缓存前缀单元"完整匹配 | ¥0.02/M vs 未命中 ¥1/M（**50×**）；pro 档 0.025 vs 3（**120×**） | 数小时～数天 |
| OpenAI | 自动，>1024 token 起，最长公共前缀，128-token 粒度 | 50% 折扣 | 5–10 分钟闲置，1 小时内必清 |
| Anthropic | 需 `cache_control` 断点（显式/自动） | read 0.1×；write 5min 1.25×、1h 2× | 5 分钟 / 1 小时两档 |

**关键机制（Anthropic 官方文档 + Claude Code 架构分析一致）**：请求按 `tools → system → messages` 层级做**字节级前缀匹配**——tools 变了，system 和全部 messages 缓存级联失效；system 变了，messages 失效。任何"每轮变化"的字段混入前缀（时间戳、session id、路径、工具排序），等于每轮全量 miss + 按写缓存价（1.25–2×）重建。

一个 10K token 的 system prompt、每天 1000 请求的量化对比（Anthropic 档）：无缓存 $30/天；缓存命中约 $3/天。**省 90% 成本靠的不是"少发"，而是"让前缀字节级稳定"。**

### 2.3 位置偏差理论：system 放最前是注意力最优

Liu et al., *Lost in the Middle: How Language Models Use Long Contexts*（TACL 2024）：长上下文中模型对**开头与结尾**信息的利用显著优于中部。system prompt 固定在请求最前（首因位置）正是这个理论的最优落点；把指令塞进中部（如"每轮把 system 当普通消息重插到消息列表中间"）反而劣化遵循度。**只要发，就必须在头部；头部稳定，就同时获得注意力优势 + 缓存命中。**

---

## 3. 标杆 Agent 设计（业界实践）

### 3.1 Claude Code —— "Prompt caching is everything"

官方工程博客（Anthropic 的 Claude Code 团队，Thariq Shihipar）：**静态内容放前面、动态内容放最后、会话中途绝不改动前缀；团队对 cache hit rate 设告警，掉线即 SEV。** 实测架构（第三方逆向分析，vsits.co）：
- 每个 API 请求发送三层载荷：tools 全量 schema → system prompt（含版本指纹）→ 完整消息历史；
- `cache_control` 断点：tools 与 system 用 1 小时 TTL，消息历史用默认 5 分钟；
- 三个真实缓存击穿事故（全部是"前缀被意外改动"）：`--resume` 时元数据块散落到非首条消息（issue #34629）、system 内嵌版本指纹随首条消息内容变化（issue #40524）、工具定义排序不稳定——单次 600K token 会话全量重建、观测窗口 87% 击穿率、5.25M token 写缓存。团队口径的典型 cache hit 88%。

**要点：Claude Code 每轮都重发 system prompt，且把它当作缓存体系的地基来精修——重发不是问题，重发的稳定性才是工程核心。**

### 3.2 多代理管道实践（Claude Agent SDK 应用案例）

Dan's Notebook 的 7-agent 调查管道：把 system prompt 中动态内容（调查 ID、文件路径、实时 schema）挪进**首条 user message 的 `<session-context>` 块**，system 保持全静态 → cache hit rate 85% → 98.7%，成本 -6%，且吞吐监控公式成为一等指标：

```
cache_hit_rate = cache_read / (cache_read + cache_write + input_tokens)
```

**与 CraftAgent issue #862 的设计完全同构**（稳定 system 前缀 + volatile 走 user 消息尾部）。

### 3.3 OpenAI / Gemini / dsh

- OpenAI：不要求开发者管理断点，自动前缀缓存（>1024 token、128 粒度），Codex CLI / Agents SDK 同样每个 run 请求携带 instructions + 完整 thread。
- dsh：`systemPrompt` 服务按 section 有序组装（HMR 可热更），**日志按变更记录**（`headerEquals` diff，`RequestPromptChange: initial | system | tools | system-and-tools`）——这是它与 Craft 轨迹视图唯一实质差异；`ui-trajectory` 的检查器同样渲染 system/tools 详情（`TrajectoryTable.tsx:2840` `selectedPrompt.system`）。
- VanDSH（你的参考标杆）：per-request `promptDetail/previousPromptDetail` 快照 + 逐行 diff + 工具目录对比——**与 Craft 的 per-request snapshot 设计一致**，即你的两个参考系（VanDSH 与 dsh）在这一策略上本来就互相矛盾，Craft 选了 VanDSH 那侧。

---

## 4. 结论：CraftAgent 的设计判断

### 4.1 对"每轮重复发送"的三层裁决

1. **L1（对模型）**：必须且正确。与 dsh 线上行为一致；与 Claude Code 一致。"不重复发送"在无状态 API 上不存在。
2. **L2（IPC 重发）**：主进程每轮 `getSystemPrompt + stableParts` 拼接后完整重发。可去重（内容哈希、仅变更时发），但本地 IPC 拷贝成本相对模型推理可忽略；保留"运行时可变更 prompt"能力（context 文件/技能/工具变化时 prompt 会变，SDK 需要在新轮生效）。
3. **L3（轨迹记录）**：per-request 快照（50 条环形）是有意设计，支撑请求分组 + prompt diff + 工具目录检查（VanDSH 对齐）。**真正的代价**不是"重复"，而是：① 快照环逐出后历史 system 内容不可回看；② 全量快照重复存储（每轮数 KB～数十 KB，长会话累积）。这是可以且应该优化的点（见 §5）。

### 4.2 对"根据 pi 的功能，似乎没必要"的修正

Pi SDK 的"功能"恰恰要求每轮注入：`_systemPromptOverride` 每轮 run 结束即清空，`state.systemPrompt` 每轮重新求值——**每轮注入是 SDK 的调用契约，不注入才是 bug**（prompt 会在下一轮回退为 `_baseSystemPrompt`，若 loader 未配置 override 则丢失 Craft 定制 prompt）。SDK 能省的是"重建成本"（base prompt 只在工具变更时重建），省不掉的是"每请求携带"。

### 4.3 真正的风险面（值得投入的审计）

按"缓存经济学"排序，风险不在"重发"，而在**前缀稳定性**：

| 风险 | 位置 | 后果 |
|---|---|---|
| 工具定义/排序变化 | Pi SDK `_rebuildSystemPrompt`（工具变更时重建 base） | tools 在前缀最顶层，一变全失效（Claude Code Bug 3 同款） |
| system 内混入易变字段 | `pi-agent.ts:2144` 的 `fullSystemPrompt` 拼接面 | cacheRead 归零（issue #862 已防住主路径，需回归保护） |
| `appendSystemPromptOverride` 误用 | craft-resource-loader.ts（当前恒为 `[]`） | 追加在 system 尾部，同样属于缓存前缀 |
| 快照环逐出 | `PROMPT_SNAPSHOT_LIMIT=50` | 长会话轨迹回看丢 system 内容（只留占位行） |

---

## 5. 建议（按投入产出排序）

**A. 前缀稳定性审计 + 指标化（S 级，成本最低收益最大）**
- 在 `capturePromptSnapshot` 旁记录每请求 `cacheRead/cacheWrite/input` 分桶（dsh 的 `billedInputTokens` 模型），在轨迹 Usage 面板补 `cache hit rate` 指标（`cache_read / (cache_read + cache_write + input)`，Claude Code 团队同款告警指标）。
- 回归测试锁死 `fullSystemPrompt` 的字节稳定性：同一会话连续两轮（无配置变化）拼接结果必须全等。

**B. 轨迹快照改"变更式记录"（A 级）**
- `promptSnapshots` 从"每请求全量快照"改为"哈希 + 仅变更时存全量、未变更存引用"：展示与 diff 能力不变（diff 仍需相邻前值，保留最近一份即可），存储与 IPC 载荷减到 O(变更次数)。
- 与 dsh 的 `request/header`（`headerEquals`）策略对齐，但保留 Craft/VanDSH 的 diff 展示——两者不冲突。

**C. IPC 去重（B 级，收益小）**
- 主进程对 `fullSystemPrompt` 做内容哈希，未变化则不重发，让 pi-agent-server 复用上次值（`setCraftSystemPrompt` 仅在变化时调用）。注意保留"变更必须立即生效"的语义。

**不建议**：把 system 改成"每轮不发给模型"或"塞进消息列表中部"——前者在无状态 API 上不成立，后者违反位置偏差最优性并必然击穿缓存。

---

## 6. 证据索引

| 事实 | 证据 |
|---|---|
| Craft 每轮 IPC 重发完整 systemPrompt | `packages/shared/src/agent/pi-agent.ts:2082-2166`（含 issue #862 注释） |
| pi-agent-server 每轮注入 SDK | `packages/pi-agent-server/src/index.ts:1462-1467`、`craft-resource-loader.ts` |
| Pi SDK 每轮清空 override、system 为每轮状态 | `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:753-754, 901-908` |
| 轨迹每 request 一条 system 快照记录 | `pi-agent-server/src/index.ts:1257-1290`（`PROMPT_SNAPSHOT_LIMIT=50`）；`packages/ui/.../trajectory-snapshot.ts:106-120`；`trajectory-layout.ts:366-378` |
| dsh 每请求携带 system、日志按变更记录 | `deepseek-harness/packages/core/agent-loop/src/agent.ts:458-493`；`/Users/van/Downloads/session.jsonl`（12813 事件仅 1 条 `request/header`，`cacheReadTokens` 逐轮递增） |
| DeepSeek 自动缓存与 50× 价差 | https://api-docs.deepseek.com/zh-cn/guides/kv_cache/ ；https://api-docs.deepseek.com/zh-cn/quick_start/pricing |
| OpenAI 自动前缀缓存（1024 起、128 粒度、50% off） | https://openai.com/index/api-prompt-caching/ |
| Anthropic 缓存定价（read 0.1×、write 1.25×/2×、5min/1h TTL、tools→system→messages 层级） | https://platform.claude.com/docs/en/build-with-claude/prompt-caching ；https://gingerlabs.ai/blog/anthropic-prompt-caching |
| Claude Code "Prompt caching is everything"（static first, dynamic last，hit rate 告警） | https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything |
| Claude Code 三层载荷与三种缓存击穿事故 | https://vsits.co/cache-architecture/ |
| 静态 system + 动态首条消息 → 98.7% hit rate | https://dansnotebook.com/posts/prompt-caching-is-everything |
| 位置偏差理论 | Liu et al., *Lost in the Middle*（TACL 2024）：https://aclanthology.org/2024.tacl-1.9/ |

---

## 7. 附：Craft Agent system prompt 原文策略评估（2026-08-16）

输入：当前 Craft Agent 实际发送的 system prompt 全文（约 16-18K 字符，估 5-7K token）。结论：**发送策略无需修改，内容结构需要修改**——按缓存前缀视角逐块审计，存在三个问题：

### 7.1 易变字段位置违反 "static first, dynamic last"

| 块 | 位置 | 变化频率 | 问题 |
|---|---|---|---|
| `<craft_agent_environment version=... platform arch os_version>` | **最顶部** | 每次发版/换机 | 版本号一变，system 前缀整体失效（tools 在其前，tools 层仍命中；system+全部历史重建）。低频变化，单次代价可接受，但位置应为最末 |
| User Preferences 档案（素养基线/工作背景/执行偏好/更新日志） | 中部 | living 协议，1-2 周迭代（v1.0→v1.1 已发生） | 每次更新击穿其后的所有内容；且是长文本，每轮全量 cache read |
| `<working_directory>` + context | 末尾 | 跨会话不同 | 同会话内稳定 ✓，但破坏**跨会话公共前缀**——DeepSeek 的公共前缀落盘机制下，system 越一致，多会话共享缓存收益越大。应移出 system 到 user 消息尾部（与 issue #862 volatileParts 合并），使 system 跨会话 100% 字节一致 |

### 7.2 文档型内容占 system 主体（估 40-50%），应改按需加载

datatable/spreadsheet 完整 JSON 示例（各 ~30 行）、transform_data 完整脚本示例、html/pdf/image/markdown-preview 各带示例块、browser_tool 命令清单（~20 行）、document tools 表格。均为模板文档而非每轮推理必需指令，仓库已有成熟按需模式（`~/.craft-agent/docs/*.md` "read before use"），应转为 docs 指针，system 保留 1 个最小示例。收益：每轮 cache read 与注意力预算减半；长 system 本身稀释指令遵循度（Lost in the Middle 机制同样作用于 system 内部）。

### 7.3 运行时动态块原则（提示项）

原文含 `<sources>`/`<project_context_files>` 注入点说明——这些动态块不可避免（模型需知可用工具），原则是：**动态块必须位于 system 最末尾**，来源增删低频，单次击穿可接受。

### 7.4 修改清单（按 ROI）

1. **S**：`<working_directory>` + context 移出 system → user 消息尾部（跨会话缓存共享，收益最大）
2. **S**：`<craft_agent_environment>` 移至 system 末尾（发版不再击穿前缀）
3. **A**：User Preferences 档案 → volatile 区或独立文件按需读取（长文本 + 高频迭代双重浪费点）
4. **A**：示例/命令清单瘦身为 docs 指针（指令型内容必须常驻，文档型内容必须移出）
5. **B**：cache hit rate 指标监控（§5-A），改完验证收益

**不做**：核心指南（Interaction Guidelines / Permission Modes / 工具语义）必须常驻——它们是每轮注意力在场要求的指令，移出反而劣化遵循度。
