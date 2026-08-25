export interface ProfileActivitySession {
  createdAt?: number
  lastUsedAt?: number
  lastMessageAt?: number
  hidden?: boolean
  tokenUsage?: { totalTokens: number }
}

export interface ProfileActivityDay {
  date: Date
  key: string
  count: number
  level: 0 | 1 | 2 | 3 | 4
}

export interface ProfileActivityStats {
  totalSessions: number
  totalTokens: number
  activeDays: number
  longestStreak: number
  averageTokens: number
  peakSessionTokens: number
  busiestWeekday: number | null
  calendar: ProfileActivityDay[]
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function keyToEpochDay(key: string): number {
  const [year, month, day] = key.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

function sessionTimestamp(session: ProfileActivitySession): number | null {
  return session.lastMessageAt ?? session.lastUsedAt ?? session.createdAt ?? null
}

function activityLevel(count: number, maxCount: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0 || maxCount === 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((count / maxCount) * 4))) as 1 | 2 | 3 | 4
}

export function computeProfileActivity(
  allSessions: ProfileActivitySession[],
  now = new Date(),
): ProfileActivityStats {
  const sessions = allSessions.filter(session => !session.hidden)
  const activityCounts = new Map<string, number>()
  const weekdayCounts = Array.from({ length: 7 }, () => 0)
  let totalTokens = 0
  let peakSessionTokens = 0

  for (const session of sessions) {
    const timestamp = sessionTimestamp(session)
    if (timestamp !== null) {
      const activityDate = new Date(timestamp)
      const key = dateKey(activityDate)
      activityCounts.set(key, (activityCounts.get(key) ?? 0) + 1)
      weekdayCounts[activityDate.getDay()] += 1
    }

    const tokens = Math.max(0, session.tokenUsage?.totalTokens ?? 0)
    totalTokens += tokens
    peakSessionTokens = Math.max(peakSessionTokens, tokens)
  }

  const activeEpochDays = [...activityCounts.keys()].map(keyToEpochDay).sort((a, b) => a - b)
  let longestStreak = 0
  let currentStreak = 0
  let previousDay: number | null = null
  for (const day of activeEpochDays) {
    currentStreak = previousDay !== null && day === previousDay + 1 ? currentStreak + 1 : 1
    longestStreak = Math.max(longestStreak, currentStreak)
    previousDay = day
  }

  const maxWeekdayCount = Math.max(...weekdayCounts)
  const busiestWeekday = maxWeekdayCount > 0 ? weekdayCounts.indexOf(maxWeekdayCount) : null

  const end = startOfLocalDay(now)
  const start = new Date(end)
  start.setDate(start.getDate() - 363)
  start.setDate(start.getDate() - start.getDay())

  const calendarCounts: number[] = []
  const calendarDates: Date[] = []
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = new Date(cursor)
    calendarDates.push(date)
    calendarCounts.push(activityCounts.get(dateKey(date)) ?? 0)
  }
  const maxCalendarCount = Math.max(0, ...calendarCounts)
  const calendar = calendarDates.map((date, index) => ({
    date,
    key: dateKey(date),
    count: calendarCounts[index],
    level: activityLevel(calendarCounts[index], maxCalendarCount),
  }))

  return {
    totalSessions: sessions.length,
    totalTokens,
    activeDays: activityCounts.size,
    longestStreak,
    averageTokens: sessions.length > 0 ? Math.round(totalTokens / sessions.length) : 0,
    peakSessionTokens,
    busiestWeekday,
    calendar,
  }
}
