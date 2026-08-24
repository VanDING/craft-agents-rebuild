/**
 * Surface Launcher Registry
 *
 * Registry spanning Primary launchers and Context Workbench items. The union
 * stays useful to TopBar, while the two role-specific registries prevent UI
 * code from treating sessions/projects as peer workbench tabs.
 */

import { parseRouteToNavigationState } from '../../shared/route-parser'
import type { ViewRoute } from '../../shared/routes'

/**
 * Flat top-bar launcher kinds (browser is not a DOM surface — handled separately).
 * `preview` is deliberately NOT in the button list (decision #4): the preview
 * panel is opened trigger-style from chat file clicks and via the panel.preview
 * shortcut, so it has no top-bar button. The type and SURFACE_LAUNCHER_ROUTES
 * keep it so trigger-based preview opens stay typed.
 */
export type SurfaceLauncherKind =
  | 'sessions'
  | 'projects'
  | 'diff'
  | 'files'
  | 'context'
  | 'preview'
  | 'trajectory'

export const SURFACE_LAUNCHER_KINDS: readonly SurfaceLauncherKind[] = [
  'sessions',
  'projects',
  'diff',
  'files',
  'context',
  'trajectory',
] as const

export const PRIMARY_SURFACE_LAUNCHER_KINDS = ['sessions', 'projects'] as const
export type PrimarySurfaceLauncherKind = (typeof PRIMARY_SURFACE_LAUNCHER_KINDS)[number]

/** Preview remains trigger-only, so it is a valid item but not a tiled launcher. */
export const CONTEXT_WORKBENCH_LAUNCHER_KINDS = [
  'diff',
  'files',
  'context',
  'trajectory',
] as const
export type ContextWorkbenchLauncherKind = (typeof CONTEXT_WORKBENCH_LAUNCHER_KINDS)[number]

export function isContextWorkbenchKind(
  kind: SurfaceLauncherKind,
): kind is Exclude<SurfaceLauncherKind, PrimarySurfaceLauncherKind> {
  return kind !== 'sessions' && kind !== 'projects'
}

export const SURFACE_LAUNCHER_ROUTES: Record<SurfaceLauncherKind, ViewRoute> = {
  sessions: 'allSessions',
  projects: 'projects',
  diff: 'diff',
  files: 'files',
  context: 'context',
  preview: 'preview',
  trajectory: 'trajectory',
}

/**
 * Classify a route into a workbench panel kind using parseRouteToNavigationState.
 *
 * - sessions navigator (any filter/list detail) → sessions
 * - every Project Management projection → projects
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
      return 'projects'
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
  return kind === 'projects' ? 'sidebar.projects' : `contentPanel.button.${kind}`
}
