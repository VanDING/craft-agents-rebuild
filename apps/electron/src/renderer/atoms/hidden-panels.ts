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
 * LRU tracking for foreground eviction uses `touchPanelActivity`, called by
 * NavigationContext's focus subscription and by the open/restore atoms below.
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
  MAX_FOREGROUND_PANELS,
  DEFAULT_PANEL_PROPORTION,
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
// Foreground LRU tracking
// =============================================================================

// id → last focus/activation timestamp. Entries never touched (e.g. restored
// from URL) sort as oldest. Module-level so it survives atom rehydration; the
// app touches ids through the focus subscription in NavigationContext.
const lastActiveAtById = new Map<string, number>()

/** Record that a panel was just focused/activated (LRU ordering). */
export function touchPanelActivity(panelId: string): void {
  lastActiveAtById.set(panelId, Date.now())
}

function lruScore(entry: PanelStackEntry): number {
  return lastActiveAtById.get(entry.id) ?? Number.NEGATIVE_INFINITY
}

/**
 * Least-recently-used foreground panel, preferring non-focused panels so an
 * open action never steals the panel the user is looking at.
 */
function findLruForeground(stack: PanelStackEntry[], focusedId: string | null): PanelStackEntry {
  const candidates = stack.filter((entry) => entry.id !== focusedId)
  const pool = candidates.length > 0 ? candidates : stack
  return pool.reduce((lru, entry) => (lruScore(entry) < lruScore(lru) ? entry : lru))
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
 * LRU-aware panel open:
 * - `replaceFocused` → updates the focused panel route (no LRU involved)
 * - foreground full → the LRU foreground panel moves into the hidden set
 * - then the new panel is pushed and focused (same normalize as pushPanelAtom)
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
      const replacedId = get(focusedPanelIdAtom)
      if (replacedId) touchPanelActivity(replacedId)
      return
    }

    if (stack.length >= MAX_FOREGROUND_PANELS) {
      const lru = findLruForeground(stack, focusedId)
      const hidden = get(hiddenPanelsAtom)
      set(hiddenPanelsAtom, [
        ...hidden,
        { id: lru.id, route: lru.route, panelType: lru.panelType, proportion: lru.proportion, hiddenAt: Date.now() },
      ])
      // Evict the LRU panel from the foreground BEFORE pushing the new one.
      set(panelStackAtom, stack.filter((entry) => entry.id !== lru.id))
    }

    set(pushPanelAtom, { route, intent: 'explicit' })
    const newId = get(focusedPanelIdAtom)
    if (newId) touchPanelActivity(newId)
  },
)

/**
 * Bring a hidden panel back to the foreground, preserving its id (React key
 * stability). When the foreground is full, the LRU foreground panel is moved
 * into the hidden set.
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
      const lru = findLruForeground(stack, focusedId)
      nextStack = stack.filter((item) => item.id !== lru.id)
      nextHidden = [...nextHidden, { id: lru.id, route: lru.route, panelType: lru.panelType, proportion: lru.proportion, hiddenAt: Date.now() }]
    }

    const restored = createPanelEntry(entry.route, entry.proportion, entry.id)
    set(panelStackAtom, normalizeProportions([...nextStack, restored]))
    set(focusedPanelIdAtom, entry.id)
    set(hiddenPanelsAtom, nextHidden)
    touchPanelActivity(entry.id)
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
        proportion: item.proportion ?? DEFAULT_PANEL_PROPORTION,
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
