import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import { buildTrajectorySnapshot, type TrajectorySessionInput } from '../trajectory-snapshot'
import {
  collapseAssistantRecords,
  collapseTurnRecords,
  deriveTrajectoryLayout,
  flattenTurnRecords,
  formatDurationMillis,
  trajectoryRecordId,
  type TrajectoryCellProps,
  type TrajectoryRenderRecord,
} from '../trajectory-layout'
import { filterRecords, searchTrajectory, toolCallTextParts } from '../trajectory-search-index'
import { computeVirtualRowWindow, projectVirtualRows, CONTENT_ROW_HEIGHT, COLLAPSED_SUMMARY_HEIGHT } from '../trajectory-virtual-rows'
import { deriveTrajectoryTimeline, trajectoryTimelineFocusIndexes } from '../trajectory-timeline'

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
  })

  it('reports null duration for unmeasured tools instead of 0ms', () => {
    const turns = layoutFor([
      msg({ role: 'tool', toolName: 'Bash', toolUseId: 'c1', turnId: 't1', timestamp: 1000 }),
    ])
    const toolCell = turns[0].groups.flatMap(g => g.cells).find(c => c.kind === 'tool')
    expect(toolCell?.timeSeconds).toBeNull()
  })

  it('carries assistant metrics onto message cells', () => {
    const metrics = {
      timingRecorded: true,
      stepStartTime: 1000,
      firstTokenTime: 1500,
      completedTime: 3000,
      usageProvided: true,
      outputTokens: 50,
    }
    const turns = layoutFor([
      msg({ role: 'user', content: 'a', turnId: 't1', timestamp: 500 }),
      msg({ role: 'assistant', content: 'b', turnId: 't1', timestamp: 3000, requestSeq: 1, usage, assistantMetrics: metrics }),
    ])
    const messageCell = turns[0].groups.flatMap(g => g.cells).find(c => c.kind === 'message')
    expect(messageCell?.assistantMetrics?.ttft).toBeUndefined()
    expect(messageCell?.assistantMetrics?.firstTokenTime).toBe(1500)
  })
})

describe('formatDurationMillis', () => {
  it('formats known durations with thousands separators', () => {
    expect(formatDurationMillis(1500)).toBe('1,500ms')
  })

  it('renders em dash for unknown durations', () => {
    expect(formatDurationMillis(null)).toBe('—')
  })
})

describe('trajectoryRecordId', () => {
  it('prefers call id, then source seq, then index', () => {
    expect(trajectoryRecordId({ index: 1, kind: 'tool', text: '', timeSeconds: null, callId: 'c1' })).toBe('c1')
    expect(trajectoryRecordId({ index: 2, kind: 'message', text: '', timeSeconds: null, sourceSeq: 'm1' })).toBe('m1')
    expect(trajectoryRecordId({ index: 3, kind: 'user', text: '', timeSeconds: null })).toBe('index-3')
  })
})

describe('folding', () => {
  const turns = layoutFor([
    msg({ role: 'user', content: 'a', turnId: 't1', timestamp: 1000 }),
    msg({ role: 'assistant', content: 'b', turnId: 't1', timestamp: 2000, requestSeq: 1, usage }),
    msg({ role: 'tool', toolName: 'Read', toolUseId: 'c1', toolResult: 'ok', turnId: 't1', timestamp: 3000 }),
    msg({ role: 'user', content: 'c', turnId: 't2', timestamp: 4000 }),
    msg({ role: 'assistant', content: 'd', turnId: 't2', timestamp: 5000, requestSeq: 2, usage }),
    msg({ role: 'tool', toolName: 'Bash', toolUseId: 'c2', toolResult: 'ok', turnId: 't2', timestamp: 6000 }),
  ])

  it('collapses a turn into a summary row (system records retained)', () => {
    const flat = flattenTurnRecords(turns)
    const collapsed = collapseTurnRecords(flat, new Set([1]))
    const summary = collapsed.find(r => r.collapsedSummaryKind === 'turn')
    expect(summary?.collapsedSummary).toContain('step')
    expect(summary?.collapsedSummary).toContain('tool call')
    // System (request) records survive the fold.
    expect(collapsed.filter(r => r.cell.kind === 'system').length).toBeGreaterThan(0)
  })

  it('collapses assistant tool calls into a summary row', () => {
    const flat = flattenTurnRecords(turns)
    const messageCell = turns[0].groups.flatMap(g => g.cells).find(c => c.kind === 'message')
    const recordId = trajectoryRecordId(messageCell!)
    const collapsed = collapseAssistantRecords(flat, new Set([recordId]))
    const summary = collapsed.find(r => r.collapsedSummaryKind === 'assistant')
    expect(summary?.collapsedSummary).toContain('tool call')
  })

  it('leaves uncollapsed turns untouched', () => {
    const flat = flattenTurnRecords(turns)
    const collapsed = collapseTurnRecords(flat, new Set())
    expect(collapsed.length).toBe(flat.length)
  })
})

describe('search', () => {
  const turns = layoutFor([
    msg({ role: 'user', content: 'hello world', turnId: 't1', timestamp: 1000 }),
    msg({ role: 'assistant', content: 'hi there', turnId: 't1', timestamp: 2000, requestSeq: 1, usage }),
    msg({ role: 'tool', toolName: 'Read', toolUseId: 'c1', toolInput: { file_path: 'a.ts' }, toolResult: 'contents', turnId: 't1', timestamp: 3000 }),
  ])

  it('matches query terms across cell text and tool call names', () => {
    const flat = flattenTurnRecords(turns)
    const hits = searchTrajectory(flat, 'Read')
    // Ledger: user#1 → system#2 → message#3 → tool#4.
    expect(hits.has(4)).toBe(true)
  })

  it('ANDs whitespace-separated terms', () => {
    const flat = flattenTurnRecords(turns)
    expect(searchTrajectory(flat, 'hello world').has(1)).toBe(true)
    expect(searchTrajectory(flat, 'hello missing').size).toBe(0)
  })

  it('filters records to hits, preserving order and summaries', () => {
    const flat = flattenTurnRecords(turns)
    const hits = searchTrajectory(flat, 'hello')
    const filtered = filterRecords(flat, hits)
    expect(filtered.length).toBe(1)
    expect(filtered[0]?.cell.kind).toBe('user')
  })
})

describe('toolCallTextParts', () => {
  it('splits name and args', () => {
    expect(toolCallTextParts('tool', 'Read: a.ts')).toEqual({ name: 'Read', args: 'a.ts' })
  })
})

describe('virtual rows', () => {
  it('projects fixed heights with stable keys', () => {
    const turns = layoutFor([
      msg({ role: 'user', content: 'a', turnId: 't1', timestamp: 1000 }),
      msg({ role: 'assistant', content: 'b', turnId: 't1', timestamp: 2000, requestSeq: 1, usage }),
      msg({ role: 'tool', toolName: 'Read', toolUseId: 'c1', toolResult: 'ok', turnId: 't1', timestamp: 3000 }),
    ])
    const flat = flattenTurnRecords(turns)
    const rows = projectVirtualRows(flat)
    expect(rows.length).toBe(flat.length)
    expect(rows.every(r => r.height === CONTENT_ROW_HEIGHT)).toBe(true)
    // Collapsed summary rows get the compact height.
    const collapsed = collapseTurnRecords(flat, new Set([1]))
    const projected = projectVirtualRows(collapsed)
    const summaryRow = projected.find(r => r.record.collapsedSummary !== undefined)
    expect(summaryRow?.height).toBe(COLLAPSED_SUMMARY_HEIGHT)
  })
})

describe('virtual window', () => {
  const rows = Array.from({ length: 100 }, (_, i) => {
    const cell: TrajectoryCellProps = { index: i + 1, kind: 'user', text: '', timeSeconds: null }
    const record: TrajectoryRenderRecord = {
      cell,
      turn: 1,
      group: 'User',
      turnStart: false,
      groupStart: false,
      turnEnd: false,
    }
    return { record, height: CONTENT_ROW_HEIGHT, key: `r${i}` }
  })

  it('renders only the rows overlapping the viewport plus overscan', () => {
    const win = computeVirtualRowWindow(rows, 0, 180)
    expect(win.start).toBe(0)
    expect(win.end).toBe(11)
    expect(win.top).toBe(0)
    expect(win.bottom).toBe(100 * CONTENT_ROW_HEIGHT - win.end * CONTENT_ROW_HEIGHT)
  })

  it('slices with top and bottom spacers when scrolled', () => {
    const win = computeVirtualRowWindow(rows, 300, 180)
    expect(win.start).toBe(5)
    expect(win.end).toBe(21)
    expect(win.top).toBe(150)
    expect(win.bottom).toBe(100 * CONTENT_ROW_HEIGHT - win.end * CONTENT_ROW_HEIGHT)
  })

  it('keeps the scroll height stable across any window', () => {
    const win = computeVirtualRowWindow(rows, 300, 180)
    const rendered = win.end - win.start
    expect(win.top + rendered * CONTENT_ROW_HEIGHT + win.bottom).toBe(100 * CONTENT_ROW_HEIGHT)
  })
})

describe('timeline', () => {
  it('projects sequence mode with three lanes and turn boundaries', () => {
    const turns = layoutFor([
      msg({ role: 'user', content: 'a', turnId: 't1', timestamp: 1000 }),
      msg({ role: 'assistant', content: 'b', turnId: 't1', timestamp: 2000, requestSeq: 1, usage }),
      msg({ role: 'tool', toolName: 'Read', toolUseId: 'c1', toolResult: 'ok', turnId: 't1', timestamp: 3000 }),
    ])
    const model = deriveTrajectoryTimeline(turns, 'sequence')
    expect(model).not.toBeNull()
    expect(model!.spans.length).toBeGreaterThanOrEqual(4)
    expect(model!.turnBoundaries.length).toBe(1)
    const toolSpan = model!.spans.find(s => s.kind === 'tool')
    expect(toolSpan?.lane).toBe(2)
    const messageSpan = model!.spans.find(s => s.kind === 'message')
    expect(messageSpan?.lane).toBe(1)
  })

  it('drops cells without timestamps in timed modes', () => {
    const turns = layoutFor([
      msg({ role: 'user', content: 'a', turnId: 't1', timestamp: 1000 }),
      msg({ role: 'tool', toolName: 'Read', toolUseId: 'c1', toolResult: 'ok', turnId: 't1', timestamp: 2000 }),
    ])
    const model = deriveTrajectoryTimeline(turns, 'time')
    expect(model).not.toBeNull()
    expect(model!.spans.length).toBe(2)
  })

  it('resolves focus indexes inside a range', () => {
    const turns = layoutFor([
      msg({ role: 'user', content: 'a', turnId: 't1', timestamp: 1000 }),
      msg({ role: 'assistant', content: 'b', turnId: 't1', timestamp: 2000, requestSeq: 1, usage }),
    ])
    const model = deriveTrajectoryTimeline(turns, 'sequence')
    expect(model).not.toBeNull()
    const focused = trajectoryTimelineFocusIndexes(turns, { start: 0, end: 1 }, 'sequence')
    expect(focused.size).toBeGreaterThan(0)
  })
})
