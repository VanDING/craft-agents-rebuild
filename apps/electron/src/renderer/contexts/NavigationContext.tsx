/**
 * NavigationContext
 *
 * Provides a global `navigate()` function that decouples components from
 * direct session/action imports. All navigation goes through typed routes.
 *
 * SURFACE MODEL:
 * Exactly one Primary Surface drives NavigationState. Bound tools are Context
 * Workbench tabs and never replace global navigation merely because they gain
 * keyboard focus.
 *
 * URL-DRIVEN HISTORY:
 * The URL is the source of truth. Every meaningful navigation pushes a
 * browser history entry via pushState. Back/forward uses the browser's
 * native popstate, with smart panel reconciliation to preserve React keys
 * (and thus scroll position, streaming state, etc.).
 *
 * Usage:
 *   import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
 *   import { routes } from '@/shared/routes'
 *
 *   const { navigate } = useNavigation()
 *   const navState = useNavigationState()
 *
 *   navigate(routes.view.allSessions())
 *   navigate(routes.action.newChat())
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useSession } from '@/hooks/useSession'
import { useLabels } from '@/hooks/useLabels'
import { matchesLabelFilter } from '@craft-agent/shared/labels'
import {
  parseRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
  type ParsedRoute,
} from '../../shared/route-parser'
import { routes, type Route, type ViewRoute } from '../../shared/routes'
import { parsePermissionMode } from '@craft-agent/shared/agent/mode-types'
import { NAVIGATE_EVENT, type NavigateOptions } from '../lib/navigate'
import { normalizePanelRouteForReconcile } from './navigation-reconcile'
import { buildSemanticHistoryKey, canRunInitialRestore } from './navigation-history'
import {
  legacySidebarToWorkbenchRoute,
  parseSurfaceUrlParams,
  writeSurfaceUrlParams,
} from './surface-url'
import * as storage from '@/lib/local-storage'
import type {
  DeepLinkNavigation,
  Session,
  NavigationState,
  SessionFilter,
  SourceFilter,
  ContentBadge,
} from '../../shared/types'
import {
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isAutomationsNavigation,
  isProjectsNavigation,
  DEFAULT_NAVIGATION_STATE,
} from '../../shared/types'
import { sessionMetaMapAtom, updateSessionMetaAtom, type SessionMeta } from '@/atoms/sessions'
import { sourcesAtom } from '@/atoms/sources'
import { skillsAtom } from '@/atoms/skills'
import {
  activateForegroundSessionAtom,
  addForegroundSessionAtom,
  deriveSurfaceRestoreState,
  foregroundSessionIdsAtom,
  hydrateSurfaceStateAtom,
  openWorkbenchItemAtom,
  primarySurfaceAtom,
  primarySessionIdAtom,
  parseSessionIdFromSurfaceRoute,
  setPrimarySurfaceRouteAtom,
  workbenchStateAtom,
  type WorkbenchState,
} from '@/atoms/workbench'
import { lastActiveSessionIdAtom } from '@/atoms/active-session'

// Re-export routes for convenience
export { routes }
export type { Route }

// Re-export navigation state types for consumers
export type { NavigationState, SessionFilter }
export { isSessionsNavigation, isSourcesNavigation, isSettingsNavigation, isSkillsNavigation, isAutomationsNavigation, isProjectsNavigation }

// =============================================================================
// Context
// =============================================================================

interface NavigationContextValue {
  /** Navigate to a route */
  navigate: (route: Route, options?: NavigateOptions) => void | Promise<void>
  /** Check if navigation is ready */
  isReady: boolean
  /** Unified navigation state — derived only from the Primary Surface */
  navigationState: NavigationState
  /** Whether we can go back in history */
  canGoBack: boolean
  /** Whether we can go forward in history */
  canGoForward: boolean
  /** Go back in history */
  goBack: () => void
  /** Go forward in history */
  goForward: () => void
  /** Navigate to a source (or source list if no slug), preserving the current filter type */
  navigateToSource: (sourceSlug?: string) => void
  /** Navigate to a session, preserving the current filter type */
  navigateToSession: (sessionId: string) => void
}

export const NavigationContext = createContext<NavigationContextValue | null>(null)

interface NavigationProviderProps {
  children: ReactNode
  /** Current workspace ID */
  workspaceId: string | null
  /** Current workspace slug (used for URL ?ws= param and localStorage) */
  workspaceSlug: string | null
  /** Switch to a workspace by slug (called on popstate when ?ws= changes) */
  onSwitchWorkspaceBySlug?: (slug: string) => void
  /** Session creation handler */
  onCreateSession: (workspaceId: string, options?: import('../../shared/types').CreateSessionOptions) => Promise<Session>
  /** Input change handler for pre-filling chat input */
  onInputChange?: (sessionId: string, value: string) => void
  /** Get draft input text for a session (reads from ref, no re-render) */
  getDraft?: (sessionId: string) => string
  /** Auto-delete an empty session (no confirmation needed) */
  onAutoDeleteEmptySession?: (sessionId: string) => void
  /** Whether the app is ready to navigate */
  isReady?: boolean
  /** Whether session metadata has been initialized (required for deterministic route restoration) */
  isSessionsReady?: boolean
  /** Remote workspace ID — when set, sessions with this ID are also considered part of the workspace */
  remoteWorkspaceId?: string | null
}

export function NavigationProvider({
  children,
  workspaceId,
  workspaceSlug,
  onSwitchWorkspaceBySlug,
  onCreateSession,
  onInputChange,
  getDraft,
  onAutoDeleteEmptySession,
  isReady = true,
  isSessionsReady = true,
  remoteWorkspaceId,
}: NavigationProviderProps) {
  const { t } = useTranslation()
  const [, setSession] = useSession()

  // Read session metadata directly from atom (reactive to session changes)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionMetas = useMemo(() => Array.from(sessionMetaMap.values()), [sessionMetaMap])
  const updateSessionMeta = useSetAtom(updateSessionMetaAtom)
  // Label tree for filter matching (auto-select must agree with the visible list).
  const { labels: labelConfigs } = useLabels(workspaceId)

  // Store reference for reading fresh atom values in callbacks (avoids stale closures)
  const store = useStore()

  // Read sources from atom (populated by AppShell)
  const sources = useAtomValue(sourcesAtom)

  // Read skills from atom (populated by AppShell)
  const skills = useAtomValue(skillsAtom)

  // =========================================================================
  // DERIVED NAVIGATION STATE (from Primary Surface)
  // =========================================================================

  const primarySurface = useAtomValue(primarySurfaceAtom)
  const foregroundSessionIds = useAtomValue(foregroundSessionIdsAtom)

  // NavigationState is structural: workbench focus never changes it.
  const navigationState: NavigationState = useMemo(() => {
    return parseRouteToNavigationState(primarySurface.route) ?? DEFAULT_NAVIGATION_STATE
  }, [primarySurface.route])

  // Active-session memory: every time Primary is a session, remember
  // it as the "last active session". Bound panels (Review/Files/Context/Preview)
  // follow `activeSessionIdAtom = focused ?? last` so they never drift while the
  // Primary switches to project-management or a management surface.
  const focusedSessionId = useAtomValue(primarySessionIdAtom)
  const setLastActiveSession = useSetAtom(lastActiveSessionIdAtom)
  useEffect(() => {
    if (focusedSessionId) setLastActiveSession(focusedSessionId)
  }, [focusedSessionId, setLastActiveSession])

  useEffect(() => {
    if (!isSessionsReady || foregroundSessionIds.length === 0) return
    const surviving = foregroundSessionIds.filter((id) => sessionMetaMap.has(id))
    if (surviving.length === foregroundSessionIds.length) return
    store.set(foregroundSessionIdsAtom, surviving)
    if (focusedSessionId && !sessionMetaMap.has(focusedSessionId) && surviving[0]) {
      store.set(activateForegroundSessionAtom, surviving[0])
    }
  }, [focusedSessionId, foregroundSessionIds, isSessionsReady, sessionMetaMap, store])

  // =========================================================================
  // BROWSER HISTORY TRACKING
  // =========================================================================

  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  // Sequence numbers stored in history.state for tracking position
  const historySeqRef = useRef(0)                // Current history position
  const historyMaxSeqRef = useRef(0)              // Highest pushed seq (for canGoForward)
  const nextHistorySeqRef = useRef(1)             // Next seq to assign on pushState

  // Suppress pushState in atom subscriptions during restore/reconciliation
  const suppressPushRef = useRef(false)

  // Coalesce compound Primary/Workbench atom writes into one history entry.
  const pendingPushRef = useRef(false)

  // Flag: workspace switch was triggered by popstate (URL already correct)
  const isPopstateSwitchRef = useRef(false)

  // Queue navigation if not ready yet
  const pendingNavigationRef = useRef<ParsedRoute | null>(null)

  // Suppress auto-select for one cycle (used by skipAutoSelect to prevent the effect from re-selecting)
  const suppressAutoSelectRef = useRef(false)

  // Track whether initial route restoration has been attempted
  const initialRouteRestoredRef = useRef(false)

  // Semantic key for the last history entry we intentionally pushed/reconciled.
  // Excludes layout-only values (like panel proportions) so resize does not create history entries.
  const lastSemanticHistoryKeyRef = useRef('')

  const updateCanGoBackForward = useCallback(() => {
    setCanGoBack(historySeqRef.current > 0)
    setCanGoForward(historySeqRef.current < historyMaxSeqRef.current)
  }, [])

  const getSemanticHistoryKey = useCallback(() => {
    const primary = store.get(primarySurfaceAtom)
    const workbench = store.get(workbenchStateAtom)
    const foregroundIds = store.get(foregroundSessionIdsAtom)
    const activeIndex = workbench.items.findIndex((item) => item.id === workbench.activeItemId)
    const focusedIdx = workbench.open && activeIndex >= 0 ? activeIndex + 1 : 0
    return buildSemanticHistoryKey({
      workspaceSlug,
      panelRoutes: [primary.route, ...foregroundIds.map((id) => `foreground/${id}`), ...workbench.items.map((item) => item.route)],
      focusedPanelIndex: focusedIdx,
      sidebarParam: '',
    })
  }, [store, workspaceSlug])

  // =========================================================================
  // URL SYNC (builds URL from current state, push or replace)
  // =========================================================================

  /**
   * Build the current URL from atom state and either push or replace.
   *
   * push=true: creates a new browser history entry (meaningful navigation)
   * push=false: updates the current entry (resize, auto-select, etc.)
   *
   * Also persists the URL per-workspace in localStorage for workspace switch restoration.
   */
  const syncUrl = useCallback((push: boolean = false) => {
    const primary = store.get(primarySurfaceAtom)
    const workbench = store.get(workbenchStateAtom)
    const foregroundIds = store.get(foregroundSessionIdsAtom)
    const url = new URL(window.location.href)

    // ?ws= workspace slug
    if (workspaceSlug) {
      url.searchParams.set('ws', workspaceSlug)
    }

    writeSurfaceUrlParams(url.searchParams, primary, workbench, foregroundIds)

    // v1 right-sidebar state is migrated into Workbench tabs on restore.
    url.searchParams.delete('sidebar')

    const urlStr = url.toString()

    if (push) {
      const seq = nextHistorySeqRef.current++
      history.pushState({ seq }, '', urlStr)
      historySeqRef.current = seq
      historyMaxSeqRef.current = seq // Forward history discarded by browser
      updateCanGoBackForward()
    } else {
      history.replaceState({ ...history.state, seq: historySeqRef.current }, '', urlStr)
    }

    // Persist per-workspace URL for workspace switch restoration
    if (workspaceSlug) {
      storage.set(storage.KEYS.workspaceUrl, url.search, workspaceSlug)
    }
  }, [store, workspaceSlug, updateCanGoBackForward])

  const syncUrlRef = useRef(syncUrl)
  useEffect(() => { syncUrlRef.current = syncUrl }, [syncUrl])

  const maybePushHistoryForSemanticChange = useCallback(() => {
    const currentSemanticKey = getSemanticHistoryKey()
    if (currentSemanticKey === lastSemanticHistoryKeyRef.current) return

    syncUrlRef.current?.(true)
    lastSemanticHistoryKeyRef.current = currentSemanticKey
  }, [getSemanticHistoryKey])

  // replaceState sync catches companion width and other layout-only changes.
  const workbenchState = useAtomValue(workbenchStateAtom)
  useEffect(() => {
    if (!initialRouteRestoredRef.current) return
    syncUrlRef.current(false)
  }, [primarySurface, workbenchState])

  // =========================================================================
  // ATOM SUBSCRIPTIONS FOR pushState (meaningful navigation)
  // =========================================================================

  // Primary route changes are semantic navigation.
  useEffect(() => {
    let previousRoute = store.get(primarySurfaceAtom).route
    const unsub = store.sub(primarySurfaceAtom, () => {
      const currentRoute = store.get(primarySurfaceAtom).route
      if (suppressPushRef.current || !initialRouteRestoredRef.current) {
        previousRoute = currentRoute
        return
      }
      if (currentRoute !== previousRoute) {
        if (!pendingPushRef.current) {
          pendingPushRef.current = true
          queueMicrotask(() => { pendingPushRef.current = false; maybePushHistoryForSemanticChange() })
        }
      }
      previousRoute = currentRoute
    })
    return unsub
  }, [store, maybePushHistoryForSemanticChange])

  // Workbench tab/open changes are semantic; pixel width is layout-only.
  useEffect(() => {
    const semanticKey = (state: WorkbenchState) => [
      state.items.map((item) => item.route).join('|'),
      state.activeItemId ?? '',
      state.open ? '1' : '0',
    ].join('::')
    let previousKey = semanticKey(store.get(workbenchStateAtom))
    const unsub = store.sub(workbenchStateAtom, () => {
      const currentKey = semanticKey(store.get(workbenchStateAtom))
      if (suppressPushRef.current || !initialRouteRestoredRef.current) {
        previousKey = currentKey
        return
      }
      if (currentKey !== previousKey) {
        if (!pendingPushRef.current) {
          pendingPushRef.current = true
          queueMicrotask(() => { pendingPushRef.current = false; maybePushHistoryForSemanticChange() })
        }
      }
      previousKey = currentKey
    })
    return unsub
  }, [store, maybePushHistoryForSemanticChange])

  // Foreground conversation membership/order is semantic window layout.
  useEffect(() => {
    let previousKey = store.get(foregroundSessionIdsAtom).join('|')
    const unsub = store.sub(foregroundSessionIdsAtom, () => {
      const currentKey = store.get(foregroundSessionIdsAtom).join('|')
      if (suppressPushRef.current || !initialRouteRestoredRef.current) {
        previousKey = currentKey
        return
      }
      if (currentKey !== previousKey && !pendingPushRef.current) {
        pendingPushRef.current = true
        queueMicrotask(() => { pendingPushRef.current = false; maybePushHistoryForSemanticChange() })
      }
      previousKey = currentKey
    })
    return unsub
  }, [store, maybePushHistoryForSemanticChange])

  // =========================================================================
  // RECONCILE PRIMARY + WORKBENCH FROM URL PARAMS
  // =========================================================================

  /**
   * Parses the v2 surface URL. A one-window migration also accepts legacy
   * `panels`/`fi` plus the old hidden-panel localStorage payload.
   */
  const reconcileFromUrlParams = useCallback(
    (params: URLSearchParams) => {
      const sidebarParam = params.get('sidebar') || undefined

      const normalizeRoute = (rawRoute: string): ViewRoute => normalizePanelRouteForReconcile(
        rawRoute as ViewRoute,
        (state) => resolveAutoSelectionRef.current(state),
      )

      const fallbackPrimaryRoute = store.get(primarySurfaceAtom).route
      const parsedSurface = parseSurfaceUrlParams(params, {
        fallbackPrimaryRoute,
        normalizeRoute,
      })
      // A bare legacy URL can still carry `sidebar` or hidden Workbench items.
      // Start from a valid Primary fallback so those migrations are not lost.
      let restore = parsedSurface?.restore
        ?? deriveSurfaceRestoreState([], 0, fallbackPrimaryRoute)

      // Migrate the discontinued right-sidebar URL into a real Workbench tab.
      if (sidebarParam) {
        const migratedRoute = legacySidebarToWorkbenchRoute(sidebarParam)
        if (migratedRoute && !restore.workbenchRoutes.includes(migratedRoute)) {
          restore = {
            ...restore,
            workbenchRoutes: [...restore.workbenchRoutes, migratedRoute],
            activeWorkbenchRoute: migratedRoute,
            workbenchOpen: true,
          }
        }
      }

      // One-time migration of old background bound panels into lightweight
      // workbench tabs. Primary/session entries are intentionally ignored.
      if (parsedSurface?.source !== 'v2' && workspaceSlug) {
        const legacyHidden = storage.get<Array<{ route?: ViewRoute }>>(
          storage.KEYS.hiddenPanels,
          [],
          workspaceSlug,
        )
        if (legacyHidden.length > 0) {
          const merged = [...restore.workbenchRoutes]
          for (const entry of legacyHidden) {
            if (!entry.route) continue
            const candidate = deriveSurfaceRestoreState([normalizeRoute(entry.route)], 0, restore.primaryRoute)
            for (const route of candidate.workbenchRoutes) {
              if (!merged.includes(route)) merged.push(route)
            }
          }
          restore = {
            ...restore,
            workbenchRoutes: merged,
            activeWorkbenchRoute: restore.activeWorkbenchRoute ?? merged.at(-1) ?? null,
            workbenchOpen: restore.workbenchOpen || merged.length > 0,
          }
          storage.remove(storage.KEYS.hiddenPanels, workspaceSlug)
        }
      }

      store.set(hydrateSurfaceStateAtom, restore)
    },
    [store, workspaceSlug]
  )

  // Keep ref fresh for use in event handlers / effects that capture stale closures
  const reconcileFromUrlParamsRef = useRef(reconcileFromUrlParams)
  useEffect(() => { reconcileFromUrlParamsRef.current = reconcileFromUrlParams }, [reconcileFromUrlParams])

  // =========================================================================
  // EMPTY SESSION CLEANUP (reactive — covers navigate, close tab, etc.)
  // =========================================================================

  // Track every conversation retained by the current foreground layout.
  const prevVisibleSessionIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = new Set<string>(foregroundSessionIds)
    const primarySessionId = parseSessionIdFromSurfaceRoute(primarySurface.route)
    if (primarySessionId) currentIds.add(primarySessionId)

    // Only check after we've seen at least one set of IDs
    // (skip first render to avoid false positives during initialization)
    if (onAutoDeleteEmptySession && prevVisibleSessionIdsRef.current.size > 0) {
      for (const prevId of prevVisibleSessionIdsRef.current) {
        if (!currentIds.has(prevId)) {
          const meta = store.get(sessionMetaMapAtom).get(prevId)
          const isEmpty = meta && !meta.lastFinalMessageId && !meta.name && !meta.isProcessing
          const hasDraft = getDraft?.(prevId)?.trim()
          if (isEmpty && !hasDraft) {
            onAutoDeleteEmptySession(prevId)
          }
        }
      }
    }

    prevVisibleSessionIdsRef.current = currentIds
  }, [foregroundSessionIds, primarySurface.route, onAutoDeleteEmptySession, store, getDraft])

  // =========================================================================
  // SESSION SELECTION SYNC
  // =========================================================================

  // Keep the global session selection in sync with Primary.
  useEffect(() => {
    if (isSessionsNavigation(navigationState) && navigationState.details) {
      setSession({ selected: navigationState.details.sessionId })
      if (workspaceId) {
        // Only persist if the session belongs to this workspace (prevents cross-workspace
        // pollution during workspace switch, when workspaceId changed but navigationState
        // still reflects the previous workspace's Primary route)
        const meta = store.get(sessionMetaMapAtom).get(navigationState.details.sessionId)
        if (meta && meta.workspaceId === workspaceId) {
          storage.set(storage.KEYS.lastSelectedSessionId, navigationState.details.sessionId, workspaceId)
        }
      }
    }
  }, [navigationState, setSession, workspaceId, store])

  // =========================================================================
  // HELPERS
  // =========================================================================

  // Helper: Filter sessions by SessionFilter
  // Always excludes hidden sessions - they should never appear in navigation
  const filterSessionsByFilter = useCallback(
    (filter: SessionFilter): SessionMeta[] => {
      // First filter out hidden sessions - they should never appear in any view
      const visibleSessions = sessionMetas.filter(
        s => !s.hidden && (!workspaceId || s.workspaceId === workspaceId)
      )

      return visibleSessions.filter((session) => {
        switch (filter.kind) {
          case 'allSessions':
            return session.isArchived !== true
          case 'flagged':
            return session.isFlagged === true && session.isArchived !== true
          case 'archived':
            return session.isArchived === true
          case 'state':
            return session.sessionStatus === filter.stateId && session.isArchived !== true
          case 'label': {
            if (session.isArchived === true) return false
            // Shared predicate — descendant-aware and project-scoped, matching
            // exactly what the session list renders (auto-select must agree).
            return matchesLabelFilter(session, filter, labelConfigs)
          }
          case 'view':
            if (session.isArchived === true) return false
            return true
          default:
            return false
        }
      })
    },
    [sessionMetas, workspaceId, labelConfigs]
  )

  const getFirstSessionId = useCallback(
    (filter: SessionFilter): string | null => {
      const filtered = filterSessionsByFilter(filter)
      return filtered[0]?.id ?? null
    },
    [filterSessionsByFilter]
  )

  const getLastSelectedSessionId = useCallback(
    (filter: SessionFilter): string | null => {
      if (!workspaceId) return null
      const storedId = storage.get<string | null>(
        storage.KEYS.lastSelectedSessionId,
        null,
        workspaceId
      )
      if (!storedId) return null
      const filtered = filterSessionsByFilter(filter)
      return filtered.some(session => session.id === storedId) ? storedId : null
    },
    [workspaceId, filterSessionsByFilter]
  )

  const getFirstSourceSlug = useCallback(
    (filter?: SourceFilter | null): string | null => {
      if (!filter) {
        return sources[0]?.config.slug ?? null
      }
      const filtered = sources.filter(s => s.config.type === filter.sourceType)
      return filtered[0]?.config.slug ?? null
    },
    [sources]
  )

  const getFirstSkillSlug = useCallback(
    (): string | null => {
      return skills[0]?.slug ?? null
    },
    [skills]
  )

  // =========================================================================
  // AUTO-SELECTION (pure computation, no side effects)
  // =========================================================================

  /**
   * Resolve auto-selection for a NavigationState.
   * When navigating to a filter without explicit details, auto-select the
   * first available item. Returns the final state (no side effects).
   */
  const resolveAutoSelection = useCallback(
    (newState: NavigationState, options?: { skipAutoSelect?: boolean }): NavigationState => {
      let nextState = newState

      // Validate session exists in current workspace (local or remote ID)
      if (isSessionsNavigation(nextState) && nextState.details) {
        const freshMetaMap = store.get(sessionMetaMapAtom)
        const meta = freshMetaMap.get(nextState.details.sessionId)
        const matchesWorkspace = !workspaceId
          || meta?.workspaceId === workspaceId
          || (remoteWorkspaceId && meta?.workspaceId === remoteWorkspaceId)
        if (!meta || !matchesWorkspace) {
          nextState = { ...nextState, details: null }
        }
      }

      // Sessions: auto-select last/first session. Project-management views are
      // a separate navigator, so this branch no longer needs view-mode guards.
      if (
        isSessionsNavigation(nextState) &&
        !nextState.details &&
        !options?.skipAutoSelect
      ) {
        const lastSelectedSessionId = getLastSelectedSessionId(nextState.filter)
        const fallbackSessionId = lastSelectedSessionId ?? getFirstSessionId(nextState.filter)
        if (fallbackSessionId) {
          return { ...nextState, details: { type: 'session', sessionId: fallbackSessionId } }
        }
        return nextState
      }

      // Sources: auto-select first source
      if (isSourcesNavigation(nextState) && !nextState.details && !options?.skipAutoSelect) {
        const firstSourceSlug = getFirstSourceSlug(nextState.filter)
        if (firstSourceSlug) {
          return { ...nextState, details: { type: 'source', sourceSlug: firstSourceSlug } }
        }
        return nextState
      }

      // Skills: auto-select first skill
      if (isSkillsNavigation(nextState) && !nextState.details && !options?.skipAutoSelect) {
        const firstSkillSlug = getFirstSkillSlug()
        if (firstSkillSlug) {
          return { ...nextState, details: { type: 'skill', skillSlug: firstSkillSlug } }
        }
        return nextState
      }

      return nextState
    },
    [store, workspaceId, remoteWorkspaceId, getLastSelectedSessionId, getFirstSessionId, getFirstSourceSlug, getFirstSkillSlug]
  )

  // Ref keeps resolveAutoSelection fresh for reconcileFromUrlParams (defined earlier in the file)
  const resolveAutoSelectionRef = useRef(resolveAutoSelection)
  useEffect(() => { resolveAutoSelectionRef.current = resolveAutoSelection }, [resolveAutoSelection])

  // =========================================================================
  // ACTION NAVIGATION
  // =========================================================================

  const handleActionNavigation = useCallback(
    async (parsed: ParsedRoute, options?: NavigateOptions) => {
      if (!workspaceId) return

      switch (parsed.name) {
        case 'new-session': {
          const createOptions: import('../../shared/types').CreateSessionOptions = {}
          if (parsed.params.mode) {
            const parsedMode = parsePermissionMode(parsed.params.mode)
            if (parsedMode) {
              createOptions.permissionMode = parsedMode
            }
          }
          if (parsed.params.workdir) {
            createOptions.workingDirectory = parsed.params.workdir as 'user_default' | 'none' | string
          }
          if (parsed.params.model) {
            createOptions.model = parsed.params.model
          }
          if (parsed.params.systemPrompt) {
            createOptions.systemPromptPreset = parsed.params.systemPrompt as 'default' | 'mini' | string
          }
          if (parsed.params.status) {
            createOptions.sessionStatus = parsed.params.status
          }
          if (parsed.params.label) {
            createOptions.labels = [parsed.params.label]
          }
          if (parsed.params.project) {
            createOptions.projectId = parsed.params.project
          }
          const session = await onCreateSession(workspaceId, createOptions)

          if (parsed.params.name) {
            await window.electronAPI.sessionCommand(session.id, { type: 'rename', name: parsed.params.name })
          }

          if (parsed.params.status) {
            updateSessionMeta(session.id, { sessionStatus: parsed.params.status })
          }
          if (parsed.params.label) {
            updateSessionMeta(session.id, { labels: [parsed.params.label] })
          }

          if (parsed.params.status) {
            await window.electronAPI.sessionCommand(session.id, { type: 'setSessionStatus', state: parsed.params.status })
          }
          if (parsed.params.label) {
            await window.electronAPI.sessionCommand(session.id, { type: 'setLabels', labels: [parsed.params.label] })
          }

          // Determine navigation filter
          const filter: import('../../shared/types').SessionFilter =
            parsed.params.status ? { kind: 'state', stateId: parsed.params.status } :
            parsed.params.label ? { kind: 'label', labelId: parsed.params.label } :
            { kind: 'allSessions' }

          // Ordinary creation replaces the active Primary conversation;
          // explicit panel creation adds a window-local foreground peer.
          const newState: NavigationState = {
            navigator: 'sessions',
            filter,
            details: { type: 'session', sessionId: session.id },
          }
          const route = buildRouteFromNavigationState(newState) as ViewRoute
          const openedBesideCurrent = options?.newPanel && store.get(primarySessionIdAtom)
            ? store.set(addForegroundSessionAtom, session.id)
            : false
          if (!openedBesideCurrent) store.set(setPrimarySurfaceRouteAtom, route)

          // Parse badges from params
          let badges: ContentBadge[] | undefined
          if (parsed.params.badges) {
            try {
              badges = JSON.parse(parsed.params.badges) as ContentBadge[]
            } catch (e) {
              console.warn('[Navigation] Failed to parse badges param:', e)
            }
          }

          // Handle input: either auto-send or pre-fill
          if (parsed.params.input) {
            const shouldSend = parsed.params.send === 'true'
            if (shouldSend) {
              setTimeout(() => {
                window.electronAPI.sendMessage(
                  session.id,
                  parsed.params.input!,
                  undefined,
                  undefined,
                  badges ? { badges } : undefined
                )
              }, 100)
            } else if (onInputChange) {
              setTimeout(() => {
                onInputChange(session.id, parsed.params.input!)
              }, 100)
            }
          }
          break
        }

        case 'rename-session':
          if (parsed.id && parsed.params.name) {
            await window.electronAPI.sessionCommand(parsed.id, { type: 'rename', name: parsed.params.name })
          }
          break

        case 'delete-session':
          if (parsed.id) {
            await window.electronAPI.deleteSession(parsed.id)
          }
          break

        case 'flag-session':
          if (parsed.id) {
            await window.electronAPI.sessionCommand(parsed.id, { type: 'flag' })
          }
          break

        case 'unflag-session':
          if (parsed.id) {
            await window.electronAPI.sessionCommand(parsed.id, { type: 'unflag' })
          }
          break

        case 'oauth':
          if (parsed.id) {
            await window.electronAPI.performOAuth({ sourceSlug: parsed.id })
          }
          break

        case 'delete-source':
          if (parsed.id) {
            await window.electronAPI.deleteSource(workspaceId, parsed.id)
          }
          break

        case 'set-mode':
          if (parsed.id && parsed.params.mode) {
            const parsedMode = parsePermissionMode(parsed.params.mode)
            if (!parsedMode) {
              console.warn('[Navigation] Invalid permission mode:', parsed.params.mode)
              break
            }
            await window.electronAPI.sessionCommand(
              parsed.id,
              { type: 'setPermissionMode', mode: parsedMode }
            )
          }
          break

        case 'copy':
          if (parsed.params.text) {
            await navigator.clipboard.writeText(parsed.params.text)
          }
          break

        default:
          console.warn('[Navigation] Unknown action:', parsed.name)
      }
    },
    [workspaceId, onCreateSession, onInputChange, store, updateSessionMeta]
  )

  // =========================================================================
  // NAVIGATE
  // =========================================================================

  const navigate = useCallback(
    async (route: Route, options?: NavigateOptions) => {
      // Reset auto-select suppression on any normal navigation
      if (!options?.skipAutoSelect) {
        suppressAutoSelectRef.current = false
      }

      const parsed = parseRoute(route)
      if (!parsed) {
        console.warn('[Navigation] Invalid route:', route)
        return
      }

      if (!isReady) {
        pendingNavigationRef.current = parsed
        return
      }

      // Handle actions (side effects)
      if (parsed.type === 'action') {
        await handleActionNavigation(parsed, options)
        return
      }

      // Parse route to NavigationState. Bare `settings` produces `subpage: null` —
      // navigator-only view in compact mode, App-page fallback on desktop. We
      // intentionally do NOT auto-redirect to the last-visited subpage; doing so
      // would defeat the compact-mode drill-in UX.
      const newNavState = parseRouteToNavigationState(route)

      // Suppress auto-select effect
      if (options?.skipAutoSelect) {
        suppressAutoSelectRef.current = true
      }

      if (newNavState) {
        // Resolve auto-selection (pure — no side effects)
        const resolvedState = resolveAutoSelection(newNavState, options)
        const finalRoute = buildRouteFromNavigationState(resolvedState) as ViewRoute

        // Persist last selected session for auto-select on next visit
        if (isSessionsNavigation(resolvedState) && resolvedState.details && workspaceId) {
          storage.set(storage.KEYS.lastSelectedSessionId, resolvedState.details.sessionId, workspaceId)
        }

        if (resolvedState.navigator === 'other') {
          store.set(openWorkbenchItemAtom, finalRoute)
        } else {
          store.set(setPrimarySurfaceRouteAtom, finalRoute)
        }
      }
    },
    [isReady, handleActionNavigation, resolveAutoSelection, store, workspaceId]
  )

  // =========================================================================
  // BACK / FORWARD (browser history)
  // =========================================================================

  const goBack = useCallback(() => {
    history.back()
  }, [])

  const goForward = useCallback(() => {
    history.forward()
  }, [])

  // =========================================================================
  // POPSTATE HANDLER (browser back/forward)
  // =========================================================================

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // Update sequence tracking
      const eventSeq = event.state?.seq ?? 0
      historySeqRef.current = eventSeq
      updateCanGoBackForward()

      // Read state from URL (the browser already navigated to it)
      const params = new URLSearchParams(window.location.search)
      const wsSlug = params.get('ws')

      // Check if workspace changed
      if (wsSlug && wsSlug !== workspaceSlug && onSwitchWorkspaceBySlug) {
        // Workspace boundary crossed — trigger workspace switch
        // The workspace switch effect will handle reconciliation
        isPopstateSwitchRef.current = true
        onSwitchWorkspaceBySlug(wsSlug)
        return
      }

      if (!isSessionsReady) {
        // Session metadata is not initialized yet; initial restore will reconcile
        // current URL state once metadata is available.
        return
      }

      // Same workspace — reconcile panels from the URL
      suppressPushRef.current = true
      reconcileFromUrlParamsRef.current(params)
      lastSemanticHistoryKeyRef.current = getSemanticHistoryKey()
      requestAnimationFrame(() => {
        suppressPushRef.current = false
      })
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [workspaceSlug, onSwitchWorkspaceBySlug, updateCanGoBackForward, getSemanticHistoryKey, isSessionsReady])

  // =========================================================================
  // WORKSPACE SWITCH
  // =========================================================================

  const previousWorkspaceSlugRef = useRef<string | null>(null)

  useEffect(() => {
    if (!workspaceId || !workspaceSlug || !isSessionsReady) return

    if (previousWorkspaceSlugRef.current === null) {
      // First mount — initial route restoration handles it
      previousWorkspaceSlugRef.current = workspaceSlug
      return
    }

    if (previousWorkspaceSlugRef.current === workspaceSlug) return
    previousWorkspaceSlugRef.current = workspaceSlug

    // Suppress pushState during reconciliation
    suppressPushRef.current = true

    if (isPopstateSwitchRef.current) {
      // Popstate-triggered: URL is already correct, just reconcile from it
      isPopstateSwitchRef.current = false
      reconcileFromUrlParamsRef.current(new URLSearchParams(window.location.search))
      lastSemanticHistoryKeyRef.current = getSemanticHistoryKey()
    } else {
      // UI-triggered: load stored URL for the new workspace, push history entry
      const savedSearch = storage.get<string>(storage.KEYS.workspaceUrl, '', workspaceSlug)

      const url = new URL(window.location.href)
      if (savedSearch) {
        // Replace all params with the saved workspace's URL
        url.search = savedSearch
      } else {
        // No saved state — default to allSessions
        for (const key of [...url.searchParams.keys()]) {
          url.searchParams.delete(key)
        }
        url.searchParams.set('ws', workspaceSlug)
        url.searchParams.set('route', 'allSessions')
      }

      // Push a new history entry for the workspace switch
      const seq = nextHistorySeqRef.current++
      history.pushState({ seq }, '', url.toString())
      historySeqRef.current = seq
      historyMaxSeqRef.current = seq
      updateCanGoBackForward()

      // Reconcile panels from the new URL
      reconcileFromUrlParamsRef.current(new URLSearchParams(url.search))
      lastSemanticHistoryKeyRef.current = getSemanticHistoryKey()
    }

    // The remembered "last active session" belongs to the previous workspace —
    // bound panels must not bind to a stale cross-workspace session id. It is
    // re-populated as soon as a session in the new workspace is focused.
    store.set(lastActiveSessionIdAtom, null)

    initialRouteRestoredRef.current = true

    requestAnimationFrame(() => {
      suppressPushRef.current = false
      lastSemanticHistoryKeyRef.current = getSemanticHistoryKey()
    })
  }, [workspaceId, workspaceSlug, store, updateCanGoBackForward, getSemanticHistoryKey, isSessionsReady])

  // =========================================================================
  // INITIAL ROUTE RESTORATION (CMD+R reload)
  // =========================================================================

  useEffect(() => {
    if (!canRunInitialRestore({
      isReady,
      isSessionsReady,
      workspaceId,
      initialRouteRestored: initialRouteRestoredRef.current,
    })) return
    initialRouteRestoredRef.current = true

    // Suppress pushState during initial restoration
    suppressPushRef.current = true

    const params = new URLSearchParams(window.location.search)

    // Reconcile Primary + Workbench + sidebar from current URL.
    reconcileFromUrlParamsRef.current(params)
    lastSemanticHistoryKeyRef.current = getSemanticHistoryKey()

    // If nothing was in the URL, navigate to default.
    if (!params.get('route') && !params.get('panels')) {
      navigate(routes.view.allSessions())
    }

    // Initialize history with seq=0 (replaceState so we don't create an extra entry)
    history.replaceState({ seq: 0 }, '', window.location.href)
    historySeqRef.current = 0
    historyMaxSeqRef.current = 0

    requestAnimationFrame(() => {
      suppressPushRef.current = false
      lastSemanticHistoryKeyRef.current = getSemanticHistoryKey()
    })
  }, [isReady, isSessionsReady, workspaceId, workspaceSlug, navigate, store, getSemanticHistoryKey])

  // =========================================================================
  // PENDING NAVIGATION
  // =========================================================================

  useEffect(() => {
    if (isReady && pendingNavigationRef.current) {
      const pending = pendingNavigationRef.current
      pendingNavigationRef.current = null

      if (pending.type === 'action') {
        handleActionNavigation(pending)
        return
      }

      const routeStr = `${pending.name}${pending.id ? `/${pending.id}` : ''}`
      const navState = parseRouteToNavigationState(routeStr)
      if (navState) {
        const resolved = resolveAutoSelection(navState)
        const finalRoute = buildRouteFromNavigationState(resolved) as ViewRoute
        if (resolved.navigator === 'other') store.set(openWorkbenchItemAtom, finalRoute)
        else store.set(setPrimarySurfaceRouteAtom, finalRoute)
      }
    }
  }, [isReady, handleActionNavigation, resolveAutoSelection, store])

  // =========================================================================
  // DEEP LINK LISTENER
  // =========================================================================

  useEffect(() => {
    if (!workspaceId) return

    const cleanup = window.electronAPI.onDeepLinkNavigate((nav: DeepLinkNavigation) => {
      let route: string | null = null

      if (nav.view) {
        route = nav.view
      } else if (nav.action) {
        route = `action/${nav.action}`
        if (nav.actionParams?.id) {
          route += `/${nav.actionParams.id}`
        }
        const otherParams = { ...nav.actionParams }
        delete otherParams.id
        if (Object.keys(otherParams).length > 0) {
          const params = new URLSearchParams(otherParams)
          route += `?${params.toString()}`
        }
      }

      if (route) {
        const navState = parseRouteToNavigationState(route)
        if (!navState && !route.startsWith('action/')) {
          toast.error(t('toast.invalidLink'), {
            description: t('toast.invalidLinkDesc'),
          })
          return
        }
        navigate(route as Route)
      }

      const workbenchRoute = legacySidebarToWorkbenchRoute(nav.rightSidebar)
      if (workbenchRoute) store.set(openWorkbenchItemAtom, workbenchRoute)
    })

    return cleanup
  }, [workspaceId, navigate, store, t])

  // =========================================================================
  // INTERNAL NAVIGATION EVENT LISTENER
  // =========================================================================

  useEffect(() => {
    const handleNavigateEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ route: Route } & NavigateOptions>
      if (customEvent.detail?.route) {
        const { route: r, ...options } = customEvent.detail
        navigate(r, options)
      }
    }

    window.addEventListener(NAVIGATE_EVENT, handleNavigateEvent)
    return () => {
      window.removeEventListener(NAVIGATE_EVENT, handleNavigateEvent)
    }
  }, [navigate])

  // =========================================================================
  // PRESERVE-FILTER NAVIGATION HELPERS
  // =========================================================================

  const navigateToSource = useCallback((sourceSlug?: string) => {
    if (isSourcesNavigation(navigationState) && navigationState.filter?.kind === 'type') {
      switch (navigationState.filter.sourceType) {
        case 'api':
          navigate(routes.view.sourcesApi(sourceSlug))
          return
        case 'mcp':
          navigate(routes.view.sourcesMcp(sourceSlug))
          return
        case 'local':
          navigate(routes.view.sourcesLocal(sourceSlug))
          return
      }
    }
    navigate(routes.view.sources(sourceSlug ? { sourceSlug } : undefined))
  }, [navigationState, navigate])

  const navigateToSession = useCallback((sessionId: string) => {
    if (!isSessionsNavigation(navigationState)) {
      navigate(routes.view.allSessions(sessionId))
      return
    }

    const filter = navigationState.filter
    switch (filter.kind) {
      case 'allSessions':
        navigate(routes.view.allSessions(sessionId))
        break
      case 'flagged':
        navigate(routes.view.flagged(sessionId))
        break
      case 'archived':
        navigate(routes.view.archived(sessionId))
        break
      case 'state':
        navigate(routes.view.state(filter.stateId, sessionId))
        break
      case 'label':
        navigate(routes.view.label(filter.labelId, sessionId))
        break
      case 'view':
        navigate(routes.view.view(filter.viewId, sessionId))
        break
      default:
        navigate(routes.view.allSessions(sessionId))
    }
  }, [navigationState, navigate])

  // =========================================================================
  // AUTO-SELECT ON SESSION LOAD
  // =========================================================================

  useEffect(() => {
    if (suppressAutoSelectRef.current) return
    if (!isReady || !workspaceId) return
    // Scoped to sessions with no explicit detail. resolveAutoSelection owns the
    // selection decision (board skip, last/first fallback) so it lives in one
    // place; this effect just applies it when the session list loads after
    // navigation (workspace switch, lazy session load, etc.).
    if (!isSessionsNavigation(navigationState) || navigationState.details) return

    const resolved = resolveAutoSelection(navigationState)
    if (isSessionsNavigation(resolved) && resolved.details) {
      navigateToSession(resolved.details.sessionId)
    }
  }, [
    isReady,
    workspaceId,
    navigationState,
    resolveAutoSelection,
    navigateToSession,
  ])

  // =========================================================================
  // CONTEXT VALUE
  // =========================================================================

  return (
    <NavigationContext.Provider
      value={{
        navigate,
        isReady,
        navigationState,
        canGoBack,
        canGoForward,
        goBack,
        goForward,
        navigateToSource,
        navigateToSession,
      }}
    >
      {children}
    </NavigationContext.Provider>
  )
}

/**
 * Hook to access navigation functions
 */
export function useNavigation() {
  const context = useContext(NavigationContext)
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider')
  }
  return context
}

/**
 * Hook to access just the navigation state
 */
export function useNavigationState(): NavigationState {
  const { navigationState } = useNavigation()
  return navigationState
}
