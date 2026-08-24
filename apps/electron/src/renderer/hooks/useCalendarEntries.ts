/**
 * useCalendarEntries — load and manage workspace calendar entries.
 *
 * Standalone schedule items (title/date/time/note), independent of sessions.
 * Auto-refreshes on workspace change and on the calendar:changed broadcast
 * (any window editing the calendar keeps every view in sync).
 */

import { useState, useEffect, useCallback } from 'react'
import type { CalendarEntry } from '@craft-agent/shared/protocol'

export interface UseCalendarEntriesResult {
  entries: CalendarEntry[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  create: (input: { title: string; date: string; time?: string; note?: string; projectId?: string }) => Promise<CalendarEntry | null>
  update: (entryId: string, input: { title: string; date: string; time?: string; note?: string; projectId?: string }) => Promise<CalendarEntry | null>
  remove: (entryId: string) => Promise<void>
}

export function useCalendarEntries(workspaceId: string | null): UseCalendarEntriesResult {
  const [entries, setEntries] = useState<CalendarEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setEntries([])
      setIsLoading(false)
      return
    }
    try {
      setIsLoading(true)
      const list = await window.electronAPI.listCalendarEntries(workspaceId)
      setEntries(list)
      setError(null)
    } catch (err) {
      console.error('[useCalendarEntries] Failed to load calendar entries:', err)
      setError(err instanceof Error ? err.message : 'Failed to load calendar entries')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Live updates: any window creating/editing/deleting entries refreshes all views.
  useEffect(() => {
    if (!workspaceId) return
    const cleanup = window.electronAPI.onCalendarEntriesChanged((changedWorkspaceId) => {
      if (changedWorkspaceId === workspaceId) refresh()
    })
    return cleanup
  }, [workspaceId, refresh])

  const create = useCallback(
    async (input: { title: string; date: string; time?: string; note?: string; projectId?: string }) => {
      if (!workspaceId) return null
      try {
        const entry = await window.electronAPI.createCalendarEntry(workspaceId, input)
        setEntries((prev) => [...prev, entry])
        return entry
      } catch (err) {
        console.error('[useCalendarEntries] Failed to create entry:', err)
        return null
      }
    },
    [workspaceId],
  )

  const update = useCallback(
    async (entryId: string, input: { title: string; date: string; time?: string; note?: string; projectId?: string }) => {
      if (!workspaceId) return null
      try {
        const entry = await window.electronAPI.updateCalendarEntry(workspaceId, entryId, input)
        setEntries((prev) => prev.map((e) => (e.id === entryId ? entry : e)))
        return entry
      } catch (err) {
        console.error('[useCalendarEntries] Failed to update entry:', err)
        return null
      }
    },
    [workspaceId],
  )

  const remove = useCallback(
    async (entryId: string) => {
      if (!workspaceId) return
      try {
        await window.electronAPI.deleteCalendarEntry(workspaceId, entryId)
        setEntries((prev) => prev.filter((e) => e.id !== entryId))
      } catch (err) {
        console.error('[useCalendarEntries] Failed to delete entry:', err)
      }
    },
    [workspaceId],
  )

  return { entries, isLoading, error, refresh, create, update, remove }
}
