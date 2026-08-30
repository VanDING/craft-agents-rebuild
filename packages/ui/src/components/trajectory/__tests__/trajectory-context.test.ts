import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import { buildTrajectorySnapshot } from '../trajectory-snapshot'
import { deriveRequestContexts, requestContextDelta } from '../trajectory-context'

function message(overrides: Partial<Message> & Pick<Message, 'id' | 'role'>): Message {
  return { content: '', timestamp: 1, ...overrides }
}

describe('deriveRequestContexts', () => {
  it('deduplicates prompt versions and accumulates observable request evidence', () => {
    const snapshot = buildTrajectorySnapshot({ messages: [
      message({ id: 'u1', role: 'user', content: 'first' }),
      message({ id: 'a1', role: 'assistant', content: 'answer', requestSeq: 1, promptSnapshot: 'system' }),
      message({ id: 't1', role: 'tool', toolName: 'Read', toolUseId: 'call-1', toolInput: { path: 'a.ts' }, toolResult: 'body' }),
      message({ id: 'a2', role: 'assistant', content: 'done', requestSeq: 2, promptSnapshot: 'system' }),
    ] })
    const contexts = deriveRequestContexts(snapshot)
    expect(contexts).toHaveLength(2)
    expect(contexts[0]?.promptVersion).toBe(1)
    expect(contexts[1]?.promptVersion).toBe(1)
    expect(contexts[0]?.groups.find(group => group.category === 'user')?.items).toHaveLength(1)
    expect(contexts[1]?.groups.find(group => group.category === 'tools')?.items[0]?.callId).toBe('call-1')
    expect(requestContextDelta(contexts[1]!, contexts[0]!)).toBeGreaterThan(0)
  })

  it('creates a new prompt version only when prompt content changes', () => {
    const snapshot = buildTrajectorySnapshot({ messages: [
      message({ id: 'a1', role: 'assistant', requestSeq: 1, promptSnapshot: 'one' }),
      message({ id: 'a2', role: 'assistant', requestSeq: 2, promptSnapshot: 'two' }),
    ] })
    expect(deriveRequestContexts(snapshot).map(context => context.promptVersion)).toEqual([1, 2])
  })

  it('keeps chronological display order when provider request sequences repeat', () => {
    const snapshot = buildTrajectorySnapshot({ messages: [
      message({ id: 'a1', role: 'assistant', requestSeq: 12, promptSnapshot: 'one' }),
      message({ id: 'a2', role: 'assistant', requestSeq: 1, promptSnapshot: 'two' }),
      message({ id: 'a3', role: 'assistant', requestSeq: 1, promptSnapshot: 'three' }),
    ] })
    const contexts = deriveRequestContexts(snapshot)
    expect(contexts.map(context => context.requestSeq)).toEqual([1, 2, 3])
    expect(contexts.map(context => context.sourceRequestSeq)).toEqual([12, 1, 1])
    expect(contexts.map(context => context.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('uses a request-time manifest when available', () => {
    const snapshot = buildTrajectorySnapshot({ messages: [
      message({
        id: 'a1',
        role: 'assistant',
        requestSeq: 1,
        promptSnapshot: 'system',
        contextSnapshot: {
          version: 1,
          capturedAt: 1,
          provider: 'anthropic',
          model: 'test',
          system: { hash: 'system', chars: 8 },
          messages: [{ role: 'user', hash: 'user', chars: 120 }],
          tools: [{ name: 'Read', description: 'Read files', hash: 'read', schemaChars: 80 }],
        },
      }),
    ] })
    const context = deriveRequestContexts(snapshot)[0]!
    expect(context.captured).toBe(true)
    expect(context.provider).toBe('anthropic')
    expect(context.groups.find(group => group.category === 'user')?.chars).toBe(120)
    expect(context.groups.find(group => group.category === 'tools')?.items[0]?.label).toContain('Read')
  })
})
