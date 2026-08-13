# Craft Agents — Pi 内核升级与「双 SDK 时代设计残留」全模块深度分析报告（审计修订版）

> 分析日期：2026-08-13（本版为对抗性审计修订版）
> 分析对象：仓库根 `E:/craft-agents`（fork 自 `craft-ai-agents/craft-agents-oss`），版本 0.11.4
> Pi SDK 安装版本：`@earendil-works/pi-coding-agent@0.84.0`（`bun.lock` 与 `node_modules` 实测；2026-08-06 发布）
> 方法：全仓静态分析 + 逐模块深读 + 7 路并行模块侦察（每条 `文件:行号` 逐一定位核实）+ SDK 0.84.0 全部 d.ts / README / CHANGELOG / 实现 JS 核验
> 修订说明：本版修正了上一版的引用行号误差、3 项「死代码/零调用」误判、1 项会话存储层级混淆（v4），并补充 8 项遗漏发现。推断结论标注 `[INFERENCE]`；所有结论均附实测证据。

---

## 0. 执行摘要

**总体判断：单 Pi 后端迁移在行为层面已基本完成**（`@anthropic-ai/claude-agent-sdk` 已从全部 package.json 移除、`AgentProvider = ModelProvider = 'pi'`、驱动注册表只剩 `pi`），但项目仍保留大量「双 SDK 时代」的设计骨架与残留，分为三类：

1. **可运行的兼容层残留**（有行为、无意义或已死）：`SdkMcpServerConfig` 类型名（8 个文件使用）、`keepBackgroundTasksAlive` 旗标、`connectionTypeToProvider`/`connectionAuthTypeToBackendAuthType`/`detectProvider` 等恒返回 `'pi'` 的分发函数、`defineTool` shim、`{type:'sdk'}` 包装的 `createInProcessMcpServer`、休眠的 session-mcp-server（Codex 时代遗留，无 spawn 点且 `/spawn-session` 回调 404）、`resolveAuthEnvVars` no-op（仍有 1 处活调用）、`THINKING_TO_EFFORT`/`TOKEN_BUDGETS`/`getThinkingTokens`（零调用）、`spawn-helpers.ts` 的 Claude 二进制错误处理（零调用）、`errors.ts` 的 `sdk_binary_missing` 文案、`onChatGptAuthRequired` 别名、孤儿化的 1M 上下文开关管线（i18n/RPC/storage/拦截器仍在消费，UI 已移除）。

2. **文档/文案/注释残留**（低风险但误导）：`packages/core/README.md:93-97` 仍把 `@anthropic-ai/claude-agent-sdk 0.3.154` 列为必需 peer dep；7 个 locale 的 `onboarding.apiSetup.claudeDesc` 仍写 "Use Claude Agent SDK as the main agent"（该 SDK 已不存在）；`shared/CLAUDE.md:48` 称 "anthropic→'queue'"（代码恒 'steer'）且引用不存在的 `resolveClaudeThinkingOptions`；`apps/electron/README.md:51-61` 整段 Claude 二进制打包说明；base-agent.ts / backend/types.ts / event-queue.ts / pre-tool-use.ts / automations / SessionManager 多处 ClaudeAgent 注释与 Claude SDK 钩子名兼容层。

3. **「按 Claude 词汇表设计」的架构决策**（有意为之的统一抽象）：事件适配器把 Pi 事件翻译成 Claude Code 词汇，工具参数从 Pi camelCase 归一化到 Claude 的 snake_case（`file_path`/`old_string`）；权限管线是手工 JSONL 握手（`pre_tool_use_request/response`）而非 Pi SDK 钩子；skills 用 `[skill:slug]` mention + PrerequisiteManager 而非 Pi 的 skills API；automations 用自有事件总线 + Claude 钩子名。代价是 Pi SDK 的扩展系统、skills、tree 导航、队列 UI、`getContextUsage` 等能力被整体闲置。

**Pi SDK 0.84.0 能力未应用清单（高价值项）：**
- 扩展系统（`createExtensionRuntime`/`discoverAndLoadExtensions`/`before_agent_start`/`before_provider_headers`/`registerMarkdownTransformer` 等）——**完全未用**，且 `agentDir` 被指向临时目录**刻意屏蔽**全局扩展
- `resourceLoader.systemPromptOverride`（公开的 system-prompt 覆写 API，resource-loader.d.ts:117-118）——未用；项目改为戳私有字段 `_baseSystemPrompt`/`_rebuildSystemPrompt`（system-prompt-override.ts:20-28）
- `navigateTree`（会话树内跳转）——未用；项目只有「创建分支会话」（forkFrom+branch），没有会话树 UI、没有跳转到历史消息继续
- `getContextUsage`/`getSessionStats`——未用；token 显示基于事件携带的 `msg.usage` + 自有 UsageTracker，且 `contextWindow` 在 `setModel` 后**不刷新**（显示会过期）
- `exportToJsonl`/`exportToHtml`——未用；无会话导出 UI
- `setActiveToolsByName`——未用；工具变更走「销毁+重建整个子进程会话」`continueRecent()`。**约束**：该 API 只能开关已注册工具，AgentSession 无公开注册新工具的 API，新增 source 的代理工具不适用
- `setAutoRetryEnabled`/`abortRetry`——未用；auto-retry 事件已在适配器渲染，但不可控不可取消
- `queue_update`/`setSteeringMode`/`setFollowUpMode`——`queue_update` 被显式忽略；steer 已用但队列状态不可见；`steer_undelivered` 事件类型存在**孤儿消费者**（SessionManager.ts:8279-8282）
- `ModelRegistry.refresh`（可取消的模型目录刷新）——未用；`allowModelNetwork:false` + 静态目录，新模型只有升级 App 才出现
- `scopedModels`/`resolveCliModel`/`SettingsManager`/`minimal` thinking 档位/`excludeTools` denylist——未用
- 登录侧：grok-x、kimi-coding 的手写 device-code 循环重复实现 pi SDK 的 `xaiProvider()/kimiCodingProvider().auth.oauth.login`（pi-ai auth/types.d.ts:202-220 实测存在）；chatgpt-oauth 全套自研（PKCE+刷新）重复 `openai-codex` 流程
- 0.84 新增的 Baseten provider、`samplingParams`（任意 OpenAI 兼容采样参数）——未用（Craft 自定义端点可受益 `[INFERENCE]`）

**最高优先级建议（详细见 §7）：**
1. 用 `resourceLoader.systemPromptOverride`（+ 扩展 `before_agent_start` 钩子）替换私有字段戳写 hack——SDK 0.84 实现已核实：`before_agent_start` 结果写入 `_systemPromptOverride`（agent-session.js:901-908），逐轮赋值用 `_systemPromptOverride ?? _baseSystemPrompt`（:644），轮末重置（:753）。双管齐下即可消除对私有 API 的依赖
2. 删除/收敛可运行残留（`SdkMcpServerConfig` 改名、休眠 session-mcp-server 定生死、死代码批量清理——含新增发现的 `scripts/build/{darwin,linux,win32}.ts` 硬抛死代码）
3. 接入 `getContextUsage`（修正 setModel 后 contextWindow 过期）、`navigateTree`（会话树 UI）、`setActiveToolsByName`（仅工具开关场景，非新增工具场景）
4. OAuth 登录去重：grok-x/kimi 改为 SDK 原生 login（照 openrouter 模式）
5. 修 7 处 locale 的 "Claude Agent SDK" 文案与两份 README 的过期依赖声明

---

## 1. 背景：内核升级时间线

| 时间 | 事件 | 版本 |
|---|---|---|
| 2026-07-27 | `docs/single-pi-backend-migration.md` 起草 | Pi 0.81.0 |
| 2026-08-01 | AUDIT_REPORT v2（Pi SDK 0.83.0 全 workspace 统一） | Pi 0.83.0 |
| 2026-08-06 | 内核更新：`@earendil-works/pi-coding-agent@0.84.0`（npm 发布） | **Pi 0.84.0** |
| 2026-08-13 | 本报告（审计修订版） | — |

补充：release-notes 显示 Claude SDK 在 0.10.3 时仍在（0.10.3.md 记录 SDK 0.3.170），**其移除发生在 0.10.3 与 0.11.4 之间**。

**0.84.0 对 Craft 相关的关键变更**（CHANGELOG 原文核实）：
- **Breaking**：`message_update` 事件只发 `assistantMessageEvent` delta，移除累积 `message`/`partial` 字段——Craft 适配器只读 `assistantMessageEvent.type === 'text_delta'`（event-adapter.ts:311-323），**兼容，无需改动**
- **Breaking**：`ModelRegistry.refresh()` 改为接受 `ModelsRefreshOptions` 并返回 `ModelsRefreshResult`（model-registry.d.ts:24）——Craft 未调用，无影响
- **Breaking**：`ModelRuntime.setRuntimeApiKey()` 签名变更——Craft 未调用，无影响
- **Breaking**：OAuth `refresh` 要求具体 abort signal（pi-ai auth/types.d.ts:214）——pi-agent.ts:845-853 已用 `new AbortController().signal` 适配
- **Breaking（层级澄清）**：pi-agent-core harness 会话模型换成 v4 lane-based `Session`/`SessionStorage`/`SessionRepo`——**这是 harness 内部层，不影响 Craft 的 `.pi-sessions` JSONL 文件格式**。实测 `pi-coding-agent/dist/core/session-manager.d.ts:11` 仍为 `CURRENT_SESSION_VERSION = 3`；`migrateSessionEntries` 只做 v1/v2→v3（session-manager.js:87，标注 "Exported for testing"），与本次升级无关。pi-coding-agent 接线方式为 `new Agent({initialState})` + 恢复时 `agent.state.messages = existingSession.messages`（sdk.js），harness v4 会话在内存中运行，落盘仍走 pi-coding-agent SessionManager v3 格式
- 新增：`AGENTS.override.md` 按目录上下文覆写、`registerMarkdownTransformer`、telemetry、远程 `PiClient`（CBOR/Unix socket）、Baseten provider、`samplingParams`——均未用

---

## 2. Pi SDK 接入层全景（谁在调用 SDK、用了什么）

```
Renderer/WebUI
   │  RPC (apps/electron main / server-core handlers)
   ▼
SessionManager (server-core/src/sessions/SessionManager.ts, 8912 行)
   │  createBackendFromResolvedContext → PiAgent
   ▼
PiAgent (packages/shared/src/agent/pi-agent.ts, 2755 行)   ← 纯 JSONL 子进程客户端，不 import SDK
   │  spawn node/bun pi-agent-server，JSONL over stdio（init/prompt/steer/compact/set_model/…）
   ▼
pi-agent-server (packages/pi-agent-server/src/index.ts, 1835 行)  ← SDK 唯一直触面（运行时值 import）
   │  createAgentSession / AgentSession / SessionManager / ModelRuntime / ModelRegistry
   ▼
@earendil-works/pi-coding-agent@0.84.0
```

> 精确边界：全仓**运行时值** import SDK 的只有 pi-agent-server（index.ts、model-resolution.ts、pick-mini-model.ts、tools/web-fetch.ts、tools/search/create-search-tool.ts）。`packages/shared/src/agent/backend/pi/event-adapter.ts:16-18` 有 **type-only** import（`AgentSessionEvent`），`packages/shared/package.json:75` 声明了该依赖——「SDK 唯一直触面」按运行时值口径成立。

**已用 API 清单**（实测，证据见 `packages/pi-agent-server/src/index.ts`）：

| 类别 | 已用 | 证据 |
|---|---|---|
| createAgentSession 选项 | `cwd` `modelRuntime` `customTools` `tools`(allowlist) `agentDir` `sessionManager` `model` `thinkingLevel` | :601-604, :607-612, :645-648, :665, :685, :689 |
| AgentSession 方法 | `prompt(text,{images,streamingBehavior:'followUp'})` :1371-1374；`subscribe` :998, :1363；`dispose` :1271, :1346, :1670；`setModel` :977, :1588, :1627；`setThinkingLevel` :1651；`steer` :1756；`compact` :1502；`setAutoCompactionEnabled` :1528；`isCompacting` :1317-1321 | 上述行号 |
| SessionManager | `forkFrom` :631；`getEntry` :637；`branch` :640；`continueRecent` :647；`inMemory` :968；`getLeafId` :1182 | 上述行号 |
| 其他 | `registerProvider('custom-endpoint')` :476；`InMemoryCredentialStore` :503；`ModelRuntime.create({credentials, allowModelNetwork:false})` :521 | 上述行号 |
| 私有/脆弱访问 | `piSession?.agent.state.model?.contextWindow`（index.ts:797）；`agent.state.systemPrompt`/`_baseSystemPrompt`/`_rebuildSystemPrompt` 三处戳写（system-prompt-override.ts:20-28） | 上述行号 |

**未用 API**（SDK 0.84 d.ts 全部核实 + 全仓 grep 零调用）：`excludeTools` `noTools` `scopedModels` `resourceLoader` `settingsManager` `sessionStartEvent`（createAgentSession 选项，sdk.d.ts:10-54）；`setActiveToolsByName`（d.ts:314）`setScopedModels` `sendUserMessage` `clearQueue` `getSteeringMessages` `getFollowUpMessages` `waitForIdle` `cycleModel` `cycleThinkingLevel` `getAvailableThinkingLevels` `supportsThinking` `setSteeringMode` `setFollowUpMode` `abortCompaction` `abortBranchSummary` `abortRetry` `setAutoRetryEnabled` `executeBash` `recordBashResult` `abortBash` `setSessionName` `navigateTree` `getUserMessagesForForking` `getSessionStats` `getContextUsage` `exportToHtml` `exportToJsonl` `getLastAssistantText` `createReplacedSessionContext` `hasExtensionHandlers` `bindExtensions` `reload`（agent-session.d.ts:192-643）；扩展系统全家族（`createExtensionRuntime` loader.d.ts:12、`discoverAndLoadExtensions` loader.d.ts:22、`before_agent_start`/`before_provider_headers`/`before_provider_request`/`after_provider_response` types.d.ts:505-525、`registerMarkdownTransformer` types.d.ts:915）；`resolveCliModel`（model-resolver.d.ts:87）；`loadSkills`/`formatSkillsForPrompt`（skills.d.ts:59/:44）。

> 注意：Pi SDK **没有内置 MCP client、没有 web_search/web_fetch 工具**（d.ts 核实，内置仅 read/write/edit/bash/grep/find/ls——tools/index.d.ts:21 的 `ToolName` union，`truncate.ts` 只是截断工具函数非工具）。因此 Craft 的 MCP 代理工具与 web 工具是**必要增量**，不是重复实现——本报告不把这两项列为「未应用」。

---

## 3. 逐模块分析

### M1. pi-agent-server —— 子进程封装（SDK 直触面）

**现状**：1835 行单文件。每会话一进程（或复用），JSONL stdio 协议为 Craft 自研（非 pi 内置 RPC 协议，`runRpcMode` 全仓零命中）。会话创建走 `createAgentSession` + 自注册 7 个内置工具 defs（:585-593）+ 2 个 web 工具（searchTool/webFetchTool，:566-574）+ 代理工具（buildProxyTools :594/:845），全量包装权限钩子。扩展隔离：`agentDir` 指向 `{sessionPath}/.pi-agent` 临时目录，「防止加载 ~/.pi/agent 全局扩展」（:607-612，注释原文 :607-608）。会话持久化在 `{sessionPath}/.pi-sessions/`（mkdir :618-619），用 `forkFrom`/`getEntry`/`branch(anchorId)`/`continueRecent` 恢复与分支截断（:631-647）。

**双 SDK 残留**：
- 注释 "This is Pi's equivalent of Claude resumeSessionAt"（:634）——分支语义仍用 Claude 词汇描述
- "0.70.0 registration contract" 版本注释（:576-583）——allowlist 脆弱性自述（「必须列出全部想激活的工具，否则 Pi SDK 默认只激活内置 [read,bash,edit,write] 并静默过滤其余」）；session-tool-registration.test.ts（5.4KB）锁定该契约（含 PR #330 回归历史）
- 遗留 fallback `credentialStore.modify('anthropic', async () => ({type:'api_key', key: apiKey}))`（:515-516，"legacy fallback"）
- 回调服务器只有 `/call-llm` 路由（:347-350，非该路由一律 404）——session-mcp-server 的 `/spawn-session` POST 到此后 404

**Pi 特性未应用**：
- `resourceLoader.systemPromptOverride`：`applySystemPromptOverride`（system-prompt-override.ts:20-28）戳 `session.agent.state.systemPrompt`（:21）+ 私有 `_baseSystemPrompt`（:26）+ `_rebuildSystemPrompt`（:27）三处。SDK 0.84 公开的 `DefaultResourceLoaderOptions.systemPromptOverride`（resource-loader.d.ts:117-118）能在**工具变更重建 system prompt** 时保住 Craft 的 prompt；但 `prompt()` 逐轮赋值 `state.systemPrompt = _systemPromptOverride ?? _baseSystemPrompt`（agent-session.js:644）且轮末重置 `_systemPromptOverride`（:753）的**逐轮冲刷**仍需扩展 `before_agent_start` 钩子（返回 `result.systemPrompt` 写入 `_systemPromptOverride`，:901-908）才能完全替代。→ 建议：`resourceLoader.systemPromptOverride` + 扩展钩子双管齐下，删除私有戳写。**风险**：0.84 之后任意 SDK 小版本都可能改私有字段行为，当前 hack 是内核升级的脆弱点（0.84 内部逻辑已实测核实如上）
- `excludeTools`：browser_tool 门控靠手工过滤 defs（pi-agent.ts:610-616），可用 `excludeTools: ['browser_tool']` 替代，并删除 0.70 时代的 allowlist 全量清单体操
- `setActiveToolsByName`：工具变更（register_tools → toolsChanged :1405-1408 → 处置 :1339-1348，dispose :1346）时整会话 dispose+`continueRecent()` 重建——SDK 提供 `setActiveToolsByName` 可原地热更**已注册工具**的开关。**约束**（d.ts:310-314 原文 "Only tools in the registry can be enabled"）：AgentSession 无公开注册新工具的 API（`customTools` 仅构造期），故该 API 只能覆盖 browser_tool 门控类切换，**不能**替代新增 source 工具时的重建
- `getContextUsage`/`getSessionStats`：token/上下文上限信息完全靠事件 `msg.usage`，`contextWindow` 只在构造时 `setContextWindow(modelDef.contextWindow)` 设置一次（pi-agent.ts:376-385，全文件唯一调用点），**setModel/update_runtime_config 后不更新**——上下文百分比显示会过期
- `queue_update`：被适配器显式忽略；steer 队列状态不可见
- `setAutoRetryEnabled`/`abortRetry`：SDK 的自动重试在跑（适配器渲染 auto_retry_start/end），但用户无法开关/取消
- 分支锚点 `pi_turn_anchor` 依赖 SDK 内部事件顺序（`message_end` 先于 `appendMessage`，微任务后读 `getLeafId()`，:1144-1193；注释原文 :1151-1155）——SDK 升级需回归验证（见 §6）
- `call_llm` 并行 prefetch：`PREFETCHABLE_TOOLS = new Set(['call_llm'])`（:284），message_end 处理器内投机预取（~:1194-1210）
- `annotations.readOnlyHint`：SESSION_TOOL_DEFS 的 readOnly 元数据**没有**传到 Pi 注册（buildProxyTools 不设 annotations；pi-agent-server 内 readOnlyHint 零命中）——Pi 的并行调度提示未生效

### M2. PiAgent 主进程驱动 + 事件适配器

**现状**：pi-agent.ts 是纯 JSONL 客户端（spawn/init/事件转发/工具路由/权限握手/重试/生命周期）。`PiEventAdapter`（828 行）把 SDK `AgentSessionEvent` 翻译为 Craft `AgentEvent`：`message_update→text_delta`（:311-323）、`message_end→text_complete/usage_update`（:369-383/:385-396）、`tool_execution_start/end→tool_start/tool_result`（:404-417/:499-533）、`agent_end→complete`（附 usage，:267-285）、`compaction_start/end→status/info/error`（:552-553/:571-590）、`auto_retry_start/end→status/error`（:603-610/:612-617），另有溢出恢复状态机（holding eventQueue across SDK auto-compaction → `agent.continue()`；状态 held :344-348 → awaiting :247-263 → compacting :540-552 → recovering :554-600；`agent.continue()` 为 SDK 内部行为，agent-session.js:748-750）。

**双 SDK 残留**：
- 适配器注释明说翻译目标词汇来自 Claude/Codex/Copilot 时代（:8-9）；工具参数 camelCase→snake_case 归一化（`path→file_path` :686-689、`oldText→old_string` :698-699/:707-709、Write :720-722、Read/Glob/Grep :729-731）——「UI 管线期望 Claude Code 格式」（双 SDK 词汇表统一决策的代价）
- `@deprecated onChatGptAuthRequired` 别名（:354-363）
- "Mirror Claude's gate"（:610-613）、"Mirrors ClaudeAgent.resolveProjectContext"（:217-220）等注释
- `setBlockReason`（base-event-adapter.ts:81-83）零生产调用；`consumeBlockReason`（:90-98）**有活生产调用点**（event-adapter.ts:505，每个 tool_execution_end 都调）——该路径功能死的真实原因是 map 从未被填充（无人调 setBlockReason），删除需同步删 :505 调用点
- 被丢弃事件：`agent_settled` `entry_appended` `session_info_changed` `thinking_level_changed` `summarization_retry_*` `bash_execution_update` 走 default warn（:626-628；六者均为 SDK 真实事件类型）
- `queue_update` 显式忽略（:620-623，"no current UI consumer" 见头注释 :62）；`steer_undelivered` 事件类型已定义（core/types/message.ts:587）无人发，但**存在孤儿消费者** SessionManager.ts:8279-8282（重排队逻辑）——半接线状态
- `PiBackend` 别名导出（pi-agent.ts:2754-2755）有 pass-through 桶再导出（agent/index.ts:5），零功能消费者
- 适配器头文档 :61 写 "auto_retry_end → status"，代码实际只发 error——内部文档漂移
- automations 事件由 pi-agent.ts 在自己事件流上发：PostToolUse/PostToolUseFailure :1209-1210、PreToolUse :1262、UserPromptSubmit :2027、Stop :2341/:2359——**SubagentStart 从未被任何代码发射**（仅声明于 automations/types.ts:34）

**Pi 特性未应用**：见 M1 列表。

### M3. SessionManager —— 会话生命周期（server-core）

**现状**：行为上已纯 Pi。创建/恢复/分支（fork-at-creation）、`pi_turn_anchor` 关联（SDK leaf id ↔ Craft 消息 id，缓存 `piSdkMessageToCraftMessage` :7530-7571，上限常量 `PI_SDK_MESSAGE_ID_CACHE_LIMIT=256` :939）、`complete/usage_update` token 累积、`tryRefreshAgentRuntime`（:3068/:3154，updateRuntimeConfig/set_model 传播）、automations 驱动 spawn。compaction 由 `/compact` 文本命令在 chatImpl 拦截（pi-agent.ts:2070-2074）→ `requestCompact` RPC（:1884，发送 :1910）→ 子进程 `handleCompact`（:1492）→ `session.compact()`（:1502）——即 Craft 用文本拦截重实现了 pi 的斜杠命令。

**双 SDK 残留**：
- `sourceProvider?: 'anthropic' | 'pi'` 分支校验联合（:2633, :2680-2695）；测试仍测 'anthropic' 分支（session-branching-validation.test.ts:113-114）
- `~/.claude/projects/{cwd-hash}` 会话存储注释**两处**（:2721, :885-886）——实际 Pi 存 `{sessionPath}/.pi-sessions/`
- `keepBackgroundTasksAlive`（packages/shared/src/agent/core/keep-alive.ts，env `CRAFT_KEEP_BG_AGENTS_ALIVE` 默认 true）——**注意**：这是**活行为**（gating 后台任务 chips、孤儿标记、空闲会话通知，:1174, :6798-6799, :8115），但名字和概念来自 Claude SDK 的 keepBackgroundTasksAlive 选项；且 PiAgent 从未实现 `setBackgroundEventSink`（backend/types.ts:377 声明，SessionManager.ts:4417 有 `?.` 可选调用点，恒为空操作）——属「Claude 词汇 + Pi 语义」的名实不符
- `storage.ts` 的 `clearSessionMessages` 注释（:459-461，结尾 "start a fresh Claude conversation"）；**ClaudeTurnAnchor 类全仓不存在**（上一版误列）
- 分支**只有创建时 fork**：无「跳转到历史消息继续」的树内导航（`navigateTree` 全仓零调用），RPC 面也无 navigate 通道（server-core/src/handlers/rpc/sessions.ts COMMAND :349，29 个 case 无 navigate）
- 生产代码 stale 注释：:3264 "using default anthropic provider"、:4373 "(anthropic defaults to 'queue')"（与 llm-connections.ts:452-454 恒 'steer' 矛盾）

**Pi 特性未应用**：`navigateTree`（树内跳转 + 分支可视化）、`getContextUsage`（Context 面板 token 显示现读 JSONL header 的 `meta.tokenUsage`，ContextPanel.tsx:162-177）、`exportToJsonl/exportToHtml`（项目自研 SessionBundle 格式；SessionMenu 有 Share 无 Export）、`setSessionName`（改名走自有 RPC）、`getUserMessagesForForking`（分支 UI 用本地消息列表）。

### M4. 配置·模型·认证（llm-connections / models / auth）

**现状**：`LlmProviderType = 'pi' | 'pi_compat'`（llm-connections.ts:50-52）、`ModelProvider = 'pi'`（models.ts:91）；模型发现走 Craft 自己的 `ModelRefreshService → PiModelFetcher → pi-ai getModels()` 静态目录（model-fetchers/pi.ts `refreshIntervalMs = 0`，注释原文 "SDK models are static, updated on app upgrade"），Copilot 例外走直接 HTTP（drivers/pi.ts，10 分钟定时器）；自定义端点用 `registerProvider('custom-endpoint')`。凭据走 Craft `CredentialManager`（加密文件）→ init/token_update（pi-agent-server :1762-1765；pi-agent.ts :798/:866）注入子进程 `InMemoryCredentialStore`——**整体替代 pi 的 auth.json/AuthStorage**（AuthStorage 零使用，仅残留注释 factory.ts:104、pi-agent.ts:746）。

**OAuth 去重矩阵**（Craft 流 vs pi SDK 原生流）：

| Craft 连接 | Craft 实现 | pi SDK 原生 | 状态 |
|---|---|---|---|
| claude-max | 自研 PKCE（claude-oauth.ts），刷新委托 SDK（pi-agent.ts:72/:848） | `anthropicProvider().auth.oauth` | 部分重复（交换自研） |
| chatgpt-plus | **全套自研**（PKCE + RFC8693 换 key + 自研刷新，chatgpt-oauth.ts；pi-agent.ts:828） | `openai-codex` `/login` | **完全重复** |
| github-copilot | vendor pi-ai 的 device flow（github-copilot.ts，"Replaces @earendil-works/pi-ai/oauth which became type-only in pi-ai@0.80.8+"） | `github-copilot` `/login` | 完全重复（vendor 复制） |
| grok-x | 手写 device-code fetch 循环（handlers/rpc/llm-connections.ts:903-957） | `xaiProvider().auth.oauth.login`（pi-ai providers/xai.d.ts 实测） | **登录重复**（刷新已委托 SDK） |
| kimi-coding | 手写 device-code 循环（:959-1007） | `kimiCodingProvider().auth.oauth.login` | **登录重复** |
| openrouter | **SDK 原生**（openrouterProvider().auth.oauth.login，:1010-1071，login 调用 :1020） | `openrouterProvider` | ✅ 唯一 SDK 原生范例 |
| radius | 显式拒绝 | `/login radius` | 未接线 |

**双 SDK 残留**：
- `LlmConnectionType = 'anthropic'|'openai'|'openai-compat'`（@deprecated，:57）+ `migrateConnectionType` :848/`migrateAuthType` :867/`migrateLlmConnection` :922——三者全仓零调用
- `resolveAuthEnvVars` 硬编码 no-op（:906-914，"kept as a no-op for API compatibility"）——**但有活调用者** SessionManager.ts:1824，删除需先清调用点
- `LlmProviderTypeSchema` 仍接受 7 个 legacy 值（validators.ts:69-73：'anthropic','openai','openai_compat','copilot','anthropic_compat','bedrock','vertex'，解析容忍）
- `authTypeToCredentialType` @deprecated（:398），零调用
- `provider-metadata.ts:83-85` 的 `providerType === 'anthropic'` 分支**可达**：errors.ts:459-462 调用处传 `providerContext.providerType ?? 'anthropic'` 字面量兜底——删除会改变错误恢复路径的 ProviderInfo
- `detectProvider()`（factory.ts:83-85）恒返回 'pi'（**无 @deprecated 标注**，零调用，仅桶再导出）；`connectionTypeToProvider` @deprecated（:219-221）**仍被调用**（:442 legacy fallback 链）；`connectionAuthTypeToBackendAuthType` @deprecated（:231-244）**仍被调用**（:304, :488）；`providerTypeToAgentProvider`（:209-211）；`BACKEND_CAPABILITIES`（factory.ts:521-526）；`getDefaultProviderType`（driver-types.ts:124-127）
- `BEDROCK_TO_BARE`（models.ts:15-56，"Must stay in sync" 注释 :14）与 `BEDROCK_REVERSE_MAP`（llm-connections.ts:747-792，与 `BEDROCK_MODEL_MAP` :723-745 同文件）双份手工维护的同一映射——单一来源化时应推导反转
- `spawn-helpers.ts`（src/agent/）：`SDK_BINARY_NOT_FOUND_RE` :34 / `extractSdkReportedBinaryPath` :36-41 / `isSpawnEnoent` :49-61 零调用（**`isSdkBinaryError` 函数不存在**，上一版符号名误写）；`errors.ts:231-237` "Claude Agent SDK binary expected on disk" 无引用（仅 ErrorCode union core/types/message.ts:478）
- 模型列表：`models.ts:206` 注释引用已移动的路径 "ModelRefreshService in apps/electron/src/main/model-fetchers/"（实际在 server-core/src/model-fetchers/）；PiModelFetcher.ts:11 注释 "Copilot OAuth needs longer timeout (CLI startup…)" 与实际 direct-HTTP（无 CLI）路径矛盾
- `models-pi.ts` 发 `pi/${m.id}` 前缀 id 而 MODEL_REGISTRY 用裸 id——双 id 约定并存（BEDROCK 映射与 resolvePiModel 都横跨它）
- `agent/thinking-levels.ts`：`THINKING_TO_EFFORT` :71-80（adaptive effort）与 `TOKEN_BUDGETS` :89-109 / `getThinkingTokens` :116-120（Claude maxThinkingTokens 时代）**零调用**（仅 agent/index.ts:79 桶再导出）

**Pi 特性未应用**：
- `ModelRuntime.refresh`/`ModelRegistry.refresh({providers, signal})`（可取消目录刷新）——未用且被 `allowModelNetwork:false` 禁用；接入后可实现 pi `update --models` 等价物
- `resolveCliModel`（provider/model:thinking 串解析）——Craft 自研 `resolvePiModel`（pi-agent-server/src/model-resolution.ts:19-77，`pi/` 前缀剥离 :25-26）
- `scopedModels`（模型白名单档位）——Craft 的 Best/Balanced/Fast 三档（llm-connections.ts:92-94，ModelSelectionMode 'userDefined3Tier'）是平行概念，可骑在 scopedModels 上
- `minimal` thinking 档位——pi 支持 7 档（pi-agent-core types.d.ts:254：off/minimal/low/medium/high/xhigh/max），Craft 6 档（thinking-levels.ts:29-36）缺它
- `SettingsManager`/pi settings.json——完全未用（Craft 自管配置）

### M5. 工具链与权限

**现状**：LLM 可用工具 = 7 内置（read/bash/edit/write/grep/find/ls，全部 `create*ToolDefinition` 包装权限钩子）+ 2 web（web_search/web_fetch，Craft 自研）+ 27/28 session 工具（`mcp__session__*`，session-tools-core 权威注册表 **28 条** tool-defs.ts:579-607：SubmitPlan/config_validate/skill_validate/mermaid_validate/source_test/call_llm/spawn_session/browser_tool/set_session_labels/…；生产 27 = developerFeedback 过滤后，前缀由 backend/pi/session-tool-defs.ts:19-23 加 `mcp__session__`）+ 每 MCP/API source 的 `mcp__{slug}__*` 代理工具（proxy-tool-name.ts:14-15）。权限是**主进程权威**：子进程 `wrapSingleTool`（:753）/`buildProxyTools`（:845）包装 execute → `pre_tool_use_request` 握手（发送 :724，响应 :1421-1424）→ 主进程 `runPreToolUseChecks`（pre-tool-use.ts:700，6 步实测：① 权限模式门 :724-736 → ② 未激活 source 阻塞/激活 :738-756 → ③ 前置技能 guide.md :758-772 → ④ call_llm/spawn_session 拦截 :774-780 → ⑤ 变换（路径展开/CLI 重定向/skill 限定/元数据剥离/RTK 改写）:782-841 → ⑥ ask 模式弹窗 :843-880）→ `allow/modify/block`。元数据 `_intent`/`_displayName` 通过 `--require` 预载（pi-agent.ts:473-477）+ bunfig.toml 全局 preload 的**全局 fetch 拦截器**（unified-network-interceptor.ts 2288 行）注入所有出站 LLM 请求 schema，SSE 流剥离。

**双 SDK 残留**：
- `SdkMcpServerConfig` 类型名（backend/types.ts:308-326）贯穿 **8 个文件**（base-agent.ts:40/:610、pi-agent.ts:26/:2318、mcp-pool.ts 7 处 :19/:62/:86/:107/:186/:250/:255、SessionManager.ts:448、agent/index.ts、backend/index.ts、mcp-pool.test.ts）
- `createInProcessMcpServer` 返回 `{type:'sdk', instance}` 包装（sdk-mcp-server-factory.ts:29-56，返回语句 :52-55）——为兼容已死 `createSdkMcpServer` 返回形态
- `defineTool` shim（packages/shared/src/agent/tool-definition.ts:28-36）替代 claude-agent-sdk 的 `tool()`
- BUILT_IN_TOOLS（pre-tool-use.ts:98-117，含 'Skill'）与 ALWAYS_ALLOWED_TOOLS（mode-manager.ts:1775-1784，PascalCase 中混有唯一小写 'browser_tool' :1783）用 Claude 时代 PascalCase 工具名集合 → 由此产生 PI_TOOL_NAME_MAP（backend/pi/constants.ts:34-49）小写→PascalCase 映射的必要性
- `browser-tool-names.ts:35-37` 保留 `session__` legacy alias 剥离
- pre-tool-use.ts:5-6 / permission-manager.ts:4-5 头注释仍写 "ClaudeAgent + PiAgent" 双后端
- **base-agent.ts:414-418 自相矛盾注释**：声称「session 工具跑在外部 MCP server 子进程（packages/session-mcp-server）」——与当前 Pi 架构（session 工具主进程内执行、session-mcp-server 休眠无 spawn 点）直接矛盾，误导性最强的残留注释之一
- **休眠 session-mcp-server**（packages/session-mcp-server）：stdio MCP server（Codex 时代），`BackendRuntimePaths.sessionServer`（driver-types.ts:16）**全仓仅此一处出现**，runtime-resolver 从不解析（只解析 piServer/interceptor/node），无 spawn 点；其 `/spawn-session` POST（:412）打到 pi-agent-server 回调服务器只有 `/call-llm` 路由处（:347-350）→ 404。仍被打包（build-server.ts:168-181、electron-builder.yml:23 + extraResources :68-69、scripts/build/common.ts copySessionServer :400-413）
- `api-source-pool-client.ts:3-5` 头注释仍写 "created by createSdkMcpServer"
- pi-agent.ts:961 注释描述一个**不存在的** session-mcp-server spawn 通路（CRAFT_LLM_CALLBACK_TOKEN）

**Pi 特性未应用**：
- 权限钩子 vs 手工握手：Pi 扩展事件（`before_agent_start`、`tool_execution_*`）可承载部分管线，但 SDK 无 per-request allow/block 语义（需验证）——当前手工握手 + `allowCraftMetadataProperties`/`stripCraftMetadata` 双份元数据处理（craft-metadata-schema.ts:37-62/:65-76，docstring :31-33 原文："Pi validates tool arguments before Craft's pre-tool-use hook can strip _displayName/_intent"；使用点 index.ts:755/:782）是**为绕过 SDK 限制付出的复杂度**
- `annotations.readOnlyHint`：见 M1
- 拦截器本可部分被 `before_provider_request`/`before_provider_headers` 扩展替代——但拦截器还做 body 校验/history 修复等，属成熟资产；建议保留，仅评估收紧 bunfig 全局 preload

### M6. MCP / Sources

**现状**：**已完全迁移到现代 `@modelcontextprotocol/sdk`**。`McpClientPool`（mcp-pool.ts:102）主进程持有全部 source 连接（CraftMcpClient：http/sse/stdio；ApiSourcePoolClient 进程内 InMemoryTransport，api-source-pool-client.ts:16-43），`getProxyToolDefs()`（:352）生成代理 defs 注册进 Pi 会话，`callTool`（:387）处理文本/图像/二进制（:410-432）+ guardLargeResult（:448-455）。REST API 工具走 `createInProcessMcpServer` + `defineTool`。`McpPoolServer`（pool-server.ts:32，Streamable HTTP）把 pool 工具桥给外部 Codex/Copilot 子进程（stateless，剥/加 `mcp__` 前缀 :88-103）。

**双 SDK 残留**：`SdkMcpServerConfig` 命名（见 M5）；`session-mcp-server` 的 `agents.craft.do/docs/mcp` 上游代理（:294-355，DOCS_MCP_URL :294）与 Codex 上下文执行路由（:558-565）为 Codex 时代产物但仍在打包。

**Pi 特性未应用**：Pi SDK 无内置 MCP client——不适用；唯一可议项是 `readOnlyHint` 传播（见 M5）。

### M7. Skills

**现状**：**Craft 完全自研 skills 系统，pi SDK skills API 零使用**（SDK 符号 `loadSkills`/`formatSkillsForPrompt` 全仓零命中；Craft 自有 `loadSkillsFromDir`/`loadWorkspaceSkills`/`loadAllSkills`/`loadSkillBySlug` 大量使用，storage.ts）。三层存储：全局 `~/.agents/skills/`（GLOBAL_AGENT_SKILLS_DIR :33）、workspace `{workspace}/skills/{slug}/`（workspaces/storage.ts:84-87）、项目 `.agents/skills/`（PROJECT_AGENT_SKILLS_DIR :36），装载逻辑 storage.ts:222-242（带 5 分钟 TTL 缓存）；gray-matter 解析 SKILL.md frontmatter（parseSkillFile :66-95：name/description/globs/alwaysAllow/icon/requiredSources 六字段）；激活机制 = 用户在消息里 `[skill:slug]` mention（parseMentions，mentions/index.ts:62，正则 :88）→ `extractSkillPaths`（base-agent.ts:932-986，chat() :1015 调用）→ PrerequisiteManager（agent/core/prerequisite-manager.ts，注册 :55-64，检查 :107-126）**阻塞一切工具（Read 除外）直到 SKILL.md 被读取**——注意 **MAX_REJECTIONS=1 宽限**：每 pending 路径拒一次后放行并清 pending，属一次性门禁而非持续阻塞；mention 不被剥除，改写为 '[Mentioned skill: …]' 标记（base-agent.ts:965-975）；system prompt 只解释机制（prompts/system.ts:657-669）。requiredSources 触发 source 预启用（SessionManager.ts:5923-5979）。

**双 SDK 残留**：
- `.claude-plugin/plugin.json` 读取 plugin 名（utils/workspace.ts:13-21，readPluginName；extractWorkspaceSlug :26-33）——Claude 插件清单约定，用于 skill 限定名
- `qualifySkillName`（pre-tool-use.ts:217，辅助 :267-283）把 `Skill` 工具输入重限定为 `pluginName:slug`——**有活调用点**（pre-tool-use.ts:836-843，受 `toolName === 'Skill'` 门控），但因无后端注册 Skill 工具（全仓无 registerTool('Skill')）而实际不可达——「死分支」成立，「零生产调用」不成立
- automations 里 `@mention` 解析（SessionManager.ts:8468-8489，resolveAutomationMentions，调用点 :8391）——注意是 **@mention 语法**，非 `[skill:slug]` 方括号

**Pi 特性未应用**：`loadSkills`/`formatSkillsForPrompt`/`parseSkillBlock`/`/skill:name` 命令 + pi 的 Skill 工具。Craft 的 mention + 前置读取机制与 pi 的 skills 机制（系统提示注入 + 模型自发调用）是两套并行实现——Craft 的方案更严格（强制先读，但仅一次性门禁），pi 的方案是「模型自由调用」。若未来要兼容 pi 生态的 skills（含 frontmatter 扩展字段），建议至少把 skills 注册为 pi 插件让 `Skill` 工具可用，而不是重写现有机制。

### M8. Automations

**现状**：自有 `WorkspaceEventBus`（类定义在 event-bus.ts:162；automation-system.ts:60-63 组装 AutomationSystem 门面：PromptHandler + WebhookHandler + EventLogHandler :154-190，SchedulerService :208-220）+ App 事件（label/status/权限 diff）+ Agent 事件（**Claude SDK 钩子名保留**：`PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`UserPromptSubmit`/`Stop`/`SubagentStart`，automations/types.ts:25-38）+ scheduler + webhooks。Agent 事件由 pi-agent.ts 在自己事件流上发（:1209-1210, :1262, :2027, :2341/:2359），**不经 pi SDK 扩展钩子**；**SubagentStart 声明但从未发射**。Prompt automation：`executePromptAutomation`（SessionManager.ts:8364-8467）→ createSession + sendMessage，支持完整 spawn 旋钮（thinkingLevel/模型/权限模式/sources）。

**双 SDK 残留**：`sdk-bridge.ts`（buildEnvFromSdkInput :15-53，Claude-SDK 形状输入 → CRAFT_* env，无生产调用者——保留的兼容层）与 `utils.ts:198-205` `matcherMatchesSdk`（**活调用**：automation-system.ts:499）是保留的 Claude-hook 兼容层；`types.ts:312-324` "matches Claude SDK HookCallback type, hooks field name is kept as-is to match the Claude SDK interface"。

**Pi 特性未应用**：SDK 扩展钩子（`before_agent_start` 等）可替代部分 PostToolUse/Stop 的手工事件发射——但现有实现工作正常，迁移收益低，**建议保留**（仅清理注释）。

### M9. UI / WebUI

**现状**：Electron renderer 单一 React App（webui 经 WS 复用）。thinking 选择器 6 档与 pi 除 minimal 外 1:1（thinking-levels.ts:29-36）；模型选择器**动态来自 pi 目录**（getPiModelsForAuthProvider，models-pi.ts:89，renderer 经 registerPiModelResolver 注入）；context 面板 token 显示来自 JSONL header `meta.tokenUsage`（ContextPanel.tsx:162-177）+ `usage_update` 事件（processor.ts:222-223 → handlers/session.ts:968-993）；上下文 % 徽章（≥80% 自动压缩阈值，FreeFormInput.tsx:2404-2427，点击发 `/compact` :2425）；auto-compaction 强制开启无 UI 开关（pi-agent.ts:597-599 无条件 requestSetAutoCompaction(true)）；分支创建=消息 hover 菜单「Branch of …」（ChatDisplay.tsx:1656-1682）。

**双 SDK 残留**：
- `ProviderSegment = 'anthropic' | 'pi'`（APISetupStep.tsx:9）；claude_oauth/anthropic_api_key 两项 onboarding **都路由到 providerType:'pi'**（:47-49）但保留 Claude 品牌文案；文件头注释 :21-22 仍写 "'claude_oauth' → anthropic + oauth"（与 :47 矛盾）
- 7 个 locale `onboarding.apiSetup.claudeDesc` 均写 "Use Claude Agent SDK as the main agent"（de/en/es/hu/ja/pl/zh-Hans，均在 :680；仅 en 为英文原句，其余为同义译文）
- 1M 上下文开关孤儿化：i18n（en.json:975-976）、RPC 通道（protocol/channels.ts:341-342）、storage（config/storage.ts:83, :553-566）、拦截器剥离 `context-1m-2025-08-07` beta header（unified-network-interceptor.ts:796-802，剥离调用 :800）——**UI 已无开关**（AiSettingsPage 只剩 extendedPromptCache :1156/RTK）。注意：管线**并非全死**——RPC handlers（settings.ts:309-318）、electronAPI（types.ts:607-608）、channel-map.ts:327-328、SessionManager.ts:3460 仍在读 `getEnable1MContext()`，拦截器按它执行剥离；en.json:977-978 是 **extendedPromptCache（活设置项）**，不可随孤儿管线一起删
- `FreeFormInput.tsx:2347` "Claude supports extended thinking"、`ChatDisplay.tsx:125` "'off','think','max'"（'think' 根本不是真实档位——纯 Claude 时代词汇）
- **报告漏报的 UI 品牌残留**：`CredentialsStep.tsx:348-351` 硬编码**未本地化**英文 + `providerType = isPiApiKey ? 'pi_api_key' : 'anthropic'`；`model-picker-helpers.ts:39-47` 把全部 pi 连接归到硬编码 "Anthropic" 分组头；`useOnboarding.ts:104-107` Claude 品牌 slug（anthropic_api_key→'anthropic-api'、claude_oauth→'claude-max'）；`ApiKeyInput.tsx:93-94` "for Claude Code backend" / :139-140 "routes through the Claude Agent SDK"；`TaskEditor.tsx:54-55` FALLBACK_MODEL_GROUPS 'Anthropic'；`provider-icons.ts:48-49` display name 'Anthropic'；`connection-setup-logic.ts:141-142` 模板名 'Anthropic (API Key)'
- session-branch-rollback.isolated.ts 测试 mock 仍定义 'anthropic' provider（约 :109-111, :150-152）

**Pi 特性未应用（UI 不可见）**：会话树/分支可视化（navigateTree）、会话统计（getSessionStats）、会话导出（exportToJsonl/exportToHtml；SessionMenu 有 Share 无 Export）、steering 队列状态（queue_update 丢弃）、实时精确 context（getContextUsage）、`/skill:name` 命令、auto-compaction 开关。

### M10. 构建·打包·文档·i18n

- `packages/core/README.md:93-97`：peer dep 仍列 `@anthropic-ai/claude-agent-sdk 0.3.154`（:94）
- `apps/electron/README.md:51-61`：整段 Claude Agent SDK 打包/二进制说明（"setPathToClaudeCodeExecutable" :61、`@anthropic-ai/claude-agent-sdk-binary` :58）
- `packages/shared/CLAUDE.md`："ClaudeAgent is the primary class in src/agent/claude-agent.ts"（文件已删，全仓无 class ClaudeAgent）、":48 anthropic→'queue' midStream 默认"（代码实际恒 'steer'，llm-connections.ts:452-454）、`resolveClaudeThinkingOptions`（:52 提及，全仓不存在）
- 全部 package.json **已无** `@anthropic-ai/*` 依赖（核实；bun.lock 仅剩 `@anthropic-ai/sdk@0.91.1` 作为 pi-ai 的传递依赖——pi-ai 用其直连 Claude API，属正常）；`.env.example` 无 ANTHROPIC_API_KEY；`ANTHROPIC_BASE_URL` 仍是**活配置**（SessionManager envOverrides、interceptor getConfiguredBaseUrl :250-252、diagnostics 三处消费，因 pi 的 anthropic provider 承载 claude-max），非残留
- **构建脚本死代码（上一版漏报）**：`scripts/build/darwin.ts:14-31`（调用点 :68）与 `scripts/build/linux.ts:14-31`（调用点 :48）的 `verifyPackagedSDK()` 在 `@anthropic-ai/claude-agent-sdk-binary/claude` 缺失时**硬抛异常**——SDK 已移除，一旦被接线将打爆 mac/Linux 打包。当前不可达（无 importer、无 npm script 引用，`electron:dist:*` 直连 electron-builder），但 `docs/single-pi-backend-migration.md:508-513` 计划删除这三个文件（+win32.ts）而未执行
- 活构建路径确实已无 Claude 二进制 staging（migration Phase 3 完成）；`scripts/build/common.ts` 仍拷贝 interceptor（:341-386）+ pi-agent-server（:431+）+ session-mcp-server（:400-413，后者休眠，见 M5）
- `scripts/electron-dev.ts:295-303` SDK externalization 过期注释；`apps/electron/eslint.config.mjs:196-198` 仍禁 `@anthropic-ai/claude-agent-sdk` import 的死规则
- 测试残留：`session-branch-rollback.isolated.ts:109,153`（约 :109-111/:150-152）、`session-branching-validation.test.ts:113-114` 的 'anthropic' 分支断言
- 注释残留（清理范围）：event-queue.ts:5-6、session-lifecycle.ts:7-9（路径为 agent/core/session-lifecycle.ts）、backend/types.ts:647（"'anthropic' → ClaudeAgent"）等
- **历史文档不属清理范围**：release-notes/0.8.12.md:25（v0.8.12 时代 Claude SDK 锁定条目）与 0.8.10.md:17（已消失的 1M opt-in UI）是历史 changelog，**不应改写**（上一版 R18 误列入）

---

## 4. 双 SDK 时代设计残留总表（可执行清理项）

| # | 残留 | 位置 | 处置 | 风险 |
|---|---|---|---|---|
| R1 | `SdkMcpServerConfig` 命名 | backend/types.ts:308-326 + 8 文件 | 改名（与 sources/server-builder.ts:35-37 的 McpServerConfig 冲突需另名） | 低（机械） |
| R2 | `createInProcessMcpServer` `{type:'sdk'}` 包装 | sdk-mcp-server-factory.ts:29-56（返回 :52-55） | 直接返回 `McpServer`，删包装 | 低 |
| R3 | 休眠 session-mcp-server（无 spawn 点 + `/spawn-session` 404） | packages/session-mcp-server | 决定：补 `/spawn-session` 路由接线 或 移出构建/打包 | 中 |
| R4 | `keepBackgroundTasksAlive` 名实不符 | shared/src/agent/core/keep-alive.ts + SessionManager | 改名（如 `keepAliveBackgroundTasks`）或文档化 Pi 语义 | 低 |
| R5 | 恒值分发：`detectProvider`（无 @deprecated 标注）/`connectionTypeToProvider`（仍被调 :442）/`providerTypeToAgentProvider`/`BACKEND_CAPABILITIES`/`getDefaultProviderType` | factory.ts:83-85/:209-211/:219-221/:521-526；driver-types.ts:124-127 | 收敛进 factory 直调 | 低 |
| R6 | `connectionAuthTypeToBackendAuthType` @deprecated 仍被调用 | factory.ts:231-244，调用 :304/:488 | 内联后删除 | 低 |
| R7 | `resolveAuthEnvVars` no-op（**有活调用者**） | llm-connections.ts:906-914；SessionManager.ts:1824 | 先清调用点再删 | 低 |
| R8 | `LlmConnectionType` + 3 个 migrate 函数（零调用） | llm-connections.ts:57, :848, :867, :922 | 评估旧配置存量后删除 | 中（旧配置兼容） |
| R9 | `LlmProviderTypeSchema` legacy 值（7 个） | validators.ts:69-73 | 收敛到 'pi'\|'pi_compat'（确认迁移覆盖） | 中 |
| R10 | `THINKING_TO_EFFORT`/`TOKEN_BUDGETS`/`getThinkingTokens` | thinking-levels.ts:71-80/:89-109/:116-120 | 删除（零调用，仅桶再导出 agent/index.ts:79） | 低 |
| R11 | Claude 二进制死代码：`SDK_BINARY_NOT_FOUND_RE`/`extractSdkReportedBinaryPath`/`isSpawnEnoent`（非 isSdkBinaryError）、`errors.ts sdk_binary_missing` | spawn-helpers.ts:34/:36-41/:49-61；errors.ts:231-237 | 删除 | 低 |
| R12 | `onChatGptAuthRequired` 别名、`PiBackend` 别名（含桶再导出） | pi-agent.ts:354-363, :2754-2755；agent/index.ts:5 | 删除 | 低 |
| R13 | `setBlockReason`/`consumeBlockReason` 路径（set 零调用、consume 有活调用但 map 恒空） | base-event-adapter.ts:81-83/:90-98；event-adapter.ts:505 | 删除两方法 + :505 调用点 | 低 |
| R14 | `BEDROCK_TO_BARE`/`BEDROCK_REVERSE_MAP` 双份映射 | models.ts:15-56；llm-connections.ts:723-745/:747-792 | 单一来源（推导反转） | 中（同步风险） |
| R15 | 1M 上下文孤儿管线（UI 已移除，管线部分仍活） | en.json:975-976、channels.ts:341-342、storage.ts:83/:553-566、interceptor:796-802、settings.ts RPC:309-318、types.ts:607-608、channel-map.ts:327-328、SessionManager.ts:3460 | 整体删除（注意 :977-978 extendedPromptCache 保留） | 低 |
| R16 | onboarding Claude/SDK 品牌文案（7 locale） | 7 个 locale 文件 :680 | 改为「Claude 订阅（经 Craft 后端）」措辞 | 低 |
| R17 | 两份 README 过期依赖声明 | core/README.md:93-97；apps/electron/README.md:51-61 | 重写 | 低 |
| R18 | ClaudeAgent 注释/文档残留 | base-agent.ts:414-418（自相矛盾）、backend/types.ts:647、event-queue.ts:5-6、session-lifecycle.ts:7-9、pre-tool-use.ts:5-6、permission-manager.ts:4-5、automations/*、shared/CLAUDE.md、SessionManager.ts:3264/:4373、pi-agent.ts:961、api-source-pool-client.ts:3-5、electron-dev.ts:295-303、eslint.config.mjs:196-198、PiModelFetcher.ts:11、models.ts:206 | 批量清理（**不含 release-notes 历史条目**） | 零 |
| R19 | `~/.claude/projects` 注释（2 处）、`clearSessionMessages` 注释 | SessionManager.ts:2721/:885-886；sessions/storage.ts:459-461 | 改 Pi 路径（ClaudeTurnAnchor 类不存在，无需处理） | 低 |
| R20 | 测试 'anthropic' 分支断言 | session-branching-validation.test.ts:113-114；session-branch-rollback.isolated.ts:109-111/:150-152 | 更新 | 低 |
| R21 | `qualifySkillName`/Skill 工具死分支、`.claude-plugin/plugin.json` 依赖 | pre-tool-use.ts:217/:836-843；utils/workspace.ts:13-21 | 随 skills 决策一并处理（死分支成立但非零调用） | 低 |
| R22 | `sdk-bridge.ts`/automations Claude 钩子兼容层 | automations/*（matcherMatchesSdk :198-205 为活代码） | **保留**（功能可用，仅清理注释） | — |
| R23 | **verifyPackagedSDK 硬抛死代码（新增）** | scripts/build/darwin.ts:14-31/:68；linux.ts:14-31/:48；win32.ts | 删除三文件（迁移文档已计划未执行） | 低（当前不可达） |
| R24 | **UI Claude 品牌残留（新增）** | CredentialsStep.tsx:348-351、model-picker-helpers.ts:39-47、useOnboarding.ts:104-107、ApiKeyInput.tsx:93-94/:139-140、TaskEditor.tsx:54-55、provider-icons.ts:48-49、connection-setup-logic.ts:141-142 | 改 Pi 品牌/本地化 | 低 |

---

## 5. Pi SDK 能力未应用清单（按收益排序）

| # | Pi 能力 | 现状 | 建议接入点 | 收益 |
|---|---|---|---|---|
| P1 | `resourceLoader.systemPromptOverride` + 扩展 `before_agent_start` | 私有字段戳写（system-prompt-override.ts:20-28） | pi-agent-server 构造时传 `resourceLoader`；扩展运行时注册 before_agent_start 返回 Craft prompt。SDK 0.84 实现已核实：钩子结果写入 `_systemPromptOverride`（agent-session.js:901-908）、逐轮赋值 :644、轮末重置 :753——两者缺一不可 | **消除内核升级脆弱点**（当前最高风险） |
| P2 | `getContextUsage` | token 显示基于事件 usage + 固定 contextWindow（setModel 后过期） | 新增 RPC → 主进程 usage 更新；Context 面板/输入徽章用真实值 | 高（显示正确性） |
| P3 | `navigateTree` + SessionManager 树 API | 只有 fork-at-creation，无会话树 | 消息 hover「跳到此继续」+ 会话树 UI；RPC 加 navigate 通道 | 高（产品差异化） |
| P4 | `setActiveToolsByName` | 工具变更 = 整会话 dispose+continueRecent 重建 | **仅工具开关场景**（如 browser_tool 门控）→ setActiveToolsByName。**约束**：只能启用 registry 内工具，AgentSession 无公开注册新工具 API——新增 source 代理工具场景仍须重建 | 中高（省重建抖动，范围受限） |
| P5 | `exportToJsonl`/`exportToHtml` | 无导出 UI，自研 SessionBundle | SessionMenu 加 Export；viewer 已有渲染 | 中 |
| P6 | OAuth 登录去重：xai/kimi 改用 SDK 原生 login | 手写 device-code 循环（handlers/rpc/llm-connections.ts:903-1007） | 照 openrouter 模式（:1010-1071）；`xaiProvider()/kimiCodingProvider().auth.oauth.login` 已实测存在（pi-ai auth/types.d.ts:202-220） | 中（删代码+去重 client id） |
| P7 | `ModelRegistry.refresh`（可取消）+ 放开 allowModelNetwork | 静态目录，新模型等升级 | ModelRefreshService 接 refresh({providers, signal})（model-registry.d.ts:24）；按 provider 放开网络 | 中（模型时效） |
| P8 | `queue_update`/`setSteeringMode`/`setFollowUpMode` | queue_update 显式忽略；恒 followUp | 映射到 `steer_undelivered`（先接通孤儿消费者 SessionManager.ts:8279-8282）/status；设置页开放队列模式 | 中（UX） |
| P9 | `setAutoRetryEnabled`/`abortRetry` | auto-retry 在跑但不可控 | 设置开关 + Stop 时 abortRetry | 中 |
| P10 | `excludeTools` denylist | allowlist 体操 + 手工过滤 | browser_tool 门控等走 excludeTools | 低中 |
| P11 | `scopedModels`/`resolveCliModel` | 自研三档 + resolvePiModel | 三档骑 scopedModels；默认串解析用 resolveCliModel | 低中 |
| P12 | `minimal` thinking 档 | 6 档缺 minimal（pi 共 7 档） | 加档（若产品需要） | 低 |
| P13 | `annotations.readOnlyHint` 传播 | 只读元数据未进 Pi 注册 | 从 SESSION_TOOL_DEFS.readOnly/api_ GET 传播 | 低中（并行调度） |
| P14 | Skills API（loadSkills/parseSkillBlock） | 自研 mention+前置机制 | 评估把 skills 注册为 pi 插件启用原生 Skill 工具 | 低中（生态兼容） |
| P15 | `setSessionName`/`getSessionStats`/`getLastAssistantText` | 自研改名/状态 | 名称/标题/状态徽章用 SDK 数据 | 低 |
| P16 | telemetry / `shouldStopAfterTurn` / 远程 PiClient / Baseten / samplingParams | 未用 | 按需评估（samplingParams 对自定义 OpenAI 兼容端点有价值 `[INFERENCE]`） | 低 |

**注意**：Pi SDK 无内置 MCP client、无 web_search/web_fetch（内置仅 7 个文件工具）——Craft 的 MCP 代理、web 工具、fetch 拦截器是必要增量，不在「未应用」之列。Craft 自研 JSONL 协议而非 pi 内置 RPC 模式（`runRpcMode`/`RpcClient`）是**合理决策**（RPC 模式面向终端交互，Craft 需要的是自定义工具/权限/UI 语义），不建议迁移。

---

## 6. 内核升级伴随风险（升级 0.84.0 后需回归验证）

1. **harness v4 重构后的会话恢复路径**（0.84 Breaking，**层级澄清**）：pi-agent-core harness 会话模型换成 v4 lane-based，但 pi-coding-agent 以内存态恢复（`agent.state.messages = existingSession.messages`），Craft 的 `.pi-sessions` JSONL 文件格式**仍是 v3**（session-manager.d.ts:11 `CURRENT_SESSION_VERSION = 3`），无文件迁移需求。**验证项**：升级后旧会话经 `continueRecent` 恢复、分支锚点（pi_turn_anchor）在新 harness 下 leaf id 语义是否不变——这是行为回归而非格式迁移
2. **`message_end` 事件时序假设**（pi-agent-server index.ts:1144-1193）：`message_end` 先于 `appendMessage` 的 SDK 内部顺序是分支锚点机制的前提。0.84 会话层重构后**必须回归分支创建**
3. **auto-compaction 竞态 workaround**（event-adapter.ts:26-35）：`SDK_AUTOCOMPACT_RACE_SIGNATURE = /_autoCompactionAbortController\.signal/`（常量 :35）匹配 compaction_end.errorMessage（:570）中的私有栈签名——0.84 是否已修该 race 未确认，签名可能已变。**验证项**：GPT 模型长会话 overflow 自动压缩路径
4. **system-prompt-override 私有戳写**：0.84 `prompt()` 内部对 `_systemPromptOverride` 的读写逻辑（agent-session.js:885-909）已实测核实（写入 :901-908、逐轮赋值 :644、轮末重置 :753）——当前 hack 依赖 `_baseSystemPrompt`/`_rebuildSystemPrompt` 行为，「0.84 相对 0.83 逻辑已变化」无法从单版本证实 `[INFERENCE]`；**升级后系统提示完整性需实测**（含 skills 章节）
5. **OAuth refresh 签名变化**（0.84 Breaking：refresh 需具体 abort signal）——已在 pi-agent.ts:845-853 用 `new AbortController().signal` 适配；注意 `PI_SUBSCRIPTION_OAUTH_REFRESH` 表在 import 时**急切构建**（:66-73），非懒加载；升级后需确认 refresh 行为未变
6. **`contextWindow` 显示过期**（非升级引入，但升级后模型目录变化会放大）：setModel 后 PiEventAdapter 的 `contextWindow` 不更新（pi-agent.ts:376-385 唯一设置点）

---

## 7. 行动路线建议

**Phase 0（零风险，半天）**：R16/R17/R18/R19/R20/R24 文档、文案、注释、测试断言清理；R7（先清 SessionManager.ts:1824 调用点）/R10/R11（按实际符号名 isSpawnEnoent）/R12/R13（含 event-adapter.ts:505 调用点）/R15（保留 :977-978）/R23 死代码删除。R18/R24 项应含本审计新增发现（SessionManager.ts:3264/:4373、base-agent.ts:414-418、ApiKeyInput、CredentialsStep、model-picker-helpers、useOnboarding、eslint.config.mjs:196-198、electron-dev.ts:295-303、event-adapter.ts:61 头文档）。**不含 release-notes 历史条目。**

**Phase 1（低风险架构收敛，1-2 天）**：R1/R2 `SdkMcpServerConfig`→新名 + 去 `{type:'sdk'}` 包装；R5/R6 恒值分发收敛（注意 connectionTypeToProvider 尚有 :442 调用）；R14 Bedrock 映射单一来源；R3 session-mcp-server 定生死（接线或摘除）；R9 legacy schema 收敛（确认迁移覆盖后）。

**Phase 2（功能增益，2-4 天）**：P1 system prompt 公开 API 化（resourceLoader + before_agent_start 钩子，双管齐下）；P4 setActiveToolsByName（仅工具开关场景）；P2 getContextUsage + contextWindow 刷新；P6 grok-x/kimi OAuth 去重；P10 excludeTools。

**Phase 3（产品化，按需）**：P3 会话树 UI（navigateTree）；P8 队列可见性（先接通 steer_undelivered 孤儿消费者）；P9 auto-retry 开关；P5 导出；P7 模型目录在线刷新。

**升级回归清单（每次 pi 内核升级必跑）**：分支创建+恢复、overflow 自动压缩（GPT 长会话）、system prompt 完整性（含 skills 章节）、OAuth 刷新（Claude/Copilot/ChatGPT/grok/kimi）、旧 `.pi-sessions` 文件恢复（v3 格式）、call_llm 并行 prefetch、mac/Linux 打包冒烟（防 verifyPackagedSDK 类死代码复活）。

---

## 8. 证据索引（关键文件）

- `packages/pi-agent-server/src/index.ts`（1835 行）——SDK 唯一直触面（运行时值 import）
- `packages/shared/src/agent/pi-agent.ts`（2755 行）——主进程 JSONL 客户端
- `packages/shared/src/agent/backend/pi/event-adapter.ts`（828 行）——事件翻译 + 溢出恢复状态机
- `packages/shared/src/agent/backend/factory.ts` / `internal/driver-types.ts` / `internal/drivers/pi.ts`——单驱动分发
- `packages/server-core/src/sessions/SessionManager.ts`（8912 行）——会话生命周期
- `packages/shared/src/config/llm-connections.ts` / `models.ts` / `models-pi.ts` / `provider-metadata.ts` / `validators.ts`——连接与模型
- `packages/shared/src/auth/{claude-oauth,chatgpt-oauth,github-copilot}.ts`、`packages/server-core/src/handlers/rpc/llm-connections.ts`——OAuth 实现
- `packages/shared/src/unified-network-interceptor.ts`（2288 行）——fetch 拦截/元数据
- `packages/session-tools-core/src/tool-defs.ts`（SESSION_TOOL_DEFS 28 条）——会话工具权威注册表
- `packages/session-mcp-server/src/index.ts`——休眠 stdio MCP server
- `packages/shared/src/agent/core/{pre-tool-use,prerequisite-manager,keep-alive,session-lifecycle}.ts`、`skills/`、`automations/`、`mcp/`、`sources/`——权限/技能/自动化/MCP
- `packages/pi-agent-server/src/{system-prompt-override,craft-metadata-schema,model-resolution}.ts`、`packages/shared/src/agent/{tool-definition,browser-tool-names,spawn-helpers,errors}.ts`
- `scripts/build/{common,darwin,linux,win32}.ts`、`build-server.ts`、`electron-builder.yml`、`eslint.config.mjs`
- `node_modules/@earendil-works/pi-coding-agent/dist/*.d.ts`（sdk.d.ts/agent-session.d.ts/session-manager.d.ts/resource-loader.d.ts/model-registry.d.ts/model-resolver.d.ts/skills.d.ts/extensions/*）+ `agent-session.js`/`sdk.js`/`session-manager.js` + CHANGELOG.md——SDK 0.84.0 权威面
- `node_modules/@earendil-works/pi-ai/dist/{providers/*,auth/types.d.ts,models.d.ts}`、`@earendil-works/pi-agent-core/dist/types.d.ts`（ThinkingLevel 7 档）
- 历史文档：`docs/single-pi-backend-migration.md`、`AUDIT_REPORT.md`
