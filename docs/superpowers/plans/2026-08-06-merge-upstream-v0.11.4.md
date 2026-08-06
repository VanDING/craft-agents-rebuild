# Merge Upstream v0.11.4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将上游 craft-agents-oss v0.11.4（commit `50ffa143`）合并进本地 fork 的 `main`，解决三方冲突并做 Pi 单后端语义适配，使 Opus 4.6 恢复与 Explore 模式修复在 fork 架构下等价生效。

**Architecture:** fork 是"单 Pi SDK 后端"rebuild（`LlmProviderType` 仅 `'pi' | 'pi_compat'`、MODEL_REGISTRY 全 provider `'pi'`、无 anthropic driver、模型 ID 带 `pi/` 前缀、`isDeprecatedClaudeOpus46Model` 过滤仍保留）。上游 v0.11.4 保留 direct Anthropic 连接（provider `'anthropic'`）。合并以 v0.11.4 语义为基准（4.6 重新可选），将恢复逻辑适配到 Pi 架构（providerType `'pi'` + `piAuthProvider 'anthropic'` + `pi/` 前缀 ID）。Explore 模式修复（`mode-manager.ts`）与 fork 零交集，自动合并直接生效。通过 `git merge upstream/main` 创建 merge commit，逐文件解决冲突。

**Tech Stack:** git 三方合并、TypeScript/Bun monorepo、bun.lock（npmmirror 镜像 URL 需保留）。

---

## 背景事实（已核实，勿重复调查）

- merge-base: `77316cec`；fork 领先 55 commits，落后 1 commit（仅 v0.11.4）
- fork 版本号全部 `0.11.3`；v0.11.4 全部 bump 到 `0.11.4`
- 本地未提交改动（用户环境适配，**必须保留**）：
  - `apps/electron/scripts/build-dmg.sh`：新增 `BUN_DOWNLOAD_BASE` 镜像下载支持
  - `apps/electron/electron-builder.yml`：本地配置
  - `bun.lock`：所有依赖 URL 换成 `https://registry.npmmirror.com/...` 镜像
- v0.11.4 改动 28 个文件；与 fork 改动交集 24 个
- fork 已删除 `packages/shared/src/agent/backend/internal/drivers/anthropic.ts`（单 Pi 后端迁移），故 `anthropic.test.ts` 无测试目标
- fork 的 `models-pi.ts` 中 `isExcludedPiModel`（第 ~82 行）引用 `isDeprecatedClaudeOpus46Model`；v0.11.4 删除该函数 → 合并后引用悬空，**必须**同步移除（4.6 恢复可选的直接体现）

### 冲突分类（执行前预测，以实际 `git status` 为准）

| 类别 | 文件 | 预期冲突性质 |
|---|---|---|
| 必然 | 15× `package.json`（根 + apps/cli, electron, viewer, webui + packages/core, messaging-gateway, messaging-whatsapp-worker, pi-agent-server, server-core, server, session-mcp-server, session-tools-core, shared, ui） | 版本号 `0.11.3` vs `0.11.4` |
| 必然 | `bun.lock` | 三方改动 + 本地镜像 URL |
| 必然 | `packages/shared/src/config/__tests__/storage-startup-migration.test.ts` | 同一测试函数相反断言（fork: 4.6 被迁移走 / v0.11.4: 4.6 保留） |
| 可能 | `packages/shared/src/config/storage.ts` | restoreOpus46 插入点 vs fork 迁移改动 |
| 可能 | `packages/shared/src/config/models.ts` | 4-6 条目插入点 vs fork provider 字段改动 |
| 可能 | `packages/shared/src/config/__tests__/llm-connections.test.ts` | v0.11.4 改 23 行 vs fork 删 351 行 |
| modify/delete | `packages/shared/src/agent/backend/internal/drivers/anthropic.test.ts` | fork 删除文件 vs v0.11.4 修改文件 |
| 干净 | `pi.ts`、`models-pi.ts`、`llm-connections.ts`、`mode-manager.ts`、`models.test.ts`、`models-pi.test.ts`、`release-notes/0.11.4.md`(新增) | 不同区域 / fork 未动 |

### 语义决策（关键假设，用户审阅时可否决）

1. **跟随 v0.11.4 语义**：Opus 4.6 恢复可选（模型选择器 + Pi 目录 + 一次性恢复迁移）；不再强制 4.6→4.8 迁移
2. **fork 适配**：4-6 条目 provider 用 `'pi'`；恢复迁移只处理 `providerType === 'pi' && piAuthProvider === 'anthropic'` 的连接；ID 匹配兼容 `pi/` 前缀与裸 ID
3. **`anthropic.test.ts` 保持删除**（fork 无 anthropic driver，v0.11.4 的断言无测试目标）
4. **版本号取 `0.11.4`**（跟随上游）；bun.lock 保留 npmmirror 镜像 URL
5. 本地未提交改动先 commit（推荐）或 stash，**不得丢弃**

---

### Task 0: 处理本地未提交改动（合并前工作区准备）

**Files:** 无新增

- [ ] **Step 1: 确认工作区状态**

```bash
git status --short
```
预期：` M apps/electron/electron-builder.yml`、` M apps/electron/scripts/build-dmg.sh`、` M bun.lock`（无 untracked 除 `.build/`、`.codegraph/` 等已忽略项）

- [ ] **Step 2: 提交本地改动（推荐）**

```bash
git add apps/electron/electron-builder.yml apps/electron/scripts/build-dmg.sh bun.lock
git commit -m "chore: npmmirror registry and Bun download mirror support"
git status --short
```
预期：工作区干净，`git log --oneline -1` 显示新提交。
备选（不想改动历史时）：`git stash push -m "local-env-adaptations"`，合并完成后再 pop 解决冲突。**二选一，后续步骤按已提交版本描述。**

- [ ] **Step 3: 确认 fork 基线**

```bash
git log --oneline -1 && git rev-parse --short upstream/main
```
预期：输出本地 HEAD 提交哈希与 `50ffa143`。

### Task 1: 执行合并，建立冲突清单

**Files:** 无（git 状态机）

- [ ] **Step 1: 执行三方合并**

```bash
git merge upstream/main --no-edit
```
预期：合并失败停在 MERGING 状态（存在冲突）；输出冲突文件列表，与背景"冲突分类"表对照，**以实际输出为准**。

- [ ] **Step 2: 记录实际冲突清单**

```bash
git diff --name-only --diff-filter=U
```
预期：列出全部冲突文件。若某文件预测冲突但实际干净，跳过对应 Task 并注明。

### Task 2: 解决 15× package.json 版本号冲突

**Files:** 根 `package.json` + `apps/{cli,electron,viewer,webui}/package.json` + `packages/{core,messaging-gateway,messaging-whatsapp-worker,pi-agent-server,server-core,server,session-mcp-server,session-tools-core,shared,ui}/package.json`

- [ ] **Step 1: 对每个冲突文件取 v0.11.4 版本**

```bash
git checkout --theirs apps/cli/package.json
# …对每个冲突的 package.json 重复
```
预期：每个文件 `version` 字段为 `"0.11.4"`。

- [ ] **Step 2: 核对无其他意外差异**

```bash
git diff --cached --stat -- '*/package.json' package.json
git diff upstream/main -- '*/package.json' package.json | head -40
```
预期：仅 version 字段与上游不同（若有其他差异，逐项确认是 fork 定制，如依赖版本，保留 fork 侧）。

- [ ] **Step 3: 暂存**

```bash
git add package.json apps/cli/package.json apps/electron/package.json apps/viewer/package.json apps/webui/package.json packages/core/package.json packages/messaging-gateway/package.json packages/messaging-whatsapp-worker/package.json packages/pi-agent-server/package.json packages/server-core/package.json packages/server/package.json packages/session-mcp-server/package.json packages/session-tools-core/package.json packages/shared/package.json packages/ui/package.json
```
预期：`git status` 中这些文件移出冲突列表。

### Task 3: 解决 models.ts 冲突（4-6 条目 + Pi provider）

**Files:** `packages/shared/src/config/models.ts`

- [ ] **Step 1: 查看冲突区块**

```bash
git show :2:packages/shared/src/config/models.ts > /tmp/models-ours.ts && git show :3:packages/shared/src/config/models.ts > /tmp/models-theirs.ts
grep -n "<<<<<<<\|=======\|>>>>>>>" packages/shared/src/config/models.ts
```
预期：冲突在 `MODEL_REGISTRY` 的 Claude 条目区（fork 改 provider 字段，v0.11.4 插入 4-6 条目）；`DEPRECATED_MODEL_REPLACEMENTS` 与 `BEDROCK_TO_BARE` 区域应已自动合并。

- [ ] **Step 2: 编辑解决**

打开冲突区域，保留：
1. fork 侧所有条目的 `provider: 'pi'` 写法
2. v0.11.4 新增的 `claude-opus-4-6` 条目，**但 `provider` 改为 `'pi'`**（fork 的 `ModelProvider` 类型只有 `'pi'`，写 `'anthropic'` 会编译错误）

最终 4-6 条目应为：

```ts
  {
    id: 'claude-opus-4-6',
    name: 'Opus 4.6',
    // shortName intentionally collides with 4.8/4.7. Those are listed first,
    // so findModelIdByShortName('Opus') keeps returning 4.8 — zero behavior
    // change for callers that reference "Opus" abstractly.
    shortName: 'Opus',
    description: 'Previous Opus release',
    descriptionKey: 'model.opusDesc',
    provider: 'pi',
    contextWindow: 200_000,
  },
```
（注释可精简，保留语义即可；保留 `TODO(opus-4.6-sunset)` 注释便于未来移除）

- [ ] **Step 3: 删除冲突标记并暂存**

```bash
git add packages/shared/src/config/models.ts
grep -rn "<<<<<<<\|>>>>>>>" packages/shared/src/config/models.ts
```
预期：无输出（标记已清），文件移出冲突列表。

### Task 4: 修复 models-pi.ts 悬空引用（编译错误，非冲突）

**Files:** `packages/shared/src/config/models-pi.ts`

- [ ] **Step 1: 确认合并结果**

```bash
grep -n "isDeprecatedClaudeOpus46Model" packages/shared/src/config/models-pi.ts
```
预期：函数定义已被 v0.11.4 删除（三方合并自动应用），但 `isExcludedPiModel` 内仍有引用（fork 侧未动）→ 悬空引用。

- [ ] **Step 2: 从 isExcludedPiModel 移除 4-6 检查**

找到 `isExcludedPiModel` 函数（原 ~80-84 行），删除其中 `if (isDeprecatedClaudeOpus46Model(modelId)) return true;` 行及相邻的 4-6 专属判断，保留其余过滤。修改后该函数不应再引用 `isDeprecatedClaudeOpus46Model`。

- [ ] **Step 3: 确认无残留引用并暂存**

```bash
grep -rn "isDeprecatedClaudeOpus46Model" packages/shared/src/
git add packages/shared/src/config/models-pi.ts
```
预期：grep 无输出；文件暂存。语义效果 = 4.6 重新进入 Pi 模型目录（与上游一致）。

### Task 5: 解决 storage.ts 冲突（恢复迁移适配 Pi 架构）

**Files:** `packages/shared/src/config/storage.ts`

- [ ] **Step 1: 查看冲突区块与 fork 迁移结构**

```bash
grep -n "<<<<<<<\|=======\|>>>>>>>" packages/shared/src/config/storage.ts
grep -n "function migrateLegacyOpusToDefaultOpus\|function restoreOpus46ToAnthropicConnections\|migrateLegacyLlmConnectionsConfig\|piAuthProvider" packages/shared/src/config/storage.ts | head -20
```
预期：冲突在 `migrateLegacyOpusToDefaultOpus` 附近及 `migrateLegacyLlmConnectionsConfig` 调用点；`restoreOpus46ToAnthropicConnections` 已整体并入（v0.11.4 新增）。

- [ ] **Step 2: 以 v0.11.4 逻辑为基准解决冲突**

冲突区块遵循：
1. `migrateLegacyOpusToDefaultOpus`：保留 fork 的 `pi/` 前缀输出形式（`'pi/claude-opus-4-8'`），但移除 fork 版对 4.6 的强制迁移分支（跟随 v0.11.4：4.6 不再被迁移走）；保留 v0.11.4 的 `providerType === 'anthropic'` 分支处理（fork 中不命中，保留无妨）与 `OPUS_FALLBACK_ID` 判断
2. `migrateLegacyLlmConnectionsConfig`：保留 v0.11.4 新增的 `restoreOpus46ToAnthropicConnections(config)` 调用（含注释与 `TODO(opus-4.6-sunset)`）

- [ ] **Step 3: 适配 restoreOpus46ToAnthropicConnections 到 Pi 架构**

将 v0.11.4 的 `if (connection.providerType !== 'anthropic') continue;` 改为：

```ts
    // Fork: single-Pi-backend — direct Anthropic connections are 'pi' provider
    // with piAuthProvider === 'anthropic'. Upstream's 'anthropic' providerType
    // does not exist here.
    if (connection.providerType !== 'pi') continue;
    if (connection.piAuthProvider !== 'anthropic') continue;
```

同时适配 ID 匹配（fork 存储形式带 `pi/` 前缀）：
- 集合判断 `ids.includes(OPUS_46_ID)` 改为同时匹配 `'pi/claude-opus-4-6'` 与裸 `'claude-opus-4-6'`（先查 fork 现有 `migrateLegacyOpusToDefaultOpus` 如何归一化 ID，复用同一辅助逻辑）
- `OPUS_DEFAULT_ID`/`OPUS_FALLBACK_ID` 判断同理兼容 `pi/` 前缀
- push 的条目形式：参照 fork 该文件内 `backfillAllConnectionModels` 的存储形式（ModelDefinition 对象或带 `pi/` 前缀字符串，以现有代码为准）

- [ ] **Step 4: 删除冲突标记、暂存**

```bash
git add packages/shared/src/config/storage.ts
grep -rn "<<<<<<<\|>>>>>>>" packages/shared/src/config/storage.ts
```
预期：无输出。

### Task 6: 解决 storage-startup-migration.test.ts 冲突（v0.11.4 断言 + pi/ 形式）

**Files:** `packages/shared/src/config/__tests__/storage-startup-migration.test.ts`

- [ ] **Step 1: 查看冲突区块**

```bash
grep -n "<<<<<<<\|=======\|>>>>>>>" packages/shared/src/config/__tests__/storage-startup-migration.test.ts
```
预期：`legacy Opus migration to default Opus (integration)` describe 块内多处冲突（fork 断言 4.6 被迁移走且 ID 带 `pi/` 前缀；v0.11.4 断言 4.6 保留且裸 ID）。

- [ ] **Step 2: 以 v0.11.4 语义为基准改写冲突断言**

每条冲突断言遵循：
1. 4.6 保留：`expect(connection.defaultModel).toBe('claude-opus-4-6')` 类断言按 v0.11.4 采用（4.6 不再被迁移）
2. ID 形式按 fork：连接内模型 ID 为 `pi/` 前缀形式（如 `'pi/claude-opus-4-8'`），沿用 fork 现有的 `modelIdsOf` 辅助
3. `PI_ANTHROPIC_OPUS_DEFAULT` 常量保持 fork 现有定义（`pi/claude-opus-4-8` 优先）
4. 顶部 `PI_BEDROCK_OPUS_DEFAULT*` 常量：v0.11.4 删除了它们，fork 若仍使用则保留，否则一并删除

- [ ] **Step 3: 暂存**

```bash
git add packages/shared/src/config/__tests__/storage-startup-migration.test.ts
```
预期：文件移出冲突列表。

### Task 7: 解决 anthropic.test.ts modify/delete 冲突（保持删除）

**Files:** `packages/shared/src/agent/backend/internal/drivers/anthropic.test.ts`

- [ ] **Step 1: 保持 fork 的删除**

```bash
git rm packages/shared/src/agent/backend/internal/drivers/anthropic.test.ts
```
预期：文件标记为已删除（modify/delete 冲突解决方向 = 删除，因 fork 无 `./anthropic.ts` 测试目标）。

- [ ] **Step 2: 确认无其他引用**

```bash
grep -rn "anthropic.test\|anthropicDriver" packages/shared/src --include='*.ts' | grep -v node_modules
```
预期：无 `anthropic.test.ts` 引用残留（`anthropicDriver` 若有其他引用为独立问题，记录并报告，勿静默处理）。

### Task 8: 解决 llm-connections.test.ts 冲突

**Files:** `packages/shared/src/config/__tests__/llm-connections.test.ts`

- [ ] **Step 1: 查看冲突区块与 fork 删除范围**

```bash
grep -n "<<<<<<<\|=======\|>>>>>>>" packages/shared/src/config/__tests__/llm-connections.test.ts
git diff 77316cec HEAD -- packages/shared/src/config/__tests__/llm-connections.test.ts | grep "^-[^-]" | head -30
```
预期：v0.11.4 改动的 23 行与被 fork 删除的 351 行有重叠。

- [ ] **Step 2: 解决**

原则：fork 删除的测试（针对已移除的 anthropic/多后端代码）保持删除；v0.11.4 对**仍存在的测试**的断言更新（如 4.6 相关）予以保留；若 v0.11.4 改动引用了 fork 已删除的代码/类型，丢弃该改动并确认无编译错误。
逐区块：ours 侧（fork）删除 + theirs 侧（v0.11.4）仅当断言目标仍存在时保留。

- [ ] **Step 3: 暂存**

```bash
git add packages/shared/src/config/__tests__/llm-connections.test.ts
```

### Task 9: 解决 bun.lock（保留 npmmirror 镜像）

**Files:** `bun.lock`

- [ ] **Step 1: 查看冲突区块**

```bash
grep -c "<<<<<<<" bun.lock
```
预期：多个冲突区块（v0.11.4 的 34 行依赖变化 vs fork 镜像 URL 替换）。

- [ ] **Step 2: 以 fork 侧为基础解决（镜像 URL 优先）**

```bash
git checkout --ours bun.lock && git add bun.lock
```
说明：v0.11.4 对 bun.lock 的改动仅为版本号 bump 引起的条目变动，不引入新依赖版本；以 ours（含 npmmirror URL + 0.11.3 条目）为基础后，由 Task 9 Step 3 的 `bun install` 按新 package.json 版本重写，产物同时含 npmmirror URL 与 0.11.4 条目。

- [ ] **Step 3: 用 bun install 统一 lockfile**

```bash
bun install --frozen-lockfile=false
git diff --stat bun.lock
```
预期：bun.lock 更新成功；`git grep -c "registry.npmmirror.com" bun.lock` 仍 > 0（镜像保留）；无报错。

### Task 10: 类型检查验证

**Files:** 无

- [ ] **Step 1: 运行全量 typecheck**

```bash
bun run typecheck:all
```
预期：全部包 tsc 通过，无错误输出（若有错误，回到对应文件修复后重跑；不得跳过）。

### Task 11: 运行相关测试

**Files:** 无

- [ ] **Step 1: 配置与模型测试**

```bash
bun run test:shared:config
bun test packages/shared/tests/models-pi.test.ts packages/shared/tests/models.test.ts
```
预期：全部通过。`storage-startup-migration.test.ts` 的 4.6 保留断言、models 注册表测试必须绿。

- [ ] **Step 2: 模式管理测试（Explore 修复回归）**

```bash
bun test packages/shared/src/agent/mode-manager.test.ts 2>/dev/null || true
```
预期：若文件存在则通过；不存在则注明（mode-manager 改动为单行语义变更，typecheck 已覆盖）。

### Task 12: 收尾与提交

**Files:** 无

- [ ] **Step 1: 残留检查**

```bash
git diff --check
git status --short
```
预期：无冲突标记、无空白错误；仅剩 merge 相关暂存。

- [ ] **Step 2: 完成合并提交**

```bash
git commit --no-edit
git log --oneline -3
```
预期：产生 merge commit（"Merge remote-tracking branch 'upstream/main'"），父提交为本地 HEAD 与 `50ffa143`。

- [ ] **Step 3: 更新 release notes 引用（如仓库有聚合变更日志）**

检查 `apps/electron/resources/release-notes/` 是否有 index/聚合文件需要登记 0.11.4；若无则跳过并注明。

- [ ] **Step 4: 确认与上游同步状态**

```bash
git rev-list --left-right --count HEAD...upstream/main
```
预期：形如 `0 0`（完全同步）或 `N 0`（fork 领先 N 个自定义提交，无落后）——v0.11.4 并入后应无 `0 N` 落后。

---

## 自审记录

**Spec 覆盖：** 合并 v0.11.4 全部 28 个文件（Task 1 冲突清单兜底所有文件）；本地 3 个改动保留（Task 0）；Pi 适配 4 处（Task 3/4/5/6）；验证（Task 10/11）；提交（Task 12）。✓

**占位符扫描：** 无 TBD/占位。Task 5 的 ID 归一化复用 fork 现有辅助逻辑已注明检查点。✓

**类型一致性：** 4-6 条目 provider 在 Task 3 定为 `'pi'`（与 fork `ModelProvider` 单值类型一致）；Task 5 的 `piAuthProvider` 字段与 fork `LlmConnection` 定义一致（llm-connections.ts 第 ~170 行注释确认该字段存在）。✓

**风险与决策点（执行前需用户确认）：**
1. 语义跟随 v0.11.4：4.6 恢复可选（Task 3/4/5/6 的核心假设）
2. 本地改动 commit 而非 stash（Task 0）
3. 版本号取 0.11.4（Task 2）
4. `llm-connections.test.ts` 以 fork 删除为主（Task 8）
