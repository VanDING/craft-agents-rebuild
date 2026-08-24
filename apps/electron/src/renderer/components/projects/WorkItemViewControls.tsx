import * as React from 'react'
import { Bookmark, Filter, Save, Star, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  WorkItemQuery,
  WorkItemScheduledFilter,
  WorkItemViewLayout,
} from '@craft-agent/shared/work-items/browser'
import type { SessionStatus } from '@/config/session-status-config'
import { useAppShellContext } from '@/context/AppShellContext'
import { routes, useNavigation } from '@/contexts/NavigationContext'
import { useWorkItemViews } from '@/hooks/useWorkItemViews'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface WorkItemViewControlsProps {
  layout: WorkItemViewLayout
  query: WorkItemQuery
  applyQuery: (query: WorkItemQuery) => void
  activeViewId: string | null
  setActiveViewId: (viewId: string | null) => void
  statusIds: string[]
  setStatusIds: (ids: string[]) => void
  scheduled: WorkItemScheduledFilter
  setScheduled: (value: WorkItemScheduledFilter) => void
  statuses: readonly SessionStatus[]
  className?: string
}

function stableQuery(query: WorkItemQuery): string {
  return JSON.stringify({
    projectIds: query.projectIds ?? [],
    statusIds: query.statusIds ?? [],
    columnIds: query.columnIds ?? [],
    sessionId: query.sessionId ?? null,
    search: query.search ?? '',
    scheduled: query.scheduled ?? 'all',
    dateRange: query.dateRange ?? null,
    includeArchived: Boolean(query.includeArchived),
    sort: query.sort ?? null,
  })
}

/** Durable saved-view picker plus the query controls shared by all projections. */
export function WorkItemViewControls({
  layout,
  query,
  applyQuery,
  activeViewId,
  setActiveViewId,
  statusIds,
  setStatusIds,
  scheduled,
  setScheduled,
  statuses,
  className,
}: WorkItemViewControlsProps) {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const { navigate } = useNavigation()
  const { views, isLoading, create, update, remove } = useWorkItemViews(activeWorkspaceId ?? null)
  const activeView = views.find(({ id }) => id === activeViewId)
  const dirty = Boolean(activeView && (activeView.layout !== layout || stableQuery(activeView.query) !== stableQuery(query)))
  const defaultAppliedFor = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!activeWorkspaceId || isLoading || activeViewId || defaultAppliedFor.current === activeWorkspaceId) return
    defaultAppliedFor.current = activeWorkspaceId
    const defaultView = views.find(({ isDefault }) => isDefault)
    if (!defaultView) return
    setActiveViewId(defaultView.id)
    applyQuery(defaultView.query)
    if (defaultView.layout !== layout) navigate(routes.view.projectManagement(defaultView.layout))
  }, [activeViewId, activeWorkspaceId, applyQuery, isLoading, layout, navigate, setActiveViewId, views])

  const selectView = React.useCallback((viewId: string) => {
    if (!viewId) {
      setActiveViewId(null)
      return
    }
    const selected = views.find(({ id }) => id === viewId)
    if (!selected) return
    setActiveViewId(selected.id)
    applyQuery(selected.query)
    if (selected.layout !== layout) navigate(routes.view.projectManagement(selected.layout))
  }, [applyQuery, layout, navigate, setActiveViewId, views])

  const saveNew = React.useCallback(async () => {
    const name = window.prompt(t('kanban.savedViewNamePrompt'))?.trim()
    if (!name) return
    const created = await create({
      name,
      layout,
      query,
      isDefault: views.length === 0,
    })
    if (created) setActiveViewId(created.id)
  }, [create, layout, query, setActiveViewId, t, views.length])

  const updateActive = React.useCallback(async () => {
    if (!activeView) return
    await update(activeView.id, { layout, query })
  }, [activeView, layout, query, update])

  const deleteActive = React.useCallback(async () => {
    if (!activeView || !window.confirm(t('kanban.savedViewDeleteConfirm', { name: activeView.name }))) return
    await remove(activeView.id)
    setActiveViewId(null)
  }, [activeView, remove, setActiveViewId, t])

  const makeDefault = React.useCallback(async () => {
    if (!activeView || activeView.isDefault) return
    await update(activeView.id, { isDefault: true })
  }, [activeView, update])

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <div className="relative">
        <Bookmark className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/40" />
        <select
          value={activeViewId ?? ''}
          onChange={(event) => selectView(event.target.value)}
          aria-label={t('kanban.savedViews')}
          className="h-8 max-w-40 rounded-lg border border-border bg-background pl-7 pr-2 text-xs outline-none"
        >
          <option value="">{t('kanban.unsavedView')}</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>{view.isDefault ? `★ ${view.name}` : view.name}</option>
          ))}
        </select>
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('kanban.viewFilters')}
            className={cn(
              'relative grid h-8 w-8 place-items-center rounded-lg border border-border bg-background text-foreground/55 hover:text-foreground',
              (statusIds.length > 0 || scheduled !== 'all') && 'border-primary/40 text-primary',
            )}
          >
            <Filter className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          <div className="mb-2 text-xs font-semibold">{t('kanban.workItemStatus')}</div>
          <div className="max-h-40 space-y-1 overflow-auto">
            {statuses.map((status) => (
              <label key={status.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-foreground/[0.04]">
                <input
                  type="checkbox"
                  checked={statusIds.includes(status.id)}
                  onChange={(event) => setStatusIds(event.target.checked
                    ? [...statusIds, status.id]
                    : statusIds.filter((id) => id !== status.id))}
                />
                <span>{status.label}</span>
              </label>
            ))}
          </div>
          <div className="mb-1 mt-3 text-xs font-semibold">{t('kanban.scheduleFilter')}</div>
          <select
            value={scheduled}
            onChange={(event) => setScheduled(event.target.value as WorkItemScheduledFilter)}
            className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs outline-none"
          >
            <option value="all">{t('kanban.allTasks')}</option>
            <option value="scheduled">{t('kanban.scheduledOnly')}</option>
            <option value="unscheduled">{t('kanban.unscheduledOnly')}</option>
          </select>
          <button
            type="button"
            onClick={() => { setStatusIds([]); setScheduled('all') }}
            className="mt-3 text-xs font-semibold text-foreground/55 hover:text-foreground"
          >
            {t('common.clear')}
          </button>
        </PopoverContent>
      </Popover>

      <button type="button" onClick={() => void (activeView ? updateActive() : saveNew())} title={activeView ? t('kanban.savedViewUpdate') : t('kanban.savedViewSave')} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-foreground/55 hover:text-foreground">
        <Save className={cn('h-3.5 w-3.5', dirty && 'text-primary')} />
      </button>
      {activeView && (
        <>
          <button type="button" onClick={() => void makeDefault()} title={t('kanban.savedViewMakeDefault')} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-foreground/55 hover:text-foreground">
            <Star className={cn('h-3.5 w-3.5', activeView.isDefault && 'fill-current text-primary')} />
          </button>
          <button type="button" onClick={() => void deleteActive()} title={t('kanban.savedViewDelete')} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-foreground/55 hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  )
}
