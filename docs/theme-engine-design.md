# Craft 主题引擎方案：语义 token 分层 + 高阶深度（design）

- 作者：Craft Agent（与 Captain 协作）
- 日期：2026-08-20
- 状态：实现完成（核心语义表面补齐，自动化验证通过，待用户应用内视觉复验）
- 配套演示：`docs/theme-engine-demo-5-themes.html`（五套主题全维度对比）

---

## 0. TL;DR（一句话）

保留自研，不引入主题框架；把现有"6 色 + 双锚点派生"升级为 **语义 token 分层 + 一个高阶 `--depth` 深度维度**，覆盖 **L1 色彩 / L2 形状 / L3 材质 / L4 排版 / L5 图标 / L6 密度** 六层自由度，让"换 token 换风格"成立。产品保留含 light/dark 的默认主题，并以赛博朋克和粗野主义作为首批正式主题。

**边界红线：L7 动效、L8 语气（界面文案）、整套图标替换 不纳入主题引擎** —— 主题只管视觉 token，不管内容与文案。

---

## 1. 背景与痛点

当前仅 6 色主题，精细化低、可调项少，多数主题只是"换色"而非"换风格"。根因需先说清，才能设计正确的方案。

## 2. 根因诊断（源码实证）

### 2.1 现状事实
- 语义 schema（`packages/shared/src/config/theme.ts`）：**6 色** `background/foreground/accent/info/success/destructive` + **5 面** `paper/navigator/input/popover/popoverSolid` + `dark` 覆盖 + scenic。
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

- `default.json` 作为 light/dark 基线；`cyberpunk-neon.json` 与 `neo-brutalism.json` 是首批基于新引擎设计的正式主题。
- 历史 14 个非默认内置主题直接删除，不迁移、不改造。
- 新增 token 保持可选；缺省时由默认 CSS token 提供稳定回退，便于逐步设计新主题。
- `depth: glass` 可让已接入的表面使用 blur，但 `popoverSolid` 始终保持不透明。
- 客户端只负责选择和应用主题；主题制作通过 JSON 文件完成，不提供可视化编辑器。

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
| M1 | 扩展 `ThemeFile` 与 Zod schema | 低 | 完成 |
| M2 | 扩展 `themeToCSS`：语义 token + depth 展开 | 低-中 | 完成 |
| M3 | 使用不随产品发布的测试夹具验证五种 depth | 低 | 完成 |
| M4 | 复用现有主题选择 UI，不开发编辑器 | — | 无新增开发 |
| M5 | 最小接入 radius/shadow/font/border/icon/density 全局入口 | 中 | 完成；应用外壳、面板、卡片与输入基元已消费语义 token，待视觉复验 |
| M6 | 仅保留默认 light/dark，完成类型与构建验证 | 中 | 完成，待用户视觉验收 |
| M7 | 基于演示设计赛博朋克与粗野主义正式主题 | 低 | 完成，待用户视觉验收 |

**实施原则**：只接入已有全局消费点，不做全组件样式重写；固定数值的特殊组件保持原样。正式主题以独立 JSON 文件迭代，不向客户端加入主题编辑器。

## 8. git 安排

全部实现仅提交到 `Theme` 分支，不自动合并 `main`；完成本地验证后由用户测试确认。

---

## 附：配套演示说明

`docs/theme-engine-demo-5-themes.html`（自包含，纯 CSS 变量，无 JS）：
- 同一套工作台组件骨架，仅切换 token → 五套风格：① 默认简约 `flat` / ② 水墨禅意 `elevated` / ③ 赛博朋克 `neon` / ④ 玻璃拟态 `glass` / ⑤ 粗野主义 `raised`。
- 每列含【深度演示条】直观展示 `--depth` 差异 + 维度徽标（L1–L6）+ Token 面板。
- **五套主题使用完全相同的系统 UI 文案**（按钮/导航/输入/状态徽标），纯 token 制造风格差异，验证主题引擎只管视觉、不管文案。
