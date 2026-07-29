// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveStateDir } from '../storage/state-dir';
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

/** Directory holding the account index and per-account data files. */
function accountsDir(): string {
  return path.join(resolveStateDir(), 'openclaw-weixin');
}

/** Path to the JSON file that lists all registered account IDs. */
function accountsIndexPath(): string {
  return path.join(accountsDir(), 'accounts.json');
}

/** Per-account data file. */
function accountFilePath(accountId: string): string {
  const dir = path.join(accountsDir(), 'accounts');
  return path.join(dir, `${accountId}.json`);
}

/** Legacy credentials file used as a fallback during migration. */
function legacyCredentialsPath(): string {
  return path.join(resolveStateDir(), 'credentials', 'openclaw-weixin', 'credentials.json');
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
function readAccountIndex(): string[] {
  try {
    const data = fs.readFileSync(accountsIndexPath(), 'utf-8');
    const parsed: AccountIndex = JSON.parse(data);
    return Array.isArray(parsed.ids) ? parsed.ids : [];
  } catch {
    return [];
  }
}

/** Persist the account index to disk, creating parent directories as needed. */
function writeAccountIndex(ids: string[]): void {
  const file = accountsIndexPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data: AccountIndex = { ids };
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Return the list of all normalised WeChat account IDs that have been
 * registered in the account index.
 */
export function listIndexedWeixinAccountIds(): string[] {
  return readAccountIndex();
}

/**
 * Register a normalised account ID in the account index.
 *
 * The ID is added only if it is not already present. The index is persisted
 * immediately.
 */
export function registerWeixinAccountId(accountId: string): void {
  const ids = readAccountIndex();
  if (ids.includes(accountId)) {
    return;
  }
  ids.push(accountId);
  writeAccountIndex(ids);
  logger.info('Registered WeChat account ID', { accountId });
}

/**
 * Remove a normalised account ID from the account index.
 *
 * No-op if the ID is not indexed. The index is persisted immediately.
 * The per-account data file is **not** removed by this function.
 */
export function unregisterWeixinAccountId(accountId: string): void {
  const ids = readAccountIndex();
  const idx = ids.indexOf(accountId);
  if (idx === -1) {
    return;
  }
  ids.splice(idx, 1);
  writeAccountIndex(ids);
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
): void {
  const ids = readAccountIndex();
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
    clearWeixinAccount(staleId);
    onClearContextTokens?.(staleId);
  }

  // Re-write index with only the current account.
  writeAccountIndex([currentAccountId]);
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
export function loadWeixinAccount(accountId: string): WeixinAccountData | null {
  // 1. Try the per-account file.
  const file = accountFilePath(accountId);
  try {
    const data = fs.readFileSync(file, 'utf-8');
    const parsed: WeixinAccountData = JSON.parse(data);
    return parsed;
  } catch {
    // Not found or unreadable — continue to fallback.
  }

  // 2. Try the legacy credentials file.
  const legacy: WeixinAccountData | null = loadLegacyCredentials();
  if (legacy) {
    logger.info('Migrating account data from legacy credentials file', { accountId });
    // Persist the migrated data to the new location so the next read is fast.
    saveWeixinAccountImmediate(accountId, legacy);
    // Clear the legacy file so it is not re-read.
    clearLegacyCredentials();
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
): void {
  registerWeixinAccountId(accountId);

  const existing = loadWeixinAccount(accountId) ?? {};
  const data: WeixinAccountData = {
    ...existing,
    ...update,
    savedAt: new Date().toISOString(),
  };

  saveWeixinAccountImmediate(accountId, data);
}

/**
 * Delete the per-account data file for the given account.
 *
 * Does **not** unregister the account from the index. Use
 * `unregisterWeixinAccountId` for index removal.
 */
export function clearWeixinAccount(accountId: string): void {
  const file = accountFilePath(accountId);
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
 */
function saveWeixinAccountImmediate(accountId: string, data: WeixinAccountData): void {
  const file = accountFilePath(accountId);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Legacy credentials migration
// ---------------------------------------------------------------------------

/**
 * Read and parse the legacy flat credentials file.
 * Returns `null` when the file is missing or unparseable.
 */
function loadLegacyCredentials(): WeixinAccountData | null {
  const file = legacyCredentialsPath();
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
function clearLegacyCredentials(): void {
  const file = legacyCredentialsPath();
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
export function loadConfigRouteTag(accountId?: string): string | undefined {
  const id = accountId ?? listIndexedWeixinAccountIds()[0];
  if (!id) {
    return undefined;
  }
  const data = loadWeixinAccount(id);
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
export function loadConfigBotAgent(): string | undefined {
  const ids = listIndexedWeixinAccountIds();
  const id = ids[0];
  if (!id) {
    return undefined;
  }
  const data = loadWeixinAccount(id);
  return data?.userId;
}
