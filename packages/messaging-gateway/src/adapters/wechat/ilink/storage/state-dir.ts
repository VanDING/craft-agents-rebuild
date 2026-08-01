// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import { existsSync, mkdirSync } from 'node:fs';
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

/**
 * Create the state directory with owner-only permissions (0700) when it does
 * not already exist, and return its path.
 *
 * Account credentials and context tokens are persisted under this directory;
 * creating it 0700 (and writing the secret-bearing files 0600) keeps the
 * plaintext tokens unreadable by other OS users.
 *
 * Callers that write into the state dir MUST invoke this BEFORE any
 * `mkdirSync(dir, { recursive: true })`, otherwise the recursive mkdir would
 * create the state dir with the default (umask-derived, typically 0755) mode.
 */
export function ensureStateDir(): string {
  const dir = resolveStateDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { mode: 0o700 });
  }
  return dir;
}
