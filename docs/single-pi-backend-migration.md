# 单 Pi SDK 后台迁移 — 完整实施计划

> **状态**: Draft  
> **创建日期**: 2026-07-27  
> **最后更新**: 2026-07-27  
> **关联 PR/Issue**: TBD

---

## 目录

1. [背景与动机](#背景与动机)
2. [当前架构总览](#当前架构总览)
3. [完整 Claude SDK 触达点审计](#完整-claude-sdk-触达点审计)
4. [Pi SDK 功能覆盖分析](#pi-sdk-功能覆盖分析)
5. [分阶段实施计划](#分阶段实施计划)
6. [风险矩阵](#风险矩阵)
7. [验证清单](#验证清单)
8. [附录：文件变更清单](#附录文件变更清单)

---

## 背景与动机

### 当前状态

项目维护两套完整的 AI 后端实现，共享同一 `AgentBackend` 接口，但走完全不同的 SDK 路径：

| 后端 | SDK | 代码量 | Provider 覆盖 |
|---|---|---|---|
| ClaudeAgent | `@anthropic-ai/claude-agent-sdk` v0.3.215 | ~3,200 行 + 配套 ~2,000 行 | Anthropic 直接 API |
| PiAgent | `@earendil-works/pi-coding-agent` v0.81.0 | ~2,700 行 + pi-agent-server ~1,800 行 | 30+ providers |

### 动机

1. **维护成本**：两套实现需要同步维护，SDK 升级需要协调两个包
2. **打包体积**：Claude SDK 每平台携带 ~210MB native binary
3. **构建复杂度**：3 个平台构建脚本中大量 Claude SDK 二进制 staging 逻辑
4. **功能统一**：Pi SDK 的 provider 覆盖是 Claude SDK 的严格超集
5. **扩展能力**：Pi SDK 内置完整 TypeScript 扩展系统，Claude SDK 无此项

### 收益预期

| 指标 | 当前 | 迁移后 | 改善 |
|---|---|---|---|
| AI SDK 依赖 | 2 个主包 + 7 平台二进制 | 1 个纯 JS 包 | -90% 包数 |
| 后端代码行 | ~7,000 | ~4,500 | -36% |
| 二进制体积 | ~210MB/平台 | 0 | 节省 210MB |
| Provider 实现路径 | 2 套 | 1 套 | 统一 |
| Extension | Claude 无 | Pi 完整扩展系统 | +新能力 |
| 构建脚本 | 多脚本处理二进制 | 无需 | 大幅简化 |

---

## 当前架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                      Electron / CLI / WebUI                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  packages/server-core/src/sessions/SessionManager.ts (9006行)     │
│       ↓ createBackendFromResolvedContext()                        │
│                                                                  │
├───────────────┬─────────────────────────────────────────────────┤
│  Claude Agent                 │          Pi Agent                │
│  (claude-agent.ts, 3181行)    │          (pi-agent.ts, 2692行)    │
│  ↓ in-process                 │          ↓ JSONL stdio           │
│  @anthropic-ai/               │    packages/pi-agent-server/     │
│  claude-agent-sdk             │    ↓ in-process                  │
│  (native binary ~210MB)       │    @earendil-works/              │
│                               │    pi-coding-agent (纯 JS)      │
├───────────────────────────────┴─────────────────────────────────┤
│  Shared (BaseAgent, Permissions, Sources, PreToolUse, MCP, etc.) │
└─────────────────────────────────────────────────────────────────┘
```

### 子 Agent (spawn_session) 架构

```
┌──────────────────────────────────────────────────────────────┐
│                    SessionManager                             │
│  onSpawnSession → createSession → sendMessage → return        │
│  ◄───────────────── BACKEND-AGNOSTIC ──────────────────►    │
└───────────────────────┬──────────────────────────────────────┘
                        │ agent.onSpawnSession = ...
┌───────────────────────┴──────────────────────────────────────┐
│                  BaseAgent.preExecuteSpawnSession              │
│  验证 prompt → 调用 onSpawnSession 回调                        │
│  ◄───────────────── BACKEND-AGNOSTIC ──────────────────►    │
└───────────────────────┬──────────────────────────────────────┘
        │                                    │
        ▼                                    ▼
┌───────────────────┐              ┌────────────────────────┐
│    ClaudeAgent     │              │       PiAgent          │
│ SdkMcpServer 包装  │              │ JSONL proxy 转发       │
└───────────────────┘              └────────────────────────┘
```

**关键结论**：子 Agent 核心逻辑 100% 在 SessionManager + BaseAgent 中，完全不依赖 Claude SDK。

---

## 完整 Claude SDK 触达点审计

以下审计基于 `@anthropic-ai/claude-agent-sdk` 的每个 `import` 逐一源码核实。

### Category A: 直接导入 SDK 函数（14 个源文件）

| # | 文件 | 导入 | 分类 |
|---|---|---|---|
| 1 | `agent/claude-agent.ts:1` | `query, createSdkMcpServer, tool, AbortError, type Query, type SDKMessage, type SDKUserMessage, type SDKAssistantMessageError, type Options` | **删除** |
| 2 | `agent/options.ts:1` | `type Options` | **删除** |
| 3 | `agent/llm-tool.ts:17` | `tool` | **替换为 `defineTool()`** |
| 4 | `agent/browser-tools.ts:13` | `tool` | **替换为 `defineTool()`** |
| 5 | `agent/session-scoped-tools.ts:18` | `createSdkMcpServer, tool` | **替换为 `McpServer` + `defineTool()`** |
| 6 | `agent/spawn-session-tool.ts:12` | `tool` | **替换为 `defineTool()`** |
| 7 | `agent/claude-llm-query.ts:8` | `type SDKMessage, SDKResultError, SDKResultSuccess` | **删除** |
| 8 | `agent/claude-sdk-error-mapper.ts:1` | `type SDKAssistantMessageError` | **删除** |
| 9 | `backend/claude/event-adapter.ts:15` | `type SDKMessage, SDKAssistantMessageError` | **删除** |
| 10 | `sources/api-tools.ts:8` | `createSdkMcpServer, tool` | **替换为 `McpServer` + `defineTool()`** |
| 11 | `sources/server-builder.ts:18` | `createSdkMcpServer` | **替换为 `McpServer`** |
| 12 | `config/llm-validation.ts:11` | `query` | **⚠️ 替换为 Pi SDK 等价** |
| 13 | `validation/url-validator.ts:8` | `query, type Options` | **⚠️ 替换为 Pi SDK 等价** |
| 14 | `__tests__/query-llm-partial-output.test.ts:15` | `type SDKMessage` | **删除** |

### Category B: 构建脚本引用（纯删除）

| # | 文件 | 内容 |
|---|---|---|
| 15 | `scripts/electron-build-main.ts:357-358` | `--external:@anthropic-ai/claude-agent-sdk` |
| 16 | `scripts/electron-dev.ts:304` | `MAIN_BUNDLE_EXTERNALS` 中包含 SDK |

### Category C: 打包/配置引用

| # | 文件 | 内容 |
|---|---|---|
| 17 | `apps/electron/electron-builder.yml` | 3 段 `extraResources` 专用于 SDK 核心 + 二进制 |
| 18 | `apps/electron/package.json` | `build:main` 脚本 `--external:` 声明 |
| 19 | `scripts/build/common.ts` | `copySDK()` 函数 |
| 20 | `scripts/build-server.ts` | SDK 平台二进制引用 |
| 21 | `root package.json` | `dependencies` 中 `@anthropic-ai/claude-agent-sdk: 0.3.215` |
| 22 | `packages/core/package.json` | `peerDependencies` 中 SDK |
| 23 | `packages/shared/package.json` | `peerDependencies` 中 SDK |

### Category D: 其他 Claude 相关代码（非 SDK 导入但需处理）

| # | 文件 | 说明 | 处理 |
|---|---|---|---|
| 24 | `agent/backend/internal/drivers/anthropic.ts` | Claude 驱动（无 SDK import，但只服务于 Claude） | **删除** |
| 25 | `agent/backend/internal/runtime-resolver.ts` | Claude 二进制路径解析 | **删除** |
| 26 | `agent/backend/claude/persistent-input.ts` | `resolveKeepBackgroundTasksAlive` 需保留 | **拆分** |
| 27 | `agent/claude-context.ts` | 名为 "Claude" 但实际**无 SDK 依赖**，被 Pi 共享使用 | **重命名** |
| 28 | `agent/conversation-summary.ts` | 纯工具函数，**无 SDK 依赖** | **不需改** |
| 29 | `agent/backend/types.ts` | `SdkMcpServerConfig` 类型是**项目自定义**，非 Claude SDK 类型 | **不需改** |
| 30 | `sessions/SessionManager.ts` | ClaudeTurnAnchor 逻辑、`sourceProvider === 'anthropic'` 分支 | **删除 ~80 行** |

### Category E: Claude OAuth（保留）

| # | 文件 | 说明 |
|---|---|---|
| 31 | `auth/claude-oauth.ts` | Claude OAuth PKCE 流程 — Pi SDK 也支持 `/login claude` |
| 32 | `auth/claude-oauth-config.ts` | OAuth 常量 |
| 33 | `auth/claude-token.ts` | Token 刷新 |
| 34 | `auth/state.ts` | `getValidClaudeOAuthToken()` — 在 SessionManager 中传给 `resolveAuthEnvVars` |

**决策**：保留。`resolveAuthEnvVars` 函数对 Pi 连接会走 `return { envVars, success: true }`（第 1010 行的 `isAnthropicProvider` 早返）。但 Claude OAuth 仍可用于 Pi 的 Claude Max/Pro provider 配置。

---

## Pi SDK 功能覆盖分析

### 官方文档确认（v0.81.0, docs at pi.dev/docs/latest）

| 功能 | Pi SDK 支持 | 证据 |
|---|---|---|
| Anthropic 直接 API | ✅ `pi_compat` + `anthropic-messages` | providers.md |
| Claude Pro/Max OAuth | ✅ `/login claude` | providers.md §Subscriptions |
| Fable 5/Mythos thinking | ✅ `xhigh`/`max` levels | CHANGELOG: v0.81.0 |
| Session 分支 / fork / clone | ✅ `/tree`, `/fork`, `/clone` | sessions.md |
| Compaction | ✅ `session.compact()` + 扩展 hooks | compaction.md |
| Extensions 系统 | ✅ `pi.registerTool()`, `pi.registerCommand()`, 事件 hooks, 自定义 UI | extensions.md |
| SDK 程序化嵌入 | ✅ `createAgentSession()`, `createAgentSessionRuntime()` | sdk.md |
| 自定义 Provider | ✅ `pi.registerProvider()` | custom-provider.md |
| 30+ 内置 Provider | ✅ 完整列表 | providers.md |

### 需要适配的功能

| 功能 | Claude SDK 方式 | Pi SDK 替换 | 复杂度 |
|---|---|---|---|
| `tool()` 工具定义 | Claude SDK `tool(name, desc, schema, handler)` | 纯 `ToolDefinition` 对象 + `defineTool()` 工厂 | **低** |
| `createSdkMcpServer` 进程内 MCP | Claude SDK wrapper | `@modelcontextprotocol/sdk` `McpServer`（已是项目 peer dep） | **低** |
| `query()` 裸 LLM 调用 | Claude SDK `query({ prompt, options })` | Pi `AgentSession.prompt()` 或直接 `ModelRuntime` | **中** |
| `resumeSessionAt` 分支截断 | Claude SDK 参数 | Pi `navigateTree(targetId)` / `fork(entryId)` | **无（Pi 已有自己的实现）** |
| 后台任务 keepAlive | `createPushableInputStream` | Pi `steer()` / `followUp()` 队列 | **无（Pi 已有自己的实现）** |

### 需要注意的边界

1. **`config/llm-validation.ts` 的 `validateAnthropicConnection()`**：当前用 Claude SDK `query()` 做 ping 测试。替换为 Pi SDK provider test（`piDriver.testAnthropicCompatible()` 已在 `drivers/pi.ts:188` 中存在）

2. **`validation/url-validator.ts` 的 `validateMcpUrl()`**：用 Claude SDK 做轻量 URL 验证。替换为 Pi `ModelRuntime` 的直接 HTTP 调用或一次性的 `AgentSession.prompt()`

3. **`resolveKeepBackgroundTasksAlive`**：纯工具函数，无 SDK 依赖。需要从 `backend/claude/persistent-input.ts` 移出到共享位置

---

## 分阶段实施计划

### Phase 1: 共享层解耦 (Package: shared)

> 目标：消除所有对 `@anthropic-ai/claude-agent-sdk` 的 import。

#### Task 1.1 — 新建通用 ToolDefinition 类型与工厂

**新建文件**：`packages/shared/src/agent/tool-definition.ts`

```typescript
/**
 * ToolDefinition — 通用工具定义类型
 * 兼容 Claude SDK SdkMcpToolDefinition 和 Pi SDK ToolDefinition
 */
import type { ZodRawShape } from 'zod/v4';

export interface ToolDefinition<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  inputSchema: Shape;
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }>;
  annotations?: { readOnlyHint?: boolean };
}

export function defineTool<Shape extends ZodRawShape>(
  name: string,
  description: string,
  inputSchema: Shape,
  handler: ToolDefinition<Shape>['handler'],
  extras?: { annotations?: { readOnlyHint?: boolean } },
): ToolDefinition<Shape> {
  return { name, description, inputSchema, handler, ...extras };
}
```

**修改的文件** (共 5 个，每个仅改 import)：

| 文件 | 行 | 改动 |
|---|---|---|
| `agent/llm-tool.ts` | 17 | `import { tool } from '@anthropic-ai/claude-agent-sdk'` → `import { defineTool } from './tool-definition.ts'` |
| `agent/browser-tools.ts` | 13 | 同上 |
| `agent/session-scoped-tools.ts` | 18 | 同上 |
| `agent/spawn-session-tool.ts` | 12 | 同上 |
| `sources/api-tools.ts` | 8 | 同上 |

**验证**：`cd packages/shared && bun test` — 所有未删除的测试通过。

#### Task 1.2 — 用 @modelcontextprotocol/sdk McpServer 替代 createSdkMcpServer

**新建文件**：`packages/shared/src/mcp/sdk-mcp-server-factory.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface SdkMcpServerOptions {
  name: string;
  version: string;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<{
      content: Array<{ type: 'text'; text: string }>;
      isError?: boolean;
    }>;
    annotations?: { readOnlyHint?: boolean };
  }>;
}

export function createInProcessMcpServer(options: SdkMcpServerOptions) {
  const server = new McpServer(
    { name: options.name, version: options.version },
    { capabilities: { tools: {} } },
  );

  for (const tool of options.tools) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema as any,
    }, tool.handler as any);
  }

  return {
    type: 'sdk' as const,
    instance: server,
  };
}
```

**修改的文件** (共 3 个)：

| 文件 | 行 | 改动 |
|---|---|---|
| `sources/api-tools.ts` | 8 | `createSdkMcpServer` → `createInProcessMcpServer` |
| `sources/server-builder.ts` | 18 | 同上 |
| `agent/session-scoped-tools.ts` | 18 | 同上 |

**注意**：`@modelcontextprotocol/sdk` 的 `McpServer` 类已是项目 peer dependency (`core/package.json: peerDependencies`)，无需新增依赖。

#### Task 1.3 — 替换 config/llm-validation.ts 和 validation/url-validator.ts

**`config/llm-validation.ts`**:

当前函数 `validateAnthropicConnection()` 使用 Claude SDK 的 `query()` 做 ping。Pi SDK 的 `piDriver` 中已有 `testAnthropicCompatible()` 方法（`drivers/pi.ts:188`），可以直接用于 Pi 连接测试。

对于非-Pi 的 Anthropic 直接 API 测试，可包装为：
```typescript
// 使用 Pi SDK 的 ModelRuntime 做一次性轻量调用
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

export async function validateConnection(
  config: LlmValidationConfig
): Promise<LlmValidationResult> {
  // 委托给 Pi driver 的 test 方法
  // 或直接用 pi-ai 的 createClient 做 HTTP 请求
}
```

**`validation/url-validator.ts`**:

当前使用 Claude SDK `query()` 调用 Haiku 做 URL 格式验证。替换为一次性的 Pi SDK session prompt：
```typescript
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
// 创建 ephemeral session → prompt → 解析 JSON → dispose
```

> 注：这两个文件的具体替换需要确认 Pi SDK 的 `ModelRuntime.createClient()` API 是否暴露轻量 LLM 调用。备选方案是复用 pi-agent-server 的 `queryLlm` 路径。

#### Task 1.4 — 批量删除 Claude 后端文件

一次性删除以下文件（无依赖冲突，可并行操作）:

```
packages/shared/src/agent/claude-agent.ts                    (3,181行)
packages/shared/src/agent/claude-llm-query.ts                 (~90行)
packages/shared/src/agent/claude-sdk-error-mapper.ts          (~350行)
packages/shared/src/agent/options.ts                         (~210行)
packages/shared/src/agent/backend/claude/event-adapter.ts     (~500行)
packages/shared/src/agent/backend/claude/index.ts
packages/shared/src/agent/backend/claude/task-notification.ts
packages/shared/src/agent/backend/internal/drivers/anthropic.ts
packages/shared/src/agent/backend/internal/runtime-resolver.ts
packages/shared/src/agent/__tests__/claude-agent-branching.test.ts
packages/shared/src/agent/__tests__/claude-agent-handoff.test.ts
packages/shared/src/agent/__tests__/claude-agent-spawn-cwd.test.ts
packages/shared/src/agent/__tests__/claude-background-message-routing.test.ts
packages/shared/src/agent/__tests__/claude-event-adapter.test.ts
packages/shared/src/agent/__tests__/claude-thinking-config.test.ts
packages/shared/src/agent/__tests__/query-llm-partial-output.test.ts
packages/shared/src/agent/__tests__/json-prop-to-zod.test.ts
packages/shared/src/agent/backend/__tests__/claude-sdk-error-mapper test (如独立)
packages/shared/src/agent/backend/claude/session-tool-parity.test.ts
```

同时删除 `agent/backend/claude/persistent-input.ts` 中 `createPushableInputStream` 部分，**保留** `resolveKeepBackgroundTasksAlive`（移到 `agent/core/keep-alive.ts`）。

同时删除 `agent/index.ts` 从 `backend/claude/persistent-input.ts` 的 re-export。

#### Task 1.5 — 修改工厂和类型系统

**`agent/backend/factory.ts`**:
```diff
- import { ClaudeAgent } from '../claude-agent.ts';
- import { anthropicDriver } from './internal/drivers/anthropic.ts';
  import { piDriver } from './internal/drivers/pi.ts';

  const DRIVER_REGISTRY: Record<AgentProvider, ProviderDriver> = {
-   anthropic: anthropicDriver,
    pi: piDriver,
  };

  export function createBackend(config: BackendConfig): AgentBackend {
    switch (config.provider) {
-     case 'anthropic':
-       return new ClaudeAgent(config);
      case 'pi':
        return new PiAgent(config);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  export function detectProvider(authType: string): AgentProvider {
    switch (authType) {
-     case 'api_key':
-     case 'oauth_token':
-       return 'anthropic';
      default:
-       return 'anthropic';
+       return 'pi';
    }
  }

  export function getAvailableProviders(): AgentProvider[] {
-   return ['anthropic', 'pi'];
+   return ['pi'];
  }
```

**`agent/backend/index.ts`**:
```diff
- export { ClaudeEventAdapter } from './claude/event-adapter.ts';
```

**`config/llm-connections.ts`**:
```diff
- export type LlmProviderType = 'anthropic' | 'pi' | 'pi_compat';
+ export type LlmProviderType = 'pi' | 'pi_compat';

- export function isAnthropicProvider(providerType: LlmProviderType): boolean {
-   return providerType === 'anthropic';
- }
```

**`config/models.ts`**:
```diff
- export type ModelProvider = 'anthropic' | 'pi';
+ export type ModelProvider = 'pi';
```

**`agent/index.ts`**:
```diff
- export * from './claude-agent.ts';
- export * from './options.ts';
   // 保留所有其他 export
```

#### Task 1.6 — 清理 SessionManager Claude 逻辑

**`server-core/src/sessions/SessionManager.ts`**:

删除以下代码段：
1. `ClaudeTurnAnchorRecord` 接口和所有相关函数 (~80 行，行 280-357)
2. `isClaudeMessageUuid()` 函数
3. `getValidClaudeOAuthToken` import 和相关调用（第 1904 行的 `resolveAuthEnvVars` 对 Pi 是 no-op，可以保留但不再需要 Claude 专用 token）
4. 分支创建中的 `sourceBackendContext.provider === 'anthropic'` 条件分支
5. 所有 `'anthropic'` 回退逻辑

#### Task 1.7 — 重命名 claude-context.ts

```bash
git mv packages/shared/src/agent/claude-context.ts \
        packages/shared/src/agent/session-context.ts
```

更新所有 import 引用（`session-scoped-tools.ts:21` 和 `pi-agent.ts` 中的使用）。

### Phase 2: 后端子进程简化 (Package: pi-agent-server)

> 目标：可选优化，减少包数量或简化工具注册路径。

#### Task 2.1（可选）— 合并 pi-agent-server 进 server-core

将 `pi-agent-server/src/index.ts` 转为 `server-core/src/pi/agent-server.ts`，减少一个独立包。

**投入/回报**：少一个 tsconfig/packgage.json，但增加 server-core 的体积。非必须。

#### Task 2.2（可选）— 工具注册路径简化

当前 proxy 工具走 JSONL 双向往返。可以将 `spawn_session` 的 handler 直接内联到 pi-agent-server，减少延迟。

**投入/回报**：减少一次 JSONL 往返延迟，但 proxy 方式已工作正常。

### Phase 3: 构建与打包精简

> 目标：移除所有 Claude SDK 相关的构建和打包依赖。

#### Task 3.1 — 移除 npm 依赖

```diff
# root package.json
  "dependencies": {
-   "@anthropic-ai/claude-agent-sdk": "0.3.215",
-   "@anthropic-ai/sdk": "0.112.3",
    ...
  }

# packages/core/package.json
  "peerDependencies": {
-   "@anthropic-ai/claude-agent-sdk": "0.3.215",
    "@modelcontextprotocol/sdk": ">=1.29.0"
  }

# packages/shared/package.json
  "peerDependencies": {
-   "@anthropic-ai/claude-agent-sdk": ">=0.3.197",
    "@modelcontextprotocol/sdk": ">=1.29.0",
    "zod": ">=4.0.0"
  }
```

运行 `bun install` 重新生成 `bun.lock`。

#### Task 3.2 — 简化构建脚本

| 文件 | 操作 |
|---|---|
| `scripts/build/common.ts` | `copySDK()` 删除全部 Claude 二进制复制逻辑 |
| `scripts/build/darwin.ts` | **删除**（整个文件只有 Claude 二进制验证） |
| `scripts/build/linux.ts` | **删除** |
| `scripts/build/win32.ts` | **删除** |
| `scripts/build-server.ts` | 删除 SDK 平台二进制处理 |
| `scripts/electron-dev.ts` | `MAIN_BUNDLE_EXTERNALS` 移除 Claude SDK |
| `scripts/electron-build-main.ts` | 移除 `--external:@anthropic-ai/claude-agent-sdk` |

#### Task 3.3 — 简化 electron-builder.yml

删除 3 段 `extraResources`：
```yaml
# 删除以下块：
- from: node_modules/@anthropic-ai/claude-agent-sdk
  to: app/node_modules/@anthropic-ai/claude-agent-sdk
- from: node_modules/@anthropic-ai/claude-agent-sdk-binary
  to: app/node_modules/@anthropic-ai/claude-agent-sdk-binary
```

#### Task 3.4 — 简化 apps/electron/package.json

```diff
  "scripts": {
-   "build:main": "... --external:@anthropic-ai/claude-agent-sdk ...",
+   "build:main": "...",
  }
```

#### Task 3.5 — 移除 ESLint 规则

```diff
# apps/electron/eslint.config.mjs 或 shared/eslint.config.mjs
- {
-   selector: "ImportDeclaration[source.value='@anthropic-ai/claude-agent-sdk']",
-   message: 'Provider SDK usage must stay in backend drivers...',
- },
```

#### Task 3.6 — 清理 Dockerfile.server

删除 `@anthropic-ai/claude-agent-sdk-*` 相关的 COPY 和依赖安装步骤。

### Phase 4: 验证

#### 4.1 编译验证

```bash
cd packages/shared && bun run typecheck     # 零错误
cd packages/server-core && bun run typecheck # 零错误
cd packages/pi-agent-server && bun run typecheck # 零错误
cd apps/electron && bun run typecheck       # 零错误
```

#### 4.2 单元测试

```bash
bun test                                    # 全量通过
```

预期删除约 10 个 Claude 测试文件。剩余测试应全部通过。特别关注：
- `factory.test.ts` — anthropic case 已移除
- `pi-agent.test.ts` / pi-agent-server 测试
- `SessionManager` 相关测试

#### 4.3 功能烟雾测试

| # | 测试项 | 验收标准 |
|---|---|---|
| 1 | Pi backend 启动 | Session 创建成功 |
| 2 | 发送 prompt | 正常 LLM 回复 |
| 3 | read/write/edit/bash 工具 | 正常执行 |
| 4 | spawn_session | 子 agent 正常创建和执行 |
| 5 | call_llm | LLM 查询正常返回 |
| 6 | browser_tool | 浏览器操作正常 |
| 7 | MCP/API source 工具 | 外部源工具正常 |
| 8 | thinking level 切换 | 不同 level 正常 |
| 9 | model 切换 | 模型选择器正常 |
| 10 | compaction | 对话压缩正常 |
| 11 | messaging (Telegram) | 消息收发正常 |

#### 4.4 打包验证

```bash
# Electron 完整构建
bun run build:electron
# 验证打包产物：
# 1. 不含 @anthropic-ai/claude-agent-sdk 目录
# 2. 不含 claude-agent-sdk-binary
# 3. 包体积减少约 210MB
```

---

## 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| llm-validation.ts / url-validator.ts Pi SDK 替代方案不完整 | 中 | 中 | Pi SDK 已有 `testAnthropicCompatible()`。url-validator 可用临时 session 替代 |
| `McpServer.registerTool()` 接口不完全兼容 `createSdkMcpServer` 的 `tools` | 低 | 中 | `createSdkMcpServer` 内部就是对 MCP SDK 的薄包装。接口非常接近 |
| SessionManager 分支逻辑删除后遗漏 Pi 路径 | 低 | 高 | Pi 分支路径已存在并工作。删除 Claude 路径是减法 |
| Electron 打包后 Pi 子进程启动失败 | 低 | 高 | pi-agent-server 已通过 bun build 打包并生产使用。此步不改子进程启动逻辑 |
| Fable 5 / Mythos thinking Pi 不完全支持 | 低 | 中 | Pi v0.81.0 CHANGELOG 明确提到支持 `xhigh`/`max` levels |
| 依赖其他包的 Claude Agent 导入 | 低 | 高 | 全部审计完成，只有 shared、scripts、apps 三个范围 |

---

## 验证清单

- [ ] Phase 1.1: ToolDefinition 类型 + 5 文件 import 替换，类型检查通过
- [ ] Phase 1.2: McpServer 工厂 + 3 文件替换，MCP 源工具正常
- [ ] Phase 1.3: llm-validation.ts + url-validator.ts Pi SDK 替换完成
- [ ] Phase 1.4: 所有 ~20 个 Claude 文件删除，编译通过
- [ ] Phase 1.5: factory/types/index 修改，所有 provider 类型只剩 'pi'
- [ ] Phase 1.6: SessionManager Claude 逻辑清理
- [ ] Phase 1.7: claude-context.ts 重命名为 session-context.ts
- [ ] Phase 3.1: npm 依赖移除，`bun install` 成功
- [ ] Phase 3.2-3.6: 构建脚本、electron-builder.yml、ESLint、Dockerfile 清理
- [ ] Phase 4.1: 全量 typecheck 通过
- [ ] Phase 4.2: `bun test` 通过
- [ ] Phase 4.3: 11 项功能烟雾测试全部通过
- [ ] Phase 4.4: Electron 打包产物不含 Claude SDK，体积减少 210MB

---

## 附录：文件变更清单

### 新建文件 (2)

```
packages/shared/src/agent/tool-definition.ts
packages/shared/src/mcp/sdk-mcp-server-factory.ts
```

### 删除文件 (19)

```
packages/shared/src/agent/claude-agent.ts
packages/shared/src/agent/claude-llm-query.ts
packages/shared/src/agent/claude-sdk-error-mapper.ts
packages/shared/src/agent/options.ts
packages/shared/src/agent/backend/claude/event-adapter.ts
packages/shared/src/agent/backend/claude/index.ts
packages/shared/src/agent/backend/claude/task-notification.ts
packages/shared/src/agent/backend/internal/drivers/anthropic.ts
packages/shared/src/agent/backend/internal/runtime-resolver.ts
packages/shared/src/agent/__tests__/claude-agent-branching.test.ts
packages/shared/src/agent/__tests__/claude-agent-handoff.test.ts
packages/shared/src/agent/__tests__/claude-agent-spawn-cwd.test.ts
packages/shared/src/agent/__tests__/claude-background-message-routing.test.ts
packages/shared/src/agent/__tests__/claude-event-adapter.test.ts
packages/shared/src/agent/__tests__/claude-thinking-config.test.ts
packages/shared/src/agent/__tests__/query-llm-partial-output.test.ts
packages/shared/src/agent/__tests__/json-prop-to-zod.test.ts
scripts/build/darwin.ts
scripts/build/linux.ts
scripts/build/win32.ts
```

### 修改文件 (27)

```
packages/shared/src/agent/llm-tool.ts                     — import 替换
packages/shared/src/agent/browser-tools.ts                — import 替换
packages/shared/src/agent/session-scoped-tools.ts          — import 替换 (2处)
packages/shared/src/agent/spawn-session-tool.ts            — import 替换
packages/shared/src/sources/api-tools.ts                   — import 替换 (2处)
packages/shared/src/sources/server-builder.ts              — import 替换
packages/shared/src/config/llm-validation.ts               — query() → Pi SDK 等价
packages/shared/src/validation/url-validator.ts            — query() → Pi SDK 等价
packages/shared/src/agent/backend/factory.ts               — 删除 anthropic case, 简化驱动
packages/shared/src/agent/backend/index.ts                 — 删除 ClaudeEventAdapter 导出
packages/shared/src/agent/index.ts                         — 删除 Claude re-export
packages/shared/src/config/llm-connections.ts              — 简化类型
packages/shared/src/config/models.ts                       — 简化 ModelProvider
packages/server-core/src/sessions/SessionManager.ts        — 删除 ClaudeTurnAnchor, 简化分支
packages/shared/src/agent/claude-context.ts               — 重命名为 session-context.ts
packages/shared/src/agent/backend/claude/persistent-input.ts — 拆分（保留 keepAlive 函数）
scripts/build/common.ts                                   — 清空 copySDK
scripts/electron-dev.ts                                   — 简化 externals
scripts/electron-build-main.ts                            — 简化 externals
scripts/build-server.ts                                   — 删除 SDK 二进制处理
apps/electron/electron-builder.yml                        — 删除 3 段 extraResources
apps/electron/package.json                                — 删除 external 声明
apps/electron/eslint.config.mjs                           — 移除 SDK import 规则
Dockerfile.server                                         — 删除 SDK 二进制处理
package.json (root)                                       — 删除 SDK 依赖
packages/core/package.json                                — 删除 peer dep
packages/shared/package.json                              — 删除 peer dep
```
