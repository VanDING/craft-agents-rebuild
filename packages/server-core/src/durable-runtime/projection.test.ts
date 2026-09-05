import { describe, expect, test } from 'bun:test'
import { auditLegacyProjection } from './audit.js'
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
      inputTokens: 292,
      outputTokens: 25,
      totalTokens: 317,
      contextTokens: 182,
      costUsd: 0.03,
      cacheReadTokens: 50,
      cacheCreationTokens: 12,
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


describe('usage regression cases', () => {
  test('deduplicates requests and counts reasoning/cache subcategories once', () => {
    const row = { usageId: 'one', operationId: 'run', sessionId: 's', createdAt: 1,
      inputTokens: 1, outputTokens: 100,
      payload: { usage: { cacheRead: 10000, cacheWrite: 50, cacheWrite1h: 20, reasoning: 80 } } };
    const projection = projectDurableUsage([row, row]);
    expect(projection).toMatchObject({ attempts: 1, inputTokens: 10051, outputTokens: 100, totalTokens: 10151,
      full: { reasoning: 80, cacheWrite1h: 20, totalTokens: 10151 } });
  });

  test('preserves tool-only request usage through canonical projection without inventing model text', () => {
    const usage = { input: 100, output: 10, cacheRead: 20, cacheWrite: 5, totalTokens: 135,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    const messages = [
      { id: 'u', role: 'user' as const, content: 'hello', timestamp: 1 },
      { id: 'usage', role: 'assistant' as const, content: '', isIntermediate: true, timestamp: 2, requestSeq: 1, usage },
      { id: 'a', role: 'assistant' as const, content: 'answer', timestamp: 3 },
    ];
    const events = [fact(1, 'user_message_committed', { messageId: 'u', content: 'hello' }),
      fact(3, 'assistant_message_committed', { messageId: 'a', content: 'answer' })];
    expect(auditLegacyProjection(events, messages)).toEqual([]);
    expect(projectCanonicalSessionMessages(events, messages)).toMatchObject(messages);
    expect(projectModelContext(events).map(item => item.kind)).toEqual(['user', 'assistant']);
  });
});
