// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import { decryptAesEcb } from './aes-ecb';
import { buildCdnDownloadUrl } from './cdn-url';
import { logger } from '../util/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse an AES-128 key from its base64-encoded representation.
 *
 * The upstream may encode the key in one of two formats:
 * 1. `base64(16 raw bytes)` — 16 bytes after base64 decode (24 base64 chars with `=` padding).
 * 2. `base64(hex string of 16 bytes)` — base64 wraps 32 ASCII hex characters;
 *    the 32 decoded bytes are then re-parsed as hex to yield the 16‑byte key.
 *
 * @param aesKeyBase64 - Base64-encoded AES key.
 * @param label        - Context label used in warning messages.
 * @returns A 16-byte `Buffer` suitable for AES-128-ECB.
 */
function parseAesKey(aesKeyBase64: string, label: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, 'base64');

  // Format 1: directly encodes 16 raw key bytes.
  if (decoded.length === 16) {
    return decoded;
  }

  // Format 2: base64 wraps a 32-character hex string that represents 16 bytes.
  if (decoded.length === 32) {
    const hex = decoded.toString('ascii');
    return Buffer.from(hex, 'hex');
  }

  // Unexpected length — warn and return whatever we got; the caller may still fail upstream.
  logger.warn(
    `[pic-decrypt:${label}] Unexpected AES key length ${decoded.length} bytes after base64 decode; expected 16 or 32. Treating raw.`,
  );
  return decoded;
}

/**
 * Fetch raw bytes from a CDN URL via `fetch`.
 *
 * @param url   - Fully-qualified CDN download URL.
 * @param label - Context label for log/error messages.
 * @returns The response body as a `Buffer`.
 */
async function fetchCdnBytes(url: string, label: string): Promise<Buffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `[pic-decrypt:${label}] CDN fetch failed: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Download an encrypted CDN file and decrypt it with AES-128-ECB.
 *
 * The `aesKeyBase64` parameter accepts both key encoding formats described in
 * {@link parseAesKey}. When `fullUrl` is provided the function uses it
 * directly; otherwise it builds the URL via {@link buildCdnDownloadUrl}.
 *
 * @param encryptedQueryParam - Encrypted query parameter for the CDN URL.
 * @param aesKeyBase64        - Base64-encoded AES key (16 raw bytes or 32-char hex).
 * @param cdnBaseUrl          - Base URL of the CDN.
 * @param label               - Context label for logging and error messages.
 * @param fullUrl             - Optional override URL; skips URL construction when set.
 * @returns Decrypted file content.
 */
export async function downloadAndDecryptBuffer(
  encryptedQueryParam: string,
  aesKeyBase64: string,
  cdnBaseUrl: string,
  label: string,
  fullUrl?: string,
): Promise<Buffer> {
  const key = parseAesKey(aesKeyBase64, label);
  const url = fullUrl ?? buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl);

  logger.info(`[pic-decrypt:${label}] Downloading encrypted CDN data`, {
    urlLength: url.length,
    keyLength: key.length,
  });

  const encrypted = await fetchCdnBytes(url, label);
  return decryptAesEcb(encrypted, key);
}

/**
 * Download a CDN file without decryption.
 *
 * Useful for non-encrypted CDN resources or when the caller handles
 * decryption separately. When `fullUrl` is provided the function uses it
 * directly; otherwise it builds the URL via {@link buildCdnDownloadUrl}.
 *
 * @param encryptedQueryParam - Encrypted query parameter for the CDN URL.
 * @param cdnBaseUrl          - Base URL of the CDN.
 * @param label               - Context label for logging and error messages.
 * @param fullUrl             - Optional override URL; skips URL construction when set.
 * @returns Raw CDN file content.
 */
export async function downloadPlainCdnBuffer(
  encryptedQueryParam: string,
  cdnBaseUrl: string,
  label: string,
  fullUrl?: string,
): Promise<Buffer> {
  const url = fullUrl ?? buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl);

  logger.info(`[pic-decrypt:${label}] Downloading plain CDN data`, {
    urlLength: url.length,
  });

  return fetchCdnBytes(url, label);
}
