import { describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import {
  CALLBACK_TOKEN_HEADER,
  isValidCallbackToken,
  guardCallbackToken,
} from './callback-auth.ts'

describe('isValidCallbackToken (audit M-2)', () => {
  it('rejects a missing header', () => {
    expect(isValidCallbackToken(undefined, 'secret-token')).toBe(false)
  })

  it('rejects an empty header', () => {
    expect(isValidCallbackToken('', 'secret-token')).toBe(false)
  })

  it('rejects a wrong token', () => {
    expect(isValidCallbackToken('attacker-token', 'secret-token')).toBe(false)
  })

  it('accepts the exact token', () => {
    expect(isValidCallbackToken('secret-token', 'secret-token')).toBe(true)
  })

  it('rejects a token that only shares a prefix (length check)', () => {
    expect(isValidCallbackToken('secret-token-longer', 'secret-token')).toBe(false)
  })

  it('uses the first value when node delivers duplicate headers as an array', () => {
    expect(isValidCallbackToken(['secret-token', 'other'], 'secret-token')).toBe(true)
    expect(isValidCallbackToken(['wrong', 'secret-token'], 'secret-token')).toBe(false)
  })
})

describe('guardCallbackToken over HTTP (audit M-2)', () => {
  const TOKEN = 'test-callback-token'

  function startGuardedServer(): Promise<{ server: Server; port: number }> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        if (!guardCallbackToken(req, res, TOKEN)) return
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        const port = typeof addr === 'object' && addr ? addr.port : 0
        resolve({ server, port })
      })
      server.on('error', reject)
    })
  }

  it('rejects a request without the token header with 401', async () => {
    const { server, port } = await startGuardedServer()
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/call-llm`, { method: 'POST' })
      expect(resp.status).toBe(401)
    } finally {
      server.close()
    }
  })

  it('rejects a request with a wrong token with 401', async () => {
    const { server, port } = await startGuardedServer()
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/call-llm`, {
        method: 'POST',
        headers: { [CALLBACK_TOKEN_HEADER]: 'wrong-token' },
      })
      expect(resp.status).toBe(401)
    } finally {
      server.close()
    }
  })

  it('allows a request carrying the correct token', async () => {
    const { server, port } = await startGuardedServer()
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/call-llm`, {
        method: 'POST',
        headers: { [CALLBACK_TOKEN_HEADER]: TOKEN },
      })
      expect(resp.status).toBe(200)
      expect(await resp.json()).toEqual({ ok: true })
    } finally {
      server.close()
    }
  })
})
