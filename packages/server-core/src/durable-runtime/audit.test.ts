import { describe, expect, test } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import type { RuntimeEvent } from '@craft-agent/shared/durable-runtime'
import { auditLegacyProjection } from './audit.js'

const event: RuntimeEvent = {
  eventId: 'e-1', seq: 1, sessionId: 's', operationId: 'r',
  type: 'user_message_committed', schemaVersion: 1, modelVisible: true,
  partial: false, payload: { messageId: 'm-1', content: 'hi' }, createdAt: 1,
}

describe('legacy projection audit', () => {
  test('detects divergence without mutating either representation', () => {
    const messages: Message[] = []
    expect(auditLegacyProjection([event], messages)).toEqual([
      { kind: 'missing_legacy_message', identity: 'm-1', durableSeq: 1 },
    ])
    expect(messages).toEqual([])
  })
})
