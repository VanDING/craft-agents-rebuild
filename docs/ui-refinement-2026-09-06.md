# UI 与动效修复 · 2026-09-06

本次实现依据 [审视报告](ui-visual-motion-audit-2026-09-06.md)，保持现有轻表面、系统字体、紧凑列表和主题强调色。以下图片为修改后组件的实际 Chromium 渲染，Run 使用合成数据。

## 已实现

| 区域 | 修改后的行为 |
| --- | --- |
| Map 主题 | 修复所有 HSL 包裹完整颜色变量的无效声明；使用中性关系线、轻节点表面与主题选择边框，去掉重复网格/点阵、大阴影和紫橙侧条 |
| Map 初始视口 | 全图能保持至少 82% 比例时显示全图，否则定位可读的当前节点；“适配全部”仍为显式操作 |
| Map 详情 | 默认关闭；点击节点或详情按钮打开；760px 以下覆盖地图，较宽时并排。Esc/关闭按钮恢复触发节点焦点 |
| Map 缩放与调整宽度 | 按钮操作短暂平滑，拖拽与滚轮直接响应；缩窄时保留缩放，并保持原本可见的选中节点在视口内；不会把用户已经移开的画布强行拉回 |
| Run 字体 | 字体桥接接入真实字体栈，表格恢复 12px/18px、过滤按钮恢复 11px/16px；代码字体跟随主题字体变量 |
| Run 内容层级 | Overview 减少指标/摘要卡装饰，隐藏没有记录的环境字段，普通无异常状态不再占据大卡片；Context 减少外层阴影并提高原文与辅助文字可读性 |
| Run 切换 | 子视图首次访问后保留挂载和状态；切换时短淡入，活动下划线移动；支持左右方向键、Home、End。保留地图视口、筛选及视图内滚动状态 |
| Context / Inspector | 分类展开使用公共短时过渡；Inspector 轻淡入、使用普通背景层级 |
| 主操作颜色 | 桌面与共享主题补齐 primary 兼容名，映射到现有公共 Button 的 foreground/background，保持中性主操作风格；同时补齐 border-strong |
| 看板 | 恢复状态色标题胶囊与浅色列背景，沿用自定义列颜色配置；列编辑器跟随当前主题，取消强制深色 |
| 项目列表 | 窄面板保留任务名与状态，项目/日期/进度进入次行；不再强制 760px 六列表格；项目视图切换补短淡入 |
| Dialog / Popover | 只为公共基础组件启用 160ms 入场、100ms 退场淡入淡出；高频菜单维持原有即时行为，旧缩放/滑入效果仍禁用 |
| 空状态 | 简化普通面板的装饰图标；浏览器先展示三个示例，其余可展开，所有示例仍可操作 |
| 其他动效 | 设置展开、文件树与 Run CSS 接入公共时长；取消文件树累积的逐项延迟；浏览器持续扫光改为 CSS 动画，运行中切换减少动态效果可立即停止 |

## 验证结果

- `bunx tsc --noEmit -p packages/ui/tsconfig.json`：通过。
- `bunx tsc --noEmit -p apps/electron/tsconfig.json`：通过。
- 11 个聚焦测试通过：地图视口 resize 回归、会话关系布局与公共 motion token；新增测试覆盖选中节点在缩窄后可见、保留主动平移、忽略隐藏 Tab 的零尺寸。
- i18n parity 与排序检查通过；详情按钮补齐七份语言文件。
- `git diff --check`：通过。
- Chromium 20 项交互断言通过：Map 窄屏宽度、节点可见性、缩放保持、切换状态保留、详情打开/覆盖/inert/Esc/焦点恢复、Tab 键盘导航、减少动态效果、列表窄屏无横向溢出、浏览器示例折叠/展开、Dialog/Popover 的淡入与关闭卸载，以及浏览器扫光对系统动效设置的实时响应。
- 计算样式验证：Map 节点背景与阴影有效；表格与过滤按钮字号恢复；primary 背景/反色文字有效；Dialog 使用 `craft-content-enter`、160ms。

未运行全套测试，未重新打包或重启已安装的 Electron 客户端。验证环境为当前源码、Playground 与合成 Run 数据；真实移动设备、全部自定义主题、超大真实会话与所有连接平台页面尚未做全量视觉验收。

## 修改后截图

| 视图 | 图片 |
| --- | --- |
| Map · 宽面板 | [查看](assets/ui-refinement-2026-09-06/run-map.png) |
| Map · 窄面板 | [查看](assets/ui-refinement-2026-09-06/run-map-narrow.png) |
| Map · 深色窄面板 | [查看](assets/ui-refinement-2026-09-06/run-map-dark.png) |
| Map · 窄面板详情 | [查看](assets/ui-refinement-2026-09-06/map-inspector-narrow.png) |
| Run Overview | [查看](assets/ui-refinement-2026-09-06/run-overview.png) |
| Run Context | [查看](assets/ui-refinement-2026-09-06/run-context.png) |
| Run Trajectory | [查看](assets/ui-refinement-2026-09-06/run-trajectory.png) |
| 看板 | [查看](assets/ui-refinement-2026-09-06/kanban-board.png) |
| 窄面板项目列表 | [查看](assets/ui-refinement-2026-09-06/work-item-list-narrow.png) |
| 浏览器空状态 | [查看](assets/ui-refinement-2026-09-06/browser-frame-playground.png) |
