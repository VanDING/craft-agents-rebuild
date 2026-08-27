import { describe, expect, test } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import type { RuntimeEvent } from '@craft-agent/shared/durable-runtime'
import { auditLegacyProjection, reportLegacyProjectionParity } from './audit.js'

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

  test('emits structured parity metrics for the production shadow read', () => {
    expect(reportLegacyProjectionParity([event], [])).toMatchObject({
      canonicalFacts: 1,
      legacyMessages: 0,
      issueCount: 1,
      issueCounts: {
        missing_legacy_message: 1,
        legacy_fact_missing: 0,
        legacy_cursor_ahead: 0,
        outcome_not_reflected: 0,
      },
      parityRatio: 0,
    })
    expect(reportLegacyProjectionParity([event], [{ id: 'm-1', role: 'user', content: 'hi', timestamp: 1 }])).toMatchObject({
      issueCount: 0,
      parityRatio: 1,
    })
  })
})
