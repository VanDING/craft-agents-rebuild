// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import { randomBytes } from 'node:crypto';

/**
 * Generate a prefixed random ID.
 *
 * @param prefix - The string prefix for the ID.
 * @returns A string in the format `{prefix}:{timestamp}-{8-char hex}`.
 */
export function generateId(prefix: string): string {
  const timestamp = Date.now().toString();
  const hex = randomBytes(4).toString('hex');
  return `${prefix}:${timestamp}-${hex}`;
}

/**
 * Generate a temporary file name.
 *
 * @param prefix - The string prefix for the file name.
 * @param ext    - The file extension including the leading dot (e.g. `.tmp`).
 * @returns A string in the format `{prefix}-{timestamp}-{8-char hex}{ext}`.
 */
export function tempFileName(prefix: string, ext: string): string {
  const timestamp = Date.now().toString();
  const hex = randomBytes(4).toString('hex');
  return `${prefix}-${timestamp}-${hex}${ext}`;
}
