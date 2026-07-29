// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import { encryptAesEcb } from './aes-ecb.ts';
import { buildCdnUploadUrl } from './cdn-url.ts';
import { logger } from '../util/logger.ts';

/**
 * Maximum number of retry attempts for server errors.
 * Client errors (4xx) are never retried.
 */
const MAX_RETRIES = 3;

export interface UploadBufferToCdnParams {
  /** Plaintext buffer to encrypt and upload. */
  buf: Buffer;
  /**
   * Optional full CDN upload URL.
   * When absent the URL is built from `uploadParam` and `cdnBaseUrl`.
   */
  uploadFullUrl?: string;
  /** Upload parameter returned by the getuploadurl API. */
  uploadParam: string;
  /** File key identifying the upload target. */
  filekey: string;
  /** CDN base URL used when `uploadFullUrl` is not provided. */
  cdnBaseUrl: string;
  /** Human-readable label for logging. */
  label: string;
  /** AES-128 key (16 bytes) used to encrypt the buffer. */
  aeskey: Buffer;
}

export interface UploadBufferToCdnResult {
  /** Value of the `x-encrypted-param` response header. */
  downloadParam: string;
}

/**
 * Encrypt a buffer with AES-128-ECB and POST it to the WeChat CDN.
 *
 * Retries on server errors (5xx) and network errors up to
 * {@link MAX_RETRIES} times. Client errors (4xx) and missing
 * `x-encrypted-param` in a successful response abort immediately.
 *
 * @returns The `x-encrypted-param` header value from the CDN response.
 */
export async function uploadBufferToCdn(
  params: UploadBufferToCdnParams,
): Promise<UploadBufferToCdnResult> {
  const { buf, uploadFullUrl, uploadParam, filekey, cdnBaseUrl, label, aeskey } =
    params;

  // Encrypt the buffer with the provided AES-128-ECB key.
  const ciphertext = encryptAesEcb(buf, aeskey);

  // Build the upload URL (use full URL if given, otherwise construct it).
  const uploadParamValue = uploadFullUrl?.trim() || uploadParam?.trim() || '';
  const uploadUrl = buildCdnUploadUrl({ cdnBaseUrl, uploadParam: uploadParamValue, filekey });

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(ciphertext),
      });

      if (response.ok) {
        const downloadParam = response.headers.get('x-encrypted-param');
        if (!downloadParam) {
          throw new Error('CDN response missing x-encrypted-param header');
        }
        logger.info('CDN upload succeeded', {
          label,
          filekey,
          attempt: attempt + 1,
        });
        return { downloadParam };
      }

      // Read the error body (prefer the x-error-message header).
      const errBody =
        response.headers.get('x-error-message') ?? (await response.text());

      // Client errors (4xx) are non-retryable — abort immediately.
      if (response.status >= 400 && response.status < 500) {
        throw new Error(
          `CDN upload rejected (HTTP ${response.status}): ${errBody}`,
        );
      }

      // Server error (5xx) — log and retry if attempts remain.
      lastError = new Error(
        `CDN upload failed (HTTP ${response.status}): ${errBody}`,
      );
      if (attempt < MAX_RETRIES) {
        logger.warn('CDN upload attempt failed, retrying', {
          label,
          filekey,
          status: response.status,
          attempt: attempt + 1,
        });
      }
    } catch (err) {
      // Re-throw client-request rejections immediately.
      if (
        err instanceof Error &&
        err.message.startsWith('CDN upload rejected')
      ) {
        throw err;
      }

      // Network or other transient error — retry.
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        logger.warn('CDN upload error, retrying', {
          label,
          filekey,
          error: lastError.message,
          attempt: attempt + 1,
        });
      }
    }
  }

  throw lastError ?? new Error('CDN upload failed after max retries');
}
