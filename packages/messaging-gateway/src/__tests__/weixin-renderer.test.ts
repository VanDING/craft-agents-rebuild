/**
 * Weixin renderer tests — progress mode for non-editing adapters.
 *
 * WeChat (weixin) does not support message editing or inline buttons.
 * The renderer must degrade gracefully for non-editing platforms:
 *   - progress mode: sends a thinking bubble on first activity, then on
 *     complete sends the final answer as a separate message.
 *   - final_only mode: silent until complete.
 */
import { describe, expect, it } from 'bun:test'
import { Renderer, type SessionEvent } from '../renderer'
import type {
  PlatformAdapter,
  ChannelBinding,
  SentMessage,
  AdapterCapabilities,
} from '../types'

// ---------------------------------------------------------------------------
// Fake non-editing adapter (simulates WeChat)
// ---------------------------------------------------------------------------

interface Call {
  kind: 'sendText' | 'editMessage' | 'sendButtons' | 'sendTyping'
  channelId: string
  text?: string
}

function makeNoEditAdapter(): PlatformAdapter & { calls: Call[] } {
  const calls: Call[] = []
  let nextId = 1

  const capabilities: AdapterCapabilities = {
    messageEditing: false,
    inlineButtons: false,
    maxButtons: 0,
    maxMessageLength: 2048,
    markdown: 'plain',
    webhookSupport: false,
  }

  return {
    platform: 'weixin',
    capabilities,
    calls,
    async initialize() {},
    async destroy() {},
    isConnected() { return true },
    onMessage() {},
    onButtonPress() {},
    async sendText(channelId: string, text: string): Promise<SentMessage> {
      const messageId = String(nextId++)
      calls.push({ kind: 'sendText', channelId, text })
      return { platform: 'weixin', channelId, messageId }
    },
    async editMessage(): Promise<void> {
      calls.push({ kind: 'editMessage', channelId: '', text: '' })
    },
    async sendButtons(channelId: string, text: string): Promise<SentMessage> {
      const messageId = String(nextId++)
      calls.push({ kind: 'sendButtons', channelId, text })
      return { platform: 'weixin', channelId, messageId }
    },
    async sendTyping(channelId: string): Promise<void> {
      calls.push({ kind: 'sendTyping', channelId })
    },
    async sendFile(): Promise<SentMessage> {
      return { platform: 'weixin', channelId: '', messageId: String(nextId++) }
    },
  }
}

const binding: ChannelBinding = {
  id: 'b1',
  workspaceId: 'ws1',
  sessionId: 's1',
  channelId: 'ch1',
  platform: 'weixin',
  config: {
    responseMode: 'progress',
    accessMode: 'inherit',
    editIntervalMs: 0,
  },
  accessMode: 'inherit',
  allowedSenderIds: [],
  platformOwner: { platformUserId: 'u1', platformUserInfo: {} },
  createdAt: 0,
}

const finalOnlyBinding: ChannelBinding = {
  ...binding,
  id: 'b2',
  config: { ...binding.config, responseMode: 'final_only' },
}

function event(overrides: Partial<SessionEvent>): SessionEvent {
  return {
    type: 'text_delta',
    sessionId: 's1',
    ...overrides,
  }
}

describe('Weixin renderer — progress mode (non-editing)', () => {
  it('sends thinking bubble on first activity, then final on complete', async () => {
    const adapter = makeNoEditAdapter()
    const renderer = new Renderer()

    // First activity: ensureProgressBubble should send the tool status label
    await renderer.handle(
      event({ type: 'tool_start', toolName: 'web_search' }),
      binding,
      adapter,
    )

    // Should have sent one status bubble with the tool name
    expect(adapter.calls.length).toBe(1)
    expect(adapter.calls[0]).toMatchObject({ kind: 'sendText', text: '🔧 web_search…' })

    // Complete: should send the final text as a new message
    await renderer.handle(
      event({ type: 'text_complete', text: 'Final answer', isIntermediate: false }),
      binding,
      adapter,
    )

    // text_complete non-intermediate final — for non-editing adapter, bubble already
    // exists and can't be edited, so no additional sendText here.
    expect(adapter.calls.length).toBe(1)

    await renderer.handle(
      event({ type: 'complete' }),
      binding,
      adapter,
    )

    expect(adapter.calls.length).toBe(2)
    expect(adapter.calls[1]).toMatchObject({ kind: 'sendText', text: 'Final answer' })
  })

  it('sends only one message on complete with intermediate tool calls', async () => {
    const adapter = makeNoEditAdapter()
    const renderer = new Renderer()

    // tool_start → thinking
    await renderer.handle(
      event({ type: 'tool_start', toolName: 'web_search' }),
      binding,
      adapter,
    )
    expect(adapter.calls.length).toBe(1)

    // text_complete intermediate — for non-editing adapters, the bubble was
    // already posted and cannot be edited, so no additional sendText call.
    await renderer.handle(
      event({ type: 'text_complete', text: 'Partial...', isIntermediate: true }),
      binding,
      adapter,
    )
    expect(adapter.calls.length).toBe(1) // still just the initial bubble (non-editing)

    // final text_complete with non-intermediate text — for non-editing adapter,
    // the bubble was already posted and can't be edited, so no new sendText yet.
    await renderer.handle(
      event({ type: 'text_complete', text: 'Final answer', isIntermediate: false }),
      binding,
      adapter,
    )
    expect(adapter.calls.length).toBe(1) // bubble still pending completion

    await renderer.handle(
      event({ type: 'complete' }),
      binding,
      adapter,
    )
    expect(adapter.calls.length).toBe(2)
    expect(adapter.calls[1]).toMatchObject({ kind: 'sendText', text: 'Final answer' })
  })
})

describe('Weixin renderer — final_only mode (non-editing)', () => {
  it('stays silent until complete, then sends final text', async () => {
    const adapter = makeNoEditAdapter()
    const renderer = new Renderer()

    // tool_start — should not post anything in final_only
    await renderer.handle(
      event({ type: 'tool_start', toolName: 'web_search' }),
      finalOnlyBinding,
      adapter,
    )
    expect(adapter.calls.length).toBe(0)

    // text_complete intermediate — stays silent
    await renderer.handle(
      event({ type: 'text_complete', text: 'Partial...', isIntermediate: true }),
      finalOnlyBinding,
      adapter,
    )
    expect(adapter.calls.length).toBe(0)

    // complete — sends the accumulated final text as one message
    await renderer.handle(
      event({ type: 'text_complete', text: 'Final answer', isIntermediate: false }),
      finalOnlyBinding,
      adapter,
    )

    await renderer.handle(
      event({ type: 'complete' }),
      finalOnlyBinding,
      adapter,
    )
    expect(adapter.calls.length).toBe(1)
    expect(adapter.calls[0]).toMatchObject({ kind: 'sendText', text: 'Final answer' })
  })

  it('sends nothing on empty complete', async () => {
    const adapter = makeNoEditAdapter()
    const renderer = new Renderer()

    await renderer.handle(
      event({ type: 'tool_start', toolName: 'web_search' }),
      finalOnlyBinding,
      adapter,
    )
    expect(adapter.calls.length).toBe(0)

    await renderer.handle(
      event({ type: 'complete' }),
      finalOnlyBinding,
      adapter,
    )
    // No final text accumulated — should send nothing
    expect(adapter.calls.length).toBe(0)
  })
})
