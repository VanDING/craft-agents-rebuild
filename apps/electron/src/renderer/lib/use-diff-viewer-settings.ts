/**
 * useDiffViewerSettings - Diff viewer display preferences.
 *
 * Loaded from ~/.craft-agent/preferences.json (diffViewer scope) and persisted
 * on change. Extracted from ChatDisplay's inline logic so the Review panel
 * shares the exact same settings source (the plan reuses the same stats/UI).
 */

import { useState, useEffect, useCallback } from 'react'
import type { DiffViewerSettings } from '@craft-agent/ui'

export interface ResolvedDiffViewerSettings {
  diffStyle: 'unified' | 'split'
  disableBackground: boolean
}

export function useDiffViewerSettings(): [
  ResolvedDiffViewerSettings,
  (settings: DiffViewerSettings) => void,
] {
  const [settings, setSettings] = useState<Partial<DiffViewerSettings>>({})

  useEffect(() => {
    let stale = false
    window.electronAPI.readPreferences().then(({ content }) => {
      if (stale) return
      try {
        const prefs = JSON.parse(content)
        if (prefs.diffViewer) setSettings(prefs.diffViewer)
      } catch {
        // Ignore parse errors, use defaults
      }
    })
    return () => { stale = true }
  }, [])

  const update = useCallback((next: DiffViewerSettings) => {
    setSettings(next)
    window.electronAPI.readPreferences().then(({ content }) => {
      try {
        const prefs = JSON.parse(content)
        prefs.diffViewer = next
        prefs.updatedAt = Date.now()
        window.electronAPI.writePreferences(JSON.stringify(prefs, null, 2))
      } catch {
        // Malformed preferences — write a fresh scope
        window.electronAPI.writePreferences(JSON.stringify({ diffViewer: next, updatedAt: Date.now() }, null, 2))
      }
    })
  }, [])

  return [
    { diffStyle: settings.diffStyle ?? 'unified', disableBackground: settings.disableBackground ?? false },
    update,
  ]
}
