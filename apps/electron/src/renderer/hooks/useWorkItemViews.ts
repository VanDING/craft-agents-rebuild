import * as React from 'react'
import type {
  CreateWorkItemViewInput,
  UpdateWorkItemViewInput,
  WorkItemViewDefinition,
} from '@craft-agent/shared/work-items/browser'

export function useWorkItemViews(workspaceId: string | null) {
  const [views, setViews] = React.useState<WorkItemViewDefinition[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    if (!workspaceId) {
      setViews([])
      setIsLoading(false)
      return
    }
    try {
      setIsLoading(true)
      setViews(await window.electronAPI.listWorkItemViews(workspaceId))
    } catch (error) {
      console.error('[useWorkItemViews] Failed to load views:', error)
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  React.useEffect(() => { void refresh() }, [refresh])
  React.useEffect(() => {
    if (!workspaceId) return
    return window.electronAPI.onWorkItemsChanged((changedWorkspaceId) => {
      if (changedWorkspaceId === workspaceId) void refresh()
    })
  }, [refresh, workspaceId])

  const create = React.useCallback(async (input: CreateWorkItemViewInput) => {
    if (!workspaceId) return null
    const created = await window.electronAPI.createWorkItemView(workspaceId, input)
    setViews((previous) => [...previous, created])
    return created
  }, [workspaceId])

  const update = React.useCallback(async (viewId: string, patch: UpdateWorkItemViewInput) => {
    if (!workspaceId) return null
    const updated = await window.electronAPI.updateWorkItemView(workspaceId, viewId, patch)
    setViews((previous) => previous.map((view) => view.id === viewId ? updated : view))
    return updated
  }, [workspaceId])

  const remove = React.useCallback(async (viewId: string) => {
    if (!workspaceId) return
    await window.electronAPI.deleteWorkItemView(workspaceId, viewId)
    setViews((previous) => previous.filter((view) => view.id !== viewId))
  }, [workspaceId])

  return { views, isLoading, refresh, create, update, remove }
}
