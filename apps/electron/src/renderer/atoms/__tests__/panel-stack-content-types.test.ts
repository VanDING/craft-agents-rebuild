import { describe, it, expect } from 'bun:test'
import { createStore } from 'jotai'
import {
  panelStackAtom,
  focusedPanelIdAtom,
  pushPanelAtom,
  reconcilePanelStackAtom,
  getPanelTypeFromRoute,
  type PanelStackEntry,
} from '../panel-stack'
import { parseRouteToNavigationState, buildRouteFromNavigationState } from '../../../shared/route-parser'
import type { NavigationState, BoundPanelType } from '../../../shared/types'

function getStack(store: ReturnType<typeof createStore>): PanelStackEntry[] {
  return store.get(panelStackAtom)
}

function isSessionNavigation(state: NavigationState | null): boolean {
  return state?.navigator === 'sessions'
}

describe('bound content-workbench panel types', () => {
  it('maps every bound route to its bound panel type', () => {
    expect(getPanelTypeFromRoute('diff')).toBe('diff')
    expect(getPanelTypeFromRoute('files')).toBe('files')
    expect(getPanelTypeFromRoute('context')).toBe('context')
    expect(getPanelTypeFromRoute('preview')).toBe('preview')
  })

  it('keeps session/source/settings/skills mapping unchanged', () => {
    expect(getPanelTypeFromRoute('allSessions/session/s1')).toBe('session')
    expect(getPanelTypeFromRoute('sources/source/github')).toBe('source')
    expect(getPanelTypeFromRoute('settings/shortcuts')).toBe('settings')
    expect(getPanelTypeFromRoute('skills/skill/tool')).toBe('skills')
  })

  it('parses bound routes to other-navigation with the panel kind', () => {
    expect(parseRouteToNavigationState('diff')).toEqual({ navigator: 'other', panel: 'diff' })
    expect(parseRouteToNavigationState('files')).toEqual({ navigator: 'other', panel: 'files' })
    expect(parseRouteToNavigationState('context')).toEqual({ navigator: 'other', panel: 'context' })
    expect(parseRouteToNavigationState('preview')).toEqual({ navigator: 'other', panel: 'preview' })
  })

  it('round-trips bound navigation state back to its route', () => {
    expect(buildRouteFromNavigationState({ navigator: 'other', panel: 'preview' })).toBe('preview')
    expect(buildRouteFromNavigationState({ navigator: 'other', panel: 'context' })).toBe('context')
  })

  it('does not treat bound routes as session routes', () => {
    const boundRoutes: BoundPanelType[] = ['diff', 'files', 'context', 'preview']
    for (const route of boundRoutes) {
      expect(isSessionNavigation(parseRouteToNavigationState(route))).toBe(false)
    }
  })

  it('pushes new-type panels with the correct panelType and focuses them', () => {
    const store = createStore()

    store.set(pushPanelAtom, { route: 'diff' })
    store.set(pushPanelAtom, { route: 'allSessions/session/s1' })
    store.set(pushPanelAtom, { route: 'files' })

    const stack = getStack(store)
    expect(stack.map(p => p.panelType)).toEqual(['diff', 'session', 'files'])
    expect(store.get(focusedPanelIdAtom)).toBe(stack[stack.length - 1].id)
  })

  it('reconcile preserves ids and types for bound panels', () => {
    const store = createStore()

    store.set(pushPanelAtom, { route: 'diff' })
    store.set(pushPanelAtom, { route: 'context' })

    const beforeIds = getStack(store).map(p => p.id)

    store.set(reconcilePanelStackAtom, {
      entries: [
        { route: 'diff', proportion: 0.5 },
        { route: 'context', proportion: 0.5 },
      ],
      focusedIndex: 0,
    })

    const after = getStack(store)
    expect(after.map(p => p.id)).toEqual(beforeIds)
    expect(after.map(p => p.panelType)).toEqual(['diff', 'context'])
  })
})
