# Craft Agent「个人」整合方案

> 状态：本地 Profile 基线已实施并完成应用内视觉复验。当前实现由会话元数据即时计算活动概览，不读取消息正文；账户体系、持久化统计仓和 Profile 分享仍不在当前范围。

## 1. 产品定位

将现有 Settings → Preferences 升级为 Settings → 个人（Personal），把三类信息放入同一产品表面：

1. **我是谁**：头像、称呼、所在地、时区、语言与个人简介。
2. **我怎样使用 Craft Agent**：会话、Token、活跃、能力与工作方式洞察。
3. **Craft Agent 应如何配合我**：原 Preferences 的结构化字段、长期偏好和自由备注。

它不是一个社交主页，也不默认公开。首版以本机个人中心为定位，分享能力仅作为可控的摘要导出，不引入账户体系依赖。

## 2. 信息架构

保留 Settings 现有的两栏框架，将原「Preferences」导航项更名为「个人」。右侧详情区严格沿用其他设置页的**单页纵向滚动**模式，不增加页签、锚点目录或任何二级导航。

页面按阅读优先级自然排列：

| 顺序 | 区域 | 核心内容 | 展示方式 |
|---|---|---|---|
| 1 | 个人摘要 | 头像、称呼、地区、时区、本机私密状态 | 无容器的轻量页头 |
| 2 | 使用概况 | 会话、Token、活跃天数、能力数 | 一条紧凑指标卡 |
| 3 | 活动与洞察 | 热力图、专注时段、主要工作、常用能力 | 两个设置 Section |
| 4 | 个人偏好 | 基础资料、地区、工作方式、自由备注 | 沿用 SettingsCard 表单 |
| 5 | 数据与隐私 | 统计、分享范围、数据管理 | 沿用 SettingsCard 开关与危险操作 |

页面只有左侧「个人」这一层导航。Profile 是 Preferences 的摘要和反馈面，不是独立子产品；所有编辑和说明均留在同一滚动上下文中。

## 3. 页面结构

### 个人摘要与使用概况

- 顶部标题栏：个人、保存状态、编辑资料、分享摘要。
- Profile Hero：头像/缩写、称呼、地区与时区、私密状态。
- 指标带：总会话、累计 Token、活跃天数、使用能力数。
- 活跃热力图：默认近 12 个月，可切换 90 天与 4 周；颜色使用主题 `accent`。
- 使用洞察：专注时段、主要工作类型、协作模式。所有文案必须能回溯到可验证事件，不做人格判断。
- 常用能力：Skills、Tools、Apps/Plugins 按运行次数排序，最多显示 5 项。

### 活动与洞察

- 活跃热力图作为独立 Section，右上角仅保留时间范围切换；这是图表筛选器，不是页面导航。
- 使用洞察压缩为三条横向摘要；窄面板自动改为纵向。
- 常用能力不再另占半屏，用紧凑行列表承载，并限制为 3–5 项。

### 个人偏好

- 基础资料：姓名、语言、时区。
- 地区：城市、国家/地区。
- 工作方式：常用工作时段、回答密度、主动建议强度。
- 给 Craft Agent 的说明：沿用自由备注，并保留 AI 辅助编辑与直接编辑文件能力。
- 自动保存：延续 500ms debounce，标题栏明确展示保存中/已保存/失败。

### 数据与隐私

- 「使用统计」总开关；关闭后停止新增聚合事件，但保留历史统计，除非用户主动清除。
- 「分享摘要」字段级范围：身份、关键指标、活跃图、能力榜单分别控制。
- 说明本机路径、统计口径和最后更新时间。
- 清除使用统计是破坏性操作，必须二次确认；不得同时清除用户偏好。

## 4. 数据与口径

### 复用现有数据

- `preferences.json`：继续作为用户显式偏好的权威来源。
- Sessions：会话数、活跃日期、持续时长。
- Usage/turn metadata：Token、模型、reasoning/fast mode 等聚合指标。
- Tool/skill events：能力名称和运行次数。

### 建议新增的本机聚合模型

```ts
interface PersonalProfile {
  displayName: string
  avatar?: { kind: 'initials' | 'image'; value: string }
  language?: string
  timezone?: string
  location?: { city?: string; country?: string }
  workStyle?: {
    activeHours?: 'morning' | 'daytime' | 'evening' | 'late-night'
    responseDensity?: 'concise' | 'balanced' | 'detailed'
    proactiveSuggestions?: 'low' | 'medium' | 'high'
  }
  notes?: string
  updatedAt: number
}

interface LocalUsageSummary {
  schemaVersion: 1
  generatedAt: number
  totals: { sessions: number; tokens: number; activeDays: number }
  daily: Record<string, { sessions: number; tokens: number; runs: number }>
  capabilities: Array<{ id: string; kind: 'skill' | 'tool' | 'plugin'; runs: number }>
}
```

聚合结果应可重建，不写入 `preferences.json`；用户输入与行为推断必须分开存放。地点、语言等显式字段可以进入 Agent 上下文，Token 和工具榜单默认不注入。

## 5. 关键产品规则

- **私密优先**：首次进入明确标记「仅存储在本机」，不默认创建公开链接。
- **观察与偏好分离**：活动洞察标注为统计结果，不能反向覆盖用户写下的偏好。
- **可解释**：每项洞察均能打开口径说明，展示时间范围和来源。
- **渐进披露**：概览只展示最有价值的 4 个指标和 3 个洞察，更多数据后续再扩展。
- **跨主题一致**：只使用 Craft Agent 六色系统及语义 Token，不引入 Profile 专属品牌色。
- **可访问性**：热力图有文本摘要与单元格 aria-label；颜色不是唯一信息编码。

## 6. 实施状态

### 已完成：本机个人中心

- Preferences 路由兼容保留，导航显示名更新为「个人」。
- `PreferencesPage` 已重构为单页 Profile，原有偏好字段继续兼容。
- 增加头像、称呼、地区、时区、本机私密标记和本地会话活动概览。
- 使用会话元数据计算总会话、累计 Token、活跃天数、最长连续活跃、热力图与基础洞察；消息内容不进入统计。
- 完成亮暗主题、窄面板、键盘操作和中英文文案。

### 当前未采用：独立统计仓

当前规模下直接从本地 Sessions 派生统计更简单，也避免引入第二份活动数据权威。因此尚未增加日粒度持久化统计、统计开关、独立清除流程或能力榜单。只有出现明确性能或保留策略需求时才重新评估。

### 延后：受控分享

- 尚未实现「复制摘要」、图片/Markdown 导出、私密链接或公开 Profile。
- 只有在字段预览、撤销机制和隐私边界明确后才进入实施。

## 7. 当前验收状态

- [x] 旧 Preferences 数据原样加载，编辑后兼容旧结构。
- [x] 统计口径由纯函数实现，同一 Sessions 数据集可以确定性重算。
- [x] 活动统计不读取消息正文，用户偏好不会被统计结果覆盖。
- [x] 亮暗模式、国际化和响应式布局完成代码验证与应用内目检。
- [ ] 统计开关和独立清除流程——当前没有持久化统计仓，因此暂不适用。
- [ ] Profile 分享前的字段预览与隐私裁剪——功能延后。
