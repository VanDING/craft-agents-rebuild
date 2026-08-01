import { describe, it, expect, afterEach } from 'bun:test'

import { sendMessage } from '../adapters/wechat/ilink/api/api'
import { sendMessageWeixin } from '../adapters/wechat/ilink/messaging/send'
import { MessageType, MessageState } from '../adapters/wechat/ilink/api/types'
import type { SendMessageReq } from '../adapters/wechat/ilink/api/types'

const realFetch = globalThis.fetch

let fetchCalls = 0
let requestBodies: Array<{ msg?: { message_state?: number; client_id?: string } }> = []

/**
 * Stub globalThis.fetch with a single response that repeats for every call.
 */
function stubFetch(status: number, body: string): void {
  stubFetchSequence({ status, body })
}

/**
 * Stub globalThis.fetch with a queue of responses; the last entry repeats.
 * Records the number of calls and each request body for retry assertions.
 */
function stubFetchSequence(...responses: Array<{ status: number; body: string }>): void {
  fetchCalls = 0
  requestBodies = []
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    fetchCalls += 1
    requestBodies.push(init?.body ? JSON.parse(init.body) : null)
    const idx = Math.min(fetchCalls - 1, responses.length - 1)
    const r = responses[idx]!
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: '',
      text: async () => r.body,
    } as Response
  }) as unknown as typeof fetch
}

const req: { body: SendMessageReq } = {
  body: {
    msg: {
      from_user_id: '',
      to_user_id: 'u1',
      client_id: 'c1',
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: [
        {
          type: 1,
          create_time_ms: 0,
          update_time_ms: 0,
          is_completed: true,
          msg_id: 'm1',
          text_item: { content: 'hi' },
        },
      ],
    },
  },
}

const opts = { baseUrl: 'https://x.example', token: 'tok', ...req }

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('sendMessage server-rejection handling', () => {
  it('throws when the server rejects with a non-zero ret on an HTTP 200 body', async () => {
    stubFetch(200, JSON.stringify({ ret: -14, errmsg: 'session timeout' }))
    await expect(sendMessage(opts)).rejects.toThrow(/ret=-14/)
  })

  it('throws when the server rejects with a non-zero errcode', async () => {
    stubFetch(200, JSON.stringify({ errcode: 1001, errmsg: 'bad token' }))
    await expect(sendMessage(opts)).rejects.toThrow(/errcode=1001/)
  })

  it('resolves on an empty success body', async () => {
    stubFetch(200, '')
    await expect(sendMessage(opts)).resolves.toBeUndefined()
  })

  it('resolves on an explicit ret:0 success body', async () => {
    stubFetch(200, JSON.stringify({ ret: 0 }))
    await expect(sendMessage(opts)).resolves.toBeUndefined()
  })

  it('throws on a non-JSON body (malformed responses are never success)', async () => {
    stubFetch(200, 'OK')
    await expect(sendMessage(opts)).rejects.toThrow(/non-JSON/)
    expect(fetchCalls).toBe(1)
  })

  it('throws on a non-2xx HTTP response, treating the error body as a failure', async () => {
    stubFetch(400, '{"errcode": 40001, "errmsg": "bad request"}')
    await expect(sendMessage(opts)).rejects.toThrow(/HTTP 400/)
    // 400 is not transient — no retries.
    expect(fetchCalls).toBe(1)
  })

  it('retries a transient HTTP 500 and succeeds on the second attempt, reusing client_id', async () => {
    stubFetchSequence(
      { status: 500, body: '{"errcode": 500, "errmsg": "internal"}' },
      { status: 200, body: '{"ret": 0}' },
    )
    await expect(sendMessage(opts)).resolves.toBeUndefined()
    expect(fetchCalls).toBe(2)
    const clientIds = requestBodies.map((b) => b?.msg?.client_id)
    expect(clientIds[0]).toBe('c1')
    expect(clientIds[1]).toBe('c1')
  })

  it('retries a transient HTTP 429 at most 3 times before failing', async () => {
    stubFetch(429, '{"errcode": 429, "errmsg": "rate limited"}')
    await expect(sendMessage(opts)).rejects.toThrow(/HTTP 429/)
    expect(fetchCalls).toBe(3)
  })

  it('retries a transient business errcode (500) in an HTTP 200 body', async () => {
    stubFetchSequence(
      { status: 200, body: '{"errcode": 500, "errmsg": "internal"}' },
      { status: 200, body: '{"ret": 0}' },
    )
    await expect(sendMessage(opts)).resolves.toBeUndefined()
    expect(fetchCalls).toBe(2)
  })
})

describe('sendMessageWeixin', () => {
  const sendOpts = { baseUrl: 'https://x.example', token: 'tok', contextToken: 'ctx' }

  it('sends a single FINISH text message with a generated client_id', async () => {
    stubFetch(200, '')
    await sendMessageWeixin({ to: 'u1', text: 'hi', opts: sendOpts })
    expect(requestBodies[0]?.msg?.message_state).toBe(MessageState.FINISH)
    expect(requestBodies[0]?.msg?.client_id).toBeTruthy()
  })
})
