import { expect, test } from 'bun:test'
import type { Message } from '@craft-agent/core'
import { recordMessageTextUpdate } from '@craft-agent/core/utils'
import { groupImmutableMessagesByTurn, groupMessagesByTurn } from '../turn-utils'

test('streaming projection preserves completed cards and matches the full reducer', () => {
  const messages: Message[] = [
    { id: 'u', role: 'user', content: 'question', timestamp: 1 },
    { id: 'a', role: 'assistant', content: 'answer', timestamp: 2 },
    { id: 'u2', role: 'user', content: 'next', timestamp: 3 },
    { id: 'tool', role: 'tool', content: '', toolName: 'read', toolUseId: 't', toolStatus: 'completed', toolResult: 'ok', timestamp: 4 },
    { id: 'stream', role: 'assistant', content: 'hello', isPending: true, isStreaming: true, timestamp: 5 },
  ]
  const before = groupImmutableMessagesByTurn(messages, { isSessionProcessing: true })
  const next = messages.slice()
  next[4] = { ...next[4]!, content: 'hello world' }
  recordMessageTextUpdate(messages, next, 4)
  const after = groupImmutableMessagesByTurn(next, { isSessionProcessing: true })
  expect(after).toEqual(groupMessagesByTurn(next, { isSessionProcessing: true }))
  expect(after[0]).toBe(before[0])
  expect(after[1]).toBe(before[1])
  expect(before).toEqual(groupMessagesByTurn(messages, { isSessionProcessing: true }))
  expect(groupImmutableMessagesByTurn(next, { isSessionProcessing: false }))
    .toEqual(groupMessagesByTurn(next, { isSessionProcessing: false }))

  const complete = next.map(m => m.id === 'stream' ? { ...m, isStreaming: false, isPending: false } : m)
  expect(groupImmutableMessagesByTurn(complete, { isSessionProcessing: false }))
    .toEqual(groupMessagesByTurn(complete, { isSessionProcessing: false }))
})

test('out-of-order, hidden and interleaved histories keep full grouping semantics', () => {
  for (const hidden of [false, true]) {
    const messages: Message[] = [
      { id: 'stream', role: 'assistant', content: 'first', isPending: true, isStreaming: true, timestamp: 2, hidden },
      { id: 'later', role: 'user', content: 'steer', timestamp: 3 },
      { id: 'earlier', role: 'user', content: 'start', timestamp: 1 },
    ]
    groupImmutableMessagesByTurn(messages, { isSessionProcessing: true })
    const next = messages.slice()
    next[0] = { ...next[0]!, content: 'continued' }
    recordMessageTextUpdate(messages, next, 0)
    expect(groupImmutableMessagesByTurn(next, { isSessionProcessing: true }))
      .toEqual(groupMessagesByTurn(next, { isSessionProcessing: true }))
  }
})

test('structural selectors retain one version across deltas but invalidate annotated content', async () => {
  const { getMessageStructureSource } = await import('@craft-agent/core/utils')
  const base: Message[] = [{ id: 'a', role: 'assistant', isPending: true, isStreaming: true, content: 'first', timestamp: 1 }]
  let current = base
  for (let i = 0; i < 20; i++) {
    const next = [{ ...current[0]!, content: String(i) }]
    recordMessageTextUpdate(current, next, 0)
    expect(getMessageStructureSource(next)).toBe(base)
    current = next
  }
  const annotated = [{ ...current[0]!, annotations: [{ id: 'annotation' }] }] as Message[]
  const changed = [{ ...annotated[0]!, content: 'selected text changed' }]
  recordMessageTextUpdate(annotated, changed, 0)
  expect(getMessageStructureSource(changed)).toBe(changed)
})
