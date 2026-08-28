/**
 * CalendarView — aggregate schedule projection over WorkItems and standalone entries.
 *
 * Three view modes (Day / Week / Month) over one aggregate projection:
 * durable WorkItems with start/due dates plus lightweight standalone calendar
 * entries. Either kind can open or lazily create an execution conversation.
 *
 * Day/Week render entries inline (full info, no preview popup); Month uses
 * compact chips with an anchored day-list popover. Create/edit flows use the
 * shared full-page editor. Visual language follows the app: white cards, 1px
 * hairline borders, brand-purple accent, translucent accent color blocks.
 */

import * as React from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { Plus, Search } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  parseISO,
} from 'date-fns'
import { useAppShellContext } from '@/context/AppShellContext'
import { useCompensateForStoplight } from '@/context/StoplightContext'
import { routes, useNavigation } from '@/contexts/NavigationContext'
import { useCalendarEntries } from '@/hooks/useCalendarEntries'
import { useWorkItems } from '@/hooks/useWorkItems'
import { useWorkItemViewState } from '@/hooks/useWorkItemViewState'
import { projectsAtom } from '@/atoms/projects'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { CalendarEntry } from '@craft-agent/shared/protocol'
import { queryWorkItems, workItemDateKey, type WorkItem } from '@craft-agent/shared/work-items/browser'
import { KanbanProjectFilter, type KanbanProjectFilterOption } from './KanbanProjectFilter'
import { motionSpring, motionTween } from '@craft-agent/ui/motion'

type ViewMode = 'day' | 'week' | 'month'

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const MAX_TASKS_PER_CELL = 3

const HOUR_START = 8
const HOUR_END = 20
/** Minimum hour-row height in px — the time grid stretches beyond this to fill the panel. */
const HOUR_PX_MIN = 56
const TIME_GRID_MIN_HEIGHT = (HOUR_END - HOUR_START) * HOUR_PX_MIN

/**
 * Vertical position of an hour offset (relative to HOUR_START) as a
 * percentage of the time grid, so the grid stretches with the panel.
 */
function hourTop(hours: number): string {
  return `${(hours / (HOUR_END - HOUR_START)) * 100}%`
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Translucent accent block shared by both schedule sources. */
function entryBlock(alpha: number): string {
  return `color-mix(in srgb, var(--accent) ${Math.round(alpha * 100)}%, transparent)`
}

function nowMinutes(): number {
  const n = new Date()
  return n.getHours() * 60 + n.getMinutes()
}

function minutesFromTime(time?: string): number | null {
  if (!time) return null
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  return hour * 60 + minute
}

function overlapPosition(entry: CalendarProjection, entries: readonly CalendarProjection[]): { index: number; count: number } {
  const start = minutesFromTime(entry.time) ?? 0
  const end = minutesFromTime(entry.endTime) ?? start + 60
  const overlapping = entries.filter((candidate) => {
    const candidateStart = minutesFromTime(candidate.time) ?? 0
    const candidateEnd = minutesFromTime(candidate.endTime) ?? candidateStart + 60
    return candidateStart < end && candidateEnd > start
  })
  return { index: Math.max(0, overlapping.findIndex(({ id }) => id === entry.id)), count: Math.max(1, overlapping.length) }
}

interface CalendarProjection {
  id: string
  title: string
  date: string
  endDate: string
  time?: string
  endTime?: string
  allDay?: boolean
  note?: string
  projectId?: string
  entry?: CalendarEntry
  workItem?: WorkItem
}

export function CalendarView() {
  const { activeWorkspaceId, onCreateSession, trailingAction, expandButton } = useAppShellContext()
  const compensateForStoplight = useCompensateForStoplight()
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const { navigate, navigateToSession } = useNavigation()
  const { entries, update, remove } = useCalendarEntries(activeWorkspaceId ?? null)
  const { items: workItems, update: updateWorkItem } = useWorkItems(activeWorkspaceId ?? null)
  const projects = useAtomValue(projectsAtom)
  const projectOptions = React.useMemo<KanbanProjectFilterOption[]>(
    () => projects.map((project) => ({ id: project.config.id, name: project.config.name, color: project.config.color })),
    [projects],
  )
  const liveProjectIds = React.useMemo(() => projectOptions.map(({ id }) => id), [projectOptions])
  const {
    projectIds,
    setProjectIds,
    search,
    setSearch,
    setStatusIds,
    setScheduled,
    query,
    setSelectedIds,
  } = useWorkItemViewState(activeWorkspaceId ?? null, workItems, liveProjectIds)

  // Calendar always shows scheduled work. Clear legacy hidden filter values so
  // they cannot silently narrow this direct surface.
  React.useEffect(() => {
    setStatusIds([])
    setScheduled('all')
  }, [setScheduled, setStatusIds])
  const [view, setView] = React.useState<ViewMode>('month')
  const [cursor, setCursor] = React.useState(() => startOfMonth(new Date()))
  const [selectedDay, setSelectedDay] = React.useState<Date | null>(null)

  const today = new Date()

  // -------------------------------------------------------------------------
  // Entry helpers
  // -------------------------------------------------------------------------

  const calendarItems = React.useMemo<CalendarProjection[]>(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    const scheduledWorkItems = queryWorkItems(workItems, {
      ...query,
      statusIds: [],
      scheduled: 'scheduled',
    }).flatMap((item): CalendarProjection[] => {
      const start = workItemDateKey(item.startAt) ?? workItemDateKey(item.dueAt)
      const end = workItemDateKey(item.dueAt) ?? workItemDateKey(item.startAt)
      if (!start || !end) return []
      const time = item.startAt?.includes('T') ? item.startAt.slice(11, 16) : undefined
      return [{
        id: `work-item:${item.id}`,
        title: item.title,
        date: start,
        endDate: end,
        time,
        allDay: !time,
        note: item.description,
        projectId: item.projectId,
        workItem: item,
      }]
    })
    const standalone = entries
      .filter((entry) => !projectIds.length || Boolean(entry.projectId && projectIds.includes(entry.projectId)))
      .filter((entry) => !normalizedSearch || `${entry.title}\n${entry.note ?? ''}`.toLocaleLowerCase().includes(normalizedSearch))
      .map((entry): CalendarProjection => ({
        id: `entry:${entry.id}`,
        title: entry.title,
        date: entry.date,
        endDate: entry.date,
        time: entry.time,
        endTime: entry.endTime,
        allDay: entry.allDay ?? !entry.time,
        note: entry.note,
        projectId: entry.projectId,
        entry,
      }))
    return [...scheduledWorkItems, ...standalone].sort((left, right) =>
      left.date.localeCompare(right.date) || (left.time ?? '').localeCompare(right.time ?? '') || left.title.localeCompare(right.title),
    )
  }, [entries, projectIds, query, search, workItems])

  const entriesFor = React.useCallback(
    (day: Date): CalendarProjection[] => {
      const key = dayKey(day)
      return calendarItems.filter((entry) => entry.date <= key && entry.endDate >= key)
    },
    [calendarItems],
  )

  const openCreate = React.useCallback((date: Date) => {
    navigate(routes.view.projectSchedule(`new:${dayKey(date)}`))
  }, [navigate])

  const openCreateAt = React.useCallback((date: Date, event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('[data-calendar-entry]')) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    const rawMinutes = HOUR_START * 60 + ratio * (HOUR_END - HOUR_START) * 60
    const snapped = Math.round(rawMinutes / 30) * 30
    const hour = Math.min(HOUR_END - 1, Math.floor(snapped / 60))
    const minute = snapped % 60
    navigate(routes.view.projectSchedule(`new:${dayKey(date)}@${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`))
  }, [navigate])

  const moveProjection = React.useCallback(async (projectionId: string, date: Date, time?: string) => {
    const projection = calendarItems.find(({ id }) => id === projectionId)
    if (!projection) return
    const nextDate = dayKey(date)
    if (projection.entry) {
      const entry = projection.entry
      await update(entry.id, {
        title: entry.title,
        date: nextDate,
        allDay: time === undefined ? (entry.allDay ?? !entry.time) : false,
        time: time ?? entry.time,
        endTime: entry.endTime,
        note: entry.note,
        projectId: entry.projectId,
      })
      return
    }
    if (!projection.workItem) return
    const item = projection.workItem
    const oldStart = workItemDateKey(item.startAt) ?? workItemDateKey(item.dueAt) ?? nextDate
    const oldEnd = workItemDateKey(item.dueAt) ?? oldStart
    const span = differenceInCalendarDays(parseISO(oldEnd), parseISO(oldStart))
    const startAt = time ? `${nextDate}T${time}` : nextDate
    const dueAt = dayKey(addDays(parseISO(nextDate), span))
    await updateWorkItem(item.id, { startAt, dueAt })
  }, [calendarItems, update, updateWorkItem])

  const dropAt = React.useCallback((date: Date, event: React.DragEvent<HTMLElement>, timed: boolean) => {
    event.preventDefault()
    const projectionId = event.dataTransfer.getData('text/plain')
    let time: string | undefined
    if (timed) {
      const rect = event.currentTarget.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
      const rawMinutes = HOUR_START * 60 + ratio * (HOUR_END - HOUR_START) * 60
      const snapped = Math.round(rawMinutes / 30) * 30
      time = `${String(Math.min(HOUR_END - 1, Math.floor(snapped / 60))).padStart(2, '0')}:${String(snapped % 60).padStart(2, '0')}`
    }
    void moveProjection(projectionId, date, time)
  }, [moveProjection])

  const startResize = React.useCallback((projection: CalendarProjection, event: React.PointerEvent<HTMLElement>) => {
    const entry = projection.entry
    const startMinutes = minutesFromTime(entry?.time)
    if (!entry || startMinutes === null) return
    event.preventDefault()
    event.stopPropagation()
    const grid = event.currentTarget.closest<HTMLElement>('[data-time-grid]')
    if (!grid) return
    const startY = event.clientY
    const initialEnd = minutesFromTime(entry.endTime) ?? startMinutes + 60
    let nextEnd = initialEnd
    const move = (pointerEvent: PointerEvent) => {
      const deltaMinutes = ((pointerEvent.clientY - startY) / grid.getBoundingClientRect().height) * (HOUR_END - HOUR_START) * 60
      nextEnd = Math.max(startMinutes + 30, Math.min(HOUR_END * 60, Math.round((initialEnd + deltaMinutes) / 30) * 30))
    }
    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      const endTime = `${String(Math.floor(nextEnd / 60)).padStart(2, '0')}:${String(nextEnd % 60).padStart(2, '0')}`
      void update(entry.id, { ...entry, endTime })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
  }, [update])

  const openEdit = React.useCallback((projection: CalendarProjection) => {
    if (projection.workItem) {
      setSelectedIds([projection.workItem.id])
      navigate(routes.view.projectWorkItem('calendar', projection.workItem.id))
      return
    }
    const entry = projection.entry
    if (!entry) return
    navigate(routes.view.projectSchedule(entry.id))
  }, [navigate, setSelectedIds])

  const handleDelete = React.useCallback(
    (projection: CalendarProjection) => {
      if (projection.entry) void remove(projection.entry.id)
    },
    [remove],
  )

  const createConversation = React.useCallback(
    async (projection: CalendarProjection) => {
      if (!activeWorkspaceId) return
      try {
        if (projection.workItem?.primarySessionId) {
          navigateToSession(projection.workItem.primarySessionId)
          return
        }
        const session = await onCreateSession(activeWorkspaceId, {
          name: projection.title,
          ...(projection.projectId ? { projectId: projection.projectId } : {}),
        })
        if (projection.workItem) {
          const linked = await updateWorkItem(projection.workItem.id, {
            sessionIds: [...projection.workItem.sessionIds, session.id],
            primarySessionId: session.id,
          })
          if (!linked) {
            toast.error(t('kanban.workItemLinkFailed'))
            return
          }
        }
        if (session?.id) navigateToSession(session.id)
      } catch (err) {
        console.error('[CalendarView] Failed to create conversation:', err)
      }
    },
    [activeWorkspaceId, onCreateSession, navigateToSession, t, updateWorkItem],
  )

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  const goPrev = React.useCallback(() => {
    setCursor((prev) => {
      if (view === 'day') return new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 1)
      if (view === 'week') return new Date(prev.getTime() - 7 * 86_400_000)
      return new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
    })
  }, [view])

  const goNext = React.useCallback(() => {
    setCursor((prev) => {
      if (view === 'day') return new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1)
      if (view === 'week') return new Date(prev.getTime() + 7 * 86_400_000)
      return new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
    })
  }, [view])

  const goToday = React.useCallback(() => {
    setCursor(new Date())
  }, [])

  const switchView = React.useCallback((next: ViewMode) => {
    setView(next)
    // Day/week views open on today so the current schedule is in view.
    if (next !== 'month') setCursor(new Date())
  }, [])

  const title = React.useMemo(() => {
    if (view === 'day') return format(cursor, 'yyyy年M月d日')
    if (view === 'week') return format(cursor, 'yyyy年M月')
    return format(cursor, 'yyyy年M月')
  }, [view, cursor])

  // -------------------------------------------------------------------------
  // Shared card chrome
  // -------------------------------------------------------------------------

  const entryActions = (entry: CalendarProjection, compact?: boolean) => (
    <div className={cn('flex flex-none items-center gap-1', compact && 'flex-col gap-1')}>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-[11px] font-semibold"
        onClick={(e) => {
          e.stopPropagation()
          void createConversation(entry)
        }}
      >
        {entry.workItem?.primarySessionId ? t('kanban.workItemOpenSession') : t('schedule.createChat')}
      </Button>
      {entry.entry && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px] font-semibold text-destructive hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation()
            handleDelete(entry)
          }}
        >
          {t('schedule.delete')}
        </Button>
      )}
    </div>
  )

  const entryBlockStyle = (alpha: number): React.CSSProperties => ({ backgroundColor: entryBlock(alpha) })
  const draggableEntryProps = (entry: CalendarProjection) => ({
    'data-calendar-entry': true,
    draggable: true,
    onDragStart: (event: React.DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', entry.id)
    },
  })

  // -------------------------------------------------------------------------
  // Day view
  // -------------------------------------------------------------------------

  const renderDay = () => {
    const day = cursor
    const key = dayKey(day)
    const dayEntries = entriesFor(day)
    const timed = dayEntries.filter((entry) => entry.date === key && entry.time)
    const allDay = dayEntries.filter((entry) => entry.date !== key || !entry.time)
    const now = nowMinutes()

    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="px-4 pb-2">
          <div className="text-[15px] font-semibold">{format(day, 'EEEE')}</div>
        </div>

        {/* All-day strip */}
        <div className="flex flex-col gap-1.5 border-b border-border/60 px-4 pb-2" onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropAt(day, event, false)}>
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-foreground/45">
            {t('schedule.allDay')}
          </div>
          {allDay.length === 0 && (
            <div className="text-xs text-foreground/45">{t('schedule.noAllDay')}</div>
          )}
          {allDay.map((entry) => (
            <div
              key={entry.id}
              className="group flex items-center gap-2.5 rounded-lg border border-accent/10 px-2.5 py-2 shadow-minimal transition-[border-color,transform] hover:border-accent/25 active:scale-[0.998]"
              style={entryBlockStyle(0.16)}
              onClick={() => openEdit(entry)}
              {...draggableEntryProps(entry)}
            >
              <span className="w-[76px] flex-none text-[11px] font-bold tabular-nums opacity-80">
                {t('schedule.allDay')}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{entry.title}</span>
              {entry.note && (
                <span className="min-w-0 flex-[1.2] truncate text-xs opacity-70">{entry.note}</span>
              )}
              {entryActions(entry)}
            </div>
          ))}
        </div>

        {/* Time grid */}
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex" style={{ minHeight: `max(100%, ${TIME_GRID_MIN_HEIGHT}px)` }}>
            <div className="relative w-[52px] flex-none">
              {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => {
                const h = HOUR_START + i
                return (
                  <div
                    key={h}
                    className="absolute right-2 -translate-y-1/2 text-[10.5px] tabular-nums text-foreground/45"
                    style={{ top: h === HOUR_START ? 14 : hourTop(h - HOUR_START) }}
                  >
                    {String(h).padStart(2, '0')}:00
                  </div>
                )
              })}
            </div>
            <div data-time-grid className="relative flex-1 border-l border-border/60" onDoubleClick={(event) => openCreateAt(day, event)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropAt(day, event, true)}>
              {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => {
                const h = HOUR_START + i
                return (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-border/60"
                    style={{ top: hourTop(h - HOUR_START) }}
                  />
                )
              })}
              {/* Now line */}
              {now >= HOUR_START * 60 && now <= HOUR_END * 60 && (
                <div
                  className="absolute inset-x-0 z-[5] border-t-2 border-destructive"
                  style={{ top: hourTop((now - HOUR_START * 60) / 60) }}
                />
              )}
              {timed.map((entry) => {
                const [hh, mm] = entry.time!.split(':').map(Number)
                const top = hourTop(hh + mm / 60 - HOUR_START)
                const startMinutes = hh * 60 + mm
                const endMinutes = minutesFromTime(entry.endTime) ?? startMinutes + 60
                const duration = Math.max(30, endMinutes - startMinutes)
                const overlap = overlapPosition(entry, timed)
                return (
                  <div
                    key={entry.id}
                    className="group absolute flex items-center gap-2.5 overflow-hidden rounded-lg border border-accent/10 px-2.5 py-1.5 shadow-minimal transition-[border-color,transform] hover:border-accent/25 active:scale-[0.998]"
                    style={{ top, left: `calc(${(overlap.index / overlap.count) * 100}% + 6px)`, width: `calc(${100 / overlap.count}% - 12px)`, height: `${(duration / 60 / (HOUR_END - HOUR_START)) * 100}%`, minHeight: 30, ...entryBlockStyle(0.22) }}
                    onClick={() => openEdit(entry)}
                    {...draggableEntryProps(entry)}
                  >
                    <span className="w-[76px] flex-none text-[11px] font-bold tabular-nums opacity-80">
                      {entry.time}–{entry.endTime ?? `${String((hh + 1) % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold">{entry.title}</span>
                      {entry.note && (
                        <span className="block truncate text-[11px] opacity-70">{entry.note}</span>
                      )}
                    </span>
                    {entryActions(entry)}
                    {entry.entry && <div className="absolute inset-x-2 bottom-0 h-1.5 cursor-ns-resize" onPointerDown={(event) => startResize(entry, event)} />}
                  </div>
                )
              })}
              {timed.length === 0 && (
                <div className="absolute left-2 top-2 text-xs text-foreground/45">
                  {t('schedule.noTimed')}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Week view
  // -------------------------------------------------------------------------

  const renderWeek = () => {
    const monday = startOfWeek(cursor, { weekStartsOn: 1 })
    const now = nowMinutes()
    return (
      <div className="flex h-full min-h-0 flex-col">
        {/* Header row */}
        <div className="flex flex-none">
          <div className="w-[52px] flex-none border-r border-border/60" />
          {Array.from({ length: 7 }, (_, i) => {
            const d = addDays(monday, i)
            const isToday = isSameDay(d, today)
            return (
              <div key={i} className="flex min-w-0 flex-1 items-baseline justify-center gap-1.5 border-r border-border/60 py-1.5 last:border-r-0">
                <span className="text-[10.5px] font-bold text-foreground/55">{t(`schedule.weekday.${WEEKDAY_KEYS[i]}`)}</span>
                <span
                  className={cn(
                    'text-sm font-semibold',
                    isToday && 'inline-flex h-[25px] w-[25px] items-center justify-center rounded-full bg-accent text-accent-foreground',
                  )}
                >
                  {d.getDate()}
                </span>
              </div>
            )
          })}
        </div>
        {/* All-day row */}
        <div className="flex flex-none border-b border-border/60">
          <div className="w-[52px] flex-none border-r border-border/60" />
          {Array.from({ length: 7 }, (_, i) => {
            const d = addDays(monday, i)
            const key = dayKey(d)
            const allDay = entriesFor(d).filter((entry) => entry.date !== key || !entry.time)
            return (
              <div
                key={i}
                className="min-w-0 flex-1 border-r border-border/60 p-1 last:border-r-0"
                onDoubleClick={(event) => {
                  if ((event.target as HTMLElement).closest('[data-calendar-entry]')) return
                  openCreate(d)
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropAt(d, event, false)}
              >
                {allDay.map((entry) => (
                  <div
                    key={entry.id}
                    className="mb-1 flex items-center gap-1 overflow-hidden rounded-md border border-accent/10 px-1.5 py-1 text-[11.5px] font-medium transition-colors hover:border-accent/25"
                    style={entryBlockStyle(0.2)}
                    title={entry.title}
                    onClick={() => openEdit(entry)}
                    {...draggableEntryProps(entry)}
                  >
                    <span className="truncate">{entry.title}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
        {/* Time grid with shared scroll (scale column scrolls with the grid) */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex" style={{ minHeight: `max(100%, ${TIME_GRID_MIN_HEIGHT}px)` }}>
            <div className="relative w-[52px] flex-none border-r border-border/60">
              {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => {
                const h = HOUR_START + i
                return (
                  <div
                    key={h}
                    className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-foreground/45"
                    style={{ top: h === HOUR_START ? 10 : hourTop(h - HOUR_START) }}
                  >
                    {String(h).padStart(2, '0')}:00
                  </div>
                )
              })}
            </div>
            {Array.from({ length: 7 }, (_, i) => {
              const d = addDays(monday, i)
              return (
                <div key={i} data-time-grid className="relative min-w-0 flex-1 border-r border-border/60 last:border-r-0" onDoubleClick={(event) => openCreateAt(d, event)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropAt(d, event, true)}>
                  {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, j) => {
                    const h = HOUR_START + j
                    return (
                      <div
                        key={h}
                        className="absolute inset-x-0 border-t border-border/60"
                        style={{ top: hourTop(h - HOUR_START) }}
                      />
                    )
                  })}
                  {isSameDay(d, today) && now >= HOUR_START * 60 && now <= HOUR_END * 60 && (
                    <div
                      className="absolute inset-x-0 z-[5] border-t-2 border-destructive"
                      style={{ top: hourTop((now - HOUR_START * 60) / 60) }}
                    />
                  )}
                  {(() => {
                    const timedEntries = entriesFor(d).filter((entry) => entry.date === dayKey(d) && entry.time)
                    return timedEntries
                    .map((entry) => {
                      const [hh, mm] = entry.time!.split(':').map(Number)
                      const startMinutes = hh * 60 + mm
                      const endMinutes = minutesFromTime(entry.endTime) ?? startMinutes + 60
                      const duration = Math.max(30, endMinutes - startMinutes)
                      const overlap = overlapPosition(entry, timedEntries)
                      return (
                        <div
                          key={entry.id}
                          className="absolute overflow-hidden rounded-md border border-accent/10 px-1.5 py-0.5 shadow-minimal transition-colors hover:border-accent/25"
                          style={{
                            top: hourTop(hh + mm / 60 - HOUR_START),
                            left: `calc(${(overlap.index / overlap.count) * 100}% + 3px)`,
                            width: `calc(${100 / overlap.count}% - 6px)`,
                            height: `${(duration / 60 / (HOUR_END - HOUR_START)) * 100}%`,
                            minHeight: 28,
                            ...entryBlockStyle(0.22),
                          }}
                          title={entry.title}
                          onClick={() => openEdit(entry)}
                          {...draggableEntryProps(entry)}
                        >
                          <span className="block truncate text-[11.5px] font-semibold">
                            {entry.time} · {entry.title}
                          </span>
                          {entry.entry && <div className="absolute inset-x-1 bottom-0 h-1.5 cursor-ns-resize" onPointerDown={(event) => startResize(entry, event)} />}
                        </div>
                      )
                    })
                  })()}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Month view
  // -------------------------------------------------------------------------

  const renderMonth = () => {
    const gridStart = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1), { weekStartsOn: 1 })
    return (
      <div className="grid h-full min-h-0 flex-1 grid-cols-[repeat(7,minmax(0,1fr))] grid-rows-[auto_repeat(6,minmax(0,1fr))] gap-px overflow-hidden rounded-lg border border-border/80 bg-border/60">
        {WEEKDAY_KEYS.map((key) => (
          <div key={key} className="bg-card px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
            {t(`schedule.weekday.${key}`)}
          </div>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const day = addDays(gridStart, i)
          const inMonth = isSameMonth(day, cursor)
          const isToday = isSameDay(day, today)
          const dayEntries = entriesFor(day)
          const visible = dayEntries.slice(0, MAX_TASKS_PER_CELL)
          const overflow = dayEntries.length - visible.length
          return (
            <div
              key={dayKey(day)}
              className={cn(
                'group flex min-h-0 flex-col gap-1 overflow-hidden bg-card p-1.5 transition-colors hover:bg-foreground/[0.018]',
                !inMonth && 'bg-card/60',
                isToday && 'bg-accent/10',
              )}
              onDoubleClick={(event) => {
                if ((event.target as HTMLElement).closest('[data-calendar-entry]')) return
                openCreate(day)
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropAt(day, event, false)}
            >
              <div className="flex items-center justify-between">
                <Popover
                  open={selectedDay !== null && isSameDay(selectedDay, day)}
                  onOpenChange={(open) => setSelectedDay(open ? day : null)}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setSelectedDay(day)}
                      className={cn(
                        'inline-flex h-6 w-6 items-center justify-center rounded-full text-[13.5px] font-semibold transition-colors hover:bg-foreground/[0.08]',
                        isToday ? 'bg-accent text-accent-foreground' : inMonth ? 'text-foreground/85' : 'text-foreground/30',
                      )}
                    >
                      {day.getDate()}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0" align="start">
                    <div className="border-b border-border/60 px-3 py-2 text-xs font-semibold">
                      {format(day, 'yyyy-MM-dd')}
                      <span className="ml-1.5 text-[11px] font-medium text-foreground/45">
                        · {dayEntries.length} {t('schedule.taskCount', { count: dayEntries.length })}
                      </span>
                    </div>
                    {dayEntries.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-foreground/45">{t('schedule.noTasks')}</div>
                    ) : (
                      <ScrollArea className="max-h-64">
                        <div className="flex flex-col gap-0.5 p-1.5">
                          {dayEntries.map((entry) => (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={() => {
                                setSelectedDay(null)
                                openEdit(entry)
                              }}
                              className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.06]"
                              style={entryBlockStyle(0.14)}
                            >
                              <span className="min-w-0 flex-1 truncate font-medium">{entry.title}</span>
                              {entry.time && (
                                <span className="flex-none text-[10px] tabular-nums opacity-70">{entry.time}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </PopoverContent>
                </Popover>
                <button
                  type="button"
                  aria-label={t('schedule.newEntry')}
                  onClick={() => openCreate(day)}
                  className="hidden h-5 w-5 items-center justify-center rounded-md border border-border bg-card text-foreground/55 transition-colors hover:border-border-strong hover:text-foreground group-hover:inline-flex"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              {visible.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-1 overflow-hidden rounded-md border border-accent/10 px-1.5 py-0.5 text-[12.5px] leading-[1.4] shadow-minimal transition-[border-color,transform] hover:border-accent/25 active:scale-[0.99]"
                  style={entryBlockStyle(0.16)}
                  title={entry.title}
                  onClick={() => openEdit(entry)}
                  {...draggableEntryProps(entry)}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{entry.title}</span>
                  {entry.time && <span className="flex-none text-[10px] font-semibold opacity-70">{entry.time}</span>}
                </div>
              ))}
              {overflow > 0 && (
                <span className="px-1 text-[11px] font-medium text-foreground/45">
                  +{overflow} {t('schedule.more')}
                </span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Shell
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header paddings adapt at the window edge (focused mode / fullscreen
          overlay): left reserves macOS traffic lights, right reserves the
          floating restore button of the expanded overlay. */}
      <div
        className="grid h-12 flex-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-border/50 bg-background/80 backdrop-blur-sm @max-[760px]/panel:grid-cols-[auto_minmax(0,1fr)]"
        style={{
          paddingLeft: compensateForStoplight ? 84 : 16,
          paddingRight: compensateForStoplight ? 48 : 16,
        }}
      >
        <div className="flex min-w-0 items-center gap-2 overflow-hidden @max-[760px]/panel:hidden">
          {projectOptions.length > 0 && (
            <KanbanProjectFilter projects={projectOptions} value={projectIds} onChange={setProjectIds} />
          )}
          <label className="relative hidden min-w-32 @min-[980px]/panel:block @min-[980px]/panel:w-44">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/35" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('kanban.workItemSearch')}
              className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-2 text-xs outline-none focus:border-ring/60"
            />
          </label>
        </div>
        <div className="flex shrink-0 items-center justify-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            aria-label={t('schedule.prevMonth')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/80 text-foreground/55 transition-colors hover:text-foreground"
          >
            ‹
          </button>
          <span className="text-sm font-semibold">{title}</span>
          <button
            type="button"
            onClick={goNext}
            aria-label={t('schedule.nextMonth')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/80 text-foreground/55 transition-colors hover:text-foreground"
          >
            ›
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-md border border-border/80 px-2.5 py-1 text-xs font-medium text-foreground/70 transition-colors hover:text-foreground @max-[560px]/panel:hidden"
          >
            {t('common.today')}
          </button>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2 @max-[760px]/panel:col-start-2">
          <LayoutGroup id="calendar-view-mode">
          <div className="inline-flex items-center gap-0.5 rounded-xl border border-border/65 bg-foreground/[0.025] p-0.5 shadow-minimal">
            {(['day', 'week', 'month'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => switchView(mode)}
                aria-pressed={view === mode}
                className={cn(
                  'relative isolate rounded-lg px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  view === mode ? 'text-foreground' : 'text-foreground/50 hover:text-foreground/80',
                )}
              >
                {view === mode && (
                  <motion.span
                    layoutId="calendar-active-mode"
                    className="absolute inset-0 -z-10 rounded-lg border border-border/55 bg-card shadow-minimal"
                    transition={motionSpring(reduceMotion, 'responsive')}
                  />
                )}
                <span className="relative">{t(`schedule.view.${mode}`)}</span>
              </button>
            ))}
          </div>
          </LayoutGroup>
          <Button
            variant="outline"
            className="h-8 gap-1.5 border-border/80 bg-card px-2.5 text-[12.5px] font-semibold"
            onClick={() => openCreate(cursor)}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            <span className="@max-[940px]/panel:hidden">{t('schedule.newEntry')}</span>
          </Button>
          {/* Surface-injected close + fullscreen controls. */}
          {trailingAction}
          {expandButton}
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-foreground/[0.012] p-2 @min-[800px]/panel:p-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            className="h-full min-h-0"
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
            transition={motionTween(reduceMotion, 'standard', 'enter')}
          >
            {view === 'day' && renderDay()}
            {view === 'week' && renderWeek()}
            {view === 'month' && renderMonth()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
