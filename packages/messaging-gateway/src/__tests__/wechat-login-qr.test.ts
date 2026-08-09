import { describe, it, expect, afterEach } from 'bun:test'

import {
  startWeixinLoginWithQr,
  waitForWeixinLogin,
  getActiveLogins,
} from '../adapters/wechat/ilink/auth/login-qr'

const realFetch = globalThis.fetch

interface CapturedRequest {
  method: string
  url: string
  body: string | null
}

const requests: CapturedRequest[] = []

/**
 * Stub fetch with a scripted queue of status responses. Items with
 * `delayMs` respond after that delay (mimicking the iLink long-poll that
 * holds the connection while the QR waits); other items respond
 * immediately as JSON.
 */
function stubFetch(script: Array<{ delayMs?: number } & Record<string, unknown>>): void {
  const queue = [...script]
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    requests.push({ method, url, body: init?.body ? String(init.body) : null })

    if (url.includes('get_bot_qrcode')) {
      return new Response(
        JSON.stringify({ qrcode: 'qr-abc', qrcode_img_content: 'https://liteapp.weixin.qq.com/q/abc', ret: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url.includes('get_qrcode_status')) {
      const next = queue.shift() ?? { status: 'wait' }
      if (next.delayMs) {
        await new Promise(r => setTimeout(r, next.delayMs))
      }
      return new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
  requests.length = 0
})

describe('startWeixinLoginWithQr', () => {
  it('reads the live API fields: qrcode + qrcode_img_content (regression: qrcode_url never exists)', async () => {
    stubFetch([])
    const before = getActiveLogins().size
    const result = await startWeixinLoginWithQr({ apiBaseUrl: 'https://ilinkai.weixin.qq.com' })
    expect(result.qrcodeUrl).toBe('https://liteapp.weixin.qq.com/q/abc')
    expect(result.sessionKey).toBeTruthy()
    expect(getActiveLogins().size).toBe(before + 1)
    // The start request is a POST to get_bot_qrcode with a token list body.
    const startReq = requests.find(r => r.url.includes('get_bot_qrcode'))
    expect(startReq?.method).toBe('POST')
    expect(startReq?.body).toContain('local_token_list')
  })

  it('returns an error message instead of a QR URL when the API has no QR', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ ret: 1, message: 'bot_type invalid' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch
    const result = await startWeixinLoginWithQr({ apiBaseUrl: 'https://ilinkai.weixin.qq.com' })
    expect(result.qrcodeUrl).toBeUndefined()
    expect(result.message).toContain('bot_type invalid')
  })
})

describe('waitForWeixinLogin', () => {
  it('polls via GET get_qrcode_status?qrcode=... and maps confirmed credentials (regression: old code POSTed session_key)', async () => {
    stubFetch([
      { status: 'wait' },
      { status: 'need_verifycode' },
      { status: 'confirmed', ilink_bot_id: 'bot-1', bot_token: 'tok-1', baseurl: 'https://host.example.com', ilink_user_id: 'user-1' },
    ])

    const before = getActiveLogins().size
    const start = await startWeixinLoginWithQr({ apiBaseUrl: 'https://ilinkai.weixin.qq.com' })
    const codes = ['4242']
    const result = await waitForWeixinLogin({
      sessionKey: start.sessionKey,
      apiBaseUrl: 'https://ilinkai.weixin.qq.com',
      timeoutMs: 30_000,
      verifyCodeProvider: async () => codes.shift() ?? '',
    })

    expect(result.connected).toBe(true)
    expect(result.accountId).toBe('bot-1')
    expect(result.botToken).toBe('tok-1')
    expect(result.baseUrl).toBe('https://host.example.com')
    expect(result.userId).toBe('user-1')

    const polls = requests.filter(r => r.url.includes('get_qrcode_status'))
    expect(polls.length).toBeGreaterThan(0)
    // Every poll is a GET keyed by the qrcode query parameter — never a POST
    // with a session_key body (the old contract the live API rejects with ret:1).
    for (const poll of polls) {
      expect(poll.method).toBe('GET')
      expect(poll.url).toContain('qrcode=qr-abc')
      expect(poll.body).toBeNull()
    }
    // The verification code rides on the status poll query string.
    expect(polls.some(p => p.url.includes('verify_code=4242'))).toBe(true)
    // Login consumed its tracking record (other tests may hold their own).
    expect(getActiveLogins().size).toBe(before)
  })

  it('survives slow long-poll responses (hold = still waiting)', async () => {
    // The iLink status endpoint long-polls: it holds the connection while the
    // QR waits to be scanned, answering only when the status changes (or on
    // client timeout). Slow responses must not fail the flow — the loop
    // keeps polling.
    stubFetch([
      { status: 'wait', delayMs: 800 },
      { status: 'wait', delayMs: 800 },
      { status: 'wait', delayMs: 800 },
    ])
    const before = getActiveLogins().size
    const start = await startWeixinLoginWithQr({ apiBaseUrl: 'https://ilinkai.weixin.qq.com' })
    const statuses: string[] = []
    const result = await waitForWeixinLogin({
      sessionKey: start.sessionKey,
      apiBaseUrl: 'https://ilinkai.weixin.qq.com',
      timeoutMs: 3_000,
      onStatus: s => statuses.push(s),
    })
    // Long-poll timeouts are treated as wait; the loop keeps polling.
    expect(result.connected).toBe(false)
    expect(result.message).toContain('timed out')
    const polls = requests.filter(r => r.url.includes('get_qrcode_status'))
    expect(polls.length).toBeGreaterThanOrEqual(2)
    for (const poll of polls) {
      expect(poll.method).toBe('GET')
      expect(poll.url).toContain('qrcode=')
    }
    expect(getActiveLogins().size).toBe(before)
  })

  it('cancels the flow when the verify-code provider resolves empty', async () => {
    stubFetch([{ status: 'need_verifycode' }])
    const start = await startWeixinLoginWithQr({ apiBaseUrl: 'https://ilinkai.weixin.qq.com' })
    const result = await waitForWeixinLogin({
      sessionKey: start.sessionKey,
      apiBaseUrl: 'https://ilinkai.weixin.qq.com',
      timeoutMs: 30_000,
      verifyCodeProvider: async () => '',
    })
    expect(result.connected).toBe(false)
    expect(result.message).toContain('cancelled')
  })
})
