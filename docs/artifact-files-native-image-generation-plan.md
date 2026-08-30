# CraftAgent 通用文件 Artifact 与原生图片生成实施基线

- 日期：2026-08-30
- 状态：当前实施基线
- 范围：完整稳定能力；不是 MVP
- 取代范围：`docs/univer-native-workbench-integration-plan.md` 中与 Univer Sheet 引擎有关的后续路线
- 远期参考：`docs/native-design-layer-architecture-plan.md`（已存档，不属于本轮）

## 1. 结论

本轮只建设两项产品能力，并完成一项架构清理：

1. 让 Artifact 生命周期原生承载普通文件、Office 文件、媒体和未知文件；
2. 提供原生图片生成工具，生成结果直接成为可审阅 Artifact；
3. 无迁移器、无兼容开关、无死代码地一次性删除 Univer。

不会再引入新的嵌入式 Office、Grid 或 Design Runtime。会话编排、文件生成和修改、
doc-tools、MarkItDown、Artifact Card、Workbench、权限与接受/丢弃流程继续作为系统主干。

## 2. 产品定位

### 2.1 Artifact 是文件交付生命周期，不是编辑器

Artifact 负责：

- 把一个目标文件登记为 current 或 managed draft；
- 保存不可变 revision、可编辑 checkout、来源和校验结果；
- 提供安全预览，无法预览时提供可靠的外部打开回退；
- 通过 ready → accept/discard 保证最终路径只由用户确认写入；
- 让 Artifact Card 可回放，并让 Workbench 始终指向正确 revision。

具体内容仍由最适合的既有能力处理：

- 文本、代码、Markdown、JSON：现有文本工具与预览器；
- XLSX/DOCX/PPTX/PDF：现有 Python doc-tools 与 MarkItDown 语义预览；
- 图片处理：现有 img-tool；
- 图片生成：本轮新增的原生 `image_generate`；
- 未知或专有格式：Artifact 管理版本，系统应用负责打开。

### 2.2 图片生成是 Artifact 的生产者

`image_generate` 不是孤立的下载接口。它完成以下原子工作流：

```text
Agent tool request
  → resolve image-capable connection and credential
  → provider request
  → validate returned binary
  → create managed image draft
  → validate and submit ready
  → emit replayable Artifact event/card
  → user accepts or discards
```

## 3. 明确不做

- 不实施远期 Design Layer、`DESIGN.md`、品牌资产或 Design Lint；
- 不嵌入 Univer，也不寻找另一个 Grid/Office SDK 替代它；
- 不在 Workbench 内复刻 Word、Excel、PowerPoint；
- 不承诺所有专有格式都可编辑或高保真预览；
- 不做图片编辑、局部重绘、蒙版或多图批量生成；
- 不为旧 `.univer.json` 建迁移器或兼容读取路径。

## 4. 架构决策

### 4.1 浏览器安全的 FileFormatRegistry

在 shared Artifact 模块建立唯一格式注册表。每个条目包含：

- extensions；
- canonical MIME；
- ArtifactKind；
- preview strategy；
- validation family；
- 是否可作为安全 UTF-8 文本读取。

注册表必须可被主进程、renderer 和 `@craft-agent/ui` 共同使用，不能依赖 Node API。
未知扩展统一得到：

- `kind=file`；
- `mimeType=application/octet-stream`；
- `preview=external`；
- `text=false`。

这条规则消除“未知二进制按文本读取”的故障模式。

### 4.2 Artifact kinds

保留现有语义并增加：

- `audio`；
- `video`；
- `archive`；
- `file`（未知或未专门建模的文件）。

已知图片、PDF、文本、Markdown、JSON 保持原生预览。Office 文件继续生成绑定 revision
的 Markdown preview。音视频、压缩包、安装包和未知文件先统一识别并显示文件名、MIME、
大小与外部打开操作；在没有受控流式协议前，不用完整 data URL 冒充稳定的大媒体预览。

### 4.3 验证

验证按 family 执行，而不是散落的 kind/extension 分支：

- text：UTF-8/NUL 安全检查；
- json：解析检查；
- image：PNG/JPEG/GIF/WebP/SVG 等签名检查；
- pdf：`%PDF-` 签名；
- ooxml：ZIP 签名、`[Content_Types].xml` 与核心 part；
- media/archive/generic：非空、格式元数据与保守警告，不执行内容。

格式注册表只负责策略；复杂 Office 质量检查继续由 doc-tools 完成。

### 4.4 原生图片生成 Provider

建立 provider-neutral service contract，首个 adapter 使用官方 `openai` SDK。连接解析顺序：

1. tool 明确指定的连接；
2. 当前 session 有效的 OpenAI API-key 连接；
3. 已配置的首个有效 OpenAI API-key 连接。

ChatGPT/Codex OAuth 不冒充 OpenAI Images API credential。若没有可用连接，工具返回可操作错误，
提示用户配置 OpenAI API-key connection。

默认模型为 `gpt-image-2`；Agent 可按调用覆盖 model、size、quality、background、output format。
每次调用只生成一张图，降低意外成本并保证一次工具调用对应一个 Artifact Card。

### 4.5 来源与安全

生成 Artifact 持久化以下非敏感 provenance：

- origin/tool；
- provider；
- connection slug；
- model；
- prompt；
- size/quality/background/output format；
- timestamp。

绝不保存 API key。输出路径继续受 ArtifactStorageScope 约束；生成期间不写最终 sourcePath。
工具在 Explore/Safe mode 中禁用，并使用请求超时、有限重试、base64 大小上限和图片签名校验。

## 5. Univer 删除边界

一次提交内删除以下全部内容：

- `packages/artifact-engine-univer`；
- renderer/editor/headless service 及测试；
- SessionManager 的 blank snapshot、typed sheet mutation、range inspect 分支；
- Agent tool schema 中的 `sheet_set_range`、`sheet_set_formula`、`sheet_clear_range`；
- Workbench 与 Playground 的 Univer 分支；
- package、build alias、lockfile、typecheck 和 i18n 特例；
- system prompt 中的 Univer 工作流。

旧 `.univer.json` 不迁移。既有 manifest 中此类 Artifact 在升级后按普通 JSON/文件保守处理，
不再提供交互式 Sheet 引擎；代码中不保留 engine 特判。

## 6. 实施顺序

1. 冻结本基线与退役文档状态；
2. 删除 Univer 全链路并更新 lockfile；
3. 引入 FileFormatRegistry，扩展 Artifact 类型、存储、验证与 UI 回退；
4. 增加 `image_generate` schema、handler、callback binding 和 provider service；
5. 将生成结果接入 Artifact ready/card/workbench/provenance；
6. 补单元测试、类型检查、renderer/main build 和聚焦 smoke。

这些步骤是同一能力变更，不分别发布为临时产品状态。

## 7. 验收标准

### 7.1 Univer 清理

- 非历史文档中不存在 `univer` 包、import、alias、tool operation、UI 文案或运行时分支；
- lockfile 不再包含 Univer packages；
- renderer 不再生成 Univer lazy chunk。

### 7.2 通用文件 Artifact

- 已知文件从注册表得到一致 kind/MIME/preview/validation；
- 未知二进制可 create/register/inspect/submit/accept，且不会被当作文本读取；
- Office preview 仍绑定 active revision；
- 不可内嵌预览的文件显示清晰 metadata 和外部打开操作；
- 路径越界、symlink escape、revision conflict、lease conflict 仍被拒绝。

### 7.3 图片生成

- 没有可用 connection 时返回明确错误且不创建空 Artifact；
- provider 错误、空响应、非法 base64、超限和错误图片签名均安全失败；
- 成功调用只创建一个 `ready` image Artifact，不触碰最终 sourcePath；
- Artifact 可显示缩略图、打开 Workbench、接受和丢弃；
- provenance 可从 Artifact descriptor 重放，且不含 credential。

### 7.4 工程质量

- FileFormatRegistry、Artifact storage、tool handler、provider service 有聚焦测试；
- session-tools-core、shared、server-core、Electron、UI 类型检查通过；
- main/preload/renderer 与 server build 通过；
- i18n parity/sort 通过。
