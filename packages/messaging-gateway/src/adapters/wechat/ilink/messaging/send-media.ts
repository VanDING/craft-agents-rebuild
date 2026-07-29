// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import * as path from 'node:path';

import type { WeixinApiOptions } from '../api/api';
import { logger } from '../util/logger';
import { getMimeFromFilename } from '../media/mime';
import {
  sendFileMessageWeixin,
  sendImageMessageWeixin,
  sendVideoMessageWeixin,
} from './send';
import {
  uploadFileAttachmentToWeixin,
  uploadFileToWeixin,
  uploadVideoToWeixin,
} from '../cdn/upload';

// ---------------------------------------------------------------------------
// sendWeixinMediaFile
// ---------------------------------------------------------------------------

/**
 * Upload a media file to the Weixin CDN and deliver it as a message.
 *
 * Routing (based on the file extension's MIME type):
 * - `video/*` → upload via `uploadVideoToWeixin` + send via `sendVideoMessageWeixin`
 * - `image/*` → upload via `uploadFileToWeixin`   + send via `sendImageMessageWeixin`
 * - otherwise → upload via `uploadFileAttachmentToWeixin` + send via `sendFileMessageWeixin`
 *
 * When `text` is non-empty the send function prepends a text message
 * before the media card.
 */
export async function sendWeixinMediaFile(params: {
  filePath: string;
  to: string;
  text: string;
  opts: WeixinApiOptions & { contextToken?: string; runId?: string };
  cdnBaseUrl: string;
}): Promise<{ messageId: string }> {
  const { filePath: fp, to, text, opts, cdnBaseUrl } = params;
  const mime = getMimeFromFilename(fp);
  const fileName = path.basename(fp);

  logger.info(`Sending media file: "${fileName}" (${mime}) to ${to}`, {
    mime,
    fileName,
    to,
  });

  // Build send-layer options (SendOptions picks only the fields it needs).
  const sendOpts = {
    baseUrl: opts.baseUrl,
    token: opts.token,
    contextToken: opts.contextToken,
    runId: opts.runId,
    timeoutMs: opts.timeoutMs,
  };

  if (mime.startsWith('video/')) {
    const uploaded = await uploadVideoToWeixin({
      filePath: fp,
      toUserId: to,
      opts,
      cdnBaseUrl,
    });
    logger.debug(`Video uploaded: ${uploaded.filekey}`, { filekey: uploaded.filekey });
    return sendVideoMessageWeixin({ to, text, uploaded, opts: sendOpts });
  }

  if (mime.startsWith('image/')) {
    const uploaded = await uploadFileToWeixin({
      filePath: fp,
      toUserId: to,
      opts,
      cdnBaseUrl,
    });
    logger.debug(`Image uploaded: ${uploaded.filekey}`, { filekey: uploaded.filekey });
    return sendImageMessageWeixin({ to, text, uploaded, opts: sendOpts });
  }

  // Default: file attachment
  const uploaded = await uploadFileAttachmentToWeixin({
    filePath: fp,
    fileName,
    toUserId: to,
    opts,
    cdnBaseUrl,
  });
  logger.debug(`File attachment uploaded: ${uploaded.filekey}`, { filekey: uploaded.filekey });
  return sendFileMessageWeixin({ to, text, fileName, uploaded, opts: sendOpts });
}
