## 与上游版本差异 (vs craft-ai-agents/craft-agents-oss main)

### 架构变更

**单 Pi SDK 后台**：上游维护 Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) 和 Pi SDK (`@earendil-works/pi-coding-agent`) 两套 AI 后端。本仓库完全移除了 Claude SDK 依赖，统一使用 Pi SDK 作为唯一 AI 后台。

| 变更 | 说明 |
|---|---|
| 移除 `@anthropic-ai/claude-agent-sdk` | 根依赖 + core/shared peer dep 全部删除 |
| 移除 `@anthropic-ai/sdk` | 不再需要 |
| 移除 `claude-agent.ts`（~3,200 行） | 完整删除 Claude 后端实现 |
| 移除 `ClaudeEventAdapter`、`claude-sdk-error-mapper` 等 | ~2,000 行配套代码删除 |
| 移除 Claude SDK native binary（~210MB/平台） | electron-builder.yml + 构建脚本清理 |
| 移除"扩展上下文 (1M)"设置 | Claude beta header 功能，Pi SDK 不支持 |
| 新增 `tool-definition.ts` | 通用 ToolDefinition 类型，替代 Claude SDK `tool()` |
| 新增 `sdk-mcp-server-factory.ts` | 用 `@modelcontextprotocol/sdk` 替代 `createSdkMcpServer` |
| 新增 `keep-alive.ts` | 从 `backend/claude/` 提取的共享工具 |
| `claude-context.ts` → `session-context.ts` | 重命名（无 SDK 依赖，Pi 也在使用） |

**Provider 覆盖**：迁移后所有 LLM 连接统一走 Pi SDK，支持 30+ provider（Anthropic、OpenAI、Google、DeepSeek、xAI、GitHub Copilot、AWS Bedrock 等）。

**收益**：
- 代码量减少 ~7,000 行
- 打包体积减少 ~210MB/平台
- 构建脚本简化（移除 3 个 Claude 二进制 staging 脚本）
- Provider 实现路径从两套统一为一套

### 根 package.json 依赖升级

| 包 | 上游 | 本仓库 | 跳幅 |
|---|---|---|---|
| react | ^18.3.1 | ^19.2.7 | **v18→v19** |
| react-dom | ^18.3.1 | ^19.2.7 | **v18→v19** |
| @types/react | ^18.3.0 | 19.0.0 | **v18→v19** |
| @types/react-dom | ^18.3.0 | 19.0.0 | **v18→v19** |
| typescript | ^5.0.0 | 7 | **v5→v7** |
| vite | ^6.2.4 | ^8.1.5 | **v6→v8** |
| electron | ^39.2.7 | ^43.1.1 | **v39→v43** |
| esbuild | ^0.25.0 | 0.28.0 | **v0.25→v0.28** |
| shiki | ^3.19.0 | 4.0.0 | **v3→v4** |
| @shikijs/cli | ^3.19.0 | 4.0.0 | **v3→v4** |
| js-yaml | ^4.1.1 | 5.0.0 | **v4→v5** |
| katex | ^0.16.33 | 0.18.1 | **v0.16→v0.18** |
| linkify-it | ^5.0.0 | 6.0.0 | **v5→v6** |
| lucide-react | ^0.561.0 | 1.0.0 | **v0→v1** |
| marked | ^17.0.1 | 18.0.0 | **v17→v18** |
| react-resizable-panels | ^3.0.6 | 4.0.0 | **v3→v4** |
| @github/copilot-sdk | ^0.1.23 | 1.0.0 | **v0→v1** |
| ~~@anthropic-ai/claude-agent-sdk~~ | 0.3.197 | **已移除** | — |
| ~~@anthropic-ai/sdk~~ | ^0.100.0 | **已移除** | — |
| @earendil-works/pi-ai | 0.80.6 | 0.81.0 | minor |
| @earendil-works/pi-coding-agent | 0.80.6 | 0.81.0 | minor |
| @sentry/react | ^10.36.0 | 10.62.0 | minor |
| @sentry/electron | ^7.7.0 | ^7.15.0 | minor |
| @tiptap/* | ^3.20.0 | ^3.28.0 | minor |
| @dnd-kit/core | — | ^6.3.1 | **新增**，替换 @dnd-kit/dom beta |
| @dnd-kit/sortable | — | ^10.0.0 | **新增**，@dnd-kit/dom 拆分 |
| @dnd-kit/utilities | ^3.2.2 (electron) | ^3.2.2 | 子包已有，移到根 |
| @paper-design/shaders-react | ^0.0.69 (electron+ui) | 0.0.77 | 子包已有，升级+移到根 |
| motion | ^12.0.0 (viewer) | ^12.42.2 | 子包已有，升级+移到根 |
| sonner | ^2.0.7 (electron) | ^2.0.7 | 子包已有，移到根 |
| vaul | ^1.1.2 (electron) | ^1.1.2 | 子包已有，移到根 |
| cmdk | ^1.1.1 (electron) | ^1.1.1 | 子包已有，移到根 |
| jose | ^6.0.0 (server-core) | ^6.2.3 | 子包已有，升级+移到根 |
| ws | ^8.19.0 (server-core) | ^8.21.1 | 子包已有，升级+移到根 |
| react-colorful | ^5.7.0 (electron) | ^5.8.0 | 子包已有，升级+移到根 |
| react-day-picker | ^9.13.0 (electron) | ^10.0.1 | 子包已有，**v9→v10 大版本**+移到根 |
| react-i18next | ^17.0.2 (electron) | ^17.0.10 | 子包已有，升级+移到根 |
| react-pdf | ^10.3.0 (electron) | ^10.4.1 | 子包已有，升级+移到根 |
| react-simple-code-editor | ^0.14.1 (electron) | ^0.14.1 | 子包已有，移到根 |
| sharp (dependencies) | 0.34.5 (server-core+electron) | 0.35.3 | 子包已有，升级+移到根 deps（上游根只在 optionalDeps） |

| @radix-ui/* | ^1.1.x–^2.2.x | ^1.1.17–^2.3.4 | minor |
| @tailwindcss/typography | ^0.5.19 | ^0.5.20 | patch |
| @vscode/ripgrep | ^1.17.1 | ^1.18.0 | minor |
| autoprefixer | ^10.4.23 | ^10.5.4 | minor |
| concurrently | ^9.2.1 | ^9.2.4 | patch |
| electron-builder | ^26.0.12 | ^26.15.3 | minor |
| eslint | ^9.39.2 | ^9.39.5 | patch |
| eslint-plugin-react-hooks | ^7.0.1 | ^7.1.1 | minor |
| jotai | ^2.16.0 | ^2.20.2 | minor |
| prosemirror-highlight | ^0.15.0 | ^0.15.3 | patch |
| semver | ^7.7.3 | ^7.8.5 | minor |
| sharp (optionalDeps) | 0.34.5 | 0.35.3 | minor |
| tailwind-merge | ^3.4.0 | ^3.6.0 | minor |
| tar | ^7.5.2 | ^7.5.20 | patch |

#### 注意事项
上表"上游"列标注了子包来源的（如 `(electron)`、`(server-core)`），表示该包在上游的子包中存在，本仓库将其提升到根 `package.json`。
原因：`bunfig.toml` 设置了 `linker=hoisted`，Bun 将所有 workspace 依赖提升到根 `node_modules`，
显式在根声明可避免 hoisted linker 移除未在根声明的生产依赖。

| 包 | 版本 | 说明 |
|---|---|---|
| @dnd-kit/core | ^6.3.1 | **真正新增** — 替换 `@dnd-kit/dom` beta，拆分后独立包 |
| @dnd-kit/sortable | ^10.0.0 | **真正新增** — `@dnd-kit/dom` 拆分 |
| playwright | 1.61.1 | **真正新增** — 构建/测试工具依赖 |

### 子包依赖升级

#### apps/electron
| 包 | 上游 | 本仓库 |
|---|---|---|
| react | ^18.3.1 | ^19.2.7 |
| react-dom | ^18.3.1 | ^19.2.7 |
| react-day-picker | ^9.13.0 | 10.0.0 |
| react-pdf | ^10.3.0 | 10.4.1 |
| undici | ^7.22.0 | 8.0.0 |
| electron-updater | ^6.8.0 | ^6.8.9 |
| @paper-design/shaders-react | ^0.0.69 | 0.0.77 |

#### apps/webui
| 包 | 上游 | 本仓库 |
|---|---|---|
| react | ^18.3.1 | ^19.2.7 |
| react-dom | ^18.3.1 | ^19.2.7 |

#### apps/viewer
| 包 | 上游 | 本仓库 |
|---|---|---|
| react | ^18.3.1 | ^19.2.7 |
| react-dom | ^18.3.1 | ^19.2.7 |
| @vitejs/plugin-react | ^4.4.1 | ^5.2.0 |
| vite | ^6.2.5 | ^8.1.5 |
| typescript | ^5.7.3 | 7 |
| tailwindcss | ^4.0.0 | ^4.3.3 |
| shiki | ^3.0.0 | 4.0.0 |
| @tailwindcss/typography | ^0.5.16 | ^0.5.20 |
| lucide-react | ^0.501.0 | 1.0.0 |
| motion | ^12.0.0 | ^12.42.2 |
| react-markdown | ^9.0.3 | 10.1.0 |
| tailwind-merge | ^2.6.0 | 3.4.0 |

#### apps/cli
| 包 | 上游 | 本仓库 |
|---|---|---|
| typescript | ^5.8.2 | 7 |
| @types/node | ^22.0.0 | 25.0.0 |

#### packages/shared
| 包 | 上游 | 本仓库 |
|---|---|---|
| @earendil-works/pi-agent-core | 0.80.6 | 0.81.0 |
| @earendil-works/pi-ai | 0.80.6 | 0.81.0 |
| @earendil-works/pi-coding-agent | 0.80.6 | 0.81.0 |
| ~~@anthropic-ai/claude-agent-sdk (peer)~~ | 0.3.197 | **已移除** |

#### packages/ui
| 包 | 上游 | 本仓库 |
|---|---|---|
| react (peer) | >=18.0.0 | >=19.0.0 |
| react-dom (peer) | >=18.0.0 | >=19.0.0 |
| @paper-design/shaders-react | ^0.0.69 | 0.0.77 |

#### packages/server / server-core / pi-agent-server / session-mcp-server / messaging-*
| 包 | 上游 | 本仓库 |
|---|---|---|
| @types/node | ^22.0.0 | 25.0.0 |
| typescript | ^5.x | 7 |

### 构建脚本修复 (build-win.ps1)
| 问题 | 修复 |
|---|---|
| `Get-FileHash` 在 PowerShell 5.1 不可用 (×2) | 改用 .NET SHA256 API |
| `@vscode/ripgrep` 二进制路径错误 | 从 `ripgrep-win32-x64/bin/` 解析 + 同时复制 wrapper 和 binary |
| pi-agent-server 从未构建/打包 | 添加 `bun build` 步骤 + npm pack OAuth patch |

### Pi SDK 升级 (0.80.7 → 0.81.0)
- `pi-ai@0.80.8+` 移除了 `dist/utils/oauth/` 运行时模块（`refreshGitHubCopilotToken`、`loginGitHubCopilot`），`./oauth` 子路径变为仅类型导出
- **本仓库**：将 Copilot OAuth 函数内联为 `packages/shared/src/auth/github-copilot.ts`，不再依赖 pi-ai/oauth
- `pi-ai@0.80.8+` 用 `ModelRuntime` 替代了 `AuthStorage` + `ModelRegistry.inMemory()` API
- **本仓库**：`pi-agent-server` 迁移至 `ModelRuntime.create()` + `InMemoryCredentialStore`
- `CreateAgentSessionOptions.authStorage`/`modelRegistry` 变更为 `modelRuntime`
- `build-win.ps1` 中旧的 OAuth patch（npm pack pi-ai@0.80.7）不再需要

### Extension 与 Provider 注册
- pi v0.81.0 的 `ModelRuntime.registerProvider()` / `ModelRegistry.registerProvider()` 支持注册自定义 provider（含认证、模型发现、流式适配）
- 当前 `pi-agent-server` 已通过 `registerProvider('custom-endpoint', {...})` 使用此能力
- 后续可打包更多扩展 provider（如企业级 OAuth、自定义 API gateway）到 `packages/pi-agent-server/src/tools/` 或独立 extension 目录

#### 前端供应商列表
- `ApiKeyInput.tsx` 曾新增 14 个供应商：nvidia, together, fireworks, moonshotai, moonshotai-cn, cloudflare-workers-ai, cloudflare-ai-gateway, ant-ling, zai-coding-cn, xiaomi
- 使用 Custom 预设 + 手动输入 URL 可达到相同效果，走通用 openai-compat 路径
- 保留：nvidia, together, fireworks, moonshotai, moonshotai-cn, cloudflare-workers-ai, cloudflare-ai-gateway, ant-ling, zai-coding-cn, xiaomi
- 修复 `minimax-global` → `minimax` 键名对齐 Pi SDK

### TypeScript 预存错误修复
| 包 | 错误 | 修复 |
|---|---|---|
| apps/webui | 61 个 `bun:test` + prosemirror 类型冲突 | `types: ["bun"]` + prosemirror 路径映射 |
| apps/viewer | 3 个 prosemirror `Node`/`DecorationSet` 冲突 | prosemirror 路径映射 |
| apps/electron | `captureConsoleIntegration` 类型不兼容 | @ts-expect-error |

### 独有文件（上游没有）

| 文件 | 用途 | 说明 |
|---|---|---|
| `tsconfig.base.json` | 子包共享 TypeScript 基线配置 | 上游 3 个子包 (`pi-agent-server`, `session-mcp-server`, `session-tools-core`) 的 `tsconfig.json` 已写了 `"extends": "../../tsconfig.base.json"`，但上游根从未创建此文件——extends 链断裂，静默失效。本仓库首次创建，让子包获得正确的 NodeNext 基础配置 |
| `scripts/dedupe.ps1` | postinstall 去重脚本 | Bun hoisted linker 为 `prosemirror-*` 包创建嵌套版本副本，在 TS 7 下引发类型冲突。扫描 `node_modules/**/node_modules/` 删除嵌套副本，只保留根版本。挂接在 `postinstall` 和 `typecheck:all` 两个钩子上 |
| `scripts/dedupe-prosemirror.cjs` | Node.js 版去重（未使用） | 功能类似但更激进：用根版本递归复制覆盖嵌套 `prosemirror-model`。**未接入任何脚本**，是历史遗留，被 `dedupe.ps1` 取代 |
| `scripts/fix-lockfile.cjs` | 一次性 lockfile 修补 | `bun install` 有时锁定旧版 `prosemirror-model@1.25.4` 即使要求 `^1.25.11`。文本替换 `bun.lock` 强制修正。**未接入任何脚本**，一次性迁移工具，不可重入 |
| `packages/ui/src/css.d.ts` | CSS Module 类型声明 | 让子包 `tsc --noEmit` 能识别 `import styles from '*.css'`。上游通过 Vite client types 获取此声明，但 typecheck 路径不经过 Vite |
| `docs/single-pi-backend-migration.md` | 单 Pi SDK 迁移计划 | 完整的架构审计 + 实施计划 + 文件变更清单 |

### 文档
- `resources/AGENTS.md`: 新增 `pi-agent-server/` 条目
- `README.md`: 本差异记录

---
<div align="center">
  <a href="https://trendshift.io/repositories/20714" target="_blank"><img src="https://trendshift.io/api/badge/repositories/20714" alt="craft-ai-agents%2Fcraft-agents-oss | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</div>

# Craft Agents

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

## How it Works (Video)
To understand what Craft Agents does and how it works watch this video.

[![Demo Video](https://img.youtube.com/vi/xQouiAIilvU/hqdefault.jpg)](https://www.youtube.com/watch?v=xQouiAIilvU)

[Click Here (or on the image above) to watch the video on YouTube →](https://www.youtube.com/watch?v=xQouiAIilvU)


## Why Craft Agents was built
Craft Agents is a tool we built so that we (at craft.do) can work effectively with agents. It enables intuitive multitasking, no-fluff connection to any API or Service, sharing sessions, and a more document (vs code) centric workflow - in a beautiful and fluid UI.

**本仓库已迁移至单 Pi SDK 后台。** 上游同时使用 Claude Agent SDK 和 Pi SDK，本仓库完全移除 Claude SDK，统一使用 Pi SDK 作为唯一 AI 后台。Pi SDK 支持 30+ provider（Anthropic、OpenAI、Google、DeepSeek、xAI、GitHub Copilot、AWS Bedrock 等），并通过 TypeScript 扩展系统提供强大的定制能力。

It's built with Agent Native software principles in mind, and is highly customisable out of the box.

Craft Agents is open source under the Apache 2.0 license - so you are free to remix, change anything.

<img width="1578" height="894" alt="image" src="https://github.com/user-attachments/assets/3f1f2fe8-7cf6-4487-99ff-76f6c8c0a3fb" />

## Things that are hard to believe "just work"

**How do I connect to Linear, Gmail, Slack...?**
Tell the agent "add Linear as a source." It finds public APIs and MCP servers, reads their docs, sets up credentials, and configures everything.

[Check out how I just connected to Slack →](https://agents.craft.do/s/DRNQEiy8w2e1v5LPgKl8b)

**I already have my MCP config JSON.**
Paste it. The agent handles the rest.

**What about local MCPs?**
Fully supported. Stdio-based MCP servers run as local subprocesses on your machine.

**Can it handle custom APIs?**
Yes. Paste an OpenAPI spec, some endpoint URLs, screenshots of docs, whatever you have.

**APIs too? Not just MCPs?**
Craft Agents connects to anything.

**How do I import my Claude Code skills and MCPs?**
Tell the agent you want to import your skills from Claude Code. It handles the migration.

[Here I imported all my skills in one go →](https://agents.craft.do/s/gWCFqwhObFWaNJIEJmd6j)

**How do I create a new skill?**
Describe what the skill should do, give it context. The agent takes care of the rest.

**Do I need to restart after changes?**
No. Everything is instant. Mention new skills or sources with `@`, even mid-conversation.


## Installation

### One-Line Install (Recommended)

**macOS / Linux:**
```bash
curl -fsSL https://agents.craft.do/install-app.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://agents.craft.do/install-app.ps1 | iex
```

### Build from Source

```bash
git clone https://github.com/lukilabs/craft-agents-oss.git
cd craft-agents-oss
bun install
bun run electron:start
```

## Features

- **Multi-Session Inbox**: Desktop app with session management, status workflow, and flagging
- **Streaming Responses**: Tool visualization, real-time updates
- **Multiple LLM Connections**: Add multiple AI providers and set per-workspace defaults
- **30+ Provider Support**: Anthropic, OpenAI, Google, DeepSeek, xAI, GitHub Copilot, AWS Bedrock, and more — all via Pi SDK unified API
- **Craft MCP Integration**: Access to 32+ Craft document tools (blocks, collections, search, tasks)
- **Sources**: Connect to MCP servers, REST APIs (Google, Slack, Microsoft), and local filesystems
- **Permission Modes**: Three-level system (Explore, Ask to Edit, Auto) with customizable rules
- **Background Tasks**: Run long-running operations with progress tracking
- **Dynamic Status System**: Customizable session workflow states (Todo, In Progress, Done, etc.)
- **Theme System**: Cascading themes at app and workspace levels
- **Multi-File Diff**: VS Code-style window for viewing all file changes in a turn
- **Skills**: Specialized agent instructions stored per-workspace
- **File Attachments**: Drag-drop images, PDFs, Office documents with auto-conversion
- **Automations**: Event-driven automation — create agent sessions on label changes, schedules, tool use, and more

## Quick Start

1. **Launch the app** after installation
2. **Choose AI Provider**: Anthropic API key, Claude Max/Pro OAuth, OpenAI, Google AI Studio, GitHub Copilot, or any of the 30+ supported providers
3. **Create a workspace**: Set up a workspace to organize your sessions
4. **Connect sources** (optional): Add MCP servers, REST APIs, or local filesystems
5. **Start chatting**: Create sessions and interact with the AI

## Desktop App Features

### Session Management

- **Inbox/Archive**: Sessions organized by workflow status
- **Flagging**: Mark important sessions for quick access
- **Status Workflow**: Todo → In Progress → Needs Review → Done
- **Session Naming**: AI-generated titles or manual naming
- **Session Persistence**: Full conversation history saved to disk

### Sources

Connect external data sources to your workspace:

| Type | Examples |
|------|----------|
| **MCP Servers** | Craft, Linear, GitHub, Notion, custom servers |
| **REST APIs** | Google (Gmail, Calendar, Drive, YouTube, Search Console), Slack, Microsoft |
| **Local Files** | Filesystem, Obsidian vaults, Git repos |

### Permission Modes

| Mode | Display | Behavior |
|------|---------|----------|
| `safe` | Explore | Read-only, blocks all write operations |
| `ask` | Ask to Edit | Prompts for approval (default) |
| `allow-all` | Auto | Auto-approves all commands |

Use **SHIFT+TAB** to cycle through modes in the chat interface.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New chat |
| `Cmd+1/2/3` | Focus sidebar/list/chat |
| `Cmd+/` | Keyboard shortcuts dialog |
| `SHIFT+TAB` | Cycle permission modes |
| `Enter` | Send message |
| `Shift+Enter` | New line |

## Remote Server (Headless)

Craft Agents can run as a headless server on a remote machine (e.g., a Linux VPS), with the desktop app connecting as a thin client. This lets you keep long-running sessions alive, access them from multiple machines, and run compute-heavy tasks on a powerful server.

### Quick Start

From the monorepo root:

```bash
# Generate a token and start the server
CRAFT_SERVER_TOKEN=$(openssl rand -hex 32) bun run packages/server/src/index.ts
```

The server prints the connection details on startup:

```
CRAFT_SERVER_URL=ws://203.0.113.5:9100
CRAFT_SERVER_TOKEN=<generated-token>
```

Copy these values and use them to connect the desktop app.

### Connecting the Desktop App

Launch the Electron app in thin-client mode by passing the server URL and token:

```bash
CRAFT_SERVER_URL=wss://203.0.113.5:9100 CRAFT_SERVER_TOKEN=<token> bun run electron:start
```

In thin-client mode, the desktop app renders the UI but all session logic, tool execution, and LLM calls run on the remote server.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CRAFT_SERVER_TOKEN` | Yes | — | Bearer token for client authentication |
| `CRAFT_RPC_HOST` | No | `127.0.0.1` | Bind address (`0.0.0.0` for remote access) |
| `CRAFT_RPC_PORT` | No | `9100` | Bind port |
| `CRAFT_RPC_TLS_CERT` | No | — | Path to PEM certificate file (enables `wss://`) |
| `CRAFT_RPC_TLS_KEY` | No | — | Path to PEM private key file (required with cert) |
| `CRAFT_RPC_TLS_CA` | No | — | Path to PEM CA chain file (optional, for client cert verification) |
| `CRAFT_DEBUG` | No | `false` | Enable debug logging |

### TLS (Recommended for Remote Access)

When exposing the server over the network, TLS encrypts the WebSocket connection (`wss://` instead of `ws://`).

**Generate a self-signed certificate (development/testing):**

```bash
./scripts/generate-dev-cert.sh
# Creates certs/cert.pem and certs/key.pem (valid 365 days)
```

**Start the server with TLS:**

```bash
CRAFT_SERVER_TOKEN=<token> \
CRAFT_RPC_HOST=0.0.0.0 \
CRAFT_RPC_TLS_CERT=certs/cert.pem \
CRAFT_RPC_TLS_KEY=certs/key.pem \
bun run packages/server/src/index.ts
```

The server will print `CRAFT_SERVER_URL=wss://<your-public-ip>:9100`.

## Under the Hood

Craft Agents uses the **Pi SDK** (`@earendil-works/pi-coding-agent`) as its AI backend. Pi SDK provides a unified API across 30+ LLM providers, a TypeScript extension system, session tree branching, and compaction. The desktop app is built with Electron + React + Tailwind CSS v4, backed by a Bun runtime.

```
Packages:
├── packages/shared       — Agent logic, config, auth, MCP, sources, automations
├── packages/server-core  — Session manager, transport (WS RPC), handlers
├── packages/server       — Headless server entry
├── packages/pi-agent-server — Pi SDK subprocess wrapper (JSONL stdio)
├── packages/core         — Core types and storage interfaces
├── packages/ui           — Shared React components (shadcn/ui + Tailwind)
├── packages/session-mcp-server    — Session-scoped MCP tools
├── packages/session-tools-core    — Shared tool definitions
├── packages/messaging-gateway     — Telegram + WhatsApp adapter
└── packages/messaging-whatsapp-worker — WhatsApp subprocess

Apps:
├── apps/electron         — Desktop app (Electron + React)
├── apps/webui            — Web UI (Vite + React)
├── apps/viewer           — Session viewer (Vite + React)
└── apps/cli              — CLI tool entry
```

## Configuration

### Workspaces

Craft Agents organizes sessions by workspace. Each workspace has its own:

- Settings (`.craft-agent/workspaces/<name>/`)
- Sources (MCP servers, APIs)
- Skills (specialized agent instructions)
- Themes (visual customization)
- Session directories

Workspaces are stored in `~/.craft-agent/workspaces/`.

## Troubleshooting

### Dev Build

If `bun run electron:start` fails with module resolution errors, make sure `packages/pi-agent-server` and `packages/session-mcp-server` have their subprocess bundles built:

```bash
bun run server:build:subprocess
```

### Session stuck at "thinking..."

If conversations hang without response after packaging, verify these files exist in the unpacked app:

- `resources/pi-agent-server/index.js` — Pi SDK subprocess bundle
- `resources/session-mcp-server/index.js` — Session MCP server bundle
- `resources/app/vendor/bun/bun.exe` — Bundled Bun runtime (needed to execute pi-agent-server)

### Common Issues

1. **"No matching export" errors during build**: Run `bun install` to ensure lockfile is in sync
2. **Renderer blank after install**: The Vite renderer needs to be built — the installer should handle this, but `bun run electron:build:renderer` can rebuild it
3. **WhatsApp worker build fails**: Pre-existing `sharp` native module issue; not required for core functionality

## Security

To report security vulnerabilities, please see [SECURITY.md](SECURITY.md).
