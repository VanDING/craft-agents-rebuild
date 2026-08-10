/**
 * Hidden Panel Set (background panels)
 *
 * Foreground stack + hidden set (decision #5):
 * - The foreground holds at most MAX_FOREGROUND_PANELS panels (URL-driven).
 * - Opening a 4th panel LRU-evicts the least-recently-used foreground panel
 *   into the hidden set (no layout footprint, unlimited size).
 * - Hidden panels are persisted per workspace (localStorage) and restored on
 *   app start and on workspace switch.
 * - Hidden-panel sessions keep the "background session" semantics: they are
 *   NOT part of visibleSessionIdsAtom, so a completed background session still
 *   raises the completion chip, and the empty-session cleanup treats them as
 *   visible (never auto-deletes a backgrounded empty session).
 *
 * Eviction uses a predictable leftmost-non-focused rule (decisions #6/#8) —
 * the main session at index 0 is never evicted, and session panels pin to
 * index 0 when that slot is free.
 */

import { atom } from 'jotai'
import * as storage from '@/lib/local-storage'
import type { ViewRoute } from '../../shared/routes'
import {
  panelStackAtom,
  focusedPanelIdAtom,
  pushPanelAtom,
  updateFocusedPanelRouteAtom,
  createPanelEntry,
  normalizeProportions,
  setEqualProportions,
  parseSessionIdFromRoute,
  MAX_FOREGROUND_PANELS,
  type PanelStackEntry,
  type PanelType,
} from './panel-stack'

// MAX_FOREGROUND_PANELS re-exported for consumers of the LRU layer.
export { MAX_FOREGROUND_PANELS }

export interface HiddenPanelEntry {
  id: string
  route: ViewRoute
  panelType: PanelType
  /** The panel's proportion before eviction (restored exactly on restore) */
  proportion: number
  /** When the panel was moved into the hidden set (LRU ordering aid) */
  hiddenAt: number
}

export const hiddenPanelsAtom = atom<HiddenPanelEntry[]>([])

// =============================================================================
// Foreground eviction
// =============================================================================

/**
 * Panel to evict when the foreground is full (decision #6): the leftmost
 * NON-focused panel, so a new window always appears on the right at a
 * predictable position. The main session (index 0, a route carrying a real
 * session id) is never evicted (decision #8); if every non-focused panel is
 * that main session, fall back to the leftmost non-index-0 panel, and finally
 * to the sole panel when everything is focused.
 *
 * NB: "session panel" is decided by parseSessionIdFromRoute — NOT
 * getPanelTypeFromRoute, which classifies board/calendar views (sessions
 * navigator modes) as 'session' too. Those views must stay evictable and must
 * not pin to index 0; only real chat-session routes do (deviation recorded in
 * the plan).
 */
function findPanelToEvict(stack: PanelStackEntry[], focusedId: string | null): PanelStackEntry {
  const isMainSession = (entry: PanelStackEntry, index: number) =>
    index === 0 && parseSessionIdFromRoute(entry.route) !== null

  const nonFocused = stack.findIndex((entry, index) => entry.id !== focusedId && !isMainSession(entry, index))
  if (nonFocused >= 0) return stack[nonFocused]

  const nonIndexZero = stack.findIndex((_entry, index) => index !== 0)
  if (nonIndexZero >= 0) return stack[nonIndexZero]

  // Single panel and it is focused — evicting it is the only option.
  return stack[stack.length - 1]
}

/** True when a session panel must land at index 0 (decision #8). */
function shouldPinSessionAtZero(stack: PanelStackEntry[], route: ViewRoute): boolean {
  return (
    parseSessionIdFromRoute(route) !== null &&
    stack.length > 0 &&
    parseSessionIdFromRoute(stack[0].route) === null
  )
}

// =============================================================================
// Open / restore / close
// =============================================================================

interface OpenPanelInput {
  route: ViewRoute
  /** Replace the focused panel's content instead of pushing (Shift/Alt click) */
  replaceFocused?: boolean
}

/**
 * Panel open with predictable eviction (decisions #6 + #8):
 * - `replaceFocused` → updates the focused panel route (no eviction involved)
 * - foreground full → the leftmost non-focused (never the main session at
 *   index 0) panel moves into the hidden set
 * - a session panel whose index 0 slot is not a session lands at index 0
 * - then the new panel is pushed, focused, and widths equalize
 */
export const openPanelAtom = atom(
  null,
  (get, set, { route, replaceFocused = false }: OpenPanelInput) => {
    const stack = get(panelStackAtom)
    const focusedId = get(focusedPanelIdAtom)

    if (replaceFocused) {
      // Replace the focused panel's content, preserving its id (same semantics
      // as the old full-view switch). Empty stack → creates the single panel.
      set(updateFocusedPanelRouteAtom, route)
      return
    }

    if (stack.length >= MAX_FOREGROUND_PANELS) {
      const victim = findPanelToEvict(stack, focusedId)
      const hidden = get(hiddenPanelsAtom)
      set(hiddenPanelsAtom, [
        ...hidden,
        { id: victim.id, route: victim.route, panelType: victim.panelType, proportion: victim.proportion, hiddenAt: Date.now() },
      ])
      // Evict the victim BEFORE pushing the new one.
      set(panelStackAtom, stack.filter((entry) => entry.id !== victim.id))
    }

    const insertAtIndex = shouldPinSessionAtZero(get(panelStackAtom), route) ? 0 : undefined
    set(pushPanelAtom, { route, intent: 'explicit', insertAtIndex })
  },
)

/**
 * Bring a hidden panel back to the foreground, preserving its id (React key
 * stability). When the foreground is full, the eviction rule from
 * findPanelToEvict applies (leftmost non-focused, never the main session at
 * index 0). A restored session panel whose index 0 slot is not a session
 * lands at index 0 (decision #8).
 */
export const restorePanelAtom = atom(
  null,
  (get, set, id: string) => {
    const hidden = get(hiddenPanelsAtom)
    const entry = hidden.find((item) => item.id === id)
    if (!entry) return

    const stack = get(panelStackAtom)
    const focusedId = get(focusedPanelIdAtom)
    let nextHidden = hidden.filter((item) => item.id !== id)
    let nextStack = stack

    if (stack.length >= MAX_FOREGROUND_PANELS) {
      const victim = findPanelToEvict(stack, focusedId)
      nextStack = stack.filter((item) => item.id !== victim.id)
      nextHidden = [...nextHidden, { id: victim.id, route: victim.route, panelType: victim.panelType, proportion: victim.proportion, hiddenAt: Date.now() }]
    }

    const restored = createPanelEntry(entry.route, entry.proportion, entry.id)
    const insertAtIndex = shouldPinSessionAtZero(nextStack, entry.route) ? 0 : nextStack.length
    const combined = [...nextStack.slice(0, insertAtIndex), restored, ...nextStack.slice(insertAtIndex)]
    // Count change → equal widths (decision #2); the saved proportion is
    // intentionally ignored so a restored panel re-enters at 1/N.
    set(panelStackAtom, setEqualProportions(combined))
    set(focusedPanelIdAtom, entry.id)
    set(hiddenPanelsAtom, nextHidden)
  },
)

/** Close a hidden panel without touching the foreground. */
export const closeHiddenPanelAtom = atom(
  null,
  (get, set, id: string) => {
    set(hiddenPanelsAtom, get(hiddenPanelsAtom).filter((item) => item.id !== id))
  },
)

// =============================================================================
// Persistence (per workspace) + reconcile helpers
// =============================================================================

interface PersistedHiddenPanel {
  route: ViewRoute
  panelType: PanelType
  /** Proportion before eviction (older persisted entries may omit it) */
  proportion?: number
}

/** Fallback metadata proportion for persisted entries without one (restore ignores it — 均分). */
const FALLBACK_HIDDEN_PROPORTION = 1 / 3

/** Load + hydrate the hidden set for a workspace (startup & workspace switch). */
export const restoreHiddenPanelsForWorkspaceAtom = atom(
  null,
  (get, set, workspaceSlug: string | null) => {
    if (!workspaceSlug) {
      set(hiddenPanelsAtom, [])
      return
    }
    const persisted = storage.get<PersistedHiddenPanel[]>(storage.KEYS.hiddenPanels, [], workspaceSlug)
    const now = Date.now()
    set(
      hiddenPanelsAtom,
      persisted.map((item, index) => ({
        id: `hidden-${now}-${index}`,
        route: item.route,
        panelType: item.panelType,
        proportion: item.proportion ?? FALLBACK_HIDDEN_PROPORTION,
        hiddenAt: now,
      })),
    )
  },
)

/** Persist the hidden set for a workspace (called on every hidden set change). */
export const persistHiddenPanelsAtom = atom(
  null,
  (get, _set, workspaceSlug: string | null) => {
    if (!workspaceSlug) return
    const hidden = get(hiddenPanelsAtom)
    storage.set(
      storage.KEYS.hiddenPanels,
      hidden.map((item) => ({ route: item.route, panelType: item.panelType, proportion: item.proportion })),
      workspaceSlug,
    )
  },
)

/**
 * Back/forward consistency (decision #5, plan Task 5 Step 3):
 * the hidden set lives in localStorage, not the URL. After the foreground is
 * reconciled from a history entry (which may include panels that were evicted
 * to the hidden set), remove any hidden entry whose route is now in the
 * foreground — the same panel must never exist in both sets.
 */
export const dedupeHiddenPanelsAtom = atom(
  null,
  (get, set) => {
    const foregroundRoutes = new Set(get(panelStackAtom).map((entry) => entry.route))
    const hidden = get(hiddenPanelsAtom)
    const next = hidden.filter((item) => !foregroundRoutes.has(item.route))
    if (next.length !== hidden.length) {
      set(hiddenPanelsAtom, next)
    }
  },
)
