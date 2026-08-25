import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import {
  getSurfacePanelTypeFromRoute,
  hydrateSurfaceStateAtom,
  openWorkbenchItemAtom,
  renderedSurfaceEntriesAtom,
  setPrimarySurfaceRouteAtom,
  workbenchStateAtom,
} from '../workbench'
import { buildRouteFromNavigationState, parseRouteToNavigationState } from '../../../shared/route-parser'
import type { BoundPanelType, NavigationState } from '../../../shared/types'
import { surfaceLauncherKindForRoute } from '../../lib/surface-launchers'

function isSessionNavigation(state: NavigationState | null): boolean {
  return state?.navigator === 'sessions'
}

describe('Surface content types', () => {
  it('maps every bound route to its Context Workbench type', () => {
    expect(getSurfacePanelTypeFromRoute('diff')).toBe('diff')
    expect(getSurfacePanelTypeFromRoute('files')).toBe('files')
    expect(getSurfacePanelTypeFromRoute('context')).toBe('context')
    expect(getSurfacePanelTypeFromRoute('preview')).toBe('preview')
    expect(getSurfacePanelTypeFromRoute('trajectory')).toBe('trajectory')
  })

  it('maps every Primary management family explicitly', () => {
    expect(getSurfacePanelTypeFromRoute('allSessions/session/s1')).toBe('session')
    expect(getSurfacePanelTypeFromRoute('sources/source/github')).toBe('source')
    expect(getSurfacePanelTypeFromRoute('settings/shortcuts')).toBe('settings')
    expect(getSurfacePanelTypeFromRoute('skills/skill/tool')).toBe('skills')
    expect(getSurfacePanelTypeFromRoute('automations')).toBe('automation')
  })

  it('keeps one Project Management surface while exposing direct launchers', () => {
    expect(getSurfacePanelTypeFromRoute('projects')).toBe('projects')
    expect(getSurfacePanelTypeFromRoute('kanban')).toBe('projects')
    expect(getSurfacePanelTypeFromRoute('calendar')).toBe('projects')
    expect(getSurfacePanelTypeFromRoute('projects/board')).toBe('projects')
    expect(getSurfacePanelTypeFromRoute('projects/calendar')).toBe('projects')
    expect(getSurfacePanelTypeFromRoute('board')).toBe('projects')
    expect(surfaceLauncherKindForRoute('projects')).toBeNull()
    expect(surfaceLauncherKindForRoute('kanban')).toBe('kanban')
    expect(surfaceLauncherKindForRoute('projects/board')).toBe('kanban')
    expect(surfaceLauncherKindForRoute('calendar')).toBe('calendar')
    expect(surfaceLauncherKindForRoute('projects/calendar')).toBe('calendar')
  })

  it('round-trips bound navigation states without session identity', () => {
    expect(parseRouteToNavigationState('diff')).toEqual({ navigator: 'other', panel: 'diff' })
    expect(buildRouteFromNavigationState({ navigator: 'other', panel: 'preview' })).toBe('preview')
    const boundRoutes: BoundPanelType[] = ['diff', 'files', 'context', 'preview', 'trajectory']
    for (const route of boundRoutes) {
      expect(isSessionNavigation(parseRouteToNavigationState(route))).toBe(false)
    }
  })

  it('renders one Primary plus only the active Workbench tab', () => {
    const store = createStore()
    store.set(setPrimarySurfaceRouteAtom, 'allSessions/session/s1')
    store.set(openWorkbenchItemAtom, 'diff')
    store.set(openWorkbenchItemAtom, 'files')

    expect(store.get(workbenchStateAtom).items.map((item) => item.kind)).toEqual(['diff', 'files'])
    expect(store.get(renderedSurfaceEntriesAtom).map((entry) => entry.panelType)).toEqual(['session', 'files'])
  })

  it('preserves Workbench ids across URL hydration', () => {
    const store = createStore()
    store.set(openWorkbenchItemAtom, 'diff')
    store.set(openWorkbenchItemAtom, 'context')
    const beforeIds = store.get(workbenchStateAtom).items.map((item) => item.id)

    store.set(hydrateSurfaceStateAtom, {
      primaryRoute: 'allSessions',
      workbenchRoutes: ['diff', 'context'],
      activeWorkbenchRoute: 'diff',
      workbenchOpen: true,
    })

    expect(store.get(workbenchStateAtom).items.map((item) => item.id)).toEqual(beforeIds)
    expect(store.get(renderedSurfaceEntriesAtom).map((entry) => entry.panelType)).toEqual(['session', 'diff'])
  })
})
