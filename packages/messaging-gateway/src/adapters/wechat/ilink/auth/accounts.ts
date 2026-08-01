// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ensureStateDir,
  ensureStateRootDir,
  resolveStateDir,
} from '../storage/state-dir';
import { logger } from '../util/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default base URL for the iLink API gateway.
 */
export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';

/**
 * Default base URL for the CDN (media upload / download).
 */
export const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Directory holding the account index and per-account data files.
 *
 * @param stateRoot - Optional workspace-scoped state root. Defaults to
 *                    {@link resolveStateDir} when omitted.
 */
function accountsDir(stateRoot?: string): string {
  return path.join(stateRoot ?? resolveStateDir(), 'openclaw-weixin');
}

/**
 * Path to the JSON file that lists all registered account IDs.
 *
 * @param stateRoot - Optional workspace-scoped state root.
 */
function accountsIndexPath(stateRoot?: string): string {
  return path.join(accountsDir(stateRoot), 'accounts.json');
}

/**
 * Per-account data file.
 *
 * @param stateRoot - Optional workspace-scoped state root.
 */
function accountFilePath(accountId: string, stateRoot?: string): string {
  const dir = path.join(accountsDir(stateRoot), 'accounts');
  return path.join(dir, `${accountId}.json`);
}

/**
 * Legacy credentials file used as a fallback during migration.
 *
 * @param stateRoot - Optional workspace-scoped state root.
 */
function legacyCredentialsPath(stateRoot?: string): string {
  return path.join(stateRoot ?? resolveStateDir(), 'credentials', 'openclaw-weixin', 'credentials.json');
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a raw WeChat account identifier.
 *
 * The upstream OpenClaw plugin uses WeChat's raw account strings which may
 * contain `@` and `.` characters (e.g., `wxid_abc@abc`). Normalisation
 * replaces those with `-` so the result can be safely used as a filename.
 *
 * @param raw - The raw account identifier from WeChat.
 * @returns The normalised, filesystem-safe form.
 */
export function normalizeAccountId(raw: string): string {
  return raw.replace(/[@.]/g, '-');
}

/**
 * Reverse a normalised account ID back to its raw form.
 *
 * **This is lossy** — multiple raw values can map to the same normalised form
 * (e.g. `a@b` and `a-b` both become `a-b`). The function returns `undefined`
 * when ambiguity is detected (the normalised string contains a `-` that could
 * have come from either an original `-` or a replacement).
 *
 * @param normalizedId - The normalised account identifier.
 * @returns The raw identifier, or `undefined` if the normalised form is
 *          ambiguous.
 */
export function deriveRawAccountId(normalizedId: string): string | undefined {
  // If the normalised string contains any hyphen, we cannot know whether it
  // was originally a `-`, `@`, or `.`, so we refuse to guess.
  if (normalizedId.includes('-')) {
    return undefined;
  }
  // No hyphens → no replacements were made → the string is already raw.
  return normalizedId;
}

// ---------------------------------------------------------------------------
// Account index management
// ---------------------------------------------------------------------------

/** Shape of the account index file. */
interface AccountIndex {
  ids: string[];
}

/**
 * Read the account index from disk.
 * Returns an empty list when the file does not exist or cannot be parsed.
 */
function readAccountIndex(stateRoot?: string): string[] {
  try {
    const data = fs.readFileSync(accountsIndexPath(stateRoot), 'utf-8');
    const parsed: AccountIndex = JSON.parse(data);
    return Array.isArray(parsed.ids) ? parsed.ids : [];
  } catch {
    return [];
  }
}

/**
 * Persist the account index to disk, creating parent directories as needed.
 *
 * The workspace-scoped root (when `stateRoot` is given) is created 0700
 * before the recursive mkdir so the plaintext index never lands under a
 * default-mode (typically 0755) directory.
 */
function writeAccountIndex(ids: string[], stateRoot?: string): void {
  if (stateRoot) {
    ensureStateRootDir(stateRoot);
  } else {
    ensureStateDir();
  }
  const file = accountsIndexPath(stateRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data: AccountIndex = { ids };
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Return the list of all normalised WeChat account IDs that have been
 * registered in the account index.
 *
 * @param stateRoot - Optional workspace-scoped state root.
 */
export function listIndexedWeixinAccountIds(stateRoot?: string): string[] {
  return readAccountIndex(stateRoot);
}

/**
 * Register a normalised account ID in the account index.
 *
 * The ID is added only if it is not already present. The index is persisted
 * immediately.
 *
 * @param stateRoot - Optional workspace-scoped state root.
 */
export function registerWeixinAccountId(accountId: string, stateRoot?: string): void {
  const ids = readAccountIndex(stateRoot);
  if (ids.includes(accountId)) {
    return;
  }
  ids.push(accountId);
  writeAccountIndex(ids, stateRoot);
  logger.info('Registered WeChat account ID', { accountId });
}

/**
 * Remove a normalised account ID from the account index.
 *
 * No-op if the ID is not indexed. The index is persisted immediately.
 * The per-account data file is **not** removed by this function.
 *
 * @param stateRoot - Optional workspace-scoped state root.
 */
export function unregisterWeixinAccountId(accountId: string, stateRoot?: string): void {
  const ids = readAccountIndex(stateRoot);
  const idx = ids.indexOf(accountId);
  if (idx === -1) {
    return;
  }
  ids.splice(idx, 1);
  writeAccountIndex(ids, stateRoot);
  logger.info('Unregistered WeChat account ID', { accountId });
}

// ---------------------------------------------------------------------------
// Stale-account cleanup
// ---------------------------------------------------------------------------

/**
 * Remove every registered account except `currentAccountId` for a given user.
 *
 * Typically called during user-switch or re-login to ensure only the active
 * account is retained.
 *
 * @param currentAccountId - The account ID to keep.
 * @param userId           - The user identifier (used only for logging).
 * @param onClearContextTokens - Optional callback invoked per removed account,
 *                               receiving the removed account ID so the caller
 *                               can revoke any associated credentials.
 */
export function clearStaleAccountsForUserId(
  currentAccountId: string,
  userId: string,
  onClearContextTokens?: (removedAccountId: string) => void,
  stateRoot?: string,
): void {
  const ids = readAccountIndex(stateRoot);
  const toRemove = ids.filter((id) => id !== currentAccountId);

  if (toRemove.length === 0) {
    return;
  }

  logger.info('Clearing stale accounts for user', {
    userId,
    keep: currentAccountId,
    removeCount: toRemove.length,
  });

  for (const staleId of toRemove) {
    clearWeixinAccount(staleId, stateRoot);
    onClearContextTokens?.(staleId);
  }

  // Re-write index with only the current account.
  writeAccountIndex([currentAccountId], stateRoot);
}

// ---------------------------------------------------------------------------
// Per-account data
// ---------------------------------------------------------------------------

/**
 * Data persisted per WeChat account.
 */
export interface WeixinAccountData {
  /** OAuth / session token. */
  token?: string;
  /** ISO-8601 timestamp of when the data was last saved. */
  savedAt?: string;
  /** Base URL override for the iLink API gateway. */
  baseUrl?: string;
  /** WeChat user ID associated with this account. */
  userId?: string;
}

/**
 * Load persisted data for a given account.
 *
 * Tries the per-account file first, then falls back to the legacy flat
 * credentials file for backward compatibility. Returns `null` when no data
 * can be found.
 */
export function loadWeixinAccount(
  accountId: string,
  stateRoot?: string,
): WeixinAccountData | null {
  // 1. Try the per-account file.
  const file = accountFilePath(accountId, stateRoot);
  try {
    const data = fs.readFileSync(file, 'utf-8');
    const parsed: WeixinAccountData = JSON.parse(data);
    return parsed;
  } catch {
    // Not found or unreadable — continue to fallback.
  }

  // 2. Try the legacy credentials file (scoped to the same state root).
  const legacy: WeixinAccountData | null = loadLegacyCredentials(stateRoot);
  if (legacy) {
    logger.info('Migrating account data from legacy credentials file', { accountId });
    // Persist the migrated data to the new location so the next read is fast.
    saveWeixinAccountImmediate(accountId, legacy, stateRoot);
    // Clear the legacy file so it is not re-read.
    clearLegacyCredentials(stateRoot);
    return legacy;
  }

  return null;
}

/**
 * Persist (or merge) data for a given account.
 *
 * The account ID is automatically registered in the index. The per-account
 * file is created/updated atomically (write to temp, then rename).
 *
 * @param accountId - The normalised account identifier.
 * @param update    - Fields to set on the account data object.
 */
export function saveWeixinAccount(
  accountId: string,
  update: { token?: string; baseUrl?: string; userId?: string },
  stateRoot?: string,
): void {
  registerWeixinAccountId(accountId, stateRoot);

  const existing = loadWeixinAccount(accountId, stateRoot) ?? {};
  const data: WeixinAccountData = {
    ...existing,
    ...update,
    savedAt: new Date().toISOString(),
  };

  saveWeixinAccountImmediate(accountId, data, stateRoot);
}

/**
 * Delete the per-account data file for the given account.
 *
 * Does **not** unregister the account from the index. Use
 * `unregisterWeixinAccountId` for index removal.
 */
export function clearWeixinAccount(accountId: string, stateRoot?: string): void {
  const file = accountFilePath(accountId, stateRoot);
  try {
    fs.unlinkSync(file);
    logger.info('Cleared WeChat account data', { accountId });
  } catch {
    // File already gone — nothing to do.
  }
}

// ---------------------------------------------------------------------------
// Low-level file helpers
// ---------------------------------------------------------------------------

/**
 * Write account data to disk, creating parent directories as needed.
 * Uses an atomic write (temp file + rename) to avoid partial writes.
 *
 * The state dir is created 0700 and the data file 0600 so the plaintext
 * OAuth/session token is not world-readable.
 */
function saveWeixinAccountImmediate(
  accountId: string,
  data: WeixinAccountData,
  stateRoot?: string,
): void {
  if (stateRoot) {
    ensureStateRootDir(stateRoot);
  } else {
    ensureStateDir();
  }
  const file = accountFilePath(accountId, stateRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Legacy credentials migration
// ---------------------------------------------------------------------------

/**
 * Read and parse the legacy flat credentials file.
 * Returns `null` when the file is missing or unparseable.
 */
function loadLegacyCredentials(stateRoot?: string): WeixinAccountData | null {
  const file = legacyCredentialsPath(stateRoot);
  try {
    const data = fs.readFileSync(file, 'utf-8');
    const parsed: WeixinAccountData = JSON.parse(data);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Remove the legacy credentials file so migration runs only once.
 */
function clearLegacyCredentials(stateRoot?: string): void {
  const file = legacyCredentialsPath(stateRoot);
  try {
    fs.unlinkSync(file);
  } catch {
    // Already gone or unwritable — not fatal.
  }
}

// ---------------------------------------------------------------------------
// Config helpers (route tag & bot agent)
// ---------------------------------------------------------------------------

/**
 * Load the "route tag" configuration for a specific account (or the default).
 *
 * The route tag is a string stored on the account data that tells the iLink
 * API which routing path to use for requests.
 *
 * @param accountId - Optional account ID. When omitted the first indexed
 *                    account is used, or `undefined` is returned when no
 *                    accounts are indexed.
 * @returns The route tag value, or `undefined` if not set.
 */
export function loadConfigRouteTag(accountId?: string, stateRoot?: string): string | undefined {
  const id = accountId ?? listIndexedWeixinAccountIds(stateRoot)[0];
  if (!id) {
    return undefined;
  }
  const data = loadWeixinAccount(id, stateRoot);
  return data?.baseUrl ?? DEFAULT_BASE_URL;
}

/**
 * Load the "bot agent" configuration value.
 *
 * The bot agent is a free-form string that identifies the agent / persona the
 * account should use. It is read from the first indexed account's data and
 * expected to be stored as the `userId` field (the upstream OpenClaw scheme
 * repurposes this field for the agent identifier).
 *
 * @returns The bot agent value, or `undefined` if no accounts are indexed or
 *          the value is not set.
 */
export function loadConfigBotAgent(stateRoot?: string): string | undefined {
  const ids = listIndexedWeixinAccountIds(stateRoot);
  const id = ids[0];
  if (!id) {
    return undefined;
  }
  const data = loadWeixinAccount(id, stateRoot);
  return data?.userId;
}
