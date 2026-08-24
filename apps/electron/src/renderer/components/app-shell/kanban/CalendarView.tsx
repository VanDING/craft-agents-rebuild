/**
 * CalendarView — aggregate schedule projection over WorkItems and standalone entries.
 *
 * Three view modes (Day / Week / Month) over one aggregate projection:
 * durable WorkItems with start/due dates plus lightweight standalone calendar
 * entries. Either kind can open or lazily create an execution conversation.
 *
 * Day/Week render entries inline (full info, no preview popup); Month uses
 * compact chips with an anchored day-list popover. The create/edit dialog is
 * centered. Visual language follows the app: white cards, 1px hairline
 * borders, brand-purple accent, translucent accent color blocks.
 */

import * as React from 'react'
import { Plus, Search } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import {
  addDays,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { useAppShellContext } from '@/context/AppShellContext'
import { useCompensateForStoplight } from '@/context/StoplightContext'
import { routes, useNavigation } from '@/contexts/NavigationContext'
import { useCalendarEntries } from '@/hooks/useCalendarEntries'
import { useWorkItems } from '@/hooks/useWorkItems'
import { useWorkItemViewState } from '@/hooks/useWorkItemViewState'
import { projectsAtom } from '@/atoms/projects'
import { workItemDetailIdAtom } from '@/atoms/kanban'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { CalendarEntry, CalendarEntryInput } from '@craft-agent/shared/protocol'
import { queryWorkItems, workItemDateKey, type WorkItem } from '@craft-agent/shared/work-items/browser'
import { ProjectManagementViewTabs } from '../../projects/ProjectManagementViewTabs'
import { WorkItemViewControls } from '../../projects/WorkItemViewControls'
import { KanbanProjectFilter, type KanbanProjectFilterOption } from './KanbanProjectFilter'

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

interface EntryFormState {
  id?: string
  title: string
  date: string
  time: string
  note: string
  projectId: string
}

interface CalendarProjection {
  id: string
  title: string
  date: string
  endDate: string
  time?: string
  note?: string
  projectId?: string
  entry?: CalendarEntry
  workItem?: WorkItem
}

export function CalendarView() {
  const { activeWorkspaceId, sessionStatuses, onCreateSession, trailingAction, expandButton } = useAppShellContext()
  const compensateForStoplight = useCompensateForStoplight()
  const { t } = useTranslation()
  const { navigate, navigateToSession } = useNavigation()
  const { entries, create, update, remove } = useCalendarEntries(activeWorkspaceId ?? null)
  const { items: workItems, update: updateWorkItem } = useWorkItems(activeWorkspaceId ?? null)
  const setDetailId = useSetAtom(workItemDetailIdAtom)
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
    statusIds,
    setStatusIds,
    scheduled,
    setScheduled,
    activeViewId,
    setActiveViewId,
    query,
    applyQuery,
    setSelectedIds,
  } = useWorkItemViewState(activeWorkspaceId ?? null, workItems, liveProjectIds)
  const [view, setView] = React.useState<ViewMode>('month')
  const [cursor, setCursor] = React.useState(() => startOfMonth(new Date()))
  const [selectedDay, setSelectedDay] = React.useState<Date | null>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [form, setForm] = React.useState<EntryFormState>({ title: '', date: '', time: '', note: '', projectId: '' })

  const today = new Date()

  // -------------------------------------------------------------------------
  // Entry helpers
  // -------------------------------------------------------------------------

  const calendarItems = React.useMemo<CalendarProjection[]>(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    const scheduledWorkItems = queryWorkItems(workItems, {
      ...query,
      scheduled: scheduled === 'all' ? 'scheduled' : scheduled,
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
        note: entry.note,
        projectId: entry.projectId,
        entry,
      }))
    return [...scheduledWorkItems, ...standalone].sort((left, right) =>
      left.date.localeCompare(right.date) || (left.time ?? '').localeCompare(right.time ?? '') || left.title.localeCompare(right.title),
    )
  }, [entries, projectIds, query, scheduled, search, workItems])

  const entriesFor = React.useCallback(
    (day: Date): CalendarProjection[] => {
      const key = dayKey(day)
      return calendarItems.filter((entry) => entry.date <= key && entry.endDate >= key)
    },
    [calendarItems],
  )

  const openCreate = React.useCallback((date: Date) => {
    setForm({ title: '', date: dayKey(date), time: '', note: '', projectId: projectIds[0] ?? '' })
    setFormOpen(true)
  }, [projectIds])

  const openEdit = React.useCallback((projection: CalendarProjection) => {
    if (projection.workItem) {
      setSelectedIds([projection.workItem.id])
      setDetailId(projection.workItem.id)
      navigate(routes.view.projectWorkItem('calendar', projection.workItem.id))
      return
    }
    const entry = projection.entry
    if (!entry) return
    setForm({ id: entry.id, title: entry.title, date: entry.date, time: entry.time ?? '', note: entry.note ?? '', projectId: entry.projectId ?? '' })
    setFormOpen(true)
  }, [navigate, setDetailId, setSelectedIds])

  const submitForm = React.useCallback(async () => {
    const title = form.title.trim()
    if (!title || !form.date) return
    const input: CalendarEntryInput = {
      title,
      date: form.date,
      time: form.time.trim() || undefined,
      note: form.note.trim() || undefined,
      projectId: form.projectId || undefined,
    }
    if (form.id) await update(form.id, input)
    else await create(input)
    setFormOpen(false)
  }, [form, create, update])

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
        <div className="flex flex-col gap-1.5 border-b border-border/60 px-4 pb-2">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-foreground/45">
            {t('schedule.allDay')}
          </div>
          {allDay.length === 0 && (
            <div className="text-xs text-foreground/45">{t('schedule.noAllDay')}</div>
          )}
          {allDay.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2"
              style={entryBlockStyle(0.16)}
              onClick={() => openEdit(entry)}
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
            <div className="relative flex-1 border-l border-border/60">
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
                const endH = String((hh + 1) % 24).padStart(2, '0')
                return (
                  <div
                    key={entry.id}
                    className="absolute left-1.5 right-2.5 flex items-center gap-2.5 rounded-lg px-2.5 py-1.5"
                    style={{ top, height: `calc(100% / ${HOUR_END - HOUR_START})`, ...entryBlockStyle(0.22) }}
                    onClick={() => openEdit(entry)}
                  >
                    <span className="w-[76px] flex-none text-[11px] font-bold tabular-nums opacity-80">
                      {entry.time}–{endH}:{String(mm).padStart(2, '0')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold">{entry.title}</span>
                      {entry.note && (
                        <span className="block truncate text-[11px] opacity-70">{entry.note}</span>
                      )}
                    </span>
                    {entryActions(entry)}
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
              <div key={i} className="min-w-0 flex-1 border-r border-border/60 p-1 last:border-r-0">
                {allDay.map((entry) => (
                  <div
                    key={entry.id}
                    className="mb-1 flex items-center gap-1 overflow-hidden rounded-md px-1.5 py-1 text-[11.5px] font-medium"
                    style={entryBlockStyle(0.2)}
                    title={entry.title}
                    onClick={() => openEdit(entry)}
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
                <div key={i} className="relative min-w-0 flex-1 border-r border-border/60 last:border-r-0">
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
                  {entriesFor(d)
                    .filter((entry) => entry.date === dayKey(d) && entry.time)
                    .map((entry) => {
                      const [hh, mm] = entry.time!.split(':').map(Number)
                      return (
                        <div
                          key={entry.id}
                          className="absolute left-1 right-1 overflow-hidden rounded-md px-1.5 py-0.5"
                          style={{
                            top: hourTop(hh + mm / 60 - HOUR_START),
                            height: `calc(100% / ${HOUR_END - HOUR_START})`,
                            ...entryBlockStyle(0.22),
                          }}
                          title={entry.title}
                          onClick={() => openEdit(entry)}
                        >
                          <span className="block truncate text-[11.5px] font-semibold">
                            {entry.time} · {entry.title}
                          </span>
                        </div>
                      )
                    })}
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
                'flex min-h-0 flex-col gap-1 overflow-hidden bg-card p-1.5',
                !inMonth && 'bg-card/60',
                isToday && 'bg-accent/10',
              )}
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
                  className="flex items-center gap-1 overflow-hidden rounded-md px-1.5 py-0.5 text-[12.5px] leading-[1.4]"
                  style={entryBlockStyle(0.16)}
                  title={entry.title}
                  onClick={() => openEdit(entry)}
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
        className="flex flex-none flex-wrap items-center justify-between gap-2 border-b border-border/60 py-2.5"
        style={{
          paddingLeft: compensateForStoplight ? 84 : 16,
          paddingRight: compensateForStoplight ? 48 : 16,
        }}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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
            className="rounded-md border border-border/80 px-2.5 py-1 text-xs font-medium text-foreground/70 transition-colors hover:text-foreground"
          >
            {t('common.today')}
          </button>
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/80 bg-foreground/[0.02] p-0.5">
            {(['day', 'week', 'month'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => switchView(mode)}
                aria-pressed={view === mode}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  view === mode ? 'bg-card text-foreground shadow-minimal' : 'text-foreground/50 hover:text-foreground/80',
                )}
              >
                {t(`schedule.view.${mode}`)}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            className="h-8 gap-1.5 border-border/80 bg-card px-2.5 text-[12.5px] font-semibold"
            onClick={() => openCreate(cursor)}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            {t('schedule.newEntry')}
          </Button>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <WorkItemViewControls
            layout="calendar"
            query={query}
            applyQuery={applyQuery}
            activeViewId={activeViewId}
            setActiveViewId={setActiveViewId}
            statusIds={statusIds}
            setStatusIds={setStatusIds}
            scheduled={scheduled}
            setScheduled={setScheduled}
            statuses={sessionStatuses ?? []}
          />
          <ProjectManagementViewTabs value="calendar" />
          {/* Surface-injected close + fullscreen controls. */}
          {trailingAction}
          {expandButton}
        </div>
      </div>

      <div className="min-h-0 flex-1 p-4">
        {view === 'day' && renderDay()}
        {view === 'week' && renderWeek()}
        {view === 'month' && renderMonth()}
      </div>

      {/* Centered create/edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="w-[360px]">
          <DialogHeader>
            <DialogTitle>{form.id ? t('schedule.editEntry') : t('schedule.newEntry')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-foreground/55">{t('schedule.entryTitle')}</label>
              <input
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder={t('schedule.entryTitlePlaceholder')}
                autoFocus
                className="w-full rounded-md border border-border/80 bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
              />
            </div>
            {projectOptions.length > 0 && (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-foreground/55">{t('kanban.workItemProject')}</label>
                <select
                  value={form.projectId}
                  onChange={(e) => setForm((prev) => ({ ...prev, projectId: e.target.value }))}
                  className="w-full rounded-md border border-border/80 bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                >
                  <option value="">{t('kanban.workItemNoProject')}</option>
                  {projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-[11px] font-medium text-foreground/55">{t('schedule.entryDate')}</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
                  className="w-full rounded-md border border-border/80 bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-foreground/55">{t('schedule.entryTime')}</label>
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm((prev) => ({ ...prev, time: e.target.value }))}
                  className="rounded-md border border-border/80 bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-foreground/55">{t('schedule.entryNote')}</label>
              <textarea
                value={form.note}
                onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                rows={3}
                className="w-full resize-y rounded-md border border-border/80 bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" size="sm">{t('common.cancel')}</Button>
            </DialogClose>
            <Button size="sm" onClick={() => void submitForm()} disabled={!form.title.trim() || !form.date}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
