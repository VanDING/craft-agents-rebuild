// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import { extname } from 'node:path';

// ---------------------------------------------------------------------------
// Extension → MIME type
// ---------------------------------------------------------------------------

const extToMime: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls':  'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt':  'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt':  'text/plain',
  '.csv':  'text/csv',
  '.zip':  'application/zip',
  '.tar':  'application/x-tar',
  '.gz':   'application/gzip',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
  '.wav':  'audio/wav',
  '.mp4':  'video/mp4',
  '.mov':  'video/quicktime',
  '.webm': 'video/webm',
  '.mkv':  'video/x-matroska',
  '.avi':  'video/x-msvideo',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.bmp':  'image/bmp',
};

// ---------------------------------------------------------------------------
// MIME type → extension
// ---------------------------------------------------------------------------

/**
 * Build the reverse mapping statically so both lookups share the same enum.
 * When multiple extensions map to the same MIME (e.g. .jpg / .jpeg), the
 * preferred extension (the first one encountered) wins.
 */
const mimeToExt: Record<string, string> = {};
for (const [ext, mime] of Object.entries(extToMime)) {
  if (!(mime in mimeToExt)) {
    mimeToExt[mime] = ext;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the MIME type for a filename based on its extension.
 *
 * @param filename - File name (with or without path).
 * @returns The corresponding MIME type, or `application/octet-stream` when
 *          the extension is not recognized.
 */
export function getMimeFromFilename(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return extToMime[ext] ?? 'application/octet-stream';
}

/**
 * Return the preferred file extension (including the leading dot) for a
 * MIME type.
 *
 * @param mimeType - A MIME type string (e.g. `"image/jpeg"`).
 * @returns The preferred extension (e.g. `".jpg"`), or `".bin"` when the
 *          MIME type is not recognized.
 */
export function getExtensionFromMime(mimeType: string): string {
  const key = mimeType.toLowerCase();
  return mimeToExt[key] ?? '.bin';
}

/**
 * Extract a file extension string from either a `Content-Type` header or a
 * URL path.  The `Content-Type` takes precedence when present and
 * recognised.
 *
 * @param contentType - The `Content-Type` header value (may include
 *                      parameters such as `charset`).
 * @param url         - The resource URL used as fallback.
 * @returns A file extension with the leading dot (e.g. `".png"`), or `".bin"`
 *          when neither source yields a known extension.
 */
export function getExtensionFromContentTypeOrUrl(
  contentType: string | undefined | null,
  url: string | undefined | null,
): string {
  // Try Content-Type first.
  if (contentType) {
    const bare = contentType.split(';')[0]!.trim().toLowerCase();
    if (bare) {
      const ext = getExtensionFromMime(bare);
      if (ext !== '.bin') return ext;
    }
  }

  // Fall back to the last path segment of the URL.
  if (url) {
    try {
      const parsed = new URL(url);
      const ext = extname(parsed.pathname).toLowerCase();
      if (ext && extToMime[ext]) return ext;
    } catch {
      // URL may be relative or malformed — treat as a path string.
      const ext = extname(url).toLowerCase();
      if (ext && extToMime[ext]) return ext;
    }
  }

  return '.bin';
}
