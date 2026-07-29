// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

import { getUploadUrl, type WeixinApiOptions } from '../api/api';
import { encryptAesEcb } from './aes-ecb';
import { buildCdnUploadUrl } from './cdn-url';
import { logger } from '../util/logger';
import { getExtensionFromContentTypeOrUrl } from '../media/mime';
import { tempFileName } from '../util/random';
import { UploadMediaType } from '../api/types';
import type { GetUploadUrlResp } from '../api/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Information about a file uploaded to the WeChat CDN.
 */
export interface UploadedFileInfo {
  /** The file key (UUID) identifying the file on the CDN. */
  filekey: string;
  /** The encrypted query parameter returned by the CDN after upload, used for download. */
  downloadEncryptedQueryParam: string;
  /** AES-128 key (base64-encoded) used to encrypt the file. */
  aeskey: string;
  /** Size of the original plaintext file in bytes. */
  fileSize: number;
  /** Size of the encrypted (AES-128-ECB, PKCS#7 padded) file in bytes. */
  fileSizeCiphertext: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface EncryptedFileResult {
  ciphertext: Buffer;
  rawSize: number;
  rawMd5: string;
  aesKeyBase64: string;
}

/**
 * Encrypt a file buffer with a fresh AES-128-ECB key and compute its
 * plaintext metadata (MD5 hash and sizes).
 *
 * @param buffer - The raw file bytes to encrypt.
 * @returns The encrypted ciphertext and its associated metadata.
 */
function encryptFile(buffer: Buffer): EncryptedFileResult {
  const aesKey = randomBytes(16);
  const ciphertext = encryptAesEcb(buffer, aesKey);
  return {
    ciphertext,
    rawSize: buffer.length,
    rawMd5: createHash('md5').update(buffer).digest('hex'),
    aesKeyBase64: aesKey.toString('base64'),
  };
}

/**
 * POST an AES-128-ECB encrypted buffer to a CDN upload URL.
 * Returns the `x-encrypted-param` header value from the CDN response,
 * which is the download credential for the uploaded file.
 *
 * The CDN responds with:
 * - HTTP 200 on success, with `x-encrypted-param` set in the response headers.
 * - HTTP error on failure, with optional `x-error-message` header.
 *
 * @param ciphertext - AES-128-ECB encrypted file bytes.
 * @param uploadUrl  - The CDN upload URL returned by getUploadUrl.
 * @returns The `x-encrypted-param` download credential.
 */
async function uploadBufferToCdn(
  ciphertext: Buffer,
  uploadUrl: string,
): Promise<string> {
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(ciphertext),
  });

  if (!res.ok) {
    const errMsg =
      res.headers.get('x-error-message') ?? (await res.text());
    throw new Error(
      `WeChat CDN upload failed: HTTP ${res.status} ${errMsg}`,
    );
  }

  const encryptedParam = res.headers.get('x-encrypted-param');
  if (!encryptedParam) {
    throw new Error(
      'CDN response missing x-encrypted-param header',
    );
  }

  return encryptedParam;
}

/**
 * Execute the full CDN upload pipeline:
 * 1. Hash (MD5) and encrypt the file buffer with AES-128-ECB
 * 2. Request a CDN upload URL from the iLink API
 * 3. Upload the ciphertext to the CDN
 * 4. Return the resulting file info
 *
 * The file key used to identify the upload on the CDN is generated as a
 * version-4 UUID.
 */
async function executeUpload(
  buffer: Buffer,
  mediaType: UploadMediaType,
  opts: WeixinApiOptions,
  cdnBaseUrl: string,
  fileName?: string,
): Promise<UploadedFileInfo> {
  // 1. Hash & encrypt
  const { ciphertext, rawSize, rawMd5, aesKeyBase64 } = encryptFile(buffer);

  // 2. Request CDN upload URL
  const filekey = randomUUID();

  const uploadResp: GetUploadUrlResp = await getUploadUrl({
    media_type: mediaType,
    file_size: ciphertext.length,
    file_name: fileName,
    md5: rawMd5,
    ...opts,
  });

  if (uploadResp.ret !== 0 || uploadResp.errcode !== 0) {
    throw new Error(
      `getUploadUrl failed: ret=${uploadResp.ret} errcode=${uploadResp.errcode} errmsg=${uploadResp.errmsg}`,
    );
  }

  if (!uploadResp.url) {
    throw new Error('getUploadUrl: no upload URL returned');
  }

  // Build the full CDN upload URL from the server-provided parameter
  const fullUploadUrl = buildCdnUploadUrl({
    cdnBaseUrl,
    uploadParam: uploadResp.url,
    filekey,
  });

  // 3. Upload ciphertext to CDN; returns x-encrypted-param
  const downloadEncryptedQueryParam = await uploadBufferToCdn(
    ciphertext,
    fullUploadUrl,
  );

  // 4. Return structured file info
  return {
    filekey,
    downloadEncryptedQueryParam,
    aeskey: aesKeyBase64,
    fileSize: rawSize,
    fileSizeCiphertext: ciphertext.length,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Download a remote image from a URL to a temporary file in the given
 * directory. The file extension is inferred from the `Content-Type` response
 * header or the URL path.
 *
 * @param url     - The remote image URL to download.
 * @param destDir - The destination directory for the temporary file.
 * @returns The absolute path to the downloaded temporary file.
 */
export async function downloadRemoteImageToTemp(
  url: string,
  destDir: string,
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download remote image: HTTP ${response.status} from ${url}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = response.headers.get('content-type');
  const ext = getExtensionFromContentTypeOrUrl(contentType, url);
  const fileName = tempFileName('remote-img', ext);
  const filePath = join(destDir, fileName);

  await writeFile(filePath, buffer);

  logger.info(
    `Downloaded remote image (${buffer.length} bytes) to ${filePath}`,
  );

  return filePath;
}

/**
 * Upload a file to the WeChat CDN.
 *
 * The file is read from disk, hashed (MD5), encrypted with a fresh AES-128-ECB
 * key, uploaded via the CDN upload URL obtained from the API, and the
 * resulting file info is returned.
 *
 * @param params.filePath  - Path to the file on disk.
 * @param params.toUserId  - The target user ID for the upload.
 * @param params.opts      - WeChat API options (auth, base URL, etc.).
 * @param params.cdnBaseUrl - The CDN base URL for uploads.
 * @returns Metadata about the uploaded file on the CDN.
 */
export async function uploadFileToWeixin(
  params: {
    filePath: string;
    toUserId: string;
    opts: WeixinApiOptions;
    cdnBaseUrl: string;
  },
): Promise<UploadedFileInfo> {
  const { filePath, toUserId, opts, cdnBaseUrl } = params;
  const buffer = await readFile(filePath);
  const fileName = basename(filePath);

  logger.info(`Uploading file "${fileName}" (${buffer.length} bytes) for user ${toUserId}`);

  return executeUpload(buffer, UploadMediaType.FILE, opts, cdnBaseUrl, fileName);
}

/**
 * Upload a video to the WeChat CDN.
 *
 * The video file is read from disk, hashed (MD5), encrypted with a fresh
 * AES-128-ECB key, uploaded via the CDN upload URL obtained from the API,
 * and the resulting file info is returned.
 *
 * @param params.filePath  - Path to the video file on disk.
 * @param params.toUserId  - The target user ID for the upload.
 * @param params.opts      - WeChat API options (auth, base URL, etc.).
 * @param params.cdnBaseUrl - The CDN base URL for uploads.
 * @returns Metadata about the uploaded video on the CDN.
 */
export async function uploadVideoToWeixin(
  params: {
    filePath: string;
    toUserId: string;
    opts: WeixinApiOptions;
    cdnBaseUrl: string;
  },
): Promise<UploadedFileInfo> {
  const { filePath, toUserId, opts, cdnBaseUrl } = params;
  const buffer = await readFile(filePath);
  const fileName = basename(filePath);

  logger.info(`Uploading video "${fileName}" (${buffer.length} bytes) for user ${toUserId}`);

  return executeUpload(buffer, UploadMediaType.VIDEO, opts, cdnBaseUrl, fileName);
}

/**
 * Upload a file attachment with an explicit file name to the WeChat CDN.
 *
 * This function is identical to {@link uploadFileToWeixin} but accepts an
 * explicit `fileName` parameter that may differ from the on-disk basename.
 *
 * @param params.filePath  - Path to the file on disk.
 * @param params.fileName  - Explicit file name for the uploaded attachment.
 * @param params.toUserId  - The target user ID for the upload.
 * @param params.opts      - WeChat API options (auth, base URL, etc.).
 * @param params.cdnBaseUrl - The CDN base URL for uploads.
 * @returns Metadata about the uploaded attachment on the CDN.
 */
export async function uploadFileAttachmentToWeixin(
  params: {
    filePath: string;
    fileName: string;
    toUserId: string;
    opts: WeixinApiOptions;
    cdnBaseUrl: string;
  },
): Promise<UploadedFileInfo> {
  const { filePath, fileName, toUserId, opts, cdnBaseUrl } = params;
  const buffer = await readFile(filePath);

  logger.info(`Uploading attachment "${fileName}" (${buffer.length} bytes) for user ${toUserId}`);

  return executeUpload(buffer, UploadMediaType.FILE, opts, cdnBaseUrl, fileName);
}
