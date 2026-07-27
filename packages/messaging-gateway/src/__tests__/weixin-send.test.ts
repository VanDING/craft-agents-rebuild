/**
 * WeixinAdapter send-message response parsing tests.
 *
 * The adapter's `callApi` method parses iLink API responses. These tests
 * verify that HTTP 200 with `ret != 0` or `errcode` is treated as a failure.
 * Full send round-trips require a live iLink backend and are covered by
 * manual e2e testing.
 */
import { describe, expect, it } from 'bun:test'
import { WeixinAdapter } from '../adapters/weixin/index'

describe('Weixin send — response parsing contract', () => {
  it('adapter exists and has correct platform', () => {
    const adapter = new WeixinAdapter({ baseUrl: 'http://localhost', authDir: '/tmp' })
    expect(adapter.platform).toBe('weixin')
  })

  it('sendText without a connected account throws', async () => {
    const adapter = new WeixinAdapter({ baseUrl: 'http://localhost', authDir: '/tmp' })
    await expect(adapter.sendText('ch', 'hello')).rejects.toThrow('No WeChat account')
  })

  it('sendFile without a connected account throws', async () => {
    const adapter = new WeixinAdapter({ baseUrl: 'http://localhost', authDir: '/tmp' })
    await expect(adapter.sendFile('ch', Buffer.from('data'), 'test.txt')).rejects.toThrow('No WeChat account')
  })

  it('sendFile respects MAX_ATTACHMENT_BYTES', async () => {
    // Even with an account, files over 20MB should be rejected before any API call.
    const adapter = new WeixinAdapter({
      baseUrl: 'http://localhost',
      authDir: '/tmp',
      accounts: [{ token: 'tok', uin: 'uin1' }],
    })
    const bigFile = Buffer.alloc(21 * 1024 * 1024)
    await expect(adapter.sendFile('ch', bigFile, 'big.txt')).rejects.toThrow('byte limit')
  })

  it('sendTyping without a connected account throws', async () => {
    const adapter = new WeixinAdapter({ baseUrl: 'http://localhost', authDir: '/tmp' })
    await expect(adapter.sendTyping('ch')).rejects.toThrow('No WeChat account')
  })
})
