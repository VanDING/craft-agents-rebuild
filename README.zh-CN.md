<div align="center">

# Craft Agents

**一个 Agent 原生工作台 —— 让 AI Agent 连接一切服务、API 与文档。**

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)
[![English](https://img.shields.io/badge/Docs-English-blue.svg)](README.md)

</div>

---

## 关于 Fork 与致谢

> 本项目是 [`craft-ai-agents/craft-agents-oss`](https://github.com/craft-ai-agents/craft-agents-oss) 的一个 **fork** —— 上游由 [craft.do](https://craft.do) 团队打造。
>
> 我们衷心感谢上游维护者与所有贡献者，没有他们的工作就没有这个项目。本 fork 在上游的基础上追求一个明确的架构方向：**统一为单一 AI 后台**（详见[与上游的差异](#与上游的差异)）。

---

## 与上游的差异

<img width="2781" height="1480" alt="截屏2026-08-11 00 37 41" src="https://github.com/user-attachments/assets/3dd8facf-20f3-4039-8458-d222f44501de" />
<img width="2781" height="1480" alt="截屏2026-08-11 00 39 05" src="https://github.com/user-attachments/assets/9f0a746a-60be-426e-8cd6-57f4e258c9ef" />
<img width="2781" height="1480" alt="截屏2026-08-11 00 40 03" src="https://github.com/user-attachments/assets/ba2575a7-bebf-4d56-b39b-08dd323b6c59" />
<img width="2781" height="1480" alt="截屏2026-08-11 00 39 21" src="https://github.com/user-attachments/assets/dd948992-74f0-4251-9125-67133b3c9ff5" />





本 fork 的核心变更在架构层面：**上游维护两套 AI 后台（Claude Agent SDK + Pi SDK）；本 fork 完全移除 Claude SDK，全部运行在 Pi SDK 上** —— 一条代码路径、一套扩展系统、一个提供商目录。

| 维度 | 上游（`craft-agents-oss`） | 本 fork |
|------|---------------------------|---------|
| AI 后台 | Claude Agent SDK **+** Pi SDK（两条路径） | **仅 Pi SDK** —— 统一路径 |
| 后台生命周期 | 两套事件与会话实现 | 一套 Pi 生命周期，以 `agent_settled` 为终态 |
| 原生依赖 | 每平台 ~210 MB Claude 二进制 | 无 |
| Provider 路径 | 两套并行实现 | 一套 —— 30+ 提供商，严格超集 |
| 运行时工具同步 | 后台各自注册 | 增量 `sync_tools`，复用热会话 |

其他值得注意的变更：

- **移除**了 Claude SDK 后端、事件适配器、错误映射器与「扩展上下文 (1M)」开关；以通用 `ToolDefinition` 层和基于 `@modelcontextprotocol/sdk` 的 MCP 服务器替代
- **新增 14 个提供商预设**（NVIDIA、Together AI、Fireworks、Moonshot AI、Cloudflare Workers AI / AI Gateway、Ant Ling、ZAI、小米等）
- **修复 Windows 打包**（`build-win.ps1`）：PowerShell 5.1 SHA256、`@vscode/ripgrep` 二进制暂存、pi-agent-server 打包
- **新增工具链**：共享 `tsconfig.base.json`、postinstall 依赖去重脚本（TS 7 下的 prosemirror）、内联 GitHub Copilot OAuth
- **内容工作台** —— 面向所有 Agent 视图的通用多面板工作区（详见下文）
- 当前内核架构与维护基线见 [`docs/pi-kernel.md`](docs/pi-kernel.md)

### 内容工作台（Content Workbench）

工作台把 Agent 的所有视图 —— 会话、看板、日历、审查、文件树、上下文、预览、浏览器 —— 变成可以并排摆放的对等面板：

- **顶栏平铺按钮** —— 每个面板类型都有直接的顶栏按钮，带三态指示（前台 / 聚焦 / 后台）；新建会话、新建浏览器窗口、会话列表开关始终可用；窄窗口从尾部顺序隐藏按钮，而非收进折叠菜单
- **绑定内容面板** —— 审查与差异、文件树、上下文、预览通过 `PanelSlot` 并排渲染，各自绑定活跃会话；前台面板上限 **3 个**，并配有**按工作区持久化的后台面板集**（随时可还原）
- **可预测的顶替规则** —— 前台满员时，**最左侧非聚焦**面板移入后台（新窗口恒从右侧出现）；**主会话固定在 index 0**，永不被顶替或移动
- **一键全屏** —— 任意面板可展开为全屏浮层；展开期间顶栏自动隐藏（保证还原按钮可点击），Esc 或浮动还原按钮随时收回
- **均分宽度** —— 打开、关闭或还原面板时宽度重置为 1/N；拖拽自定义的比例在下次数量变化前保持不变
- **浮层收敛** —— 对话中的文件预览、Markdown/活动弹层、多文件差异视图统一进入绑定面板，不再漂浮为独立浮层
- **看板与日历面板** —— 看板/日历以面板形式打开，头部带关闭与全屏按钮，全屏时自动补偿 macOS 红绿灯区域
- **上下文面板升级** —— 一眼可见 token 用量、附件、最近打开文件与 source 连接状态
- **会话列表独立开关** —— 顶栏独立按钮显示/隐藏会话列表列，与左侧栏解耦
- **全面板键盘快捷键**（`⌘⇧R` 审查 / `⌘⇧E` 文件树 / `⌘⇧O` 上下文 / `⌘⇧P` 预览 / `⌘⇧T` 切换，以及面板间导航）

---

## 项目介绍

Craft Agents 是一个桌面工作台，目标是让我们能**高效地与 AI Agent 协作**。它提供：

- **直观的多任务处理** —— 多会话收件箱，每个对话都是持久化的、一等公民的对象
- **无负担地连接一切** —— 告诉 Agent「把 Linear 添加为 source」，它会自动找到公共 API 和 MCP 服务器、阅读文档、配置凭据并完成接入。REST API、本地文件系统、stdio MCP 服务器全部支持
- **以文档为中心的工作流** —— 会话、Markdown、Diff、附件都是原生体验，而不是在聊天框上硬套一个代码编辑器
- **流畅优美的界面** —— 基于 Electron + React 构建，设计上尽量不打扰你

Craft Agents 遵循 **Agent-native 软件设计原则**，开箱即高度可定制。项目以 Apache 2.0 协议开源，你可以自由地修改与再分发。

---

## 核心特性

- **单一统一 AI 后台** —— 所有 LLM 连接共用一个 Pi SDK 运行时，支持 **30+ 提供商**（Anthropic、OpenAI、Google、DeepSeek、xAI、GitHub Copilot、AWS Bedrock 等）
- **多会话收件箱** —— 桌面应用，支持会话管理、可自定义的状态工作流与标记
- **流式响应** —— 实时输出，带工具调用可视化
- **Sources 连接** —— 支持 MCP 服务器、REST API（Google、Slack、Microsoft…）与本地文件系统
- **自助式连接** —— Agent 可以按需自主发现、认证并配置新的数据源
- **权限模式** —— 三级体系（Explore / Ask to Edit / Auto），规则可自定义
- **Skills** —— 按工作区存放的专用 Agent 指令；可导入 Claude Code 的 skills 或自行创建
- **Automations** —— 事件驱动工作流：标签变化、定时任务、工具调用等均可触发新的 Agent 会话
- **后台任务** —— 长时间运行的操作带进度跟踪
- **动态状态系统** —— 工作区可自定义会话工作流状态（Todo → In Progress → Needs Review → Done）
- **主题系统** —— 应用级与工作区级级联主题
- **多文件 Diff** —— 类似 VS Code 的窗口，集中查看一轮对话产生的所有文件改动
- **文件附件** —— 拖拽图片、PDF、Office 文档，自动转换后发送
- **无头服务器 + CLI** —— 在 VPS 上远程运行会话，用终端或 Web UI 驱动

---

## 架构总览

```
┌──────────────────────────────────────────────────────────────────────┐
│            Electron 桌面端  ·  Web UI  ·  CLI                         │
├──────────────────────────────────────────────────────────────────────┤
│                        packages/server-core                          │
│             SessionManager · BaseAgent · sources · auth · config     │
├──────────────────────────────────────────────────────────────────────┤
│                    packages/pi-agent-server                          │
│              Pi SDK 子进程包装  (JSONL stdio)                        │
├──────────────────────────────────────────────────────────────────────┤
│                    @earendil-works/pi-coding-agent                   │
│            统一运行时，覆盖 30+ LLM 提供商                            │
└──────────────────────────────────────────────────────────────────────┘
```

整个应用运行在**单一 AI 后台**上 —— Pi SDK（`@earendil-works/pi-coding-agent`）。会话逻辑位于 `packages/server-core`；Pi SDK 运行在独立子进程（`packages/pi-agent-server`）中，使会话、凭据与工具执行保持崩溃隔离。

```
Packages（包）:
├── packages/shared            — Agent 逻辑、配置、认证、MCP、Sources、Automations
├── packages/server-core       — 会话管理器、WebSocket RPC 传输、处理器
├── packages/server            — 无头服务器入口
├── packages/pi-agent-server   — Pi SDK 子进程包装（JSONL stdio）
├── packages/core              — 核心类型与存储接口
├── packages/ui                — 共享 React 组件（shadcn/ui + Tailwind）
├── packages/session-tools-core — 共享工具定义
├── packages/messaging-gateway — Telegram + WhatsApp 适配器
└── packages/messaging-whatsapp-worker — WhatsApp 子进程

Apps（应用）:
├── apps/electron              — 桌面应用（Electron + React）
├── apps/webui                 — Web UI（Vite + React）
├── apps/viewer                — 会话查看器（Vite + React）
└── apps/cli                   — 终端客户端（craft-cli）
```

---

## 快速开始

### 前置要求

- [Bun](https://bun.sh/) 运行时
- 任意 LLM API Key（Anthropic、OpenAI、Google 或 30+ 支持提供商之一）

### 源码构建

```bash
git clone https://github.com/VanDING/craft-agents-rebuild
cd craft-agents-rebuild
bun install

# 运行桌面应用（自动构建并启动）
bun run electron:start
```

### 首次使用

1. **选择 AI 提供商** —— Anthropic API Key、Claude OAuth、OpenAI、Google AI Studio、GitHub Copilot，或 30+ 支持提供商中的任意一个
2. **创建工作区** —— 会话、Sources、Skills、主题都存放在这里（`~/.craft-agent/workspaces/<name>/`）
3. **连接 Sources**（可选）—— 直接告诉 Agent「把 GitHub 添加为 source」，粘贴 MCP 配置，或指向本地文件夹
4. **开始对话** —— 创建会话，让 Agent 替你干活

### 权限模式

| 模式 | 显示 | 行为 |
|------|------|------|
| `safe` | Explore | 只读，阻止所有写操作 |
| `ask` | Ask to Edit | 操作前请求批准（默认） |
| `allow-all` | Auto | 自动批准所有命令 |

在聊天界面按 **`SHIFT+TAB`** 可循环切换模式。

---

## 无头服务器与 CLI

在远程机器（如 Linux VPS）上以无头模式运行 Craft Agents，桌面端作为瘦客户端接入 —— 让长时间会话保持存活、随处可达：

```bash
CRAFT_SERVER_TOKEN=$(openssl rand -hex 32) bun run server:start
```

服务器启动时会打印连接信息；设置 `CRAFT_SERVER_URL` 与 `CRAFT_SERVER_TOKEN` 后，即可让桌面应用以瘦客户端模式连接。

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `CRAFT_SERVER_TOKEN` | 是 | — | 客户端认证 Bearer Token |
| `CRAFT_RPC_HOST` | 否 | `127.0.0.1` | 绑定地址（远程访问用 `0.0.0.0`） |
| `CRAFT_RPC_PORT` | 否 | `9100` | 绑定端口 |
| `CRAFT_RPC_TLS_CERT` | 否 | — | PEM 证书路径（启用 `wss://`） |
| `CRAFT_RPC_TLS_KEY` | 否 | — | PEM 私钥路径 |
| `CRAFT_RPC_TLS_CA` | 否 | — | PEM CA 链（可选，用于客户端证书校验） |

纯终端工作流可使用 [`craft-cli`](docs/cli.md) 客户端，通过 `ws://`/`wss://` 连接、流式输出，并支持脚本化：

```bash
bun run apps/cli/src/index.ts run "Summarize this repo"
```

---

## 开发与验证

```bash
bun run typecheck:all       # 类型检查所有包
bun run validate:dev        # 类型检查 + 单元测试
bun run validate:ci         # 完整 CI 验证（含 i18n 对齐/覆盖检查）

bun run electron:dev        # 桌面应用开发模式（HMR）
bun run server:dev          # 无头服务器开发模式
bun run electron:dist:win   # 打包安装包（另有 :mac / :linux）
```

### 故障排查

| 症状 | 解决办法 |
|------|----------|
| 开发时模块解析错误 | `bun run server:build:subprocess`（重新构建 pi-agent-server bundle） |
| 构建时报 "No matching export" | `bun install`（lockfile 与依赖不同步） |
| 打包后的应用卡在 "thinking…" | 检查解包后的应用内是否存在 `resources/pi-agent-server/index.js` 和 `resources/app/vendor/bun/bun.exe` |

---

## 文档与支持

- [craft-cli 参考文档](docs/cli.md) —— 终端客户端用法、脚本化模式、TLS
- [安全公告](SECURITY.md) —— 在此提交漏洞报告
- [行为准则](CODE_OF_CONDUCT.md)

---

## License

[Apache 2.0](LICENSE)。本项目派生自同样采用 Apache 2.0 协议的 [`craft-ai-agents/craft-agents-oss`](https://github.com/craft-ai-agents/craft-agents-oss)，署名信息见 [NOTICE](NOTICE)。
