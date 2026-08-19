# 记忆系统设计（占位 · 待完善）

> **状态：占位**。本文档暂不含方案设计，仅收录后续设计所需的**方案参考**（来源：对话「OpenViking Project Introduction」，2026-08-18 调研）。方案内容待 Captain 后续完善。

---

## 1. 方案参考来源

- 对话「OpenViking Project Introduction」（会话 `260818-pearl-tulip`），已调研 13 个 Agent 记忆系统项目并做了 11 家对比。
- 关联调研报告：`/Users/van/projects/VanBrain/workspace/reports/对比-Agent记忆方案生态调研-2026-08-18.md`（11→13 家）。

## 2. 参考项目清单

### 2.1 深度调研代表作（各自范式代表）

| 项目 | 仓库/来源 | 核心思想 | 关键参考点 |
|---|---|---|---|
| **OpenViking** | volcengine/OpenViking（29k★，AGPLv3，Python+Rust） | AI Agent 上下文数据库 | `viking://` 虚拟文件系统；**L0/L1/L2 三层加载**（摘要~100t/概览~2k/全文，输入 token 最高省 91%）；目录递归检索；检索轨迹可观测；会话异步沉淀为长期记忆；双层存储（AGFS 文件存全部 + 向量索引只存 URI/向量/元数据）。论文 VikingMem（VLDB 2026） |
| **ai-memory** | akitaonrails/ai-memory（2.4k★，MIT，Rust） | 编程 Agent 长期记忆 | **反向量库**：Markdown wiki + git + SQLite FTS5；权威感知召回（FTS5 全文 + 实体 + 图邻居 RRF 融合，优先返回维护型页面）；**零 LLM 可跑**；跨厂商交接（Claude↔Codex）；记忆反馈（helpful/stale/wrong 调权重） |
| **TencentDB Agent Memory** | TencentCloud/TencentDB-Agent-Memory（22.9k★，MIT，TS） | 团队级记忆中枢 | **L0→L3 语义金字塔**（原始对话/原子事实/场景块/用户画像）；**Mermaid 符号画布做短期上下文压缩**（数千行日志→几百 token 结构，按需 grep 下钻）；**jieba 中文原生分词**（12 家唯一）；BM25+向量+RRF；白盒可观测 + 无损下钻链；多租户 team/agent/user |
| **llmwiki** | lucasastorian/llmwiki + Karpathy gist | LLM 维护持久 wiki（反 RAG） | LLM 在用户与原始资料间持续维护结构化 Markdown wiki；三层（Raw sources / Wiki / Schema）；ingest/query/lint 三操作；~100 源/几百页时**不需要向量库** |

### 2.2 11 家对比组（知乎《当前10种主流LLM Agent Memory方案对比》文内）

| 项目 | 核心思想 |
|---|---|
| A-MEM | Zettelkasten 卡片盒，LLM 动态建链 |
| Zep / Graphiti | 时序知识图谱，事实带生效/失效双时间戳（生产库 30k★） |
| MemoryBank | 艾宾浩斯遗忘曲线（规则驱动遗忘，2023 开山作） |
| MemoChat | 微调模型学会在 prompt 里用备忘录 |
| MemGPT → Letta | LLM 当 OS、记忆当虚拟内存，Agent 自主分层管理 |
| MemoryOS | STM/MTM/LPM 三层 + 热度迁移（EMNLP 2025 Oral） |
| MemOS | MemCube 统一抽象（纯论文，无开源仓库） |
| Mem0 | 通用记忆层；**v3 弃 UPDATE/DELETE 改单遍 ADD-only**；多信号融合 + 时间感知 |
| MemTree | 树状层级，语义动态重构（学术无官方 repo；商业闭源） |

## 3. 生态共性（7 条，可作为设计约束）

1. 记忆全部**外部化**，不存模型权重（Externalization：weights → context → harness）。
2. 写入时 LLM 结构化是默认动作（唯一的例外：ai-memory 零 LLM）。
3. **分层无处不在**：时间分层（STM/MTM/LPM、L0/L1/L2）与抽象分层（树深、权威页）两轴并存。
4. **多信号检索是 2026 共识**，单向量检索已被头部淘汰（Mem0 v3 / ai-memory / Graphiti / OpenViking / TencentDB 均为多信号 + RRF 一类融合）。
5. 溯源与可观测成为新标准（episode 溯源、git 历史、检索轨迹）。
6. **Mem0 v3 关键转向**：语义去重既贵又易错，业界改用"只增 + 时间戳"，弃 UPDATE/DELETE。
7. 遗忘机制三派：规则驱动（MemoryBank 遗忘曲线 / MemoryOS 热度 / ai-memory TTL / TencentDB 空闲触发）、Agent 自主（Letta、A-MEM）、事实失效不删（Graphiti 双时间戳）。

## 4. 尚未验证 / 待补充

- [ ] 与 Craft 自身能力（跨会话记忆检索 / 技能 / vanbrain）的映射关系
- [ ] 中文分词路线：FTS5 trigram（VanBrain 方案） vs jieba（TencentDB）对照
- [ ] 选型倾向（分层/存储/检索/更新/遗忘）——待 Captain 定
