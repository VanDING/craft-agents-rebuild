/**
 * WeChatAdapter — personal WeChat (微信) via Tencent's official iLink "ClawBot"
 * transport, vendored under ./ilink (MIT, from @tencent-weixin/openclaw-weixin).
 * Mirrors the Lark adapter shape: long-poll inbound + sendMessage outbound, no
 * public webhook. QR-login binds a personal WeChat the official way (no Wechaty,
 * no ban risk).
 *
 * v1 scope: text + inbound image/file/voice/video attachments + outbound file.
 * No inline buttons, no message editing, no streaming.
 */
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { randomBytes } from 'node:crypto'

import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterCapabilities,
  IncomingAttachment,
  IncomingMessage,
  SentMessage,
  InlineButton,
  ButtonPress,
  MessagingLogger,
  SendOptions,
} from '../../types'

import { stripMarkdownForWeChat } from './format'
import {
  DEFAULT_BASE_URL,
  CDN_BASE_URL,
  clearWeixinAccount as clearWeixinAccountIlink,
  unregisterWeixinAccountId as unregisterWeixinAccountIdIlink,
  listIndexedWeixinAccountIds as listIndexedWeixinAccountIdsIlink,
  saveWeixinAccount,
  registerWeixinAccountId,
} from './ilink/auth/accounts'
import { startWeixinLoginWithQr, waitForWeixinLogin } from './ilink/auth/login-qr'
import { monitorWeixinProvider } from './ilink/monitor/monitor'
import {
  weixinMessageToMsgContext,
  isMediaItem,
  setContextToken,
  getContextToken,
  restoreContextTokens,
  clearContextTokensForAccount as clearContextTokensForAccountIlink,
} from './ilink/messaging/inbound'
import { clearSyncBuf as clearSyncBufIlink } from './ilink/storage/sync-buf'
import {
  ensureStateDirForWorkspace,
  resolveStateDirForWorkspace,
} from './ilink/storage/state-dir'
import { sendMessageWeixin } from './ilink/messaging/send'
import { sendWeixinMediaFile } from './ilink/messaging/send-media'
import { downloadMediaFromItem, type WeixinInboundMediaOpts } from './ilink/media/media-download'
import { getConfig, sendTyping } from './ilink/api/api'
import { TypingStatus, type WeixinMessage } from './ilink/api/types'

// ---------------------------------------------------------------------------
// Forget-cleanup exports (consumed by the registry's forgetPlatform)
// ---------------------------------------------------------------------------

/**
 * Compute the workspace-scoped iLink state root (`~/.craft-agent/wechat/{workspaceId}`).
 * Exported for the registry so forgetPlatform wipes the same files the
 * adapter writes.
 */
export { resolveStateDirForWorkspace }

/**
 * Delete the per-account credential JSON file.
 *
 * @param stateRoot - Optional workspace-scoped state root; without it the
 *                    shared state dir is used (non-workspace callers).
 */
export function clearWeixinAccount(accountId: string, stateRoot?: string): void {
  clearWeixinAccountIlink(accountId, stateRoot)
}

/**
 * Remove the account from the accounts.json index.
 *
 * @param stateRoot - Optional workspace-scoped state root.
 */
export function unregisterWeixinAccountId(accountId: string, stateRoot?: string): void {
  unregisterWeixinAccountIdIlink(accountId, stateRoot)
}

/**
 * List all indexed WeChat account IDs (used when no credential blob exists).
 *
 * @param stateRoot - Optional workspace-scoped state root.
 */
export function listIndexedWeixinAccountIds(stateRoot?: string): string[] {
  return listIndexedWeixinAccountIdsIlink(stateRoot)
}

/**
 * Delete an account's context-token JSON file and in-memory entries.
 *
 * @param stateRoot - Optional workspace-scoped state root.
 */
export function clearContextTokensForAccount(accountId: string, stateRoot?: string): void {
  clearContextTokensForAccountIlink(accountId, stateRoot)
}

/**
 * Delete an account's sync-buf offset files (primary + legacy variants).
 *
 * @param stateRoot - Optional workspace-scoped state root.
 */
export function clearSyncBuf(accountId: string, stateRoot?: string): void {
  clearSyncBufIlink(accountId, stateRoot)
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface WeChatCredentials {
  accountId: string
  token: string
  baseUrl?: string
  userId?: string
}

/** Parse the JSON credential blob stored under `messaging_bearer` / name `wechat`. */
export function parseWeChatCredentials(raw: string): WeChatCredentials {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('WeChat credentials are not valid JSON')
  }
  const c = parsed as Partial<WeChatCredentials>
  if (!c.accountId || typeof c.accountId !== 'string') {
    throw new Error('WeChat credentials missing accountId')
  }
  if (!c.token || typeof c.token !== 'string') {
    throw new Error('WeChat credentials missing token')
  }
  return {
    accountId: c.accountId,
    token: c.token,
    baseUrl: typeof c.baseUrl === 'string' && c.baseUrl.trim() ? c.baseUrl : DEFAULT_BASE_URL,
    userId: typeof c.userId === 'string' ? c.userId : undefined,
  }
}

// ---------------------------------------------------------------------------
// QR login controller (driven by registry before adapter exists)
// ---------------------------------------------------------------------------

export type WeChatLoginEvent =
  | { type: 'qr'; qr: string }
  | { type: 'scanned' }
  | { type: 'need_verifycode' }
  | { type: 'connected'; credentials?: WeChatCredentials }
  | { type: 'error'; message: string }

/**
 * Run a QR login against the iLink ClawBot endpoint. Emits events for the UI
 * (qr → [scanned] → [need_verifycode] → connected/error) and resolves with the
 * bound credentials, or null on failure.
 *
 * @param opts.workspaceId - When provided, the login's persisted state
 *                           (credentials + account index) is scoped to this
 *                           workspace so sibling workspaces never see the
 *                           freshly-bound token.
 */
export async function startWeChatQrLogin(opts: {
  onEvent: (event: WeChatLoginEvent) => void
  verifyCodeProvider?: () => Promise<string>
  timeoutMs?: number
  workspaceId?: string
}): Promise<WeChatCredentials | 'already-connected' | null> {
  const stateRoot = opts.workspaceId ? resolveStateDirForWorkspace(opts.workspaceId) : undefined
  if (stateRoot) ensureStateDirForWorkspace(opts.workspaceId!)
  const start = await startWeixinLoginWithQr({
    apiBaseUrl: DEFAULT_BASE_URL,
    stateRoot,
  })
  if (!start.qrcodeUrl) {
    opts.onEvent({ type: 'error', message: start.message })
    return null
  }
  opts.onEvent({ type: 'qr', qr: start.qrcodeUrl })

  const result = await waitForWeixinLogin({
    sessionKey: start.sessionKey,
    apiBaseUrl: DEFAULT_BASE_URL,
    timeoutMs: opts.timeoutMs,
    verifyCodeProvider: opts.verifyCodeProvider,
    onStatus: (status, extra) => {
      if (status === 'need_verifycode') opts.onEvent({ type: 'need_verifycode' })
      else if (status === 'scaned') opts.onEvent({ type: 'scanned' })
      // Expired QR was refreshed — hand the new URL to the UI so the dialog
      // re-renders instead of going stale.
      else if (status === 'expired' && extra?.qrcodeUrl) opts.onEvent({ type: 'qr', qr: extra.qrcodeUrl })
    },
  })

  if (result.alreadyConnected) {
    opts.onEvent({ type: 'connected' })
    return 'already-connected'
  }

  if (!result.connected || !result.accountId || !result.botToken) {
    opts.onEvent({ type: 'error', message: result.message })
    return null
  }

  const credentials: WeChatCredentials = {
    accountId: result.accountId,
    token: result.botToken,
    baseUrl: result.baseUrl || DEFAULT_BASE_URL,
    userId: result.userId,
  }
  saveWeixinAccount(
    credentials.accountId,
    {
      token: credentials.token,
      baseUrl: credentials.baseUrl,
      userId: credentials.userId,
    },
    stateRoot,
  )
  registerWeixinAccountId(credentials.accountId, stateRoot)
  opts.onEvent({ type: 'connected', credentials })
  return credentials
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const MAX_MESSAGE_LENGTH = 4000
const COALESCE_WINDOW_MS = 10_000
const TYPING_HEARTBEAT_INTERVAL_MS = 5_000
const TYPING_HEARTBEAT_MAX_TICKS = 60
/** Maximum concurrent CDN media downloads across one message's attachments. */
const MEDIA_DOWNLOAD_CONCURRENCY = 3

export interface WeChatAdapterOptions {
  /**
   * Workspace ID used to namespace persistent state (sync-buf cursors,
   * credentials, context tokens, account index). When omitted the adapter
   * falls back to the shared state dir (non-workspace callers / tests).
   */
  workspaceId?: string
}

export class WeChatAdapter implements PlatformAdapter {
  readonly platform = 'wechat' as const
  readonly capabilities: AdapterCapabilities = {
    messageEditing: false,
    inlineButtons: false,
    maxButtons: 0,
    maxMessageLength: MAX_MESSAGE_LENGTH,
    markdown: 'wechat',
    webhookSupport: false,
  }

  /** Workspace ID scoping persistent state (undefined = shared state dir). */
  private readonly workspaceId?: string
  /** Workspace-scoped state root (`~/.craft-agent/wechat/{workspaceId}`). */
  private readonly stateRoot?: string

  constructor(opts: WeChatAdapterOptions = {}) {
    this.workspaceId = opts.workspaceId
    this.stateRoot = opts.workspaceId
      ? resolveStateDirForWorkspace(opts.workspaceId)
      : undefined
  }

  private accountId = ''
  private token = ''
  private baseUrl = DEFAULT_BASE_URL
  private cdnBaseUrl = CDN_BASE_URL
  private userId?: string
  private connected = false
  private abort?: AbortController
  private logger?: MessagingLogger
  private messageHandler?: (msg: IncomingMessage) => Promise<void>
  private buttonHandler?: (press: ButtonPress) => Promise<void>
  private readonly pending = new Map<
    string,
    { msgs: WeixinMessage[]; timer: ReturnType<typeof setTimeout> }
  >()
  private readonly typingHeartbeats = new Map<
    string,
    { timer: ReturnType<typeof setInterval>; ticks: number }
  >()
  private readonly typingTickets = new Map<string, string>()

  async initialize(config: PlatformConfig): Promise<void> {
    if (!config.token) throw new Error('WeChat adapter requires credentials in config.token')
    const creds = parseWeChatCredentials(config.token)
    this.accountId = creds.accountId
    this.token = creds.token
    this.baseUrl = creds.baseUrl ?? DEFAULT_BASE_URL
    this.userId = creds.userId
    this.logger = config.logger

    if (this.stateRoot && this.workspaceId) {
      // Create the workspace-scoped state dir 0700 before any writer runs,
      // so the recursive mkdirs inside the persistence helpers never create
      // it with the default (typically 0755) mode.
      ensureStateDirForWorkspace(this.workspaceId)
    }

    saveWeixinAccount(
      this.accountId,
      {
        token: this.token,
        baseUrl: this.baseUrl,
        userId: this.userId,
      },
      this.stateRoot,
    )
    registerWeixinAccountId(this.accountId, this.stateRoot)
    restoreContextTokens(this.accountId, this.stateRoot)

    this.abort = new AbortController()
    this.connected = true

    const log = (m: string) => this.logger?.info(m, { event: 'wechat_monitor' })
    const errLog = (m: string) => this.logger?.error(m, { event: 'wechat_monitor' })

    void monitorWeixinProvider({
      baseUrl: this.baseUrl,
      token: this.token,
      accountId: this.accountId,
      stateRoot: this.stateRoot,
      abortSignal: this.abort.signal,
      runtime: { log, error: errLog },
      onMessage: (msg) => this.handleInbound(msg),
    }).catch((err) => {
      this.connected = false
      this.logger?.error(`wechat monitor stopped: ${String(err)}`, {
        event: 'wechat_monitor_stopped',
      })
    })
  }

  async destroy(): Promise<void> {
    this.connected = false
    this.abort?.abort()
    this.abort = undefined
    for (const entry of this.pending.values()) clearTimeout(entry.timer)
    this.pending.clear()
    for (const channelId of [...this.typingHeartbeats.keys()]) this.stopTypingHeartbeat(channelId)
  }

  isConnected(): boolean {
    return this.connected
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  onButtonPress(handler: (press: ButtonPress) => Promise<void>): void {
    this.buttonHandler = handler
  }

  getBotInfo(): { name?: string } {
    return { name: this.userId || this.accountId }
  }

  async sendText(channelId: string, text: string, _opts?: SendOptions): Promise<SentMessage> {
    this.stopTypingHeartbeat(channelId)
    const plain = stripMarkdownForWeChat(text)
    const { messageId } = await sendMessageWeixin({
      to: channelId,
      text: plain,
      opts: {
        baseUrl: this.baseUrl,
        token: this.token,
        contextToken: getContextToken(this.accountId, channelId, this.stateRoot),
      },
    })
    return { platform: 'wechat', channelId, messageId }
  }

  async editMessage(
    _channelId: string,
    _messageId: string,
    _text: string,
    _opts?: SendOptions,
  ): Promise<void> {
    // No-op for v1 (capabilities.messageEditing = false)
  }

  async sendButtons(
    channelId: string,
    text: string,
    _buttons: InlineButton[],
    opts?: SendOptions,
  ): Promise<SentMessage> {
    return this.sendText(channelId, text, opts)
  }

  async sendTyping(_channelId: string, _opts?: SendOptions): Promise<void> {
    // No-op for v1: typing heartbeat is handled by startTypingHeartbeat
  }

  async sendFile(
    channelId: string,
    file: Buffer,
    filename: string,
    caption?: string,
    _opts?: SendOptions,
  ): Promise<SentMessage> {
    const dir = join(tmpdir(), 'craft-wechat-media', 'outbound')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, `${randomBytes(8).toString('hex')}-${filename}`)
    writeFileSync(filePath, file)
    try {
      const { messageId } = await sendWeixinMediaFile({
        filePath,
        to: channelId,
        text: caption ?? '',
        opts: {
          baseUrl: this.baseUrl,
          token: this.token,
          contextToken: getContextToken(this.accountId, channelId, this.stateRoot),
        },
        cdnBaseUrl: this.cdnBaseUrl,
      })
      return { platform: 'wechat', channelId, messageId }
    } finally {
      try { unlinkSync(filePath) } catch { /* best-effort */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Inbound
  // ---------------------------------------------------------------------------

  private saveMedia = async (
    buffer: Buffer,
    contentType?: string,
    subdir?: string,
    maxBytes?: number,
    originalFilename?: string,
  ): Promise<{ path: string }> => {
    // Enforce the caller's size cap (previously ignored). Throwing surfaces
    // the rejection to the media pipeline, which logs it and drops the item
    // instead of persisting an oversized file.
    if (maxBytes !== undefined && buffer.length > maxBytes) {
      throw new Error(
        `wechat media exceeds size cap: ${buffer.length} bytes > ${maxBytes} bytes`,
      )
    }
    const dir = join(tmpdir(), 'craft-wechat-media', subdir ?? 'inbound')
    mkdirSync(dir, { recursive: true })
    let ext = originalFilename ? extname(originalFilename) : ''
    if (!ext && contentType) ext = extFromMime(contentType)
    if (!ext) ext = sniffImageExt(buffer) ?? '.jpg'
    const filePath = join(dir, `${randomBytes(8).toString('hex')}${ext}`)
    writeFileSync(filePath, buffer)
    return { path: filePath }
  }

  private async handleInbound(msg: WeixinMessage): Promise<void> {
    if (!this.messageHandler) return
    const from = msg.from_user_id ?? ''
    if (!from) return

    if (msg.context_token) setContextToken(this.accountId, from, msg.context_token, this.stateRoot)

    const hasText = (weixinMessageToMsgContext(msg, this.accountId).Body ?? '').trim().length > 0
    const hasMedia = (msg.item_list ?? []).some(isMediaItem)

    const entry = this.pending.get(from)
    if (entry) {
      clearTimeout(entry.timer)
      entry.msgs.push(msg)
      if (hasText) {
        await this.flushPending(from)
      } else {
        entry.timer = this.scheduleFlush(from)
      }
      return
    }

    if (hasMedia && !hasText) {
      const timer = this.scheduleFlush(from)
      this.pending.set(from, { msgs: [msg], timer })
      return
    }

    await this.dispatchBatch([msg])
  }

  private scheduleFlush(from: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      void this.flushPending(from).catch((err) =>
        this.logger?.error(`wechat coalesce flush failed: ${String(err)}`, {
          event: 'wechat_coalesce_flush_failed',
        }),
      )
    }, COALESCE_WINDOW_MS)
  }

  private async flushPending(from: string): Promise<void> {
    const entry = this.pending.get(from)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(from)
    await this.dispatchBatch(entry.msgs)
  }

  private async getTypingTicket(channelId: string): Promise<string | undefined> {
    const cached = this.typingTickets.get(channelId)
    if (cached) return cached
    try {
      const resp = await getConfig({
        baseUrl: this.baseUrl,
        token: this.token,
        ilinkUserId: channelId,
        contextToken: getContextToken(this.accountId, channelId, this.stateRoot),
      })
      const ticket = resp.typing_ticket
      if (ticket) this.typingTickets.set(channelId, ticket)
      return ticket
    } catch (err) {
      this.logger?.error(`wechat getConfig (typing_ticket) failed: ${String(err)}`, {
        event: 'wechat_typing_ticket_failed',
      })
      return undefined
    }
  }

  private startTypingHeartbeat(channelId: string): void {
    if (this.typingHeartbeats.has(channelId)) return
    const entry: { timer: ReturnType<typeof setInterval>; ticks: number } = {
      timer: setInterval(() => {
        entry.ticks += 1
        if (entry.ticks > TYPING_HEARTBEAT_MAX_TICKS) {
          this.stopTypingHeartbeat(channelId)
          return
        }
        void this.sendTypingPing(channelId, TypingStatus.TYPING)
      }, TYPING_HEARTBEAT_INTERVAL_MS),
      ticks: 0,
    }
    this.typingHeartbeats.set(channelId, entry)
    void this.sendTypingPing(channelId, TypingStatus.TYPING)
  }

  private stopTypingHeartbeat(channelId: string): void {
    const entry = this.typingHeartbeats.get(channelId)
    if (!entry) return
    clearInterval(entry.timer)
    this.typingHeartbeats.delete(channelId)
    void this.sendTypingPing(channelId, TypingStatus.CANCEL)
  }

  private async sendTypingPing(channelId: string, status: number): Promise<void> {
    const ticket = await this.getTypingTicket(channelId)
    if (!ticket) return
    try {
      await sendTyping({
        baseUrl: this.baseUrl,
        token: this.token,
        body: { ilink_user_id: channelId, typing_ticket: ticket, status },
      })
    } catch (err) {
      this.logger?.error(`wechat sendTyping failed: ${String(err)}`, {
        event: 'wechat_typing_failed',
      })
    }
  }

  private async dispatchBatch(msgs: WeixinMessage[]): Promise<void> {
    if (!this.messageHandler || msgs.length === 0) return
    const last = msgs[msgs.length - 1]!
    const from = last.from_user_id ?? ''
    if (!from) return

    const text = msgs
      .map((m) => (weixinMessageToMsgContext(m, this.accountId).Body ?? '').trim())
      .filter((t) => t.length > 0)
      .join('\n')

    const attachments: IncomingAttachment[] = []
    for (const m of msgs) {
      attachments.push(...(await this.collectAttachments(m)))
    }

    const incoming: IncomingMessage = {
      platform: 'wechat',
      channelId: from,
      messageId: String(last.message_id ?? last.client_id ?? randomBytes(8).toString('hex')),
      senderId: from,
      text,
      attachments: attachments.length ? attachments : undefined,
      timestamp: last.create_time_ms ?? Date.now(),
      raw: msgs,
    }

    this.startTypingHeartbeat(from)
    await this.messageHandler(incoming)
  }

  private async collectAttachments(msg: WeixinMessage): Promise<IncomingAttachment[]> {
    const out: IncomingAttachment[] = []
    const log = (m: string) => this.logger?.info(m, { event: 'wechat_media' })
    const errLog = (m: string) => this.logger?.error(m, { event: 'wechat_media' })

    const mediaItems = (msg.item_list ?? []).filter(isMediaItem)
    // Download attachments with bounded concurrency instead of one-at-a-time,
    // so a multi-attachment message does not block the long-poll loop for the
    // sum of all download times. Result order is preserved by index.
    const downloaded = new Array<WeixinInboundMediaOpts | undefined>(mediaItems.length)
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < mediaItems.length) {
        const pos = cursor
        cursor += 1
        const media = await downloadMediaFromItem(mediaItems[pos]!, {
          cdnBaseUrl: this.cdnBaseUrl,
          saveMedia: this.saveMedia,
          log,
          errLog,
          label: 'inbound',
        })
        downloaded[pos] = media
      }
    }
    const runners = Array.from(
      { length: Math.min(MEDIA_DOWNLOAD_CONCURRENCY, mediaItems.length) },
      () => worker(),
    )
    await Promise.all(runners)

    for (let i = 0; i < mediaItems.length; i++) {
      const media = downloaded[i]!
      const item = mediaItems[i]!
      const fileId = item.msg_id ?? randomBytes(6).toString('hex')
      if (media.decryptedPicPath) {
        out.push({
          type: 'photo',
          fileId,
          localPath: media.decryptedPicPath,
          fileName: `image${extname(media.decryptedPicPath)}`,
          mimeType: 'image/jpeg',
        })
      } else if (media.decryptedFilePath) {
        out.push({
          type: 'document',
          fileId,
          localPath: media.decryptedFilePath,
          mimeType: media.fileMediaType,
          fileName: item.file_item?.file_name,
        })
      } else if (media.decryptedVideoPath) {
        out.push({
          type: 'video',
          fileId,
          localPath: media.decryptedVideoPath,
          fileName: `video${extname(media.decryptedVideoPath)}`,
          mimeType: 'video/mp4',
        })
      } else if (media.decryptedVoicePath) {
        out.push({
          type: 'voice',
          fileId,
          localPath: media.decryptedVoicePath,
          fileName: `voice${extname(media.decryptedVoicePath)}`,
          mimeType: media.voiceMediaType,
        })
      }
    }
    return out
  }
}

/**
 * Sniff common image magic bytes for file extension. iLink CDN images arrive
 * with no content-type, so sniff the extension for downstream classification.
 */
export function sniffImageExt(buf: Buffer): string | undefined {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png'
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return '.gif'
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return '.webp'
  return undefined
}

function extFromMime(mime?: string): string {
  if (!mime) return ''
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg'
  if (mime.includes('png')) return '.png'
  if (mime.includes('gif')) return '.gif'
  if (mime.includes('webp')) return '.webp'
  if (mime.includes('mp4')) return '.mp4'
  if (mime.includes('wav')) return '.wav'
  if (mime.includes('silk')) return '.silk'
  if (mime.includes('pdf')) return '.pdf'
  return ''
}
