// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveRawAccountId } from '../auth/accounts';
import { resolveStateDir } from './state-dir';

/** Shape of the persisted sync buffer file. */
export interface SyncBufData {
  get_updates_buf: string;
}

/**
 * Build the filesystem path for an account's sync-buf persistence file.
 * The file is stored under the shared state directory (see {@link resolveStateDir}).
 */
export function getSyncBufFilePath(accountId: string): string {
  return join(resolveStateDir(), `sync-buf-${accountId}.sync.json`);
}

/**
 * Load the persisted `get_updates_buf` cursor for the given file path.
 *
 * Fallback chain:
 * 1. **Primary** — read the file directly as {@link SyncBufData}.
 * 2. **Compat raw ID** — if the account ID embedded in `filePath` is a
 *    normalized form, derive the raw account ID via {@link deriveRawAccountId}
 *    and try that path with the same `.sync.json` extension.
 * 3. **Legacy** — for the raw account ID, try the legacy file name
 *    (`sync-buf-${rawId}.json`) used by earlier adapter versions.
 *
 * @returns the cursor string, or `undefined` if no readable file is found.
 */
export function loadGetUpdatesBuf(filePath: string): string | undefined {
  // 1. Primary — direct read of the given path.
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as SyncBufData;
      if (typeof data.get_updates_buf === 'string') {
        return data.get_updates_buf;
      }
    } catch {
      // malformed — fall through
    }
  }

  // Attempt to extract the account ID from the path for fallback resolution.
  const ext = '.sync.json';
  const extIdx = filePath.lastIndexOf(ext);
  if (extIdx === -1) return undefined;
  const prefix = filePath.slice(0, extIdx);
  const marker = 'sync-buf-';
  const markerIdx = prefix.lastIndexOf(marker);
  if (markerIdx === -1) return undefined;
  const accountId = prefix.slice(markerIdx + marker.length);
  if (!accountId) return undefined;

  const rawId = deriveRawAccountId(accountId);
  if (!rawId || rawId === accountId) return undefined;

  const baseDir = filePath.slice(0, markerIdx);

  // 2. Compat raw ID — same `.sync.json` extension, raw account ID.
  const compatPath = `${baseDir}sync-buf-${rawId}${ext}`;
  if (compatPath !== filePath && existsSync(compatPath)) {
    try {
      const raw = readFileSync(compatPath, 'utf-8');
      const data = JSON.parse(raw) as SyncBufData;
      if (typeof data.get_updates_buf === 'string') {
        return data.get_updates_buf;
      }
    } catch {
      // malformed — fall through
    }
  }

  // 3. Legacy — flat `.json` extension (without `.sync`) for the raw ID.
  const legacyPath = `${baseDir}sync-buf-${rawId}.json`;
  if (legacyPath !== compatPath && existsSync(legacyPath)) {
    try {
      const raw = readFileSync(legacyPath, 'utf-8');
      const data = JSON.parse(raw) as SyncBufData;
      if (typeof data.get_updates_buf === 'string') {
        return data.get_updates_buf;
      }
    } catch {
      // malformed — fall through
    }
  }

  return undefined;
}

/**
 * Persist the `get_updates_buf` cursor so it survives restarts.
 *
 * @param filePath — path produced by {@link getSyncBufFilePath}
 * @param getUpdatesBuf — the opaque cursor string to store
 */
export function saveGetUpdatesBuf(
  filePath: string,
  getUpdatesBuf: string,
): void {
  const data: SyncBufData = { get_updates_buf: getUpdatesBuf };
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
