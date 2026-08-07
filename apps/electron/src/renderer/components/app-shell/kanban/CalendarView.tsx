/**
 * CalendarView — read-only month grid of all scheduled sessions.
 *
 * Each day cell lists the tasks whose `due` label falls on that date (project
 * color dot, overdue highlight). Clicking a task opens the session (same
 * scoped navigation as the board); the inline schedule editor shares the
 * label merge layer with the Gantt view. The Task editor overlay is shared
 * via the global kanbanEditorTargetAtom.
 */

import * as React from 'react'
import { Plus } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  addDays,
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
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
import {
  SCHEDULE_LABELS,
  deriveScheduledTaskRows,
  formatDateOnly,
  isOverdue,
  startOfDay,
  type ScheduledTaskRow,
} from './schedule'

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MAX_TASKS_PER_CELL = 3

export function CalendarView() {
  const { activeWorkspaceId, llmConnections, onJumpToTaskSessions } = useAppShellContext()
  const { t } = useTranslation()
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const projects = useAtomValue(projectsAtom)
  const updateSessionMeta = useSetAtom(updateSessionMetaAtom)
  const { navigateToSession } = useNavigation()
  const [editorTarget, setEditorTarget] = useAtom(kanbanEditorTargetAtom)
  const [cursor, setCursor] = React.useState(() => startOfMonth(new Date()))
  const { labels: labelConfigs, flatLabels } = useLabels(activeWorkspaceId ?? null)

  // Auto-provision the reserved schedule labels on first use (idempotent).
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

  // Tasks with a due date, keyed by local calendar day.
  const tasksByDay = React.useMemo(() => {
    const map = new Map<string, ScheduledTaskRow[]>()
    for (const row of rows) {
      if (!row.schedule.due) continue
      const key = formatDateOnly(row.schedule.due)
      const bucket = map.get(key)
      if (bucket) bucket.push(row)
      else map.set(key, [row])
    }
    return map
  }, [rows])

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

  const gridStart = startOfWeek(cursor, { weekStartsOn: 1 })
  const gridDays = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const today = startOfDay(new Date())

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-medium">{t('schedule.calendarTitle')}</span>
          <span className="text-[13px] font-semibold text-foreground/85">{format(cursor, 'MMMM yyyy')}</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setCursor((prev) => subMonths(prev, 1))}
              aria-label={t('schedule.prevMonth')}
              className="rounded-md px-1.5 py-0.5 text-foreground/50 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setCursor(startOfMonth(new Date()))}
              className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-foreground/50 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            >
              {t('common.today')}
            </button>
            <button
              type="button"
              onClick={() => setCursor((prev) => addMonths(prev, 1))}
              aria-label={t('schedule.nextMonth')}
              className="rounded-md px-1.5 py-0.5 text-foreground/50 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            >
              ›
            </button>
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

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid h-full min-h-[560px] grid-cols-7 gap-px overflow-hidden rounded-lg border border-border/50 bg-border/40">
          {/* Weekday header */}
          {WEEKDAY_KEYS.map((key) => (
            <div key={key} className="bg-background px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
              {t(`schedule.weekday.${key}`)}
            </div>
          ))}
          {/* Day cells */}
          {gridDays.map((day) => {
            const inMonth = isSameMonth(day, cursor)
            const isToday = isSameDay(day, today)
            const dayKey = formatDateOnly(day)
            const dayTasks = tasksByDay.get(dayKey) ?? []
            const visible = dayTasks.slice(0, MAX_TASKS_PER_CELL)
            const overflow = dayTasks.length - visible.length
            return (
              <div
                key={dayKey}
                className={cn(
                  'flex min-h-[92px] flex-col gap-0.5 bg-background p-1',
                  !inMonth && 'bg-background/60'
                )}
              >
                <div className="flex items-center justify-between px-0.5">
                  <span
                    className={cn(
                      'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium',
                      isToday ? 'bg-primary text-primary-foreground' : inMonth ? 'text-foreground/80' : 'text-foreground/30'
                    )}
                  >
                    {format(day, 'd')}
                  </span>
                </div>
                {visible.map((task) => {
                  const project = task.projectId ? projectsById.get(task.projectId) : undefined
                  const overdue = isOverdue(task.schedule, task.statusId)
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => openSessionScoped(task.id, project?.id)}
                      onDoubleClick={() => handleEditTask(task.id)}
                      title={task.title}
                      className={cn(
                        'flex min-w-0 items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] transition-colors hover:bg-foreground/[0.06]',
                        overdue ? 'text-red-500' : 'text-foreground/85'
                      )}
                    >
                      <span
                        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', project?.color ? '' : 'bg-foreground/30')}
                        style={project?.color ? { backgroundColor: project.color } : undefined}
                      />
                      <span className="truncate">{task.title}</span>
                    </button>
                  )
                })}
                {overflow > 0 && (
                  <span className="px-1 text-[10px] font-medium text-foreground/40">
                    +{overflow} {t('schedule.more')}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
