# 性能优化实施记录

日期：2026-09-10。分支：`codex/performance-streaming`。范围仅限现有行为的性能与内存优化。

## 已实施

| 路径 | 改动与效果 |
| --- | --- |
| Renderer 会话状态 | 文本增量不再通知未改变的会话列表元数据；缓存流式消息位置；不可变消息数组的分组复用已完成回合，结构选择器复用历史版本。弱引用允许历史缓存回收，无法命中时退回完整计算。 |
| 历史消息绘制 | 已完成且远离末尾的回合使用 `content-visibility: auto`，搜索和定位时禁用。保留组件状态，减少屏外布局与绘制。 |
| 首屏加载 | 11 个设置页面、Markdown PDF、PDF 浮层与文件预览中的 PDF 组件按需加载；移除页面 barrel 静态导入造成的拆包失效。 |
| Renderer 会话缓存 | 每分钟检查，保护挂载、活跃、加载中与运行中的会话。闲置至少 2 分钟后按最近访问保留最多 8 个、估算 64 MiB，15 分钟后可回收历史消息。 |
| 服务端会话与子进程 | 同样采用闲置时间、数量和估算字节预算。回收前 flush，保护查看中、处理、后台任务、认证、队列和未完成 RPC；使用现有运行时锁协调重建。重新访问时从磁盘加载。预算受活动会话保护约束，并非进程 RSS 硬上限。 |
| 持久化 | 将会话快照构造推迟到 debounce 合并之后；分块序列化并写入临时文件，保留 fsync、rename 和目录同步。读取时逐行解析，减少 split/map 中间数组。 |
| Durable runtime | canonical 投影按 session 存储与读取；恢复查询限定 session；提交投影后直接返回结果。审计使用集合索引代替每条消息扫描全部事件，避免大数组展开。 |
| Pi 通信与请求诊断 | 文本事件只传 delta，最终消息和 usage 保持原通道；诊断哈希与清单共享每条消息的序列化结果，避免再次构建完整上下文 JSON。 |
| WebSocket | 重放缓存增加 8 MiB 字节预算；慢客户端发送积压超限时断开，由原有重连重放或重新同步恢复，避免无限堆积。 |

## 测量

Electron 生产构建中，入口 HTML 直接引用及 modulepreload 的 JS 总量从 9,156,600 字节降至 8,592,777 字节，约减少 **6.2%**。这是未压缩产物大小，不代表启动耗时或总安装包减少同等比例。

运行 `bun run scripts/benchmark-streaming.ts` 可复测局部分组和事件序列化。一次本机运行结果如下；每档预热 50 次，采样 200 次，计时包含消息数组浅拷贝。

| 历史消息数 | 完整分组 p95 | 增量分组 p95 |
| --- | --- | --- |
| 100 | 0.092 ms | 0.009 ms |
| 1,000 | 0.330 ms | 0.007 ms |
| 5,000 | 0.897 ms | 0.062 ms |

包含两份 1 MB partial 的合成文本事件从 2,000,137 字节降到 95 字节。实际比例取决于上游事件内容。这些数据是局部合成基准，尚未测量真实交互延迟、CPU 或 RSS 峰值。

## 验证

- 针对性测试覆盖流式分组等价性、结构缓存失效、会话元数据通知、缓存保护、回收期间并发访问、持久化失败、回收后重新加载、Pi 待处理请求、传输缓存预算、请求哈希一致性、Durable 投影/恢复，以及 JSONL 和写入队列。
- Core、Server Core、UI、Electron 类型检查通过；Pi 子进程类型检查与构建通过；Electron renderer 和 Web UI 生产构建通过。
- 全仓库类型检查仍受未修改的 `packages/shared/src/config/__tests__/theme.test.ts:157–158` 的 TS2769 类型错误阻挡。没有将全仓检查标记为通过。

## 尚存成本

流式更新仍有消息和回合数组浅拷贝；屏外绘制优化不卸载 DOM。JSONL 仍进行完整原子替换，读取仍同步加载文件；此次降低快照构造和临时内存成本，没有消除磁盘写放大。Prompt snapshot 的持久化内容尚未去重。以上方向需真实会话 profiling 支持后再决定是否引入更大结构调整。


## 2026-09-11 补充基线：长会话热路径

新增合成基准 `bun run benchmark:session-io`（100 / 1,000 / 5,000 / 10,000 / 25,000 条历史消息）。本机结果：

| 历史消息数 | 流式 reducer p95 | JSONL 写 p95 | JSONL 读 p95 |
| ---: | ---: | ---: | ---: |
| 100 | 0.004 ms | 6.8 ms | 22.4 ms |
| 1,000 | 0.011 ms | 9.4 ms | 21.2 ms |
| 5,000 | 0.060 ms | 21.3 ms | 23.6 ms |
| 10,000 | 0.110 ms | 34.3 ms | 34.9 ms |
| 25,000 | 0.922 ms | 84.7 ms | 49.6 ms |

结论：在既有 8 ms delta / 100 ms 持久化激活阈值下，25,000 条消息仍未触发 Phase 4 的结构性改造条件。因此本轮不引入 append-only journal、normalized store 或结构性共享消息数组；继续保留 JSONL 全量原子替换与现有 immutable 数组语义。若真实用户会话出现超过阈值的 p95 或退出 flush 明显变慢，再按本文件的证据门槛重新评估。


## 2026-09-12 构建与打包复测

用 Vite JS API 构建当前 renderer，并用 electron-builder `--dir`（临时关闭 beforePack/native rebuild 以适配审计沙箱）复测 Windows x64 解包产物：

| 指标 | 改造前 | 改造后 | 变化 |
| --- | ---: | ---: | ---: |
| Renderer 初始 preload JS（raw） | 8,632,058 B | 4,460,000 B 级别（本次 4.46 MB） | 约 −48% |
| Renderer 初始 preload JS（gzip） | 2,495,468 B | 约 1.32 MB | 约 −47% |
| `main.cjs` | 47,204,464 B | 19.86 MB（minify） | 约 −58% |
| Pi bundle | 22,037,695 B | 12.18 MB（minify） | 约 −45% |
| win-unpacked 总大小 | 840,344,424 B | 607,473,675 B | 约 −27.7% |
| `resources/app` | 426,023,906 B | 205.7 MB | 约 −51.7% |
| Pi bundle 副本 | 3 × 22 MB | 1 × 12.77 MB | 去重 |
| node-pty 目录 | 158.2 MB（141.6 MB 调试物） | 9.09 MB，无 PDB/中间产物 | 过滤 |

本次实测：lazy locale 把 i18n chunk 从约 992 KB 降到约 174 KB；移除 namespace lucide 与 Mermaid/elkjs 初始加载后，初始 chunk 中已无 `elkjs`；katex 双副本通过 Vite alias/dedupe 合并为单份。renderer 初始预算已收紧为 4.8 MB raw。


### Phase 2/3 决策

- **Renderer 专项达标，停止继续拆包。** 初始 preload JS 从 8.63 MB raw / 2.50 MB gzip 降至 4.67 MB raw / 1.32 MB gzip（约 −46% / −47%），低于收紧后的 4.8 MB raw 预算；按计划的停止条件不再启用 EditPopover/Shiki/modulePreload 等边际优化。
- **katex 双副本已消除。** rehype-katex 仅使用稳定的 `renderToString` API，三个 Vite 配置将 katex 统一解析到当前根版本，并新增 root katex 选项兼容回归测试。
- **主进程仍高于 15 MB 目标。** minify 后 `main.cjs` 为 19.86 MB raw / 5.30 MB gzip。剩余体积来自 pdf-parse/markitdown、provider SDK、messaging adapter 等静态图；把这部分降到目标需要 ESM splitting 或独立 worker bundle，属于单独的构建架构改动，不在拆包/测试修复批次内混做。
