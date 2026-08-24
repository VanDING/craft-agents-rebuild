import * as React from 'react'
import type { WorkItemEvent } from '@craft-agent/shared/work-items/browser'

export function useWorkItemEvents(workspaceId: string | null, workItemId: string | null) {
  const [events, setEvents] = React.useState<WorkItemEvent[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    if (!workspaceId || !workItemId) {
      setEvents([])
      setIsLoading(false)
      return
    }
    try {
      setIsLoading(true)
      setEvents(await window.electronAPI.listWorkItemEvents(workspaceId, workItemId))
    } catch (error) {
      console.error('[useWorkItemEvents] Failed to load events:', error)
    } finally {
      setIsLoading(false)
    }
  }, [workItemId, workspaceId])

  React.useEffect(() => { void refresh() }, [refresh])
  React.useEffect(() => {
    if (!workspaceId) return
    return window.electronAPI.onWorkItemsChanged((changedWorkspaceId) => {
      if (changedWorkspaceId === workspaceId) void refresh()
    })
  }, [refresh, workspaceId])

  return { events, isLoading, refresh }
}
