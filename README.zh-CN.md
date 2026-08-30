<div align="center">

# Craft Agents (RE)

### 本地优先、执行持久、运行过程可审计的 Agent 工作空间。

让 AI Agent 在文件、工具、服务和文档之间完成真正的工作，并让每个关键动作都可以检查、理解和确认。

[![版本](https://img.shields.io/badge/版本-0.12.1-6d5bd0?style=flat-square)](apps/electron/resources/release-notes/0.12.1.md)
[![Pi SDK](https://img.shields.io/badge/Pi%20SDK-0.84.4-5b7cfa?style=flat-square)](docs/pi-kernel.md)
[![Bun](https://img.shields.io/badge/Bun-1.4.0-f9f1e1?style=flat-square&logo=bun&logoColor=000)](https://bun.sh/)
[![License](https://img.shields.io/badge/license-Apache--2.0-2f80ed?style=flat-square)](LICENSE)
[![English](https://img.shields.io/badge/README-English-2f855a?style=flat-square)](README.md)

</div>

![Craft Agents 运行上下文审计](docs/assets/readme/run-context.png)

Craft Agents (RE) 是一个面向严肃 Agent 工作的开源桌面与服务端工作空间。它把持久会话、多面板工作台、工具连接、自动化、文件 Artifact 和统一的 Pi Agent Runtime 组合在同一个产品里。

它最重要的差异是可信度：一次运行不只是一段逐字出现的回答。Craft 会记录执行边界、工具结果、上下文增长、Token、成本和恢复状态，让你知道发生了什么，也能决定接下来应该发生什么。

## 工作过程始终可检查

Agent 的工作不应该消失在一个加载动画后面。Run 工作区为每个会话提供四个互相补充的视图：

- **概览（Overview）**：汇总总耗时、首 Token 延迟、Token、成本、工具结果、上下文增长和需要关注的问题。
- **轨迹（Trajectory）**：把轮次、模型响应、工具调用、失败、压缩和时间关系还原成可检查的执行账本。
- **上下文（Context）**：展示每次模型请求如何组装，包括系统提示、对话历史和工具结果分别占用了多少上下文。
- **关系图（Map）**：呈现相关会话与分支，同时保留各自的运行证据。

在界面之下，每个工作空间都有本地 SQLite/WAL 运行时，以明确的 T1/T2 边界记录模型和工具副作用。无法确定的副作用会停留在 `unknown`，不会被静默重试，也不会被伪装成已经完成。

![包含耗时、用量、失败和上下文增长的 Run 概览](docs/assets/readme/run-overview.png)

## 它是工作空间，不是聊天窗口

桌面应用围绕持久工作组织，而不是围绕一次性对话组织。

| 能力 | 带来的体验 |
| --- | --- |
| **持久多会话工作空间** | 会话、项目、标签、状态、日历、看板和后台工作跨重启保留。 |
| **Content Workbench** | 对话、Review、文件、预览、Artifact、上下文、Run 和浏览器可以并排打开。 |
| **Sources 与 Skills** | 连接 MCP、REST API、本地目录和可复用的 `SKILL.md`，无需把每个服务硬编码进内核。 |
| **权限与恢复** | Explore、Ask to Edit、Auto 与持久执行证据、显式恢复决策共同控制副作用。 |
| **自动化与消息入口** | 定时执行、事件触发，并通过支持的消息网关触达 Agent。 |
| **Headless 与 CLI** | 长任务可以运行在远程服务端，桌面端、Web UI 和 `craft-cli` 都可以作为客户端。 |

## 文件会成为可审阅的 Artifact

Craft 把生成或修改的文件看作有生命周期的交付物，而不是不透明的附件。Artifact revision 带有校验结果和来源信息；支持的格式可以安全预览，并在你接受或丢弃之前保持待审阅状态。

统一格式注册表覆盖文本与源码、Markdown、结构化数据、图片、PDF、Office 与 OpenDocument、媒体、压缩包和未知二进制文件。现有文档工具仍负责真实编辑与转换，Artifact 只提供一条一致、可靠的审阅边界。

原生生图也遵循同一流程：一次工具调用生成一个经过验证的图片 Artifact，并记录 provider、model、connection、prompt、参数和 revision 来源。

## 真正属于个人的工作空间

Profile 与外观都是本地产品能力，不依赖账户体系。Profile 根据本地会话形成活动概览，但不读取消息内容；用户明确填写的偏好与系统观察到的使用统计相互独立。语义主题引擎则控制颜色、表面、深度、边框、排版、图标线宽和密度，并支持应用默认值与工作空间覆盖。

<table>
  <tr>
    <td width="50%"><img src="docs/assets/readme/local-profile.png" alt="包含私密活动概览与偏好的本地 Profile" /></td>
    <td width="50%"><img src="docs/assets/readme/theme-engine.png" alt="支持工作空间覆盖的语义主题引擎" /></td>
  </tr>
  <tr>
    <td><strong>本地 Profile</strong><br />私密活动概览、身份、地区相关偏好与明确的个性化设置。</td>
    <td><strong>语义主题</strong><br />由用户拥有的完整视觉系统，而不只是更换强调色。</td>
  </tr>
</table>

## 一个运行时，连接不同模型

所有 provider 共用同一个 Pi Agent 后台、事件协议、工具注册表、权限系统和会话生命周期。Pi Runtime 运行在隔离子进程中，provider 或 agent 故障不会演变成桌面端的第二套执行路径。

```text
Electron Desktop  ·  Web UI  ·  craft-cli
                    │
          server-core / Runtime Host
      sessions · permissions · sources · artifacts
                    │
              JSONL 子进程边界
                    │
          Pi SDK · provider APIs · tools
```

连接层支持主流托管 provider、OAuth 产品、云平台，以及兼容 OpenAI/Anthropic 协议的自定义端点。模型与思考等级来自 provider 能力，而不是另一套 fork 专用后台。

### 当前技术基线

| 层级 | 基线 |
| --- | --- |
| Agent 内核 | Pi SDK `0.84.4` |
| 桌面端 | Electron `43.1`、React `19.2` |
| 运行时与工具链 | Bun `1.4.0`、TypeScript `7`、Vite `8.1` |
| 集成协议 | MCP SDK `1.29+`、原生 REST/本地文件/浏览器工具 |
| 存储 | 本地会话数据 + 工作空间级 SQLite/WAL Durable Runtime |

## 快速开始

### 环境要求

- [Bun 1.4](https://bun.sh/) 或 `package.json` 固定的兼容版本
- 至少一个受支持模型 provider 的凭据
- macOS、Windows 或 Linux

```bash
git clone https://github.com/VanDING/craft-agents-rebuild.git
cd craft-agents-rebuild
bun install
bun run electron:start
```

首次启动后，添加 AI 连接、创建工作空间，并按需连接 Source 或本地目录。在会话中按 **Shift+Tab** 可以循环切换 Explore、Ask to Edit 和 Auto 权限模式。

### Headless Server 与 CLI

```bash
CRAFT_SERVER_TOKEN=$(openssl rand -hex 32) bun run server:start
bun run apps/cli/src/index.ts run "Summarize this repository"
```

远程连接、TLS、脚本调用和验证方式见 [CLI 参考文档](docs/cli.md)。

## 开发

```bash
bun run electron:dev       # 桌面端开发，Renderer HMR
bun run typecheck:all      # 检查所有 workspace package
bun run validate:dev       # 类型检查与运行时/文档聚焦测试
bun run validate:ci        # CI 验证与 i18n 一致性、覆盖检查
```

建议从[文档索引](docs/README.md)、[贡献指南](CONTRIBUTING.md)和 [Pi 内核维护基线](docs/pi-kernel.md)开始。

## 感谢 Craft 的开源基础

Craft Agents (RE) 是 [`craft-ai-agents/craft-agents-oss`](https://github.com/craft-ai-agents/craft-agents-oss) 的独立 fork。原项目由 [Craft](https://www.craft.do/) 团队和社区贡献者创建；没有他们的开源工作，就不会有这个项目，我们对此深表感谢。

本 fork 保留原始署名，同时发展自己的 Runtime、审计、工作空间、Artifact、Profile 与主题方向。本项目未获得 Craft Docs Limited 的认可，也与其不存在从属关系。署名和名称使用说明见 [NOTICE](NOTICE) 与 [TRADEMARK.md](TRADEMARK.md)。

## License

采用 [Apache License 2.0](LICENSE) 开源。
