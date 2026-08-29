/**
 * Primary Surface + Context Workbench state.
 *
 * This is the authoritative v2 presentation model:
 * - exactly one Primary Surface owns application navigation;
 * - bound tools live as tabs in a docked Context Workbench;
 * - only the active workbench item is rendered;
 * - focus is visual/keyboard state and never changes the primary route.
 *
 * Legacy panel URLs are normalized once through `deriveSurfaceRestoreState`.
 */

import { atom } from 'jotai'
import { parseRouteToNavigationState } from '../../shared/route-parser'
import type { ViewRoute } from '../../shared/routes'
import type { BoundPanelType } from '../../shared/types'

export const PRIMARY_SURFACE_ID = 'primary-surface'

export const DEFAULT_WORKBENCH_WIDTH = 720
export const MIN_WORKBENCH_WIDTH = 520
export const MAX_WORKBENCH_WIDTH = 1200
export const MAX_FOREGROUND_CONVERSATIONS = 3

export type PrimarySurfaceKind = 'session' | 'project-management' | 'management'
export type SurfaceFocus = 'primary' | 'workbench'
export type SurfacePanelType =
  | 'session'
  | 'projects'
  | 'source'
  | 'settings'
  | 'skills'
  | 'automation'
  | BoundPanelType

export interface PrimarySurfaceState {
  route: ViewRoute
  kind: PrimarySurfaceKind
}

export type WorkbenchBinding =
  | { type: 'follow-primary' }
  | { type: 'session'; sessionId: string }
  | { type: 'workspace' }

export type WorkbenchKind = BoundPanelType | 'kanban' | 'calendar'

export interface WorkbenchItem {
  id: string
  route: ViewRoute
  kind: WorkbenchKind
  binding: WorkbenchBinding
}

export interface WorkbenchState {
  open: boolean
  activeItemId: string | null
  items: WorkbenchItem[]
  width: number
  expandedItemId: string | null
}

export interface SurfaceRenderEntry {
  id: string
  route: ViewRoute
  panelType: SurfacePanelType
  surfaceRole: 'primary' | 'workbench'
  sessionId?: string
}

export type SurfaceRouteClassification =
  | { role: 'primary'; kind: PrimarySurfaceKind }
  | { role: 'workbench'; kind: BoundPanelType }

export interface SurfaceRestoreState {
  primaryRoute: ViewRoute
  foregroundSessionIds?: string[]
  workbenchRoutes: ViewRoute[]
  activeWorkbenchRoute: ViewRoute | null
  workbenchOpen: boolean
  workbenchWidth?: number
}

let nextWorkbenchItemId = 0

function generateWorkbenchItemId(): string {
  return `workbench-${++nextWorkbenchItemId}-${Date.now()}`
}

export function clampWorkbenchWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_WORKBENCH_WIDTH
  return Math.min(MAX_WORKBENCH_WIDTH, Math.max(MIN_WORKBENCH_WIDTH, Math.round(width)))
}

export function classifySurfaceRoute(route: ViewRoute): SurfaceRouteClassification | null {
  const navState = parseRouteToNavigationState(route)
  if (!navState) return null

  switch (navState.navigator) {
    case 'sessions':
      return { role: 'primary', kind: 'session' }
    case 'projects':
      return { role: 'primary', kind: 'project-management' }
    case 'sources':
    case 'settings':
    case 'skills':
    case 'automations':
      return { role: 'primary', kind: 'management' }
    case 'other':
      return { role: 'workbench', kind: navState.panel }
  }
}

export function isPrimarySurfaceRoute(route: ViewRoute): boolean {
  return classifySurfaceRoute(route)?.role === 'primary'
}

export function isWorkbenchRoute(route: ViewRoute): boolean {
  return classifySurfaceRoute(route)?.role === 'workbench'
}

export function getSurfacePanelTypeFromRoute(route: ViewRoute): SurfacePanelType | null {
  const classification = classifySurfaceRoute(route)
  if (!classification) return null
  if (classification.role === 'workbench') return classification.kind
  if (classification.kind === 'session') return 'session'
  if (classification.kind === 'project-management') return 'projects'

  const root = route.split('/')[0]
  if (root === 'sources') return 'source'
  if (root === 'settings') return 'settings'
  if (root === 'skills') return 'skills'
  if (root === 'automations') return 'automation'
  return null
}

export function createPrimarySurfaceState(route: ViewRoute): PrimarySurfaceState {
  const classification = classifySurfaceRoute(route)
  if (classification?.role !== 'primary') {
    return { route: 'allSessions', kind: 'session' }
  }
  return { route, kind: classification.kind }
}

export function createWorkbenchItem(route: ViewRoute, id?: string): WorkbenchItem | null {
  const classification = classifySurfaceRoute(route)
  const navState = parseRouteToNavigationState(route)
  const projectCompanionKind = navState?.navigator === 'projects'
    ? navState.view === 'board'
      ? 'kanban'
      : navState.view === 'calendar'
        ? 'calendar'
        : null
    : null
  if (classification?.role !== 'workbench' && !projectCompanionKind) return null
  const kind = classification?.role === 'workbench' ? classification.kind : projectCompanionKind!
  return {
    id: id ?? generateWorkbenchItemId(),
    route,
    kind,
    binding: projectCompanionKind ? { type: 'workspace' } : { type: 'follow-primary' },
  }
}

/** Singleton utility panels dedupe by kind; each Artifact keeps its own route/tab. */
function workbenchIdentity(route: ViewRoute, kind: WorkbenchKind): string {
  return kind === 'artifact' ? route : kind
}

/**
 * Convert a legacy peer-panel list into the v2 surface contract.
 *
 * Multiple legacy primary panels cannot coexist in the new model. The focused
 * primary wins; otherwise the first primary route is retained. All bound panel
 * routes become workbench tabs, and a focused bound route becomes the active
 * tab. Session processes themselves remain in the session domain, so dropping
 * a background session *view* never stops or deletes that session.
 */
export function deriveSurfaceRestoreState(
  routes: readonly ViewRoute[],
  focusedIndex = 0,
  fallbackPrimaryRoute: ViewRoute = 'allSessions',
): SurfaceRestoreState {
  const focusedRoute = routes[Math.min(Math.max(focusedIndex, 0), Math.max(routes.length - 1, 0))]
  const focusedClassification = focusedRoute ? classifySurfaceRoute(focusedRoute) : null

  const firstPrimary = routes.find((route) => classifySurfaceRoute(route)?.role === 'primary')
  const primaryRoute = focusedClassification?.role === 'primary'
    ? focusedRoute
    : firstPrimary ?? fallbackPrimaryRoute

  const workbenchRoutes: ViewRoute[] = []
  const seenItems = new Set<string>()
  for (const route of routes) {
    const classification = classifySurfaceRoute(route)
    if (classification?.role !== 'workbench') continue
    const identity = workbenchIdentity(route, classification.kind)
    if (seenItems.has(identity)) continue
    seenItems.add(identity)
    workbenchRoutes.push(route)
  }

  const focusedWorkbenchRoute = focusedClassification?.role === 'workbench'
    ? focusedRoute
    : null

  return {
    primaryRoute,
    workbenchRoutes,
    activeWorkbenchRoute: focusedWorkbenchRoute ?? workbenchRoutes.at(-1) ?? null,
    workbenchOpen: workbenchRoutes.length > 0,
  }
}

export const primarySurfaceAtom = atom<PrimarySurfaceState>(
  createPrimarySurfaceState('allSessions'),
)

/**
 * Ordered, window-local presentation state for conversations placed side by
 * side. Session entities remain peers in the workspace; this list never
 * changes their data, lifecycle, or project membership.
 *
 * The session encoded by `primarySurfaceAtom` is the active foreground
 * conversation. Keeping activity in the existing Primary route preserves the
 * navigator, history, draft and bound-workbench semantics.
 */
export const foregroundSessionIdsAtom = atom<string[]>([])

export const workbenchStateAtom = atom<WorkbenchState>({
  open: false,
  activeItemId: null,
  items: [],
  width: DEFAULT_WORKBENCH_WIDTH,
  expandedItemId: null,
})

export const focusedSurfaceAtom = atom<SurfaceFocus>('primary')

export const activeWorkbenchItemAtom = atom<WorkbenchItem | null>((get) => {
  const state = get(workbenchStateAtom)
  if (!state.activeItemId) return null
  return state.items.find((item) => item.id === state.activeItemId) ?? null
})

export const renderedWorkbenchItemAtom = atom<WorkbenchItem | null>((get) => {
  const state = get(workbenchStateAtom)
  if (!state.open) return null
  return get(activeWorkbenchItemAtom)
})

export const renderedSurfaceEntriesAtom = atom<SurfaceRenderEntry[]>((get) => {
  const primary = get(primarySurfaceAtom)
  const workbench = get(renderedWorkbenchItemAtom)
  const activeSessionId = parseSessionIdFromSurfaceRoute(primary.route)
  const foregroundIds = get(foregroundSessionIdsAtom)
  const visibleConversationIds = activeSessionId
    ? (workbench
        ? [activeSessionId]
        : normalizeForegroundSessionIds(foregroundIds, activeSessionId))
    : []

  const primaryEntries: SurfaceRenderEntry[] = visibleConversationIds.length > 0
    ? visibleConversationIds.map((sessionId) => ({
        id: conversationSurfaceId(sessionId),
        route: routeForSession(primary.route, sessionId),
        panelType: 'session',
        surfaceRole: 'primary',
        sessionId,
      }))
    : [{
        id: PRIMARY_SURFACE_ID,
        route: primary.route,
        panelType: getSurfacePanelTypeFromRoute(primary.route) ?? 'session',
        surfaceRole: 'primary',
      }]

  if (!workbench) return primaryEntries
  return [
    ...primaryEntries,
    {
      id: workbench.id,
      route: workbench.route,
      panelType: workbench.kind === 'kanban' || workbench.kind === 'calendar'
        ? 'projects'
        : workbench.kind,
      surfaceRole: 'workbench',
    },
  ]
})

export const renderedSurfaceCountAtom = atom((get) => get(renderedSurfaceEntriesAtom).length)

export const focusedSurfaceEntryIdAtom = atom(
  (get) => {
    if (get(focusedSurfaceAtom) === 'workbench') {
      return get(activeWorkbenchItemAtom)?.id ?? PRIMARY_SURFACE_ID
    }
    const sessionId = get(primarySessionIdAtom)
    return sessionId ? conversationSurfaceId(sessionId) : PRIMARY_SURFACE_ID
  },
  (get, set, id: string | null) => {
    const active = get(activeWorkbenchItemAtom)
    set(focusedSurfaceAtom, id && active?.id === id ? 'workbench' : 'primary')
  },
)

export function parseSessionIdFromSurfaceRoute(route: ViewRoute): string | null {
  const segments = route.split('?')[0].split('/')
  const index = segments.indexOf('session')
  return index >= 0 && index + 1 < segments.length ? segments[index + 1] : null
}

export function conversationSurfaceId(sessionId: string): string {
  return `conversation-surface:${sessionId}`
}

export function parseSessionIdFromConversationSurfaceId(id: string): string | null {
  const prefix = 'conversation-surface:'
  return id.startsWith(prefix) ? id.slice(prefix.length) || null : null
}

function routeForSession(route: ViewRoute, sessionId: string): ViewRoute {
  const [pathname, query] = route.split('?')
  const encodedSessionId = encodeURIComponent(sessionId)
  const nextPath = pathname.includes('/session/')
    ? pathname.replace(/\/session\/[^/]+/, `/session/${encodedSessionId}`)
    : `${pathname}/session/${encodedSessionId}`
  return `${nextPath}${query ? `?${query}` : ''}` as ViewRoute
}

function normalizeForegroundSessionIds(ids: readonly string[], activeSessionId: string): string[] {
  const unique = ids.filter((id, index) => id && ids.indexOf(id) === index)
  if (!unique.includes(activeSessionId)) unique.push(activeSessionId)
  return unique.slice(-MAX_FOREGROUND_CONVERSATIONS)
}

export const primarySessionIdAtom = atom((get) => (
  parseSessionIdFromSurfaceRoute(get(primarySurfaceAtom).route)
))

export const visibleSessionIdsAtom = atom((get) => {
  const activeId = get(primarySessionIdAtom)
  if (!activeId) return new Set<string>()
  return new Set(normalizeForegroundSessionIds(get(foregroundSessionIdsAtom), activeId))
})

/** Add an ordinary session to the current window's side-by-side presentation. */
export const addForegroundSessionAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const activeId = get(primarySessionIdAtom)
    if (!activeId) return false
    const current = normalizeForegroundSessionIds(get(foregroundSessionIdsAtom), activeId)
    if (current.includes(sessionId)) {
      set(activateForegroundSessionAtom, sessionId)
      return true
    }
    const next = [...current, sessionId].slice(-MAX_FOREGROUND_CONVERSATIONS)
    set(foregroundSessionIdsAtom, next)
    set(activateForegroundSessionAtom, sessionId)
    return true
  },
)

/** Make a visible conversation active without changing the Session entity. */
export const activateForegroundSessionAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const primary = get(primarySurfaceAtom)
    if (primary.kind !== 'session') return false
    const ids = normalizeForegroundSessionIds(get(foregroundSessionIdsAtom), sessionId)
    set(foregroundSessionIdsAtom, ids)
    set(primarySurfaceAtom, createPrimarySurfaceState(routeForSession(primary.route, sessionId)))
    set(focusedSurfaceAtom, 'primary')
    return true
  },
)

export const removeForegroundSessionAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const activeId = get(primarySessionIdAtom)
    const current = get(foregroundSessionIdsAtom)
    if (!current.includes(sessionId) || current.length <= 1) return false
    const next = current.filter((id) => id !== sessionId)
    set(foregroundSessionIdsAtom, next)
    if (activeId === sessionId && next[0]) set(activateForegroundSessionAtom, next[0])
    return true
  },
)

export const focusNextSurfaceAtom = atom(
  null,
  (get, set) => {
    if (get(renderedWorkbenchItemAtom)) {
      set(focusedSurfaceAtom, get(focusedSurfaceAtom) === 'primary' ? 'workbench' : 'primary')
      return
    }
    const activeId = get(primarySessionIdAtom)
    if (!activeId) return
    const ids = normalizeForegroundSessionIds(get(foregroundSessionIdsAtom), activeId)
    if (ids.length <= 1) return
    const index = ids.indexOf(activeId)
    set(activateForegroundSessionAtom, ids[(index + 1) % ids.length])
  },
)

export const focusPreviousSurfaceAtom = atom(
  null,
  (get, set) => {
    if (get(renderedWorkbenchItemAtom)) {
      set(focusedSurfaceAtom, get(focusedSurfaceAtom) === 'primary' ? 'workbench' : 'primary')
      return
    }
    const activeId = get(primarySessionIdAtom)
    if (!activeId) return
    const ids = normalizeForegroundSessionIds(get(foregroundSessionIdsAtom), activeId)
    if (ids.length <= 1) return
    const index = ids.indexOf(activeId)
    set(activateForegroundSessionAtom, ids[(index - 1 + ids.length) % ids.length])
  },
)

export const setPrimarySurfaceRouteAtom = atom(
  null,
  (get, set, route: ViewRoute) => {
    const next = createPrimarySurfaceState(route)
    if (next.route !== route) {
      console.warn('[surface] Ignored non-primary route passed to Primary Surface:', route)
      return false
    }
    const previousSessionId = get(primarySessionIdAtom)
    const nextSessionId = parseSessionIdFromSurfaceRoute(route)
    if (nextSessionId) {
      const current = previousSessionId
        ? normalizeForegroundSessionIds(get(foregroundSessionIdsAtom), previousSessionId)
        : []
      if (current.includes(nextSessionId)) {
        set(foregroundSessionIdsAtom, current)
      } else if (previousSessionId && current.includes(previousSessionId)) {
        set(foregroundSessionIdsAtom, current.map((id) => id === previousSessionId ? nextSessionId : id))
      } else {
        set(foregroundSessionIdsAtom, [nextSessionId])
      }
    } else {
      // Comparison layout is suspended only by Workbench. Navigating Primary
      // to another application surface intentionally starts a fresh layout.
      set(foregroundSessionIdsAtom, [])
    }
    set(primarySurfaceAtom, next)
    set(focusedSurfaceAtom, 'primary')
    return true
  },
)

export const openWorkbenchItemAtom = atom(
  null,
  (get, set, route: ViewRoute) => {
    const candidate = createWorkbenchItem(route)
    if (!candidate) {
      console.warn('[workbench] Ignored non-workbench route:', route)
      return null
    }

    const current = get(workbenchStateAtom)
    const identity = workbenchIdentity(candidate.route, candidate.kind)
    const existing = current.items.find((item) => workbenchIdentity(item.route, item.kind) === identity)
    const item = existing ?? candidate
    set(workbenchStateAtom, {
      ...current,
      open: true,
      activeItemId: item.id,
      items: existing ? current.items : [...current.items, item],
    })
    set(focusedSurfaceAtom, 'workbench')
    return item.id
  },
)

export const activateWorkbenchItemAtom = atom(
  null,
  (get, set, id: string) => {
    const current = get(workbenchStateAtom)
    if (!current.items.some((item) => item.id === id)) return false
    set(workbenchStateAtom, { ...current, open: true, activeItemId: id })
    set(focusedSurfaceAtom, 'workbench')
    return true
  },
)

export const closeWorkbenchItemAtom = atom(
  null,
  (get, set, id: string) => {
    const current = get(workbenchStateAtom)
    const index = current.items.findIndex((item) => item.id === id)
    if (index === -1) return false

    const items = current.items.filter((item) => item.id !== id)
    const wasActive = current.activeItemId === id
    const nextActive = wasActive
      ? items[Math.min(index, items.length - 1)]?.id ?? null
      : current.activeItemId
    const open = current.open && items.length > 0

    set(workbenchStateAtom, {
      ...current,
      items,
      activeItemId: nextActive,
      open,
      expandedItemId: current.expandedItemId === id ? null : current.expandedItemId,
    })
    if (!open) set(focusedSurfaceAtom, 'primary')
    return true
  },
)

export const collapseWorkbenchAtom = atom(
  null,
  (get, set) => {
    const current = get(workbenchStateAtom)
    if (!current.open && current.expandedItemId === null) return false
    set(workbenchStateAtom, { ...current, open: false, expandedItemId: null })
    set(focusedSurfaceAtom, 'primary')
    return true
  },
)

export const toggleWorkbenchAtom = atom(
  null,
  (get, set) => {
    const current = get(workbenchStateAtom)
    if (current.open) {
      set(collapseWorkbenchAtom)
      return false
    }
    if (!current.activeItemId || current.items.length === 0) return false
    set(workbenchStateAtom, { ...current, open: true })
    set(focusedSurfaceAtom, 'workbench')
    return true
  },
)

export const setWorkbenchWidthAtom = atom(
  null,
  (get, set, width: number) => {
    const current = get(workbenchStateAtom)
    const nextWidth = clampWorkbenchWidth(width)
    if (current.width === nextWidth) return false
    set(workbenchStateAtom, { ...current, width: nextWidth })
    return true
  },
)

export const setExpandedWorkbenchItemAtom = atom(
  null,
  (get, set, id: string | null) => {
    const current = get(workbenchStateAtom)
    if (id !== null && !current.items.some((item) => item.id === id)) return false
    set(workbenchStateAtom, {
      ...current,
      expandedItemId: id,
      open: id === null ? current.open : true,
      activeItemId: id ?? current.activeItemId,
    })
    if (id) set(focusedSurfaceAtom, 'workbench')
    return true
  },
)

export const hydrateSurfaceStateAtom = atom(
  null,
  (get, set, restore: SurfaceRestoreState) => {
    const primary = createPrimarySurfaceState(restore.primaryRoute)
    const current = get(workbenchStateAtom)
    const items: WorkbenchItem[] = []
    const seenItems = new Set<string>()

    for (const route of restore.workbenchRoutes) {
      const candidate = createWorkbenchItem(route)
      if (!candidate) continue
      const identity = workbenchIdentity(candidate.route, candidate.kind)
      if (seenItems.has(identity)) continue
      seenItems.add(identity)
      const existing = current.items.find((item) => workbenchIdentity(item.route, item.kind) === identity)
      const item = createWorkbenchItem(route, existing?.id)
      if (item) items.push(existing ? { ...item, binding: existing.binding } : item)
    }

    const activeCandidate = restore.activeWorkbenchRoute
      ? createWorkbenchItem(restore.activeWorkbenchRoute)
      : null
    const activeItem = activeCandidate
      ? items.find((item) => workbenchIdentity(item.route, item.kind)
        === workbenchIdentity(activeCandidate.route, activeCandidate.kind))
      : null
    const activeItemId = activeItem?.id ?? items.at(-1)?.id ?? null
    const open = restore.workbenchOpen && activeItemId !== null

    set(primarySurfaceAtom, primary)
    const restoredSessionId = parseSessionIdFromSurfaceRoute(primary.route)
    set(
      foregroundSessionIdsAtom,
      restoredSessionId
        ? normalizeForegroundSessionIds(restore.foregroundSessionIds ?? [], restoredSessionId)
        : [],
    )
    set(workbenchStateAtom, {
      open,
      activeItemId,
      items,
      width: clampWorkbenchWidth(restore.workbenchWidth ?? current.width),
      expandedItemId: null,
    })
    set(focusedSurfaceAtom, 'primary')
    return true
  },
)
