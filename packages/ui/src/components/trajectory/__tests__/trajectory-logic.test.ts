import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import { buildTrajectorySnapshot, type TrajectorySessionInput } from '../trajectory-snapshot'
import { deriveTrajectoryLayout } from '../trajectory-layout'
import { searchTrajectory } from '../trajectory-search-index'
import { flattenTurnCells, projectVirtualRows, CONTENT_ROW_HEIGHT, COLLAPSED_SUMMARY_HEIGHT } from '../trajectory-virtual-rows'
import { trajectoryDomain, trajectoryTimelineBlocks, trajectoryTimelineFocusIndexes } from '../trajectory-timeline'

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

function layoutFor(messages: readonly Message[]) {
  const input: TrajectorySessionInput = { messages }
  const snapshot = buildTrajectorySnapshot(input)
  return deriveTrajectoryLayout({
    contributions: snapshot.contributions,
    prompts: snapshot.prompts,
    requestUsage: snapshot.requestUsage,
    callSchemas: snapshot.callSchemas,
  })
}

describe('deriveTrajectoryLayout', () => {
  it('folds user/assistant/tool into turns with groups', () => {
    const turns = layoutFor([
      msg({ role: 'user', content: 'hello', turnId: 't1', timestamp: 1000 }),
      msg({ role: 'assistant', content: 'hi', turnId: 't1', timestamp: 2000, requestSeq: 1, usage }),
      msg({ role: 'tool', toolName: 'Read', toolUseId: 'c1', toolInput: { file_path: 'a.ts' }, toolResult: 'ok', turnId: 't1', timestamp: 3000 }),
    ])
    expect(turns.length).toBe(1)
    const titles = turns[0].groups.map(g => g.title)
    expect(titles).toContain('Request 1')
    expect(titles).toContain('User')
    expect(titles).toContain('Assistant')
    expect(titles).toContain('Tools')

    // Tool cell carries result summary + duration + schema.
    const toolCell = turns[0].groups.flatMap(g => g.cells).find(c => c.kind === 'tool')
    expect(toolCell?.result).toBe('ok')
    expect(toolCell?.callId).toBe('c1')
    expect(toolCell?.schemaDetail).toContain('a.ts')
  })

  it('marks parented tools as subtools', () => {
    const turns = layoutFor([
      msg({ role: 'tool', toolName: 'Task', toolUseId: 'parent', turnId: 't1', timestamp: 1000 }),
      msg({ role: 'tool', toolName: 'Read', toolUseId: 'child', parentToolUseId: 'parent', turnId: 't1', timestamp: 2000 }),
    ])
    const cells = turns[0].groups.flatMap(g => g.cells)
    expect(cells.some(c => c.kind === 'subtool')).toBe(true)
  })

  it('places compaction in a Between turns section', () => {
    const turns = layoutFor([
      msg({ role: 'info', content: 'Compacted', statusType: 'compaction_complete', compaction: { reason: 'threshold', aborted: false }, timestamp: 1000 }),
    ])
    expect(turns[0].turn).toBeNull()
    expect(turns[0].groups[0].title).toBe('Between turns')
    expect(turns[0].groups[0].cells[0].text).toContain('complete')
  })

  it('attaches usage buckets to assistant cells', () => {
    const turns = layoutFor([
      msg({ role: 'assistant', content: 'x', turnId: 't1', requestSeq: 1, usage, timestamp: 1000 }),
    ])
    const cell = turns[0].groups.flatMap(g => g.cells).find(c => c.kind === 'message')
    expect(cell?.input).toBe(12) // input + cacheRead
    expect(cell?.output).toBe(5)
    expect(cell?.cacheRead).toBe(2)
  })
})

describe('searchTrajectory', () => {
  it('finds cells by substring across text and result', () => {
    const turns = layoutFor([
      msg({ role: 'user', content: 'refactor the parser', turnId: 't1', timestamp: 1000 }),
      msg({ role: 'tool', toolName: 'Bash', toolUseId: 'c1', toolResult: 'build succeeded', turnId: 't1', timestamp: 2000 }),
    ])
    const hits = searchTrajectory(turns, 'build succeeded')
    expect(hits.length).toBe(1)
    expect(hits[0].cell.kind).toBe('tool')
  })

  it('returns empty for blank query', () => {
    expect(searchTrajectory([], '')).toEqual([])
    expect(searchTrajectory([], '   ')).toEqual([])
  })

  it('ANDs multiple terms', () => {
    const turns = layoutFor([
      msg({ role: 'user', content: 'fix the flaky test', turnId: 't1', timestamp: 1000 }),
    ])
    expect(searchTrajectory(turns, 'flaky test').length).toBe(1)
    expect(searchTrajectory(turns, 'flaky missing').length).toBe(0)
  })
})

describe('projectVirtualRows', () => {
  it('maps cells to fixed-height rows', () => {
    const turns = layoutFor([
      msg({ role: 'user', content: 'a', turnId: 't1', timestamp: 1000 }),
      msg({ role: 'assistant', content: 'b', turnId: 't1', timestamp: 2000 }),
    ])
    const rows = projectVirtualRows(flattenTurnCells(turns))
    expect(rows.length).toBe(2)
    expect(rows.every(r => r.height === CONTENT_ROW_HEIGHT)).toBe(true)
  })

  it('collapses flagged kinds to summary height', () => {
    const turns = layoutFor([
      msg({ role: 'user', content: 'a', turnId: 't1', timestamp: 1000 }),
    ])
    const rows = projectVirtualRows(flattenTurnCells(turns), new Set(['user']))
    expect(rows[0].height).toBe(COLLAPSED_SUMMARY_HEIGHT)
  })
})

describe('trajectoryTimeline', () => {
  it('computes domain from cell timestamps', () => {
    const turns = layoutFor([
      msg({ role: 'user', content: 'a', turnId: 't1', timestamp: 1000 }),
      msg({ role: 'assistant', content: 'b', turnId: 't1', timestamp: 5000 }),
    ])
    const domain = trajectoryDomain(turns)
    expect(domain).toEqual({ startMs: 1000, endMs: 5000 })
  })

  it('builds blocks with measured durations', () => {
    const turns = layoutFor([
      msg({ role: 'tool', toolName: 'Bash', toolUseId: 'c1', toolDuration: 2500, turnId: 't1', timestamp: 1000 }),
    ])
    const blocks = trajectoryTimelineBlocks(turns[0])
    expect(blocks[0].durationMs).toBe(2500)
  })

  it('reports null duration for unmeasured tools instead of 0ms', () => {
    const turns = layoutFor([
      msg({ role: 'tool', toolName: 'Bash', toolUseId: 'c1', turnId: 't1', timestamp: 1000 }),
    ])
    const toolCell = turns[0].groups.flatMap(g => g.cells).find(c => c.kind === 'tool')
    expect(toolCell?.timeSeconds).toBeNull()
  })

  it('estimates unmeasured block spans from message gaps', () => {
    const turns = layoutFor([
      msg({ role: 'user', content: 'a', turnId: 't1', timestamp: 1000 }),
      msg({ role: 'assistant', content: 'b', turnId: 't1', timestamp: 3000, requestSeq: 1, usage }),
      msg({ role: 'tool', toolName: 'Read', toolUseId: 'c1', toolResult: 'ok', turnId: 't1', timestamp: 5000 }),
    ])
    const blocks = trajectoryTimelineBlocks(turns[0])
    // Gaps belong to the record that opens them: user opens the 2s gap to
    // the assistant; same-timestamp usage cells floor at 1ms; the tool opens
    // the 2s gap to the (missing) next record; the final record is null.
    expect(blocks[0].durationMs).toBe(2000)
    expect(blocks[1].durationMs).toBe(1)
    expect(blocks[2].durationMs).toBe(2000)
    expect(blocks[3].durationMs).toBeNull()
  })

  it('resolves focus index to a normalized range', () => {
    const turns = layoutFor([
      msg({ role: 'user', content: 'a', turnId: 't1', timestamp: 0 }),
      msg({ role: 'assistant', content: 'b', turnId: 't1', timestamp: 1000 }),
    ])
    const range = trajectoryTimelineFocusIndexes(turns, 1)
    expect(range).not.toBeNull()
    expect(range!.start).toBeGreaterThanOrEqual(0)
    expect(range!.end).toBeLessThanOrEqual(1)
    expect(range!.start).toBeLessThan(range!.end)
  })

  it('returns null focus when index out of range', () => {
    const turns = layoutFor([
      msg({ role: 'user', content: 'a', turnId: 't1', timestamp: 1000 }),
    ])
    expect(trajectoryTimelineFocusIndexes(turns, 99)).toBeNull()
  })
})
