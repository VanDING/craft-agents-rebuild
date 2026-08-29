import type { ViewRoute } from '../../shared/routes'
import { parseRightSidebarParam } from '../../shared/route-parser'
import {
  deriveSurfaceRestoreState,
  type PrimarySurfaceState,
  type SurfaceRestoreState,
  type WorkbenchBinding,
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

function parseWorkbenchBindings(value: string | null): Record<string, WorkbenchBinding> | undefined {
  if (!value) return undefined
  try {
    const entries: unknown = JSON.parse(value)
    if (!Array.isArray(entries)) return undefined
    const bindings: Record<string, WorkbenchBinding> = {}
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') continue
      const binding = entry[1]
      if (!binding || typeof binding !== 'object') continue
      const type = (binding as { type?: unknown }).type
      if (type === 'workspace') bindings[entry[0]] = { type: 'workspace' }
      if (type === 'follow-primary') bindings[entry[0]] = { type: 'follow-primary' }
      if (type === 'session') {
        const sessionId = (binding as { sessionId?: unknown }).sessionId
        if (typeof sessionId === 'string' && sessionId.length > 0) {
          bindings[entry[0]] = { type: 'session', sessionId }
        }
      }
    }
    return Object.keys(bindings).length > 0 ? bindings : undefined
  } catch {
    return undefined
  }
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
    const foregroundSessionIds = (params.get('fg') ?? '').split('|').filter(Boolean)
    const workbenchBindings = parseWorkbenchBindings(params.get('wb'))
    return {
      source: 'v2',
      restore: {
        primaryRoute: primary,
        ...(foregroundSessionIds.length > 0 ? { foregroundSessionIds } : {}),
        workbenchRoutes,
        activeWorkbenchRoute: params.get('wa')
          ? normalizeRoute(params.get('wa')!)
          : workbenchRoutes.at(-1) ?? null,
        workbenchOpen: params.get('wo') !== '0' && workbenchRoutes.length > 0,
        companionPrimaryWidth: params.get('pw') ? Number(params.get('pw')) : undefined,
        ...(workbenchBindings ? { workbenchBindings } : {}),
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
  foregroundSessionIds: readonly string[] = [],
): void {
  params.set('sv', SURFACE_URL_VERSION)
  params.set('route', primary.route)
  params.set('pw', String(workbench.primaryWidth))
  if (foregroundSessionIds.length > 1) params.set('fg', foregroundSessionIds.join('|'))
  else params.delete('fg')

  if (workbench.items.length > 0) {
    params.set('workbench', workbench.items.map((item) => item.route).join('|'))
    const active = workbench.items.find((item) => item.id === workbench.activeItemId)
    if (active) params.set('wa', active.route)
    else params.delete('wa')
    if (workbench.open) params.delete('wo')
    else params.set('wo', '0')
    const bindings = workbench.items
      .filter((item) => item.binding.type !== 'follow-primary')
      .map((item) => [item.route, item.binding] as const)
    if (bindings.length > 0) params.set('wb', JSON.stringify(bindings))
    else params.delete('wb')
  } else {
    params.delete('workbench')
    params.delete('wa')
    params.delete('wo')
    params.delete('wb')
  }

  params.delete('panels')
  params.delete('fi')
  params.delete('ww')
}
