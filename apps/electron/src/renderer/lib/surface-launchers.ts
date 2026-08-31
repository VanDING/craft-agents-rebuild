/**
 * Surface Launcher Registry
 *
 * Registry spanning Primary launchers and Context Workbench items. The union
 * stays useful to TopBar, while the two role-specific registries prevent UI
 * code from treating the primary surfaces as peer workbench tabs.
 */

import { parseRouteToNavigationState } from '../../shared/route-parser'
import type { ViewRoute } from '../../shared/routes'

/**
 * Flat top-bar launcher kinds (browser is not a DOM surface — handled separately).
 * Legacy `context` and `preview` stay in the type/route registry so old URLs
 * and trigger APIs remain typed. They canonicalize into Run and Files, so only
 * the consolidated homes appear as top-bar entries.
 */
export type SurfaceLauncherKind =
  | 'sessions'
  | 'kanban'
  | 'calendar'
  | 'diff'
  | 'files'
  | 'context'
  | 'preview'
  | 'trajectory'
  | 'terminal'

export const SURFACE_LAUNCHER_KINDS: readonly SurfaceLauncherKind[] = [
  'sessions',
  'kanban',
  'calendar',
  'diff',
  'files',
  'trajectory',
  'terminal',
] as const

export const PRIMARY_SURFACE_LAUNCHER_KINDS = ['sessions', 'kanban', 'calendar'] as const
export type PrimarySurfaceLauncherKind = (typeof PRIMARY_SURFACE_LAUNCHER_KINDS)[number]

/** Only consolidated Workbench homes appear as direct top-bar launchers. */
export const CONTEXT_WORKBENCH_LAUNCHER_KINDS = [
  'diff',
  'files',
  'trajectory',
  'terminal',
] as const
export type ContextWorkbenchLauncherKind = (typeof CONTEXT_WORKBENCH_LAUNCHER_KINDS)[number]

export function isContextWorkbenchKind(
  kind: SurfaceLauncherKind,
): kind is Exclude<SurfaceLauncherKind, PrimarySurfaceLauncherKind> {
  return kind !== 'sessions' && kind !== 'kanban' && kind !== 'calendar'
}

export const SURFACE_LAUNCHER_ROUTES: Record<SurfaceLauncherKind, ViewRoute> = {
  sessions: 'allSessions',
  kanban: 'kanban',
  calendar: 'calendar',
  diff: 'diff',
  files: 'files',
  context: 'context',
  preview: 'preview',
  trajectory: 'trajectory',
  terminal: 'terminal',
}

/**
 * Classify a route into a workbench panel kind using parseRouteToNavigationState.
 *
 * - sessions navigator (any filter/list detail) → sessions
 * - Kanban and Calendar projections → their direct launcher
 * - Project overview/list → no global launcher (entered from the sidebar)
 * - bound panels (`other` navigator) → the bound panel kind
 * - everything else (sources/skills/settings/...) → null
 */
export function surfaceLauncherKindForRoute(route: ViewRoute): SurfaceLauncherKind | null {
  const navState = parseRouteToNavigationState(route)
  if (!navState) return null

  switch (navState.navigator) {
    case 'sessions':
      return 'sessions'
    case 'projects':
      if (navState.view === 'board') return 'kanban'
      if (navState.view === 'calendar') return 'calendar'
      return null
    case 'other':
      // Artifact tabs are contextual documents, not persistent top-bar
      // launcher categories. They still participate in Workbench routing.
      return navState.panel === 'artifact' ? null : navState.panel
    default:
      return null
  }
}

/** Translation key for a surface launcher or Workbench tab. */
export function surfaceLauncherLabelKey(kind: SurfaceLauncherKind): string {
  return `contentPanel.button.${kind}`
}
