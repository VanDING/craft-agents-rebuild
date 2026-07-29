// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import { homedir } from 'node:os';
import { join } from 'node:path';

let _stateDirOverride: string | undefined;

/**
 * Override the state directory path.
 * Pass `undefined` to clear the override and fall back to environment or default.
 */
export function setStateDir(dir: string | undefined): void {
  _stateDirOverride = dir;
}

/**
 * Resolve the effective state directory.
 *
 * Priority:
 * 1. Override set via {@link setStateDir}
 * 2. `$CRAFT_WECHAT_STATE_DIR` environment variable
 * 3. `$HOME/.craft-agent/wechat`
 */
export function resolveStateDir(): string {
  return (
    _stateDirOverride
    ?? process.env.CRAFT_WECHAT_STATE_DIR
    ?? join(homedir(), '.craft-agent', 'wechat')
  );
}
