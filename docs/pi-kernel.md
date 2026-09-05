# Pi 内核架构与维护基线

本文描述当前实现，不记录迁移过程。历史发布行为以 `apps/electron/resources/release-notes/` 为准。

## 当前基线

- 内核：`@earendil-works/pi-ai`、`pi-agent-core`、`pi-coding-agent` **0.85.1**。
- 包管理器与打包运行时：Bun **1.4.0**；版本由 `package.json`、CI 和打包脚本共同固定。
- 后台：只有 `PiAgent`。仓库不直接依赖 Claude Agent SDK，也不打包 Claude 原生二进制。
- Anthropic/Claude 模型、OAuth 连接名以及 `CLAUDE.md` 项目上下文属于提供商或文件格式兼容，不代表存在第二套 agent 后台。

## 运行链路

```text
Electron / Web UI / CLI
          │ RPC + session events
packages/server-core (SessionManager)
          │ AgentBackend + JSONL
packages/shared (PiAgent + event adapter + permissions)
          │ stdio
packages/pi-agent-server (Pi 0.85.0)
          │ provider API / local tools / proxied session tools
```

Pi SDK 被隔离在子进程中。主进程负责会话持久化、权限、sources、浏览器与 UI 事件；子进程负责 Pi 会话、模型运行时、内置工具和 provider 请求。

## 生命周期约束

`agent_end` 只表示一次 agent loop 结束，之后仍可能发生自动重试、上下文压缩或排队续跑，因此不是 Craft 会话的终点。只有 Pi 0.85.0 的 `agent_settled` 会关闭本轮事件队列。

长任务需要向用户报告中间进度时调用本地 `report_progress` 工具。它把进度映射为 `isIntermediate` 文本，同时保持 Pi 原生 agent loop 继续运行。纯文本回复因此保留清晰语义：工作已经完成，或确实需要用户输入/批准。

`agent_settled` 还会携带 `getContextUsage()` 的结果。UI 的上下文占用以该值为准，避免在压缩后用最后一次 provider usage 误估。

## 工具与 sources

- 会话工具的 schema 和 handler 单一来源位于 `packages/session-tools-core`。
- `PiAgent` 将会话工具与 source 工具合并为完整集合，通过 `sync_tools` 同步。
- 相同定义不会重复同步；新增、删除或 schema 变化才会让 Pi 会话在下一轮重建。
- source runtime 在 `SessionManager` 中缓存，并只对同一个 agent 实例应用一次。
- 浏览器工具开关会推送给所有存活的 Pi 子进程；忙碌会话在下一轮安全刷新，不中断当前工作。
- Windows 使用 Pi 0.85.0 的原生 PowerShell 工具，仍经过 Craft 的终端权限与审计管线。

## 模型发现与思考等级

- 标准 Pi provider 的模型与能力来自 Pi SDK catalog；`ModelDefinition` 保留 `reasoning`、`thinkingLevelMap`、图像输入和 `getSupportedThinkingLevels()` 的结果。
- 自定义 endpoint 保存前会依次尝试标准模型列表地址：`/models`、`/v1/models`，并兼容 Ollama 的 `/api/tags`。发现的 ID 会用 Pi catalog 补全上下文窗口和能力；端点返回的显式元数据优先。
- 模型列表不是所有兼容协议的强制接口。发现失败时 UI 允许用户填写逗号分隔的模型 ID，持久化的手动模型不会因后台刷新失败而丢失。
- 思考等级不是全局固定能力。界面按当前模型展示 Pi 报告的 `off / minimal / low / medium / high / xhigh / max` 子集。
- Pi 在初始化、切换模型和修改等级后会回报实际生效等级。若请求等级不被模型支持，Pi 的 clamp 结果会回写会话和 UI，避免显示值与真实请求参数不一致。

## 性能基线

当前可观测指标包括：冷/热 agent 状态、首事件、首响应、首工具、工具往返耗时、主进程事件处理、renderer 事件处理和 stream-to-paint。renderer 保存有界采样并提供 p50/p95。

已明确避免的热路径成本：

- 每轮重复重建相同 source runtime；
- 每轮重复注册相同工具并重建 Pi 会话；
- 有序实时消息每次执行 `O(n log n)` 排序；
- 同一渲染周期多次构建 turn 分组。

## 残留判定规则

下列内容应保留：Anthropic provider 适配、Claude 模型名称、Claude OAuth 产品文案、读取外部项目 `CLAUDE.md` 与 `.claude-plugin/plugin.json` 的兼容逻辑、历史 release notes。

下列内容不应重新引入：Claude Agent SDK 依赖或 hook 形状、第二套 session tool factory、`session-mcp-server` 后台、只服务旧后台的缓存/构建脚本、将 `agent_end` 当作终态的逻辑。

## 维护检查

升级 Pi 时至少执行：

```bash
bun install
bun run typecheck:all
bun run test
bun run server:build:subprocess
bun run electron:build
```

同时复核 `AgentSessionEvent`、工具工厂、OAuth 注册、context usage 和 Windows shell API 的变更，并在 `apps/electron/resources/release-notes/next.md` 记录用户可感知变化。
