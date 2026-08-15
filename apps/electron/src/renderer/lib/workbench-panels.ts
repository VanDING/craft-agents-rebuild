/**
 * Workbench Panel Registry
 *
 * The generic content workbench exposes a flat set of top-bar panel kinds
 * (semantic decision #2 — every workbench window is a peer). This module owns
 * the kind ↔ route mapping and the parse-based classification used to derive
 * button states. It deliberately avoids string-prefix sniffing: sessions
 * routes use their filter prefix (`allSessions`/`flagged`/`inbox`/...), not
 * `sessions`, and board/calendar are standalone prefixes.
 */

import { parseRouteToNavigationState } from '../../shared/route-parser'
import type { ViewRoute } from '../../shared/routes'

/**
 * Flat top-bar panel kinds (browser is not a DOM panel — handled separately).
 * `preview` is deliberately NOT in the button list (decision #4): the preview
 * panel is opened trigger-style from chat file clicks and via the panel.preview
 * shortcut, so it has no top-bar button. The type and WORKBENCH_PANEL_ROUTES
 * keep it so workbenchPanelKindForRoute / openTriggeredPanel stay intact.
 */
export type WorkbenchPanelKind =
  | 'sessions'
  | 'board'
  | 'calendar'
  | 'diff'
  | 'files'
  | 'context'
  | 'preview'
  | 'trajectory'

export const WORKBENCH_PANEL_KINDS: readonly WorkbenchPanelKind[] = [
  'sessions',
  'board',
  'calendar',
  'diff',
  'files',
  'context',
  'trajectory',
] as const

export const WORKBENCH_PANEL_ROUTES: Record<WorkbenchPanelKind, ViewRoute> = {
  sessions: 'allSessions',
  board: 'board',
  calendar: 'calendar',
  diff: 'diff',
  files: 'files',
  context: 'context',
  preview: 'preview',
  trajectory: 'trajectory',
}

/**
 * Classify a route into a workbench panel kind using parseRouteToNavigationState.
 *
 * - sessions navigator in `board`/`calendar` mode → board/calendar
 * - sessions navigator otherwise (any filter/list detail) → sessions
 * - bound panels (`other` navigator) → the bound panel kind
 * - everything else (sources/skills/settings/...) → null
 */
export function workbenchPanelKindForRoute(route: ViewRoute): WorkbenchPanelKind | null {
  const navState = parseRouteToNavigationState(route)
  if (!navState) return null

  switch (navState.navigator) {
    case 'sessions':
      if (navState.viewMode === 'board') return 'board'
      if (navState.viewMode === 'calendar') return 'calendar'
      return 'sessions'
    case 'other':
      return navState.panel
    default:
      return null
  }
}
