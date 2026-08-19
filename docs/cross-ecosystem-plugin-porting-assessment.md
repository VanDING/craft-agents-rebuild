# 跨生态插件移植评估：DSH / Pi / Codex → Craft 原生能力

- 作者：Craft Agent（与用户协作）
- 日期：2026-08-20
- 性质：探索性评估（实施未定）
- 关联：本仓库 `univer-native-workbench-integration-plan.md` 的后续能力探索

---

## 1. 目标

从支持插件的生态 **DSH（DeepSeek Harness）**、**Pi（pi.dev）**、**Codex（openai/plugins）** 中探索有价值的插件，分类，并评估移植进 Craft 作为**原生能力**的可能性。目的是构建 Craft 的全能力工作台，而非逐一接入外部 SaaS。

## 2. 三个生态全景

| 生态 | 规模 | 插件类型 | 移植形态参考 |
|---|---|---|---|
| **DSH** | github topic `dsh-plugin`：8380 仓库，社区极活跃 | Cordis 插件（`dsh.bundle` 清单：SKILL + 工具 + UI 面板 + 子代理）+ SKILL.md | 能力参考 + 后端逻辑移植 |
| **Pi** | pi.dev/packages 持续发布，包月下载 1k~290k | **extension / skill / theme / prompt** 四类，npm 分发 | 与 Craft 能力模型最接近的范式 |
| **Codex** | openai/plugins：180 个官方插件（2026-08-16 归档只读） | `.codex-plugin/plugin.json` manifest + skills/mcp/agents/commands/hooks | 企业级集成 + 插件打包规范 |

> 说明：openai/plugins 已归档为只读，但仍是官方插件打包规范与设计样本的参考（figma、notion、build-web-apps、remotion、google-slides 等）。

## 3. 能力分类（跨生态合并去重）

| 能力域 | DSH 代表作 | Pi 代表作 | Codex 代表作 |
|---|---|---|---|
| 记忆/会话持久 | OpenViking、EverOS、MemOS、Co-Engram、mneme、memory-palace、handoff、recall（60+ 插件） | pi-memory、pi-hermes-memory、@remnic/plugin-pi、red-skills-memory | mem |
| 子代理/多 Agent 编排 | hermes 协同、dsh-agency-agents、ouroboros（Agent OS）、iPolloWork | pi-subagents、@tintinweb/pi-subagents、pi-goal、pi-dynamic-workflows、pi-task | superpowers、game-studio |
| 代码智能/LSP/编辑 | dsh-codegraph、GraphFlow、LiuHe、dsh-better-edit、dsh-lsp-actions、command-scout | pi-lens、@narumitw/pi-lsp、@ff-labs/pi-fff、opencode-codebase-index、pi-hashline-edit-pro、pi-edit-guard | coderabbit、github、codex-security |
| 工具/上下文优化 | toolshrink、dsh-compressor、dsh-funnel、dsh-tool-search | pi-mcp-adapter、pi-readseek、pi-rtk-optimizer、hypa | — |
| 浏览器/网页自动化 | nuphus-mcp、computer-control、trio（Playwright）、dsh-remote | pi-agent-browser-native、pi-web-access、pi-intercom | wix、shutterstock、hostinger |
| 办公/文档/呈现 | dsh-excel-chat、dsh-data-insight、dsh-artifacts、dsh-svg-motion | @plannotator/pi-extension | google-slides、build-web-apps、remotion、figma、canva |
| 学术/研究/引用 | dsh-ai4scholar（38 工具）、dsh-cite（GB/T 7714 等）、dsh-zotero、dsh-pubmed、context7、dsh-deepread | — | zotero、scite、factset、life-science-research |
| 数据/数据库/SQL | dsh-data-agent、dsh-sql（SQLite/MySQL/PG）、xiwen | tangle 相关 | airtable、neon-postgres、supabase、motherduck、datadog |
| 设计/创造力/媒体 | open-design（89k⭐）、deepseek-idesign/ivideo、openpencil、archify、设计 skills | — | figma、canva、remotion、picsart、game-studio |
| 权限/安全/治理 | dsh-shell-command、dsh-edit-approval、dsh-trajectory-governance、forge-gates | @gotgenes/pi-permission-system、@vigolium/piolium、pi-oikia | codex-security |
| 语音/多模态/生图 | dsh-translate-pro、awesome-gpt-image-2、dsh-tool-imagegen | @juicesharp/rpiv-voice、rpiv-ask-user-question | heygen、shutterstock、fal |
| 垂直领域 | dsh-apple-mode(Xcode)、UEAssetsOperator、godot-bridge、生信、中医、中文公文、政务 dknowc | @llblab/pi-telegram、context-mode | 大量企业级（SaaS/金融/生命科学） |

## 4. 移植可行性评估（对照 Craft 现有能力）

### 4.1 Craft 现有能力基线（缺口分析用）
原生已有：sources(MCP)、skills（SKILL.md）、子代理（spawn_session）、后台任务、浏览器（BrowserView/CDP）、数据表格（datatable/spreadsheet）、HTML/PDF/Image 预览、文档工具（markitdown/pdf/img/ical/doc-diff/xlsx/docx/pptx）、Mermaid、计划提交、用户偏好/记忆、跨会话消息、messaging（Telegram/WhatsApp）、OAuth。

### 4.2 三种移植形态（按耦合度从低到高）
1. **能力参考（白盒取经）**：读实现、重写成 Craft 原生 —— 适合"纯逻辑/纯 skill 型"。
2. **协议桥接**：Craft 已支持 MCP，开放 MCP server 可作 source 挂载 —— 成本最低，适合 MCP 型插件。
3. **直接搬运（npm 依赖）**：若插件是可分发 npm 包且开源许可（Apache/MIT），可直接作依赖引入。

### 4.3 高价值候选（按对 Craft 增益排序）

| # | 候选 | 来源 | 移植形态 | Craft 现状 | 增益 | 评估 |
|---|---|---|---|---|---|---|
| 1 | 跨会话记忆检索（handoff/memory-palace/MemOS） | DSH | 能力参考→原生 | 已有用户偏好/notes，弱跨会话检索 | 高 | 推荐立项 |
| 2 | 动态多子代理（pi-dynamic-workflows/pi-goal） | Pi | 能力参考 | 有 spawn_session，无 worktree 隔离/成本核算/TUI | 高 | 推荐 |
| 3 | 代码智能（LSP/模糊搜索/编辑锚定） | Pi/DSH | 能力参考+协议 | 无 LSP/模糊搜索/锚定编辑 | 中高 | 推荐 |
| 4 | 工具/上下文优化（hypa/toolshrink） | Pi/DSH | 能力参考 | 已有结果截断，无系统化压缩 | 中 | 可做，优先级中 |
| 5 | 学术引用（dsh-cite/ai4scholar） | DSH | 协议桥接 | 已有 arxiv/crossref/semantic-scholar | 中 | 可补引用格式化原生工具 |
| 6 | 图/结构呈现（archify） | DSH | 能力参考 | 已有 Mermaid 原生 | 中 | 作为补充，低优先 |
| 7 | 订阅/提醒（dsh-rss、BigFocus） | DSH | 协议桥接 | 有 automations，无 RSS | 中 | 补 RSS/定时监控 |
| 8 | 本地语音（rpiv-voice） | Pi | 能力参考 | 无 | 中 | 低优先 |
| 9 | 技能 Hub/市场（dsh-skill-hub） | DSH | 能力参考 | 有 skills，无市场 UI | 中 | 补浏览/安装 UI |
| 10 | 办公能力（excel-chat/data-insight） | DSH | 能力参考 | 与 Univer 方案重叠 | 待定 | 先完成 Univer 再评估 |

### 4.4 不建议移植
- **企业级 SaaS 集成**（Codex 的 airtable/zoho/salesforce 等）：应走 MCP source 机制，不硬编码进内核。
- **TUI/主题类**：Craft 是 GUI 桌面，无意义。
- **低相关垂直**（算命/钓鱼/彩票/中医）：纯 skill 可复用 prompt 思路，不值得工程化。

## 5. 关键洞察与结论

1. **DSH 的"一切皆插件"（SKILL+工具+UI+子代理）与 Craft 范式同构**，移植语义最顺。
2. **Pi 生态与 Craft 最接近**：显式区分 extension/skill/prompt/theme —— 是 Craft 建立"extension"概念的最佳参考。
3. **Codex 价值在打包规范**（manifest：skills/mcp/agents/commands/hooks），可作为插件打包标准的成熟参考；其 SaaS 集成应走 MCP source。
4. **最高杠杆方向**：①跨会话记忆检索 ②动态多子代理（worktree 隔离+成本）③代码/文档智能（LSP+模糊搜索+编辑锚定）。
5. **架构启示**：Craft 能力模型应升级为 **skill（纯提示）+ extension（工具+UI+事件）两级**，并对齐 Host 中立的打包标准（参考 Pi extension + Codex manifest），从而建立吸收三生态插件的低成本移植层。

## 6. 建议下一步（实施未定）

- **批 A（立项，待用户拍板）**：三选一深度评估，推荐先做跨会话记忆检索。
- **批 B（能力模型升级）**：设计 Craft extension 范式，作为未来吸收三生态插件的基础设施。
- **低优先快赢**：学术引用格式化、RSS/定时监控、技能市场 UI。

> 本文档为探索性评估。是否实施、实施优先级由用户决策；实施前需对选定候选做源码级可行性验证。
