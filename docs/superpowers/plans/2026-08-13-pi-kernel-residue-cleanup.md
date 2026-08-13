# Pi 内核双 SDK 残留清理与能力接入 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依据 `docs/pi-kernel-0.84-upgrade-analysis.md`（2026-08-13 审计修订版），清除双 SDK 时代残留（R1-R24），接入高收益 Pi SDK 能力（P1/P2/P6/P10），消除私有 API 戳写这一最大升级脆弱点。

**Architecture:** 分四阶段：Phase 0 零风险清理（死代码/文案/注释/测试）、Phase 1 低风险架构收敛（改名/分发/映射单一来源）、Phase 2 功能增益（system prompt 公开 API 化、excludeTools、getContextUsage 接线、OAuth 去重）、Phase 3 独立后续计划（navigateTree UI、导出、模型刷新等产品级功能，本计划不含）。全部任务按 commit 粒度切分，每任务以 typecheck + 定向测试 + grep 零命中收口。

**Tech Stack:** Bun 1.x monorepo、TypeScript 5、`@earendil-works/pi-coding-agent@0.84.0`、`@modelcontextprotocol/sdk`、Electron renderer React、i18next（7 locale JSON）。

---

## 前置决策与假设（执行前确认）

| ID | 决策 | 默认 | 理由 |
|---|---|---|---|
| D1 | R3 session-mcp-server：摘除打包 vs 补 `/spawn-session` 接线 | **摘除打包**（保留源码） | 无 spawn 点、回调 404、Codex 时代产物；若未来外部客户端需要，补接线是独立功能 |
| D2 | R9 legacy schema 收敛（validators.ts 收窄到 'pi'\|'pi_compat'） | **本计划不做** | 需旧配置存量数据；测试 session-branching-validation.test.ts:113-114 守护的正是该容忍行为 |
| D3 | R1 新类型名 | `AgentMcpServerConfig` | 与 sources/server-builder.ts:35-37 的 McpServerConfig 不冲突，语义（agent 层服务器连接配置）准确 |
| D4 | P4 `setActiveToolsByName` | **推迟** | SDK 只能开关已注册工具、无公开注册新工具 API；browser_tool 门控场景由 Task 18（P10 excludeTools）覆盖，剩余收益低 |
| D5 | 1M 管线删除后的拦截器行为 | **无条件剥离** context-1m header | 旧默认 enable1MContext=false 即恒剥离；UI 开关已移除，恒剥离保持既有运行时行为 |

**约定**：typecheck 命令 `bun run typecheck:all`（慢，收尾用）；定向 typecheck：`cd packages/shared && bun run tsc --noEmit`、`cd packages/pi-agent-server && bun run typecheck`、`cd packages/server-core && bun run tsc --noEmit`、`cd apps/electron && bun run typecheck`。测试：`bun test <file>`。grep 工具查零命中（排除 node_modules）。

---

## Phase 0 — 零风险清理

### Task 1: 删除硬抛死代码构建脚本（R23）

**Files:**
- Delete: `scripts/build/darwin.ts`, `scripts/build/linux.ts`, `scripts/build/win32.ts`

- [ ] **Step 1: 确认不可达**
```bash
grep -rn "build/darwin\|build/linux\|build/win32" scripts apps package.json --include="*.ts" --include="*.json" --include="*.yml"
```
预期：零命中（`electron:dist:*` 直连 electron-builder）。若命中，停止并回报。

- [ ] **Step 2: 删除三个文件**
```bash
git rm scripts/build/darwin.ts scripts/build/linux.ts scripts/build/win32.ts
```
（`scripts/build/common.ts` 保留——copyInterceptor/copyPiAgentServer/copySessionServer 仍被 build-server.ts 使用）

- [ ] **Step 3: 校验 build-server.ts 正常**
```bash
cd packages/server && bun run tsc --noEmit
```
预期：PASS（build-server.ts 不 import 被删文件）。

- [ ] **Step 4: Commit**
```bash
git commit -m "chore: remove dead verifyPackagedSDK build scripts (Claude binary checks)"
```

### Task 2: 删除 resolveAuthEnvVars no-op（R7）

**Files:**
- Modify: `packages/shared/src/config/llm-connections.ts:906-914`（函数体，删除）
- Modify: `packages/server-core/src/sessions/SessionManager.ts:1823-1834`（调用点，删除）

- [ ] **Step 1: 删调用点**。SessionManager.ts:1823-1834 当前代码：
```ts
      // Resolve auth env vars via shared utility (provider-agnostic)
      const result = await resolveAuthEnvVars(connection, slug!, manager, getValidClaudeOAuthToken)

      if (!result.success) {
        sessionLog.error(`Auth resolution failed for ${slug}: ${result.warning}`)
      } else {
        // Apply resolved env vars to process.env
        for (const [key, value] of Object.entries(result.envVars)) {
          process.env[key] = value
        }
        sessionLog.info(`Auth env vars set for connection: ${slug}`)
      }
```
替换为：
```ts
      sessionLog.info(`Reinitializing auth for connection: ${slug} (${connection.authType})`)
```
（上面 :1821 已有一行同样内容的日志，保留一处即可——删 :1823-1834 整块后确认无重复日志）

- [ ] **Step 2: 删函数定义**。llm-connections.ts:906-914 整块删除（含 "kept as a no-op for API compatibility" 注释）。同步删除对 `resolveAuthEnvVars` 的桶再导出（grep `resolveAuthEnvVars` 全仓清理）。

- [ ] **Step 3: 校验零引用**
```bash
grep -rn "resolveAuthEnvVars" packages apps --include="*.ts"
```
预期：零命中。

- [ ] **Step 4: Typecheck + Commit**
```bash
cd packages/shared && bun run tsc --noEmit && cd ../server-core && bun run tsc --noEmit
git commit -m "refactor: remove resolveAuthEnvVars no-op and its caller"
```

### Task 3: 删除 Claude 二进制死代码（R11）

**Files:**
- Modify: `packages/shared/src/agent/spawn-helpers.ts`（删 :34/:36-41/:49-61 三个函数及关联注释）
- Modify: `packages/shared/src/agent/errors.ts:231-237`（删 `sdk_binary_missing` 文案）
- Modify: `packages/core/src/types/message.ts:478`（删 ErrorCode union 中 `'sdk_binary_missing'` 成员）

- [ ] **Step 1: 确认零调用**
```bash
grep -rn "SDK_BINARY_NOT_FOUND_RE\|extractSdkReportedBinaryPath\|isSpawnEnoent\|sdk_binary_missing" packages apps --include="*.ts" --include="*.tsx"
```
预期：仅定义处命中（spawn-helpers.ts、errors.ts、message.ts 各一），无调用点。`isExistingDirectory`（:18）保留。

- [ ] **Step 2: 删除**。spawn-helpers.ts 删三个函数（注意保留文件头注释中与其他函数相关的部分）；errors.ts 删 :231-237；message.ts 删 union 成员。若 `agent/index.ts`/`backend/index.ts` 桶再导出这些符号，一并删除。

- [ ] **Step 3: Typecheck + Commit**
```bash
cd packages/shared && bun run tsc --noEmit && cd ../core && bun run tsc --noEmit
git commit -m "chore: delete dead Claude binary error helpers"
```

### Task 4: 删除 onChatGptAuthRequired / PiBackend 别名（R12）

**Files:**
- Modify: `packages/shared/src/agent/pi-agent.ts:354-363`（@deprecated getter/setter 别名）
- Modify: `packages/shared/src/agent/pi-agent.ts:2754-2755`（PiBackend 别名导出）
- Modify: `packages/shared/src/agent/index.ts:5`（桶再导出中的 `PiBackend`）

- [ ] **Step 1: 确认无消费者**
```bash
grep -rn "onChatGptAuthRequired\|PiBackend" packages apps --include="*.ts" --include="*.tsx"
```
预期：仅 pi-agent.ts:354-363、:2754-2755 与 agent/index.ts:5 三处定义/再导出。

- [ ] **Step 2: 删除三处**（onChatGptAuthRequired 的 getter/setter 直接删；PiBackend 的 `export { PiAgent as PiBackend }` 行删；agent/index.ts 的 `PiBackend` 从导出列表移除）

- [ ] **Step 3: Typecheck + Commit**
```bash
cd packages/shared && bun run tsc --noEmit
git commit -m "chore: drop deprecated onChatGptAuthRequired and PiBackend aliases"
```

### Task 5: 删除 setBlockReason/consumeBlockReason 死路径（R13）

**Files:**
- Modify: `packages/shared/src/agent/backend/base-event-adapter.ts:81-98`（两方法 + blockReasons map 声明）
- Modify: `packages/shared/src/agent/backend/pi/event-adapter.ts:499-519`（删 consumeBlockReason 调用与 blockReason 分支）

- [ ] **Step 1: 读当前代码**。base-event-adapter.ts:75-100（map + 两方法），event-adapter.ts:499-519（调用点）。

- [ ] **Step 2: 删调用点**。event-adapter.ts:504-505 与 :513-518 当前：
```ts
        // Check for block reason
        const blockReason = this.consumeBlockReason(toolCallId, resolvedToolName);
...
        if (accumulatedOutput) {
          result = accumulatedOutput;
        } else if (blockReason) {
          result = blockReason;
        } else {
          result = this.extractToolResult(event.result, isError);
        }
```
替换为：
```ts
        if (accumulatedOutput) {
          result = accumulatedOutput;
        } else {
          result = this.extractToolResult(event.result, isError);
        }
```

- [ ] **Step 3: 删定义**。base-event-adapter.ts 删 `setBlockReason`（:81-83）、`consumeBlockReason`（:90-98）及支撑的 `blockReasons` 字段声明。同步更新 `base-event-adapter.test.ts` 中针对两方法的测试（test 文件里 :101/:126/:131/:141 的 setBlockReason 用例删除）。

- [ ] **Step 4: 测试 + Typecheck + Commit**
```bash
cd packages/shared && bun test src/agent/backend/base-event-adapter.test.ts && bun run tsc --noEmit
git commit -m "refactor: remove dead blockReason path from event adapters"
```

### Task 6: 删除 thinking-levels 死代码（R10）

**Files:**
- Modify: `packages/shared/src/agent/thinking-levels.ts`（删 :71-121 区块）
- Modify: `packages/shared/src/agent/index.ts:79`（删桶再导出）

- [ ] **Step 1: 确认零调用**
```bash
grep -rn "THINKING_TO_EFFORT\|TOKEN_BUDGETS\|getThinkingTokens" packages apps --include="*.ts" --include="*.tsx"
```
预期：仅 thinking-levels.ts 定义 + agent/index.ts:79 再导出。

- [ ] **Step 2: 删除**。thinking-levels.ts 保留 :29-36 `THINKING_LEVEL_IDS` 及之前内容；删 :71-80 `THINKING_TO_EFFORT`、:89-109 `TOKEN_BUDGETS`、:116-120 `getThinkingTokens` 及其中间注释；agent/index.ts:79 再导出删除。

- [ ] **Step 3: Typecheck + Commit**
```bash
cd packages/shared && bun run tsc --noEmit
git commit -m "chore: delete unused Claude-era thinking effort/budget helpers"
```

### Task 7: 删除 1M 上下文孤儿管线（R15）

**Files:**
- Modify: `packages/shared/src/unified-network-interceptor.ts:793-802`（改为无条件剥离）
- Modify: `packages/shared/src/i18n/locales/en.json:975-976`（`settings.ai.extendedContext` 两个 key；**:977-978 extendedPromptCache 保留**）
- Modify: `packages/shared/src/protocol/channels.ts:341-342`
- Modify: `packages/shared/src/config/storage.ts:83`、`:553-566`（`getEnable1MContext`/`setEnable1MContext`）
- Modify: `packages/server-core/src/handlers/rpc/settings.ts:309-318`
- Modify: `apps/electron/src/shared/types.ts:607-608`、`apps/electron/src/main/.../channel-map.ts:327-328`
- Modify: `packages/server-core/src/sessions/SessionManager.ts:3460`（读 `getEnable1MContext()` 处）
- Modify: interceptor-common.ts:148 附近（`is1MContextEnabled` 定义，删）

- [ ] **Step 1: 全量定位**
```bash
grep -rn "Enable1MContext\|enable1MContext\|ENABLE_1M\|is1MContextEnabled\|extendedContext" packages apps scripts --include="*.ts" --include="*.tsx" --include="*.json"
```
逐一核对命中项与本任务 Files 清单一致（若有额外命中，评估后一并清理或回报）。

- [ ] **Step 2: 拦截器改无条件剥离**。interceptor.ts:793-802 当前：
```ts
    // Strip SDK-injected 1M context beta when setting disables it.
    // The SDK adds this header automatically for Opus/Sonnet 4.6 models,
    // but the user may want 200K context to conserve usage limits.
    if (!is1MContextEnabled()) {
      debugLog('[Anthropic] Stripping context-1m beta header (enable1MContext=false)');
      init = {
        ...init,
        headers: stripBetaHeader(init?.headers as HeadersInitType | undefined, 'context-1m-2025-08-07'),
      };
    }
```
替换为：
```ts
    // Strip SDK-injected 1M context beta. The 1M opt-in setting was removed
    // with the single-Pi-backend migration; default to 200K to conserve limits.
    debugLog('[Anthropic] Stripping context-1m beta header');
    init = {
      ...init,
      headers: stripBetaHeader(init?.headers as HeadersInitType | undefined, 'context-1m-2025-08-07'),
    };
```
同步删除 `is1MContextEnabled` import 及其定义（interceptor-common.ts）。

- [ ] **Step 3: 删其余管线**。按 Step 1 清单删除：locale keys（仅 :975-976）、RPC channel 常量、storage get/set 函数与字段、settings RPC handlers、electronAPI 类型、channel-map 映射、SessionManager.ts:3460 读取处（initConfig 中不再携带该值）。每删一处跑一次对应包 typecheck。

- [ ] **Step 4: i18n 校验 + Typecheck + Commit**
```bash
bun run lint:i18n:parity && bun run typecheck:all
git commit -m "refactor: remove orphaned 1M context pipeline; always strip beta header"
```

### Task 8: 修 7 个 locale 的 Claude SDK 文案（R16）

**Files:**
- Modify: 7 个 `packages/shared/src/i18n/locales/*.json` 的 `onboarding.apiSetup.claudeDesc`（均在 :680）

- [ ] **Step 1: 替换文案**。`onboarding.apiSetup.claudeDesc` 新文案（保留 `claude` 品牌名，删 "Agent SDK"）：
```json
  "onboarding.apiSetup.claudeDesc": "Use your Claude subscription or API key. Configured via the Craft backend.",
```
各语言：
- `de.json`: "Verwenden Sie Ihr Claude-Abonnement oder Ihren API-Key. Konfiguration über das Craft-Backend."
- `es.json`: "Usa tu suscripción de Claude o una clave API. Se configura a través del backend de Craft."
- `hu.json`: "Használd a Claude-előfizetésedet vagy API-kulcsodat. A konfiguráció a Craft backendben történik."
- `ja.json`: "ClaudeサブスクリプションまたはAPIキーを使用します。Craftバックエンド経由で設定されます。"
- `pl.json`: "Użyj subskrypcji Claude lub klucza API. Konfiguracja odbywa się przez backend Craft."
- `zh-Hans.json`: "使用 Claude 订阅或 API 密钥。通过 Craft 后端进行配置。"

- [ ] **Step 2: 校验**
```bash
bun run lint:i18n:parity && bun run scripts/check-i18n-coverage.ts && bun run lint:i18n:sorted
```
预期：全部 PASS（sorted 若因修改失序，跑 `bun scripts/sort-locales.ts` 修复）。

- [ ] **Step 3: Commit**
```bash
git commit -m "i18n: replace Claude Agent SDK onboarding copy across 7 locales"
```

### Task 9: 两份 README 重写（R17）

**Files:**
- Modify: `packages/core/README.md:93-97`
- Modify: `apps/electron/README.md:51-61`

- [ ] **Step 1: core/README.md**。删除 `@anthropic-ai/claude-agent-sdk 0.3.154` peer dep 条目及 "The Claude Agent SDK also requires @anthropic-ai/sdk >= 0.93.0" 句。先核对 `packages/core/package.json` 的实际 peerDependencies，按实际内容重写该段（core 为事件/类型包，无 SDK 依赖——写 "This package has no AI SDK dependency; agent runtimes live in packages/shared and packages/pi-agent-server."）。

- [ ] **Step 2: electron/README.md**。删除 "### 1. SDK Path Resolution (CRITICAL)" 整节（:51-61，含 `setPathToClaudeCodeExecutable`、`@anthropic-ai/claude-agent-sdk-binary` 描述），替换为 Pi 子进程打包说明：
```markdown
### 1. Pi Agent Subprocess Bundling

The Electron app spawns `packages/pi-agent-server` (a Bun-compiled JS bundle) as a
JSONL-over-stdio subprocess. `scripts/build/common.ts` stages the interceptor bundle,
`pi-agent-server`, and the session MCP server into the packaged resources. The Pi SDK
(`@earendil-works/pi-coding-agent`) is bundled into the pi-agent-server build output —
no native binaries are staged.
```

- [ ] **Step 3: Commit**
```bash
git commit -m "docs: remove stale Claude Agent SDK references from READMEs"
```

### Task 10: 注释/文档残留批量清理（R18/R19/R24）

**Files:**
- Modify: `packages/shared/src/agent/base-agent.ts:414-418`
- Modify: `packages/shared/src/agent/backend/types.ts:647`
- Modify: `packages/shared/src/agent/backend/event-queue.ts:5-6`
- Modify: `packages/shared/src/agent/core/session-lifecycle.ts:7-9`
- Modify: `packages/shared/src/agent/core/pre-tool-use.ts:5-6`
- Modify: `packages/shared/src/agent/core/permission-manager.ts:4-5`
- Modify: `packages/server-core/src/sessions/SessionManager.ts:2721、:885-886、:3264、:4373`
- Modify: `packages/shared/src/sessions/storage.ts:459-461`
- Modify: `packages/shared/src/agent/pi-agent.ts:961`
- Modify: `packages/shared/src/mcp/api-source-pool-client.ts:3-5`
- Modify: `packages/shared/src/agent/backend/pi/event-adapter.ts:61`
- Modify: `packages/server-core/src/model-fetchers/PiModelFetcher.ts:11`
- Modify: `packages/shared/src/config/models.ts:206`
- Modify: `scripts/electron-dev.ts:295-303`、`apps/electron/eslint.config.mjs:196-198`
- Rewrite: `packages/shared/CLAUDE.md`
- Modify（UI 品牌，R24）: `apps/electron/src/renderer/components/onboarding/CredentialsStep.tsx:348-351`、`apps/electron/src/renderer/components/app-shell/input/model-picker-helpers.ts:39-47`、`apps/electron/src/renderer/hooks/useOnboarding.ts:104-107`、`apps/electron/src/renderer/components/app-shell/input/ApiKeyInput.tsx:93-94、:139-140`、`TaskEditor.tsx:54-55`、`provider-icons.ts:48-49`、`connection-setup-logic.ts:141-142`

- [ ] **Step 1: 逐处改写**（每处旧注释→新注释，均为纯注释/文案，不改行为）：

| 位置 | 新内容 |
|---|---|
| base-agent.ts:414-418 | 删「EXTERNAL MCP server subprocess」段，改为「Session tools execute in the main process; the Pi subprocess receives them as proxy tool definitions via register_tools.」 |
| backend/types.ts:647 | `'anthropic' → ClaudeAgent` → `'pi' → PiAgent (Pi SDK subprocess)` |
| event-queue.ts:5-6 | 删「unlike ClaudeAgent's synchronous for-await loop」对比句 |
| session-lifecycle.ts:7-9 | 删「- ClaudeAgent uses AbortController…」分支句，保留 PiAgent 描述 |
| pre-tool-use.ts:5-6 | 「which both agent backends (Claude and Pi) call」→「called by the Pi backend's permission pipeline」 |
| permission-manager.ts:4-5 | 「both ClaudeAgent and PiAgent can use」→「used by the Pi backend」 |
| SessionManager.ts:2721、:885-886 | `~/.claude/projects/{cwd-hash}` → `{sessionPath}/.pi-sessions/`（Pi SDK v3 JSONL） |
| SessionManager.ts:3264 | 「using default anthropic provider」→「using default pi provider」 |
| SessionManager.ts:4373 | 「(anthropic defaults to 'queue')」→「(midStream is always 'steer' in the Pi backend)」 |
| storage.ts:459-461 | 「start a fresh Claude conversation」→「start a fresh conversation」 |
| pi-agent.ts:961 | 删描述不存在 spawn 通路的注释（CRAFT_LLM_CALLBACK_TOKEN 段） |
| api-source-pool-client.ts:3-5 | 「created by createSdkMcpServer」→「in-process MCP client for REST API sources (built by createInProcessMcpServer)」 |
| event-adapter.ts:61 | 「auto_retry_end → status」→「auto_retry_end → error (failure only)」 |
| PiModelFetcher.ts:11 | 删「CLI startup + API call」句（Copilot 走 direct HTTP，无 CLI） |
| models.ts:206 | `apps/electron/src/main/model-fetchers/` → `packages/server-core/src/model-fetchers/` |
| electron-dev.ts:295-303 | 删 SDK externalization 注释段 |
| eslint.config.mjs:196-198 | 删禁 `@anthropic-ai/claude-agent-sdk` import 的规则条目 |

- [ ] **Step 2: UI 品牌（R24）**
  - `CredentialsStep.tsx:348-351`：硬编码英文段删除，改用既有 i18n key（若无对应 key，新增 `onboarding.credentials.apiKeyHint` 到 7 个 locale 并本地化）；`'pi_api_key' : 'anthropic'` 三元改为统一 `'pi'`。
  - `model-picker-helpers.ts:39-47`：`groupConnectionsByProvider` 的分组头 "Anthropic" → 按组件现有 i18n 模式改 'Pi'。
  - `useOnboarding.ts:104-107`：slug 是持久化标识，改动需迁移。**执行前先 grep slug 的存储/迁移逻辑**：若已持久化则保留 slug 值、仅改注释；否则 `'anthropic-api'`→`'pi-api'`。
  - `ApiKeyInput.tsx:93-94、:139-140`：注释改为 Pi backend 措辞。
  - `TaskEditor.tsx:54-55`/`provider-icons.ts:48-49`/`connection-setup-logic.ts:141-142`："Anthropic" 展示名 → "Claude (via Pi)"（用户可见文案走 i18n，缺 key 则新增）。

- [ ] **Step 3: shared/CLAUDE.md 重写**。全文替换为：
```markdown
# Shared Package

PiAgent (`src/agent/pi-agent.ts`) is the only agent backend: a JSONL-over-stdio
client driving the `packages/pi-agent-server` subprocess, which is the sole
runtime importer of `@earendil-works/pi-coding-agent`.

- `defaultMidStreamBehavior()` always returns `'steer'` (config/llm-connections.ts).
- Event vocabulary: `text_delta/text_complete/tool_start/tool_result/complete/status/error`
  (`src/agent/backend/pi/event-adapter.ts`).
- Permission pipeline: main-process authority via `pre_tool_use_request/response`
  (`src/agent/core/pre-tool-use.ts`).
```
（`resolveClaudeThinkingOptions`、claude-agent.ts 引用一并消失）

- [ ] **Step 4: 校验 + Commit**
```bash
bun run lint:i18n:parity && bun run typecheck:all
git commit -m "docs: purge ClaudeAgent-era comments and UI branding residues"
```

### Task 11: 测试 'anthropic' 分支断言处理（R20）

**Files:**
- Modify: `apps/electron/src/main/__tests__/session-branch-rollback.isolated.ts`（约 :109-111、:150-152、:265、:274）
- Keep（D2 决策）: `apps/electron/src/main/__tests__/session-branching-validation.test.ts:113-114`——该测试守护 legacy 'anthropic' 配置的**容忍校验行为**（validators.ts:69-73 仍接受 legacy 值），保留并加注释

- [ ] **Step 1: rollback.isolated.ts**。将 mock 中 `isAnthropicProvider: () => true`、`providerTypeToAgentProvider: () => 'anthropic'`、claude 模型 id（'claude-sonnet-4-20250514'）改为 Pi 值（providerType 'pi'、模型改 MODEL_REGISTRY 中的裸 id），使 mock 链与实际单 Pi 运行时一致。逐条运行确认仍 PASS：
```bash
cd apps/electron && bun test src/main/__tests__/session-branch-rollback.isolated.ts
```

- [ ] **Step 2: branching-validation.test.ts**。在 :113-114 用例上方加注释：
```ts
// Guards legacy-provider tolerance: LlmProviderTypeSchema (validators.ts)
// still accepts legacy values until old stored configs are migrated (D2).
```

- [ ] **Step 3: Commit**
```bash
git commit -m "test: align branch rollback mocks with single-Pi runtime"
```

---

## Phase 1 — 低风险架构收敛

### Task 12: SdkMcpServerConfig → AgentMcpServerConfig（R1）

**Files（8 个）:**
- Modify: `packages/shared/src/agent/backend/types.ts:308-326`（定义）、`base-agent.ts:40/:610`、`pi-agent.ts:26/:2318`、`mcp/mcp-pool.ts`（:19/:62/:86/:107/:186/:250/:255）、`server-core/src/sessions/SessionManager.ts:448`、`agent/index.ts`、`backend/index.ts`、`tests/mcp-pool.test.ts`

- [ ] **Step 1: lsp rename**。对 `backend/types.ts:308` 的 `SdkMcpServerConfig` 执行 lsp rename → `AgentMcpServerConfig`（重命名会覆盖全部 8 文件引用与 import）。

- [ ] **Step 2: 校验零残留**
```bash
grep -rn "SdkMcpServerConfig" packages apps --include="*.ts" --include="*.tsx"
```
预期：零命中。注意保留 `sources/server-builder.ts:35-37` 的 `McpServerConfig`（不同概念，不动）。

- [ ] **Step 3: Typecheck + Commit**
```bash
bun run typecheck:all
git commit -m "refactor: rename SdkMcpServerConfig to AgentMcpServerConfig"
```

### Task 13: createInProcessMcpServer 去 {type:'sdk'} 包装（R2）

**Files:**
- Modify: `packages/shared/src/mcp/sdk-mcp-server-factory.ts`（返回 `McpServer` 本体，删 `InProcessMcpServerResult`）
- 消费者（typecheck 兜底发现）: `agent/session-scoped-tools.ts:222`、`sources/api-tools.ts:364`、`sources/server-builder.ts:56/:169/:323`——`ReturnType<typeof createInProcessMcpServer>` 自动跟随，需改的是对 `.instance`/`type === 'sdk'` 的解包点

- [ ] **Step 1: 改工厂**。sdk-mcp-server-factory.ts:24-56：
```ts
export interface InProcessMcpServerResult {
  type: 'sdk';
  instance: McpServer;
}

export function createInProcessMcpServer(options: {
  ...
}): InProcessMcpServerResult {
  ...
  return {
    type: 'sdk',
    instance: server,
  };
}
```
改为（删除 `InProcessMcpServerResult`，返回类型 `McpServer`）：
```ts
export function createInProcessMcpServer(options: {
  name: string;
  version: string;
  tools: SdkMcpToolEntry[];
}): McpServer {
  ...
  return server;
}
```
文件头注释 :1-7 同步更新（删 "返回类型与 createSdkMcpServer 兼容" 句）。

- [ ] **Step 2: 找解包点**
```bash
grep -rn "\.instance\|type === 'sdk'\|type: 'sdk'" packages/shared/src --include="*.ts"
```
预期命中 McpPoolServer/外部桥接处对 `{type:'sdk', instance}` 的消费（如 pool-server.ts 或 session-scoped-tools 调用方）。逐个把 `.instance` 解包改为直接使用 `McpServer`。

- [ ] **Step 3: Typecheck（兜底）+ 定向测试 + Commit**
```bash
cd packages/shared && bun run tsc --noEmit && bun test tests/mcp-pool.test.ts
git commit -m "refactor: return McpServer directly from createInProcessMcpServer"
```

### Task 14: Bedrock 映射单一来源（R14）

**Files:**
- Modify: `packages/shared/src/config/models.ts:12-59`（`BEDROCK_TO_BARE` 加 export + 注释改写）
- Modify: `packages/shared/src/config/llm-connections.ts:746-790`（删本地 `BEDROCK_REVERSE_MAP`，改为 import）

- [ ] **Step 1: 验证两份映射逐条一致**。用临时脚本逐键比较两个字面量（models.ts `BEDROCK_TO_BARE` 与 llm-connections.ts `BEDROCK_REVERSE_MAP`）。预期：37 条逐键相等。**注意：反向映射不是 `BEDROCK_MODEL_MAP` 的简单反转**——它含 `-v1` 别名、EU/global 变体、base ID，必须保留完整字面量，不能机械推导（审计已确认此结论）。

- [ ] **Step 2: 单一来源**。models.ts:
```ts
// Bedrock-native → bare Anthropic ID reverse mapping.
// Single source of truth — llm-connections.ts imports it (was duplicated
// to avoid circular imports; models.ts must stay import-free of llm-connections).
export const BEDROCK_TO_BARE: Record<string, string> = { /* 原字面量不动 */ };
```
llm-connections.ts: 删 :746-790 本地定义，文件顶部加：
```ts
import { BEDROCK_TO_BARE } from './models.ts';
```
并将原 `BEDROCK_REVERSE_MAP` 的使用点改为 `BEDROCK_TO_BARE`（grep `BEDROCK_REVERSE_MAP` 全仓清理）。若 llm-connections 已有对 models 的 import，合并。

- [ ] **Step 3: 测试 + Commit**
```bash
cd packages/shared && bun test tests/llm-connections.test.ts tests/models-pi.test.ts && bun run tsc --noEmit
git commit -m "refactor: single-source the Bedrock reverse model map"
```

### Task 15: 恒值分发收敛（R5/R6）

**Files:**
- Modify: `packages/shared/src/agent/backend/factory.ts`
- Modify: `packages/shared/src/agent/index.ts:132`、`backend/index.ts:56`（detectProvider 再导出）

- [ ] **Step 1: connectionTypeToProvider 删除**。factory.ts:220-222 删除；唯一调用点 :442：
```ts
  const providerType = connection.providerType || (connection.type ? connectionTypeToProvider(connection.type) as unknown as LlmProviderType : 'pi');
```
改为：
```ts
  const providerType = (connection.providerType ?? 'pi') as LlmProviderType;
```

- [ ] **Step 2: connectionAuthTypeToBackendAuthType 更名**。该函数有真实行为（过滤 'none'/'environment' → undefined），不是恒值——采用 lsp rename → `normalizeBackendAuthType`，删除 @deprecated JSDoc，改写注释：
```ts
/**
 * Filter auth types that require no explicit credential passing
 * ('none'/'environment') to undefined; pass through the rest.
 */
```
调用点 :304、:488 由 rename 自动更新。

- [ ] **Step 3: detectProvider 删除**。factory.ts:83-85 函数体删除 + agent/index.ts:132、backend/index.ts:56 再导出删除（先 grep 确认无其他引用）。

- [ ] **Step 4: Typecheck + Commit**
```bash
cd packages/shared && bun run tsc --noEmit
git commit -m "refactor: consolidate constant provider dispatch helpers"
```
（`providerTypeToAgentProvider`/`BACKEND_CAPABILITIES`/`getDefaultProviderType` 保留——有真实调用者，属结构而非残留。）

### Task 15b: 删除零调用 migrate 函数（R8）

**Files:**
- Modify: `packages/shared/src/config/llm-connections.ts:57`（`LlmConnectionType` @deprecated 类型）、`:848`（migrateConnectionType）、`:867`（migrateAuthType）、`:922`（migrateLlmConnection）

- [ ] **Step 1: 确认零调用**
```bash
grep -rn "migrateConnectionType\|migrateAuthType\|migrateLlmConnection\|LlmConnectionType" packages apps --include="*.ts" --include="*.tsx"
```
预期：仅 llm-connections.ts 定义处（+ 可能的桶再导出）。若 storage 迁移文件（src/config/__tests__/storage-migrations.test.ts 等）引用，先读再决定是否连测试一起删。

- [ ] **Step 2: 删除**。三个函数删除；`LlmConnectionType` 若被 `validators.ts` 或其他 schema 引用则保留类型定义、仅删函数（D2 决策下 legacy 解析容忍仍在）；桶再导出同步清理。

- [ ] **Step 3: Typecheck + Commit**
```bash
cd packages/shared && bun run tsc --noEmit && bun test src/config/__tests__/storage-migrations.test.ts
git commit -m "chore: delete zero-caller legacy connection migrate helpers"
```

### Task 16: session-mcp-server 摘除打包（R3，决策 D1）

**Files:**
- Modify: `scripts/build-server.ts:168-181`（staging 段删除）
- Modify: `apps/electron/electron-builder.yml:23`（files 条目）+ `:68-69`（extraResources 条目）
- Modify: `scripts/build/common.ts:400-413`（`copySessionServer` 删除，含调用点）

- [ ] **Step 1: 确认无运行时依赖**（复核审计结论）
```bash
grep -rn "session-mcp-server\|sessionServer" packages apps --include="*.ts" --include="*.yml" --include="*.json" | grep -v "packages/session-mcp-server/"
```
预期：仅打包脚本（build-server.ts/common.ts/electron-builder.yml）与 driver-types.ts:16 类型声明命中；无 spawn/import 运行时引用。

- [ ] **Step 2: 摘除**。删上述三处 staging 拷贝；`driver-types.ts:16` 的 `sessionServer?: string` 字段删除（全仓唯一出现点，无消费者）；packages/session-mcp-server **源码保留**（若 root script `server:build:subprocess` 引用它，同步调整为仅构建 pi-agent-server：`"server:build:subprocess": "cd packages/pi-agent-server && bun run build"`）。

- [ ] **Step 3: 校验 + Commit**
```bash
cd packages/server && bun run tsc --noEmit && grep -rn "session-mcp-server" scripts apps/electron/electron-builder.yml
```
预期：第二命令零命中（scripts/build/common.ts 的 `copySessionServer` 已删）。
```bash
git commit -m "build: stop bundling dormant session-mcp-server (decision D1)"
```

---

## Phase 2 — 功能增益

### Task 17: system prompt 公开 API 化（P1）

**Files:**
- Create: `packages/pi-agent-server/src/craft-resource-loader.ts`
- Create: `packages/pi-agent-server/src/craft-resource-loader.test.ts`
- Delete: `packages/pi-agent-server/src/system-prompt-override.ts`、`system-prompt-override.test.ts`
- Modify: `packages/pi-agent-server/src/index.ts`（:92 import、:609-612 agentDir 提取、ensureSession 加 resourceLoader、:984-988 与 :1352-1357 改 setCraftSystemPrompt）

- [ ] **Step 1: 写失败测试**。`craft-resource-loader.test.ts`：
```ts
import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCraftResourceLoader, setCraftSystemPrompt } from './craft-resource-loader.ts';

describe('createCraftResourceLoader', () => {
  it('returns the Craft prompt via systemPromptOverride after reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-loader-'));
    setCraftSystemPrompt('CRAFT_PROMPT');
    const loader = await createCraftResourceLoader({ cwd: dir, agentDir: join(dir, '.pi-agent') });
    expect(loader.getSystemPrompt()).toBe('CRAFT_PROMPT');
  });

  it('falls back to the base prompt when no Craft prompt is set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-loader-'));
    setCraftSystemPrompt('');
    const loader = await createCraftResourceLoader({ cwd: dir, agentDir: join(dir, '.pi-agent') });
    expect(loader.getSystemPrompt()).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**
```bash
cd packages/pi-agent-server && bun test craft-resource-loader.test.ts
```
预期：FAIL（模块不存在）。

- [ ] **Step 3: 实现**。`craft-resource-loader.ts`：
```ts
import { mkdirSync } from 'node:fs';
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';

/**
 * Current Craft system prompt for the active session.
 * Updated per prompt message; read by the loader override and the
 * before_agent_start extension hook on every turn and rebuild.
 */
let currentCraftPrompt = '';

export function setCraftSystemPrompt(prompt: string): void {
  currentCraftPrompt = prompt;
}

/**
 * Create the SDK resource loader for a Craft session.
 *
 * Replaces the private-field stamping in system-prompt-override.ts (deleted):
 * - `systemPromptOverride` survives `_rebuildSystemPrompt` (tool changes) —
 *   resource-loader.js applies it on every reload/build.
 * - The inline extension's `before_agent_start` hook survives the per-turn
 *   reset: agent-session.js assigns `state.systemPrompt =
 *   _systemPromptOverride ?? _baseSystemPrompt` each turn and clears
 *   `_systemPromptOverride` after each run, so the hook must re-supply it.
 *
 * Craft manages context files/skills/prompts/themes itself — disable SDK
 * discovery so nothing foreign leaks into the prompt.
 */
export async function createCraftResourceLoader(options: {
  cwd: string;
  agentDir: string;
}): Promise<DefaultResourceLoader> {
  mkdirSync(options.agentDir, { recursive: true });
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => currentCraftPrompt || undefined,
    appendSystemPromptOverride: () => [],
    extensionFactories: [
      {
        name: 'craft-system-prompt',
        factory: (pi) => {
          pi.on('before_agent_start', () =>
            currentCraftPrompt ? { systemPrompt: currentCraftPrompt } : {},
          );
        },
      },
    ],
  });
  await loader.reload();
  return loader;
}
```

- [ ] **Step 4: 运行测试确认通过**
```bash
cd packages/pi-agent-server && bun test craft-resource-loader.test.ts
```
预期：PASS（loader.getSystemPrompt() 返回 override 值，resource-loader.js:382 已核实）。

- [ ] **Step 5: 接线 index.ts**
  - :92 import 改：`import { createCraftResourceLoader, setCraftSystemPrompt } from './craft-resource-loader.ts';`（删 applySystemPromptOverride import）。
  - ensureSession 中 agentDir 计算（:609-612）提取为模块级 helper：
```ts
function resolveIsolatedAgentDir(): string {
  const agentDir = initConfig.agentDir || join(initConfig.sessionPath, '.pi-agent');
  mkdirSync(agentDir, { recursive: true });
  return agentDir;
}
```
    ensureSession 与 runQueryWithModel（:964-970 ephemeralOptions）两处使用；ensureSession 的 `sessionOptions` 增加：
```ts
    resourceLoader: await createCraftResourceLoader({ cwd, agentDir: resolveIsolatedAgentDir() }),
```
    ephemeralOptions 同样增加该行。
  - :984-988 改：
```ts
    const promptForSession =
      request.systemPrompt ?? 'Reply with ONLY the requested text. No explanation.';
    setCraftSystemPrompt(promptForSession);
```
  - :1352-1357 改：
```ts
    if (msg.systemPrompt) {
      setCraftSystemPrompt(msg.systemPrompt);
    }
```

- [ ] **Step 6: 删除旧文件 + 测试 + Typecheck + Commit**
```bash
git rm packages/pi-agent-server/src/system-prompt-override.ts packages/pi-agent-server/src/system-prompt-override.test.ts
cd packages/pi-agent-server && bun test && bun run typecheck
git commit -m "feat: replace system-prompt private-field stamping with public resourceLoader API (P1)"
```

### Task 18: browser_tool 门控改 excludeTools（P10）

**Files:**
- Modify: `packages/pi-agent-server/src/index.ts`（InitMessage 加字段、ensureSession 设 excludeTools）
- Modify: `packages/shared/src/agent/pi-agent.ts`（init 发送加字段、删 :610-616 手工过滤）

- [ ] **Step 1: 子进程侧**。InitMessage（index.ts:114-137）加：
```ts
  /** Whether the browser session tool is enabled (false = exclude via SDK denylist) */
  browserToolEnabled?: boolean;
```
ensureSession 的 sessionOptions（:600-605 块）加：
```ts
    excludeTools: initConfig.browserToolEnabled === false ? ['mcp__session__browser_tool'] : undefined,
```
（`browserToolEnabled` 默认视为 true 与现状一致：现状只在 `!getBrowserToolEnabled()` 时过滤。）

- [ ] **Step 2: 主进程侧**。pi-agent.ts 删 :610-616：
```ts
    // Mirror Claude's gate: hide `browser_tool` when the user has disabled
    // the built-in browser tool. Without this filter, Pi would still advertise
    // `mcp__session__browser_tool` while Claude doesn't — sessions would behave
    // inconsistently depending on backend.
    if (!getBrowserToolEnabled()) {
      sessionToolDefs = sessionToolDefs.filter(d => d.name !== 'mcp__session__browser_tool');
    }
```
init 消息构造处（grep `type: 'init'`）加 `browserToolEnabled: getBrowserToolEnabled()`。确认 `getBrowserToolEnabled` import 保留（仍用于发送字段）。

- [ ] **Step 3: 校验 + Commit**
```bash
grep -rn "Mirror Claude's gate" packages || true   # 预期零命中
cd packages/pi-agent-server && bun test && bun run typecheck
cd ../../packages/shared && bun run tsc --noEmit
git commit -m "refactor: gate browser_tool via SDK excludeTools denylist (P10)"
```

### Task 19: setModel 后刷新 contextWindow（P2）

**Files:**
- Modify: `packages/pi-agent-server/src/index.ts`（:1595 update_runtime_config_result 加字段；:1626-1634 handleSetModel 发 set_model_result；出站消息 union 加成员）
- Modify: `packages/shared/src/agent/pi-agent.ts`（:1037 路由加 case；:1759-1772 handler 读字段；新增 handleSetModelResult）

- [ ] **Step 1: 子进程出站**。index.ts 出站消息 union（grep `type OutboundMessage` 或 send 类型定义处）加：
```ts
  | { type: 'set_model_result'; model: string; contextWindow?: number }
```
`update_runtime_config_result`（:1595）加 `contextWindow?: number` 字段。
handleSetModel（:1626-1634）在 `await piSession.setModel(piModel)` 之后：
```ts
    const contextWindow = piSession.agent.state.model?.contextWindow;
    send({ type: 'set_model_result', model: msg.model, contextWindow });
```
handleUpdateRuntimeConfig（:1588 之后）同样取值并入 :1595 的 send：
```ts
    const contextWindow = piSession.agent.state.model?.contextWindow;
    send({ type: 'update_runtime_config_result', id: msg.id, success: true, updated: true, contextWindow });
```
（`piSession.agent.state.model` 访问方式与 :797 既有代码一致。）

- [ ] **Step 2: 主进程消费**。pi-agent.ts 路由（:1037 case 块旁）加：
```ts
      case 'set_model_result':
        this.handleSetModelResult(msg);
        break;
```
新增方法（放在 handleRuntimeConfigUpdateResult :1772 之后）：
```ts
  /**
   * Handle set_model_result from subprocess — refresh the adapter's cached
   * context window so usage badges stay accurate after model switches.
   */
  private handleSetModelResult(msg: Record<string, unknown>): void {
    const contextWindow = msg.contextWindow;
    if (typeof contextWindow === 'number' && contextWindow > 0) {
      this.adapter.setContextWindow(contextWindow);
    }
  }
```
handleRuntimeConfigUpdateResult（:1759-1772）在 `pending.resolve(...)` 前加同款：
```ts
    const contextWindow = msg.contextWindow;
    if (typeof contextWindow === 'number' && contextWindow > 0) {
      this.adapter.setContextWindow(contextWindow);
    }
```
（`this.adapter.setContextWindow` 在构造函数 :384 已有同款调用，签名已核实。）

- [ ] **Step 3: 校验 + Commit**
```bash
cd packages/pi-agent-server && bun run typecheck && cd ../shared && bun run tsc --noEmit
git commit -m "feat: refresh contextWindow on model changes via set_model_result (P2)"
```

### Task 20: grok-x/kimi OAuth 改用 SDK 原生 login（P6）

**Files:**
- Modify: `packages/server-core/src/handlers/rpc/llm-connections.ts`（:903-1007 两个手写循环删除；两个 case 改为 SDK login）
- 参照实现: 同文件 openrouter case :1010-1070

- [ ] **Step 1: 读 SDK 事件形状**
```bash
cat node_modules/@earendil-works/pi-ai/dist/auth/oauth/xai.d.ts node_modules/@earendil-works/pi-ai/dist/auth/oauth/kimi-coding.d.ts node_modules/@earendil-works/pi-ai/dist/auth/oauth/device-code.d.ts
```
确认两 provider 的 login 为 device-code 流：`notify` 事件用 `{ type: 'device_code', userCode, verificationUri, intervalSeconds?, expiresInSeconds? }`（pi-ai auth/types.d.ts:141-145）。若形状不同（如 PKCE auth_url），按实际调整 notify 分支。

- [ ] **Step 2: 重写 grok-x case**（:903-957 删除，替换为）：
```ts
        case 'grok-x': {
          const { xaiProvider } = await import('@earendil-works/pi-ai/providers/xai')
          const oauth = xaiProvider().auth.oauth
          if (!oauth) return { success: false, error: 'Grok OAuth flow unavailable' }

          try {
            const credential = await oauth.login({
              signal: new AbortController().signal,
              notify: (event) => {
                if (event.type === 'device_code') {
                  pushTyped(server, RPC_CHANNELS.copilot.DEVICE_CODE, { to: 'client', clientId: ctx.clientId }, {
                    userCode: event.userCode,
                    verificationUri: event.verificationUri,
                  })
                } else if (event.type === 'progress') {
                  pushTyped(server, RPC_CHANNELS.copilot.DEVICE_CODE, { to: 'client', clientId: ctx.clientId }, {
                    userCode: '',
                    verificationUri: '',
                    progressMessage: event.message,
                  })
                }
              },
              prompt: async (prompt) => {
                throw new Error(`Unsupported Grok login prompt: ${(prompt as { type: string }).type}`)
              },
            })

            await credentialManager.setLlmOAuth(connectionSlug, {
              accessToken: credential.access,
              refreshToken: credential.refresh,
              expiresAt: credential.expires,
            })
            return { success: true }
          } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Grok OAuth failed' }
          }
        }
```
（错误处理需与现状对齐：现有循环区分 access_denied/expired_token/timeout——SDK login 抛错时统一走 catch，核查 UI 端错误展示是否可接受；`credentialManager.setLlmOAuth`/`pushTyped`/`RPC_CHANNELS.copilot.DEVICE_CODE` 均沿用文件内既有符号。）

- [ ] **Step 3: 重写 kimi-coding case**（:959-1007 同法，`import('@earendil-works/pi-ai/providers/kimi-coding')` + `kimiCodingProvider()`，其余与 Step 2 同构；错误文案 "Kimi OAuth failed"）。

- [ ] **Step 4: 校验 + Commit**
```bash
cd packages/server-core && bun run tsc --noEmit
git commit -m "refactor: use SDK-native OAuth login for grok-x and kimi-coding (P6)"
```

---

## Phase 3 — 独立后续计划（本计划不含）

以下为产品级功能，各有独立设计空间，逐个另立计划：

| 项 | 内容 | 前置 |
|---|---|---|
| P3 | 会话树 UI + navigateTree（消息「跳到此继续」、分支可视化） | RPC navigate 通道设计 |
| P5 | 会话导出（exportToJsonl/exportToHtml）UI | 无 |
| P7 | 模型目录在线刷新（ModelRegistry.refresh + 按 provider 放开网络） | 目录缓存/凭据安全评审 |
| P8 | 队列可见性（queue_update → steer_undelivered，接通 SessionManager.ts:8279-8282 孤儿消费者） | 事件 payload 形状确认 |
| P9 | auto-retry 开关/取消（setAutoRetryEnabled/abortRetry） | 设置页 UI |
| P12 | minimal thinking 档 | 产品确认 |
| P13 | annotations.readOnlyHint 传播 | 无 |
| P14 | skills 注册为 pi 插件启用原生 Skill 工具 | skills 生态评估 |
| P16 | telemetry / shouldStopAfterTurn / samplingParams | 按需 |
| D2 | R9 legacy schema 收敛（需存量配置数据后启动） | 遥测数据 |

---

## 自检清单

1. **覆盖核对**：R1-R24 中本计划覆盖 R1/R2/R3/R5/R6/R7/R10-R20/R23/R24（19 项）；R4（keepBackgroundTasksAlive 改名）留待与后台任务产品语义一起定名——**计划外，需用户确认**；R8（migrate 函数，零调用）可在 Phase 1 随手删——建议并入 Task 15 的 commit 或独立小任务；R9/R21/R22 按 D2/保留决策不动作。P 清单覆盖 P1/P2/P6/P10；其余入 Phase 3。
2. **占位扫描**：全部代码块为实测源码或已核实 SDK 签名；无 TBD/TODO。
3. **一致性**：`AgentMcpServerConfig`（D3）在 Task 12 命名后，Task 13-20 不再引用旧名；`setCraftSystemPrompt`/`createCraftResourceLoader` 在 Task 17 内部命名一致；`contextWindow` 字段名在 Task 19 两侧（子进程出站/主进程消费）一致。
