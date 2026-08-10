import { atom } from 'jotai'

/**
 * Tracks whether a full-screen overlay is open (e.g., workspace creation).
 * Used by AppShell to apply a scale-back effect on the main content.
 */
export const fullscreenOverlayOpenAtom = atom(false)

/**
 * Expanded-panel overlay state (decision #6 — one-click fullscreen).
 *
 * When a panel is expanded, its slot is hidden with `display:none` (DOM kept)
 * and an ExpandedPanelOverlay renders the same panel content fullscreen.
 * The id lives in an atom so the panel stack / overlay stay in sync; per-panel
 * UI state (selection, scroll) is lifted to atoms (content-panel-ui) so the
 * docked and expanded renderings show identical state.
 */

/** Id of the panel currently expanded into the fullscreen overlay (null = none). */
export const expandedPanelIdAtom = atom<string | null>(null)
