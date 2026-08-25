import * as React from 'react'
import { CheckSquare, Link2, Search, Square, Trash2 } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { projectsAtom } from '@/atoms/projects'
import { useAppShellContext } from '@/context/AppShellContext'
import { useCompensateForStoplight } from '@/context/StoplightContext'
import { routes, useNavigation } from '@/contexts/NavigationContext'
import { useWorkItems } from '@/hooks/useWorkItems'
import { useWorkItemViewState } from '@/hooks/useWorkItemViewState'
import { queryWorkItems, type WorkItemSortField } from '@craft-agent/shared/work-items/browser'
import { KanbanProjectFilter, type KanbanProjectFilterOption } from './KanbanProjectFilter'
import { ProjectManagementViewTabs } from '../../projects/ProjectManagementViewTabs'
import { WorkItemFilterControls } from '../../projects/WorkItemFilterControls'
import { ProjectSelectMenu } from '../../projects/ProjectSelectMenu'

export function WorkItemListView() {
  const { activeWorkspaceId, sessionStatuses, trailingAction, expandButton } = useAppShellContext()
  const compensateForStoplight = useCompensateForStoplight()
  const { t } = useTranslation()
  const projects = useAtomValue(projectsAtom)
  const { navigate } = useNavigation()
  const { items, remove } = useWorkItems(activeWorkspaceId ?? null)
  const projectOptions = React.useMemo<KanbanProjectFilterOption[]>(
    () => projects.map((project) => ({
      id: project.config.id,
      name: project.config.name,
      color: project.config.color,
    })),
    [projects],
  )
  const projectById = React.useMemo(
    () => new Map(projectOptions.map((project) => [project.id, project])),
    [projectOptions],
  )
  const liveProjectIds = React.useMemo(() => projectOptions.map(({ id }) => id), [projectOptions])
  const statusById = React.useMemo(
    () => new Map((sessionStatuses ?? []).map((status) => [status.id, status])),
    [sessionStatuses],
  )
  const {
    projectIds,
    setProjectIds,
    search,
    setSearch,
    sort,
    setSort,
    statusIds,
    setStatusIds,
    scheduled,
    setScheduled,
    query,
    selectedIds,
    setSelectedIds,
  } = useWorkItemViewState(activeWorkspaceId ?? null, items, liveProjectIds)
  const visibleItems = React.useMemo(
    () => queryWorkItems(items, query),
    [items, query],
  )
  const sortOptions = React.useMemo(() => [
    { value: 'updatedAt:desc', label: t('kanban.workItemSortUpdated') },
    { value: 'createdAt:desc', label: t('kanban.workItemSortCreated') },
    { value: 'title:asc', label: t('kanban.workItemSortTitle') },
    { value: 'dueAt:asc', label: t('kanban.workItemSortDue') },
  ], [t])
  const openDetail = React.useCallback((itemId: string) => {
    navigate(routes.view.projectWorkItem('list', itemId))
  }, [navigate])

  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((item) => selectedIds.includes(item.id))

  return (
    <div className="flex h-full flex-col bg-background">
      <div
        className="flex h-[42px] flex-none items-center justify-between gap-2 border-b border-border/60"
        style={{
          paddingLeft: compensateForStoplight ? 84 : 16,
          paddingRight: compensateForStoplight ? 48 : 16,
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {projectOptions.length > 0 && (
            <KanbanProjectFilter projects={projectOptions} value={projectIds} onChange={setProjectIds} />
          )}
          <label className="relative min-w-36 flex-1 sm:max-w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/35" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('kanban.workItemSearch')}
              className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-2 text-xs outline-none focus:border-ring/60"
            />
          </label>
          <ProjectSelectMenu
            value={`${sort.field}:${sort.direction ?? 'asc'}`}
            options={sortOptions}
            onValueChange={(value) => {
              const [field, direction] = value.split(':') as [WorkItemSortField, 'asc' | 'desc']
              setSort({ field, direction })
            }}
            ariaLabel={t('kanban.workItemSort')}
          />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <WorkItemFilterControls
            statusIds={statusIds}
            setStatusIds={setStatusIds}
            scheduled={scheduled}
            setScheduled={setScheduled}
            statuses={sessionStatuses ?? []}
          />
          <ProjectManagementViewTabs value="list" />
          {trailingAction}
          {expandButton}
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-none items-center justify-between border-b border-border/50 bg-accent/5 px-4 py-2 text-xs">
          <span>{t('kanban.workItemSelected', { count: selectedIds.length })}</span>
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(t('kanban.workItemDeleteSelectedConfirm', { count: selectedIds.length }))) return
              void Promise.all(selectedIds.map((id) => remove(id))).then(() => setSelectedIds([]))
            }}
            className="inline-flex items-center gap-1.5 font-semibold text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> {t('kanban.workItemDeleteSelected')}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[40px_minmax(220px,2fr)_minmax(120px,1fr)_130px_120px_100px] items-center border-b border-border/60 bg-foreground/[0.015] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
            <button
              type="button"
              onClick={() => setSelectedIds(allVisibleSelected ? [] : visibleItems.map((item) => item.id))}
              aria-label={t('kanban.workItemSelectAll')}
            >
              {allVisibleSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            </button>
            <span>{t('kanban.workItemTitle')}</span>
            <span>{t('kanban.workItemProject')}</span>
            <span>{t('kanban.workItemStatus')}</span>
            <span>{t('kanban.workItemDue')}</span>
            <span>{t('kanban.workItemProgress')}</span>
          </div>
          {visibleItems.map((item) => {
            const selected = selectedIds.includes(item.id)
            const project = item.projectId ? projectById.get(item.projectId) : undefined
            const status = statusById.get(item.statusId)
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => openDetail(item.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  openDetail(item.id)
                }}
                className="grid w-full grid-cols-[40px_minmax(220px,2fr)_minmax(120px,1fr)_130px_120px_100px] items-center border-b border-border/45 px-3 py-2.5 text-left text-xs hover:bg-foreground/[0.025]"
              >
                <button
                  type="button"
                  aria-label={selected ? t('kanban.workItemDeselect') : t('kanban.workItemSelect')}
                  aria-pressed={selected}
                  onClick={(event) => {
                    event.stopPropagation()
                    setSelectedIds((previous) => selected
                      ? previous.filter((id) => id !== item.id)
                      : [...previous, item.id])
                  }}
                  className="justify-self-start"
                >
                  {selected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-foreground/35" />}
                </button>
                <span className="min-w-0 pr-3">
                  <span className="block truncate font-semibold text-foreground">{item.title}</span>
                  <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-foreground/40">
                    {item.sessionIds.length > 0 && <Link2 className="h-3 w-3" />}
                    {item.description || t('kanban.workItemNoDescription')}
                  </span>
                </span>
                <span className="truncate text-foreground/60">{project?.name ?? t('kanban.workItemNoProject')}</span>
                <span className="truncate text-foreground/60">{status?.label ?? item.statusId}</span>
                <span className="tabular-nums text-foreground/60">{item.dueAt?.slice(0, 10) ?? '—'}</span>
                <span className="tabular-nums text-foreground/60">{item.progress === undefined ? '—' : `${item.progress}%`}</span>
              </div>
            )
          })}
          {visibleItems.length === 0 && (
            <div className="px-4 py-16 text-center text-sm text-foreground/45">{t('kanban.workItemEmpty')}</div>
          )}
        </div>
      </div>
    </div>
  )
}
