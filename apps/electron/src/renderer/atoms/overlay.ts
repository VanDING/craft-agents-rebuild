import { atom } from 'jotai'
import { setExpandedWorkbenchItemAtom, workbenchStateAtom } from './workbench'

/**
 * Tracks whether a full-screen overlay is open (e.g., workspace creation).
 * Used by AppShell to apply a scale-back effect on the main content.
 */
export const fullscreenOverlayOpenAtom = atom(false)

/** Compatibility alias for the workbench's content-area expansion state. */
export const expandedWorkbenchItemIdAtom = atom(
  (get) => get(workbenchStateAtom).expandedItemId,
  (_get, set, id: string | null) => set(setExpandedWorkbenchItemAtom, id),
)
