// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../util/logger';
import { generateId } from '../util/random';
import {
  MessageItemType,
  type MessageItem,
  type WeixinMessage,
} from '../api/types';
import { ensureStateDir, resolveStateDir } from '../storage/state-dir';

// ---------------------------------------------------------------------------
// Context token store
// ---------------------------------------------------------------------------

/**
 * In-memory cache of context tokens keyed by `"{accountId}:{userId}"`.
 *
 * Persisted to disk so tokens survive process restarts without re-auth.
 */
export const contextTokenStore: Map<string, string> = new Map();

/** Path to the per-account context-tokens JSON file. */
function contextTokensPath(accountId: string): string {
  return path.join(
    resolveStateDir(),
    'openclaw-weixin',
    'accounts',
    `${accountId}.context-tokens.json`,
  );
}

/**
 * Load context tokens from disk into {@link contextTokenStore}.
 *
 * Reads the JSON file at `{stateDir}/openclaw-weixin/accounts/{accountId}.context-tokens.json`
 * and populates the in-memory store. Existing entries for this account are
 * replaced.  Missing or corrupt files are silently treated as empty.
 */
export function restoreContextTokens(accountId: string): void {
  const fp = contextTokensPath(accountId);
  try {
    const raw = fs.readFileSync(fp, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, string>;
    const prefix = `${accountId}:`;
    // Remove stale entries for this account first.
    for (const key of contextTokenStore.keys()) {
      if (key.startsWith(prefix)) contextTokenStore.delete(key);
    }
    for (const [userId, token] of Object.entries(parsed)) {
      contextTokenStore.set(`${accountId}:${userId}`, token);
    }
    logger.debug(`Restored ${Object.keys(parsed).length} context tokens from ${fp}`);
  } catch (err: unknown) {
    // File not found or malformed — start with an empty store.
    if (err instanceof Error && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`Failed to parse context tokens file ${fp}: ${err.message}`);
    }
  }
}

/**
 * Set a context token for a user on a given account.
 *
 * Updates both the in-memory store and the disk JSON file.
 */
export function setContextToken(
  accountId: string,
  userId: string,
  token: string,
): void {
  const key = `${accountId}:${userId}`;
  const prev = contextTokenStore.get(key);
  contextTokenStore.set(key, token);

  // Persist to disk.
  persistContextTokensForAccount(accountId);

  if (prev !== token) {
    logger.debug(`Context token updated for account=${accountId} userId=${userId}`);
  }
}

/**
 * Retrieve a context token for a user on a given account.
 *
 * Returns `undefined` when no token has been stored.
 */
export function getContextToken(
  accountId: string,
  userId: string,
): string | undefined {
  return contextTokenStore.get(`${accountId}:${userId}`);
}

/**
 * Remove all context tokens belonging to an account and delete the disk file.
 */
export function clearContextTokensForAccount(accountId: string): void {
  const prefix = `${accountId}:`;
  for (const key of contextTokenStore.keys()) {
    if (key.startsWith(prefix)) contextTokenStore.delete(key);
  }

  // Remove the disk file.
  const fp = contextTokensPath(accountId);
  try {
    fs.unlinkSync(fp);
    logger.debug(`Deleted context tokens file ${fp}`);
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code !== 'ENOENT') {
      logger.warn(`Failed to delete context tokens file ${fp}: ${nodeErr.message}`);
    }
  }
}

/**
 * Find which accounts have a context token for a given user.
 *
 * Iterates over `accountIds` and returns those that have a cached token for
 * `userId`.  Useful during multi-account routing to determine which account(s)
 * have an active conversation with the user.
 */
export function findAccountIdsByContextToken(
  accountIds: string[],
  userId: string,
): string[] {
  const result: string[] = [];
  for (const accountId of accountIds) {
    if (contextTokenStore.get(`${accountId}:${userId}`) !== undefined) {
      result.push(accountId);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Disk persistence helper
// ---------------------------------------------------------------------------

/**
 * Write the tokens for a single account from the in-memory store to disk.
 *
 * Only tokens whose key starts with `"<accountId>:"` are included in the
 * persisted JSON object (keyed by `userId` without the account prefix).
 *
 * The file is written 0600 (with the state dir created 0700) because the
 * context tokens are plaintext credentials that must not be world-readable.
 */
function persistContextTokensForAccount(accountId: string): void {
  ensureStateDir();
  const dir = path.join(resolveStateDir(), 'openclaw-weixin', 'accounts');
  fs.mkdirSync(dir, { recursive: true });

  const prefix = `${accountId}:`;
  const tokens: Record<string, string> = {};
  for (const [key, token] of contextTokenStore) {
    if (key.startsWith(prefix)) {
      const userId = key.slice(prefix.length);
      tokens[userId] = token;
    }
  }

  const fp = path.join(dir, `${accountId}.context-tokens.json`);
  fs.writeFileSync(fp, JSON.stringify(tokens, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Message context types
// ---------------------------------------------------------------------------

/**
 * Options for {@link weixinMessageToMsgContext} controlling media handling.
 */
export interface WeixinInboundMediaOpts {
  /**
   * Base directory for downloaded media files.
   * When provided, media items are downloaded to this path.
   */
  baseMediaPath?: string;
}

/**
 * Standardised message context produced from a raw Weixin {@link WeixinMessage}.
 *
 * This type bridges the iLink transport message format into the rest of the
 * system so downstream handlers (command parsers, session managers, media
 * processors) work against a uniform shape regardless of the underlying API.
 */
export interface WeixinMsgContext {
  /** Text body extracted from message items. */
  Body: string;
  /** Sender user ID (from_user_id). */
  From: string;
  /** Recipient user ID (to_user_id). */
  To: string;
  /** Account ID that received this message. */
  AccountId: string;
  /** Originating channel (e.g. "wechat"). */
  OriginatingChannel: string;
  /** Original destination identifier. */
  OriginatingTo: string;
  /** Unique message identifier. */
  MessageSid: string;
  /** Message creation timestamp (ms since epoch). */
  Timestamp?: number;
  /** Provider identifier (e.g. "ilink"). */
  Provider: string;
  /** Chat type — "single" for 1-on-1, "group" for group chats. */
  ChatType: string;
  /** Session identifier for reply routing. */
  SessionKey?: string;
  /** WeChat context token for conversation continuity. */
  context_token?: string;
  /** URL for the first media attachment (if any). */
  MediaUrl?: string;
  /** Local file path for the first media attachment (if downloaded). */
  MediaPath?: string;
  /** Media type string (e.g. "image", "voice", "video", "file"). */
  MediaType?: string;
  /** Parsed command body (without prefix). */
  CommandBody?: string;
  /** Whether the command was executed with sufficient authorization. */
  CommandAuthorized?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MEDIA_ITEM_TYPES: Record<number, true> = {
  [MessageItemType.IMAGE]: true,
  [MessageItemType.VIDEO]: true,
  [MessageItemType.FILE]: true,
  [MessageItemType.VOICE]: true,
};

/**
 * Check whether a message item is a media payload (image / video / file / voice).
 *
 * @returns `true` when the item's type is IMAGE, VIDEO, FILE, or VOICE.
 */
export function isMediaItem(item: MessageItem): boolean {
  return item.type in MEDIA_ITEM_TYPES;
}

// ---------------------------------------------------------------------------
// bodyFromItemList
// ---------------------------------------------------------------------------

/**
 * Extract the text body from a list of message items.
 *
 * This function:
 * - Concatenates text from all `TEXT` items (`text_item.content`).
 * - For media items referencing a quoted message (`ref_msg`), inserts a short
 *   placeholder indicating the quoted content.
 * - For `VOICE` items with a transcription (`voice_item.text`), includes the
 *   transcription in square brackets.
 *
 * @param itemList - Optional list of message items from a WeixinMessage.
 * @returns The extracted text, or an empty string when no text is found.
 */
export function bodyFromItemList(itemList?: MessageItem[]): string {
  if (!itemList || itemList.length === 0) return '';

  const parts: string[] = [];

  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item) {
      parts.push(item.text_item.content);
    } else if (isMediaItem(item) && item.ref_msg) {
      parts.push('[Quoted media]');
    } else if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      parts.push(`[Voice: ${item.voice_item.text}]`);
    }
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// weixinMessageToMsgContext
// ---------------------------------------------------------------------------

/**
 * Convert a raw {@link WeixinMessage} into a standardised {@link WeixinMsgContext}.
 *
 * The conversion:
 * - Extracts the text body via {@link bodyFromItemList}.
 * - Identifies the first media item and populates `MediaUrl`, `MediaPath`,
 *   and `MediaType` if present.
 * - Determines `ChatType` ("group" when `group_id` is non-empty, otherwise
 *   "single").
 * - Passes through the `context_token` and `session_id`.
 *
 * @param msg       - The raw Weixin message from the iLink API.
 * @param accountId - The account ID that received this message.
 * @param opts      - Optional media handling configuration.
 * @returns A standardised message context.
 */
export function weixinMessageToMsgContext(
  msg: WeixinMessage,
  accountId: string,
  opts?: WeixinInboundMediaOpts,
): WeixinMsgContext {
  const body = bodyFromItemList(msg.item_list);

  // Identify the first media item (if any).
  let mediaUrl: string | undefined;
  let mediaPath: string | undefined;
  let mediaType: string | undefined;

  for (const item of msg.item_list ?? []) {
    if (item.type === MessageItemType.IMAGE && item.image_item) {
      mediaUrl = item.image_item.media?.full_url ?? item.image_item.url;
      mediaType = 'image';
      break;
    }
    if (item.type === MessageItemType.VOICE && item.voice_item) {
      mediaUrl = item.voice_item.media?.full_url;
      mediaType = 'voice';
      break;
    }
    if (item.type === MessageItemType.FILE && item.file_item) {
      mediaUrl = item.file_item.media?.full_url;
      mediaType = 'file';
      break;
    }
    if (item.type === MessageItemType.VIDEO && item.video_item) {
      mediaUrl = item.video_item.media?.full_url;
      mediaType = 'video';
      break;
    }
  }

  return {
    Body: body,
    From: msg.from_user_id ?? '',
    To: msg.to_user_id ?? '',
    AccountId: accountId,
    OriginatingChannel: 'wechat',
    OriginatingTo: msg.to_user_id ?? '',
    MessageSid: msg.message_id != null ? String(msg.message_id) : '',
    Timestamp: msg.create_time_ms ?? Date.now(),
    Provider: 'ilink',
    ChatType: msg.group_id ? 'group' : 'single',
    SessionKey: msg.session_id || undefined,
    context_token: msg.context_token,
    MediaUrl: mediaUrl,
    MediaPath: mediaPath,
    MediaType: mediaType,
  };
}

// ---------------------------------------------------------------------------
// getContextTokenFromMsgContext
// ---------------------------------------------------------------------------

/**
 * Extract the WeChat context token from a {@link WeixinMsgContext}, if present.
 *
 * This is a convenience accessor — it simply reads `ctx.context_token`.
 *
 * @returns The context token string, or `undefined` when absent.
 */
export function getContextTokenFromMsgContext(
  ctx: WeixinMsgContext,
): string | undefined {
  return ctx.context_token;
}
