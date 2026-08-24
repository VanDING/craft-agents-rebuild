import type { ViewRoute } from '../../shared/routes'
import { parseRightSidebarParam } from '../../shared/route-parser'
import {
  deriveSurfaceRestoreState,
  type PrimarySurfaceState,
  type SurfaceRestoreState,
  type WorkbenchState,
} from '@/atoms/workbench'

export const SURFACE_URL_VERSION = '2'

export type SurfaceUrlSource = 'v2' | 'legacy-panels' | 'legacy-route'

export interface ParsedSurfaceUrl {
  restore: SurfaceRestoreState
  source: SurfaceUrlSource
}

/**
 * Translate the discontinued right-sidebar contract into a Workbench route.
 * Unknown legacy values remain ignored instead of becoming untyped tabs.
 */
export function legacySidebarToWorkbenchRoute(value?: string | null): ViewRoute | null {
  if (!value) return null
  const sidebar = parseRightSidebarParam(value)
  if (sidebar?.type === 'files') return 'files'
  if (sidebar?.type === 'history') return 'trajectory'
  return null
}

interface ParseSurfaceUrlOptions {
  fallbackPrimaryRoute: ViewRoute
  normalizeRoute: (route: string) => ViewRoute
}

/** Extract legacy `route:proportion` entries without trusting layout values. */
export function parseLegacyPanelRoutes(
  value: string,
  normalizeRoute: (route: string) => ViewRoute,
): ViewRoute[] {
  return value.split(',').filter(Boolean).map((entry) => {
    const colonIndex = entry.lastIndexOf(':')
    if (colonIndex > 0) {
      const proportion = Number(entry.slice(colonIndex + 1))
      if (Number.isFinite(proportion) && proportion > 0 && proportion < 1) {
        return normalizeRoute(entry.slice(0, colonIndex))
      }
    }
    return normalizeRoute(entry)
  })
}

export function parseSurfaceUrlParams(
  params: URLSearchParams,
  { fallbackPrimaryRoute, normalizeRoute }: ParseSurfaceUrlOptions,
): ParsedSurfaceUrl | null {
  const initialRoute = params.get('route')
  const isV2 = params.get('sv') === SURFACE_URL_VERSION || params.has('workbench')

  if (isV2) {
    const rawPrimary = initialRoute ? normalizeRoute(initialRoute) : fallbackPrimaryRoute
    const primary = deriveSurfaceRestoreState([rawPrimary], 0, fallbackPrimaryRoute).primaryRoute
    const workbenchRoutes = (params.get('workbench') ?? '')
      .split('|')
      .filter(Boolean)
      .map(normalizeRoute)
    return {
      source: 'v2',
      restore: {
        primaryRoute: primary,
        workbenchRoutes,
        activeWorkbenchRoute: params.get('wa')
          ? normalizeRoute(params.get('wa')!)
          : workbenchRoutes.at(-1) ?? null,
        workbenchOpen: params.get('wo') !== '0' && workbenchRoutes.length > 0,
        workbenchWidth: params.get('ww') ? Number(params.get('ww')) : undefined,
      },
    }
  }

  const legacyPanels = params.get('panels')
  if (legacyPanels) {
    const routes = parseLegacyPanelRoutes(legacyPanels, normalizeRoute)
    const focusedIndex = Number.parseInt(params.get('fi') ?? '0', 10) || 0
    return {
      source: 'legacy-panels',
      restore: deriveSurfaceRestoreState(routes, focusedIndex, fallbackPrimaryRoute),
    }
  }

  if (initialRoute) {
    return {
      source: 'legacy-route',
      restore: deriveSurfaceRestoreState(
        [normalizeRoute(initialRoute)],
        0,
        fallbackPrimaryRoute,
      ),
    }
  }

  return null
}

/** Mutates the provided params while preserving unrelated window parameters. */
export function writeSurfaceUrlParams(
  params: URLSearchParams,
  primary: PrimarySurfaceState,
  workbench: WorkbenchState,
): void {
  params.set('sv', SURFACE_URL_VERSION)
  params.set('route', primary.route)
  // Width is a Workbench preference even when no tabs currently exist.
  params.set('ww', String(workbench.width))

  if (workbench.items.length > 0) {
    params.set('workbench', workbench.items.map((item) => item.route).join('|'))
    const active = workbench.items.find((item) => item.id === workbench.activeItemId)
    if (active) params.set('wa', active.route)
    else params.delete('wa')
    if (workbench.open) params.delete('wo')
    else params.set('wo', '0')
  } else {
    params.delete('workbench')
    params.delete('wa')
    params.delete('wo')
  }

  params.delete('panels')
  params.delete('fi')
}
