/**
 * Content panel UI state lifted to global atoms.
 *
 * Per plan Task 11 (panel → fullscreen expansion must keep panel-local state,
 * e.g. the opened change / current preview entry) selections live here so the
 * same component instance renders identical state whether docked or expanded.
 */

import { atom } from 'jotai'
import type { WorkbenchFocus } from '@craft-agent/ui'

export type FilesPanelView = 'explorer' | 'changed' | 'opened' | 'activity' | 'attachments'

/** Active Files subview; lifted so triggered previews and fullscreen restoration agree. */
export const filesPanelViewAtom = atom<FilesPanelView>('explorer')

/** Persistent selection shared by the right-side evidence views, isolated per session. */
export const workbenchFocusBySessionAtom = atom<Record<string, WorkbenchFocus>>({})

/** Replace the current focus without leaking stale evidence fields or another session. */
export const updateWorkbenchFocusAtom = atom(
  null,
  (get, set, update: Omit<WorkbenchFocus, 'updatedAt'>) => {
    const current = get(workbenchFocusBySessionAtom)
    set(workbenchFocusBySessionAtom, {
      ...current,
      [update.sessionId]: { ...update, updatedAt: Date.now() },
    })
  },
)

export const clearWorkbenchFocusAtom = atom(null, (get, set, sessionId: string) => {
  const current = get(workbenchFocusBySessionAtom)
  if (!(sessionId in current)) return
  const next = { ...current }
  delete next[sessionId]
  set(workbenchFocusBySessionAtom, next)
})

export interface ChatFocusRequest {
  sessionId: string
  messageId: string
  nonce: number
}

/** Run inspector → Chat one-shot scroll request. */
export const chatFocusRequestAtom = atom<ChatFocusRequest | null>(null)

/** Files > Changed: currently expanded file section key per session. */
export const changedFilesSelectedKeyBySessionAtom = atom<Record<string, string | null>>({})

/**
 * Any evidence view → Files scroll/focus request.
 * `nonce` lets repeated requests for the same change re-fire; the panel
 * consumes (and clears) the request via an effect.
 */
export interface FilesPanelFocusRequest {
  sessionId: string
  view: FilesPanelView
  changeId?: string
  nonce: number
}
export const filesPanelFocusRequestAtom = atom<FilesPanelFocusRequest | null>(null)

/** PreviewPanel: currently selected preview entry key per session. */
export const previewPanelSelectedKeyBySessionAtom = atom<Record<string, string | null>>({})
