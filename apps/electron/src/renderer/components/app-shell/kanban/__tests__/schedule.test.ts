import { describe, it, expect } from 'bun:test'
import { format } from 'date-fns'
import {
  getTaskSchedule,
  updateTaskSchedule,
  hasSchedule,
  isOverdue,
  deriveScheduledTaskRows,
  startOfDay,
} from '../schedule'
import type { SessionMeta } from '@/atoms/sessions'

function meta(overrides: Partial<SessionMeta>): SessionMeta {
  return {
    id: 's1',
    name: 'Task One',
    sessionStatus: 'todo',
    labels: [],
    createdAt: 0,
    isArchived: false,
    hidden: false,
    taskDraft: false,
    ...overrides,
  } as SessionMeta
}

describe('getTaskSchedule', () => {
  it('parses start and due from date label entries', () => {
    const s = getTaskSchedule(['start::2026-08-07', 'due::2026-08-10'])
    expect(s.start ? format(s.start, 'yyyy-MM-dd') : null).toBe('2026-08-07')
    expect(s.due ? format(s.due, 'yyyy-MM-dd') : null).toBe('2026-08-10')
  })

  it('tolerates missing labels and unrelated entries', () => {
    expect(getTaskSchedule(undefined)).toEqual({})
    expect(getTaskSchedule(['bug', 'priority::3'])).toEqual({})
  })

  it('ignores malformed dates', () => {
    expect(getTaskSchedule(['due::not-a-date'])).toEqual({})
    expect(getTaskSchedule(['start::2026-13-99'])).toEqual({})
  })

  it('parses boolean labels without values safely', () => {
    expect(getTaskSchedule(['start', 'due'])).toEqual({})
  })
})

describe('updateTaskSchedule', () => {
  it('sets dates while preserving other labels', () => {
    const next = updateTaskSchedule(['bug', 'priority::3'], {
      start: new Date('2026-08-07T00:00:00Z'),
      due: new Date('2026-08-10T00:00:00Z'),
    })
    expect(next).toEqual(['bug', 'priority::3', 'start::2026-08-07', 'due::2026-08-10'])
  })

  it('replaces existing schedule entries in place', () => {
    const next = updateTaskSchedule(['start::2026-01-01', 'due::2026-02-01'], { due: new Date('2026-03-01T00:00:00Z') })
    expect(next).toEqual(['start::2026-01-01', 'due::2026-03-01'])
  })

  it('clears a field with null and leaves it untouched with undefined', () => {
    expect(updateTaskSchedule(['start::2026-01-01'], { start: null })).toEqual([])
    expect(updateTaskSchedule(['start::2026-01-01'], {})).toEqual(['start::2026-01-01'])
  })

  it('works on undefined labels (fresh session)', () => {
    expect(updateTaskSchedule(undefined, { due: new Date('2026-08-10T00:00:00Z') })).toEqual(['due::2026-08-10'])
  })
})

describe('hasSchedule / isOverdue', () => {
  it('flags tasks with any schedule date', () => {
    expect(hasSchedule({})).toBe(false)
    expect(hasSchedule({ start: new Date() })).toBe(true)
    expect(hasSchedule({ due: new Date() })).toBe(true)
  })

  it('flags past due dates only for unfinished tasks', () => {
    const overdue = { due: new Date('2020-01-01T00:00:00Z') }
    expect(isOverdue(overdue, 'todo')).toBe(true)
    expect(isOverdue(overdue, 'in-progress')).toBe(true)
    expect(isOverdue(overdue, 'done')).toBe(false)
    expect(isOverdue({}, 'todo')).toBe(false)
  })

  it('does not flag due today', () => {
    const today = startOfDay(new Date())
    expect(isOverdue({ due: today }, 'todo')).toBe(false)
  })
})

describe('deriveScheduledTaskRows', () => {
  it('lists top-level tasks before their children', () => {
    const rows = deriveScheduledTaskRows([
      meta({ id: 'child', name: 'Child', parentSessionId: 'parent' }),
      meta({ id: 'parent', name: 'Parent' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['parent', 'child'])
    expect(rows[1].parentSessionId).toBe('parent')
  })

  it('skips archived, hidden, and draft tasks', () => {
    const rows = deriveScheduledTaskRows([
      meta({ id: 'arch', isArchived: true }),
      meta({ id: 'hidden', hidden: true }),
      meta({ id: 'draft', taskDraft: true }),
      meta({ id: 'ok' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['ok'])
  })

  it('sorts parents by start date then creation time', () => {
    const rows = deriveScheduledTaskRows([
      meta({ id: 'later', labels: ['start::2026-09-01'], createdAt: 1 }),
      meta({ id: 'earlier', labels: ['start::2026-08-01'], createdAt: 2 }),
      meta({ id: 'noDate', createdAt: 3 }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['earlier', 'later', 'noDate'])
  })

  it('carries schedule data onto rows', () => {
    const rows = deriveScheduledTaskRows([meta({ id: 's', labels: ['due::2026-08-10'], projectId: 'p1' })])
    expect(rows[0].schedule.due ? format(rows[0].schedule.due, 'yyyy-MM-dd') : null).toBe('2026-08-10')
    expect(rows[0].projectId).toBe('p1')
  })
})
