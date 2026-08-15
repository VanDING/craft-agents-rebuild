# 轨迹面板：craft 移植版 vs VanDSH 原版 对比报告

日期：2026-08-15
范围：`E:/VanDSH/packages/client/ui-trajectory/`（原版）↔ `E:/craft-agents/packages/ui/src/components/trajectory/` + `TrajectoryPanel.tsx`（移植版）

---

## 0. 总览

| 维度 | VanDSH 原版 | craft 移植版 | 差距 |
|---|---|---|---|
| 源文件 | 26 个（client 目录，含 6 个 definition 文件） | 13 个 | 原版按记录类型拆分定义文件 |
| 代码规模 | 约 7,858 行（Table 3,074 / layout 1,126 / Timeline 730 / View 506） | 约 1,563 行 | **原版 5 倍** |
| 数据来源 | DSH runtime `ConversationSnapshot`（实时事件流 + partial + runningCalls） | Pi 事件流水合快照（消息级，非事件级） | 见 §7 流式 |
| 测试 | 8 个 spec 文件（layout/table/view/virtual-rows/snapshot-builder/cell…） | 2 个测试文件 23 用例 | 覆盖差 4 倍 |
| UI 范式 | CSS Modules + 语义化 `<table>` | Tailwind + div | 视觉细节差距大 |

**结论先行**：核心数据面（turn 分组、usage 分桶、耗时、compaction、搜索、虚拟滚动）已移植到位；**视觉呈现、交互密度、实时性三类差距显著**——原版是"可交互的事件检查器"，移植版是"只读记录清单"。

---

## 1. 数据模型

| 项 | 原版 | 移植版 | 影响 |
|---|---|---|---|
| 记录 kind | 7 种：system/user/context/compacted/message/tool/subtool | 同 7 种 | 一致 |
| `recordId`（稳定身份） | ✅ 跨历史加载不变的 identity | ❌ 无（用 index） | 虚拟滚动/选中在加载更早记录后失稳 |
| `previewMarkdown` | ✅ 单行摘要的 Markdown 源（与 `inputDetail` 分离） | ❌ 无 | 行内摘要质量下降（原版渲染 Markdown 转纯文本） |
| `opensTurn` / `turn-end` 事件 | ✅ user 消息是否开启新 turn、turn 错误标记 | ❌ 无 turn-end 事件 | 原版可显示 turn 结束原因 |
| `sourceSeq` / `messageSource` | ✅ 源事件序号、消息来源（role/name） | ❌ 无 | 原版 inspector 有 "Source" 页显示生产者 |
| `requestOnly` | ✅ 无可见记录的辅助请求锚点 | ❌ 无 | 请求编号连续性 |
| `thinkingDetail` | ✅ reasoning 内容单独存储 | ⚠️ 合并进输出 | inspector 无法单独查看思考过程 |
| `sourceBlocks` / `outputBlocks` | ✅ 内容块数组（text/image/tool-call，保留顺序） | ❌ 无 | 原版可渲染消息内图片与多块结构 |
| `assistantMetrics` | ✅ stepStartTime/firstTokenTime/completedTime + outputTokens | ❌ 无 | **TTFT / 解码时长 / 吞吐缺失**（见 §6） |
| `resultPreviewMarkdown` | ✅ 工具结果 Markdown 摘要 | ❌ 无 | 工具结果行内摘要退化 |
| `promptDetail` / `previousPromptDetail` | ✅ 系统提示快照（含 tools 目录） | ⚠️ promptSnapshot（纯文本） | 原版可 diff 工具目录、渲染工具目录页 |
| `TrajectoryRequestHeaderState` | seq/time/prompt/change/location | requestSeq（number） | 原版支持 request 边界与 change 类型 |

---

## 2. 布局与折叠（layout.ts）

| 项 | 原版 | 移植版 |
|---|---|---|
| turn 折叠 | 折叠后保留 system/request 记录，显示摘要行 **"N steps · M tool calls"**（`summarizeTurn`） | 折叠后显示 **"group 名列表 — N records (folded)"**，无计数摘要 |
| assistant 折叠 | ✅ **二级折叠**：折叠 assistant 消息下连续工具调用，摘要 **"N tool calls · 名称1, 名称2"**（`summarizeAssistantTools`） | ❌ 无 |
| request 分组 | ✅ 每组标 "Request N"（跨 turn 全局编号）+ 边界线（偏移 8px 阶梯） | ⚠️ "Request N" 仅 turn 内局部编号（layout 中 group title） |
| compaction | ✅ 独立 "Between turns" section + 折叠 | ✅ 同（turn: null） |
| 流式 partial | ✅ `appendTrajectoryPartialLayout` 增量合并（partial + runningCalls） | ❌ 无（依赖消息级事件流，见 §7） |
| group 描述 | ✅ GroupHeader 可显示 "49 s" 等壁钟跨度描述 | ❌ 无 |

---

## 3. 表格渲染（TrajectoryTable）

| 项 | 原版 | 移植版 |
|---|---|---|
| 语义 | `<table>` + colgroup（事件列/内容列） | `<div role="table">` |
| kind 标签 | ✅ 行首**彩色标签**（System/User/Context/Compacted/Message/Tool/Sub，CSS module 配色 + 图标：扳手/信息/压缩图标） | ⚠️ 单一字符字形（⚙❯·↻✎▶↳），无彩色标签 |
| 行内容 | 工具行拆 **名称 · 参数**（`toolCallTextParts`），message 行显示 input/output/think 指标列 | 整行文本截断 |
| 状态 | complete/running/error 三态（running 检测：compacted 无耗时 → running；流式 cell 覆盖） | done/error 两态（无 running 检测） |
| 折叠摘要行 | 语义化 aria-label "Collapsed turn summary, N steps…" | 普通 div |
| 请求边界 | ✅ request 边界行 + 阶梯偏移 + "Request #N · Compaction" 标签 | ❌ |
| 行键盘导航 | tabIndex + aria-rowindex/selected | tabIndex=0 仅回车/空格选中 |
| 历史加载行 | ✅ "Load earlier history" 按钮（带 spinner + busy 态） | ❌ |
| 虚拟滚动 | ✅ @tanstack/react-virtual（估算高度、overscan 12、anchorTo end、scrollMargin） | ✅ 自写固定高度投影（CONTENT_ROW_HEIGHT/COLLAPSED_SUMMARY_HEIGHT） |
| 底部跟随 | ✅ scrollEndThreshold 2px 自动跟随 | ❌ |

---

## 4. 时间线（TrajectoryTimeline）

| 项 | 原版 | 移植版 |
|---|---|---|
| 模式 | **4 种**：`sequence`（操作序列）/ `duration`（耗时）/ `time`（壁钟）/ `actual`（真实起止） | 2 种：`actual-duration` / `equal-width` |
| 空闲压缩 | ✅ `actualTime` 开关：保留空闲间隙 vs 压缩（`compressIdle`） | ❌ |
| 车道 | ✅ **三车道投影**（`laneFor` 按 kind 分车道） | 单车道 per-turn |
| 交互 | ✅ **拖拽区间选择**（drag ≥3px）+ **滚轮缩放**（≥4 操作）+ **边缘平移**（8% 边缘区） | ❌ 仅点击块聚焦 |
| 范围联动 | ✅ 选中区间 → 表格高亮区间内记录（`timelineFocusIndexes` 内外标记） | ❌ 无（只点块聚焦单条） |
| tooltip | ✅ kind 标签 + 总耗时 + **起止时钟时间**（毫秒级）+ **TTFT · Decoding** 分段 | ⚠️ 仅行文本 title |
| turn 边界 | ✅ `TrajectoryTimelineTurnBoundary` 标记 | ❌ |
| 历史截断 | ✅ `hasEarlierRecords` + onLoadEarlier 控制 | ❌ |
| 搜索联动 | ✅ 搜索命中块高亮 | ❌ |

---

## 5. 搜索

| 项 | 原版 | 移植版 |
|---|---|---|
| 行为 | **过滤**（`filterRecords` 只显示命中行，计数变化） | **高亮**（命中行加黄色背景，计数不变） |
| 索引 | `TrajectorySearchIndex` 类 + **3 秒节流重建**（SEARCH_INDEX_THROTTLE_MS） | useMemo 即时重建 |
| 匹配范围 | 文本 + kind + 工具名 + 参数（结构化解构 toolCallTextParts） | 文本（cell.text + 工具名拼接） |

> 移植版之前验证 "62 records 不变" 曾被误判为 bug——实为设计差异：原版过滤、移植版高亮。

---

## 6. 检查器（Inspector / Details）

| 项 | 原版 | 移植版 |
|---|---|---|
| tab 组织 | **类型感知动态**：system → 系统提示页（初始/更新两套）；compaction → Summary/Raw；Markdown 记录 → Summary/Preview/Raw/Source；普通 → Summary/Payload/Result/Schema/Timing | **固定 13 tab 平铺**（Overview/Input/Output/Usage/Timing/Schema/System prompt/Source/Raw/Tools/Options/Diff/Rendered），空 tab 显示 "无数据" |
| Markdown 渲染 | ✅ 完整 Markdown 渲染（shiki 高亮？），Preview 页 + thinking 折叠展开 | ⚠️ Rendered tab（若已实现） |
| 系统提示 diff | ✅ `promptDiffLines` 逐行 diff + 工具目录对比（`ToolCatalog`） | ⚠️ Diff tab（基于文本快照） |
| Timing 面板 | ✅ `AssistantTimingPanel`：**TTFT / 生成时长 / 吞吐**（outputTokens÷生成秒）+ 起止时间 | ❌ 只有总耗时 |
| Usage 面板 | ✅ 分桶行（input/cacheRead/cacheWrite/output/reasoning）+ **累计**（session 前缀求和） | ✅ Usage tab（含 sessionTotal） |
| 工具输出 | ✅ `ToolOutputBlocks` 保留块结构 + 图片渲染 + `PanelImage` | ⚠️ 文本 |
| 来源 | ✅ `MessageSource`（生产者 role/name） | ⚠️ Source tab |
| 宽度 | ✅ **可拖拽调整**（320–720px，步进 16）+ 工具请求分栏（可拖拽 0.36 份额） | ❌ 固定 w-80 |
| 关联跳转 | ✅ 工具目录/图片块可打开调用详情（inspect 注入） | ❌ |

---

## 7. 实时性与数据链路

| 项 | 原版 | 移植版 |
|---|---|---|
| 数据源 | DSH runtime 快照（**事件级**：nodes/partial/runningCalls/requests 全保留） | Pi 事件流 → 消息级聚合（adapter 丢弃约 60% 事件字段，见 pi-kernel 分析） |
| 流式渲染 | ✅ partial 增量布局 + runningCalls（工具执行中实时显示） | ⚠️ 事件流驱动（tool_start/tool_result 到达即显示，但无 partial 级细粒度） |
| 历史加载 | ✅ `loadOlder` 分页（session 有 hasMore）+ 加载行 | ❌ 一次性全量（getMessages） |
| 时长偏好 | ✅ 持久化（localStorage `dsh.trajectory.duration`） | ❌ 每次会话重置 |

---

## 8. 差距分级

### 🔴 关键差距（功能缺失，用户可感知）

1. **TTFT / 解码时长 / 吞吐指标缺失**——原版 Timing 面板与时间线 tooltip 的核心内容；需 pi-agent-server 增加 `text_start` 打点（移植评估时已识别，未实施）
2. **assistant 二级折叠缺失**——长会话中"折叠某条回复下的所有工具调用"是原版高频操作
3. **时间线区间选择 + 缩放 + 边缘平移缺失**——原版时间线是可交互检查器，移植版是只读条
4. **搜索过滤缺失**（移植版只高亮）——原版搜索后列表收窄，导航效率高
5. **历史分页加载缺失**——长会话原版按页加载，移植版全量（虚拟滚动在 >100 行才启用）

### 🟠 重要差距（视觉/信息密度）

6. **kind 彩色标签缺失**——原版行的视觉辨识核心（彩色 tag + 图标），移植版用灰字符
7. **request 全局编号 + 边界阶梯线缺失**——跨 turn 请求编号是原版的信息锚点
8. **Turn 折叠摘要退化**（原版 "3 steps · 5 tool calls"，移植版 "group 名 — N records"）
9. **Timing 缺失显示**——原版未知耗时显示 "—"，移植版不显示（已修 0ms 误导，但 "—" 更明确）
10. **tooltip 退化**——原版时间线 tooltip 含 TTFT/起止时间，移植版仅文本

### 🟡 次要差距（打磨）

11. inspector tab 类型感知组织 vs 固定 13 tab（空 tab 观感差）
12. inspector 宽度不可拖拽、无工具请求分栏
13. Markdown/图片块渲染（sourceBlocks/outputBlocks 数据面缺失）
14. 语义化 `<table>` vs div
15. 时长偏好持久化
16. 搜索索引节流（3s）——性能优化
17. 流式 running 状态显示（compacted running 检测）

---

## 9. 结论与建议

**移植完成度评估**：数据面约 70%（消息级），交互面约 40%，视觉约 50%。核心骨架（turn 分组、usage、compaction、搜索、虚拟滚动、inspector 基本页）正确，但**交互密度与信息层次与原版差距明显**——这正是用户感知到"差距有点大"的原因。

**若补齐，按投入产出排序**：

1. **TTFT 打点**（pi-agent-server 在 `text_start` 记录 firstTokenTime；`message_start` 记 stepStartTime）→ Timing 面板 + 时间线 tooltip 一起受益，中等成本，收益最大
2. **assistant 二级折叠**（layout 纯函数 + Toolbar 按钮 + Table 摘要行）——低成本，高频
3. **kind 彩色标签 + request 边界**（CSS 标签色 + 全局编号）——纯 UI，低成本
4. **时间线区间选择**（拖拽 range + focus 联动）——中等成本
5. **搜索过滤**（filterRecords 替换高亮）——低中成本，与原版行为一致
6. **历史分页**（server 端 seq 分页 + 加载行）——高成本，需 server 支持

不建议做的：partial 级流式（依赖 Pi SDK 事件面，收益低）、三车道时间线（视觉复杂度高，与 craft 主题不匹配时维护成本高）。
