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
import { DEFAULT_MODEL } from '@config/models'
import { cn } from '@/lib/utils'
import { TaskEditor } from './TaskEditor'
import { buildModelCatalog } from './model-catalog'
import { ScheduleDatePopover } from './ScheduleDatePopover'
import {
  SCHEDULE_LABELS,
  deriveScheduledTaskRows,
  formatDateOnly,
  hasSchedule,
  isOverdue,
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
  const { activeWorkspaceId, llmConnections, onJumpToTaskSessions } = useAppShellContext()
  const { t } = useTranslation()
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const projects = useAtomValue(projectsAtom)
  const updateSessionMeta = useSetAtom(updateSessionMetaAtom)
  const { navigateToSession } = useNavigation()
  const [editorTarget, setEditorTarget] = useAtom(kanbanEditorTargetAtom)
  const [zoom, setZoom] = React.useState<GanttZoom>('week')
  const { labels: labelConfigs, flatLabels } = useLabels(activeWorkspaceId ?? null)

  // Auto-provision the reserved schedule labels on first use (idempotent:
  // labels:changed refreshes useLabels, so the effect stops firing).
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    for (const def of SCHEDULE_LABELS) {
      if (!flatLabels.some((l) => l.id === def.id)) {
        // The label id is derived from the name slug ('Start' → 'start').
        void window.electronAPI.createLabel(activeWorkspaceId, { name: def.name, valueType: 'date' })
      }
    }
  }, [activeWorkspaceId, flatLabels])

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
        <div className="min-h-0 flex-1 overflow-auto">
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
                      className={`h-2 w-2 shrink-0 rounded-full ${project?.color ? '' : 'bg-foreground/30'}`}
                      style={project?.color ? { backgroundColor: project.color } : undefined}
                    />
                    <button
                      type="button"
                      onClick={() => openSessionScoped(row.id, project?.id)}
                      className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-foreground hover:underline"
                      title={row.title}
                    >
                      {row.title}
                    </button>
                    {hasSchedule(row.schedule) && row.schedule.due && overdue && (
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
                      projectColor={project?.color}
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
  projectColor,
  onClick,
  onEdit,
}: {
  row: ScheduledTaskRow
  rangeStart: Date
  dayWidth: number
  overdue: boolean
  projectColor?: string
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

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onEdit}
      title={`${row.title} · ${formatDateOnly(barStart)}${due ? ` → ${formatDateOnly(barEnd)}` : ''}`}
      className={cn(
        'absolute top-1/2 z-20 flex -translate-y-1/2 items-center overflow-hidden rounded-[4px] border px-1.5 text-left transition-shadow hover:shadow-md',
        done ? 'bg-foreground/5' : projectColor ? '' : 'bg-foreground/10',
        done ? 'border-foreground/15' : overdue ? 'border-red-500/60' : projectColor ? '' : 'border-foreground/20'
      )}
      style={{
        left,
        width,
        height: 20,
        ...(projectColor && !done
          ? { backgroundColor: `${projectColor}26`, borderColor: overdue ? '#ef4444' : `${projectColor}66` }
          : {}),
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
