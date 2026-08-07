import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listCalendarEntries,
  createCalendarEntry,
  updateCalendarEntry,
  deleteCalendarEntry,
} from '../storage'

let roots: string[] = []

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'calendar-test-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('calendar entries storage', () => {
  it('starts empty when no file exists', () => {
    expect(listCalendarEntries(freshRoot())).toEqual([])
  })

  it('roundtrips create → list → update → delete', () => {
    const root = freshRoot()
    const created = createCalendarEntry(root, { title: '团队周会', date: '2026-08-06', time: '10:00', note: '同步进展' })
    expect(created.id).toBeTruthy()
    expect(created.title).toBe('团队周会')

    const listed = listCalendarEntries(root)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ title: '团队周会', date: '2026-08-06', time: '10:00', note: '同步进展' })

    const updated = updateCalendarEntry(root, created.id, { title: '团队周会（改期）', date: '2026-08-07', time: '14:00' })
    expect(updated.title).toBe('团队周会（改期）')
    expect(updated.date).toBe('2026-08-07')
    expect(updated.time).toBe('14:00')
    // note cleared when omitted
    expect(updated.note).toBeUndefined()
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)

    deleteCalendarEntry(root, created.id)
    expect(listCalendarEntries(root)).toEqual([])
  })

  it('trims optional fields and normalizes empty strings away', () => {
    const root = freshRoot()
    const entry = createCalendarEntry(root, { title: '  发布窗口  ', date: '2026-08-05', time: '  ', note: '  ' })
    expect(entry.title).toBe('发布窗口')
    expect(entry.time).toBeUndefined()
    expect(entry.note).toBeUndefined()
  })

  it('persists to calendar/entries.json', () => {
    const root = freshRoot()
    createCalendarEntry(root, { title: '部署', date: '2026-08-05' })
    const file = join(root, 'calendar', 'entries.json')
    expect(existsSync(file)).toBe(true)
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    expect(parsed.version).toBe(1)
    expect(parsed.entries).toHaveLength(1)
  })

  it('update of a missing entry throws', () => {
    expect(() => updateCalendarEntry(freshRoot(), 'nope', { title: 'x', date: '2026-08-05' })).toThrow(
      'Calendar entry not found',
    )
  })

  it('delete of a missing entry is a no-op', () => {
    const root = freshRoot()
    deleteCalendarEntry(root, 'nope')
    expect(listCalendarEntries(root)).toEqual([])
  })

  it('tolerates a corrupt file', () => {
    const root = freshRoot()
    const { mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs')
    mkdirSync(join(root, 'calendar'), { recursive: true })
    writeFileSync(join(root, 'calendar', 'entries.json'), 'not json', 'utf-8')
    expect(listCalendarEntries(root)).toEqual([])
  })
})
