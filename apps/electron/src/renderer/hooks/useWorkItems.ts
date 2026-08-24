import { useCallback, useEffect, useState } from 'react'
import type {
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItem,
} from '@craft-agent/shared/work-items/browser'

export interface UseWorkItemsResult {
  items: WorkItem[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  create: (input: CreateWorkItemInput) => Promise<WorkItem | null>
  update: (itemId: string, patch: UpdateWorkItemInput) => Promise<WorkItem | null>
  remove: (itemId: string) => Promise<void>
}

/** Workspace-scoped WorkItem collection with cross-window change refresh. */
export function useWorkItems(workspaceId: string | null): UseWorkItemsResult {
  const [items, setItems] = useState<WorkItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setItems([])
      setError(null)
      setIsLoading(false)
      return
    }
    try {
      setIsLoading(true)
      setItems(await window.electronAPI.listWorkItems(workspaceId))
      setError(null)
    } catch (cause) {
      console.error('[useWorkItems] Failed to load work items:', cause)
      setError(cause instanceof Error ? cause.message : 'Failed to load work items')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!workspaceId) return
    return window.electronAPI.onWorkItemsChanged((changedWorkspaceId) => {
      if (changedWorkspaceId === workspaceId) void refresh()
    })
  }, [workspaceId, refresh])

  const create = useCallback(async (input: CreateWorkItemInput) => {
    if (!workspaceId) return null
    try {
      const item = await window.electronAPI.createWorkItem(workspaceId, input)
      setItems((previous) => previous.some(({ id }) => id === item.id) ? previous : [...previous, item])
      return item
    } catch (cause) {
      console.error('[useWorkItems] Failed to create work item:', cause)
      return null
    }
  }, [workspaceId])

  const update = useCallback(async (itemId: string, patch: UpdateWorkItemInput) => {
    if (!workspaceId) return null
    try {
      const item = await window.electronAPI.updateWorkItem(workspaceId, itemId, patch)
      setItems((previous) => previous.map((candidate) => candidate.id === itemId ? item : candidate))
      return item
    } catch (cause) {
      console.error('[useWorkItems] Failed to update work item:', cause)
      return null
    }
  }, [workspaceId])

  const remove = useCallback(async (itemId: string) => {
    if (!workspaceId) return
    try {
      await window.electronAPI.deleteWorkItem(workspaceId, itemId)
      setItems((previous) => previous.filter(({ id }) => id !== itemId))
    } catch (cause) {
      console.error('[useWorkItems] Failed to delete work item:', cause)
    }
  }, [workspaceId])

  return { items, isLoading, error, refresh, create, update, remove }
}
