/**
 * packages/messaging-gateway/src/adapters/weixin/index.ts
 *
 * WeChat (weixin) adapter — pure HTTP JSON API with long polling.
 *
 * Implements the WeChat Backend API Protocol as documented by
 * @tencent-weixin/openclaw-weixin v2.4.6 (MIT).
 *
 * Spec reference: Stage J section 5.5.
 *
 * Endpoints (all POST {baseUrl}/ilink/bot/…):
 *   getupdates   — long-poll for incoming messages
 *   sendmessage  — send a message
 *   getuploadurl — get CDN upload URL
 *   getconfig    — fetch bot config (typing_ticket)
 *   sendtyping   — send typing indicator
 *   notifystart  — notify server on adapter start
 *   notifystop   — notify server on adapter stop
 *
 * QR-login endpoints (against https://ilinkai.weixin.qq.com):
 *   get_bot_qrcode      — fetch QR code URL
 *   get_qrcode_status   — long-poll QR scan status
 *
 * CDN media uses AES-128-ECB encryption.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  AdapterCapabilities,
  ButtonPress,
  IncomingAttachment,
  IncomingMessage,
  InlineButton,
  PlatformAdapter,
  PlatformConfig,
  PlatformType,
  SendOptions,
  SentMessage,
} from '../../types';
import type { WeixinAccount } from '../../types';

// Re-export WeixinAccount for convenience (it's defined in ../../types).
export type { WeixinAccount };

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const LONGPOLL_TIMEOUT_MS = 35_000;
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 5 * 60 * 1000;
const DEFAULT_BOT_AGENT = 'CraftAgent/0.12.0';

// ---------------------------------------------------------------------------
// WeChat Backend API Protocol constants
// (ref: @tencent-weixin/openclaw-weixin v2.4.6)
// ---------------------------------------------------------------------------

/** QR code login endpoint base URL (fixed, not per-workspace). */
const QR_BASE_URL = 'https://ilinkai.weixin.qq.com';

/** iLink-App-Id from official package.json. */
const ILINK_APP_ID = 'bot';

/** Channel version — drives iLink-App-ClientVersion header. */
const CHANNEL_VERSION = '0.12.0';

/** CDN base URL for media downloads (from openclaw-weixin v2.4.6). */
const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';

/** Build iLink-App-ClientVersion: 0x00MMNNPP (major<<16 | minor<<8 | patch). */
function buildClientVersion(version: string): number {
  const parts = version.split('.').map((p) => parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

const ILINK_APP_CLIENT_VERSION = buildClientVersion(CHANNEL_VERSION);

/**
 * X-WECHAT-UIN header value: random uint32 → decimal string → base64.
 * Mirrors official openclaw-weixin behaviour (not the account's real uin).
 */
function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

const CAPABILITIES: AdapterCapabilities = {
  messageEditing: false,
  inlineButtons: false,
  maxButtons: 0,
  maxMessageLength: 2048,
  markdown: 'plain',
  webhookSupport: false,
};

export interface WeixinAdapterOptions {
  /** WeChat backend gateway base URL. */
  baseUrl: string;
  /** Login credentials directory (weixin-auth/). */
  authDir: string;
  /** Optional botAgent identifier (default CraftAgent/0.12.0). */
  botAgent?: string;
  /** Optional: pre-loaded account credentials. */
  accounts?: WeixinAccount[];
  logger?: (...args: unknown[]) => void;
}
// ============================================================
// WeChat native message structures (from backend API)
// ============================================================

interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  /** Direct download URL (preferred when available). */
  full_url?: string;
}
interface WeixinMessageItem {
  type: number; // 1=TEXT, 2=IMAGE, 3=VOICE, 4=FILE, 5=VIDEO, 11=TOOL_CALL_START, 12=TOOL_CALL_RESULT
  text_item?: { text: string };
  image_item?: CDNMedia;
  voice_item?: CDNMedia & { duration_ms?: number };
  file_item?: CDNMedia & { file_name?: string };
  video_item?: CDNMedia & { duration_ms?: number };
}

interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number; // 1=USER, 2=BOT
  message_state?: number;
  item_list?: WeixinMessageItem[];
  context_token?: string;
}

interface WeixinApiResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
  message_id?: string | number;
  typing_ticket?: string;
  upload_param?: string;
  upload_full_url?: string;
  thumb_upload_param?: string;
  [key: string]: unknown;
}

export type WeixinAdapterEvent =
  | { type: 'qr'; qrPayload: string; account?: string }
  | { type: 'connected'; account: string }
  | { type: 'disconnected'; account: string; reason: string }
  | { type: 'unavailable'; reason: string }
  | { type: 'need_verifycode' };

export type WeixinEventHandler = (event: WeixinAdapterEvent) => void;

export class WeixinAdapter implements PlatformAdapter {
  readonly platform: PlatformType = 'weixin';
  readonly capabilities = CAPABILITIES;

  private accounts: Map<string, WeixinAccount> = new Map();
  private pollingLoops: Map<string, AbortController> = new Map();
  private contextTokens: Map<string, string> = new Map(); // channelId → context_token
  private typingTickets: Map<string, string> = new Map(); // userId → typing_ticket
  private channelToUin: Map<string, string> = new Map(); // channelId → uin
  private connected = false;
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;
  private buttonHandler: ((press: ButtonPress) => Promise<void>) | null = null;
  private eventHandler: WeixinEventHandler | null = null;
  private reconnectAttempts = 0;
  private qrPollCtrl: AbortController | null = null;
  /** Persisted get_updates_buf per account (uin → cursor). Restored from disk on init. */
  private syncBufs: Map<string, string> = new Map();
  private readonly opts!: WeixinAdapterOptions;
  private log!: (...args: unknown[]) => void;

  constructor(opts: WeixinAdapterOptions) {
    this.opts = opts;
    this.log = opts.logger ?? (() => {});
    if (opts.accounts) {
      for (const acc of opts.accounts) {
        this.accounts.set(acc.uin, acc);
      }
    }
  }

  async initialize(_config: PlatformConfig): Promise<void> {
    await this.loadCredentials();
    // Restore persisted sync buffers before starting polling loops.
    for (const uin of this.accounts.keys()) {
      const saved = await this.loadSyncBuf(uin);
      if (saved) this.syncBufs.set(uin, saved);
    }
    // Restore persisted context tokens so reply works without re-fetch.
    for (const uin of this.accounts.keys()) {
      await this.loadContextTokens(uin);
    }
    // Start long-poll loops for each account.
    // Send notifystart and wait for completion before polling to ensure
    // the server is ready to accept getUpdates.
    const startPromises: Promise<void>[] = [];
    for (const [, account] of this.accounts) {
      startPromises.push(this.notifyServer('notifystart', account));
    }
    await Promise.all(startPromises);
    for (const [uin, account] of this.accounts) {
      this.startPollingLoop(uin, account);
    }
    this.connected = this.accounts.size > 0;
  }

  async destroy(): Promise<void> {
    // Cancel QR polling.
    this.qrPollCtrl?.abort();
    this.qrPollCtrl = null;
    // Send notifystop for each account, then tear down polling loops.
    const promises: Promise<void>[] = [];
    for (const [uin, account] of this.accounts) {
      promises.push(
        this.notifyServer('notifystop', account).catch(() => {}),
      );
    }
    for (const [, ctrl] of this.pollingLoops) {
      ctrl.abort();
    }
    this.pollingLoops.clear();
    await Promise.all(promises);
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onButtonPress(handler: (press: ButtonPress) => Promise<void>): void {
    // WeChat does not support buttons — stored for interface compliance, never invoked.
    this.buttonHandler = handler;
  }

  /** Subscribe to adapter lifecycle events (qr, connected, disconnected). */
  onEvent(handler: WeixinEventHandler): void {
    this.eventHandler = handler;
  }

  // ---- QR login (ref: @tencent-weixin/openclaw-weixin auth/login-qr.ts) ----

  /**
   * Start the QR-code login flow.
   *
   * 1. Fetches a QR code from WeChat's fixed QR endpoint.
   * 2. Emits a `qr` event with the QR image URL for the UI to render.
   * 3. Spawns a background polling loop that tracks QR status until
   *    login confirms, expires, or the caller cancels.
   *
   * On successful confirmation the credentials are saved to `authDir/`
   * and a `connected` event is emitted.
   */
  async startLogin(): Promise<void> {
    // Prevent concurrent login attempts.
    if (this.qrPollCtrl) return;
    const { qrcode, qrUrl } = await this.getBotQrCode();
    this.eventHandler?.({ type: 'qr', qrPayload: qrUrl });

    this.qrPollCtrl = new AbortController();
    const signal = this.qrPollCtrl.signal;
    this.pollQrLogin(qrcode, signal).catch((err) => {
      if ((err as Error)?.name === 'AbortError') return;
      this.log('weixin qr poll error:', err);
    });
  }

  /** Cancel an in-progress QR login (e.g. user dismissed the dialog). */
  cancelLogin(): void {
    this.qrPollCtrl?.abort();
    this.qrPollCtrl = null;
  }


  /** POST to `get_bot_qrcode` — returns a QR code + image URL. */
  private async getBotQrCode(): Promise<{ qrcode: string; qrUrl: string }> {
    const url = `${QR_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'iLink-App-Id': ILINK_APP_ID,
        'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
      },
      body: JSON.stringify({ local_token_list: [] }),
    });
    if (!res.ok) {
      throw new Error(`get_bot_qrcode HTTP ${res.status}`);
    }
    const data = (await res.json()) as { qrcode: string; qrcode_img_content: string };
    return { qrcode: data.qrcode, qrUrl: data.qrcode_img_content };
  }

  /**
   * Long-poll GET to `get_qrcode_status` — polls the QR code scan status.
   * Server holds the request until status changes or the 35s timeout.
   */
  private async pollQrStatus(
    qrcode: string,
    signal?: AbortSignal,
  ): Promise<{
    status: string;
    bot_token?: string;
    ilink_bot_id?: string;
    baseurl?: string;
    ilink_user_id?: string;
    redirect_host?: string;
  }> {
    const url = `${QR_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35_000);
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'iLink-App-Id': ILINK_APP_ID,
          'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`get_qrcode_status HTTP ${res.status}`);
      }
      return (await res.json()) as {
        status: string;
        bot_token?: string;
        ilink_bot_id?: string;
        baseurl?: string;
        ilink_user_id?: string;
        redirect_host?: string;
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Background QR status polling loop. Runs until:
   * - `confirmed` → saves credentials, emits `connected`, returns
   * - `expired` → refreshes QR (up to 3 times), then emits `unavailable`
   * - signal aborted → caller cancelled
   */
  private async pollQrLogin(qrcode: string, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + 480_000; // 8 min
    let qrRefreshCount = 0;
    const MAX_QR_REFRESH = 3;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    while (!signal.aborted && Date.now() < deadline) {
      try {
        const resp = await this.pollQrStatus(qrcode, signal);
        consecutiveErrors = 0; // Reset on success

        switch (resp.status) {
          case 'wait':
          case 'scaned':
            // Normal states — continue polling.
            break;

          case 'need_verifycode':
            // The server requests a verification code (shown on the user's phone).
            // Emit an event so the UI can prompt for input.
            this.eventHandler?.({ type: 'need_verifycode' });
            break;
          case 'confirmed': {
            const botToken = resp.bot_token;
            const botId = resp.ilink_bot_id;
            if (!botToken || !botId) {
              this.eventHandler?.({ type: 'unavailable', reason: 'Login confirmed but missing credentials' });
              return;
            }
            const account: WeixinAccount = {
              token: botToken,
              uin: botId,
              botAgent: this.opts.botAgent,
              baseUrl: resp.baseurl,
            };
            await this.saveAccountCredentials(account);
            this.accounts.set(botId, account);
            this.startPollingLoop(botId, account);
            this.connected = true;
            this.eventHandler?.({ type: 'connected', account: botId });
            return;
          }
          case 'expired': {
            qrRefreshCount++;
            if (qrRefreshCount >= MAX_QR_REFRESH) {
              this.eventHandler?.({ type: 'unavailable', reason: 'QR code expired — too many retries' });
              return;
            }
            // Refresh QR code.
            try {
              const { qrcode: newQr, qrUrl } = await this.getBotQrCode();
              this.eventHandler?.({ type: 'qr', qrPayload: qrUrl });
              qrcode = newQr;
            } catch {
              this.eventHandler?.({ type: 'unavailable', reason: 'Failed to refresh QR code' });
              return;
            }
            break;
          }

          case 'binded_redirect':
            // Already bound to this bot — treat as success.
            this.eventHandler?.({ type: 'connected', account: 'existing' });
            return;

          case 'scaned_but_redirect':
            this.log('weixin qr: scaned_but_redirect — host redirect, continuing');
            break;

          default:
            this.log(`weixin qr: unknown status=${resp.status}`);
        }
      } catch (err) {
        if (signal.aborted) return;
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          this.eventHandler?.({ type: 'unavailable', reason: `QR login polling failed after ${consecutiveErrors} attempts` });
          return;
        }
        this.log('weixin qr poll error:', err);
      }
      await this.sleep(1000);
    }

    if (!signal.aborted) {
      this.eventHandler?.({ type: 'unavailable', reason: 'QR login timed out' });
    }
  }

  /** Persist a WeixinAccount to authDir/credentials-{uin}.json. */
  private async saveAccountCredentials(account: WeixinAccount): Promise<void> {
    await mkdir(this.opts.authDir, { recursive: true });
    const filePath = join(this.opts.authDir, `credentials-${account.uin}.json`);
    await writeFile(filePath, JSON.stringify(account, null, 2), 'utf-8');
  }

  // ---- Long polling loop ----

  private startPollingLoop(uin: string, account: WeixinAccount): void {
    const ctrl = new AbortController();
    this.pollingLoops.set(uin, ctrl);
    this.pollLoop(uin, account, ctrl.signal).catch((err) => {
      void this.handlePollError(uin, err);
    });
  }

  private async pollLoop(
    uin: string,
    account: WeixinAccount,
    signal: AbortSignal,
  ): Promise<void> {
    let cursor = this.syncBufs.get(uin) ?? '';
    let syncWriteCount = 0;
    while (!signal.aborted) {
      try {
        const resp = await this.callApi(
          account,
          'getupdates',
          { get_updates_buf: cursor },
          signal,
        );
        if (resp.ret !== 0) {
          if (resp.errcode === -14) {
            // Session timeout — needs re-login. Clear sync buf to avoid re-sending stale cursor.
            this.syncBufs.delete(uin);
            this.saveSyncBuf(uin, '').catch(() => {});
            this.eventHandler?.({
              type: 'disconnected',
              account: uin,
              reason: 'session timeout (errcode=-14)',
            });
            return;
          }
          throw new Error(`getUpdates ret=${resp.ret}: ${resp.errmsg}`);
        }
        // Throttle sync buffer writes to every 5th update to reduce I/O.
        if (resp.get_updates_buf && resp.get_updates_buf !== cursor) {
          cursor = resp.get_updates_buf;
          this.syncBufs.set(uin, cursor);
          syncWriteCount++;
          if (syncWriteCount % 5 === 0) {
            await this.saveSyncBuf(uin, cursor).catch(() => {});
          }
        } else if (resp.get_updates_buf) {
          cursor = resp.get_updates_buf;
        }
        this.reconnectAttempts = 0;

        for (const msg of resp.msgs ?? []) {
          await this.handleWeixinMessage(msg, uin);
        }
      } catch (err) {
        if (signal.aborted) return;
        await this.sleep(this.backoffMs());
      }
    }
  }

  // ---- Message handling ----

  private async handleWeixinMessage(wxMsg: WeixinMessage, uin: string): Promise<void> {
    // Drop BOT-originated messages.
    if (wxMsg.message_type === 2) return;

    const channelId = wxMsg.from_user_id ?? '';
    if (!channelId) return;

    // Record channel → account mapping for multi-account send routing.
    this.channelToUin.set(channelId, uin);

    // Cache context_token (needed when replying) and persist to disk.
    if (wxMsg.context_token && wxMsg.context_token !== this.contextTokens.get(channelId)) {
      this.contextTokens.set(channelId, wxMsg.context_token);
      this.saveContextTokens(uin).catch(() => {});
    }

    const { text, attachments } = await this.parseItems(wxMsg.item_list ?? [], wxMsg.message_id);

    const incoming: IncomingMessage = {
      platform: 'weixin',
      channelId,
      messageId: String(wxMsg.message_id ?? ''),
      senderId: wxMsg.from_user_id ?? '',
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp: wxMsg.create_time_ms ?? Date.now(),
      senderIsBot: wxMsg.message_type === 2,
      raw: wxMsg,
    };

    this.messageHandler?.(incoming).catch(async (err) => {
      this.log('weixin onMessage handler error:', err);
      try {
        await this.sendText(channelId, `❌ Error processing message: ${err instanceof Error ? err.message : String(err)}`);
      } catch {
        // Best-effort.
      }
    });
  }

  private async parseItems(
    items: WeixinMessageItem[],
    messageId: number | undefined,
  ): Promise<{ text: string; attachments: IncomingAttachment[] }> {
    const textParts: string[] = [];
    const attachments: IncomingAttachment[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      switch (item.type) {
        case 1: // TEXT
          if (item.text_item?.text) textParts.push(item.text_item.text);
          break;
        case 2: // IMAGE
        case 3: // VOICE
        case 4: // FILE
        case 5: // VIDEO
          {
            const cdn =
              item.image_item ?? item.voice_item ?? item.file_item ?? item.video_item;
            if (cdn) {
              const localPath = await this.downloadCdnMedia(cdn);
              if (localPath) {
                const mappedType: IncomingAttachment['type'] =
                  item.type === 2
                    ? 'photo'
                    : item.type === 3
                      ? 'voice'
                      : item.type === 5
                        ? 'video'
                        : 'document';
                const fileName =
                  item.file_item?.file_name ??
                  item.image_item?.encrypt_query_param ??
                  undefined;
                attachments.push({
                  type: mappedType,
                  fileId: `${messageId ?? 'msg'}-${i}`,
                  localPath,
                  fileName,
                });
              }
            }
          }
          break;
      }
    }

    return { text: textParts.join('\n'), attachments };
  }

  // ---- Outbound: send message ----

  async sendText(channelId: string, text: string, _opts?: SendOptions): Promise<SentMessage> {
    const account = this.getAccountForChannel(channelId);
    const contextToken = this.contextTokens.get(channelId) ?? '';

    const resp = await this.callApi(account, 'sendmessage', {
      msg: {
        message_type: 2,
        message_state: 2,
        to_user_id: channelId,
        context_token: contextToken,
        item_list: [{ type: 1, text_item: { text } }],
      },
    });

    const messageId = String(resp.message_id ?? Date.now());
    return { platform: 'weixin', channelId, messageId };
  }

  async editMessage(
    _channelId: string,
    _messageId: string,
    _text: string,
    _opts?: SendOptions,
  ): Promise<void> {
    // WeChat does not support editing — no-op.
  }

  async sendButtons(
    channelId: string,
    text: string,
    buttons: InlineButton[],
    _opts?: SendOptions,
  ): Promise<SentMessage> {
    // WeChat has no inline buttons — degrade to a numbered list.
    const lines = [text];
    buttons.forEach((btn, i) => {
      lines.push(`${i + 1}. ${btn.label}`);
    });
    return this.sendText(channelId, lines.join('\n'));
  }

  async sendTyping(channelId: string, _opts?: SendOptions): Promise<void> {
    const account = this.getAccountForChannel(channelId);
    let ticket = this.typingTickets.get(channelId);
    if (!ticket) {
      const cfg = await this.callApi(account, 'getconfig', {
        ilink_user_id: channelId,
      });
      ticket = cfg.typing_ticket;
      if (ticket) this.typingTickets.set(channelId, ticket);
    }
    if (ticket) {
      await this.callApi(account, 'sendtyping', {
        ilink_user_id: channelId,
        typing_ticket: ticket,
        status: 1,
      });
    }
  }

  async sendFile(
    channelId: string,
    file: Buffer,
    filename: string,
    _caption?: string,
    _opts?: SendOptions,
  ): Promise<SentMessage> {
    if (file.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(`File exceeds ${MAX_ATTACHMENT_BYTES} byte limit`);
    }
    const account = this.getAccountForChannel(channelId);

    // 1. Generate AES-128 key and encrypt the file.
    const aesKey = randomBytes(16);
    const ciphertext = await this.encryptAes128Ecb(file, aesKey);

    // 2. Compute plaintext metadata.
    const rawsize = file.byteLength;
    const rawfilemd5 = createHash('md5').update(file).digest('hex');
    const filesize = ciphertext.byteLength;
    const filekey = randomUUID();

    // 3. Request a CDN upload URL.
    const uploadResp = await this.callApi(account, 'getuploadurl', {
      filekey,
      media_type: 3, // FILE
      to_user_id: channelId,
      rawsize,
      rawfilemd5,
      filesize,
      aeskey: aesKey.toString('hex'),
    });

    const uploadUrl: string = uploadResp.upload_full_url ?? uploadResp.upload_param ?? '';
    if (!uploadUrl) throw new Error('getUploadUrl: no upload URL returned');

    // 4. POST ciphertext to CDN URL; server returns x-encrypted-param header.
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(ciphertext),
    });
    if (!uploadRes.ok) {
      const errText = uploadRes.headers.get('x-error-message') ?? (await uploadRes.text());
      throw new Error(`WeChat CDN upload failed: HTTP ${uploadRes.status} ${errText}`);
    }
    const downloadParam = uploadRes.headers.get('x-encrypted-param');
    if (!downloadParam) throw new Error('CDN response missing x-encrypted-param header');

    // 5. Send a message referencing the uploaded CDN media.
    const aesKeyB64 = aesKey.toString('base64');
    const resp = await this.callApi(account, 'sendmessage', {
      msg: {
        message_type: 2,
        message_state: 2,
        to_user_id: channelId,
        context_token: this.contextTokens.get(channelId) ?? '',
        item_list: [
          {
            type: 4, // FILE
            file_item: {
              file_name: filename,
              encrypt_query_param: downloadParam,
              aes_key: aesKeyB64,
            },
          },
        ],
      },
    });

    const messageId = String(resp.message_id ?? Date.now());
    return { platform: 'weixin', channelId, messageId };
  }

  // ---- CDN media encryption/decryption ----

  private async downloadCdnMedia(cdn: CDNMedia): Promise<string | null> {
    if (!cdn.aes_key) return null;
    // Prefer full_url when available; otherwise construct from encrypt_query_param.
    const downloadUrl = cdn.full_url
      ?? (cdn.encrypt_query_param ? `${CDN_BASE_URL}?encrypt_query_param=${encodeURIComponent(cdn.encrypt_query_param)}` : null);
    if (!downloadUrl) return null;
    try {
      const key = Buffer.from(cdn.aes_key, 'base64');
      const res = await fetch(downloadUrl);
      if (!res.ok) return null;
      const encrypted = Buffer.from(await res.arrayBuffer());
      const decrypted = await this.decryptAes128Ecb(encrypted, key);
      const tempPath = join(tmpdir(), `weixin-${randomUUID()}`);
      await writeFile(tempPath, decrypted);
      return tempPath;
    } catch (err) {
      this.log('weixin downloadCdnMedia failed:', err);
      return null;
    }
  }

  private async encryptAes128Ecb(plaintext: Buffer, key: Buffer): Promise<Buffer> {
    const cipher = createCipheriv('aes-128-ecb', key, null);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]);
  }

  private async decryptAes128Ecb(ciphertext: Buffer, key: Buffer): Promise<Buffer> {
    const decipher = createDecipheriv('aes-128-ecb', key, null);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  // ---- Lifecycle notifications (notifystart / notifystop) ----

  /**
   * POST to `ilink/bot/msg/notifystart` or `ilink/bot/msg/notifystop`.
   * Best-effort — failures are logged but never propagate.
   */
  private async notifyServer(
    action: 'notifystart' | 'notifystop',
    account: WeixinAccount,
  ): Promise<void> {
    try {
      await this.callApi(account, `msg/${action}`, {});
    } catch (err) {
      this.log(`weixin ${action} failed (non-fatal):`, err);
    }
  }

  // ---- HTTP API ----

  /**
   * POST to a WeChat Backend API endpoint.
   * Automatically prepends `ilink/bot/` to the endpoint path,
   * attaches official protocol headers, and injects `base_info`.
   */
  private async callApi(
    account: WeixinAccount,
    endpoint: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<WeixinApiResponse> {
    const url = `${account.baseUrl ?? (this.opts.baseUrl || QR_BASE_URL)}/ilink/bot/${endpoint}`;
    const controller = new AbortController();
    // Different timeouts for different endpoint types:
    const timeoutMs = endpoint === 'getupdates' ? LONGPOLL_TIMEOUT_MS + 5_000
      : endpoint === 'getconfig' || endpoint === 'sendtyping' || endpoint.startsWith('msg/') ? 10_000
      : 15_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          AuthorizationType: 'ilink_bot_token',
          Authorization: `Bearer ${account.token}`,
          'X-WECHAT-UIN': randomWechatUin(),
          'X-Bot-Agent': account.botAgent ?? this.opts.botAgent ?? DEFAULT_BOT_AGENT,
          'iLink-App-Id': ILINK_APP_ID,
          'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
        },
        body: JSON.stringify({
          ...body,
          base_info: {
            channel_version: CHANNEL_VERSION,
            bot_agent: account.botAgent ?? this.opts.botAgent ?? DEFAULT_BOT_AGENT,
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`WeChat API ${endpoint} HTTP ${res.status}`);
      }
      return (await res.json()) as WeixinApiResponse;
    } finally {
      clearTimeout(timeout);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }

  // ---- Sync buffer persistence ----

  /** Path to per-account sync buffer file. */
  private syncBufPath(uin: string): string {
    return join(this.opts.authDir, `sync-buf-${uin}.json`);
  }

  /** Load the persisted get_updates_buf for a given account. */
  private async loadSyncBuf(uin: string): Promise<string | null> {
    const fp = this.syncBufPath(uin);
    if (!existsSync(fp)) return null;
    try {
      const raw = await readFile(fp, 'utf-8');

      const parsed = JSON.parse(raw) as { buf?: string };
      return parsed.buf ?? null;
    } catch {
      return null;
    }
  }

  /** Persist the get_updates_buf cursor so it survives restarts. */
  private async saveSyncBuf(uin: string, buf: string): Promise<void> {
    const fp = this.syncBufPath(uin);
    await writeFile(fp, JSON.stringify({ buf, savedAt: Date.now() }), 'utf-8');
  }

  // ---- Context token persistence ----

  /** Path to per-account context tokens file. */
  private contextTokensPath(uin: string): string {
    return join(this.opts.authDir, `context-tokens-${uin}.json`);
  }

  /** Load persisted context tokens from disk. */
  private async loadContextTokens(uin: string): Promise<void> {
    const fp = this.contextTokensPath(uin);
    try {
      const raw = await readFile(fp, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, string>;
      for (const [ch, token] of Object.entries(parsed)) {
        this.contextTokens.set(ch, token);
      }
    } catch {
      // File not found or malformed — start fresh.
    }
  }

  /** Persist context tokens for an account to disk. */
  private async saveContextTokens(uin: string): Promise<void> {
    const fp = this.contextTokensPath(uin);
    const tokens: Record<string, string> = {};
    for (const [ch, token] of this.contextTokens) {
      tokens[ch] = token;
    }
    await mkdir(this.opts.authDir, { recursive: true });
    await writeFile(fp, JSON.stringify(tokens), 'utf-8');
  }

  // ---- Helpers ----

  private getAccountForChannel(channelId: string): WeixinAccount {
    const uin = this.channelToUin.get(channelId);
    if (uin) {
      const acc = this.accounts.get(uin);
      if (acc) return acc;
    }
    // Fallback: first account (single-account scenario).
    const account = this.accounts.values().next().value;
    if (!account) throw new Error('No WeChat account connected');
    return account;
  }

  private backoffMs(): number {
    const ms = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts++;
    return ms;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private async loadCredentials(): Promise<void> {
    try {
      const entries = await readdir(this.opts.authDir);
      for (const entry of entries) {
        if (!entry.startsWith('credentials-') || !entry.endsWith('.json')) continue;
        try {
          const raw = await readFile(join(this.opts.authDir, entry), 'utf8');
          const parsed = JSON.parse(raw) as Partial<WeixinAccount>;
          if (typeof parsed.token === 'string' && typeof parsed.uin === 'string') {
            this.accounts.set(parsed.uin, {
              token: parsed.token,
              uin: parsed.uin,
              botAgent: parsed.botAgent,
            });
          }
        } catch {
          // Skip malformed credential files.
        }
      }
    } catch {
      // authDir doesn't exist or isn't readable — accounts come from constructor.
    }
  }

  private async handlePollError(uin: string, err: unknown): Promise<void> {
    this.eventHandler?.({
      type: 'disconnected',
      account: uin,
      reason: String(err),
    });
    await this.sleep(this.backoffMs());
    const account = this.accounts.get(uin);
    if (account) {
      this.startPollingLoop(uin, account);
    }
  }
}
