import * as React from 'react'
import { useAtom } from 'jotai'
import { reconcileWorkItemSelection, type WorkItem } from '@craft-agent/shared/work-items/browser'
import {
  kanbanProjectFilterAtom,
  workItemSearchAtom,
  workItemScheduledFilterAtom,
  workItemSelectionAtom,
  workItemSortAtom,
  workItemStatusFilterAtom,
  workItemActiveViewIdAtom,
  workItemViewWorkspaceAtom,
} from '@/atoms/kanban'

/** Shared workspace-scoped query/selection state used by every WorkItem projection. */
export function useWorkItemViewState(
  workspaceId: string | null,
  items: readonly WorkItem[],
  liveProjectIds: readonly string[],
) {
  const [scopeWorkspaceId, setScopeWorkspaceId] = useAtom(workItemViewWorkspaceAtom)
  const [projectIds, setProjectIds] = useAtom(kanbanProjectFilterAtom)
  const [search, setSearch] = useAtom(workItemSearchAtom)
  const [sort, setSort] = useAtom(workItemSortAtom)
  const [statusIds, setStatusIds] = useAtom(workItemStatusFilterAtom)
  const [scheduled, setScheduled] = useAtom(workItemScheduledFilterAtom)
  const [activeViewId, setActiveViewId] = useAtom(workItemActiveViewIdAtom)
  const [selectedIds, setSelectedIds] = useAtom(workItemSelectionAtom)

  React.useEffect(() => {
    if (scopeWorkspaceId === workspaceId) return
    setScopeWorkspaceId(workspaceId)
    setProjectIds([])
    setSearch('')
    setStatusIds([])
    setScheduled('all')
    setActiveViewId(null)
    setSelectedIds([])
  }, [scopeWorkspaceId, setActiveViewId, setProjectIds, setScheduled, setScopeWorkspaceId, setSearch, setSelectedIds, setStatusIds, workspaceId])

  React.useEffect(() => {
    const live = new Set(liveProjectIds)
    setProjectIds((previous) => {
      const next = previous.filter((id) => live.has(id))
      return next.length === previous.length ? previous : next
    })
  }, [liveProjectIds, setProjectIds])

  React.useEffect(() => {
    setSelectedIds((previous) => {
      const next = reconcileWorkItemSelection(previous, items)
      return next.length === previous.length && next.every((id, index) => id === previous[index])
        ? previous
        : next
    })
  }, [items, setSelectedIds])

  return {
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
    activeViewId,
    setActiveViewId,
    query: {
      projectIds: projectIds.length ? projectIds : undefined,
      statusIds: statusIds.length ? statusIds : undefined,
      search: search || undefined,
      scheduled,
      sort,
    },
    applyQuery: (query: import('@craft-agent/shared/work-items/browser').WorkItemQuery) => {
      setProjectIds(query.projectIds ? [...query.projectIds] : [])
      setStatusIds(query.statusIds ? [...query.statusIds] : [])
      setSearch(query.search ?? '')
      setScheduled(query.scheduled ?? 'all')
      setSort(query.sort ?? { field: 'updatedAt', direction: 'desc' })
      setSelectedIds([])
    },
    selectedIds,
    setSelectedIds,
  }
}
