# Craft 主题引擎方案：语义 token 分层 + 高阶深度（design）

- 作者：Craft Agent（与 Captain 协作）
- 日期：2026-08-20
- 状态：实现完成（核心语义表面、自动化验证与应用内视觉复验均已完成）
- 配套演示：`docs/theme-engine-demo-5-themes.html`（五套主题全维度对比）

---

## 0. TL;DR（一句话）

保留自研，不引入主题框架；把现有"6 色 + 双锚点派生"升级为 **语义 token 分层 + 一个高阶 `--depth` 深度维度**，覆盖 **L1 色彩 / L2 形状 / L3 材质 / L4 排版 / L5 图标 / L6 密度** 六层自由度，让"换 token 换风格"成立。产品只内置含 light/dark 的 `default`；其他主题全部从用户目录 `~/.craft-agent/themes/` 读取。

**边界红线：L7 动效、L8 语气（界面文案）、整套图标替换 不纳入主题引擎** —— 主题只管视觉 token，不管内容与文案。

---

## 1. 背景与痛点

当前仅 6 色主题，精细化低、可调项少，多数主题只是"换色"而非"换风格"。根因需先说清，才能设计正确的方案。

## 2. 根因诊断（源码实证）

### 2.1 现状事实
- 语义 schema（`packages/shared/src/config/theme.ts`）：**6 色** `background/foreground/accent/info/success/destructive` + **5 面** `paper/navigator/input/popover/popoverSolid` + `dark` 覆盖 + scenic。
- `navigator` 是显式 opt-in 表面：Default 与未声明该 token 的用户主题保留 macOS 原生透明侧边栏；只有主题文件明确声明时才铺设侧边栏背景。
- `themeToCSS` 产出约 **14 个 CSS 变量** 注入 `:root`。
- index.css 有 **207 个 token**，约 **70 处** `color-mix(...)`/`oklch(from ...)` 派生。
- 派生**全部锚定 `--foreground` + `--background` 双根原色**（`--foreground-dimmed`/`-2..95`、`--secondary`、`--muted`、`--border`、`--ring`、`--card`、`--background-elevated`、气泡色…）。
- 历史上的 **15 个 preset 全部只写 6 色 + 5 面 + dark**，没有一个扩展派生 token；实施阶段已删除 14 个非默认内置主题，只保留 default light/dark 基线。

### 2.2 精确根因
「换色不换风格」= **双锚点派生模型**：

```
所有层级词(secondary/muted/border/card/灰阶/背景层级/气泡) = f(--foreground, --background)  ← 固定算式
```

- 主题只能读 6 个语义色，其中 accent/info/success/destructive 只作用于**少量强调元素**，不参与风格骨架。
- 决定"质感/层次"的派生 token 无法被主题单独赋值，只能随 foreground/background 联动 → 明暗相近的主题观感几乎一致，差异只剩 accent。
- 圆角 / 阴影 / 字体这根风格支柱**完全不受主题控制**。

### 2.3 定位
本质 = **缺中间语义层 token + 派生策略单一 + 风格参数（radius/shadow/font）不可主题化**。

### 2.4 运行时架构问题（本轮深入审计）

除 token 覆盖不足外，旧实现还存在九类结构性问题：

1. **来源混杂**：资源目录、启动时复制到用户目录的预设、`theme.json` 覆盖和渲染器内置 glob 同时参与解析，无法判断最终真值来自哪里。
2. **用户目录被产品管理**：启动时会补写或“修复”命名主题，用户文件与发布资产之间没有清晰所有权边界。
3. **偏好双写**：模式和字体只在 localStorage，颜色主题在 `config.json`，跨窗口广播又是第三条路径，容易启动闪烁和状态分叉。
4. **异步竞态**：快速切换 workspace 或主题时，较慢的旧请求可能覆盖新选择；加载失败时旧 CSS 还可能继续显示，却标成新主题。
5. **监听器重复**：每个 workspace 的 `ConfigWatcher` 都监听全局主题目录，打开的 workspace 越多，重复文件事件与广播越多。
6. **颜色格式被暗中限制**：引擎宣称支持任意 CSS 色，却只为 Hex 生成 `--*-rgb`，相关阴影和透明色消费者因此对 OKLCH/HSL 行为不一致。
7. **密度改错层级**：主题直接覆盖 Tailwind 的全局 `--spacing`，会连带改变图标、位移、宽高和结构性面板间距，而不只是内容密度。
8. **多套静态颜色**：Default 常量、资源 JSON、两份根 CSS、代码编辑器和 Electron 启动背景各自维护颜色，已经出现彼此不一致。
9. **文件边界过宽**：主题 ID、JSON 大小、未知字段、背景图片路径/协议/类型缺少统一约束，既影响稳定性也扩大了本地文件读取边界。

对应原则是：**单一内置源、用户目录归用户、单一持久化快照、单一全局监听器、显式加载状态、语义 token 消费、严格文件边界**。

## 3. 为什么不用现成主题框架（实证结论）

对候选框架逐一核 npm registry 周下载：

| 框架 | 周下载 | 定位/结论 |
|---|---|---|
| Theme UI | 52,521 | 唯一成熟方案，但基于 Emotion/CSS-in-JS，与 Craft 纯 CSS 变量 + color-mix 范式架构不符 = 重写全部组件。否 |
| @teispace/next-themes | 9,902 | 主题切换器，Craft 已有同类（ThemeContext）。否 |
| 其余 10+ | ≤90 | 全是"主题切换器"或组件库样式，无实质新能力。否 |
| @toolzone/themejs | **不存在** | npm registry Not found（清单含虚构项，可信度低）。无效 |
| tinky-theme | 6 | 服务于 `tinky` = "React for CLIs"。无关 |

**决策：自研 token 分层扩展（方案 D）**。直接完善 schema、`themeToCSS` 与现有全局 token 消费入口；不改造旧预设，也不为历史内置主题承担兼容成本。

## 4. 方案设计：L1–L6 六层自由度 + `--depth` 深度语义层

### 4.1 六层自由度

| 层 | 维度 | 覆盖内容 | 现状 | 处置 |
|---|---|---|---|---|
| **L1** | 色彩 | 语义色、表面色、灰阶、边框/ring 色、渐变 | 部分（受双锚点锁死） | 每面/每阶解耦独立赋色 |
| **L2** | 形状 | 圆角、**边框样式**(solid/dotted/dashed/double)、**边框粗细** | 圆角有 token 未入 schema；border-style/width 无 | 新增 `--border-style`/`--border-width` + 组件改 `var()` |
| **L3** | 材质 | **阴影颜色**（解锁非黑）、阴影强度、玻璃 blur、硬影、渐变 | 阴影锁死黑色；blur 硬编码 | shadow-color 可主题化 |
| **L4** | 排版 | 字族 sans/serif/mono、基准字号、字距、行高 | 字族有 4 token；其余硬编码 | 补 schema + 字体加载策略 |
| **L5** | 图标 | **图标风格变体**：stroke 粗细、线帽(round/square)、图标着色 | 无 | 全局 Icon 组件暴露 stroke token |
| **L6** | 密度 | 间距网格、留白密度 compact/comfortable/cozy | 写死在各组件 padding/margin | 密度档位 token 化 |

> 图标层的**整套图标集替换**明确不纳入（成本高、收益边际）；L5 只做"同一图标集的风格变体"，即够制造风格差异。

### 4.2 高阶 `--depth` 深度语义层（本轮核心新增）

用户洞察：与其让用户分别调阴影、渐变、blur、高光、透明度 5 个低阶 token，不如暴露**一个高阶语义 token**联动一组低阶 token。Craft 已有三样散落的"深度素材"：
- `--background-elevated`（抬升面，现锁死 1.5% 混合）
- `--shadow-*`（层级，现锁黑）
- `backdrop-filter`（玻璃，硬编码 blur 8/24px）

设计：新增高阶语义 token `--depth`，枚举值：

```
flat       扁平：近零阴影、无渐变、无玻璃
elevated   抬升：纸面浮起 + 淡彩投影 + 顶部高光
neon       辉光：实底 + 霓虹色影发光（色影非黑）
glass      磨砂：全表面半透明 + backdrop-blur
raised     硬抬升：零模糊纯色偏移硬影（Neo-Brutalism）
```

`--depth` 在 `themeToCSS` 中**展开为一组低阶 token**（表面混合比 / 阴影层数与颜色 / 顶部高光 / 玻璃 blur / 硬影）。主题只需声明一个值即联动多维度。

**Demo 实证**：`depth:glass`（③赛博 neon / ④玻璃 glass）与 `depth:raised`（⑤粗野）等 5 个取值，仅靠 `--depth` 一个值 + 材质参数的差异，就呈现扁平/禅意/赛博/玻璃/粗野五种截然不同的质感——证明自由度足够且未相互局限。

### 4.3 默认基线与主题文件

- `DEFAULT_THEME_FILE` 是运行时唯一的 Default 快照，`resources/themes/default.json` 是随应用交付的同步资源；自动化测试要求二者完全一致。
- 历史非默认内置主题和相关许可证资源从产品包移除；不会在启动时重新复制到用户目录。
- `~/.craft-agent/themes/*.json` 是所有非默认主题的唯一来源。该目录不会被应用播种、覆盖、重置或清理；旧版本已经留下的主题文件继续作为普通用户主题使用。
- `default` 是大小写不敏感的保留 ID，用户的 `default.json` 不参与列表和解析，不能遮蔽内置回退。
- 配套 HTML 中的赛博朋克、玻璃、粗野主义等只作为能力验证样例，不是产品内置主题。
- 新增 token 保持可选；缺省时由默认 CSS token 提供稳定回退，便于逐步设计新主题。
- `depth: glass` 可让已接入的表面使用 blur，但 `popoverSolid` 始终保持不透明。
- 客户端只负责选择和应用主题；主题制作通过 JSON 文件完成，不提供可视化编辑器。

### 4.4 确定性的解析与状态流

```text
config.json 偏好 + workspace 可选主题 ID
                    ↓
       Default（内置）或用户 JSON（磁盘）
                    ↓ 严格校验、路径约束
          在 Default 上做深层语义合并
                    ↓ 规范化 light/dark/scenic
       单一已应用快照 → DOM / Shiki / 原生浏览器叠层
```

- `config.json` 原子保存 `themeMode`、`colorTheme`、`themeFont`；localStorage 只作为带版本的首屏缓存，旧缓存会一次性迁移。
- workspace 只保存一个可选主题 ID；缺省即继承 app 选择，不再形成另一套主题内容级联。
- 渲染器区分 requested/applied theme，并显式维护 loading/ready/error。只在 loading 期间保留 last-good；终态失败会原子切到 Default 并清除自定义 CSS。
- 一个 app-scoped watcher 监听用户主题目录并广播文件 ID；不存在每 workspace 重复监听。
- 主窗口、代码编辑器、Shiki、Windows 标题栏和原生浏览器叠层都从同一解析结果或主题 CSS token 取值。
- 本地背景图必须留在主题目录内，仅允许 PNG/JPEG/GIF/WebP 且不超过 20 MiB；JSON 不超过 256 KiB；远程图只允许 HTTP(S)。

## 5. 边界：哪些"不做"（重要澄清）

主题引擎有其职责边界，避免"什么都放进来"导致不可控：

| 项目 | 是否纳入主题 | 原因 |
|---|---|---|
| L1–L6 + depth | ✅ | 视觉 token，主题本职 |
| L7 动效与过渡 | ❌ | 可作独立特性，不宜混杂进主题 token |
| L8 界面文案 / 语气 | ❌ | 文案是产品内容（i18n/文案层），不是主题；主题只管视觉，不管"把'运行任务'改成'开卷'" |
| 整套图标集替换 | ⚠️ 不纳入（L5 只做风格变体） | 需主题自带美术资产，成本高、收益边际 |
| 客户端主题编辑器 | ❌ | 主题由 JSON 文件定义；客户端仅选择和应用 |

> **设计原则**：一套主题能"换风格"靠的是视觉 token（颜色/形状/材质/字体/图标风格/密度/深度），**不是靠换文案**。演示已统一全部系统 UI 文案（按钮/tab/placeholder/状态徽标），五套主题用同一套文案，仅凭 token 即呈现五种风格——这保证了主题引擎的纯粹性，也让它与 i18n/文案层解耦。

## 6. 风格覆盖能力检验

用真实 UI 风格分类（StyleKit 同源体系）检验引擎自由度：

| 风格簇 | 能否覆盖 | 需要的维度 |
|---|---|---|
| 扁平 / 极简 | ✅ | `depth:flat` + 克制色彩 |
| 暗色模式 | ✅ | L1 表面层级 + L6 密度 |
| 玻璃拟态 | ✅ | `depth:glass` + L3 blur + L2 大圆角 |
| 新拟态 Neumorphism | ✅ | `depth:elevated` + 同色系内外影 |
| 新野兽派 Neo-Brutalism | ✅ | `depth:raised` + L2 粗边框 + L1 高饱和 |
| 渐变 / 极光 | ⚠️ 需补 | L1 需新增 gradient 表面（scenic 已有雏形） |
| 高对比 / 编辑排版 | ✅ | L2 + L4 衬线 |
| 手绘 / 涂鸦 | ⚠️ | 需手写字体 + 不规则圆角（字体由主题自带） |
| 拟物 / 3D / 像素 | ❌ 成本高 | 需深度贴图/特定美术资产，属主题内容成本而非引擎自由度 |

结论：**主流风格（约八成）可覆盖**；难覆盖的是需要"额外美术资产"的风格，引擎可留出 token 空隙，但内容由主题自带——这是引擎自由度的边界，合理。

## 7. 实现里程碑

| 里程碑 | 内容 | 工作量 | 风险 |
|---|---|---|---|
| M0 | 冻结覆盖 token 清单（六层 + depth 枚举） | — | 完成 |
| M1 | 修复 New Session 与标题栏的结构性间距 | 低 | 完成，待应用内视觉复验 |
| M2 | 收敛来源：只内置 Default，其他主题只读用户目录 | 中 | 完成 |
| M3 | 偏好收敛到 `config.json`，迁移旧 renderer 缓存 | 中 | 完成 |
| M4 | 引入 requested/applied 快照、竞态隔离和失败回退 | 中 | 完成 |
| M5 | 严格 schema、ID、文件大小、路径与图片协议边界 | 中 | 完成 |
| M6 | 移除 Hex-only RGB 旁路；改用原生 CSS 色与语义密度 token | 中 | 完成 |
| M7 | 单例目录监听及 DOM/Shiki/原生浏览器视觉同步 | 中 | 完成 |
| M8 | 文档、IPC 精确映射、存储隔离和静态快照测试 | 中 | 完成，待应用内视觉复验 |

**实施原则**：优先接入已有全局消费点，不做无目的的全组件样式重写；结构性布局不受主题密度影响。非默认主题以用户目录中的独立 JSON 文件迭代，不向客户端加入主题编辑器。

### 后续可选优化（不阻塞本轮）

1. 在 Appearance 中增加只读的校验诊断（文件名、字段路径、错误原因），但仍不做主题编辑器。
2. 对超大 scenic 图片增加异步解码/缩略缓存，减少首次切换主题时的主进程同步读取时间。
3. 增加 WCAG/APCA 对比度审计命令，作为主题作者工具，不在运行时擅自改色。
4. 按真实使用频率继续把列表、表格和表单的纵向 padding 接入语义密度 token；固定标题栏、安全区和拖拽命中区保持不变。
5. 下一次破坏性协议升级时移除仅为旧客户端保留的 `getAppTheme`、`broadcastThemePreferences` 等兼容 IPC。

## 8. git 安排

全部实现仅提交到 `Theme` 分支，不自动合并 `main`；完成本地验证后由用户测试确认。

---

## 附：配套演示说明

`docs/theme-engine-demo-5-themes.html`（自包含，纯 CSS 变量，无 JS）：
- 同一套工作台组件骨架，仅切换 token → 五套风格：① 默认简约 `flat` / ② 水墨禅意 `elevated` / ③ 赛博朋克 `neon` / ④ 玻璃拟态 `glass` / ⑤ 粗野主义 `raised`。
- 每列含【深度演示条】直观展示 `--depth` 差异 + 维度徽标（L1–L6）+ Token 面板。
- **五套主题使用完全相同的系统 UI 文案**（按钮/导航/输入/状态徽标），纯 token 制造风格差异，验证主题引擎只管视觉、不管文案。
