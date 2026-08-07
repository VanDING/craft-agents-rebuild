import { describe, it, expect, afterEach } from 'bun:test'

import { apiPostFetch, apiGetFetch, joinApiUrl } from '../adapters/wechat/ilink/api/api'

const realFetch = globalThis.fetch

let lastUrl = ''

function stubFetch(status: number, body: string): void {
  globalThis.fetch = (async (url: unknown) => {
    lastUrl = String(url)
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('joinApiUrl', () => {
  it('joins a slash-less base URL and slash-less endpoint with one slash', () => {
    expect(joinApiUrl('https://ilinkai.weixin.qq.com', 'ilink/bot/getupdates')).toBe(
      'https://ilinkai.weixin.qq.com/ilink/bot/getupdates',
    )
  })

  it('tolerates a trailing slash on the base URL', () => {
    expect(joinApiUrl('https://ilinkai.weixin.qq.com/', 'ilink/bot/getupdates')).toBe(
      'https://ilinkai.weixin.qq.com/ilink/bot/getupdates',
    )
  })

  it('tolerates a leading slash on the endpoint', () => {
    expect(joinApiUrl('https://ilinkai.weixin.qq.com', '/ilink/bot/getupdates')).toBe(
      'https://ilinkai.weixin.qq.com/ilink/bot/getupdates',
    )
  })
})

describe('apiPostFetch URL construction', () => {
  it('builds a valid URL for the getupdates endpoint (regression: com + ilink concatenation)', async () => {
    stubFetch(200, '{"ret":0}')
    await apiPostFetch({
      baseUrl: 'https://ilinkai.weixin.qq.com',
      endpoint: 'ilink/bot/getupdates',
      body: {},
      token: 'tok',
    })
    expect(lastUrl).toBe('https://ilinkai.weixin.qq.com/ilink/bot/getupdates')
  })

  it('normalizes a trailing-slash base URL', async () => {
    stubFetch(200, '{"ret":0}')
    await apiPostFetch({
      baseUrl: 'https://ilinkai.weixin.qq.com/',
      endpoint: 'ilink/bot/sendmessage',
      body: {},
      token: 'tok',
    })
    expect(lastUrl).toBe('https://ilinkai.weixin.qq.com/ilink/bot/sendmessage')
  })
})

describe('apiGetFetch URL construction', () => {
  it('builds a valid URL for slash-less base and endpoint', async () => {
    stubFetch(200, '{}')
    await apiGetFetch({
      baseUrl: 'https://ilinkai.weixin.qq.com',
      endpoint: 'ilink/bot/GetConfig',
    })
    expect(lastUrl).toBe('https://ilinkai.weixin.qq.com/ilink/bot/GetConfig')
  })
})
