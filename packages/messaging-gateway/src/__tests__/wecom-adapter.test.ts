import { describe, expect, it } from 'bun:test'
import { parseWeComCredentials, WeComAdapter } from '../adapters/wecom/index'

describe('parseWeComCredentials', () => {
  it('parses and trims valid credentials', () => {
    expect(parseWeComCredentials(JSON.stringify({ botId: ' bot-1 ', secret: ' secret ' }))).toEqual({
      botId: 'bot-1',
      secret: 'secret',
    })
  })

  it('accepts a private deployment wss endpoint', () => {
    const creds = parseWeComCredentials(JSON.stringify({
      botId: 'bot-1', secret: 'secret', wsUrl: 'wss://wecom.example.test/ws',
    }))
    expect(creds.wsUrl).toBe('wss://wecom.example.test/ws')
  })

  it('rejects missing, malformed, and insecure credentials', () => {
    expect(() => parseWeComCredentials(undefined)).toThrow(/missing/i)
    expect(() => parseWeComCredentials('not-json')).toThrow(/JSON/i)
    expect(() => parseWeComCredentials(JSON.stringify({ botId: 'x' }))).toThrow(/Secret/i)
    expect(() => parseWeComCredentials(JSON.stringify({ botId: 'x', secret: 'y', wsUrl: 'ws://host' }))).toThrow(/wss/i)
  })
})

describe('WeComAdapter static contract', () => {
  it('exposes the conversation gateway without MCP/business capabilities', () => {
    const adapter = new WeComAdapter()
    expect(adapter.platform).toBe('wecom')
    expect(adapter.capabilities.markdown).toBe('wecom')
    expect(adapter.capabilities.messageEditing).toBe(false)
    expect(adapter.capabilities.inlineButtons).toBe(true)
    expect(adapter.capabilities.maxButtons).toBe(6)
    expect(adapter.capabilities.webhookSupport).toBe(false)
    expect(adapter.isConnected()).toBe(false)
  })

  it('maps template-card buttons and their callback into the gateway contract', async () => {
    const adapter = new WeComAdapter()
    const sent: Array<{ channelId: string; body: Record<string, unknown> }> = []
    const updated: Array<Record<string, unknown>> = []
    const fakeClient = {
      isConnected: true,
      sendMessage: async (channelId: string, body: Record<string, unknown>) => {
        sent.push({ channelId, body })
        return { headers: { req_id: 'ack-1' } }
      },
      updateTemplateCard: async (_frame: unknown, card: Record<string, unknown>) => {
        updated.push(card)
        return { headers: { req_id: 'ack-2' } }
      },
    }
    const internals = adapter as unknown as {
      client: typeof fakeClient
      connected: boolean
      handleCardEvent(frame: unknown): Promise<void>
    }
    internals.client = fakeClient
    internals.connected = true

    let press: { channelId: string; messageId: string; senderId: string; buttonId: string } | undefined
    adapter.onButtonPress(async (value) => { press = value })
    const result = await adapter.sendButtons('group-1', 'Approve this plan', [
      { id: 'plan:token:accept', label: 'Accept' },
      { id: 'plan:token:reject', label: 'Reject' },
    ])
    expect(sent).toHaveLength(1)
    expect(sent[0]!.channelId).toBe('group-1')
    expect((sent[0]!.body.template_card as { button_list: unknown[] }).button_list).toHaveLength(2)

    await internals.handleCardEvent({
      headers: { req_id: 'event-1' },
      body: {
        msgid: 'msg-1', aibotid: 'bot', msgtype: 'event', chattype: 'group',
        chatid: 'group-1', from: { userid: 'user-1' },
        event: { eventtype: 'template_card_event', event_key: 'plan:token:accept', task_id: result.messageId },
      },
    })
    expect(press).toMatchObject({
      channelId: 'group-1', messageId: result.messageId, senderId: 'user-1', buttonId: 'plan:token:accept',
    })

    await adapter.clearButtons?.('group-1', result.messageId)
    expect(updated).toHaveLength(1)
    expect(updated[0]!.task_id).toBe(result.messageId)
  })
})
