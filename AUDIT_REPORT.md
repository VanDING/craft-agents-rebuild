# Craft Agents — 全面代码审计报告 (2026-08-01)

审计对象: `/Users/van/projects/CraftAgent` @ HEAD `ef67d7ac` (clean tree)。范围: 全部 11 个 workspace 包、apps、构建配置、CI、Dockerfile、依赖。
方法: 7 个并行深度审计子任务 (Electron main/preload、Electron renderer+ui、shared、server 三包、messaging/iLink、session-tools/cli、构建配置) + 主审计对关键发现的逐条复核。每条发现均经源码验证,给出 file:line 与证据。旧版审计 (2026-07-22, AUDIT_REPORT.md) 的 30 项发现逐条复核。

---

## 0. 总体评估 (Executive Summary)

**结论: 迁移到单一 Pi SDK 后台后,代码库整体质量中等偏好,但存在 3 个 Critical 级安全漏洞、CI 长期全红、以及一批高危问题,当前状态不建议对外发布。**

最严重的三件事:

1. **Markdown 渲染器 `rehypeRaw` 无净化 → 存储型 XSS,可达 renderer 全量 RPC (RCE 级)**: LLM 输出可被提示注入,任何一条消息里的 `<iframe srcdoc>` 或 `onerror` 属性即可在 renderer 上下文执行任意 JS——而 renderer 持有 `electronAPI`(读任意文件、调任意 RPC、远程服务器 token)。
2. **Safe 模式不是安全边界**: `transform_data` (零隔离执行任意脚本) 和 `script_sandbox` (可读宿主机任意文件,包括应用自己的明文 credential 缓存) 都是 `safeMode: 'allow'`,在 Explore/Safe 模式下模型可直接调用。
3. **工程基线全红**: `validate:ci` (CI 唯一闸门) 在 clean main 上必然失败——server-core 测试文件仍断言已删除的 `'anthropic'` provider (typecheck 2 错)、session-tools-core 因 TS7 不再自动包含 @types 产生 201 个 tsc 错误、`lint:i18n:coverage` 引用不存在的 `scripts/check-i18n-coverage.ts`、`typecheck:all` 链中 `powershell dedupe.ps1` 在 macOS/Linux 直接中断导致 electron/ui 永远不被 typecheck。此外 Dockerfile.server 引用 3 个不存在的包路径无法构建,打包产物是 EOL 的 Electron 39.2.7 而开发/CI 用 43.1.1。

发现统计: **Critical 3 · High 16 · Medium 26 · Low 30+**,另有依赖审计 34 个已知漏洞 (2 critical / 19 high)。

---

## 1. CI / 构建基线 (全部实测)

| 项 | 状态 | 证据 |
|---|---|---|
| `bun run typecheck:all` | **FAIL** | `packages/server-core/src/domain/connection-setup-logic.test.ts:120,126` — `expect(conn.providerType).toBe('anthropic')`,而 `LlmProviderType` 现为 `'pi' \| 'pi_compat'` (`packages/shared/src/config/llm-connections.ts:50-52`)。commit `ebfe6ea8` 修了源码漏了测试。链路在 server-core 处中断 |
| `packages/session-tools-core tsc --noEmit` | **FAIL (201 错)** | tsconfig 无 `types` 字段且无 bun-types devDep;TS7 不再自动包含 `@types/*` (同配置 tsc@5.9.3 为 0 错)。`bun:test` TS2307 ×10 文件、`node:` TS2591 ×128、`loader.ts:151` TS7006 |
| messaging-gateway / whatsapp-worker | **隐性问题** | `bun:test` TS2307 同样存在,但两个包不在 typecheck 链里 → CI 从不检查 |
| `typecheck:all` 跨平台 | **双平台皆断** | 链中含 `powershell -ExecutionPolicy Bypass -File ../../scripts/dedupe.ps1`(macOS/Linux 无 `powershell` → 中断);而 `scripts/dedupe.ps1:2` 硬编码 `$projectRoot = "E:\craft-agents"`(Windows 其它路径下静默 no-op) |
| `lint:i18n:coverage` | **FAIL** | 引用 `scripts/check-i18n-coverage.ts`,文件不存在。根 package.json 共 **12 个 script 引用不存在的文件** (check-i18n-coverage.ts、electron-dev.sh、tail-electron-logs.sh、sync-secrets.sh、fresh-start.ts、build.ts、release.ts、check-version.ts、oss-sync.ts、typecheck-staged.sh、check-raw-sends.sh、check-task-tool-checks.sh) |
| `bun run test:shared:all` | **FAIL (3 fail)** | `storage-startup-migration.test.ts` 期望 Opus 4.8 默认值,实际迁移逻辑产出 4.7 — 迁移后测试未同步 |
| `.github/workflows/validate.yml` | 每 PR + push main 跑 `validate:ci` | 当前必然全红,无任何绿色信号;action 未 pin SHA、无 `permissions:` 最小权限块 |

**结论: 主分支上 CI 从迁移后一直处于不可用状态,且修复需要联动 (server-core 测试 → TS7 types → 恢复脚本 → 修 powershell 链)。**

---

## 2. Critical

### C-1. Markdown 渲染器 `rehypeRaw` 无净化 → 存储型 XSS,renderer 上下文 = RCE 级
- **文件**: `packages/ui/src/components/markdown/Markdown.tsx:624` — `rehypePlugins={[rehypeKatex, rehypeRaw]}`;全仓库无 DOMPurify/`rehype-sanitize`。仅 `a` 标签做 href 净化 (`Markdown.tsx:202-233`)。
- **证据**: hast-util-to-jsx-runtime 将全部属性透传给 React,`onerror`/`onload` 经 `setAttribute` 生效;`srcdoc` 不在 react-markdown 的 urlAttribute 名单里,`<iframe srcdoc="<script>…">` 原样透传且与父页面同源 → 脚本可直接访问 `window.parent.electronAPI`。
- **暴露面**: LLM 消息 (可提示注入)、plan、`markdown-preview`/`html-preview` 文件预览 (工作区内文件,含 git clone 的第三方内容)、viewer 的**任意用户上传 session JSON** (`apps/viewer/src/App.tsx:74`)。renderer 有 node shims 与 `window.electronAPI` (`apps/webui/src/App.tsx:95`)。
- **修复**: 移除 `rehypeRaw`(markdown 语法不受影响)或 DOMPurify allowlist;`srcdoc`/`style`/`on*`/`base`/`form` 全禁。

### C-2. Safe 模式允许任意代码执行: `transform_data` 零隔离 + `script_sandbox` 可读任意文件
- **文件**: `packages/session-tools-core/src/tool-defs.ts:580-581` — 两者 `safeMode: 'allow'`(可进 `SESSION_SAFE_ALLOWED_TOOL_NAMES`);`handlers/transform-data.ts:106-112` spawn 任意脚本无文件/网络隔离;`runtime/filesystem-isolation.ts:29-46` macOS sandbox profile `(allow file-read*)`、Linux `bwrap --ro-bind / /` — 读不限、写限 session 目录。
- **证据**: sandbox 脚本可 `cat ~/.ssh/id_rsa`、`~/.aws/credentials`,以及应用自身的**明文 credential 缓存** `~/.craft-agent/workspaces/*/sources/*/.credential-cache.json` (session-mcp-server `index.ts:79-105` 明文写解密凭据);`transform_data` 还能任意写 + 联网,且经 MCP server 暴露给 Codex/Copilot。Safe 模式本应禁止 bash/文件读。
- **修复**: 两者改 `safeMode: 'block'` 或接入与 Bash 相同的权限门;`transform_data` 复用与 `script_sandbox` 一致的隔离;sandbox 读权限收敛到 session 树。

### C-3. 依赖供应链: 34 个已知漏洞,2 critical + 19 high,含直接依赖
- **证据** (`bun audit` 实测): **critical** — `xmldom` (markitdown-js)、`node-tesseract-ocr` 命令注入 (markitdown-js,CLI 文档工具处理不可信文件);**high** — `undici 8.0.0` (apps/electron/package.json:77 直接 pin,`<8.5.0` 含 TLS 校验绕过 GHSA-vmh5-mc38-953g 等;`main/network-proxy.ts:10` 直接使用 ProxyAgent)、`marked 18.0.0` (OOM DoS)、`js-yaml 5.0.0` (指数解析 DoS)、`sharp 0.34.5` (electron 侧,与根 0.35.3 双版本)、`music-metadata` (baileys/whatsapp)。
- **修复**: undici ≥8.5.0、marked >18.0.1、js-yaml ≥5.1.1、tar >7.5.20、统一 sharp 0.35.x;评估 markitdown-js 对不可信文件的暴露。

---

## 3. High (16)

| # | 问题 | 位置 | 要点 |
|---|---|---|---|
| H-1 | Browser pane 可读任意本地文件 | `main/browser-pane-manager.ts:735-751` (`navigate()` 的 scheme 正则 `file://` 放行) + `handlers/browser.ts:166-171` (`EVALUATE` 无 gate) | 提示注入的 agent → `file:///…/.ssh/id_rsa` → `evaluate('document.body.innerText')` 外带;WS 路径无 `requireOwnedInstance`/`getAllowRemoteEvaluate` 隔离 (对比 capability 路径 `browser-pane-manager.ts:2436-2461` 有) |
| H-2 | `server:invokeOnServer` 无验证 RPC 桥 + 全链路 `tlsRejectUnauthorized: false` | `main/index.ts:775-779`;`preload/bootstrap.ts:125,149`;`handlers/workspace.ts:29` | renderer 提供 url/token/channel/args 四项,无 sender 校验、无 channel allowlist;绕过 CHANNEL_MAP;TLS 全关 → 令牌可被 MITM。旧 C-3 **仍未修** |
| H-3 | Browser-pane 权限自动放行任意 origin | `browser-pane-manager.ts:3266-3290` | `clipboard-read`/`media`/`geolocation`/`notifications`/`idle-detection` 对任何被浏览网站静默授予 → 剪贴板是凭据外带通道 |
| H-4 | iLink WeChat token 明文落盘,遗忘不清理,QR 登录重复外发 | `adapters/wechat/ilink/auth/accounts.ts:262-308`、`inbound.ts:151-165`;`registry.ts:809-823` | bot token + context token 明文写 `~/.craft-agent/wechat`(0644),每次启动从加密库复制一份;`forgetPlatform` 不删;`login-qr.ts:230-250` 每次 QR 登录把最多 10 个历史 token 发给 iLink 服务器 (`local_token_list`) |
| H-5 | CDN 媒体下载无超时/无大小上限,串行轮询循环内 | `ilink/cdn/pic-decrypt.ts:52-62`、`monitor.ts:243-255` | 一条挂死/巨型下载阻塞整个账号收信,内存/磁盘可耗尽;`saveMedia` 声明 `_maxBytes` 但故意忽略 |
| H-6 | 出站 WeChat 发送把 HTTP 错误当成功 | `api.ts:365-411` (`apiPostFetch` 在 `!ok` 时返回 body)、测试明确断言此行为 | 静默丢消息、无重试/幂等;caption/media 两条消息可失配 |
| H-7 | `file:readUserAttachment` 读任意绝对路径 | `server-core/handlers/rpc/files.ts:171-191` | 注释声称"OS 选择器写入 drafts.json 所以路径隐含同意",但 RPC 从不校验来源。`~/.ssh/id_rsa`、`~/.aws/credentials` 任意读 (≤50MB) |
| H-8 | `file:read` 黑名单漏 `~/.craft-agent/credentials.enc` + `config.json`;.enc 密钥 = PBKDF2(机器 UUID,盐在文件头) | `handlers/utils.ts:119-129`;`shared/src/credentials/backends/secure-storage.ts:319-333` | 持 token 者可经 `file:read` 拿加密库 + 经 agent 自身 bash 拿机器 UUID → 离线解密全部密钥;`config.json` 含 `serverConfig.token` |
| H-9 | workspace SVG 图标存储型 XSS | `server-core/handlers/rpc/workspace.ts:206-280` (WRITE_IMAGE 不净化) + `:150-188` (注释: "caller will use as innerHTML") | 恶意仓库/技能图标 `<svg onload>` → renderer 任意 JS → 可调 H-7/H-8 |
| H-10 | `web_fetch` `redirect: 'follow'` 不重新校验 | `pi-agent-server/src/tools/web-fetch.ts:366` (仅初始 URL 校验 `:73-95`) | 公开 URL 302 到 `127.0.0.1`/云 metadata → SSRF;IPv4-mapped IPv6 `[::ffff:7f00:1]` 仅被"偶然"拦截 (bracketed 字面量 DNS 失败),AAAA 记录直通 |
| H-11 | token 刷新 provider 混淆: xAI/Kimi 的 refresh token POST 到 ChatGPT 端点 | `shared/src/agent/pi-agent.ts:795-810` → `auth/chatgpt-oauth.ts:138-160` | 新统一 Pi OAuth (commit 855c9612) 存了 grok-x/kimi 的真实 refresh token,但唯一刷新路径除 Copilot 外一律走 `refreshChatGptTokens` → (1) xAI/Kimi 约 1 小时后连接必断 (2) **跨 provider 凭据泄露** (token 发给 OpenAI) |
| H-12 | OpenRouter OAuth 可永久挂起 + callback server 泄漏 | `server-core/handlers/rpc/llm-connections.ts:988-1041` | `credPromise` 无超时;`httpServer.close()` 在失败路径被跳过;`resolveCred(Promise.reject(...) as any)` 反模式 |
| H-13 | `source_test`/`config_validate` sourceSlug 无校验 → 路径穿越 + SSRF + 自动激活 | `session-tools-core/src/source-helpers.ts:31`;`handlers/source-test.ts:100-118` | `../../` 可读任意目录 config.json 并以其 baseUrl 发起带凭据探测 (`safeMode: 'allow'`);`skill_validate` 有 `validateSlug`,这俩没有 |
| H-14 | MCP server: tool args 从不 zod 校验;`_precomputedResult` 模型可伪造;docs 代理原样转发 | `session-mcp-server/src/index.ts:425-460, 277-306` | Schema 只用于广告不用于校验;`call_llm`/`spawn_session` 信任参数里 JSON 串 → 伪造 LLM 结果;`docsUpstream` 把工作区数据发给第三方 `agents.craft.do` |
| H-15 | 远程服务器 WS token 驻留 renderer 内存 | `renderer/components/app-shell/SendResourceToWorkspaceDialog.tsx:145-150` | 与 C-1 组合:一次 XSS 即外带/冒用远程服务器 (token 应只在 main 进程解析) |
| H-16 | preload capability 边界无验证 | `preload/bootstrap.ts:161-170` | `CLIENT_OPEN_EXTERNAL → shell.openExternal` 不分类;thin-client 模式下被攻陷的远程服务器可直接打开 `file:` (Windows = RCE 类) |

---

## 4. Medium (26, 精选)

**安全:**
- M-1 无 session/workspace 归属校验: `transport/server.ts:459-467,727` 客户端自报 workspaceId;`sessions.ts` GET/DELETE/SEND_MESSAGE/EXPORT 全部信任客户端 id → 任意 token 持有者可读写任意工作区 session、注入 prompt、触发工具执行
- M-2 `pi-agent-server` 本地 `call_llm` HTTP 端点无鉴权/无 body 上限/无 Origin 检查 (`index.ts:318-350`) → 配额燃烧 + DNS rebinding 驱动滥用
- M-3 WebUI 登录限流全局共享 (`webui/http-server.ts:183`, `getClientIp` 默认返回常量 `'direct'`) → 20 次尝试锁死所有 IP;logout 不撤销 JWT (24h,无 jti)
- M-4 custom-endpoint `baseUrl` 零校验且携带真实 API key (`pi-agent-server/index.ts:403-417,457-467`) — 恶意/被种的工作区配置可泄 key + SSRF
- M-5 QR 登录 redirect_url 完全信任 (`login-qr.ts:390-425`) — 服务器下发 baseUrl 成为全部后续请求目标,`Authorization: Bearer` 发往该主机,无 scheme/域名白名单
- M-6 iLink 状态非 workspace 隔离 (`state-dir.ts:25-31`, `inbound.ts:18-23`) — 跨工作区游标互踩;QR 登录把兄弟工作区 token 发给 iLink 服务器
- M-7 SVG 图标 regex 净化可绕过 (`renderer/lib/icon-cache.ts:705-717` + `dangerouslySetInnerHTML`) — 未引号属性/`JAVASCRIPT:`/HTML 实体编码绕过
- M-8 `auth:logout` 无服务端防护销毁全部凭据 + config.json (`server-core/handlers/rpc/auth.ts:38-56`)
- M-9 WS server 无 `maxPayload` (`transport/server.ts:281`) + handler 超时竞态 (超时后 handler 继续跑,setTimeout 不清理)
- M-10 `transfer:start/chunk` 无 totalBytes/chunkCount 上限 → 磁盘耗尽 (`transfer.ts:112-181`)

**正确性/资源:**
- M-11 transform/script 超时只杀直接子进程,孤儿存活 + stdio 管道不关 → 工具永久挂起 (`transform-data.ts:115-140`、`script-sandbox.ts:134-163`)
- M-12 生产路径从不清理 per-session 状态: `modeManager` states/callbacks/subscribers、`sessionToolsCache`、`sessionPlanFilePaths` (cleanup 函数仅测试调用,`mode-manager.ts:352,521`、`session-scoped-tools.ts:185-189`)
- M-13 `pendingPermissions` 崩溃时不 reject → 挂起 + Map 泄漏 (`pi-agent.ts:1356-1380` vs `handleSubprocessExit:1742-1789` 缺此项)
- M-14 `handleCorruptedFile` 任何解密失败即删整个凭据库 (`secure-storage.ts:341-357`) — Linux machine-id 变更 = 全部凭据丢失
- M-15 `persistence-queue.flush()` 不等在途写 (`persistence-queue.ts:186-204`) → 退出时数据丢失
- M-16 工具元数据每次调用全量同步重写 O(n²) + `_metadataMap` 无界 (`interceptor-common.ts:293-340`);`_sessionDir` 跨 session 写错文件 (旧 M-1 未修)
- M-17 `interceptor-common.ts:320-340` mergeAndWriteMetadata TOCTOU 仍存在 (只对异常重试,不对丢更新重试)
- M-18 TaskRunner 无墙钟超时,`verifying` 可永久挂起 (`tasks/TaskRunner.ts:530-537`)
- M-19 Lark adapter `destroy()` 不停止 WSClient → 每次重连双 socket 重复投递 (`adapters/lark/index.ts:302-312`;旧 6.5 唯一仍存的项)
- M-20 入站 at-most-once: sync-buf 先落盘后派发,处理失败即丢消息 (`monitor.ts:235-256`)
- M-21 source config/会话记录 0644 世界可读 (`shared/src/sources/storage.ts:142` 等) — 内含 OAuth client secret

**构建/配置:**
- M-22 打包产物是 EOL Electron 39.2.7,开发/CI 用 43.1.1 (`electron-builder.yml:7`)
- M-23 OAuth define 双构建路径不一致,`build:main` 会把 `GOOGLE_OAUTH_CLIENT_SECRET` 烘焙进 bundle (`apps/electron/package.json:18` vs `electron-build-main.ts:30-47` 注释声称不烘焙)
- M-24 GitHub Actions 未 pin SHA、无 `permissions:`;bun 版本三处不一致 (1.3.10 CI / 1.3.14 本地 / 1.3.9 bundle)
- M-25 `.env.example` 过期: 记录已删除的 ANTHROPIC_API_KEY,`CRAFT_SERVER_TOKEN` 等 ~30 个真实环境变量未记录
- M-26 bunfig preload 全局 fetch 拦截器注入所有 bun 进程 (`unified-network-interceptor.ts:2266-2270`) — 供应链面大,无 host 过滤 (旧 A-3/M-3 未修)

---

## 5. Low (精选 12 / 30+)

- L-1 `StoredMessage` 仍缺 `hidden` 字段;`message-mapper.ts` 单断言掩盖 (`core/src/types/message.ts:236,300-390`)
- L-2 `generateMessageId` 仍用 `Math.random()` (`message.ts:590-592`);session-tools `generateRequestId` 同 (`source-helpers.ts:182`)
- L-3 `summarize.ts` 空存根仍被 SessionManager 3 处"带注释地"调用 (注释声称会重置缓存 — 虚构) (`shared/src/utils/summarize.ts`)
- L-4 死代码: `AnthropicModelFetcher` + `BedrockVertexModelFetcher` 未注册 (`model-fetchers/registry.ts` 只有 PiModelFetcher);`shared/src/validation/url-validator.ts:8` 仍 import 已删除的 `@anthropic-ai/claude-agent-sdk`;`ilink/cdn/cdn-upload.ts`、`downloadRemoteImageToTemp` (潜在 SSRF) 零调用
- L-5 迁移残留: `packages/shared/src/agent/backend/factory.ts.bak` 已提交进仓库
- L-6 `killShell` 正则转义当 shell 转义 (`SessionManager.ts:6680-6701`);`privileged-execution-broker.ts:178-184` 审计日志明文存完整命令
- L-7 `thumbnail://` 协议可对任意绝对路径出缩略图 (`thumbnail-protocol.ts:130-163`,corsEnabled)
- L-8 应用级 IPC 无 sender 校验: `workspace:remove`/`app:relaunch`/`__get-ws-token`/`__get-ws-port` (`main/index.ts:494-498,769-772,909-911,943`)
- L-9 主窗口 + toolbar BrowserView 仍 `sandbox: false` (pane 已 true) (`window-manager.ts:257-261`、`browser-pane-manager.ts:402-408`)
- L-10 preload 仍 6 个 `sendSync` (`bootstrap.ts:56,81,99-101,113`);`(api as any)` 7 处 + `invokeOnServer(…args: any[])`
- L-11 `install-server.sh:52-81` 明文打印 server token;`main/index.ts:1051` headless 打印 `CRAFT_SERVER_TOKEN`;CLI `--api-key` 进 ps (`cli/index.ts:31-33`)
- L-12 deep-link 查询参数仍原样透传 (`deep-link.ts:181-188`) + 100ms 时序假设 (`:215`);`craftagents://` 协议注册 (`index.ts:235-241`) 使任意网页可触发 `delete-session` action (renderer 需二次确认)
- L-13 husky 零钩子 (无 pre-commit/commit-msg);`test-workflow-local.sh:5` 硬编码个人路径 `/Users/ghalmos/Workspace/…`
- L-14 renderer: `MemoizedMarkdown` 比较器丢弃 `onUrlClick`/`onFileClick` 回调 (`Markdown.tsx:640-655`);菜单订阅 `[]` deps 捕获首帧闭包 (`App.tsx:1148-1163`);3 处 render 期 `clientHeight` 读取 (`useResizeGradient.ts:118`、`AppShell.tsx:3632,3667`);Mermaid ref 渲染期写入 (`Markdown.tsx:588-590`)
- L-15 `CRAFT_HEALTH_PORT` NaN 绕过端口守卫 (`server/src/index.ts:293`);server token `===` 非恒时比较 (`headless-start.ts:302`)

---

## 6. 旧审计复核总表 (2026-07-22 → 2026-08-01)

**已修复 (10)**: C-2 打包依赖机制重构 · A-5 ElectronAPI 接口补全 · M-2 credential pendingRefreshes 泄漏 · M-5 loadStoredConfig 就地修改 · M-8 mcp toolCache 失效 · H-5/H-6 CLI 双重销毁与 cmdSend 丢消息 · L-2 message-mapper 双重断言 · L-5 "seperate" 拼写 · M-9 WeChatConnectDialog stale closure · 6.6b script-sandbox 路径校验 · plan-tokens 熵 (randomBytes 48bit) · 6.5 renderer 竞态/Telegram 轮询泄漏 · TurnCard/handleSubmitFollowUp/deep-link renderer 侧

**仍存在或部分 (20)**: C-3 TLS 跳过 (3 处) · C-4 sendSync ×6 · C-5 SSRF 主体 (redirect 绕过 + IPv4-mapped IPv6 残留) · H-1 token 互斥锁 (dormant 但未修) · H-3 `as any` ×7 · H-4 Sentry 嵌套净化不全 · H-7 SessionManager 8884 行 · H-8 MCP 看门狗吞异常(同族) · H-9 toolbar sandbox:false · M-1 `_sessionDir` · M-3 pendingPermissions · M-4 `_metadataMap` · M-6/M-7 TOCTOU/缓存 · L-1/L-3/L-4/L-8~L-13 多数 · A-2/A-3/A-4/A-6/A-7 全部

---

## 7. 已确认的良好实践 (值得保留的模式)

- capability 分发器 `__browser:invoke` (版本检查 + owner-key 命名空间 + `requireOwnedInstance` + evaluate gate) 是正确范式,WS 路径应照抄
- 主窗口 `will-navigate` + `setWindowOpenHandler` 全部经 `classifyExternalUrl` 分类;pane 弹窗 `sandbox: true` 且限 http/https
- OAuth: `randomBytes` state + PKCE + 5 分钟 TTL 的 `OAuthFlowStore`,WebUI JWT 显式 `algorithms: ['HS256']`、HttpOnly + SameSite=Strict、argon2id
- 凭据主库 AES-256-GCM + 0600;bootstrap token 熵校验 (≥16 字符、拒绝单字符重复)、非 loopback 绑定强制 TLS
- pairing 6 位码 crypto randomInt + 5 分钟 TTL + 速率限制;access-control 绑定前/绑定后双重门
- 传输层身份校验/重连时序正确;`transfer:commit` 字节数 + SHA-256 校验;`allowModelNetwork: false` 传入 Pi runtime
- renderer 原子无密钥;11 个 setInterval 全部有 cleanup;HTML 预览 iframe `sandbox` 无 `allow-scripts`;KaTeX `trust: false`;shiki/beautiful-mermaid 转义正确

---

## 8. 修复优先级

**P0 (阻断发布):**
1. C-1 rehypeRaw XSS — 移除或 DOMPurify
2. C-2 transform_data/script_sandbox safeMode 收口 + sandbox 读权限收敛 + 凭据缓存加密/移出
3. CI 恢复: server-core 测试改 `'pi'` → session-tools-core/messaging 加 `types: ["node","bun"]` → 恢复/删除 12 个缺失脚本 → typecheck 链去掉 powershell (改用跨平台脚本)
4. H-4 iLink 凭据加密落盘 + forget 清理 + QR `local_token_list` 移除
5. H-11 provider 混淆刷新 (xAI/Kimi 独立刷新端点或强制重认证)

**P1 (高危):**
- H-1/H-2/H-3 browser pane 三件套 (file:// 拦截、EVALUATE gate、权限白名单收窄)+ H-16 capability 边界校验
- H-7/H-8 文件读取收口 (`drafts.json` 溯源 + `.craft-agent` 进黑名单 + 密钥改 keychain 派生)
- H-9 SVG 图标改 `<img src>` 或 DOMPurify;H-10 web_fetch redirect 手动模式逐跳校验;H-12 OAuth 超时 + finally close;H-13 sourceSlug 校验;H-14 MCP args safeParse + 去掉 `_precomputedResult`
- H-5/H-6/H-15 媒体超时上限、出站错误处理、token 移出 renderer
- 依赖升级: undici ≥8.5.0 / marked / js-yaml / tar / sharp 统一;Dockerfile.server 删 3 条幽灵 COPY;electronVersion 对齐 43.x

**P2 (迭代):**
- M-1 session/workspace 归属校验;M-2 call_llm 鉴权;M-3 限流按真实 IP;M-9 maxPayload;M-10 传输上限
- M-11~M-18 资源清理/超时/原子写 (cleanup 函数接上生产路径、pendingPermissions 崩溃 reject、flush 等写、凭据库备份而非删除)
- 旧低危项批量清理 (死代码、0644、factory.ts.bak、.env.example、IPC sender 校验)

---

*方法说明: 静态代码审计 + 实测 (typecheck:all / 各包 tsc / bun audit / test:shared:all / 脚本存在性)。竞态与时序类发现基于代码路径分析,标注 [SPECULATIVE] 的为推断;其余均引用原文验证。完整分项报告: `local://audit-electron-main.md`、`local://audit-electron-renderer.md`、`local://audit-shared.md`、`local://audit-servers.md`、`local://audit-messaging.md`、`local://audit-sessiontools-cli.md`、`local://audit-buildconfig.md` (会话内本地文件)。*
