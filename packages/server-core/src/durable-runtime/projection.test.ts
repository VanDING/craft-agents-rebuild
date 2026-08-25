import { describe, expect, test } from 'bun:test'
import type { RuntimeEvent } from '@craft-agent/shared/durable-runtime'
import { projectDurableSession, projectModelContext } from './projection.js'

function fact(seq: number, type: RuntimeEvent['type'], payload: unknown, modelVisible = true, partial = false): RuntimeEvent {
  return {
    eventId: `e-${seq}`,
    seq,
    sessionId: 's-1',
    operationId: 'run-1',
    type,
    schemaVersion: 1,
    modelVisible,
    partial,
    payload,
    createdAt: seq,
  }
}

describe('durable projections', () => {
  test('derive deterministic model context while excluding transport and control state', () => {
    const events = [
      fact(4, 'tool_dispatch_committed', { secret: 'control' }, false),
      fact(2, 'assistant_message_committed', { content: 'partial' }, true, true),
      fact(3, 'tool_call_observed', { toolOperationId: 'op-t', providerToolCallId: 'call-1', toolName: 'Read', args: { path: 'a' } }),
      fact(1, 'user_message_committed', { content: 'hello' }),
    ]
    expect(projectModelContext(events).map(item => item.kind)).toEqual(['user', 'tool_call'])
    expect(projectDurableSession(events).cursor).toBe(4)
  })

  test('rebuild produces the same projection from the same immutable facts', () => {
    const events = [fact(1, 'user_message_committed', { content: 'hello' })]
    expect(projectDurableSession(events)).toEqual(projectDurableSession([...events]))
  })
})
