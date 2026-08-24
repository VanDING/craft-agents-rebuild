import { atom } from 'jotai'
import { setExpandedWorkbenchItemAtom, workbenchStateAtom } from './workbench'

/**
 * Tracks whether a full-screen overlay is open (e.g., workspace creation).
 * Used by AppShell to apply a scale-back effect on the main content.
 */
export const fullscreenOverlayOpenAtom = atom(false)

/**
 * Expanded-panel overlay state (decision #6 — one-click fullscreen).
 *
 * When a panel is expanded, its slot is hidden with `display:none` (DOM kept)
 * and an ExpandedWorkbenchOverlay renders the same item fullscreen.
 * The id lives in an atom so the panel stack / overlay stay in sync; per-panel
 * UI state (selection, scroll) is lifted to atoms (content-panel-ui) so the
 * docked and expanded renderings show identical state.
 */

/**
 * Id of the active workbench item expanded into the fullscreen overlay.
 * Kept under the historic export name while callers migrate; the value is now
 * part of WorkbenchState so dock/fullscreen restoration cannot drift.
 */
export const expandedWorkbenchItemIdAtom = atom(
  (get) => get(workbenchStateAtom).expandedItemId,
  (_get, set, id: string | null) => set(setExpandedWorkbenchItemAtom, id),
)
