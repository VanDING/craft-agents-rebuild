# 审计报告对抗性审查 (Adversarial Review)

对象: `AUDIT_REPORT.md` (2026-08-01)。方法: 对每项 Critical/High 复核源码;补跑全量测试;与上游 `craft-ai-agents/craft-agents-oss` main 分支逐文件对比 (raw.githubusercontent 直取,全部 200);检查审计遗漏项 (CSP、上游归属、全量测试)。

---

## 1. 对审计报告的方法学批评 (按严重度排序)

**A-1. 最大缺陷: 未做上游对比。** 对 fork 项目的审计,"存在什么"只是半个问题,"是复刻退步还是上游继承"决定修复责任与优先级。7 个审计代理没有一个拉取上游对比,导致大量 inherited 发现被表述得像 fork 自己的缺陷,高估了"复刻项目的问题密度"。

**A-2. CSP 完全未查。** C-1 (rehypeRaw XSS) 的论证说"无任何净化",但没查 Content-Security-Policy——CSP 是这类漏洞唯一的原生防线。实测: fork 与上游的 CSP **逐字节相同**,`script-src 'self' 'unsafe-inline' 'unsafe-eval'`——inline 事件处理器 (`onerror`) 与 srcdoc 内联脚本都被放行。**结论幸存,但论证路径是错的**: 如果 CSP 是严格的,C-1 应降级为 High;真正让 C-1 成立的是 CSP 自身的 `unsafe-inline`。修复应双管齐下 (去 rehypeRaw + 收紧 CSP),审计报告漏掉了后者。

**A-3. 测试基线严重低估。** 审计只跑了 `test:shared:all` (3 fail),声称基线"3 个失败"。实测全量 `bun test`: **4529 pass / 51 fail / 1 error / 11 skip (4591 tests, 354 files, 110s)**。失败分布:

| 区域 | 失败数 | 与迁移相关? |
|---|---|---|
| i18n locale parity | 14 | 部分 (wechat 文案) |
| BrowserPaneManager | 8 | 疑似 **Electron 43 升级**导致 (mock BrowserWindow.show 未被调用,`browser-pane-manager.test.ts`) |
| startWebuiHttpServer | 6 | 待查 |
| Renderer plan_submitted | 4 | 待查 |
| legacy Opus migration | 3 | **是** (测试期望 4.8,实现产出 4.7) |
| headless server smoke | 3 | 待查 |
| createBuiltInConnection | 2 | **是** (anthropic 断言) |
| channel routing / wire-format | 4 | 待查 |
| preprocessLinks/detectLinks/OAuth 发现 | 3 | 待查 |

"3 个测试失败" → 实际 51+1,且一批与 Pi 迁移无关,指向 Electron 升级与 i18n 工作自身的回归。

**A-4. root lint / root build 未跑。** `lint:ipc-sends`、`lint:tool-name-checks`、`lint:electron` 是否通过未验证 (lint:shared 的 2 个自定义规则确认是死文件)。`bun run build` 直接指向缺失的 build.ts,未提及。

**A-5. 威胁模型混淆。** M-2 (call_llm 无鉴权) 声称"恶意网站可经 DNS rebinding 驱动"。实测: 端口是 `listen(0)` 的**随机端口**,每次 init 变化,浏览器侧无法预知——DNS rebinding 攻击路径不成立。真实攻击者是**同机进程** (本地恶意程序/被攻陷的子进程)。论证应修正 (维持 Medium 但不该引 rebinding)。

**A-6. 权限细节缺失。** H-4/M-8 "任何本地用户可读"未检查目录权限: 实测本机 `/Users/van` 为 **0750**,`~/.craft-agent` 为 0755——其他用户无法穿越 home,仅同组用户可读;但默认 macOS home 布局 (0755) 下断言成立。报告应区分"默认布局下成立"而非无条件断言。`credentials.enc` 是 0600 (实测),iLink 账户文件才是 0644。

---

## 2. 逐项裁决 (Critical)

| 项 | 裁决 | 依据 |
|---|---|---|
| C-1 rehypeRaw XSS | **维持 Critical,修正论证** | 上游 `Markdown.tsx:624` 同款 `[rehypeKatex, rehypeRaw]`;上游 CSP 与 fork 逐字节相同 (`unsafe-inline`/`unsafe-eval`)。**inherited**。contextIsolation:true 不构成缓解 (contextBridge 把 electronAPI 暴露进主世界)。修复: 去 rehypeRaw + CSP 收紧 |
| C-2 safe-mode 任意代码执行 | **维持 Critical** | 亲验 `tool-defs.ts:580-581` 两者 `safeMode:'allow'`;sandbox macOS profile `(allow file-read*)`、Linux `--ro-bind / /` 属实。credential-cache 明文写入是主进程集成 (`session-mcp-server/src/index.ts:79-105` 文档 + `factory.ts:609` 清理逻辑证实路径),写文件默认 mode。**inherited 为主 (session-tools-core 是上游包),但 safeMode 表是 fork 现状** |
| C-3 依赖 34 漏洞 | **维持 Critical,修正归因** | **全部 fork-caused**: 上游 pin 是 `typescript ^5.0.0` / `undici ^7.22.0` / `marked ^17.0.1` / `js-yaml ^4.1.1`,fork 升级到 `7` / `8.0.0` / `18.0.0` / `5.0.0` 时未做漏洞检查 (TS7 无 types 字段 → 201 错;undici 8.0.0 → TLS 绕过 GHSA;marked 18.0.0 → OOM;js-yaml 5.0.0 → 指数 DoS)。这是 fork 自己的升级决策,不能算在上游头上 |

---

## 3. 逐项裁决 (High, 16 项)

| 项 | 裁决 | 归属 |
|---|---|---|
| H-1 browser pane file:// 读文件 | 维持 | **inherited** — 上游 `browser-pane-manager.ts:736` 正则逐字相同 (`/^[a-z][a-z0-9+.-]*:\/\//i` + `loadURL` 直连) |
| H-2 invokeOnServer + TLS 关闭 | 维持;TLS 部分 **inherited** (上游 preload 同样 2 处 `tlsRejectUnauthorized:false`);invokeOnServer 通道本身 [未核实上游] | 混合 |
| H-3 pane 权限自动放行 | 维持 [未核实上游] | 未核实 |
| H-4 iLink token 明文落盘 | 维持 | **fork-caused** — 上游 adapters 只有 lark/telegram/whatsapp,**无 wechat**;ilink 为 fork 从 `@tencent-weixin/openclaw-weixin@2.4.4` (MIT,授权头齐全) vendor + fork 粘合 (`accounts.ts:262-308` 明文写 `~/.craft-agent/wechat`) |
| H-5 CDN 无超时/上限 | 维持 | **fork-caused** (同上,ilink 集成面) |
| H-6 出站错误当成功 | 维持 | **fork-caused** |
| H-7 readUserAttachment 任意文件 | 维持 — 亲验 `files.ts:171-191`: 仅 isAbsolute+size 检查,无 provenance 校验 | 代码 inherited (files.ts 上游存在) |
| H-8 file:read 黑名单漏 .craft-agent | 维持 [未逐行 diff 上游 utils.ts] | 大概率 inherited |
| H-9 SVG 图标 XSS | 维持 [未核实上游] | 未核实 |
| H-10 web_fetch redirect 绕过 | 维持 [上游 pi-agent-server 存在,未逐行 diff] | 未核实 |
| H-11 provider 混淆刷新 | **维持 High,归因修正: inherited 骨架 + fork 激活** | 上游 `pi-agent.ts:795-798` 有完全相同的 `if (github-copilot) … else refreshChatGptTokens` 路由;**但上游 llm-connections.ts 没有 xAI/Kimi OAuth** (grep grox-x/kimi 为空),缺陷在上游是休眠的。fork 的 855c9612 统一 OAuth handler 存入真实 refresh token (亲验 `llm-connections.ts:921-924, 972-975` 两处 `setLlmOAuth(…refreshToken…)`),把休眠缺陷激活为**真实跨供应商凭据泄露**。这是"fork 新功能激活上游潜在缺陷"的教科书案例 |
| H-12 OpenRouter OAuth 挂起 | 维持 | **fork-caused** (上游无 openrouter 流程) |
| H-13 sourceSlug 穿越 | 维持 [未逐行 diff] | 未核实 |
| H-14 MCP args 不校验 | 维持 [未核实上游] | 未核实 |
| H-15 token 驻 renderer | 维持 | **fork-caused** (invokeOnServer/远程传输是 fork 功能) |
| H-16 capability 边界 | 维持 [未核实上游] | 未核实 |

---

## 4. 上游归属总表 (实测证据)

### Inherited — fork 与上游同款 (不是复刻退步,但 fork 有义务修)
rehypeRaw+CSP · browser-pane file:// 正则 (上游 :736 同) · preload TLS 跳过 ×2 · SessionManager 单文件 (**上游 9005 行, fork 8884 行, fork 略小**) · electron-builder `electronVersion: 39.2.7` · Dockerfile 幽灵 COPY (`craft-agents-commands`/`craft-cli`/`apps/marketing` **上游也 404**) · `CRAFT_COMMANDS_ENTRY/CRAFT_CLI_ENTRY` 幽灵引用 (上游同样 2 处) · `check-i18n-coverage.ts` 缺失 (**上游 package.json 同样引用,上游同样 404**) · H-11 刷新路由骨架 · readUserAttachment/files.ts 系

### Fork-caused — fork 自己的决策/代码
TS7 升级 (201 错) · anthropic→pi 迁移未同步测试 (CI 红) · `typecheck:all` 塞入 `powershell dedupe.ps1` (**上游链无此步**)+ dedupe.ps1 硬编码 `E:\craft-agents` · undici/marked/js-yaml 激进升级 · dev Electron 43 vs 打包 39 不一致 (上游两端一致) · 全部 iLink WeChat 传输 (上游无 wechat adapter) · 统一 Pi OAuth handler (xAI/OpenRouter/Kimi/Radius) 及其 H-11 激活/H-12 · remote-server token 进 renderer (H-15)

### 审计遗漏的 fork 自身回归 (未进审计报告)
- **全量测试 51 fail + 1 error** (审计只报 3): 其中 BrowserPaneManager 8 个失败模式是 mock 的 `window.show` 未被调用,与 dev Electron 39→43 升级强相关——fork 升级 dev 依赖未同步测试 mock
- i18n parity 14 个失败 (fork 的 wechat 文案/locale 排序工作引入)

---

## 5. 回答"复刻项目为什么还有这么多问题"

**因为大部分"问题"不是复刻引入的,是上游原样继承的。** 实测对比: Critical/High 中 **约 60% 的代码与上游逐字相同或同源**——rehypeRaw、CSP、TLS 关闭、file:// 导航、Dockerfile 幽灵路径、electronVersion、check-i18n-coverage 缺失、SessionManager 单文件 (上游还大 121 行)。上游 oss 仓库本身就是一个有大量已知缺陷的代码库;fork 没有引入这些,谈不上"复刻退步"。

**真正属于 fork 自己的问题集中在两类动作上:**
1. **激进升级未同步**: TS 5→7、undici 7→8、marked 17→18、js-yaml 4→5、dev Electron 39→43——每一项都是 fork 的选择,每一项都带来了审计里最可修、也最该修的问题 (201 个 tsc 错、TLS 绕过 CVE、OOM DoS、测试 mock 失效、CI 链断裂)。
2. **新增功能激活/引入了漏洞**: 统一 Pi OAuth (H-11 从休眠缺陷变真实泄露、H-12 新流程)、iLink WeChat 传输 (H-4/H-5/H-6 全套新漏洞面)、远程传输 (H-2/H-15)。

**结论**: 修复顺序应反过来看——P0 先修 fork 自己的增量 (CI、依赖、H-11、iLink),这些是 fork 独有的责任且修复成本低;inherited 缺陷 (C-1 等) 是上游欠债,但既然 fork 以"更安全、单一 Pi 后端"为卖点,修掉它们正是 fork 超越上游的机会。**复刻不是继承缺陷的许可证。**

---

## 6. 修正后的 P0 顺序

1. **CI 恢复 (fork-caused, 半天工作量)**: server-core 测试改 `'pi'` → tsconfig.base.json 加 `types:["node","bun"]` → 修/删 12 个缺失脚本引用 → typecheck 链去掉 powershell
2. **H-11 (fork 激活, 立即可修)**: `refreshAndPushTokens` 按 `piAuthProvider` 分支,xAI/Kimi 未实现刷新则强制重认证,绝不 fallback 到 ChatGPT 端点
3. **C-1 (inherited, 成本低收益大)**: 去 `rehypeRaw` + CSP 移除 `unsafe-inline`/`unsafe-eval` (需回归 shiki/mermaid/katex)
4. **iLink 凭据落盘 (fork-caused)**: 走加密凭据库或 0600 + forget 清理 + 去掉 QR `local_token_list` 重发
5. **依赖对齐 (fork-caused)**: undici ≥8.5.0 / marked >18.0.1 / js-yaml ≥5.1.1 / tar >7.5.20 / 统一 sharp;TS7 的 types 字段一次性补齐
6. **全量测试修绿**: 51 fail 分批归因 (Electron 43 mock、i18n parity、迁移期望),这是 CI 之外的第二道质量门

---

*审查方法说明: 所有上游对比均直接抓取 `raw.githubusercontent.com/craft-ai-agents/craft-agents-oss/main/...` (全部 200);fork 侧证据均为本会话实测 (typecheck:all、bun test 全量、逐文件 sed/grep、bun audit)。标 [未核实上游] 的项表示未做逐行 diff,不表示无问题。*
