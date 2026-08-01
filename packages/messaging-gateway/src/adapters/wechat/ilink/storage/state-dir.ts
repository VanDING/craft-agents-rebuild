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

/**
 * Resolve the state directory for a specific workspace.
 *
 * Every workspace gets its own subdirectory under the global state dir so
 * per-workspace adapters never share persistent state (sync-buf cursors,
 * account credentials, context tokens, account index) — two workspaces
 * binding the same WeChat account must not read or write each other's files.
 *
 * @param workspaceId - The workspace identifier to scope state under.
 * @returns `join(resolveStateDir(), workspaceId)`.
 */
export function resolveStateDirForWorkspace(workspaceId: string): string {
  return join(resolveStateDir(), workspaceId);
}

/**
 * Create the workspace-scoped state directory with owner-only permissions
 * (0700) when it does not already exist, and return its path.
 *
 * Same 0700 rationale as {@link ensureStateDir}: the workspace dir holds
 * plaintext credentials, so it must not be created via a default-mode
 * (umask-derived, typically 0755) recursive mkdir.
 *
 * @param workspaceId - The workspace identifier to scope state under.
 */
export function ensureStateDirForWorkspace(workspaceId: string): string {
  const dir = resolveStateDirForWorkspace(workspaceId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { mode: 0o700 });
  }
  return dir;
}

/**
 * Create an explicit workspace state root (a path returned by
 * {@link resolveStateDirForWorkspace}) with owner-only permissions (0700)
 * when it does not already exist, and return it.
 *
 * Path-level variant of {@link ensureStateDirForWorkspace} for callers that
 * hold a `stateRoot` path rather than the originating workspace ID.
 */
export function ensureStateRootDir(stateRoot: string): string {
  if (!existsSync(stateRoot)) {
    mkdirSync(stateRoot, { mode: 0o700 });
  }
  return stateRoot;
}
