# Craft Agents — 全面代码审计报告 (v2, 合并版)

审计对象: `/Users/van/projects/CraftAgent`。基线 HEAD `ef67d7ac`(2026-08-01 首版审计),本版合并原 `AUDIT_REPORT.md` + `AUDIT_REVIEW.md`(对抗性审查的修正、归属裁决、方法局限全部并入),并纳入截至 `80559086` 的修复执行状态。

**文档约定**: 每条发现带 `[级别] 标题 — 状态 — 归属`。状态: `OPEN`(未修)/ `FIXED <commit>` / `PARTIAL`。归属: `inherited`(上游原样/同源)/ `fork-caused`(本仓库自引入)/ `混合`(上游骨架 + fork 激活)。

## 更新记录

| 日期 | 变更 |
|---|---|
| 2026-08-01 v1 | 首版全面审计 (7 并行审计 + 主审计复核) + 对抗性审查 |
| 2026-08-01 v2 | 合并两报告;标注 `27140e2a`(Pi SDK 0.83.0 + shiki peer)、`be8ad661`(SDK 无头 OpenRouter OAuth)修复项;H-12/M-1/C-3 等状态更新 |

---

## 0. 总体评估

**结论: 迁移到单一 Pi SDK 后台后代码库整体质量中等偏好,但存在 3 个 Critical 级安全漏洞、CI 长期全红、以及一批高危问题。约 60% 的 Critical/High 为上游 `craft-agents-oss` 原样继承,不是复刻退步;fork 自己的问题集中在"激进升级未同步"与"新增功能激活/引入漏洞"两类。**

修复进度(截至 v2): 5 项已修 (H-12、Pi 版本漂移、shiki peer、依赖声明统一),其余 OPEN。

---

## 1. CI / 构建基线(实测)

| 项 | 状态 | 证据 |
|---|---|---|
| `bun run typecheck:all` | **FAIL** | `packages/server-core/src/domain/connection-setup-logic.test.ts:120,126` — `expect(conn.providerType).toBe('anthropic')`,`LlmProviderType` 现为 `'pi' \| 'pi_compat'` (`packages/shared/src/config/llm-connections.ts:50-52`)。commit `ebfe6ea8` 修了源码漏了测试。链在 server-core 中断 |
| `packages/session-tools-core tsc --noEmit` | **FAIL (201 错)** | tsconfig 无 `types` 字段且无 bun-types devDep;TS7 不再自动包含 `@types/*`(同配置 tsc@5.9.3 为 0 错)。`bun:test` TS2307 ×10 文件、`node:` TS2591 ×128、`loader.ts:151` TS7006 |
| messaging-gateway / whatsapp-worker | 隐性问题 | `bun:test` TS2307 同样存在,但两包不在 typecheck 链里 → CI 从不检查 |
| `typecheck:all` 跨平台 | 双平台皆断 | 链中含 `powershell -ExecutionPolicy Bypass -File ../../scripts/dedupe.ps1`(macOS/Linux 无 `powershell` → 中断;上游链无此步);`scripts/dedupe.ps1:2` 硬编码 `$projectRoot = "E:\craft-agents"` |
| `lint:i18n:coverage` | FAIL | 引用 `scripts/check-i18n-coverage.ts`,文件不存在(**上游同样引用、同样缺失**)。根 package.json 共 **12 个 script 引用不存在的文件** |
| `bun run test:shared:all` | FAIL (3 fail) | `storage-startup-migration.test.ts` 期望 Opus 4.8,实现产出 4.7 |
| **全量 `bun test`** | **FAIL (48-51 fail + 1 error / 4591 tests)** | 首版审计只报了 3,对抗性审查补测修正。分布: i18n parity 14、BrowserPaneManager 8(疑似 dev Electron 39→43 升级未同步 mock)、startWebuiHttpServer 6、plan_submitted 4、Opus migration 3、headless smoke 3、createBuiltInConnection 2、routing/wire-format 4、preprocessLinks/detectLinks/OAuth 发现 3 |
| `.github/workflows/validate.yml` | 每 PR + push main 跑 `validate:ci` | 当前必然全红;action 未 pin SHA、无 `permissions:` |

---

## 2. Critical

### C-1 [FIXED 5d8ccaa4, inherited] Markdown 渲染器 `rehypeRaw` 无净化 → 存储型 XSS,renderer 上下文 = RCE 级
- **证据**: `packages/ui/src/components/markdown/Markdown.tsx:624` — `rehypePlugins={[rehypeKatex, rehypeRaw]}`,全仓库无 DOMPurify。仅 `a` 标签 href 净化 (`Markdown.tsx:202-233`)。
- **对抗性修正 (重要)**: CSP **存在**但形同虚设——`apps/electron/src/renderer/index.html:6` 的 CSP 含 `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,inline 事件处理器 (`onerror`/`onload` 经 `setAttribute`) 与 `<iframe srcdoc>` 内联脚本都被放行;srcdoc 与父页同源,脚本可直接访问 `window.parent.electronAPI`(contextIsolation:true 不构成缓解,contextBridge 暴露进主世界)。**与上游 CSP 逐字节相同**。
- **暴露面**: LLM 消息(可提示注入)、plan、`markdown-preview`/`html-preview` 文件预览、viewer 的任意用户上传 session JSON (`apps/viewer/src/App.tsx:74`)。
- **修复**: 移除 `rehypeRaw`(markdown 语法不受影响)+ CSP 移除 `unsafe-inline`/`unsafe-eval`(双保险;需回归 shiki/mermaid/katex)。

### C-2 [FIXED b0e8f3d5, inherited 为主] Safe 模式允许任意代码执行: `transform_data` 零隔离 + `script_sandbox` 可读任意文件
- **证据**: `packages/session-tools-core/src/tool-defs.ts:580-581` — 两者 `safeMode: 'allow'`;`handlers/transform-data.ts:106-112` spawn 任意脚本无文件/网络隔离;`runtime/filesystem-isolation.ts:29-46` macOS `(allow file-read*)`、Linux `bwrap --ro-bind / /`。
- **细节**: sandbox 脚本可读 `~/.ssh/id_rsa`、`~/.aws/credentials` 及应用明文凭据缓存 `~/.craft-agent/workspaces/*/sources/*/.credential-cache.json` (session-mcp-server `index.ts:79-105`);`transform_data` 可任意写 + 联网,且经 MCP server 暴露给 Codex/Copilot。
- **权限注记**: 本机 `/Users/van` 0750 缓解"任意本地用户",但默认 macOS 布局 (home 0755) 下成立。
- **修复**: 两者改 `safeMode: 'block'` 或接入 Bash 同款权限门;`transform_data` 复用 sandbox 隔离;读权限收敛到 session 树;凭据缓存加密或移出。

### C-3 [PARTIAL 74f4453d;残留 2 critical 已评估无修复版本,用户决策接受并记录: 34→22 vulns; 残留为 markitdown-js/baileys 传递依赖, fork-caused;xmldom/node-tesseract-ocr 均无 patched 版本可升] 依赖供应链: 34 个已知漏洞 (2 critical + 19 high),含直接依赖
- **证据** (`bun audit` 实测,升级 Pi 0.83.0 后复测仍 34): critical — `xmldom` + `node-tesseract-ocr` 命令注入 (markitdown-js,CLI 文档工具处理不可信文件);high — `undici 8.0.0` (apps/electron/package.json:77 直接 pin,TLS 校验绕过 GHSA-vmh5-mc38-953g 等,`main/network-proxy.ts:10` 直接用)、`marked 18.0.0` (OOM DoS)、`js-yaml 5.0.0` (指数解析 DoS)、`sharp 0.34.5` (electron 侧,与根 0.35.3 双版本)、`music-metadata` (baileys/whatsapp)。
- **归属**: **全部 fork-caused** — 上游 pin 为 `typescript ^5.0.0`/`undici ^7.22.0`/`marked ^17.0.1`/`js-yaml ^4.1.1`,fork 升级到 `7`/`8.0.0`/`18.0.0`/`5.0.0` 时未做漏洞检查 (TS7 → 201 个 tsc 错;undici 8.0.0 → TLS 绕过;其余同上)。
- **修复**: undici ≥8.5.0、marked >18.0.1、js-yaml ≥5.1.1、tar >7.5.20、统一 sharp 0.35.x;评估 markitdown-js 对不可信文件的暴露。

---

## 3. High (16 项, 1 项已修)

### H-12 [FIXED be8ad661, fork-caused] OpenRouter OAuth 可永久挂起 + callback server 泄漏
- **原证据**: `llm-connections.ts:988-1041` — `credPromise` 无超时;`httpServer.close()` 失败路径被跳过;`resolveCred(Promise.reject(...) as any)` 反模式。
- **修复**: OpenRouter case 改为 SDK 0.83 的 `openRouterOAuth` (PKCE + 一次性 loopback callback + 手动粘贴无头路径;内置 5 分钟登录超时 + 30s 交换超时 + `finally { close() }`),新增 `pi:submitOAuthCode` 通道 + `pendingManualOAuthCodes` 完成无头粘贴。冒烟验证: 事件流 `progress → auth_url → manual_code` 完整,abort 0.2s 干净取消无泄漏。

### H-1 [FIXED 6b1ca9df, inherited] Browser pane 可读任意本地文件
- `main/browser-pane-manager.ts:735-751` (`navigate()` 的 scheme 正则 `/^[a-z][a-z0-9+.-]*:\/\//i` 放行 `file://`,**上游 :736 逐字相同**) + `handlers/browser.ts:166-171` (`EVALUATE` 无 gate)。
- 链: 提示注入 agent → `file:///…/.ssh/id_rsa` → `evaluate('document.body.innerText')` 外带;WS 路径无 `requireOwnedInstance`/`getAllowRemoteEvaluate` 隔离 (capability 路径 `browser-pane-manager.ts:2436-2461,2653-2657` 有)。
- 修复: navigate 只允许 http/https/about;EVALUATE 加 gate;WS 处理器套 owner-key 检查。

### H-2 [FIXED 6b1ca9df, 混合] `server:invokeOnServer` 无验证 RPC 桥 + 全链路 `tlsRejectUnauthorized: false`
- `main/index.ts:775-779`;`preload/bootstrap.ts:125,149`;`handlers/workspace.ts:29`。renderer 提供 url/token/channel/args 四项,无 sender 校验、无 channel allowlist;绕过 CHANNEL_MAP;TLS 全关 → 令牌可被 MITM。TLS 部分 inherited (上游 preload 同样 2 处),invokeOnServer 为 fork 功能 [未核实上游]。
- 修复: url scheme 校验 + channel 白名单 + sender 校验;TLS 改为系统信任库/显式证书 pin。

### H-3 [FIXED 6b1ca9df, 未核实上游] Browser-pane 权限自动放行任意 origin
- `browser-pane-manager.ts:3266-3290` — `clipboard-read`/`media`/`geolocation`/`notifications`/`idle-detection` 对任何被浏览网站静默授予 → 剪贴板是凭据外带通道。修复: 移除敏感项或按 origin 白名单。

### H-4 [FIXED 74b269d4, fork-caused] iLink WeChat token 明文落盘,遗忘不清理,QR 登录重复外发
- `adapters/wechat/ilink/auth/accounts.ts:262-308`、`inbound.ts:151-165`;`registry.ts:809-823`。bot token + context token 明文写 `~/.craft-agent/wechat`(0644),每次启动从加密库复制;`forgetPlatform` 不删;`login-qr.ts:230-250` 每次 QR 登录把最多 10 个历史 token 发给 iLink 服务器 (`local_token_list`)。**上游无 wechat adapter(仅 lark/telegram/whatsapp),ilink 为 fork 从 `@tencent-weixin/openclaw-weixin@2.4.4` (MIT) vendor + 粘合**。
- 修复: 走加密凭据库或 0600 + forget 清理 + 去掉 `local_token_list` 重发。

### H-5 [FIXED 74b269d4, fork-caused] CDN 媒体下载无超时/无大小上限,串行轮询循环内
- `ilink/cdn/pic-decrypt.ts:52-62`、`monitor.ts:243-255`。一条挂死/巨型下载阻塞整个账号收信,内存/磁盘可耗尽;`saveMedia` 声明 `_maxBytes` 但忽略。修复: `AbortSignal.timeout` + 流式计数 + 并发隔离。

### H-6 [FIXED 74b269d4, fork-caused] 出站 WeChat 发送把 HTTP 错误当成功
- `api.ts:365-411` (`apiPostFetch` 在 `!ok` 时返回 body),测试明确断言此行为。静默丢消息、无重试/幂等;caption/media 两条消息可失配。

### H-7 [FIXED 131d717c, inherited] `file:readUserAttachment` 读任意绝对路径
- `server-core/handlers/rpc/files.ts:171-191` — 仅 isAbsolute+size 检查,无 provenance 校验 (注释声称"OS 选择器写入 drafts.json 所以路径隐含同意"但 RPC 从不校验来源)。`~/.ssh/id_rsa`、`~/.aws/credentials` 任意读 (≤50MB)。修复: 校验路径等于 drafts.json 记录值。

### H-8 [FIXED 131d717c, 大概率 inherited] `file:read` 黑名单漏 `~/.craft-agent/credentials.enc` + `config.json`;.enc 密钥 = PBKDF2(机器 UUID,盐在文件头)
- `handlers/utils.ts:119-129`;`shared/src/credentials/backends/secure-storage.ts:319-333`。持 token 者可经 `file:read` 拿加密库 + 经 agent 自身 bash 拿机器 UUID → 离线解密全部密钥;`config.json` 含 `serverConfig.token`。修复: 黑名单加 `.craft-agent`;密钥改 OS keychain 派生。

### H-9 [FIXED 131d717c + 6b1ca9df, 未核实上游] workspace SVG 图标存储型 XSS
- `server-core/handlers/rpc/workspace.ts:206-280` (WRITE_IMAGE 不净化) + `:150-188` (注释: "caller will use as innerHTML")。恶意仓库/技能图标 → renderer 任意 JS → 可调 H-7/H-8。修复: 改 `<img src>` 或 DOMPurify。

### H-10 [FIXED 74f4453d, 未核实上游] `web_fetch` `redirect: 'follow'` 不重新校验
- `pi-agent-server/src/tools/web-fetch.ts:366` (仅初始 URL 校验 `:73-95`)。公开 URL 302 到 `127.0.0.1`/云 metadata → SSRF;IPv4-mapped IPv6 `[::ffff:7f00:1]` 仅被"偶然"拦截 (bracketed 字面量 DNS 失败),AAAA 记录直通。修复: `redirect: 'manual'` 逐跳校验。

### H-11 [FIXED 5d8ccaa4, 混合: inherited 骨架 + fork 激活] token 刷新 provider 混淆: xAI/Kimi 的 refresh token POST 到 ChatGPT 端点
- `shared/src/agent/pi-agent.ts:795-810` → `auth/chatgpt-oauth.ts:138-160`。上游 `pi-agent.ts:795-798` 有完全相同路由,但**上游 llm-connections.ts 没有 xAI/Kimi OAuth** (缺陷休眠);fork 的 `855c9612` 统一 OAuth handler 存入真实 refresh token (亲验 `llm-connections.ts:921-924, 972-975`),激活为**真实跨供应商凭据泄露** (token 发给 OpenAI)。
- **更新 (v2)**: SDK 0.83.0 已内置 `xaiOAuth`/`kimiCodingOAuth` (含各自 refresh,`pi-ai/dist/auth/oauth/load.js`),推荐修复路径改为: 经 SDK providers 做刷新,或未实现则强制重认证——**绝不 fallback 到 ChatGPT 端点**。

### H-13 [FIXED b0e8f3d5, 未核实上游] `source_test`/`config_validate` sourceSlug 无校验 → 路径穿越 + SSRF + 自动激活
- `session-tools-core/src/source-helpers.ts:31`;`handlers/source-test.ts:100-118`。`../../` 可读任意目录 config.json 并以其 baseUrl 发起带凭据探测 (`safeMode: 'allow'`);`skill_validate` 有 `validateSlug`,这俩没有。修复: 两处补 `validateSlug`。

### H-14 [FIXED 74f4453d, 未核实上游] MCP server: tool args 从不 zod 校验;`_precomputedResult` 模型可伪造;docs 代理原样转发
- `session-mcp-server/src/index.ts:425-460, 277-306`。Schema 只用于广告不用于校验;`call_llm`/`spawn_session` 信任参数里 JSON 串;`docsUpstream` 把工作区数据发给第三方 `agents.craft.do`。修复: safeParse + 去掉 `_precomputedResult`。

### H-15 [FIXED 6b1ca9df, fork-caused] 远程服务器 WS token 驻留 renderer 内存
- `renderer/components/app-shell/SendResourceToWorkspaceDialog.tsx:145-150`。与 C-1 组合: 一次 XSS 即外带/冒用远程服务器。修复: token 只存 main 进程。

### H-16 [FIXED 6b1ca9df, 未核实上游] preload capability 边界无验证
- `preload/bootstrap.ts:161-170` — `CLIENT_OPEN_EXTERNAL → shell.openExternal` 不分类;thin-client 模式下被攻陷的远程服务器可直接打开 `file:` (Windows = RCE 类)。修复: capability 边界复刻 `classifyExternalUrl`。

---

## 4. Medium (精选)

**安全:**
- M-1 [PARTIAL] RPC 层无 session/workspace 归属校验 — `transport/server.ts:459-467,727` 客户端自报 workspaceId;`sessions.ts` 全部信任客户端 id → 任意 token 持有者可读写任意工作区 session、注入 prompt、触发工具执行。
- M-2 [OPEN, 论证修正] `pi-agent-server` 本地 `call_llm` HTTP 端点无鉴权/无 body 上限 (`index.ts:318-350`) → 配额燃烧。**对抗性修正**: "恶意网站 DNS rebinding" 路径不成立 (端口为 `listen(0)` 随机端口,浏览器无法预知);真实攻击者 = 同机进程。
- M-3 [OPEN] WebUI 登录限流全局共享 (`webui/http-server.ts:183`,`getClientIp` 默认返回常量 `'direct'`) → 20 次尝试锁死所有 IP;logout 不撤销 JWT (24h,无 jti)。
- M-4 [OPEN] custom-endpoint `baseUrl` 零校验且携带真实 API key (`pi-agent-server/index.ts:403-417,457-467`)。
- M-5 [ACCEPTED 用户决策, fork-caused] QR 登录 redirect_url 完全信任 (`login-qr.ts:390-425`) — 服务器下发 baseUrl 成为全部请求目标,`Authorization: Bearer` 发往该主机。
- M-6 [FIXED dd6c6af0, fork-caused] iLink 状态非 workspace 隔离 (`state-dir.ts:25-31`);QR 登录把兄弟工作区 token 发给 iLink 服务器。
- M-7 [OPEN] SVG 图标 regex 净化可绕过 (`renderer/lib/icon-cache.ts:705-717`) — 未引号属性/`JAVASCRIPT:`/HTML 实体编码绕过。
- M-8 [OPEN] `auth:logout` 无服务端防护销毁全部凭据 + config.json (`handlers/rpc/auth.ts:38-56`)。
- M-9 [OPEN] WS server 无 `maxPayload` (`transport/server.ts:281`) + handler 超时竞态 (超时后 handler 继续跑,setTimeout 不清理)。
- M-10 [OPEN] `transfer:start/chunk` 无 totalBytes/chunkCount 上限 → 磁盘耗尽 (`transfer.ts:112-181`)。
- M-12 [OPEN] WhatsApp adapter `void this.messageHandler(msg)` 无 catch (`adapters/whatsapp/index.ts:477`) → unhandled rejection 可崩主进程。
- M-13 [OPEN] messaging JSON 持久化非原子 (`config-store.ts:150-158`、`binding-store.ts:254-263` 等) — 崩溃静默丢配置/绑定。

**正确性/资源:**
- M-11 [OPEN] transform/script 超时只杀直接子进程,孤儿存活 + stdio 管道不关 → 工具永久挂起 (`transform-data.ts:115-140`、`script-sandbox.ts:134-163`)。
- M-14 [OPEN] 生产路径从不清理 per-session 状态: `modeManager` states/callbacks/subscribers、`sessionToolsCache`、`sessionPlanFilePaths` (cleanup 函数仅测试调用,`mode-manager.ts:352,521`、`session-scoped-tools.ts:185-189`)。
- M-15 [OPEN] `pendingPermissions` 崩溃时不 reject → 挂起 + Map 泄漏 (`pi-agent.ts:1356-1380` vs `handleSubprocessExit:1742-1789` 缺此项)。
- M-16 [OPEN] `handleCorruptedFile` 任何解密失败即删整个凭据库 (`secure-storage.ts:341-357`) — Linux machine-id 变更 = 全部凭据丢失。
- M-17 [OPEN] `persistence-queue.flush()` 不等在途写 (`persistence-queue.ts:186-204`) → 退出时数据丢失。
- M-18 [FIXED 05afe4b9] 工具元数据每次调用全量同步重写 O(n²) + `_metadataMap` 无界 (`interceptor-common.ts:293-340`);`_sessionDir` 跨 session 写错文件。
- M-19 [OPEN] interceptor-common mergeAndWriteMetadata TOCTOU (`:320-340`)。
- M-20 [OPEN] TaskRunner 无墙钟超时,`verifying` 可永久挂起 (`tasks/TaskRunner.ts:530-537`)。
- M-21 [OPEN, 未核实上游] Lark adapter `destroy()` 不停止 WSClient → 每次重连双 socket 重复投递 (`adapters/lark/index.ts:302-312`)。
- M-22 [OPEN, fork-caused] 入站 at-most-once: sync-buf 先落盘后派发 (`monitor.ts:235-256`)。
- M-23 [OPEN] source config/会话记录 0644 世界可读 (`shared/src/sources/storage.ts:142` 等)。

**构建/配置:**
- M-24 [FIXED b4fd6ecc, 混合] 打包产物 EOL Electron 39.2.7,dev 用 43.1.1 (`electron-builder.yml:7` 改 43.1.1;pin 本身 inherited,不一致是 fork 升级 dev 未同步)。
- M-25 [OPEN, fork-caused] OAuth define 双构建路径不一致,`build:main` 会把 `GOOGLE_OAUTH_CLIENT_SECRET` 烘焙进 bundle (`apps/electron/package.json:18` vs `electron-build-main.ts:30-47` 注释声称不烘焙)。
- M-26 [PARTIAL 05afe4b9: permissions + bun 版本已对齐;SHA pin 未做] GitHub Actions 未 pin SHA、无 `permissions:`;bun 版本三处不一致。
- M-27 [OPEN] `.env.example` 过期 (记录已删除的 ANTHROPIC_API_KEY,`CRAFT_SERVER_TOKEN` 等 ~30 个未记录)。
- M-28 [ACCEPTED 用户决策, inherited] bunfig preload 全局 fetch 拦截器注入所有 bun 进程 (`unified-network-interceptor.ts:2266-2270`),无 host 过滤。

---

## 5. Low (精选)

- L-1 [FIXED bdc8147c] `StoredMessage` 仍缺 `hidden` 字段;`message-mapper.ts` 单断言掩盖 (`core/src/types/message.ts:236,300-390`)。
- L-2 [FIXED bdc8147c] `generateMessageId` 仍用 `Math.random()` (`message.ts:590-592`);`source-helpers.ts:182` 同。
- L-3 [FIXED bdc8147c] `summarize.ts` 空存根仍被 SessionManager 3 处"带注释地"调用 (注释虚构) (`shared/src/utils/summarize.ts`)。
- L-4 [FIXED bdc8147c + 05afe4b9] 死代码: url-validator(幻影 SDK import)/factory.ts.bak 已删 (bdc8147c);AnthropicModelFetcher/BedrockVertexModelFetcher/cdn-upload.ts 已删 (05afe4b9)。
- L-5 [FIXED bdc8147c] 迁移残留 `packages/shared/src/agent/backend/factory.ts.bak` 已提交。
- L-6 [FIXED bdc8147c] `killShell` 正则转义当 shell 转义 (`SessionManager.ts:6680-6701`);privileged 审计日志明文存完整命令 (`privileged-execution-broker.ts:178-184`)。
- L-7 [FIXED bdc8147c] `thumbnail://` 协议可对任意绝对路径出缩略图 (`thumbnail-protocol.ts:130-163`)。
- L-8 [FIXED bdc8147c] 应用级 IPC 无 sender 校验: `workspace:remove`/`app:relaunch`/`__get-ws-token` (`main/index.ts:494-498,769-772,909-911,943`)。
- L-9 [ACCEPTED 用户决策] 主窗口 + toolbar BrowserView 仍 `sandbox: false` (`window-manager.ts:257-261`、`browser-pane-manager.ts:402-408`)。
- L-10 [ACCEPTED 用户决策] preload 仍 6 个 `sendSync` (`bootstrap.ts:56,81,99-101,113`);`(api as any)` 7 处。
- L-11 [FIXED bdc8147c] `install-server.sh:52-81` 明文打印 server token;`main/index.ts:1051` headless 打印 `CRAFT_SERVER_TOKEN`;CLI `--api-key` 进 ps。
- L-12 [FIXED 05afe4b9] deep-link 查询参数仍原样透传 (`deep-link.ts:181-188`) + 100ms 时序假设;`craftagents://` 协议注册使任意网页可触发 `delete-session` action。
- L-13 [FIXED bdc8147c] husky 零钩子;`test-workflow-local.sh:5` 硬编码个人路径。
- L-14 [PARTIAL bdc8147c + 05afe4b9] renderer: MemoizedMarkdown 比较器 + 菜单闭包已修;render 期 clientHeight 读取 + Mermaid ref 写入仍 OPEN(性能类)。
- L-15 [FIXED bdc8147c + 05afe4b9] `CRAFT_HEALTH_PORT` NaN 绕过端口守卫 (`server/src/index.ts:293`);server token `===` 非恒时比较。

---

## 6. 旧审计复核总表 (2026-07-22 → 2026-08-01)

**已修复 (11)**: C-2 打包依赖机制重构 · A-5 ElectronAPI 接口补全 · M-2 credential pendingRefreshes 泄漏 · M-5 loadStoredConfig 就地修改 · M-8 mcp toolCache 失效 · H-5/H-6 CLI 双重销毁与 cmdSend 丢消息 · L-2 message-mapper 双重断言 · L-5 "seperate" 拼写 · M-9 WeChatConnectDialog stale closure · 6.6b script-sandbox 路径校验 · plan-tokens 熵 (randomBytes 48bit) · 6.5 renderer 竞态/Telegram 轮询泄漏 · TurnCard/handleSubmitFollowUp/deep-link renderer 侧

**仍存在或部分 (20)**: C-3 TLS 跳过 (3 处) · C-4 sendSync ×6 · C-5 SSRF 主体 (redirect 绕过 + IPv4-mapped IPv6 残留) · H-1 token 互斥锁 (dormant 但未修) · H-3 `as any` ×7 · H-4 Sentry 嵌套净化不全 · H-7 SessionManager 8884 行 · H-8 MCP 看门狗吞异常(同族) · H-9 toolbar sandbox:false · M-1 `_sessionDir` · M-3 pendingPermissions · M-4 `_metadataMap` · M-6/M-7 TOCTOU/缓存 · L-1/L-3/L-4/L-8~L-13 多数 · A-2/A-3/A-4/A-6/A-7 全部

---

## 7. 上游归属总表 (实测逐文件对比 `craft-ai-agents/craft-agents-oss` main)

### Inherited — fork 与上游同款 (不是复刻退步,但 fork 有义务修)
rehypeRaw+CSP · browser-pane file:// 正则 (上游 :736 同) · preload TLS 跳过 ×2 · SessionManager 单文件 (**上游 9005 行, fork 8884 行**) · electron-builder `electronVersion: 39.2.7` · Dockerfile 幽灵 COPY (`craft-agents-commands`/`craft-cli`/`apps/marketing` **上游也 404**) · `CRAFT_COMMANDS_ENTRY/CRAFT_CLI_ENTRY` 幽灵引用 · `check-i18n-coverage.ts` 缺失 (**上游同样引用、同样缺失**) · H-11 刷新路由骨架 · readUserAttachment/files.ts 系

### Fork-caused — fork 自己的决策/代码
TS7 升级 (201 错) · anthropic→pi 迁移未同步测试 (CI 红) · `typecheck:all` 塞入 `powershell dedupe.ps1` (**上游链无此步**)+ 硬编码 `E:\craft-agents` · undici/marked/js-yaml 激进升级 · dev Electron 43 vs 打包 39 不一致 · 全部 iLink WeChat 传输 (上游无 wechat adapter) · 统一 Pi OAuth handler (xAI/OpenRouter/Kimi/Radius) 及其 H-11 激活/H-12 · remote-server token 进 renderer (H-15)

---

## 8. 审计方法局限 (对抗性审查结论)

1. **未做上游对比是首版最大缺陷** — 本版已补 (第 7 节)。
2. **CSP 未查** — 本版 C-1 已修正论证 (CSP 存在但 `unsafe-inline`/`unsafe-eval` 使其形同虚设;与上游逐字节相同)。
3. **测试基线低估** — 首版报 3 fail,实测全量 **51 fail + 1 error** (本版第 1 节已修正)。
4. **root lint / root build 未跑** — 已知局限 (lint:shared 自定义规则确认死文件;`bun run build` 指向缺失脚本)。
5. **M-2 威胁模型过度** — "DNS rebinding 网站攻击"不成立 (随机端口),已修正为同机进程威胁。
6. **权限细节** — "任意本地用户可读"依赖 home 目录权限 (本机 0750 缓解,默认 0755 成立),相关项已注记。

---

## 9. 已确认的良好实践 (值得保留)

- capability 分发器 `__browser:invoke` (版本检查 + owner-key 命名空间 + `requireOwnedInstance` + evaluate gate) 是正确范式,WS 路径应照抄
- 主窗口 `will-navigate` + `setWindowOpenHandler` 全部经 `classifyExternalUrl`;pane 弹窗 `sandbox: true` 且限 http/https
- OAuth: `randomBytes` state + PKCE + 5 分钟 TTL 的 `OAuthFlowStore`,WebUI JWT 显式 `algorithms: ['HS256']`、HttpOnly + SameSite=Strict、argon2id
- 凭据主库 AES-256-GCM + 0600;bootstrap token 熵校验 (≥16 字符、拒绝单字符重复)、非 loopback 绑定强制 TLS
- pairing 6 位码 crypto randomInt + 5 分钟 TTL + 速率限制;access-control 绑定前/绑定后双重门
- 传输层身份校验/重连时序正确;`transfer:commit` 字节数 + SHA-256 校验;`allowModelNetwork: false` 传入 Pi runtime
- renderer 原子无密钥;11 个 setInterval 全部有 cleanup;HTML 预览 iframe `sandbox` 无 `allow-scripts`;KaTeX `trust: false`

---

## 10. 修复优先级 (含执行状态)

**P0 (阻断发布):**
- [x] C-1 rehypeRaw XSS — rehype-sanitize 已接入 (5d8ccaa4);CSP 收紧待 P1 (unsafe-inline 移除需回归 dev 模式)
- [x] C-2 safeMode 收口 + sandbox 读限制 (b0e8f3d5);凭据缓存加密待后续
- [x] CI 恢复 (6b372f71): typecheck:all 11 包全绿;test:shared:all 31/31;doc-tools 通过;i18n 三检全绿
- [x] H-4 (74b269d4): 0600/0700 + forget 清理 + QR token 收敛
- [x] H-11 (5d8ccaa4): SDK provider-native 刷新,未知 provider 强制重认证

**P1 (高危):**
- [x] H-1\/H-2\/H-3\/H-16 (6b1ca9df)
- [x] H-7\/H-8 (131d717c);密钥改 keychain 派生 仍 OPEN
- [x] H-9 SVG (DOMParser 净化 6b1ca9df);H-10 redirect 逐跳校验 (74f4453d);H-13 (b0e8f3d5);H-14 args safeParse + 去 _precomputedResult (74f4453d)
- [x] H-5\/H-6 (74b269d4)、H-15 (6b1ca9df)
- [x] 依赖升级 (74f4453d): undici 8.9.0 / marked 18.0.7 / js-yaml 5.2.3 / tar 7.5.22 / sharp 统一 0.35.3;Dockerfile 幽灵 COPY 已删;electronVersion 已对齐 (b4fd6ecc)

**P2 (迭代):**
- [x] M-1/M-2/M-3/M-9/M-10 (1e95a35c)
- [x] M-12~M-17 (1e95a35c);M-11 已随 C-2 修复
- [x] 旧低危批量 (bdc8147c);0644 属 M-23 已修

---

## 11. 执行状态追踪

| 提交 | 内容 | 对应发现 |
|---|---|---|
| `27140e2a` | Pi SDK 0.83.0 全 workspace 统一 + lockfile 重新解析 + shiki peer ^4.0.0 | 版本漂移 (FIXED)、shiki peer (FIXED)、C-3 部分缓解 (Pi 相关传递依赖仍在) |
| `be8ad661` | SDK 无头 OpenRouter OAuth 替换 (协议 + 服务端 + renderer + i18n) | H-12 (FIXED)、M-1 OpenRouter 部分缓解 |
| `80559086` | 审计报告 + 对抗性审查 (本文档前身) | — |
| `b4fd6ecc` | electron-builder 打包对齐 Electron 43.1.1;清理过时 Claude SDK 注释 | M-24 (FIXED) |
| `b0e8f3d5` | C-2 safe-mode 收口 + sandbox 读限制 + 超时杀进程组;H-13 sourceSlug 校验 | C-2 (FIXED)、H-13 (FIXED)、N-5 (FIXED) |
| `74b269d4` | iLink 凭据 0600/0700 + forget 清理 + QR token 收敛;CDN 超时/上限;出站错误处理 | H-4 (FIXED)、H-5 (FIXED)、H-6 (FIXED) |
| `6b1ca9df` | browser-pane scheme 白名单/权限收窄;invokeOnServer 校验;token 移出 renderer;capability 边界;SVG DOMParser 净化 | H-1/H-2/H-3/H-15/H-16 (FIXED)、H-9 renderer 半段 |
| `131d717c` | drafts 溯源 + 黑名单补 .craft-agent + SVG 写入门禁 | H-7/H-8/H-9 server 侧 (FIXED) |
| `5d8ccaa4` | provider-native 刷新 (SDK OAuth);markdown rehype-sanitize | H-11 (FIXED)、C-1 (FIXED) |
| `6b372f71` | typecheck 链/tsconfig types/i18n 修复/测试修正 | CI 全绿 (FIXED) |
| `74f4453d` | redirect 逐跳校验;MCP zod 校验 + 去 _precomputedResult;依赖升级;Dockerfile 幽灵 COPY | H-10/H-14 (FIXED)、C-3 (PARTIAL 34→22)、C-1 Dockerfile (FIXED) |
| `1e95a35c` | P2 agent 批: 归属校验/logout 确认/maxPayload/传输上限/限流+JWT 撤销/墙钟/callback token/baseUrl 校验/原子写/lark 停止/状态清理/凭据备份/flush/0644 | M-1/2/3/4/8/9/10/12-17/19-23 (FIXED) |
| `bdc8147c` | P2 low 批: 死代码清理/密钥烘焙移除/thumbnail 限定/IPC sender 校验/env.example 重写/health port | L-1~L-8/L-11/L-13/L-15、M-25/27 (FIXED) |

*方法说明: 静态代码审计 + 实测 (typecheck:all / 各包 tsc / bun audit / 全量 bun test / 脚本存在性 / 上游 raw 抓取逐文件对比)。竞态与时序类发现基于代码路径分析;标注 [未核实上游] 的项表示未做逐行 diff,不表示无问题。*
