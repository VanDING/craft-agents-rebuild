import { describe, expect, test } from 'bun:test'
import type { RuntimeEvent } from '@craft-agent/shared/durable-runtime'
import { projectCanonicalSessionMessages, projectDurableSession, projectDurableUsage, projectModelContext, reduceWorkspaceSessionProjection } from './projection.js'

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

  test('incrementally materializes isolated session histories behind one workspace cursor', () => {
    const first = reduceWorkspaceSessionProjection({ sessions: {} }, [
      fact(1, 'user_message_committed', { content: 'one' }),
    ])
    const secondEvent = { ...fact(2, 'user_message_committed', { content: 'two' }), sessionId: 's-2' }
    const second = reduceWorkspaceSessionProjection(first, [secondEvent])
    expect(second.sessions['s-1']?.items.map(item => item.kind)).toEqual(['user'])
    expect(second.sessions['s-2']?.items.map(item => item.kind)).toEqual(['user'])
    expect(second.sessions['s-1']?.cursor).toBe(1)
    expect(second.sessions['s-2']?.cursor).toBe(2)
  })

  test('rebuilds token and cost totals from deduplicated model attempts', () => {
    const projection = projectDurableUsage([
      {
        usageId: 'model:run:1', operationId: 'run', sessionId: 's-1',
        inputTokens: 100, outputTokens: 10, costUsd: 0.01,
        payload: { usage: { cacheRead: 20, cacheWrite: 5 } }, createdAt: 1,
      },
      {
        usageId: 'model:run:2', operationId: 'run', sessionId: 's-1',
        inputTokens: 130, outputTokens: 15, costUsd: 0.02,
        payload: { usage: { cacheRead: 30, cacheWrite: 7 } }, createdAt: 2,
      },
    ])
    expect(projection).toEqual(expect.objectContaining({
      attempts: 2,
      inputTokens: 130,
      outputTokens: 25,
      totalTokens: 155,
      costUsd: 0.03,
      cacheReadTokens: 30,
      cacheCreationTokens: 7,
    }))
  })

  test('uses canonical semantic order while retaining rich UI-only cache metadata', () => {
    const events = [
      fact(1, 'user_message_committed', { messageId: 'u1', content: 'canonical user' }),
      fact(2, 'tool_call_observed', { toolOperationId: 'tool-op', providerToolCallId: 'call-1', toolName: 'Read', args: { path: 'a' } }),
      fact(3, 'tool_outcome_committed', {
        runOperationId: 'run-1', operationId: 'tool-op', providerToolCallId: 'call-1',
        toolName: 'Read', canonicalArgsHash: 'hash', result: { text: 'ok' }, isError: false,
      }),
      fact(4, 'assistant_message_committed', { messageId: 'a1', content: 'canonical answer' }),
    ]
    const projected = projectCanonicalSessionMessages(events, [
      { id: 'a1', role: 'assistant', content: 'legacy answer', timestamp: 4, annotations: [] },
      { id: 'warning', role: 'warning', content: 'keep me', timestamp: 2 },
      { id: 'tool', role: 'assistant', content: '', timestamp: 3, toolUseId: 'call-1', toolDisplayName: 'Rich Read' },
      { id: 'u1', role: 'user', content: 'legacy user', timestamp: 1, attachments: [] },
    ])

    expect(projected.map(message => message.id)).toEqual(['u1', 'warning', 'tool', 'a1'])
    expect(projected[0]).toMatchObject({ content: 'canonical user', attachments: [], durableSeq: 1 })
    expect(projected[2]).toMatchObject({ toolDisplayName: 'Rich Read', toolStatus: 'completed', toolResult: '{"text":"ok"}', durableSeq: 3 })
    expect(projected[3]).toMatchObject({ content: 'canonical answer', annotations: [], durableSeq: 4 })
  })
})
