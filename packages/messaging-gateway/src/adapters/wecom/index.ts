/**
 * WeCom intelligent-bot adapter.
 *
 * Owns the single WebSocket connection for one Bot ID. Business APIs such as
 * WeDrive, Docs, Calendar, and Mail deliberately remain outside this adapter;
 * users can add the official CLI/MCP to Craft as an independent Source.
 */

import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import AiBot, { type WsFrame } from '@wecom/aibot-node-sdk'
import type {
  AdapterCapabilities,
  ButtonPress,
  IncomingAttachment,
  IncomingMessage,
  InlineButton,
  MessagingLogger,
  PlatformAdapter,
  PlatformConfig,
  SendOptions,
  SentMessage,
} from '../../types'

const AUTH_TIMEOUT_MS = 15_000
const MAX_SEEN_MESSAGES = 2_000
const MAX_SENT_CARDS = 500
const MAX_MARKDOWN_BYTES = 20_480

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

export interface WeComCredentials {
  botId: string
  secret: string
  /** Optional private-deployment WebSocket endpoint. */
  wsUrl?: string
}

export type WeComConnectionState =
  | { state: 'connected' }
  | { state: 'connecting' }
  | { state: 'disconnected'; reason?: string; replaced?: boolean }
  | { state: 'error'; error: string }

export function parseWeComCredentials(token: string | undefined): WeComCredentials {
  if (!token) throw new Error('WeCom credentials are missing')
  let parsed: unknown
  try {
    parsed = JSON.parse(token)
  } catch {
    throw new Error('WeCom credentials are not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('WeCom credentials must be a JSON object')
  }
  const { botId, secret, wsUrl } = parsed as Record<string, unknown>
  if (typeof botId !== 'string' || !botId.trim()) throw new Error('WeCom Bot ID is missing')
  if (typeof secret !== 'string' || !secret.trim()) throw new Error('WeCom Bot Secret is missing')
  if (wsUrl !== undefined && (typeof wsUrl !== 'string' || !/^wss:\/\//i.test(wsUrl))) {
    throw new Error('WeCom WebSocket URL must start with wss://')
  }
  return {
    botId: botId.trim(),
    secret: secret.trim(),
    ...(typeof wsUrl === 'string' && wsUrl ? { wsUrl: wsUrl.trim() } : {}),
  }
}

/**
 * WeCom keeps the leading `@BotName` in group-message text even though the
 * mention is only transport syntax used to address the bot. Remove that one
 * leading mention before the gateway performs command detection or forwards
 * free-form text to a session. Direct messages are left untouched.
 */
export function normalizeWeComInboundText(
  text: string,
  chattype: WeComBody['chattype'],
): string {
  const trimmed = text.trim()
  if (chattype !== 'group') return trimmed
  return trimmed.replace(/^@[^\s]+\s*/u, '').trim()
}

type WeComBody = {
  msgid: string
  aibotid: string
  chatid?: string
  chattype: 'single' | 'group'
  from: { userid: string }
  create_time?: number
  msgtype: string
  text?: { content?: string }
  voice?: { content?: string }
  image?: { url?: string; aeskey?: string }
  file?: { url?: string; aeskey?: string }
  video?: { url?: string; aeskey?: string }
  mixed?: { msg_item?: Array<{ msgtype: string; text?: { content?: string }; image?: { url?: string; aeskey?: string } }> }
  event?: { eventtype?: string; event_key?: string; task_id?: string }
}

export class WeComAdapter implements PlatformAdapter {
  private static readonly owners = new Map<string, WeComAdapter>()
  readonly platform = 'wecom' as const
  readonly capabilities: AdapterCapabilities = {
    messageEditing: false,
    inlineButtons: true,
    maxButtons: 6,
    // Conservative character cap so Renderer chunks CJK text before the
    // protocol's 20,480-byte Markdown limit.
    maxMessageLength: 6_000,
    markdown: 'wecom',
    webhookSupport: false,
  }

  private client: InstanceType<typeof AiBot.WSClient> | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  private buttonHandler: ((press: ButtonPress) => Promise<void>) | null = null
  private stateHandler: ((state: WeComConnectionState) => void) | null = null
  private connected = false
  private destroyed = false
  private log: MessagingLogger = NOOP_LOGGER
  private seenMessageIds = new Set<string>()
  private sentCards = new Map<string, { text: string }>()
  private pressedCardFrames = new Map<string, WsFrame<WeComBody>>()
  private botId: string | null = null
  private replacedByAnotherConnection = false

  async initialize(config: PlatformConfig): Promise<void> {
    const creds = parseWeComCredentials(config.token)
    const owner = WeComAdapter.owners.get(creds.botId)
    if (owner && owner !== this) {
      throw new Error(`WeCom Bot ID ${creds.botId} is already connected by another Craft workspace`)
    }
    WeComAdapter.owners.set(creds.botId, this)
    this.botId = creds.botId
    this.log = config.logger ?? NOOP_LOGGER
    this.destroyed = false
    this.emitState({ state: 'connecting' })

    const client = new AiBot.WSClient({
      botId: creds.botId,
      secret: creds.secret,
      ...(creds.wsUrl ? { wsUrl: creds.wsUrl } : {}),
      plug_version: 'craft-agent/0.12.1',
      logger: {
        debug: (message: string, ...args: unknown[]) => this.log.info(message, { args }),
        info: (message: string, ...args: unknown[]) => this.log.info(message, { args }),
        warn: (message: string, ...args: unknown[]) => this.log.warn(message, { args }),
        error: (message: string, ...args: unknown[]) => this.log.error(message, { args }),
      },
    })
    this.client = client

    client.on('message', (frame) => void this.handleFrame(frame as WsFrame<WeComBody>))
    client.on('event.template_card_event', (frame) => {
      void this.handleCardEvent(frame as WsFrame<WeComBody>)
    })
    client.on('authenticated', () => {
      if (this.destroyed) return
      this.connected = true
      this.replacedByAnotherConnection = false
      this.emitState({ state: 'connected' })
    })
    client.on('reconnecting', () => {
      if (!this.destroyed) this.emitState({ state: 'connecting' })
    })
    client.on('event.disconnected_event', () => {
      if (this.destroyed) return
      this.connected = false
      this.replacedByAnotherConnection = true
      this.emitState({
        state: 'disconnected',
        replaced: true,
        reason: 'This Bot ID was connected elsewhere. WeCom allows only one active long connection.',
      })
    })
    client.on('disconnected', (reason) => {
      if (this.destroyed) return
      this.connected = false
      this.emitState({
        state: 'disconnected',
        reason: this.replacedByAnotherConnection
          ? 'This Bot ID was connected elsewhere. WeCom allows only one active long connection.'
          : reason,
        replaced: this.replacedByAnotherConnection,
      })
    })
    client.on('error', (error) => {
      if (this.destroyed) return
      this.log.error('WeCom WebSocket error', { error: error.message })
      this.emitState({ state: 'error', error: error.message })
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for WeCom authentication')), AUTH_TIMEOUT_MS)
        const authenticated = () => {
          clearTimeout(timer)
          cleanup()
          resolve()
        }
        const failed = (error: Error) => {
          clearTimeout(timer)
          cleanup()
          reject(error)
        }
        const cleanup = () => {
          client.off('authenticated', authenticated)
          client.off('error', failed)
        }
        client.once('authenticated', authenticated)
        client.once('error', failed)
        client.connect()
      })
    } catch (error) {
      client.disconnect()
      this.client = null
      this.releaseOwnership()
      throw error
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    this.connected = false
    this.client?.disconnect()
    this.client = null
    this.seenMessageIds.clear()
    this.sentCards.clear()
    this.pressedCardFrames.clear()
    this.releaseOwnership()
  }

  isConnected(): boolean {
    return this.connected && (this.client?.isConnected ?? false)
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  onButtonPress(handler: (press: ButtonPress) => Promise<void>): void {
    this.buttonHandler = handler
  }

  onConnectionState(handler: (state: WeComConnectionState) => void): void {
    this.stateHandler = handler
  }

  async sendText(channelId: string, text: string, _opts?: SendOptions): Promise<SentMessage> {
    const client = this.requireClient()
    const content = truncateUtf8(text, MAX_MARKDOWN_BYTES)
    const ack = await client.sendMessage(channelId, {
      msgtype: 'markdown',
      markdown: { content },
    })
    return { platform: 'wecom', channelId, messageId: ack.headers.req_id }
  }

  async editMessage(channelId: string, _messageId: string, text: string, opts?: SendOptions): Promise<void> {
    await this.sendText(channelId, text, opts)
  }

  async sendButtons(channelId: string, text: string, buttons: InlineButton[], opts?: SendOptions): Promise<SentMessage> {
    const client = this.requireClient()
    const visibleButtons = buttons.slice(0, this.capabilities.maxButtons)
    if (visibleButtons.length === 0) return this.sendText(channelId, text, opts)

    const taskId = `craft_${randomBytes(12).toString('hex')}`
    await client.sendMessage(channelId, {
      msgtype: 'template_card',
      template_card: {
        card_type: 'button_interaction',
        main_title: { title: truncateUtf8(text, 100) },
        button_list: visibleButtons.map((button) => ({
          text: button.label.slice(0, 10),
          key: button.id,
        })),
        task_id: taskId,
      },
    })
    this.sentCards.set(taskId, { text })
    if (this.sentCards.size > MAX_SENT_CARDS) {
      const oldest = this.sentCards.keys().next().value
      if (oldest) this.sentCards.delete(oldest)
    }
    return { platform: 'wecom', channelId, messageId: taskId }
  }

  async sendTyping(_channelId: string, _opts?: SendOptions): Promise<void> {}

  async sendFile(channelId: string, file: Buffer, filename: string, caption?: string): Promise<SentMessage> {
    const client = this.requireClient()
    if (caption) await this.sendText(channelId, caption)
    const uploaded = await client.uploadMedia(file, { type: 'file', filename })
    const ack = await client.sendMediaMessage(channelId, 'file', uploaded.media_id)
    return { platform: 'wecom', channelId, messageId: ack.headers.req_id }
  }

  async clearButtons(_channelId: string, messageId: string): Promise<void> {
    const frame = this.pressedCardFrames.get(messageId)
    if (!frame) {
      this.sentCards.delete(messageId)
      return
    }
    const original = this.sentCards.get(messageId)
    await this.requireClient().updateTemplateCard(frame, {
      card_type: 'text_notice',
      main_title: { title: truncateUtf8(original?.text ?? 'Craft Agent', 100) },
      sub_title_text: 'Handled by Craft Agent',
      task_id: messageId,
    })
    this.pressedCardFrames.delete(messageId)
    this.sentCards.delete(messageId)
  }

  private requireClient(): InstanceType<typeof AiBot.WSClient> {
    if (!this.client || !this.isConnected()) throw new Error('WeCom bot is not connected')
    return this.client
  }

  private emitState(state: WeComConnectionState): void {
    this.stateHandler?.(state)
  }

  private releaseOwnership(): void {
    if (this.botId && WeComAdapter.owners.get(this.botId) === this) {
      WeComAdapter.owners.delete(this.botId)
    }
    this.botId = null
  }

  private async handleFrame(frame: WsFrame<WeComBody>): Promise<void> {
    if (this.destroyed || !this.messageHandler || !frame.body) return
    const body = frame.body
    if (!body.msgid || !body.from?.userid || this.seenMessageIds.has(body.msgid)) return
    this.seenMessageIds.add(body.msgid)
    if (this.seenMessageIds.size > MAX_SEEN_MESSAGES) {
      const oldest = this.seenMessageIds.values().next().value
      if (oldest) this.seenMessageIds.delete(oldest)
    }

    const attachments: IncomingAttachment[] = []
    try {
      let text = ''
      if (body.msgtype === 'text') text = body.text?.content?.trim() ?? ''
      else if (body.msgtype === 'voice') text = body.voice?.content?.trim() ?? ''
      else if (body.msgtype === 'mixed') {
        const parts: string[] = []
        for (const item of body.mixed?.msg_item ?? []) {
          if (item.msgtype === 'text' && item.text?.content) parts.push(item.text.content)
          if (item.msgtype === 'image' && item.image?.url) {
            attachments.push(await this.downloadAttachment('photo', item.image.url, item.image.aeskey))
          }
        }
        text = parts.join('\n').trim()
      } else {
        const media = body.image ?? body.file ?? body.video
        if (media?.url) {
          const type = body.msgtype === 'image' ? 'photo' : body.msgtype === 'video' ? 'video' : 'document'
          attachments.push(await this.downloadAttachment(type, media.url, media.aeskey))
        }
      }
      text = normalizeWeComInboundText(text, body.chattype)
      if (!text && attachments.length === 0) return

      const channelId = body.chattype === 'group' && body.chatid ? body.chatid : body.from.userid
      await this.messageHandler({
        platform: 'wecom',
        channelId,
        messageId: body.msgid,
        senderId: body.from.userid,
        text,
        ...(attachments.length ? { attachments } : {}),
        timestamp: body.create_time ? body.create_time * 1000 : Date.now(),
        raw: frame,
      })
    } catch (error) {
      this.log.error('failed to process WeCom message', {
        messageId: body.msgid,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      for (const attachment of attachments) {
        if (!attachment.localPath) continue
        try { unlinkSync(attachment.localPath) } catch { /* best effort */ }
      }
    }
  }

  private async handleCardEvent(frame: WsFrame<WeComBody>): Promise<void> {
    if (this.destroyed || !this.buttonHandler || !frame.body) return
    const body = frame.body
    const buttonId = body.event?.event_key
    const taskId = body.event?.task_id
    const senderId = body.from?.userid
    if (!buttonId || !taskId || !senderId) return

    const channelId = body.chattype === 'group' && body.chatid ? body.chatid : senderId
    this.pressedCardFrames.set(taskId, frame)
    await this.buttonHandler({
      platform: 'wecom',
      channelId,
      messageId: taskId,
      senderId,
      buttonId,
    })
  }

  private async downloadAttachment(
    type: IncomingAttachment['type'],
    url: string,
    aesKey?: string,
  ): Promise<IncomingAttachment> {
    if (!this.client) throw new Error('WeCom client is unavailable')
    const result = await this.client.downloadFile(url, aesKey)
    const rawName = result.filename || `wecom-${Date.now()}${type === 'photo' ? '.jpg' : ''}`
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_')
    const suffix = extname(safeName)
    const localPath = join(tmpdir(), `craft-wecom-${randomBytes(8).toString('hex')}${suffix}`)
    writeFileSync(localPath, result.buffer, { mode: 0o600 })
    return {
      type,
      fileId: url,
      fileName: safeName,
      fileSize: result.buffer.length,
      localPath,
    }
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, mid), 'utf8') <= maxBytes) low = mid
    else high = mid - 1
  }
  // Avoid ending on the first half of a UTF-16 surrogate pair.
  const end = low > 0 && /[\uD800-\uDBFF]/.test(value[low - 1]!) ? low - 1 : low
  return value.slice(0, end)
}
