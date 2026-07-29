// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import { MessageItemType } from '../api/types';
import type { MessageItem, CDNMedia } from '../api/types';
import { downloadAndDecryptBuffer, downloadPlainCdnBuffer } from '../cdn/pic-decrypt';
import { silkToWav } from './silk-transcode';
import { getMimeFromFilename } from './mime';
import { logger } from '../util/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Paths to successfully processed media files, populated by
 * {@link downloadMediaFromItem}.  Each field is set only when the
 * corresponding item type was handled.
 */
export interface WeixinInboundMediaOpts {
  /** Absolute path to the decrypted image file. */
  decryptedPicPath?: string;

  /** Absolute path to the decrypted and transcoded voice file (WAV). */
  decryptedVoicePath?: string;

  /** MIME type of the voice media (e.g. `"audio/wav"`). */
  voiceMediaType?: string;

  /** Absolute path to the decrypted file. */
  decryptedFilePath?: string;

  /** MIME type of the decrypted file. */
  fileMediaType?: string;

  /** Absolute path to the decrypted video file. */
  decryptedVideoPath?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective CDN download parameters from a {@link CDNMedia}
 * descriptor.
 *
 * @returns `null` when neither `encrypt_query_param` nor `full_url` is
 *          available, making the CDN media unusable.
 */
function resolveCdnMedia(
  cdn: CDNMedia,
): { encryptedQueryParam: string; aesKeyBase64: string | null; fullUrl?: string } | null {
  if (!cdn.encrypt_query_param && !cdn.full_url) return null;
  return {
    encryptedQueryParam: cdn.encrypt_query_param ?? '',
    aesKeyBase64: cdn.aes_key ?? null,
    fullUrl: cdn.full_url,
  };
}

/**
 * Extract the {@link CDNMedia} descriptor from a {@link MessageItem}
 * according to its type.
 *
 * @returns The CDN media descriptor and the numeric type, or `null` when
 *          the item is not a media type or carries no media data.
 */
function getMediaFromItem(
  item: MessageItem,
): { cdn: CDNMedia; type: number } | null {
  switch (item.type) {
    case MessageItemType.IMAGE:
      return item.image_item?.media
        ? { cdn: item.image_item.media, type: item.type }
        : null;
    case MessageItemType.VOICE:
      return item.voice_item?.media
        ? { cdn: item.voice_item.media, type: item.type }
        : null;
    case MessageItemType.FILE:
      return item.file_item?.media
        ? { cdn: item.file_item.media, type: item.type }
        : null;
    case MessageItemType.VIDEO:
      return item.video_item?.media
        ? { cdn: item.video_item.media, type: item.type }
        : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Options bag for {@link downloadMediaFromItem}.
 */
export interface DownloadMediaDeps {
  /**
   * Base URL of the CDN (e.g. `"https://novac2c.cdn.weixin.qq.com/c2c"`).
   */
  cdnBaseUrl: string;

  /**
   * Persist a media buffer to the filesystem.
   *
   * @param data              - Raw media bytes.
   * @param contentType       - MIME type hint for extension selection.
   * @param subdir            - Sub-directory within the media store.
   * @param maxBytes          - Optional size cap; saving is skipped when the
   *                            buffer exceeds this limit.
   * @param originalFilename  - Original file name for metadata / extension
   *                            fallback.
   * @returns The absolute path of the saved file.
   */
  saveMedia: (
    data: Buffer,
    contentType?: string,
    subdir?: string,
    maxBytes?: number,
    originalFilename?: string,
  ) => Promise<{ path: string }>;

  /** Informational log callback. */
  log: (msg: string) => void;

  /** Error log callback. */
  errLog: (msg: string, err: unknown) => void;

  /** Context label prepended to log messages for traceability. */
  label: string;
}

/**
 * Download and decrypt (or plain-download) media from a Weixin message item.
 *
 * Handles the following item types:
 *
 * | Type    | Behaviour                                                      |
 * |---------|----------------------------------------------------------------|
 * | `IMAGE` | Decrypt via AES-128-ECB, or plain download when no key present |
 * | `VOICE` | Decrypt + SILK-to-WAV transcoding (raw SILK on fallback)       |
 * | `FILE`  | Decrypt via AES-128-ECB                                        |
 * | `VIDEO` | Decrypt via AES-128-ECB                                        |
 *
 * Non-media items are silently skipped and return an empty result.
 *
 * @param item - A single message item from a `WeixinMessage.item_list`.
 * @param deps - Runtime dependencies and callbacks.
 * @returns A {@link WeixinInboundMediaOpts} populated only for the media
 *          type that was processed.  When an error occurs the relevant
 *          fields are left unset and the error is reported via `deps.errLog`.
 */
export async function downloadMediaFromItem(
  item: MessageItem,
  deps: DownloadMediaDeps,
): Promise<WeixinInboundMediaOpts> {
  const { cdnBaseUrl, saveMedia, log, errLog, label } = deps;
  const result: WeixinInboundMediaOpts = {};

  // -----------------------------------------------------------------------
  // 1. Extract CDN media info from the item.
  // -----------------------------------------------------------------------

  const mediaInfo = getMediaFromItem(item);
  if (!mediaInfo) {
    log(`[media-download:${label}] No CDN media on item type ${item.type}`);
    return result;
  }

  const { cdn, type } = mediaInfo;
  const resolved = resolveCdnMedia(cdn);
  if (!resolved) {
    log(`[media-download:${label}] CDN media descriptor has no URL`);
    return result;
  }

  const { encryptedQueryParam, aesKeyBase64, fullUrl } = resolved;

  // -----------------------------------------------------------------------
  // 2. Process by type.
  // -----------------------------------------------------------------------

  try {
    switch (type) {
      // -- IMAGE -----------------------------------------------------------
      case MessageItemType.IMAGE: {
        if (aesKeyBase64) {
          // Encrypted image — download and decrypt.
          const decrypted = await downloadAndDecryptBuffer(
            encryptedQueryParam,
            aesKeyBase64,
            cdnBaseUrl,
            label,
            fullUrl,
          );
          const saved = await saveMedia(decrypted, undefined, 'images');
          result.decryptedPicPath = saved.path;
        } else {
          // No key — plain download (e.g. thumbnail or unencrypted URL).
          const plain = await downloadPlainCdnBuffer(
            encryptedQueryParam,
            cdnBaseUrl,
            label,
            fullUrl,
          );
          const saved = await saveMedia(plain, undefined, 'images');
          result.decryptedPicPath = saved.path;
        }
        break;
      }

      // -- VOICE -----------------------------------------------------------
      case MessageItemType.VOICE: {
        if (!aesKeyBase64) {
          log(`[media-download:${label}] VOICE item missing aes_key`);
          return result;
        }

        const decrypted = await downloadAndDecryptBuffer(
          encryptedQueryParam,
          aesKeyBase64,
          cdnBaseUrl,
          label,
          fullUrl,
        );

        // Transcode SILK → WAV.
        const wav = await silkToWav(decrypted);
        if (wav) {
          const saved = await saveMedia(wav, 'audio/wav', 'voice');
          result.decryptedVoicePath = saved.path;
          result.voiceMediaType = 'audio/wav';
        } else {
          // silk-wasm unavailable — persist raw decrypted SILK.
          const saved = await saveMedia(decrypted, 'audio/silk', 'voice');
          result.decryptedVoicePath = saved.path;
          result.voiceMediaType = 'audio/silk';
        }
        break;
      }

      // -- FILE ------------------------------------------------------------
      case MessageItemType.FILE: {
        if (!aesKeyBase64) {
          log(`[media-download:${label}] FILE item missing aes_key`);
          return result;
        }

        const originalFilename = item.file_item?.file_name;
        const contentType = originalFilename
          ? getMimeFromFilename(originalFilename)
          : undefined;

        const decrypted = await downloadAndDecryptBuffer(
          encryptedQueryParam,
          aesKeyBase64,
          cdnBaseUrl,
          label,
          fullUrl,
        );
        const saved = await saveMedia(
          decrypted,
          contentType,
          'files',
          undefined,
          originalFilename,
        );
        result.decryptedFilePath = saved.path;
        result.fileMediaType = contentType ?? 'application/octet-stream';
        break;
      }

      // -- VIDEO -----------------------------------------------------------
      case MessageItemType.VIDEO: {
        if (!aesKeyBase64) {
          log(`[media-download:${label}] VIDEO item missing aes_key`);
          return result;
        }

        const decrypted = await downloadAndDecryptBuffer(
          encryptedQueryParam,
          aesKeyBase64,
          cdnBaseUrl,
          label,
          fullUrl,
        );
        const saved = await saveMedia(decrypted, undefined, 'video');
        result.decryptedVideoPath = saved.path;
        break;
      }

      default:
        log(`[media-download:${label}] Unsupported item type ${type}`);
    }
  } catch (err) {
    errLog(`[media-download:${label}] Failed to process item type ${type}`, err);
  }

  return result;
}
