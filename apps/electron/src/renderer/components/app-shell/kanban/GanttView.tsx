/**
 * GanttView — read-only timeline of all scheduled sessions.
 *
 * Derives rows from the session meta map (top-level tasks + direct children,
 * see schedule.ts), renders them as lanes over a day/week/month time axis,
 * and draws parent → child dependency arrows plus a today line. Clicking a
 * bar opens the session (same scoped navigation as the board); the inline
 * schedule editor writes back through the label merge layer. The Task editor
 * overlay is shared with the board via the global kanbanEditorTargetAtom.
 */

import * as React from 'react'
import { Plus } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { useAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom, updateSessionMetaAtom } from '@/atoms/sessions'
import { projectsAtom } from '@/atoms/projects'
import { kanbanEditorTargetAtom } from '@/atoms/kanban'
import { useNavigation } from '@/contexts/NavigationContext'
import { useLabels } from '@/hooks/useLabels'
import { getSessionTitle } from '@/utils/session'
import { resolveTaskScopeLabelId } from '@craft-agent/shared/labels'
import { getStateColor } from '@/config/session-status-config'
import { DEFAULT_MODEL } from '@config/models'
import { cn } from '@/lib/utils'
import { TaskEditor } from './TaskEditor'
import { buildModelCatalog } from './model-catalog'
import { ScheduleDatePopover } from './ScheduleDatePopover'
import {
  deriveScheduledTaskRows,
  formatDateOnly,
  hasSchedule,
  isOverdue,
  missingScheduleLabels,
  startOfDay,
  type ScheduledTaskRow,
} from './schedule'

const ROW_HEIGHT = 34
const LIST_WIDTH = 280
const HEADER_HEIGHT = 46
const DAY_WIDTH_BY_ZOOM = { day: 44, week: 22, month: 10 } as const
export type GanttZoom = keyof typeof DAY_WIDTH_BY_ZOOM

function isDone(statusId: string): boolean {
  return statusId === 'done' || statusId === 'archived'
}

export function GanttView() {
  const { activeWorkspaceId, llmConnections, onJumpToTaskSessions, sessionStatuses } = useAppShellContext()
  const { t } = useTranslation()
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const projects = useAtomValue(projectsAtom)
  const updateSessionMeta = useSetAtom(updateSessionMetaAtom)
  const { navigateToSession } = useNavigation()
  const [editorTarget, setEditorTarget] = useAtom(kanbanEditorTargetAtom)
  const [zoom, setZoom] = React.useState<GanttZoom>('week')
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const scrolledToTodayRef = React.useRef(false)
  const { labels: labelConfigs, flatLabels, isLoading: labelsLoading } = useLabels(activeWorkspaceId ?? null)

  // Auto-provision the reserved schedule labels on first use. Matched by
  // display name (not id) and attempted exactly once per mount after labels
  // finish loading, so pre-existing labels are respected and no duplicate
  // slugs are ever minted.
  const provisionedRef = React.useRef(false)
  React.useEffect(() => {
    if (!activeWorkspaceId || labelsLoading || provisionedRef.current) return
    provisionedRef.current = true
    for (const def of missingScheduleLabels(flatLabels)) {
      void window.electronAPI.createLabel(activeWorkspaceId, { name: def.name, valueType: 'date' })
    }
  }, [activeWorkspaceId, flatLabels, labelsLoading])

  const projectsById = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string }>()
    for (const project of projects) {
      const color = project.config.color
      if (!color) continue
      map.set(project.config.id, { id: project.config.id, name: project.config.name, color })
    }
    return map
  }, [projects])

  const rows = React.useMemo(() => deriveScheduledTaskRows(metaMap.values()), [metaMap])

  // Row index lookup for dependency arrows (parents always precede children).
  const rowIndexById = React.useMemo(() => {
    const map = new Map<string, number>()
    for (let i = 0; i < rows.length; i++) map.set(rows[i].id, i)
    return map
  }, [rows])

  // Time range: min(start/due) → max(start/due), aligned to week boundaries,
  // always including today.
  const range = React.useMemo(() => {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const row of rows) {
      if (row.schedule.start) {
        min = Math.min(min, row.schedule.start.getTime())
        max = Math.max(max, row.schedule.start.getTime())
      }
      if (row.schedule.due) {
        min = Math.min(min, row.schedule.due.getTime())
        max = Math.max(max, row.schedule.due.getTime())
      }
    }
    const now = new Date()
    min = Math.min(min, now.getTime())
    max = Math.max(max, now.getTime())
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null
    const rangeStart = startOfWeek(startOfDay(new Date(min)), { weekStartsOn: 1 })
    const rangeEnd = endOfWeek(startOfDay(new Date(max)), { weekStartsOn: 1 })
    return { rangeStart, rangeEnd, days: differenceInCalendarDays(rangeEnd, rangeStart) + 1 }
  }, [rows])

  const dayWidth = DAY_WIDTH_BY_ZOOM[zoom]
  const timelineWidth = range ? range.days * dayWidth : 0
  const todayX = range ? differenceInCalendarDays(startOfDay(new Date()), range.rangeStart) * dayWidth : -1

  // The time range spans the earliest → latest scheduled task; on first mount
  // jump the scroll position to today so the current schedule is visible
  // instead of a mostly-empty strip at the oldest task.
  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || scrolledToTodayRef.current || todayX <= 0) return
    scrolledToTodayRef.current = true
    el.scrollLeft = Math.max(0, todayX - Math.max(0, el.clientWidth - 320) / 2)
  }, [todayX])

  const openSessionScoped = React.useCallback(
    (sessionId: string, projectFallbackId?: string) => {
      const meta = metaMap.get(sessionId)
      const scopeLabelId = resolveTaskScopeLabelId(meta?.labels, labelConfigs)
      if (scopeLabelId && onJumpToTaskSessions) {
        onJumpToTaskSessions(sessionId, {
          labelId: scopeLabelId,
          projectId: meta?.projectId ?? projectFallbackId,
        })
        return
      }
      navigateToSession(sessionId)
    },
    [metaMap, labelConfigs, onJumpToTaskSessions, navigateToSession]
  )

  const handleEditTask = React.useCallback(
    (taskId: string) => {
      const meta = metaMap.get(taskId)
      setEditorTarget({
        mode: 'edit',
        sessionId: taskId,
        taskSlug: meta?.taskSlug,
        initialTitle: meta ? getSessionTitle(meta) : undefined,
      })
    },
    [metaMap, setEditorTarget]
  )

  // Apply a schedule change: optimistic meta update + setLabels RPC (the
  // labels_changed event then reconciles all views from the server state).
  const handleScheduleChange = React.useCallback(
    (taskId: string, nextLabels: string[]) => {
      updateSessionMeta(taskId, { labels: nextLabels })
      void window.electronAPI.sessionCommand(taskId, { type: 'setLabels', labels: nextLabels })
    },
    [updateSessionMeta]
  )

  const { groups: subtaskModelGroups, modelToConnection } = React.useMemo(
    () => buildModelCatalog(llmConnections),
    [llmConnections]
  )
  const defaultSubtaskModel = modelToConnection.has(DEFAULT_MODEL) ? DEFAULT_MODEL : undefined

  if (editorTarget && activeWorkspaceId) {
    return (
      <TaskEditor
        workspaceId={activeWorkspaceId}
        target={editorTarget}
        onClose={() => setEditorTarget(null)}
        onOpenSession={
          editorTarget.mode === 'edit'
            ? () => {
                setEditorTarget(null)
                navigateToSession(editorTarget.sessionId)
              }
            : undefined
        }
        onOpenChildSession={(sessionId) => {
          setEditorTarget(null)
          navigateToSession(sessionId)
        }}
        onCreated={({ sessionId, taskLabelId }) => {
          setEditorTarget(null)
          if (taskLabelId && onJumpToTaskSessions) {
            onJumpToTaskSessions(sessionId, { labelId: taskLabelId })
          } else {
            navigateToSession(sessionId)
          }
        }}
        modelGroups={subtaskModelGroups}
        modelToConnection={modelToConnection}
        defaultModel={defaultSubtaskModel ?? DEFAULT_MODEL}
      />
    )
  }

  const monthCells = range ? buildMonthCells(range.rangeStart, range.days) : []

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-sm font-medium">{t('schedule.ganttTitle')}</span>
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-foreground/[0.02] p-0.5">
            {(['day', 'week', 'month'] as const).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoom(z)}
                aria-pressed={zoom === z}
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  zoom === z ? 'bg-card text-foreground shadow-sm' : 'text-foreground/50 hover:text-foreground/80'
                }`}
              >
                {t(`schedule.zoom.${z}`)}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditorTarget({ mode: 'create' })}
          disabled={!activeWorkspaceId}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-foreground/[0.03] disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> {t('kanban.newTask')}
        </button>
      </div>

      {!range || rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <p className="text-sm">{t('schedule.ganttEmpty')}</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto" ref={scrollRef}>
          <div className="relative" style={{ minWidth: LIST_WIDTH + timelineWidth }}>
            {/* Header: sticky list header + sticky time-scale header */}
            <div className="sticky top-0 z-30 flex border-b border-border/60 bg-background" style={{ height: HEADER_HEIGHT }}>
              <div
                className="sticky left-0 z-40 flex items-center border-r border-border/50 bg-background px-3"
                style={{ width: LIST_WIDTH }}
              >
                <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                  {t('schedule.task')}
                </span>
              </div>
              <div className="relative" style={{ width: timelineWidth }}>
                {/* Month row */}
                <div className="absolute inset-x-0 top-0 flex border-b border-border/40" style={{ height: 22 }}>
                  {monthCells.map((cell) => (
                    <div
                      key={cell.key}
                      className="flex items-center truncate px-2 text-[11px] font-medium text-foreground/70"
                      style={{ width: cell.days * dayWidth }}
                    >
                      {format(cell.month, 'MMMM yyyy')}
                    </div>
                  ))}
                </div>
                {/* Day/week row */}
                <div className="absolute inset-x-0 top-[22px] flex" style={{ height: 24 }}>
                  {Array.from({ length: range.days }, (_, i) => {
                    const day = addDays(range.rangeStart, i)
                    const showDay = zoom === 'day' || (zoom === 'week' && day.getDay() === 1)
                    return (
                      <div
                        key={day.toISOString()}
                        className="flex items-center justify-center border-r border-border/30 text-[10px] text-foreground/45"
                        style={{ width: dayWidth }}
                      >
                        {zoom === 'month' && day.getDay() === 1 ? format(day, 'MMM d') : showDay ? format(day, 'd') : ''}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Lanes */}
            {rows.map((row, index) => {
              const statusColor = getStateColor(row.statusId, sessionStatuses ?? [])
              const project = row.projectId ? projectsById.get(row.projectId) : undefined
              const overdue = isOverdue(row.schedule, row.statusId)
              const parentIndex = row.parentSessionId ? rowIndexById.get(row.parentSessionId) : undefined
              return (
                <div key={row.id} className="flex border-b border-border/40" style={{ height: ROW_HEIGHT }}>
                  {/* List cell (sticky) */}
                  <div
                    className="sticky left-0 z-20 flex items-center gap-2 border-r border-border/50 bg-background px-3"
                    style={{ width: LIST_WIDTH }}
                  >
                    {row.parentSessionId && <span className="text-foreground/25">└</span>}
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${statusColor || project?.color ? '' : 'bg-foreground/30'}`}
                      style={statusColor || project?.color ? { backgroundColor: statusColor ?? project!.color } : undefined}
                    />
                    <button
                      type="button"
                      onClick={() => openSessionScoped(row.id, project?.id)}
                      className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-foreground hover:underline"
                      title={row.title}
                    >
                      {row.title}
                    </button>
                    {hasSchedule(row.schedule) && (
                      <span className="shrink-0 text-[10px] tabular-nums text-foreground/40">
                        {formatDateOnly(row.schedule.start ?? row.schedule.due!).slice(5)}
                        {row.schedule.start && row.schedule.due && row.schedule.due > row.schedule.start
                          ? `–${formatDateOnly(row.schedule.due).slice(5)}`
                          : ''}
                      </span>
                    )}
                    {overdue && (
                      <span className="shrink-0 text-[10px] font-semibold text-red-500">{t('schedule.overdue')}</span>
                    )}
                    <ScheduleDatePopover
                      title={row.title}
                      labels={metaMap.get(row.id)?.labels}
                      onApply={(nextLabels) => handleScheduleChange(row.id, nextLabels)}
                    />
                  </div>
                  {/* Lane cell */}
                  <div className="relative" style={{ width: timelineWidth }}>
                    {/* Vertical date gridlines (weekly, plus faint daily in day zoom) */}
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0 right-0"
                      style={{
                        backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${7 * dayWidth - 1}px, color-mix(in srgb, var(--border) 85%, white 15%) ${7 * dayWidth - 1}px, transparent ${7 * dayWidth}px)`,
                      }}
                    />
                    {zoom === 'day' && (
                      <div
                        className="pointer-events-none absolute inset-y-0 left-0 right-0"
                        style={{
                          backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${dayWidth - 1}px, color-mix(in srgb, var(--border) 40%, transparent) ${dayWidth - 1}px, transparent ${dayWidth}px)`,
                        }}
                      />
                    )}
                    {/* Today line */}
                    {todayX >= 0 && (
                      <div
                        className="pointer-events-none absolute inset-y-0 z-10 w-px bg-red-500/50"
                        style={{ left: todayX }}
                      />
                    )}
                    {/* Dependency arrow to parent (drawn above this row, in this
                        cell's SVG with overflow visible so it can span rows). */}
                    {parentIndex !== undefined && parentIndex < index && (
                      <svg
                        className="pointer-events-none absolute left-0 right-0 z-0"
                        style={{ top: 0, height: ROW_HEIGHT, overflow: 'visible' }}
                      >
                        <DependencyArrow
                          childRow={row}
                          parentRow={rows[parentIndex]}
                          rangeStart={range.rangeStart}
                          dayWidth={dayWidth}
                          childY={ROW_HEIGHT / 2}
                          parentY={-(index - parentIndex) * ROW_HEIGHT + ROW_HEIGHT / 2}
                        />
                      </svg>
                    )}
                    {/* Task bar */}
                    <TaskBar
                      row={row}
                      rangeStart={range.rangeStart}
                      dayWidth={dayWidth}
                      overdue={overdue}
                      statusColor={statusColor}
                      onClick={() => openSessionScoped(row.id, project?.id)}
                      onEdit={() => handleEditTask(row.id)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

interface MonthCell {
  key: string
  month: Date
  days: number
}

function buildMonthCells(rangeStart: Date, totalDays: number): MonthCell[] {
  const cells: MonthCell[] = []
  let cursor = startOfMonth(rangeStart)
  let covered = 0
  while (covered < totalDays) {
    const monthEnd = endOfMonth(cursor)
    const days = Math.min(differenceInCalendarDays(monthEnd, cursor) + 1, totalDays - covered)
    cells.push({ key: format(cursor, 'yyyy-MM'), month: cursor, days })
    covered += days
    cursor = addMonths(cursor, 1)
  }
  return cells
}

function TaskBar({
  row,
  rangeStart,
  dayWidth,
  overdue,
  statusColor,
  onClick,
  onEdit,
}: {
  row: ScheduledTaskRow
  rangeStart: Date
  dayWidth: number
  overdue: boolean
  statusColor?: string
  onClick: () => void
  onEdit: () => void
}) {
  const { start, due } = row.schedule
  if (!start && !due) return null

  const barStart = start ?? due!
  const barEnd = due ?? start!
  const left = differenceInCalendarDays(startOfDay(barStart), rangeStart) * dayWidth
  const width = Math.max((differenceInCalendarDays(startOfDay(barEnd), startOfDay(barStart)) + 1) * dayWidth, dayWidth)
  const done = isDone(row.statusId)
  const fill = statusColor ?? 'var(--muted-foreground)'

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onEdit}
      title={`${row.title} · ${formatDateOnly(barStart)}${due ? ` → ${formatDateOnly(barEnd)}` : ''}`}
      className={cn(
        'absolute top-1/2 z-20 flex -translate-y-1/2 items-center overflow-hidden rounded-[4px] border px-1.5 text-left transition-shadow hover:shadow-md',
        done ? 'opacity-45' : ''
      )}
      style={{
        left,
        width,
        height: 20,
        backgroundColor: done
          ? 'color-mix(in srgb, var(--foreground) 12%, transparent)'
          : `color-mix(in srgb, ${fill} 32%, var(--background))`,
        borderColor: done
          ? 'color-mix(in srgb, var(--foreground) 25%, transparent)'
          : overdue
            ? '#ef4444'
            : `color-mix(in srgb, ${fill} 80%, transparent)`,
      }}
    >
      <span
        className={`truncate text-[10.5px] font-medium ${done ? 'text-foreground/40 line-through' : 'text-foreground/85'}`}
      >
        {row.title}
      </span>
    </button>
  )
}

function DependencyArrow({
  childRow,
  parentRow,
  rangeStart,
  dayWidth,
  childY,
  parentY,
}: {
  childRow: ScheduledTaskRow
  parentRow: ScheduledTaskRow
  rangeStart: Date
  dayWidth: number
  childY: number
  parentY: number
}) {
  const childStart = childRow.schedule.start ?? childRow.schedule.due
  const parentStart = parentRow.schedule.start ?? parentRow.schedule.due
  if (!childStart || !parentStart) return null
  if (!hasSchedule(parentRow.schedule)) return null

  const x1 = differenceInCalendarDays(startOfDay(childStart), rangeStart) * dayWidth
  const x2 = differenceInCalendarDays(startOfDay(parentStart), rangeStart) * dayWidth
  // Arrow from the child's bar start up to the parent's bar start.
  const midX = Math.min(x1, x2) - 14
  const path = `M ${x1} ${childY} H ${midX} V ${parentY} H ${x2}`
  return (
    <>
      <path d={path} fill="none" stroke="var(--foreground/35)" strokeWidth={1.2} />
      <path d={`M ${x2} ${parentY} l -4 -3 m 0 6 l 4 -3`} fill="none" stroke="var(--foreground/35)" strokeWidth={1.2} />
    </>
  )
}
