import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import { buildTrajectorySnapshot, type TrajectorySessionInput } from '../trajectory-snapshot'
import { EMPTY_TRAJECTORY_SNAPSHOT } from '../trajectory-contract'

function msg(overrides: Partial<Message> & { role: Message['role'] }): Message {
  return {
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: '',
    timestamp: 1000,
    ...overrides,
  }
}

const usage = {
  input: 10,
  output: 5,
  cacheRead: 2,
  cacheWrite: 1,
  totalTokens: 18,
  cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
}

describe('buildTrajectorySnapshot', () => {
  it('returns the empty snapshot for no messages', () => {
    const snapshot = buildTrajectorySnapshot({ messages: [] })
    expect(snapshot.contributions).toEqual([])
    expect(snapshot.messages).toEqual([])
    expect(snapshot.timeRange).toBeUndefined()
  })

  it('emits request-header before assistant and records usage', () => {
    const input: TrajectorySessionInput = {
      messages: [
        msg({ role: 'user', content: 'hello' }),
        msg({
          role: 'assistant',
          content: 'hi',
          turnId: 't1',
          requestSeq: 1,
          promptSnapshot: 'sys prompt',
          usage,
          timestamp: 2000,
        }),
      ],
    }
    const snapshot = buildTrajectorySnapshot(input)
    const kinds = snapshot.contributions.map(c => c.kind)
    expect(kinds).toEqual(['node', 'request-header', 'assistant', 'session-end'])
    expect(snapshot.prompts.get(1)).toBe('sys prompt')
    expect(snapshot.requestUsage.get(1)).toEqual(usage)
    expect(snapshot.totalUsage).toEqual(usage)
    expect(snapshot.timeRange).toEqual({ start: 1000, end: 2000 })
    expect(snapshot.messages).toBe(input.messages)
  })

  it('tracks turn boundaries with turn-end markers', () => {
    const input: TrajectorySessionInput = {
      messages: [
        msg({ role: 'user', content: 'a', turnId: 't1', timestamp: 1000 }),
        msg({ role: 'assistant', content: 'b', turnId: 't1', timestamp: 2000 }),
        msg({ role: 'user', content: 'c', turnId: 't2', timestamp: 3000 }),
      ],
    }
    const snapshot = buildTrajectorySnapshot(input)
    const turnEnds = snapshot.contributions.filter(c => c.kind === 'turn-end')
    expect(turnEnds).toHaveLength(1)
    expect(turnEnds[0]).toMatchObject({ kind: 'turn-end', turn: 1 })
  })

  it('records tool calls with schema inspection', () => {
    const input: TrajectorySessionInput = {
      messages: [
        msg({
          role: 'tool',
          toolName: 'Read',
          toolUseId: 'call_1',
          toolInput: { file_path: 'a.ts' },
          timestamp: 1500,
        }),
      ],
    }
    const snapshot = buildTrajectorySnapshot(input)
    expect(snapshot.contributions[0]).toMatchObject({ kind: 'tool' })
    expect(snapshot.callSchemas.get('call_1')).toContain('a.ts')
  })

  it('places compaction info records as compaction contributions', () => {
    const input: TrajectorySessionInput = {
      messages: [
        msg({
          role: 'info',
          content: 'Compacted context to fit within limits',
          statusType: 'compaction_complete',
          compaction: { reason: 'threshold', aborted: false, willRetry: false },
          timestamp: 2500,
        }),
      ],
    }
    const snapshot = buildTrajectorySnapshot(input)
    expect(snapshot.contributions[0]).toMatchObject({ kind: 'compaction' })
  })

  it('accumulates usage across multiple requests', () => {
    const input: TrajectorySessionInput = {
      messages: [
        msg({ role: 'assistant', content: 'a', requestSeq: 1, usage, timestamp: 2000 }),
        msg({ role: 'assistant', content: 'b', requestSeq: 2, usage, timestamp: 4000 }),
      ],
    }
    const snapshot = buildTrajectorySnapshot(input)
    expect(snapshot.totalUsage?.input).toBe(20)
    expect(snapshot.totalUsage?.output).toBe(10)
    expect(snapshot.totalUsage?.cost.total).toBe(0.6)
  })

  it('assigns stable ordinals when the provider request sequence restarts', () => {
    const snapshot = buildTrajectorySnapshot({ messages: [
      msg({ id: 'a1', role: 'assistant', requestSeq: 7, promptSnapshot: 'one', timestamp: 2_000 }),
      msg({ id: 'a2', role: 'assistant', requestSeq: 1, promptSnapshot: 'two', timestamp: 4_000 }),
    ] })
    const headers = snapshot.contributions.filter(contribution => contribution.kind === 'request-header')
    expect(headers.map(header => header.requestSeq)).toEqual([1, 2])
    expect(headers.map(header => header.sourceRequestSeq)).toEqual([7, 1])
    expect(snapshot.prompts.get(1)).toBe('one')
    expect(snapshot.prompts.get(2)).toBe('two')
  })

  it('falls back to session lastFullUsage when no message usage', () => {
    const input: TrajectorySessionInput = {
      messages: [msg({ role: 'user', content: 'x' })],
      lastFullUsage: usage,
    }
    const snapshot = buildTrajectorySnapshot(input)
    expect(snapshot.totalUsage).toEqual(usage)
  })

  it('returns EMPTY_TRAJECTORY_SNAPSHOT shape for empty input', () => {
    expect(EMPTY_TRAJECTORY_SNAPSHOT.contributions).toEqual([])
  })
})
