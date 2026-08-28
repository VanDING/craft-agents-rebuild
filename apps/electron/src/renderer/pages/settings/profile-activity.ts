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
  isFuture: boolean
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

function activityThresholds(counts: number[]): number[] {
  const nonZero = counts.filter(count => count > 0).sort((a, b) => a - b)
  if (nonZero.length === 0) return []
  return [0.25, 0.5, 0.75].map(quantile => nonZero[Math.floor((nonZero.length - 1) * quantile)])
}

function activityLevel(count: number, thresholds: number[]): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0
  return (1 + thresholds.filter(threshold => count > threshold).length) as 1 | 2 | 3 | 4
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

  const today = startOfLocalDay(now)
  const start = new Date(today)
  start.setDate(start.getDate() - start.getDay() - (52 * 7))
  const end = new Date(start)
  end.setDate(end.getDate() + (53 * 7) - 1)

  const calendarCounts: number[] = []
  const calendarDates: Date[] = []
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = new Date(cursor)
    calendarDates.push(date)
    calendarCounts.push(activityCounts.get(dateKey(date)) ?? 0)
  }
  const thresholds = activityThresholds(calendarCounts)
  const calendar = calendarDates.map((date, index) => ({
    date,
    key: dateKey(date),
    count: calendarCounts[index],
    level: activityLevel(calendarCounts[index], thresholds),
    isFuture: date > today,
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
