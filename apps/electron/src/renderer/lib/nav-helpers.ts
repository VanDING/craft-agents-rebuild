/**
 * Navigation helpers
 *
 * Small pure helpers over `NavigationState`. Keep these stateless and free of
 * React/Jotai imports — they're consumed both inside hooks (SurfaceContainer)
 * and in synchronous callbacks (CompactBackButton).
 */

import { buildRouteFromNavigationState } from '../../shared/route-parser'
import type { ViewRoute } from '../../shared/routes'
import type { NavigationState } from '../../shared/types'

/**
 * Returns true when the focused panel's nav state is in "detail" mode —
 * i.e. the user has drilled past the navigator into a specific item.
 *
 * Used by compact-mode logic to flip the layout from navigator-only to
 * content-only with a back-button overlay.
 *
 * Per-navigator semantics:
 * - sessions: a session is selected
 * - settings: a subpage is selected (bare `settings` route → false)
 * - sources / skills / automations: a detail item is selected
 */
export function isDetailNavState(navState: NavigationState | null): boolean {
  if (!navState) return false
  switch (navState.navigator) {
    case 'sessions':
      return navState.details !== null
    case 'settings':
      return navState.subpage !== null
    case 'sources':
    case 'skills':
    case 'automations':
      return navState.details !== null
    case 'projects':
      return navState.details !== null || navState.view !== 'overview'
    case 'other':
      // Bound workbench panels are standalone — never "detail" mode.
      return false
  }
}

/**
 * Route used by compact mode when returning from a Primary detail/projection
 * to its navigator. Project projections return to Project overview; bound
 * workbench routes are handled by the dock and therefore have no root route.
 */
export function buildNavigatorRootRoute(navState: NavigationState): ViewRoute | null {
  switch (navState.navigator) {
    case 'sessions':
    case 'sources':
    case 'skills':
    case 'automations':
      return buildRouteFromNavigationState({ ...navState, details: null }) as ViewRoute
    case 'settings':
      return buildRouteFromNavigationState({ ...navState, subpage: null }) as ViewRoute
    case 'projects':
      return buildRouteFromNavigationState({ ...navState, view: 'overview', details: null }) as ViewRoute
    case 'other':
      return null
  }
}
