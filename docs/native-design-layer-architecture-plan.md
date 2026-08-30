# 【远期存档】CraftAgent 原生 Design Layer：完整稳定能力架构与实施计划

- 日期：2026-08-30
- 状态：已存档；不是当前实施基线
- 性质：目标态架构与完整实施路线；不是 MVP 方案
- 参考项目：[`nexu-io/open-design`](https://github.com/nexu-io/open-design)
- 关联基线：`docs/univer-native-workbench-integration-plan.md`、`docs/theme-engine-design.md`、`docs/cross-ecosystem-plugin-porting-assessment.md`

> 存档决策（2026-08-30）：本方案作为可能的远期 Design Layer 参考保留，当前不进入实施。当前实施范围以 `docs/artifact-files-native-image-generation-plan.md` 为准：删除 Univer、扩展通用文件 Artifact，并加入原生图片生成；会话、Agent Runtime、工具、预览、审阅与接受流程继续复用现有系统。
>
> 文内所有 `artifact-engine-univer`、Univer snapshot、迁移和兼容描述均是存档时的目标态设想，已经失效，不能据此恢复依赖或实现迁移器。

---

## 0. 结论先行

CraftAgent 应建设一个原生的 **Design Layer（设计能力层）**，使任何可视 Artifact 都能携带设计上下文，被真实渲染、验证、评审、修订、接受并以标准格式交付。

Design Layer 不是：

- 第二套 Agent Runtime；
- OpenDesign daemon/Web/Desktop 的嵌入；
- 一个只会生成 Landing Page 的 Skill；
- CraftAgent 应用 Theme 的扩展；
- 一个脱离 Session、Project、Artifact 和 Workbench 的独立“设计应用”。

Design Layer 是：

1. Artifact 生命周期上的横向能力层；
2. Project/Session/Run 可分级绑定的设计上下文；
3. Skill、Recipe、Design Context、通用设计规则的组合器；
4. Interface、Live Artifact、Workbook、Deck、Document、Diagram、Image、Motion 等引擎的统一宿主；
5. 确定性 Design Lint 与证据驱动视觉评审的质量门；
6. 可追溯、可版本化、可离线复现的交付系统。

本计划吸收 OpenDesign 最有价值的思想：`DESIGN.md`、设计包、Skill/Template 分离、通用 craft 规则、沙箱预览、设计闭环和导出；但所有运行时、持久化、UI、权限、Artifact 集成和质量系统按 CraftAgent 现有架构原生重写。

所有里程碑均服务于同一个最终架构。允许内部增量合并和隐藏发布，但不得以缺少安全、来源、评审、迁移或跨平台能力的早期切片冒充稳定产品。

---

## 1. 产品定位

### 1.1 Design 在整个系统中的位置

```text
User / Automation / Work Item
            │
            ▼
Session + Design Brief
            │
            ▼
Design Context Resolver
Project defaults + Session override + Run override + references
            │
            ├───────────────┐
            ▼               ▼
Design Recipe          Universal Design Rules
shape/workflow         typography/a11y/motion/content
            │               │
            └───────┬───────┘
                    ▼
             Pi Agent Runtime
           skills + tools + sources
                    │
                    ▼
             Managed Artifact
      draft → inspect/render/review → ready
                    │
          ┌─────────┴──────────┐
          ▼                    ▼
    Context Workbench      Derived Deliverables
    preview/edit/review    HTML/XLSX/PDF/PPTX/SVG/MP4
          │                    │
          └─────────┬──────────┘
                    ▼
              Accept / Revise
```

### 1.2 不新增“设计孤岛”

- Project 是品牌和长期资产的默认归属。
- Session 是设计协作、需求澄清和修改历史的归属。
- Artifact 是产物、版本和接受/丢弃的权威对象。
- Context Workbench 是预览、编辑、检查、评审和导出的统一界面。
- Work Item/Automation 可以触发设计运行，但不另建任务系统。
- Pi Runtime 继续是唯一 Agent 后台。

### 1.3 Theme 与 Design Context 的强边界

| 概念 | 控制对象 | 存储与作用域 | 是否进入产物 |
|---|---|---|---|
| CraftAgent Theme | 应用自身 chrome/UI | app/workspace appearance | 否 |
| Design Context | 用户产物的品牌与视觉规则 | global/workspace/project/session/run | 是 |
| Design Recipe | 产物形态与制作方法 | registry + pinned version | 是 |
| Universal Design Rules | 与品牌无关的质量规则 | versioned built-in registry | 间接进入生成与评审 |

任何实现不得把应用主题 CSS 注入用户 Artifact，也不得让用户 Artifact 的 Design Context 改变 CraftAgent chrome。

---

## 2. 最终能力范围

### 2.1 必须支持的设计表面

“文件格式”和“设计表面”不是一回事。一个表面定义创作语义、编辑模型和质量标准；同一表面可以有多个 source 与 deliverable，PDF 也可能是 Document、Workbook、Deck、Diagram 的最终交付格式。

| 表面 | 权威源 | 原生预览 | 必需交付物 |
|---|---|---|---|
| Interface Prototype | HTML/CSS/JS 或真实框架项目 | 交互式多视口沙箱 | HTML/ZIP、PDF、PNG |
| Live Artifact/Dashboard | HTML + manifest + data bindings | 可交互沙箱、参数面板 | HTML/ZIP、数据快照、PDF |
| Spreadsheet/Workbook | XLSX 或 versioned Univer workbook snapshot | 单元格/公式/图表/分页预览 | XLSX、ODS、PDF、PNG；CSV/TSV 数据交换 |
| Deck/Presentation | 结构化 slide manifest + HTML renderer | 播放/缩略图/备注 | HTML、PDF、PPTX、ODP |
| Editorial/Publication Document | DOCX、HTML 或内部结构化文档 | 分页/连续/印刷预览 | DOCX、ODT、PDF/PDF-A、HTML；适用时 EPUB |
| Diagram/Canvas/Infographic | SVG、Mermaid、draw.io/Excalidraw adapter model | 无限画布/页面/连线/图层预览 | SVG、PDF、PNG；对应可编辑源格式 |
| Image/Graphic | 原始图片 + generation/edit metadata | 色彩管理图片预览 | PNG/JPEG/WebP/AVIF/SVG（适用时）、TIFF（印刷） |
| Motion/Video | timeline/composition manifest | 时间轴预览 | MP4/WebM、GIF/animated WebP、poster frame |
| Design System | Design Context Package | token/component/fixture gallery | 可安装 package/ZIP |
| Existing Code Refresh | 用户代码仓库 | dev server/browser + diff | 修改后的真实源码 |

Email/Newsletter 是 Interface 或 Document Recipe，可输出 HTML/MJML/EML；Report、Book、Resume、Brochure、Invoice、Form 和 EPUB publication 是 Document Recipe；Poster、Social Card、Infographic 可根据是否需要结构化编辑落在 Image 或 Diagram。JSON、CSV、TSV、Parquet 是数据源，不因扩展名本身成为设计表面。

### 2.2 格式能力等级

不得用一个含糊的“支持”描述完全不同的保真能力。每个格式适配器、平台和版本必须声明以下五级之一：

| 等级 | 承诺 | 产品行为 |
|---|---|---|
| `native-source` | CraftAgent 能完整创建、修改、验证并作为 Artifact 权威源保存 | 可作为长期主文件，覆盖 contract/E2E |
| `round-trip` | 可导入、编辑并写回，已知不保真项有机器可读报告 | 导出前展示 fidelity report，禁止静默丢失 |
| `import-only` | 只转为受支持的权威源或作为视觉/数据参考 | 原文件只读保留，生成新 Artifact，不覆盖源文件 |
| `export-only` | 从权威源稳定生成交付物，但不承诺重新导入编辑 | deliverable 绑定 revision 与 exporter version |
| `preserve/pass-through` | 不理解或不执行的内容可被原样保存、复制到交付物 | 明确标记不可编辑；内容哈希必须保持 |

能力等级必须细化到特性，而不只细化到扩展名。例如 `.xlsx` 可对公式、样式、合并单元格和基础图表 `round-trip`，但对不支持的外部数据连接、ActiveX 或某些高级图表只能 `preserve/pass-through`。任何转换都生成 `FidelityReport`，列出 retained、materialized、flattened、dropped、unsupported 和 security-disabled 项。

### 2.3 Source、Deliverable、Preview 三分

- **Source** 是可版本化和继续编辑的权威内容；
- **Deliverable** 是从固定 revision 派生的交付文件；
- **Preview** 是 renderer 的可重建视图，不是权威文件，也不能证明导出保真；
- 同一扩展名可在不同引擎中处于不同角色；
- 用户选择格式时，UI 必须显示能力等级、保真风险、活动内容和目标用途（继续编辑、网页发布、打印、归档或数据交换）。

### 2.4 完整格式支持矩阵

下表是稳定目标，不代表所有格式都获得同等编辑语义；精确版本与特性子集在 Phase 0 ADR 中冻结。

| 表面 | Native source / Round-trip | Import-only | Export-only | Preserve/pass-through |
|---|---|---|---|---|
| Interface | HTML/CSS/JS、受支持的 JSX/TSX/框架项目 | Figma/Sketch 等经官方 connector 或审计 importer 转成代码/参考 | standalone HTML、ZIP、PDF、PNG | 未识别项目文件与锁文件按项目策略保留 |
| Live Artifact | `live-artifact.json` + HTML/assets/data-binding schema | notebook/dashboard snapshot、受支持数据连接描述 | HTML/ZIP、固定数据快照、PDF、PNG | 未授权 connector 配置仅保留元数据，不复制 credential |
| Spreadsheet | XLSX、Univer snapshot；ODS 在声明的特性子集内 round-trip | Apple Numbers；无法保真的 legacy XLS；JSON/Parquet 作为数据导入 | PDF、PNG；CSV/TSV 作为 data-only export | XLSM/VBA、外部连接、未知 OOXML 部件原样保留且默认不执行 |
| Deck | `slides.json` + HTML；PPTX/ODP 在声明的对象子集内 round-trip | Keynote、无法映射的旧格式转为参考/新 Deck | HTML、PDF、PNG、speaker-notes 文档 | PPTM/VBA、未知 OOXML 部件原样保留且默认不执行 |
| Document | DOCX、ODT、HTML、Markdown/内部结构化文档（按 Recipe 选择权威源） | Pages、legacy DOC、PDF 内容抽取/重建 | PDF/PDF-A、EPUB、HTML、TXT；RTF 为兼容输出 | DOCM/VBA、未知 OOXML/嵌入对象原样保留且默认不执行 |
| Diagram | SVG、Mermaid、draw.io/mxGraph、Excalidraw adapter model | VSDX、FigJam/Figma board、其他 canvas 经 importer 转换/参考 | SVG、PDF、PNG | 未识别 stencil、嵌入对象和 vendor metadata 保留 |
| Image | PNG、JPEG、WebP、AVIF、SVG；TIFF 在支持的色彩子集内 | PSD/AI 等生成 flattened preview 或经外部 provider 转换 | 优化变体、TIFF、PDF、icon set | 原 PSD/AI、ICC/EXIF/XMP 按策略保留，不声称图层可编辑 |
| Motion | composition manifest；受支持的 Lottie JSON | 工程文件或第三方时间线转为素材/参考 | MP4、WebM、GIF、animated WebP、image sequence、poster | 原工程文件、字幕/音轨/metadata 可附带保留 |
| Design System | `craft-design-context` package、tokens、assets、`DESIGN.md` | OpenDesign package、website/Figma/project evidence | package/ZIP、token bundles、NOTICE | vendor source file 与 local-only asset 按许可策略保留 |

专有格式 `.fig`、`.sketch`、`.ai`、`.psd`、`.key`、`.numbers`、`.vsdx`、`.pbix` 等，只有存在官方 API、可靠开源解析器或显式外部 provider 时才提升能力等级；稳定版不得以截图导入冒充可往返编辑。

### 2.5 活动内容与宏安全

- DOCM/XLSM/PPTM 中的 VBA、ActiveX、OLE、外部连接、脚本和 embedded executable 默认永不执行；
- importer 在隔离 worker 中枚举活动内容并生成 security findings；
- 用户要求“保留宏”只授权 byte-preserving/pass-through，不授权执行；
- 写回时若无法保证活动内容不被破坏，必须导出为新文件并阻止覆盖原件；
- 外部链接、远程图片、数据刷新和公式外部引用在预览中默认禁用，逐项授权；
- 解压炸弹、递归容器、超大画布、恶意字体和媒体使用统一资源预算。

### 2.6 稳定版不允许缺失的横向能力

- Design Context 创建、导入、更新、版本固定、回滚、删除保护；
- `DESIGN.md`、tokens、components、assets、fonts、provenance 的包协议；
- Design Recipe 独立注册表；
- brief、direction、reference、platform、locale、delivery contract；
- 安全交互预览、多视口、截图、控制台和网络证据；
- lint、brand conformance、accessibility、interaction、visual critique；
- review finding 的生命周期与 waiver；
- immutable render/export/review 与 Artifact revision 一一绑定；
- desktop、headless/server、Web UI 的能力协商和合理降级；
- crash recovery、并发控制、取消、超时、缓存、资源回收；
- 来源与许可证审计；
- OpenDesign Design Package/Skill metadata 的显式导入兼容；
- 完整迁移、测试、性能预算和发布门。

### 2.7 专业领域扩展边界

完整架构必须能容纳下列领域，但它们不应在本轮被虚假归入“文件格式适配”：

- Audio/Podcast（WAV/FLAC/MP3、多轨工程、响度与字幕）需要独立 Audio Engine；本轮只支持 Motion Artifact 的音轨与交付附件；
- 3D/Spatial/CAD/BIM（glTF/USD/USDZ/STEP/DWG/IFC）需要场景图、材质、单位、相机和几何验证，不塞入 Diagram 或 Image；
- 专业出版工程（INDD、Affinity Publisher）和专业图像工程（PSD/AI）默认 import-only/flattened/pass-through，除非有可靠 provider；
- 数据库、BI 工程和 notebook（PBIX、Tableau、Jupyter 等）作为 Live Artifact 数据/交互来源或 import-only reference，不冒充原生编辑器；
- Figma/Sketch/Canva 等云端或专有编辑器通过可选 connector/provider 接入，连接不可用时核心能力仍可运行。

这些未来 surface 必须通过同一 `DesignEngine`、Format Capability、Artifact revision、Fidelity Report、review 和 deliverable contract 注册，不需要改写 Design Layer 核心。是否把其中任何一项纳入本轮 stable，必须单独增加 ADR、引擎、威胁模型、fixture corpus、E2E 和工程量；“完整”指体系闭合且可扩展，不代表对无限格式做无损承诺。

---

## 3. 架构原则

### 3.1 Artifact 是唯一产物权威源

Design 不建立平行的文件版本系统。所有设计产物继续使用现有 Artifact：

- `draft/current/ready/accepted/discarded/conflict`；
- content-addressed immutable revision；
- user/agent lease；
- CAS 更新；
- accept 前不修改最终 source path；
- Turn Card 与 Context Workbench 回放。

Design Run、render、review、export 只引用 Artifact revision，不持有一份可漂移的“当前文件”。

### 3.2 引擎可替换，产品协议稳定

产品层只认识：

- `ArtifactKind`
- `DesignSurface`
- `DesignContextRef`
- `DesignRecipeRef`
- `DesignRunSpec`
- `RenderProfile`
- `DesignReviewReport`
- `ArtifactDeliverable`

Playwright、Electron iframe、PPTX 工具、FFmpeg、图片模型等是引擎适配器，不进入稳定 UI/RPC 语义。

### 3.3 版本与内容哈希优先于可变名称

所有可影响输出的输入都必须被快照或以 digest 引用：

- Design Context version/digest；
- Recipe version/digest；
- universal rule-set version；
- brief/reference digest；
- renderer/exporter version；
- viewport/profile；
- font/asset digest；
- model/provider/model-id（不记录 secret）；
- validator/rubric version。

### 3.4 提示词不是状态存储

- Project 只存 Design Context 绑定和用户规则，不把完整 `DESIGN.md` 拼入 `details`。
- Run Spec 是持久化结构化对象。
- Agent 只在设计任务中获得最小必要摘要和文件路径。
- `DESIGN.md`、Recipe `SKILL.md` 与引用文件通过 prerequisites 强制读取。
- Prompt compaction 后可从持久化 Run Spec 恢复，不依赖历史聊天文本。

### 3.5 本地优先不等于无安全边界

生成 HTML、脚本、字体和插件内容均视为不可信输入。预览、导出、截图和视觉检查必须在受限执行环境中完成。

---

## 4. 领域模型

所有客户端、Agent tools、Artifact engines 与导出器共享同一枚举，不以 MIME type 反推表面：

```ts
type DesignSurface =
  | 'interface'
  | 'live-artifact'
  | 'spreadsheet'
  | 'deck'
  | 'document'
  | 'diagram'
  | 'image'
  | 'motion'
  | 'design-system'
  | 'existing-code-refresh'

type DeliveryIntent =
  | 'continue-editing'
  | 'cross-suite-collaboration'
  | 'web-publishing'
  | 'print'
  | 'archive'
  | 'image-delivery'
  | 'video-delivery'
  | 'data-exchange'
```

### 4.1 Design Context Package

Craft 原生包建议使用 `craft-design-context/v1`：

```text
<package>/
├── manifest.json                 # 必需：身份、版本、来源、许可证、文件索引
├── DESIGN.md                     # 必需：Agent 可读的设计决策与规则
├── tokens.css                    # 必需：CSS semantic tokens
├── design-tokens.json            # 可选：W3C 风格结构化 token
├── USAGE.md                      # 可选：适用范围、覆盖规则、禁止事项
├── components.html               # 可选：组件 fixture
├── components.manifest.json      # 可选：机器可读组件索引
├── assets/                       # 可选：明确授权的静态资产
├── fonts/                        # 可选：明确允许再分发的字体
├── previews/                     # 可选：颜色/字体/间距/组件预览
├── source/                       # 可选：导入证据与生成报告
└── LICENSES/                     # 可选：包内第三方许可
```

核心 manifest 字段：

```ts
interface DesignContextManifestV1 {
  schemaVersion: 'craft-design-context/v1'
  id: string
  name: string
  version: string
  description?: string
  categories?: string[]
  capabilities: Array<
    | 'interface'
    | 'live-artifact'
    | 'spreadsheet'
    | 'deck'
    | 'document'
    | 'diagram'
    | 'image'
    | 'motion'
    | 'design-system'
  >
  source: {
    type: 'builtin' | 'git' | 'folder' | 'website-extract' | 'generated' | 'user'
    origin?: string
    revision?: string
  }
  license: {
    expression: string
    attribution?: string
    redistribution: 'allowed' | 'restricted' | 'local-only' | 'unknown'
  }
  brandRelationship: 'none' | 'official' | 'inspired' | 'user-owned' | 'unknown'
  files: {
    design: 'DESIGN.md'
    tokens: 'tokens.css'
    usage?: string
    designTokens?: string
    components?: string
    componentsManifest?: string
    assetsDir?: string
    fontsDir?: string
    previewsDir?: string
  }
  integrity: Record<string, string>
}
```

约束：

- `DESIGN.md` 是 Agent 语义的权威文本；
- `tokens.css` 是 Web 渲染的权威语义 token；
- `design-tokens.json` 和其他映射是派生表示，必须通过一致性验证；
- package install 后不可原地修改；更新产生新 version/digest；
- 被 Artifact revision 引用的版本不可物理删除，只能 tombstone；
- local-only 文件不得进入公开导出包，除非用户在交付时明确确认。

### 4.2 Design Recipe

Recipe 不是 Skill。Skill 表示“Agent 会做什么”，Recipe 表示“某类产物如何被创建、渲染、验证和导出”。Recipe 可以引用一个或多个 Skill。

```ts
interface DesignRecipeManifestV1 {
  schemaVersion: 'craft-design-recipe/v1'
  id: string
  name: string
  version: string
  surface: DesignSurface
  scenarios: string[]
  platforms?: string[]
  artifact: {
    kind: ArtifactKind
    engineId: string
    canonicalFiles: string[]
  }
  generatorSkills: string[]
  assets?: string[]
  references?: string[]
  compatibleDesignCapabilities: string[]
  defaultRenderProfiles: string[]
  validators: string[]
  exporters: string[]
  networkPolicy: 'deny' | 'prompt' | 'allow-listed'
  reviewPolicy: 'required' | 'recommended' | 'manual'
  provenance: PackageProvenance
}
```

注册表必须把以下对象分开呈现：

- Functional Skills；
- Design Recipes；
- Design Contexts；
- Universal Design Rules；
- Prompt Templates（图像/视频模型输入）。

不得继续把上百个模板伪装成 Skills。

### 4.3 Design Brief

Brief 是结构化、可编辑、可复用的运行输入：

```ts
interface DesignBriefV1 {
  objective: string
  audience?: string[]
  decisionOrOutcome?: string
  surface: DesignSurface
  platformTargets?: string[]
  contentScope?: string
  requiredContent?: string[]
  forbiddenContent?: string[]
  tone?: string[]
  locale: string
  fidelity: 'wireframe' | 'medium' | 'high' | 'production'
  accessibilityTarget: 'baseline' | 'WCAG-AA' | 'WCAG-AAA' | 'custom'
  references: DesignReference[]
  delivery: DeliveryRequirement[]
  constraints?: string[]
  openQuestions?: string[]
}
```

Brief 可以由用户表单、自然语言推断、Automation 或 Work Item 生成。系统只询问会改变交付结果的缺失项；用户可以直接接受推断值。

### 4.4 Direction Set

在没有绑定品牌或用户要求探索时，可创建可丢弃的 Direction Set：

- 每次 2–4 个明确不同的方向；
- 每个方向包含 mood、palette、typography、layout posture、motion posture、reference rationale；
- 方向是结构化提案，不是长篇聊天文本；
- 用户选择后固化进 Run Spec；
- 未选择方向不污染 Design Context registry；
- 用户可以将成熟方向提升为新的 Design Context Package。

### 4.5 Design Run Spec

每次设计生成/重大修订均产生 immutable Run Spec：

```ts
interface DesignRunSpecV1 {
  schemaVersion: 'craft-design-run/v1'
  id: string
  workspaceId: string
  projectId?: string
  sessionId: string
  turnId?: string
  artifactId: string
  baseArtifactRevision?: string
  brief: DesignBriefV1
  designContext: PinnedPackageRef
  recipe: PinnedPackageRef
  ruleSets: PinnedPackageRef[]
  references: PinnedReference[]
  renderProfiles: RenderProfile[]
  reviewPolicy: ReviewPolicy
  execution: {
    modelProvider?: string
    modelId?: string
    engineVersions: Record<string, string>
  }
  createdAt: number
}
```

Run Spec 单独存储并引用 Artifact，不把 Design 专用字段无限塞进通用 `ArtifactDescriptor`。Artifact 只新增一个通用 `workflowRef/provenanceRef` 摘要字段，完整数据由 Design store 持有。

### 4.6 Design Review Report

禁止把一个单一“8.6/10”作为质量真相。Report 由证据和 finding 构成：

```ts
interface DesignFinding {
  id: string
  ruleId: string
  category:
    | 'render'
    | 'layout'
    | 'brand'
    | 'a11y'
    | 'interaction'
    | 'copy'
    | 'data'
    | 'performance'
    | 'delivery'
    | 'fidelity'
    | 'security'
    | 'visual'
  severity: 'blocker' | 'error' | 'warning' | 'suggestion'
  message: string
  renderProfile?: string
  location?: {
    kind: 'dom' | 'cell' | 'range' | 'slide-object' | 'document-block' | 'diagram-node' | 'image-region' | 'time-range'
    ref: string
    subref?: string
  }
  evidenceRefs: string[]
  status: 'open' | 'fixed' | 'accepted-risk' | 'false-positive'
  waiver?: { actor: string; reason: string; timestamp: number }
}
```

Report 必须记录：

- artifact revision；
- validator/rubric/model version；
- screenshots/engine inspection/console/network/format trace；
- findings；
- gate decision；
- waiver；
- 与上一 revision 的回归差异。

### 4.7 Format Capability 与 Fidelity Report

格式能力是 engine adapter 的版本化合同，而不是散落在 UI 中的扩展名判断：

```ts
interface FormatCapabilityV1 {
  engineId: string
  formatId: string
  mimeTypes: string[]
  extensions: string[]
  role: 'native-source' | 'round-trip' | 'import-only' | 'export-only' | 'preserve/pass-through'
  featureProfile: string
  platformConstraints?: string[]
  activeContentPolicy?: 'none' | 'blocked' | 'preserve-only'
}

interface FidelityReportV1 {
  sourceFormat: string
  targetFormat: string
  adapterId: string
  adapterVersion: string
  sourceDigest: string
  artifactRevision: string
  retained: FidelityItem[]
  materialized: FidelityItem[]
  flattened: FidelityItem[]
  dropped: FidelityItem[]
  unsupported: FidelityItem[]
  securityDisabled: FidelityItem[]
}
```

import、round-trip save 和 export job 都必须先解析 capability，再由相同的 preflight 生成 Fidelity Report。高风险丢失、活动内容损坏或目标格式不适配时，job 进入 `needs-confirmation`，不得靠扩展名猜测后继续。

---

## 5. 作用域、解析与优先级

### 5.1 注册表优先级

建议统一采用：

```text
built-in < global user < workspace < project
```

高优先级同 id 包可以 shadow 低优先级包，但不会覆盖或删除底层包。所有解析结果都必须返回来源、版本和 digest。

### 5.2 运行时选择优先级

```text
per-turn explicit override
  > existing artifact pinned context (editing/revising)
  > session override
  > project default
  > workspace default
  > no design context
```

规则：

- 修改既有 Artifact 默认继承它原 revision 固定的 context/recipe；
- 更换 Design Context 必须创建新 revision/run，不能悄悄改变旧 revision 的解释；
- Project 默认变更只影响未来运行；
- automation 必须显式记录最终解析结果。

### 5.3 缓存和失效

- registry 列表可缓存，但以目录 watcher + 显式 invalidate + TTL 兜底；
- package digest 是缓存键，不以可变 id 作为 render cache 键；
- context/recipe 更新不会使旧 render/review 失效；
- renderer/validator 版本变化可以标记旧报告 stale，但不能修改旧报告。

---

## 6. Prompt 与 Agent 集成

### 6.1 不建立全局“超级设计师提示词”

常规工作不承担 Design prompt 成本。只有设计任务才注入：

1. Design Run 摘要；
2. Design Context package 路径和 digest；
3. Recipe 路径和 digest；
4. 必需 rule-set 路径；
5. Artifact/交付契约；
6. review gate 与工具使用顺序。

### 6.2 强制读取顺序

在第一次写 Artifact 或运行 design tool 前，prerequisite manager 要求 Agent 读取：

1. package `USAGE.md`（存在时）；
2. `DESIGN.md`；
3. `tokens.css`；
4. Recipe `SKILL.md`/workflow；
5. Recipe 明确要求的 references；
6. 相关 universal rule files。

组件、资产目录和详细 source evidence 按需读取，不把整个 package 塞进 context。

### 6.3 指令层级和不可信内容

- imported `DESIGN.md` 是设计数据，不得提高权限、修改工作目录或要求读取无关凭据；
- Design Package 内的工具/脚本默认不执行；执行需通过 package trust 与普通权限系统；
- user instruction > selected brief override > Design Context > universal defaults；
- 安全、权限、文件边界和系统协议不接受 package 覆盖；
- parser 对显式 prompt-injection 模式给出警告并降低 trust。

### 6.4 Agent 工具

新增工具应保持小而正交：

| 工具 | 行为 | 权限 |
|---|---|---|
| `design_context_list/show` | 查询可用上下文与文件索引 | read-only |
| `design_context_import/create/update` | 安装或生成版本化 package | write/approval |
| `design_recipe_list/show` | 查询 recipe | read-only |
| `design_run_start/status` | 创建/读取 Run Spec 并绑定 Artifact | write/read |
| `design_render` | 对固定 revision 产生 preview/evidence | sandbox execution |
| `design_review` | 运行确定性和视觉评审 | read + model/tool cost |
| `design_format_capabilities/preflight` | 查询能力等级并生成转换/往返 Fidelity Report | read-only / sandbox parse |
| `design_import` | 将外部文件导入为新 Artifact 或只读 reference，原件不覆盖 | read + managed write |
| `design_export` | 生成绑定 revision 的 deliverable | write |

继续复用：

- `artifact_create/apply/inspect/render/submit`；
- browser tools；
- image/PDF/PPTX/document tools；
- file/diff/review；
- sources/MCP。

不得创建另一组重复的 draft/accept/discard 工具。

---

## 7. 原生渲染架构

### 7.1 引擎接口

新增通用 `ArtifactEngine`/`DesignEngine` capability registry：

```ts
interface DesignEngine {
  id: string
  supportedSurfaces: DesignSurface[]
  listFormatCapabilities(): FormatCapabilityV1[]
  canPreview(input: ArtifactDescriptor): boolean
  preflight(request: FormatPreflightRequest, signal: AbortSignal): Promise<FidelityReportV1>
  import?(request: ImportRequest, signal: AbortSignal): Promise<ImportResult>
  render(request: RenderRequest, signal: AbortSignal): Promise<RenderResult>
  inspect(request: InspectRequest, signal: AbortSignal): Promise<InspectionResult>
  export(request: ExportRequest, signal: AbortSignal): Promise<ArtifactDeliverable[]>
  dispose?(scope: EngineScope): Promise<void>
}
```

首个核心实现为 `artifact-engine-html`，现有 `artifact-engine-univer` 按相同合同提升；接口同时支撑 Interface、Live Artifact、Spreadsheet、Deck、Document、Diagram、Image 和 Motion。Import/export adapter 不得绕过 preflight 或直接覆盖 canonical source。

### 7.2 HTML Preview URL 抽象

不得把 `file://` 直接交给 Artifact iframe。定义 `ArtifactPreviewUrlProvider`：

- Desktop：注册 secure/standard 的 `craft-artifact://` 自定义协议；
- Headless/server：提供 token-scoped loopback/HTTP preview route；
- Web UI：使用 server route 与同一 manifest；
- 所有实现都只暴露一个 immutable artifact revision root；
- relative assets 在 root 内解析；路径 canonicalize，拒绝 `..`、symlink escape 和 absolute file URL。

### 7.3 沙箱策略

HTML/JS 预览必须：

- Node integration 关闭；
- context isolation 开启；
- sandbox 开启；
- 使用独立、非持久或 workspace 隔离 partition；
- 默认阻止外网、localhost、file、custom protocol 横向访问；
- 权限请求全部 deny；
- popup/new-window 默认 deny；
- navigation 限制在当前 immutable root；
- download 由 Host 接管；
- 注入严格 CSP；
- CPU、内存、运行时间、响应体大小有限额；
- iframe/window 来源和 `event.source` 双重验证；
- bridge 使用版本化 discriminated union，不接受任意消息；
- Artifact 切换、窗口关闭、Session 释放时彻底 dispose。

Network policy：

- `deny`：稳定默认，确保可复现；
- `allow-listed`：仅 Recipe/Run 明确域名；
- `prompt`：交互预览可临时授权，授权进入 Run Spec；
- export/review 默认不继承临时浏览授权。

### 7.4 Preview Host Bridge

受控 bridge 支持：

- ready/heartbeat；
- viewport/zoom/theme-preview（只作用于 Artifact）；
- console/error/network events；
- DOM inspection snapshot；
- element hover/select；
- comment anchor；
- tweak schema/values；
- reload request；
- navigation intent；
- screenshot coordination。

Bridge 不提供 filesystem、shell、clipboard 任意写或 Electron API。

### 7.5 多视口与设备矩阵

Render Profile 是版本化的 discriminated union，不能把所有表面硬塞进 Web viewport：

```ts
interface RenderProfileBase {
  id: string
  locale: string
  timezone?: string
}

type RenderProfile =
  | (RenderProfileBase & {
      kind: 'viewport'
      width: number
      height: number
      deviceScaleFactor: number
      colorScheme: 'light' | 'dark'
      reducedMotion: boolean
      userAgentClass: 'desktop' | 'tablet' | 'mobile'
    })
  | (RenderProfileBase & {
      kind: 'print'
      pageSize: string
      orientation: 'portrait' | 'landscape'
      margins: { top: number; right: number; bottom: number; left: number }
      dpi: number
      colorIntent?: 'screen' | 'print'
    })
  | (RenderProfileBase & {
      kind: 'workbook'
      sheetId?: string
      range?: string
      pagination: 'continuous' | 'print-pages'
    })
  | (RenderProfileBase & { kind: 'deck'; aspectRatio: string; mode: 'edit' | 'present' | 'notes' })
  | (RenderProfileBase & { kind: 'canvas'; width: number; height: number; scale: number; background: string })
  | (RenderProfileBase & { kind: 'motion'; width: number; height: number; fps: number; sampleTimes: number[] })
```

Recipe 可以给出默认 profile，用户可增加自定义 profile。Review 必须覆盖 Recipe 声明的完整矩阵。

### 7.6 Render Worker

交互 preview 与验证 render 分开：

- 交互 preview 追求即时反馈；
- Render Worker 使用 Playwright/Chromium 在固定环境中生成可信 evidence；
- worker 有队列、取消、超时、并发上限和 backpressure；
- 崩溃自动回收浏览器进程；
- 输出写入 revision-scoped immutable preview/evidence 目录；
- 相同 `(revision, profile, rendererVersion)` 命中缓存；
- 缓存损坏可重建，不是权威源。

---

## 8. 质量与评审系统

### 8.1 质量管线

```text
source/container validation
  → isolated engine boot/materialization
  → runtime/console/network/format capture
  → profile renders + engine inspection snapshot
  → deterministic validators
  → brand conformance
  → accessibility/interaction checks
  → visual model critique
  → regression comparison
  → gate decision
```

### 8.2 确定性验证

#### Render/Runtime

- HTML/CSS/JS parse/load；
- uncaught exception/unhandled rejection；
- 404/failed request/mixed content；
- infinite reload/navigation；
- missing font/image/video；
- nondeterministic external dependency；
- blank/transparent/zero-size primary surface。

#### Layout

- viewport 横向/纵向溢出；
- clipped text、zero-size interactive element；
- fixed/sticky 遮挡；
- overlap/off-canvas；
- breakpoint 断裂；
- minimum readable font；
- touch target；
- unexpected layout shift。

#### Accessibility

- Web 使用 axe-core/WCAG 基线；
- color contrast（computed style）；
- heading/landmark/label/alt；
- keyboard traversal；
- visible focus；
- reduced-motion；
- language/direction；
- dialog/menu/form semantics；
- Document/Deck 的 reading order、heading、table header、alt text、language 和 tagged-export 能力；
- Workbook 的 sheet/table naming、header association、非色彩唯一编码和图表替代说明；
- Diagram/Image 的结构化描述、阅读顺序和关键文字对比度；
- Motion 的 captions、transcript、flash threshold 和 audio-description metadata（存在音轨时）。

#### Brand Conformance

- token 使用率与硬编码颜色；
- 允许/禁止字体；
- radius/shadow/spacing/motion 规则；
- logo clear-space（有机器规则时）；
- Design Context 禁止项；
- component manifest 一致性。

#### Copy/Content

- placeholder/lorem/乱码；
- locale 漂移；
- inconsistent terminology；
- 空 CTA、虚假链接、缺失状态；
- error/empty/loading/success state coverage。

#### Data/Formula/Chart

- formula parse/error/circular reference 与 stale calculation；
- locale、timezone、currency、percentage、date 与 significant digits；
- hidden row/column/sheet 和引用范围披露；
- chart data range、axis、legend、zero baseline、aggregation 与 misleading encoding；
- CSV/TSV formula injection 与 data-only loss warning。

#### Pagination/Publication

- widow/orphan、孤立标题、页眉页脚、脚注/尾注、目录与交叉引用；
- workbook print area、repeating headers、page breaks、scaling；
- deck safe zone、speaker notes、object overflow；
- PDF/PDF-A font embedding、links、metadata、page boxes 与归档 profile；
- EPUB navigation、reading order、reflow 和 accessibility metadata。

#### Format Fidelity/Security

- feature-profile coverage 与 source/target version；
- retained/materialized/flattened/dropped/unsupported 差异；
- active content、external links、embedded object 和 remote data；
- source bytes/digest preservation；
- export 可打开性、重新导入 smoke 和 visual/semantic comparison。

#### Performance/Delivery

- 首次渲染时间、资源体积、长任务；
- external URL、data URI 和嵌入资源预算；
- standalone/export 完整性；
- print/deck page boundary；
- image/video dimensions、codec、color profile。

### 8.3 证据驱动视觉评审

视觉模型接收：

- Brief；
- selected direction；
- Design Context 摘要；
- 全部目标视口截图；
- deterministic findings；
- 前一 revision 对比；
- 结构化 rubric。

输出必须是 findings，不是自由散文；每个 finding 要有类别、严重度、截图/视口和可执行修改建议。模型不能自行把 blocker 降级。

视觉证据可能包含未发布产品、品牌手册和用户数据，因此模型路由必须满足：

- 本地/远程 provider 可替换，Design 核心不绑定供应商；
- 远程视觉评审前显示将发送的 evidence 范围，并遵循用户/provider 数据策略；
- `local-only`、credential-like、connector-derived 数据默认不出设备；
- 支持只发送裁剪截图或经过脱敏的 evidence；
- 用户关闭远程视觉评审时，确定性 validators 仍完整运行；
- Report 明确记录 `completed`、`skipped-by-policy`、`provider-unavailable`，不得把未执行伪装为通过；
- Recipe 要求视觉评审但被策略跳过时，需要用户 waiver 才能进入 ready。

### 8.4 Gate 规则

- `blocker/error` 默认阻止 `artifact_submit`；
- `warning` 允许提交，但必须在 Artifact Card/Workbench 可见；
- `suggestion` 不阻塞；
- 用户可以 waiver，但必须填写原因并绑定 revision；
- Agent 修复后重新跑受影响 validators；
- Design Context/Recipe 标记 `reviewPolicy: required` 时，不存在有效报告就不能 ready；
- 外部文件修改使旧报告 stale。

### 8.5 回归比较

- semantic DOM/a11y diff；
- screenshot perceptual diff；
- finding opened/fixed/regressed；
- token conformance diff；
- performance budget diff；
- baseline 更新需要显式用户动作，不由 Agent 自动接受。

---

## 9. 各表面引擎设计

### 9.1 Interface Prototype Engine

- 支持单文件 HTML 和真实多文件项目；
- 对真实项目支持用户声明的 dev command，不自行猜测长期进程；
- dev server 经过端口、进程、权限和生命周期管理；
- iframe/URL preview 统一进入 Host Bridge；
- 支持 desktop/tablet/mobile profiles；
- inspect/select/comment 可定位到 DOM/source hint；
- export standalone HTML/ZIP/PDF/PNG。

### 9.2 Live Artifact Engine

- `live-artifact.json` 声明 parameters、data schema、refresh policy、connector bindings；
- preview 中不直接持有 connector credential；
- Host 以受控 bridge 提供经过 schema 验证的数据；
- snapshot/export 固定数据版本，保证可复现；
- live refresh 与 design revision 分离，参数变化不伪造源码 revision。

### 9.3 Spreadsheet/Workbook Engine

- 复用并完成现有 `artifact-engine-univer` 与原生 Workbench 的集成，不另造轻量表格编辑器；
- XLSX 与 versioned Univer snapshot 都可成为 Recipe 声明的权威源，但单个 Artifact 只能有一个 canonical source；
- import/export adapter 明确覆盖公式、样式、条件格式、合并单元格、命名区域、图片、基础图表、冻结窗格、打印区域和分页；
- 公式依赖图、重算引擎版本、locale/timezone、volatile function policy 与 external-link policy 固定进 revision metadata；
- 数据清洗和公式生成属于功能能力，Design Layer 负责信息层级、表格样式、数字格式、条件视觉编码、图表选择、dashboard 布局和打印交付；
- validator 覆盖公式错误、截断/溢出、不可读列宽、低对比度、错误数字格式、误导性图表、隐藏数据、打印分页和色盲安全；
- CSV/TSV 导入导出必须显示“仅数据”提示，不携带公式、样式、图表、多 sheet 或设计上下文；
- ODS 只在经过 fixture 验证的 feature profile 内 round-trip；超出部分必须进入 Fidelity Report；
- XLSM/VBA、ActiveX、外部数据连接和 DDE 默认不执行，只允许经过哈希验证的 preserve/pass-through；
- XLSX、ODS、PDF、PNG 与 data-only CSV/TSV 均绑定同一固定 revision，打印预览必须使用实际导出路径验证。

### 9.4 Deck Engine

- 结构化 `slides.json` 是 Deck 语义权威源，HTML 是 renderer；
- 每页有 stable id、layout、content、notes、assets；
- preview 支持缩略图、键盘导航、speaker notes、present mode；
- validator 检查 overflow、safe zone、字体、图表可读性、页码和 notes；
- HTML/PDF 从同一固定 revision 生成；
- PPTX/ODP 由结构化 slide model materialize，不承诺任意 HTML 到可编辑 Office 文件的无损转换；
- PPTM/VBA 仅 preserve/pass-through，Keynote 仅通过已审计 importer 或平台 provider 转为新 Deck/参考。

### 9.5 Document Engine

- 延续“标准文件优先”：DOCX/ODT 可直接作为 source；
- HTML/Markdown/内部结构化文档作为 source 时，明确 materialize fidelity；
- preview、print layout、页眉页脚、分页、表格、字体嵌入均验证；
- PDF/PDF-A、DOCX、ODT、HTML 与 EPUB deliverable 绑定同一 revision；
- PDF 是最终版式/归档 deliverable；导入 PDF 只允许内容抽取、批注或重建为新 Document，不承诺任意 PDF 可无损回流；
- RTF、legacy DOC、Pages 经过 importer 转换时保留原件并生成 Fidelity Report；
- DOCM/VBA、OLE 和外部模板不执行，只能 preserve/pass-through；
- 不以 MarkItDown 文本预览代表视觉排版已验收。

### 9.6 Diagram/Canvas/Infographic Engine

- 统一 graph/canvas adapter contract，但不强迫 Mermaid、SVG、draw.io 和 Excalidraw 共用一个最低公分母数据模型；
- Mermaid 文本、SVG DOM、mxGraph/draw.io XML、Excalidraw scene 分别保留其 canonical source，通过 normalized inspect model 暴露 node、edge、group、page、layer 和 source hint；
- Workbench 支持 pan/zoom、selection、alignment、distribution、connector routing、layers/pages、comment anchor 和受控 direct manipulation；
- Design Context 映射 palette、typography、stroke、corner、icon 和 diagram semantic tokens；
- validator 覆盖断链、重叠、裁切、对齐、标签可读性、色彩语义、打印尺寸、复杂度和无障碍替代文本；
- SVG/PDF/PNG 从固定 revision 导出；可编辑源格式按对应 adapter 写回，不做跨格式无损承诺；
- VSDX、FigJam/Figma board 等仅在可靠 importer/provider 存在时转换为新 Artifact，否则只作为 reference/pass-through。

### 9.7 Image Engine

- 保存原图、编辑链、prompt/model/reference digest 和内容凭据；
- preview 支持透明背景、缩放、像素尺寸、色彩空间、EXIF/metadata；
- 生成与编辑继续通过可替换 image provider/skill；
- Design Context 可提供 palette、composition、logo/asset constraints；
- validator 覆盖尺寸、alpha、压缩、文字可读性、safe area、色域/ICC 和导出格式；
- PSD/AI 等分层工程文件默认只生成 flattened preview 并保留原件，不声称能编辑图层；
- 不把 provider API 封装进 Design 核心。

### 9.8 Motion/Video Engine

- 使用结构化 composition manifest + deterministic timeline；
- HTML/CSS/Canvas/WebGL runtime 作为可替换实现；
- preview 与离线 render 使用相同时间轴定义；
- 禁止未固定 seed/time/source 的 nondeterminism；
- FFmpeg/Chromium worker 受资源、超时和取消控制；
- validator 在关键帧和采样点检查 overflow、blank frame、音轨、字幕、时长、codec；
- MP4/WebM/GIF/animated WebP/image sequence/poster frame 为 revision-bound deliverables；
- Lottie JSON 只有在 composition 使用兼容的 vector/timeline 子集时才可作为 editable/export format，否则报告 flattened/unsupported features。

### 9.9 Design System Engine

- 从 folder/Git/GitHub URL/现有项目 tokens/网站证据导入；
- importer 输出草稿 package 和 audit report，不直接标记 trusted；
- 支持 token preview、component fixture、字体/资产、source evidence；
- `DESIGN.md` 与 token contract 双向一致性检查；
- 可从 selected Direction 提升；
- 可打包、版本、回滚和分享。

### 9.10 Existing Code Refresh

- 绑定现有 working directory；
- 先审计框架、组件、tokens、测试和 build command；
- Design Context 映射到真实 token/component 层；
- 以 Git diff/Artifact review 呈现修改；
- 运行现有项目的最小相关测试和设计验证；
- 不把完整仓库复制到 managed artifact store；Run Spec 固定 git state/diff base。

---

## 10. UI 与交互

### 10.1 入口

不新增永远占据顶栏的“Studio”孤立入口。设计能力从以下位置进入：

- Session composer 的 Design action/Recipe picker；
- Project 的默认 Design Context；
- Artifact Card 的 Open/Review/Revise；
- Files 中打开可设计 Artifact；
- Design Context/Recipe 管理页；
- Automation/Work Item 的结构化 Design Brief。

### 10.2 Artifact Workbench 目标形态

Design Artifact 继续是 Workbench `artifact/<id>` tab。内部提供：

- **Canvas**：真实交互预览；
- **Source**：源码/文件树/外部编辑入口；
- **Inspect**：按引擎显示 DOM、cell/formula、slide object、document block、node/edge、layer、tokens 和 computed properties；
- **Review**：findings、证据、waiver、修复状态；
- **Versions**：revision、context/recipe/version diff；
- **Deliverables**：导出状态、格式能力等级、Fidelity Report、活动内容警告、打开/下载；
- **Brief**：运行目标、方向、约束和 references。

顶部控制：

- viewport/profile；
- zoom/fit；
- interaction/inspect/comment mode；
- refresh/render；
- compare revision；
- review status；
- submit/accept/discard/export。

格式选择器按用途而不是扩展名堆叠：继续编辑、跨套件协作、网页发布、打印/归档、图片交付、视频交付和纯数据交换。导入或导出发生 flatten、drop、security disable 时，Workbench 在操作前后都显示可定位差异；严重不保真必须显式确认并默认写入新文件。

Fullscreen 复用现有 Workbench expanded item；不创建第二个编辑器实例。

### 10.3 Design Context 管理

Project Settings/全局管理页需要：

- 搜索、来源、scope、license、brand relationship、trust 筛选；
- package 预览；
- DESIGN.md/tokens/components/source evidence；
- install/update/rollback/delete；
- project default binding；
- license/asset 警告；
- OpenDesign compatibility import。

### 10.4 Recipe 管理

- 与 Skills 分页/分区；
- 按 surface/scenario/platform/output 筛选；
- 展示依赖 Skills、Context capabilities、validators/exporters；
- built-in 可查看不可原地修改；编辑先 fork 到 user scope；
- recipe 更新不会改变历史 Artifact。

### 10.5 状态与恢复

- Workbench route 继续只存 artifact id；
- Design 内部 tab/viewport/compare state 可窗口级持久化；
- Design Run、Review、Deliverables 是服务端/共享存储权威；
- 刷新、重连和跨窗口均从 RPC 重建；
- Renderer localStorage 不作为 Design 数据库。

---

## 11. 持久化、并发与崩溃恢复

### 11.1 逻辑存储

精确物理路径由统一 path helper 决定，领域上分为：

- Design package registry；
- Recipe registry；
- Run specs；
- render cache/evidence；
- review reports；
- format capability snapshots、Fidelity Reports 与 active-content inventories；
- export jobs/deliverables；
- trust/license audit records。

不得把上述内容散落进 renderer localStorage 或任意 working directory 隐藏目录。

### 11.2 原子性

- package install：stage → validate → digest → atomic publish；
- import/render/review/export：job record → temp output → validate → atomic attach；
- destructive-risk conversion：preflight → confirmation/waiver → write-new-file → digest verify；
- Report 和 deliverable 只有完成后挂到 Artifact；
- 中断 job 保留诊断但不伪装成功；
- startup 清理孤儿 temp，并恢复可恢复队列；
- store 文件全部 versioned schema + atomic write。

### 11.3 并发

- 相同 Artifact revision 的相同 render key 去重；
- per-artifact mutation 仍走 lease/CAS；
- render/review 可并发读取 immutable revision；
- export 同一 key 去重；
- Design Context update 不锁死使用旧 version 的运行；
- daemon-wide worker pool 有明确并发上限和优先级；
- interactive preview 优先于后台批量截图。

### 11.4 生命周期

- Session 关闭不删除 Artifact/Run；
- Artifact discard 不立即删除 evidence，按 retention policy 回收；
- package version 只要仍被引用就不能 GC；
- workspace 删除/归档沿用 workspace 策略；
- Browser/FFmpeg/dev server 子进程都注册 owner scope 和 shutdown hook。

---

## 12. 来源、许可证与品牌边界

### 12.1 三类分发策略

| 类型 | 可以随 CraftAgent 分发 | 要求 |
|---|---|---|
| Built-in | 是 | 原创或明确 Apache/MIT；完整审计 |
| Installable Community | 按包许可 | 来源、作者、license、revision、attribution |
| Local Reference | 否，默认本地 | 用户导入；不得自动上传或再分发 |

### 12.2 `DESIGN.md` 的处理

- `DESIGN.md` 是系统核心输入，不等同于 Logo/字体/图片；
- OpenDesign 原创且 Apache-2.0 覆盖的文件可在保留许可、署名、修改说明后移植；
- 品牌观察类文件标记 `brandRelationship: inspired`，不得声称官方；
- 颜色、布局规律等事实/方法可以重写吸收；不批量复制来源不明的表达；
- 品牌官网全文、官方组件源码、专有字体和图像资产不能因“非盈利”自动进入内置包。

### 12.3 Asset policy

每个 asset/font 都记录独立 license。以下默认拒绝进入 built-in：

- `Original X post` 或许可不明；
- 未授权品牌 Logo；
- 专有字体二进制；
- 官网摄影/插画/营销图；
- 无来源缩略图；
- 限制衍生或再分发但未隔离的内容。

允许在本地引用但导出时需确认的内容标记 `local-only`。导出器必须生成 attribution manifest，并阻止误打包受限资产。

### 12.4 Trust 与 License 分离

- `trusted` 表示执行安全审核，不代表版权清晰；
- `redistributable` 表示许可允许，不代表脚本安全；
- package 必须同时通过 trust policy 和 license policy 才能作为 built-in；
- imported package 初始为 `untrusted/unreviewed`。

---

## 13. OpenDesign 兼容与吸收边界

### 13.1 兼容导入

实现显式 importer：

- `od-design-system-project/v1` → `craft-design-context/v1`；
- OpenDesign `SKILL.md` 的 `od.mode/surface/preview/design_system/craft/critique` → Design Recipe 草稿；
- 保留原始 source、commit、license 和未识别字段；
- importer 只转换，不自动信任、不自动内置；
- 缺失许可证或 asset provenance 时降级为 local-only。

### 13.2 可以选择性移植

- schema/parser/validation 思路；
- `DESIGN.md` package 组织；
- Skill 与 rendering template 分离；
- universal craft rule 分类；
- 少量许可明确、质量通过的 rule/recipe，经重写和审计后进入 built-in；
- sandbox bridge、critique、export 的设计经验。

### 13.3 不移植

- OpenDesign daemon、Next.js Web、Electron shell；
- CLI runtime registry 和多 Agent adapters；
- BYOK proxy/media provider proxy；
- OpenDesign marketplace/runtime；
- 整个 151+ Design System/100+ Template/Prompt 目录；
- Critique Theater 的 XML 流协议和虚假单分数；
- 许可不清晰的 prompt、缩略图、字体和品牌资产。

---

## 14. RPC、Headless、Web 与 CLI

### 14.1 共享合同

Design DTO/event schema 必须位于共享纯 TypeScript 层，不由 Electron renderer 自行发明。至少包括：

- context/recipe records；
- brief/run spec；
- render job/progress/result；
- review report/finding；
- export job/deliverable；
- engine/format capability negotiation 与 feature profiles；
- import/preflight/Fidelity Report/active-content inventory；
- package/import/audit errors。

### 14.2 RPC

新增明确 channel group：

- `design.contexts.*`
- `design.recipes.*`
- `design.runs.*`
- `design.render.*`
- `design.review.*`
- `design.formats.*`
- `design.import.*`
- `design.export.*`

所有 mutation 做 workspace/session/artifact ownership 检查并广播变更。大文件不通过 JSON RPC 内联，使用受控 path/stream/protocol URL。

### 14.3 Headless/server

- Render Worker 与 validation 在 server-core 可运行；
- 不依赖 Electron renderer DOM 才能生成 screenshot/PDF；
- server 公布 engine/capability；
- thin desktop client 只显示 server 可提供的 preview；
- remote workspace path 不传给客户端当作本地路径打开。

### 14.4 Web UI

- 可以查看 Artifact、preview、review、deliverables；
- 交互 preview 通过 server token-scoped route；
- 不支持的本地编辑能力显式标注，不伪装可用；
- accept/discard/review waiver 保持权限一致。

### 14.5 CLI

完整能力需要机器可用接口：

```text
craft design contexts list|show|import|audit
craft design recipes list|show
craft design runs show
craft design formats list --surface ...
craft design import <file> --surface ... --preflight
craft design render <artifact>
craft design review <artifact>
craft design preflight <artifact> --format ...
craft design export <artifact> --format ...
```

CLI 调同一 server-core/RPC 业务逻辑，不另写平行实现。

---

## 15. 迁移与兼容

### 15.1 Artifact store

- 扩展 Artifact 的通用 `workflowRef/provenanceRef` 和多 validation/report 摘要；
- store schema 升级必须可逆读取旧版，原子迁移；
- 现有 HTML Artifact 首次打开时按需产生真正 `html` preview，不重写历史 revision；
- 现有 text preview 保留，作为 Source tab，而非 Canvas；
- 现有 Univer Artifact 保持原 snapshot 可读；首次设计打开只补 capability/provenance metadata，不自动改写为 XLSX/ODS；
- 历史 DOCX/PDF/PPTX/image 文件默认先作为 existing-file Artifact/reference，只有用户发起编辑/转换才创建 Design Run 与 Fidelity Report；
- 未识别的专有文件始终保留原始 bytes/digest，迁移不得批量 flatten 或覆盖。

### 15.2 Skills

- 现有 Skill API/路径/优先级保持兼容；
- `SkillMetadata` 可保留 namespaced extension 原始数据，但 Design Recipe 不依赖 Skill UI 解释 `od:`；
- 提供显式“Convert/import as Design Recipe”，不在扫描时偷偷重分类用户 Skills；
- task skill prerequisites 与 design prerequisites 共享机制。

### 15.3 Project

`ProjectConfig` 增加 versioned design binding：

```ts
design?: {
  defaultContextId?: string
  defaultRecipeBySurface?: Partial<Record<DesignSurface, string>>
  defaultReviewPolicy?: ReviewPolicy
}
```

缺失字段表示无默认 Design Context；不对旧项目自动选择风格。

### 15.4 Theme

- 不迁移应用 `colorTheme` 为 Design Context；
- 可提供显式工具把 Theme tokens 复制为一个新的用户 Design Context 草稿，但必须由用户确认；
- 两套 schema、目录、UI、CSS 注入始终分离。

### 15.5 OpenDesign 内容

- 不将 OpenDesign clone 作为运行时依赖；
- import 记录 source commit；
- 内置候选逐包审计、重写和测试；
- attribution 汇总进 CraftAgent `NOTICE`/第三方清单和包内 metadata。

---

## 16. 测试体系

### 16.1 单元与属性测试

- manifest/brief/run/report schema；
- format capability/Fidelity Report schema 与 feature-profile negotiation；
- digest、precedence、shadowing、pinning；
- path traversal/symlink/canonicalization；
- license/trust policy；
- package install atomicity；
- cache key/invalidation；
- review gate/waiver；
- migration round-trip；
- RPC ownership；
- tool permission classification。

### 16.2 引擎合同测试

每个 Design Engine 必须通过相同 contract suite：

- render immutable revision；
- cancellation/timeout；
- cache correctness；
- invalid input；
- crash cleanup；
- deterministic output metadata；
- format preflight、Fidelity Report 和 active-content policy；
- deliverable attaches to correct revision；
- stale result cannot attach after new revision；
- headless capability。

### 16.3 安全测试

- `file://`/localhost/metadata IP/内网访问；
- path traversal、symlink escape、encoded traversal；
- popup/navigation/download；
- permission requests；
- bridge forged source/origin/message；
- CSP bypass；
- service worker/storage persistence；
- oversized asset/decompression bomb；
- infinite loop/high CPU/memory；
- malicious DESIGN.md/SKILL.md；
- DOCM/XLSM/PPTM、VBA/ActiveX/OLE/DDE、外部连接和公式注入；
- malformed OOXML/ODF/SVG、XML entity expansion、archive nesting；
- export 中 local-only asset 泄漏。

### 16.4 Golden fixtures

建立许可清晰的自有 fixture corpus：

- responsive web；
- mobile app；
- live dashboard；
- workbook：公式/样式/图表/多 sheet/打印区域/round-trip；
- deck；
- editorial document；
- diagram/canvas：node/edge/layer/multipage/export；
- image；
- motion；
- good/bad accessibility；
- overflow/overlap/font/network failures；
- brand token pass/fail；
- malicious packages。
- DOCX/XLSX/PPTX/ODT/ODS/ODP feature-profile 与活动内容 fixtures；
- 许可清晰的 SVG/Mermaid/draw.io/Excalidraw 格式 fixtures。

视觉 golden 使用：

- 固定 Chromium/font bundle；
- perceptual threshold；
- DOM/a11y semantic assertions；
- 人工批准 baseline 更新；
- OS 特有差异单独记录，不用无限放宽阈值掩盖回归。

### 16.5 集成与 E2E

必须覆盖：

1. create brief → select context/recipe → generate；
2. Artifact Card → Canvas → Review；
3. finding → revise → re-review；
4. ready → accept；
5. external conflict；
6. context update 后旧 Artifact 仍复现；
7. crash/restart/reconnect；
8. remote/headless render；
9. Web UI view/review/accept；
10. multi-window state；
11. import/audit/rollback/delete protection；
12. every promised native/round-trip/import/export/pass-through format path；
13. spreadsheet formula/style/chart round-trip 与 CSV data-only warning；
14. diagram editable-source save 与 SVG/PDF/PNG export；
15. Fidelity Report 的确认、取消、另存与 recovery；
16. macro-bearing document/workbook/deck preserves bytes but never executes active content；
17. Windows/macOS/Linux packaged smoke。

### 16.6 设计质量基准

固定 benchmark briefs，覆盖全部表面与中英文：

- 无品牌 / 有品牌；
- 内容稀疏 / 内容密集；
- desktop/mobile/responsive；
- 数据可视化；
- 高密度 workbook、打印报表与多 sheet dashboard；
- 流程图、架构图、whiteboard 与 infographic；
- accessibility；
- existing code refresh；
- offline/no-network；
- 多格式交付；
- 往返编辑与降级/保留场景。

同时记录：首轮 blocker/error 数、修订轮数、render/export 成功率、耗时、token/模型成本和人工接受率。模型升级和 prompt/recipe/context 修改都必须重跑可比基准。

---

## 17. 性能与可靠性预算

最终数值应在 Phase 0 通过基线设备冻结；建议初始预算：

| 指标 | 目标 |
|---|---:|
| 已缓存 HTML Canvas 首次可见 | ≤ 500 ms |
| 未缓存本地 HTML Canvas 可交互 | ≤ 1.5 s |
| 单 viewport screenshot | ≤ 3 s |
| 标准 4 viewport deterministic review | ≤ 15 s（不含视觉模型） |
| 10 MB 标准 workbook 首次可编辑 | ≤ 3 s，超过预算进入分块/只读降级 |
| 1,000-node 标准 diagram 首次可交互 | ≤ 2 s |
| Office/ODF round-trip preflight | ≤ 10 s（标准 fixture） |
| Workbench 非活动 Artifact renderer | 0 个挂载实例 |
| renderer 空闲后资源回收 | ≤ 30 s |
| preview worker crash 恢复 | 不损坏 Artifact；下一任务可继续 |
| cancel acknowledgement | ≤ 1 s |
| built-in package audit coverage | 100% |
| stable recipe offline render/export | 100% |

另设：

- app 安装体积预算；
- Chromium/FFmpeg/font bundle 复用策略；
- render cache 上限与 LRU/retention；
- per-job memory/CPU/time budget；
- large artifact degradation；
- remote bandwidth/preview compression。

---

## 18. 可观测性与诊断

本地结构化事件：

- `design.run.*`
- `design.render.*`
- `design.review.*`
- `design.export.*`
- `design.package.*`
- `design.format.*`
- `design.fidelity.*`

每个 job 记录：

- job/run/artifact/revision id；
- engine/version/profile；
- queue/start/end/cancel/timeout；
- cache hit；
- sanitized error code；
- resource usage；
- evidence/output paths（内部日志）；
- model cost/latency（有视觉评审时）。

Diagnostics export 必须默认去除：

- source file body；
- screenshot；
- Design Context proprietary content；
- credential/header；
- user reference assets。

用户主动选择后才可附加敏感 evidence。

---

## 19. 实施分解

以下阶段全部属于稳定版必需路线。阶段完成表示其合同达到可合并状态，不表示产品已经完整发布。

### Phase 0：架构冻结与基线

目标：先冻结最终合同、威胁模型、来源政策和质量基准。

- ADR：Design 定位、Artifact 集成、Theme 隔离、engine interface；
- `DesignSurface`、package/recipe/brief/run/review、Format Capability 与 Fidelity Report schema；
- storage/registry/precedence；
- preview threat model；
- license/trust policy；
- benchmark corpus 与性能基线；
- OpenDesign 候选内容清单和审计模板；
- 跨 desktop/headless/web capability matrix；
- 格式 feature profiles、活动内容策略与“不支持”声明清单。

退出条件：核心 DTO、文件布局、状态机、安全边界和迁移策略通过评审；禁止边写 UI 边改变领域定义。

### Phase 1：领域与持久化基础

- `packages/design-core` 或等价纯 TS 合同层；
- Design Context/Recipe registry；
- engine/format capability registry 与 feature-profile negotiation；
- package validate/digest/install/update/tombstone；
- Run/Review/Job stores；
- Artifact generic provenance/workflow ref；
- Project design binding；
- RPC/event/tool skeleton；
- schema migration、atomicity、watch/cache；
- license/trust audit records；
- Fidelity Report、active-content inventory 与 confirmation state 持久化。

退出条件：无 UI 也能通过 API/CLI 完成 package → run → artifact binding，并能跨重启恢复。

### Phase 2：安全预览与 Render Worker

- `artifact-engine-html`；
- `craft-artifact://`/server preview URL provider；
- sandbox partition/CSP/navigation/network/permission policy；
- Host Bridge；
- interactive Canvas；
- Playwright Render Worker；
- multi-viewport profiles；
- screenshot/DOM/console/network evidence；
- cache、queue、cancel、timeout、crash cleanup；
- desktop/headless/server parity。

退出条件：恶意 fixture 安全测试通过；HTML Artifact 不再只是文本预览；固定 revision 可稳定复现。

### Phase 3：Design Context、Recipe 与 Agent 组合

- Design Context 管理/import/create/update/rollback；
- Recipe 管理及 Skill 引用；
- Design Brief/Direction Set；
- resolver 与 precedence；
- prerequisites/prompt composition；
- universal rule registry；
- OpenDesign importer；
- Project/Session/Run binding；
- package detail/preview/provenance UI。

退出条件：任何设计运行都有完整、固定、可审计上下文；常规非设计 Session 不承担 prompt 成本。

### Phase 4：完整 Artifact Workbench 体验

- Canvas/Source/Inspect/Review/Versions/Deliverables/Brief；
- viewport/zoom/interaction/inspect/comment；
- element selection 与 source hint；
- 受控 direct manipulation：文本、token、允许的 style/property tweak 生成可审阅 patch，不直接修改已接受 revision；
- revision/context/recipe compare；
- Artifact Card 质量摘要；
- revise/submit/accept/discard/export；
- 用途导向格式选择、Fidelity Report diff、活动内容与 data-only warning；
- reconnect/multi-window/fullscreen；
- Web UI view/review/accept 基础完整性。

退出条件：从 Session 到 Artifact 审阅交付不需要跳出 CraftAgent；状态恢复无 renderer-local truth。

### Phase 5：质量门与视觉评审

- deterministic validator 全套；
- brand conformance；
- a11y/keyboard/reduced motion；
- copy/state/performance/delivery；
- visual evidence critique；
- finding lifecycle、waiver、regression；
- submit gate；
- benchmark dashboard/report；
- required/recommended/manual policy。

退出条件：稳定 Recipe 无有效 Report 不能错误进入 ready；findings 可复现、可定位、可审计。

### Phase 6：全表面引擎与交付

- Interface Prototype 完整 export；
- Live Artifact manifest/data bridge/snapshot；
- Spreadsheet/Workbook：Univer、XLSX/ODS feature profiles、公式/图表/打印验证、CSV/TSV data-only、PDF/PNG；
- Deck：structured model、preview/notes、PPTX/ODP round-trip profile、PDF/HTML；
- Document：分页/印刷预览、DOCX/ODT round-trip profile、PDF/PDF-A/HTML/EPUB；
- Diagram/Canvas：SVG/Mermaid/draw.io/Excalidraw adapters、画布交互、SVG/PDF/PNG；
- Image：provenance/edit、色域/metadata、web/print format validation；
- Motion：timeline/preview、Lottie compatibility、FFmpeg 多格式 export；
- Design System package export/share；
- Existing Code Refresh/dev server/diff integration；
- Office/ODF/graphics adapter 的 Fidelity Report、active-content inventory 与 preserve/pass-through。

退出条件：第 2 节表面和格式矩阵全部有可查询 capability；每项承诺的 native/round-trip/import/export/pass-through 路径都有生产 adapter、validator 和 E2E；不支持项在 UI/RPC 中明确拒绝，不存在只有 UI 占位或以截图冒充往返编辑的表面。

### Phase 7：互操作、自动化与生态

- OpenDesign package/recipe batch import with audit；
- folder/Git/GitHub/website/project importers；
- Automation/Work Item Design Brief；
- CLI 完整命令；
- remote/headless capability；
- user package fork/update/share；
- attribution manifest/NOTICE 汇总；
- package compatibility/version policy。
- optional official/provider connector adapters（只提升经过验证的平台格式能力，不成为核心运行依赖）。

退出条件：本地、远程、自动化和生态导入共享同一业务合同。

### Phase 8：稳定化与发布候选

- 全 schema migration 与 downgrade/read compatibility；
- corrupted store/package/cache recovery；
- long-run resource/leak tests；
- large artifact/performance degradation；
- Windows/macOS/Linux packaged smoke；
- threat model复审和安全回归；
- built-in content 100% provenance/license audit；
- format feature-profile/round-trip fixture audit；
- benchmark 和预算达标；
- user docs、authoring docs、troubleshooting、recovery；
- feature flag/rollout/rollback。

退出条件：满足第 20 节稳定版发布门，才可把功能标为 stable。

---

## 20. 稳定版发布门

### 20.1 功能完整性

- 第 2 节全部表面通过 production E2E；
- 格式 capability registry 与实际 adapter 一致，每项 feature profile 有机器可读测试证据；
- native-source、round-trip、import-only、export-only、preserve/pass-through 的 UI/RPC 行为无歧义；
- package/recipe/run/review/export 全生命周期完整；
- desktop/headless/Web/CLI 能力矩阵无未说明缺口；
- existing Artifact/Skill/Theme/Project 无破坏性回归。

### 20.2 安全

- threat model 全项有实现和测试；
- HTML/JS/package 无直接 Node/filesystem/credential 通路；
- 路径、网络、bridge、popup、permission、resource-exhaustion 测试通过；
- imported package 默认不可信；
- 无 local-only asset 静默外泄；
- Office 宏、ActiveX、OLE、DDE、外部连接和不可信 SVG/媒体默认不执行；preserve 不会隐式变成 execute。

### 20.3 数据与恢复

- crash/restart/cancel/reconnect 不损坏 Artifact；
- stale import/render/review/fidelity/export 不能挂到新 revision；
- schema migration 在真实旧 workspace fixture 通过；
- package version pinning 和 delete protection 通过；
- cache 全删后可重建。

### 20.4 质量

- built-in Recipe benchmark 无 blocker；
- required profiles 无 runtime/overflow/a11y error；
- export 格式全部可打开且绑定正确 revision；
- round-trip golden fixtures 在声明的 feature profile 内无未报告丢失；
- 任意 materialized/flattened/dropped/unsupported/security-disabled 项都进入 Fidelity Report；
- CSV/TSV 等 data-only 路径不会被描述为保留工作簿设计；
- 视觉评审失败可降级为明确状态，不阻塞确定性报告读取；
- benchmark 相对当前 CraftAgent 在人工接受率、修订轮数或错误率上有可量化提升。

### 20.5 来源与许可

- built-in package/recipe/rule/assets/fonts 100% 有来源、license、attribution 和审核记录；
- 品牌包标明 official/inspired/user-owned；
- 无许可不明素材进入安装包；
- Apache/MIT/CC 等义务进入 NOTICE/包内许可证/导出 attribution。

### 20.6 跨平台与性能

- macOS arm64/x64、Windows x64、Linux 支持线完成 packaged smoke；
- headless render/export 有稳定运行环境；
- 第 17 节冻结预算全部达标或有书面例外；
- 8 小时混合 preview/render/review/export soak 无不可回收泄漏。

---

## 21. 依赖关系与并行边界

```text
Phase 0 contracts
   ├── Phase 1 domain/store/RPC
   │      ├── Phase 3 context/recipe/agent
   │      └── Phase 7 CLI/automation/import
   └── Phase 2 secure renderer
          ├── Phase 4 Workbench
          ├── Phase 5 review system
          └── Phase 6 surface engines/export

Phase 3 + 4 + 5 + 6 + 7
             └── Phase 8 stabilization/release
```

可并行：

- package/schema 与 renderer threat-model prototype；
- quality rule authoring 与 UI shell；
- Spreadsheet、Deck/Document、Diagram、Image/Motion adapter 在领域合同和各自 renderer contract 稳定后分轨；
- built-in content 审计与引擎开发；
- Web/CLI 客户端在 RPC contract 冻结后分轨。

不可并行绕过：

- 未冻结 Run/Review/Package schema 就大规模写 UI；
- 未完成 sandbox 就展示可执行 HTML；
- 未建立 revision pinning 就做 render/export cache；
- 未建立 provenance policy 就批量导入 OpenDesign 内容；
- 未有结构化 Deck model 就承诺可编辑 PPTX/ODP；
- 未完成 XLSX/ODS feature-profile golden suite 就承诺 workbook round-trip；
- 未完成 Fidelity Report 就开放会丢信息的转换或覆盖原文件；
- 未完成 active-content isolation 就读取宏、外部连接或嵌入对象。

---

## 22. 工作量级与人员建议

这是一个完整产品能力层，不是单一 feature。粗略量级（不作为排期承诺）：

| 工作流 | 工程周 |
|---|---:|
| 合同、格式能力、存储、迁移、RPC | 8–12 |
| 安全 renderer/worker/bridge | 8–12 |
| Context/Recipe/Brief/Agent | 6–9 |
| Workbench/多引擎 Inspect/格式与恢复 UI | 8–12 |
| validators/visual review/fidelity corpus | 10–15 |
| Interface/Live Artifact engines 与 export | 6–10 |
| Spreadsheet/Univer/Office-ODF round-trip | 10–16 |
| Deck/Document/Office-ODF round-trip | 12–18 |
| Diagram/Image/Motion engines 与 export | 12–19 |
| import/CLI/headless/automation/connectors | 6–10 |
| hardening/cross-platform/docs | 10–15 |
| 合计（各项已按现有能力复用估算） | 96–148 工程周 |

建议配置：

- 1 名架构/领域负责人；
- 1 名 Electron/安全渲染工程师；
- 1 名 Artifact/Server/Worker 工程师；
- 1 名 React/Workbench 工程师；
- 1 名 document/spreadsheet/format interoperability 工程师；
- 1 名设计工程与 design-quality 负责人；
- QA/安全/内容许可可阶段性或共享投入。

建议 4–6 名有经验工程师组成核心团队；考虑依赖冻结、跨平台回归和格式 corpus 建设，完整稳定版本更现实的日历周期是约 9–15 个月。单人完成应按多年维护项目看待。这里的“全面”指全部一等表面、可扩展格式合同和诚实的保真等级，不等于自行重写 Photoshop、Figma 或 Office，也不承诺所有专有格式无损往返。

---

## 23. 第一批需要冻结的决策

实施前必须逐项形成 ADR：

1. `craft-design-context/v1` 与 `craft-design-recipe/v1` schema；
2. Design Run/Review 的存储位置与 Artifact generic ref；
3. Desktop preview 使用 custom protocol + sandbox iframe，或受控 WebContentsView；
4. Headless preview server 和 token 模型；
5. fixed Chromium/font environment；
6. visual review provider 抽象与无视觉模型降级；
7. 五级 Format Capability、feature profile 与 Fidelity Report contract；
8. Workbook canonical source、Univer/XLSX/ODS round-trip 和公式重算合同；
9. Deck structured model 与 PPTX/ODP fidelity contract；
10. Document canonical source 与 DOCX/ODT/PDF-A/EPUB materialization contract；
11. Diagram adapter contract 与 SVG/Mermaid/draw.io/Excalidraw source ownership；
12. Motion runtime/FFmpeg/Lottie 打包策略；
13. Office macro/active-content preserve-only 与外部连接策略；
14. package trust/license/local-only policy；
15. built-in 内容范围与 OpenDesign 审计名单；
16. stable 发布是否要求全部十类表面同时 GA，或允许按表面分别 stable；
17. 安装体积、render 性能、模型成本与大型 workbook/canvas 预算。

其中第 16 项只决定发布标记方式，不改变本计划的最终架构和完整能力范围。

---

## 24. 最终验收场景

完整稳定能力至少要让以下场景成立：

1. 用户给出一个模糊 Web brief，系统补齐关键约束、提出方向、绑定 Design Context，生成响应式 Prototype；
2. Artifact 在桌面/平板/手机真实渲染，自动发现溢出、对比度和控制台错误；
3. 用户点击某元素评论，Agent 定位源码修订；
4. 修订后 findings 关闭，旧 revision/report 仍可回放；
5. 用户导出 standalone HTML、PDF 和多视口 PNG，全部绑定被接受 revision；
6. Project 更新 Design Context 后，旧 Artifact 仍按旧 digest 复现，新 Artifact 使用新版本；
7. 用户导入一个 OpenDesign 品牌包，系统保留来源并因许可不明标记 local-only，而不是静默内置；
8. 用户创建多 sheet Workbook，公式、数字格式、条件格式和图表可编辑，XLSX/ODS round-trip 在声明 profile 内通过，PDF/PNG 打印交付与预览一致；
9. 用户导出 CSV/TSV 时收到 data-only 提示，不会误以为公式、样式、图表和多 sheet 被保留；
10. 用户制作 Deck，获得播放预览、缩略图、notes、PDF，以及在声明 fidelity profile 内可编辑的 PPTX/ODP；
11. 用户制作 Editorial Document，可在 DOCX/ODT 主文件上继续编辑，并生成同 revision 的 PDF/PDF-A/HTML/EPUB（Recipe 适用时）；
12. 用户制作架构图或 infographic，保留 Mermaid/SVG/draw.io/Excalidraw 对应可编辑源，并导出 SVG/PDF/PNG；
13. 用户用同一 Design Context 生成 Workbook、Deck、Document、Diagram、Image 和 Motion，品牌约束一致但各引擎使用自己的语义模型；
14. 用户导入含宏的 XLSM/DOCM/PPTM，系统报告活动内容、原样保留但不执行；无法安全写回时强制另存；
15. 用户把 PDF、PSD、AI、Keynote 或 Numbers 用作输入时，系统明确显示 import-only/flattened/pass-through，不冒充无损编辑；
16. 任一跨格式转换产生 Fidelity Report；发生 dropped、unsupported 或 security-disabled 项时，用户可取消、另存或明确接受；
17. Automation 在 headless server 生成、review、导出 Artifact，桌面客户端稍后连接即可审阅接受；
18. 恶意 HTML、SVG、Office/ODF、package、网络请求和 prompt-injection fixture 不能突破文件、网络、权限或 credential 边界；
19. 应用崩溃重启后，draft、Run Spec、review、fidelity/export job 和 Workbench 路由都能恢复到可信状态。

达到这些场景，Design 才算成为 CraftAgent 的原生系统能力，而不是一组设计提示词或模板。

---

## 25. 预计代码落点

最终目录名由 Phase 0 ADR 冻结，但职责边界应落在以下位置，不允许再次收拢成单个巨型模块。

### 25.1 新增包/模块

| 位置 | 职责 |
|---|---|
| `packages/design-core/` | 纯 TypeScript schema、digest、package/recipe parser、review/gate 纯逻辑；不得依赖 Electron/Node UI |
| `packages/artifact-engine-html/` | HTML manifest、render/inspect/export engine、worker contract、deterministic validators |
| `packages/artifact-engine-deck/` | structured slide model、HTML renderer、notes、PPTX/ODP/PDF adapters |
| `packages/artifact-engine-document/` | 分页/连续排版、DOCX/ODT/HTML source adapters、PDF-A/EPUB materialization |
| `packages/artifact-engine-diagram/` | normalized inspect contract 与 SVG/Mermaid/draw.io/Excalidraw adapters |
| `packages/artifact-engine-media/` | image metadata/edit-chain 与 motion composition/FFmpeg export contracts；实现可再按依赖拆包 |
| `packages/artifact-format-office-odf/` | 隔离的 OOXML/ODF import/export、feature profiles、active-content inventory、Fidelity Report；不得执行宏 |
| `packages/shared/src/design/` | workspace/project 持久化、registry roots、atomic stores、migration、browser-safe exports |
| `packages/server-core/src/services/design/` | run orchestration、worker queue、resolver、review/export jobs、capability registry |
| `packages/server-core/src/handlers/rpc/design/` | contexts/recipes/runs/render/review/export RPC 与 ownership 校验 |
| `packages/session-tools-core/src/handlers/design.ts` | Agent design tools 的稳定定义和 handler adapters |
| `apps/electron/src/main/design-preview/` | custom protocol、partition、安全策略、Host Bridge、生命周期与 bounds integration |
| `apps/electron/src/renderer/components/design/` | Context/Recipe library、Brief/Direction、Inspect/Review/Deliverables UI |
| `apps/electron/src/renderer/components/design-workbench/` | Canvas/Source/Inspect/Review/Versions/Brief/Deliverables 内部编排 |
| `apps/webui/src/design/` | remote/headless preview、review、deliverables 和 capability-aware UI |
| `apps/cli/src/commands/design/` | 调用同一 RPC 的 design CLI |

如果 `packages/design-core` 与现有 `packages/core` 的边界评审后适合合并，可以并入 core；但纯合同不得依赖 server、filesystem、Electron 或 renderer。

### 25.2 需要扩展的现有模块

| 现有位置 | 计划变更 |
|---|---|
| `packages/shared/src/artifacts/types.ts` | generic workflow/provenance ref、review summary、engine capability；不塞入完整 Design Run |
| `packages/shared/src/artifacts/storage.ts` | store migration、HTML preview kind、report/deliverable attach 的 revision 校验 |
| `packages/shared/src/projects/types.ts` | versioned project design defaults |
| `packages/shared/src/skills/types.ts` | namespaced extension 保真；保持 Skill 与 Recipe 分离 |
| `packages/shared/src/agent/core/prerequisite-manager.ts` | Design Context/Recipe/rule prerequisites |
| `packages/artifact-engine-univer/` | 提升为一等 Workbook engine：versioned snapshot、XLSX/ODS adapters、formula/print/chart validators、headless parity |
| `packages/server-core/src/services/univer-artifact.ts` | 统一接入 Design Run/Review/Export 和 revision-bound workbook job；不复制 format policy |
| `packages/server-core/src/sessions/SessionManager.ts` | session/run binding、tool callbacks、Artifact event summary、生命周期 cleanup |
| `packages/server-core/src/tasks/TaskRunner.ts` | Automation/Task Design Brief 和 prerequisites，不复制运行逻辑 |
| `apps/electron/src/renderer/components/content-panels/ArtifactWorkbench.tsx` | 提取为 engine-aware shell，Design Workbench 作为 adapter |
| `apps/electron/src/renderer/components/content-panels/FilePreviewContent.tsx` | HTML 从 source-code fallback 升级为真正 engine preview；保留 Source view |
| `apps/electron/src/renderer/atoms/workbench.ts` | 只增加 artifact 内部恢复所需的最小窗口状态，不存业务真相 |
| `apps/electron/src/main/window-manager.ts` | design preview view 的安全挂载、窗口销毁和 bounds lifecycle |
| `apps/electron/src/shared/types.ts` / RPC channel map | capability、event、bridge 的版本化合同 |
| `scripts/electron-build-resources.ts` | 审计后 built-in contexts/recipes/rules/fonts/worker 资源打包 |
| `apps/electron/electron-builder.yml` | Chromium/FFmpeg/worker 资源与平台差异（确有需要时） |

### 25.3 资源目录

建议在仓库内将可执行/可渲染内容继续分开：

```text
design-contexts/       # 审计通过的 built-in Design Context Packages
design-recipes/        # rendering/workflow Recipes
design-rules/          # universal design rules + validator bindings
design-fixtures/       # 自有许可的测试与 benchmark fixtures
```

这些目录必须分别有 authoring guide、schema、license policy 和 guard。不得把全部内容重新塞进 `skills/` 或 Electron renderer source。

### 25.4 测试落点

- 纯 schema/gate/path policy：各 package `tests/`；
- server orchestration/RPC/ownership：`packages/server-core/tests/design/`；
- Electron protocol/partition/bridge/lifecycle：`apps/electron/tests/main/design-preview*.test.ts`；
- renderer reducer/component：对应 renderer tests；
- 跨 daemon/renderer/worker/package consistency：根级或 e2e contract tests；
- Office/ODF/SVG/diagram round-trip 与 Fidelity Report：各 format/engine package golden corpus；
- 用户闭环与恶意 fixture：Electron/Playwright E2E；
- packaged Chromium/FFmpeg/font/cross-platform：打包 smoke。

文件级任务在 Phase 0 合同冻结后按上述模块拆成可独立合并的实施批次；禁止以修改 `SessionManager.ts` 和 `ArtifactWorkbench.tsx` 两个巨型文件完成全部能力。
