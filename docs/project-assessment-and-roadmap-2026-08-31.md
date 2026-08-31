# 项目综合评估与发展路线图

> **状态：** 提议中的规划基线，尚未开始实施  
> **评估日期：** 2026-08-31  
> **评估范围：** 产品定位、架构、持久化、质量、CI、发布、安全、隐私、治理与项目可持续性  
> **证据边界：** 基于评估当日的本地仓库状态和本地 Git 引用。未执行远程 fetch、依赖安全审计、Bun 测试、正式打包或生产遥测分析。

## 一、总体结论

Craft Agents (RE) 已经不是功能型原型，而是一个具有明确差异化、真实工程深度和独立产品潜力的高潜力 Beta。

项目最有价值的产品主张是：

> 面向复杂、长时间、有副作用任务的本地 Agent 执行工作空间，提供持久执行、可检查运行、可恢复副作用和可审阅产物。

项目已经到达一个转折点。下一阶段不应继续横向扩展功能，而应进入收敛期：建立独立的产品和发布身份，让 CI 真实代表整个仓库，补齐发布与恢复链路，降低核心模块复杂度，并验证少数完整用户路径。

当前最主要的问题不是缺少能力，而是产品扩张速度超过了架构、验证体系、发布治理和产品边界的消化速度。如果继续按当前广度扩张，后续每一次修改的成本和风险都会持续增加。

## 二、项目现状定位

### 2.1 产品定位

项目应被定位为 Agent 执行工作空间，而不是通用聊天客户端、项目管理套件或消息平台。

最有防御力的产品支柱是：

| 支柱 | 当前价值 |
| --- | --- |
| 可检查运行 | Overview、Trajectory、Context、Map 让用户理解 Agent 如何得到结果。 |
| 持久运行时 | T1/T2、副作用状态、SQLite/WAL 和恢复语义支撑长时间任务。 |
| 产物工作流 | Revision、checkout、preview 和 review 形成聊天之外的交付闭环。 |
| 本地优先 | 工作区和主要执行状态由用户控制。 |
| 多执行入口 | Desktop、Web、CLI、Headless、Messaging 和 Automation 接入同一运行时。 |
| Provider 中立 | 统一到 Pi Agent 基线，降低对单一模型供应商的绑定。 |

### 2.2 仓库规模

评估时仓库大约包含：

- 2,081 个受版本控制文件；
- 1,690 个 TypeScript/TSX 文件；
- 419 个测试文件；
- 9 个 packages 和 4 个 applications；
- 本地历史共 329 个提交；
- `v0.12.1` 后约 20 个提交，约 12,000 行新增、4,600 行删除。

主要代码分布：

| 区域 | 源码文件 | 测试文件 | 判断 |
| --- | ---: | ---: | --- |
| Electron | 680 | 97 | 产品主体和主要复杂度中心。 |
| Shared | 437 | 155 | 测试资产较强，但已经承担过多职责。 |
| UI | 200 | 40 | 复用价值高，组件复杂度正在增长。 |
| Server Core | 141 | 49 | 运行时核心，架构治理杠杆最高。 |
| Messaging Gateway | 81 | 34 | 测试密度相对较好。 |
| Session Tools Core | 57 | 19 | 职责边界相对清楚。 |
| WebUI | 11 | 0 | 快速复用 Electron UI，但缺少独立测试。 |
| Viewer | 7 | 0 | 边缘应用，当前存在类型检查失败。 |

这个规模已经要求平台级工程纪律。原型阶段的验证方式和隐式包边界不再足够。

## 三、应继续保护的优势

### 3.1 架构决策克制

项目文档能够区分当前行为、历史记录、延迟实施的目标架构及其激活条件。Durable Runtime 采用分阶段增量落地，没有通过一次性重写替换现有系统。通用 DAG、分布式 lease 等大型基础设施也被明确延迟到出现可测量需求以后。

这种克制是项目的重要优势，后续路线图应继续把它作为约束。

### 3.2 对 Agent 执行语义理解深入

项目处理的对象不只是聊天记录，还包括：

- 工具调用开始与完成；
- T1/T2 副作用状态；
- 未知副作用；
- 崩溃恢复；
- canonical 与兼容投影；
- Artifact revision、lease、hash 和冲突。

这使项目更接近可信执行系统，而不是普通 Agent UI，也是最难被复制的能力。

### 3.3 安全基础正确

已有的正确基础包括：

- Electron context isolation 和 renderer Node integration 禁用；
- navigation 与外部 URL 控制；
- 对有副作用工具的 safe mode 限制；
- WebUI 的 Argon2id、JWT、HttpOnly Cookie、WebSocket 鉴权和限流；
- Artifact 的路径、符号链接、hash、lease 和 CAS 保护；
- 安全政策及私密漏洞报告流程。

项目并不缺少安全意识。剩余问题主要集中在少数高影响信任边界。

### 3.4 测试资产并不薄弱

仓库已经在 shared、durable runtime、messaging、artifact 和失败恢复等领域积累了大量测试。真正的问题是完整测试和所有应用没有进入同一个权威 CI 门禁，而不是没有测试。

## 四、主要风险与建议

### 4.1 独立品牌与发布信任链

**优先级：P0，公开发布阻断项**

仓库自带的商标政策要求 fork：使用不同名称、替换 Craft 品牌、更改 bundle identifier，并移除不必要的 `craft.do` 引用。当前打包配置仍然使用：

- `Craft Agents` 产品名；
- `com.lukilabs.craft-agent` 应用标识；
- Craft Docs 版权和域名；
- 面向上游项目的更新、支持和元数据引用。

这既是产品身份问题，也是软件供应链问题。更新地址和签名身份属于代码执行信任根。

在扩大公开分发前，应独立控制：

- 产品名称与视觉身份；
- application/bundle identifier；
- 更新域名与 release feed；
- 签名与公证身份；
- 下载、校验、回滚、支持和安全报告渠道。

项目可以保留准确的上游来源说明，但不应继续使用上游产品身份。本判断属于工程和产品风险分析，不构成法律意见。

### 4.2 CI 没有代表整个仓库

**优先级：P0，发布质量阻断项**

根目录 `typecheck:all` 没有包含 WebUI、CLI 和 Viewer。当前 `validate:ci` 只运行部分类型检查、部分测试和国际化检查，没有覆盖：

- 根目录完整测试；
- 全仓 lint；
- 所有应用类型检查；
- Desktop、Web、Server 构建 smoke test；
- 打包验证；
- 依赖安全扫描和发布验证。

评估期间直接调用仓库已有 TypeScript 编译器检查了 13 个项目：

- 12 个通过；
- `apps/viewer` 失败；
- Viewer 共 7 个错误，主要来自 ES target 不支持 `.at()`，以及 shared UI 对 Node `process` 类型的隐式依赖。

评估环境中 Bun 不在可调用路径，因此没有执行 Bun 测试和正式构建。这个结果证明的是 CI 覆盖缺口，不代表完整测试套件失败。

建议建立四层验证：

1. 每个 PR：所有 workspace 类型检查、lint、受影响包测试和轻量构建检查。
2. 主分支：完整测试及 Desktop、Web、Server 构建。
3. 定时任务：操作系统矩阵、Provider 集成测试、依赖审计、恢复演练和打包 smoke test。
4. Release candidate：签名安装包、安装/升级/回滚、校验和、SBOM 和 provenance。

### 4.3 核心模块正在成为架构瓶颈

**优先级：P1，研发速度风险**

最大的文件包括：

| 文件 | 约计行数 |
| --- | ---: |
| `SessionManager.ts` | 8,929 |
| `AppShell.tsx` | 3,697 |
| `browser-pane-manager.ts` | 3,230 |
| `TurnCard.tsx` | 3,032 |
| `config/storage.ts` | 2,781 |
| `shared/pi-agent.ts` | 2,625 |
| `FreeFormInput.tsx` | 2,334 |
| `pi-agent-server/index.ts` | 2,346 |

`SessionManager` 同时覆盖生命周期、持久化、恢复、投影、工具、事件、Sources 和任务执行。这会提高修改耦合度，让单元测试逐渐退化成大范围集成测试，也让职责边界难以理解。

不建议整体重写。应采用绞杀式拆分，暂时保留 `SessionManager` 作为兼容 facade。候选职责包括：

- `SessionRepository`；
- `RunCoordinator`；
- `ToolEffectBridge`；
- `ProjectionService`；
- `SessionLifecycle`；
- `SourceRuntime`；
- `SessionEventPublisher`。

每次抽取都应先建立行为契约测试，并保持 Durable Runtime 不变量。

### 4.4 WebUI 复用方式短期高效、长期脆弱

**优先级：P1，平台边界风险**

WebUI 当前构造浏览器版 `electronAPI`，写入 `window`，然后加载 Electron renderer 应用。Electron 和 Node 依赖则通过多组空 shim 或 browser-safe shim 进入浏览器构建。

这种方式可以迅速取得 UI 一致性，但也会产生：

- 不支持的行为静默退化成 no-op；
- Electron 特有依赖通过构建却在运行时发生语义错误；
- 平台能力差异依赖隐式约定；
- WebUI 没有独立测试；
- hoisted dependency 掩盖错误的依赖所有权。

建议渐进形成以下边界：

```text
平台无关 Application Shell
             |
      Capability Contract
        /             \
Electron Adapter    Web Adapter
```

每项能力应明确标记为 supported、unsupported、degraded、permission-gated 或 remote-only。目标不是维护两套 UI，而是让一套 UI 建立在显式的平台契约上。

### 4.5 持久化可靠，但缺少统一数据治理

**优先级：P1，用户信任风险**

当前状态分散在：

- `runtime.db`；
- 兼容层 `session.jsonl`；
- Artifact manifest、revision、checkout 和 preview；
- work-items JSON；
- automation JSON/JSONL；
- events 与 retry queue；
- configuration 和 credentials。

Durable database 已有备份和维护机制，但用户信任对象是整个 workspace，而不是其中一个数据库。

建议把 Workspace Integrity 建设为一等能力，包含：

- 数据清单和 schema version registry；
- migration journal；
- workspace 全量完整性检查；
- 完整备份与恢复；
- 可移植导出；
- 损坏隔离与修复报告；
- 恢复演练和可测量的恢复目标。

Canonical session 迁移应继续以投影一致性指标为依据，不要由任意日期驱动。

### 4.6 凭据和遥测需要更清晰的隐私边界

**优先级：P1，安全与信任风险**

当前 secure-storage fallback 使用稳定机器标识和存储在文件中的 salt，通过 PBKDF2 推导 AES-GCM 密钥。它可以避免明文保存，但无法有效防护同时能够读取凭据文件和机器标识的进程或用户。

长期应使用：

- Windows DPAPI 或 Credential Manager；
- macOS Keychain；
- Linux Secret Service/libsecret；
- 无 keychain 环境下的显式 fallback；
- 原子文件替换；
- 从当前格式迁移和恢复的版本化机制。

打包版本在注入 DSN 时可以启用 Sentry，设置机器派生标识，并捕获 renderer 的 `console.error`。对于本地优先产品，遥测行为需要比普通 SaaS 更透明、更受约束。

建议：

- 默认关闭，或仅在用户明确选择后开启；
- 提供可见设置和明确的数据控制方说明；
- 使用事件字段 allowlist，而不只依赖键名清洗；
- 提供用户可先检查、再主动导出的本地诊断包。

### 4.7 无人值守任务权限应显式化

**优先级：P1，副作用治理风险**

部分 Task Runner 路径会在子任务没有显式权限模式时使用 `allow-all` fallback，以避免无人值守任务继承 `ask` 后永久阻塞。

可用性不应静默优先于最小权限。每个 Automation 或无人值守任务都应持久化显式 capability envelope。旧任务或手写任务缺少权限时，应进入迁移或明确阻断状态，而不是隐式获得宽泛权限。

UI 应显示任务拥有的副作用权限，权限提升也应生成可审计事件。

### 4.8 仓库元数据与治理发生漂移

**优先级：P1/P2，可维护性风险**

已经观察到：

- 根命令仍引用不存在的 `apps/marketing`；
- CONTRIBUTING 仍列出该应用；
- 国际化命令引用缺失脚本；
- 多处保留上游作者、主页、域名和产品元数据；
- 统一到 Pi Kernel 后仍存在 Claude/Codex 历史术语；
- hoisted linker 可能掩盖不完整的 package 依赖声明；
- 本地 Git remote 使用 HTTPS，而项目规则要求 GitHub 操作使用 SSH；
- 缺少自动 release workflow、依赖更新配置、coverage threshold、SBOM 和 provenance。

这些问题应作为发布收敛的一部分处理，不需要另立功能项目。

## 五、产品发展方向

### 5.1 应强化的完整路径

产品资源应集中在三条端到端路径：

1. **复杂任务到可接受产物**  
   研究、代码、文档或数据任务产生 Artifact，用户能够检查运行轨迹，并接受、修改或拒绝结果。

2. **长时间任务可靠完成**  
   任务能够跨重启、网络波动、Provider 失败和工具未知结果恢复，同时清晰解释当前状态。

3. **远程或自动触发，但仍可治理**  
   CLI、Headless、Automation 和 Messaging 继续作为同一权限、运行时和审计模型的入口或通知面。

### 5.2 扩张边界

在核心路径稳定前，应保持以下约束：

- 看板和日历是 Agent 工作投影，不发展为通用项目管理产品。
- Messaging 是触发和通知入口，不发展为完整聊天平台。
- Profile 和 Theme 属于产品打磨，不成为路线图中心。
- 只有当用户证据表明“重新发现上下文”是主要失败原因时，才开始跨会话 Memory。
- Runtime、Permission 和 Packaging 契约稳定后，再公开建设扩展生态。
- 通用 DAG 和分布式运行时继续受文档中的激活条件约束。
- 没有新的、经过验证的产品需求时，Native Design Layer 保持归档。

## 六、产品与可靠性指标

北极星指标应衡量可信完成，而不是消息量或运行数量。

> **可验证完成率：** 运行最终产生用户接受的 Artifact 或明确成功状态，不存在未解决的 unknown side effect，也不需要用户纠正执行结果。

辅助指标：

- 首次成功任务耗时；
- crash-free run/session rate；
- T1 到 T2 完成率；
- unknown effect 的数量、持续时间和人工介入率；
- canonical projection parity；
- Artifact 接受率、修改次数和放弃率；
- Automation 成功率；
- session 初始化、首 token 和首屏渲染的 p50/p95；
- 每周回访 workspace 数量；
- 恢复成功率和平均恢复时间。

指标默认应保存在本地，仅通过用户主动导出或明确同意的遥测发送。

## 七、分阶段发展路线图

### 阶段 0：收敛与决策

**建议周期：** 1 周  
**目标：** 停止范围增长，明确独立产品身份和下一个版本边界。

行动项：

- [ ] 确定独立产品名、域名、应用标识、更新渠道和支持联系方式。
- [ ] 冻结 `0.13` 发布范围。
- [ ] 建立发布阻断清单和风险台账。
- [ ] 将功能划分为核心、维护、实验和延迟。
- [ ] 暂停新增一级产品域。

退出条件：

- 商标政策与打包身份不再冲突；
- 发布范围的新增必须附带明确取舍；
- 每个发布阻断项都有负责人和验证方式。

### 阶段 1：质量基线

**建议周期：** 2–3 周  
**目标：** 让 CI 绿色真正代表仓库可以交付。

行动项：

- [ ] 将 WebUI、CLI、Viewer 纳入权威 workspace 类型检查。
- [ ] 解决 Viewer 当前类型错误。
- [ ] 将全仓 lint、相关测试和 Desktop/Web/Server 构建 smoke test 纳入 CI。
- [ ] PR 执行受影响包测试，主分支或定时任务执行完整测试。
- [ ] 建立不依赖 secrets 的 mock integration，真实 Provider 检查保留为定时或手动 smoke test。
- [ ] 删除或修正失效根命令与过期仓库地图。
- [ ] 先记录覆盖率基线，再逐步提高门槛。

退出条件：

- 所有 workspace 可以独立通过类型检查；
- Desktop、Web 和 Server 可以在 CI 构建；
- 根命令不再引用缺失文件；
- CI 文档与实际门禁一致。

### 阶段 2：可信发布

**建议周期：** 2–4 周  
**目标：** 形成可验证安装、升级、恢复和隐私链路的对外版本。

行动项：

- [ ] 在支持的平台加入 Windows、macOS、Linux 打包 smoke test。
- [ ] 建立签名、公证、校验和、SBOM 和 provenance。
- [ ] 验证更新失败和回滚行为。
- [ ] 将 Server 镜像改为固定版本、多阶段、最小权限构建。
- [ ] 建立用户可见的遥测政策和本地诊断包。
- [ ] 设计并实施 OS keychain 迁移路径。
- [ ] 增加完整 workspace 备份、恢复和完整性检查。
- [ ] 执行一次 crash 和 unknown-effect 恢复演练。

退出条件：

- 发布来源和签名可验证；
- 更新失败可以回滚；
- 用户可以导出和恢复完整 workspace；
- 遥测行为可见、可控、可关闭。

### 阶段 3：降低架构复杂度

**建议周期：** 4–8 周  
**目标：** 降低未来修改的边际成本和风险。

行动项：

- [ ] 在保留 facade 的前提下渐进拆分 `SessionManager`。
- [ ] 将大型 UI 组件中的 controller/state selector 与纯渲染职责分离。
- [ ] 建立平台无关 Application Shell 和显式 Capability Contract。
- [ ] 为 Web Adapter 增加契约测试。
- [ ] 明确 package 依赖所有权，并加入 isolated install/build 检查。
- [ ] 定义运行时性能预算和恢复 SLO。
- [ ] 用显式 capability envelope 替代无人值守隐式权限 fallback。

退出条件：

- 常规核心修改不再必须编辑单个数千行中心文件；
- Web 不支持的能力不会静默表现为成功 no-op；
- package 可以根据声明依赖完成构建；
- Runtime、Permission、Projection 和 Persistence 有稳定责任边界和契约。

### 阶段 4：产品验证与单点扩张

**建议周期：** 下一季度  
**目标：** 先验证产品主张，再选择一个新能力。

验证以下完整场景：

- [ ] 研究或开发任务 → 可检查运行 → Artifact → 用户接受。
- [ ] 定时执行 → Messaging 通知 → 查看 Trajectory。
- [ ] Remote/Headless 长任务 → 中断恢复 → 明确副作用状态。

根据指标和用户证据，只选择一个扩张方向：

- 跨会话 Memory；
- Extension Packaging；
- 更强的 Artifact 编辑和审阅。

不要并行启动全部三个方向。

## 八、下一周期明确不做的事

- 不整体重写运行时。
- 不一次性重构所有大型文件。
- 不在收敛期间增加新的一级产品域。
- 不在缺少激活信号时建设通用 DAG 或分布式调度平台。
- 不把项目视图、日历或 Messaging 发展成独立通用产品。
- 不在契约稳定前公开承诺扩展生态。
- 不用扩大远程遥测代替产品指标设计。
- 不因为历史版本存在过某项能力就继续承担兼容成本。
- 不在品牌、更新、签名和恢复归属明确前大规模公开分发桌面应用。

## 九、最高优先级排序

如果当前只能执行五项工作，建议按以下顺序：

1. 完成独立品牌、更新渠道和发布信任链。
2. 冻结横向扩张，锁定下一个版本范围。
3. 让 CI 覆盖所有 workspace、关键测试和真实构建。
4. 完成隐私、凭据、workspace 备份和恢复边界。
5. 渐进降低 `SessionManager` 与 Electron/Web 平台耦合。

项目最值得保护的不是功能总量，而是可信 Agent 执行。一个专注的收敛周期可以把项目从高潜力 fork 推进为一致、独立的产品；继续广度优先扩张，则会让发布可靠性、可维护性和产品身份承受越来越大的压力。

## 十、关键证据入口

- 文档状态与维护规则：[`docs/README.md`](README.md)
- Durable Runtime 当前基线：[`docs/architecture/durable-agent-runtime.md`](architecture/durable-agent-runtime.md)
- 延迟实施的 Runtime 目标架构：[`docs/architecture/durable-agent-runtime-target-architecture.md`](architecture/durable-agent-runtime-target-architecture.md)
- 商标要求：[`TRADEMARK.md`](../TRADEMARK.md)
- 根验证脚本：[`package.json`](../package.json)
- Desktop 打包身份：[`apps/electron/electron-builder.yml`](../apps/electron/electron-builder.yml)
- Session 编排中心：[`packages/server-core/src/sessions/SessionManager.ts`](../packages/server-core/src/sessions/SessionManager.ts)
- 无人值守任务权限：[`packages/server-core/src/tasks/TaskRunner.ts`](../packages/server-core/src/tasks/TaskRunner.ts)
- Web 应用适配器：[`apps/webui/src/adapter/web-api.ts`](../apps/webui/src/adapter/web-api.ts)
- Web 构建 shim：[`apps/webui/vite.config.ts`](../apps/webui/vite.config.ts)
- 凭据存储：[`packages/shared/src/credentials/backends/secure-storage.ts`](../packages/shared/src/credentials/backends/secure-storage.ts)
