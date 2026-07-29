// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import { sendMessage as sendMessageApi } from '../api/api';
import type { WeixinApiOptions } from '../api/api';
import { logger } from '../util/logger';
import { generateId } from '../util/random';
import {
  MessageType,
  MessageState,
  MessageItemType,
} from '../api/types';
import type {
  MessageItem,
  SendMessageReq,
  WeixinMessage,
} from '../api/types';
import type { UploadedFileInfo } from '../cdn/upload';
import { buildCdnDownloadUrl } from '../cdn/cdn-url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** AES-128-ECB encryption type value used by WeChat CDN. */
const CDN_ENCRYPT_TYPE = 2;

/** Prefix for client-generated message IDs. */
const CLIENT_ID_PREFIX = 'openclaw-weixin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options accepted by every send function.
 * Extends the base API connection options with per-message fields.
 */
export interface SendOptions extends WeixinApiOptions {
  /** Per-message context token forwarded to the bot runtime. */
  contextToken?: string;
  /** Per-message run identifier forwarded to the bot runtime. */
  runId?: string;
  /**
   * CDN base URL used to construct the media download URL.
   * Required for media sends; ignored for plain text sends.
   * Example: `https://novac2c.cdn.weixin.qq.com/c2c`
   */
  cdnBaseUrl?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unique client ID for a message.
 * Used to correlate sent messages with server acknowledgements.
 */
function generateClientId(): string {
  return generateId(CLIENT_ID_PREFIX);
}

/**
 * Build a {@link SendMessageReq} containing a single text item.
 *
 * @param to       - The recipient user ID.
 * @param text     - The text content to send.
 * @param clientId - Unique client-generated ID for this message.
 * @param opts     - Send options including API connection and message context.
 * @returns A ready-to-send request object.
 */
function buildTextMessageReq(
  to: string,
  text: string,
  clientId: string,
  opts: SendOptions,
): SendMessageReq {
  return buildSendMessageReq(
    to,
    [
      {
        type: 1 satisfies MessageItemType, // TEXT
        create_time_ms: Date.now(),
        update_time_ms: Date.now(),
        is_completed: true,
        msg_id: clientId,
        text_item: { content: text },
      },
    ],
    clientId,
    opts,
  );
}

/**
 * Build a {@link SendMessageReq} wrapping the given item list.
 *
 * @param to       - The recipient user ID.
 * @param items    - The message items to include.
 * @param clientId - Unique client-generated ID for this message.
 * @param opts     - Send options including API connection and message context.
 * @returns A ready-to-send request object.
 */
function buildSendMessageReq(
  to: string,
  items: MessageItem[],
  clientId: string,
  opts: SendOptions,
): SendMessageReq {
  const msg: WeixinMessage = {
    from_user_id: '',
    to_user_id: to,
    client_id: clientId,
    message_type: MessageType.BOT,
    message_state: MessageState.FINISH,
    item_list: items,
  };

  if (opts.contextToken) {
    msg.context_token = opts.contextToken;
  }
  if (opts.runId) {
    msg.run_id = opts.runId;
  }

  return { msg };
}

/**
 * Build a CDN media descriptor from uploaded file information.
 */
function buildCdnMedia(
  uploaded: UploadedFileInfo,
  cdnBaseUrl?: string,
): {
  encrypt_query_param: string;
  aes_key: string;
  encrypt_type: number;
  full_url: string;
} {
  const encrypt_query_param = uploaded.downloadEncryptedQueryParam;
  return {
    encrypt_query_param,
    aes_key: uploaded.aeskey,
    encrypt_type: CDN_ENCRYPT_TYPE,
    full_url: cdnBaseUrl
      ? buildCdnDownloadUrl(encrypt_query_param, cdnBaseUrl)
      : '',
  };
}

// ---------------------------------------------------------------------------
// sendMediaItems — text caption + media as separate messages
// ---------------------------------------------------------------------------

/**
 * Send a text caption followed by a media message.
 *
 * Each message gets its own `client_id`. The text caption is sent first when
 * non-empty, then the media item. The returned `messageId` belongs to the
 * media message.
 *
 * @param to         - The recipient user ID.
 * @param text       - Optional text caption (sent as a separate message).
 * @param mediaItem  - The media {@link MessageItem} to send.
 * @param opts       - Send options including API connection and message context.
 * @param clientId   - Optional explicit client ID for the media message.
 *                     Auto-generated when omitted.
 * @returns The media message's client-assigned ID.
 */
async function sendMediaItems(
  to: string,
  text: string,
  mediaItem: MessageItem,
  opts: SendOptions,
  clientId?: string,
): Promise<{ messageId: string }> {
  const mediaClientId = clientId ?? generateClientId();

  // Send text caption first (if non-empty), sharing the same context.
  if (text) {
    const textClientId = generateClientId();
    const textReq = buildTextMessageReq(to, text, textClientId, opts);
    logger.debug('Sending text caption', {
      clientId: textClientId,
      to,
      textLength: text.length,
    });
    await sendMessageApi({ ...opts, body: textReq });
  }

  // Send the media message.
  const mediaReq = buildSendMessageReq(to, [mediaItem], mediaClientId, opts);
  logger.debug('Sending media message', {
    clientId: mediaClientId,
    to,
    itemType: mediaItem.type,
  });
  await sendMessageApi({ ...opts, body: mediaReq });

  return { messageId: mediaClientId };
}

// ---------------------------------------------------------------------------
// Exported send functions
// ---------------------------------------------------------------------------

/**
 * Send a plain text message.
 *
 * @param params.to   - The recipient user ID.
 * @param params.text - The text content to send.
 * @param params.opts - Send options (API connection, context, etc.).
 * @returns The client-assigned message ID.
 */
export async function sendMessageWeixin(
  params: {
    to: string;
    text: string;
    opts: SendOptions;
  },
): Promise<{ messageId: string }> {
  const { to, text, opts } = params;
  const clientId = generateClientId();
  const req = buildTextMessageReq(to, text, clientId, opts);

  logger.debug('sendMessageWeixin', { clientId, to, textLength: text.length });
  await sendMessageApi({ ...opts, body: req });
  return { messageId: clientId };
}

/**
 * Send a pre-built {@link MessageItem}.
 *
 * Useful when the caller has already constructed a complex message item and
 * only needs the transport layer to deliver it.
 *
 * @param params.to       - The recipient user ID.
 * @param params.item     - The message item to send.
 * @param params.opts     - Send options (API connection, context, etc.).
 * @param params.clientId - Optional explicit client ID. Auto-generated when omitted.
 * @param params.label    - Optional debug label attached to log output.
 * @returns The client-assigned message ID.
 */
export async function sendMessageItemWeixin(
  params: {
    to: string;
    item: MessageItem;
    opts: SendOptions;
    clientId?: string;
    label?: string;
  },
): Promise<{ messageId: string }> {
  const { to, item, opts, clientId, label } = params;
  const msgClientId = clientId ?? generateClientId();
  const req = buildSendMessageReq(to, [item], msgClientId, opts);

  logger.debug('sendMessageItemWeixin', {
    clientId: msgClientId,
    to,
    itemType: item.type,
    label,
  });
  await sendMessageApi({ ...opts, body: req });
  return { messageId: msgClientId };
}

/**
 * Send an image message with an optional text caption.
 *
 * The caption (when non-empty) is delivered as a separate text message before
 * the image, per WeChat's convention for media with descriptions.
 *
 * @param params.to       - The recipient user ID.
 * @param params.text     - Optional text caption (empty string to skip).
 * @param params.uploaded - The uploaded image CDN information.
 * @param params.opts     - Send options (API connection, context, etc.).
 * @returns The image message's client-assigned ID.
 */
export async function sendImageMessageWeixin(
  params: {
    to: string;
    text: string;
    uploaded: UploadedFileInfo;
    opts: SendOptions;
  },
): Promise<{ messageId: string }> {
  const { to, text, uploaded, opts } = params;
  const media = buildCdnMedia(uploaded, opts.cdnBaseUrl);

  const imageItem: MessageItem = {
    type: 2 satisfies MessageItemType, // IMAGE
    create_time_ms: Date.now(),
    update_time_ms: Date.now(),
    is_completed: true,
    msg_id: generateClientId(),
    image_item: {
      media,
    },
  };

  return sendMediaItems(to, text, imageItem, opts);
}

/**
 * Send a video message with an optional text caption.
 *
 * The caption (when non-empty) is delivered as a separate text message before
 * the video, per WeChat's convention for media with descriptions.
 *
 * @param params.to       - The recipient user ID.
 * @param params.text     - Optional text caption (empty string to skip).
 * @param params.uploaded - The uploaded video CDN information.
 * @param params.opts     - Send options (API connection, context, etc.).
 * @returns The video message's client-assigned ID.
 */
export async function sendVideoMessageWeixin(
  params: {
    to: string;
    text: string;
    uploaded: UploadedFileInfo;
    opts: SendOptions;
  },
): Promise<{ messageId: string }> {
  const { to, text, uploaded, opts } = params;
  const media = buildCdnMedia(uploaded, opts.cdnBaseUrl);

  const videoItem: MessageItem = {
    type: 5 satisfies MessageItemType, // VIDEO
    create_time_ms: Date.now(),
    update_time_ms: Date.now(),
    is_completed: true,
    msg_id: generateClientId(),
    video_item: {
      media,
      video_size: uploaded.fileSize,
    },
  };

  return sendMediaItems(to, text, videoItem, opts);
}

/**
 * Send a file message with an optional text caption.
 *
 * The caption (when non-empty) is delivered as a separate text message before
 * the file, per WeChat's convention for media with descriptions.
 *
 * @param params.to       - The recipient user ID.
 * @param params.text     - Optional text caption (empty string to skip).
 * @param params.fileName - The human-readable file name to display.
 * @param params.uploaded - The uploaded file CDN information.
 * @param params.opts     - Send options (API connection, context, etc.).
 * @returns The file message's client-assigned ID.
 */
export async function sendFileMessageWeixin(
  params: {
    to: string;
    text: string;
    fileName: string;
    uploaded: UploadedFileInfo;
    opts: SendOptions;
  },
): Promise<{ messageId: string }> {
  const { to, text, fileName, uploaded, opts } = params;
  const media = buildCdnMedia(uploaded, opts.cdnBaseUrl);

  const fileItem: MessageItem = {
    type: 4 satisfies MessageItemType, // FILE
    create_time_ms: Date.now(),
    update_time_ms: Date.now(),
    is_completed: true,
    msg_id: generateClientId(),
    file_item: {
      media,
      file_name: fileName,
      md5: '',
      len: uploaded.fileSize,
    },
  };

  return sendMediaItems(to, text, fileItem, opts);
}
