import { describe, expect, test } from 'bun:test'
import { redactDurablePayload } from './sensitive-payload.js'

describe('redactDurablePayload', () => {
  test('redacts credential-shaped fields recursively while preserving operational identity', () => {
    expect(redactDurablePayload({
      taskSlug: 'build',
      authorization: 'Bearer secret',
      nested: { apiKey: 'key', password: 'pw', reference: 'ticket-1' },
      rows: [{ access_token: 'token', value: 3 }],
    })).toEqual({
      taskSlug: 'build',
      authorization: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', password: '[REDACTED]', reference: 'ticket-1' },
      rows: [{ access_token: '[REDACTED]', value: 3 }],
    })
  })
})
