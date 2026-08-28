import { describe, expect, it } from 'bun:test'
import { computeProfileActivity } from './profile-activity'

const atNoon = (date: string) => new Date(`${date}T12:00:00`).getTime()

describe('computeProfileActivity', () => {
  it('aggregates visible sessions and token usage', () => {
    const result = computeProfileActivity([
      { createdAt: atNoon('2026-08-20'), tokenUsage: { totalTokens: 100 } },
      { createdAt: atNoon('2026-08-21'), tokenUsage: { totalTokens: 300 } },
      { createdAt: atNoon('2026-08-21'), tokenUsage: { totalTokens: 200 } },
      { createdAt: atNoon('2026-08-22'), hidden: true, tokenUsage: { totalTokens: 999 } },
    ], new Date('2026-08-25T12:00:00'))

    expect(result.totalSessions).toBe(3)
    expect(result.totalTokens).toBe(600)
    expect(result.activeDays).toBe(2)
    expect(result.longestStreak).toBe(2)
    expect(result.averageTokens).toBe(200)
    expect(result.peakSessionTokens).toBe(300)
  })

  it('uses the latest meaningful timestamp and returns an aligned calendar', () => {
    const result = computeProfileActivity([{
      createdAt: atNoon('2026-01-01'),
      lastUsedAt: atNoon('2026-08-24'),
      lastMessageAt: atNoon('2026-08-25'),
    }], new Date('2026-08-25T12:00:00'))

    expect(result.activeDays).toBe(1)
    expect(result.calendar[0].date.getDay()).toBe(0)
    expect(result.calendar).toHaveLength(371)
    expect(result.calendar.find(day => day.key === '2026-08-25')?.count).toBe(1)
    expect(result.calendar.at(-1)?.date.getDay()).toBe(6)
    expect(result.calendar.at(-1)?.isFuture).toBe(true)
  })

  it('returns zero-value insights for an empty profile', () => {
    const result = computeProfileActivity([], new Date('2026-08-25T12:00:00'))
    expect(result.totalSessions).toBe(0)
    expect(result.busiestWeekday).toBeNull()
    expect(result.longestStreak).toBe(0)
    expect(result.calendar.every(day => day.level === 0)).toBe(true)
  })
})
