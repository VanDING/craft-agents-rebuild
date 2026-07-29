// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

/**
 * Whether to fall back to a CDN URL constructed from `encrypt_query_param`
 * when the server omits `full_url` for a download.
 *
 * When enabled, `buildCdnDownloadUrl` is used as the fallback path;
 * when disabled, a missing `full_url` produces no download URL.
 */
export const ENABLE_CDN_URL_FALLBACK = true;

/**
 * Build a CDN download URL from the encrypted query parameter.
 *
 * @param encryptedQueryParam - The `encrypt_query_param` value returned by the server
 *                              for a specific media download.
 * @param cdnBaseUrl           - The CDN base URL (e.g. `https://novac2c.cdn.weixin.qq.com/c2c`).
 * @returns A fully qualified CDN download URL.
 */
export function buildCdnDownloadUrl(
  encryptedQueryParam: string,
  cdnBaseUrl: string,
): string {
  return `${cdnBaseUrl}?encrypt_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

/**
 * Options for {@link buildCdnUploadUrl}.
 */
export interface BuildCdnUploadUrlOptions {
  /** The CDN base URL (e.g. `https://novac2c.cdn.weixin.qq.com/c2c`). */
  cdnBaseUrl: string;

  /**
   * The upload parameter returned by the server, typically a key-value query
   * fragment (e.g. `upload_key=abc&upload_token=xyz`). May also be a fully
   * qualified URL starting with `http://` or `https://`, in which case it is
   * returned as-is.
   */
  uploadParam: string;

  /**
   * The file key (UUID) identifying the file being uploaded. Appended to the
   * constructed URL as the `filekey` query parameter.
   */
  filekey: string;
}

/**
 * Build a CDN upload URL from the server-provided upload parameter and file key.
 *
 * When `uploadParam` is already an absolute URL (http/https), it is returned
 * directly unchanged. Otherwise it is treated as a query-string fragment and
 * appended to `cdnBaseUrl`, with `filekey` added as an additional parameter.
 *
 * @param options - Upload URL construction options.
 * @returns A fully qualified CDN upload URL.
 */
export function buildCdnUploadUrl(options: BuildCdnUploadUrlOptions): string {
  const { cdnBaseUrl, uploadParam, filekey } = options;

  // Absolute URL — use as-is; the server has already resolved the endpoint.
  if (
    uploadParam.startsWith('http://') ||
    uploadParam.startsWith('https://')
  ) {
    return uploadParam;
  }

  // Query fragment — append to the CDN base URL with the file key.
  const separator = uploadParam.startsWith('?') ? '' : '?';
  return `${cdnBaseUrl}${separator}${uploadParam}&filekey=${encodeURIComponent(filekey)}`;
}
