import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import {
  MAX_COMPANION_PRIMARY_WIDTH,
  MIN_COMPANION_PRIMARY_WIDTH,
  activateForegroundSessionAtom,
  activateWorkbenchItemAtom,
  addForegroundSessionAtom,
  classifySurfaceRoute,
  closeWorkbenchItemAtom,
  collapseWorkbenchAtom,
  deriveSurfaceRestoreState,
  focusNextSurfaceAtom,
  focusPreviousSurfaceAtom,
  focusedSurfaceAtom,
  foregroundSessionIdsAtom,
  hydrateSurfaceStateAtom,
  openWorkbenchItemAtom,
  primarySurfaceAtom,
  renderedSurfaceEntriesAtom,
  setCompanionPrimaryWidthAtom,
  setPrimarySurfaceRouteAtom,
  workbenchStateAtom,
} from '../workbench'

describe('Primary Surface classification', () => {
  it('separates Primary navigation from Context Workbench tools', () => {
    expect(classifySurfaceRoute('allSessions/session/s1')).toEqual({ role: 'primary', kind: 'session' })
    expect(classifySurfaceRoute('projects/calendar')).toEqual({ role: 'primary', kind: 'project-management' })
    expect(classifySurfaceRoute('settings/shortcuts')).toEqual({ role: 'primary', kind: 'management' })
    expect(classifySurfaceRoute('automations')).toEqual({ role: 'primary', kind: 'management' })
    expect(classifySurfaceRoute('diff')).toEqual({ role: 'workbench', kind: 'diff' })
    expect(classifySurfaceRoute('trajectory')).toEqual({ role: 'workbench', kind: 'trajectory' })
  })

  it('does not recognize the reserved Gantt route', () => {
    expect(classifySurfaceRoute('projects/gantt' as never)).toBeNull()
  })
})

describe('Context Workbench state', () => {
  it('keeps exactly one Primary while retaining multiple lightweight tabs', () => {
    const store = createStore()
    store.set(setPrimarySurfaceRouteAtom, 'allSessions/session/s1')
    store.set(openWorkbenchItemAtom, 'diff')
    store.set(openWorkbenchItemAtom, 'files')

    expect(store.get(primarySurfaceAtom).route).toBe('allSessions/session/s1')
    expect(store.get(workbenchStateAtom).items.map((item) => item.kind)).toEqual(['diff', 'files'])
    expect(store.get(renderedSurfaceEntriesAtom).map((entry) => entry.surfaceRole)).toEqual(['primary', 'workbench'])
    expect(store.get(renderedSurfaceEntriesAtom)[1].panelType).toBe('files')
  })

  it('rejects routes that cross the Primary/Workbench boundary', () => {
    const store = createStore()

    expect(store.set(openWorkbenchItemAtom, 'allSessions')).toBeNull()
    expect(store.set(openWorkbenchItemAtom, 'kanban')).toBeNull()
    expect(store.set(openWorkbenchItemAtom, 'calendar')).toBeNull()
    expect(store.set(setPrimarySurfaceRouteAtom, 'diff')).toBe(false)
    expect(store.get(primarySurfaceAtom).route).toBe('allSessions')
    expect(store.get(workbenchStateAtom).items).toEqual([])
  })

  it('cycles focus only when the Workbench is rendered', () => {
    const store = createStore()
    store.set(focusNextSurfaceAtom)
    expect(store.get(focusedSurfaceAtom)).toBe('primary')

    store.set(openWorkbenchItemAtom, 'files')
    expect(store.get(focusedSurfaceAtom)).toBe('workbench')
    store.set(focusNextSurfaceAtom)
    expect(store.get(focusedSurfaceAtom)).toBe('primary')
    store.set(focusNextSurfaceAtom)
    expect(store.get(focusedSurfaceAtom)).toBe('workbench')

    store.set(collapseWorkbenchAtom)
    expect(store.get(focusedSurfaceAtom)).toBe('primary')
  })

  it('activates tabs without mounting sibling items', () => {
    const store = createStore()
    store.set(openWorkbenchItemAtom, 'diff')
    store.set(openWorkbenchItemAtom, 'files')
    const diff = store.get(workbenchStateAtom).items.find((item) => item.kind === 'diff')!

    store.set(activateWorkbenchItemAtom, diff.id)

    expect(store.get(workbenchStateAtom).activeItemId).toBe(diff.id)
    expect(store.get(renderedSurfaceEntriesAtom)).toHaveLength(2)
    expect(store.get(renderedSurfaceEntriesAtom)[1].panelType).toBe('diff')
  })

  it('collapses without destroying tabs and reopens an existing item', () => {
    const store = createStore()
    store.set(openWorkbenchItemAtom, 'context')
    const id = store.get(workbenchStateAtom).activeItemId!

    store.set(collapseWorkbenchAtom)
    expect(store.get(workbenchStateAtom)).toMatchObject({ open: false, activeItemId: id })
    expect(store.get(renderedSurfaceEntriesAtom)).toHaveLength(1)

    store.set(openWorkbenchItemAtom, 'context')
    expect(store.get(workbenchStateAtom)).toMatchObject({ open: true, activeItemId: id })
    expect(store.get(workbenchStateAtom).items).toHaveLength(1)
  })

  it('closes the active tab and selects its nearest sibling', () => {
    const store = createStore()
    store.set(openWorkbenchItemAtom, 'diff')
    store.set(openWorkbenchItemAtom, 'files')
    store.set(openWorkbenchItemAtom, 'context')
    const files = store.get(workbenchStateAtom).items.find((item) => item.kind === 'files')!
    store.set(activateWorkbenchItemAtom, files.id)

    store.set(closeWorkbenchItemAtom, files.id)

    const state = store.get(workbenchStateAtom)
    expect(state.items.map((item) => item.kind)).toEqual(['diff', 'context'])
    expect(state.items.find((item) => item.id === state.activeItemId)?.kind).toBe('context')
  })

  it('clamps the reading-width Primary beside Workbench', () => {
    const store = createStore()
    store.set(setCompanionPrimaryWidthAtom, 10)
    expect(store.get(workbenchStateAtom).primaryWidth).toBe(MIN_COMPANION_PRIMARY_WIDTH)
    store.set(setCompanionPrimaryWidthAtom, 5000)
    expect(store.get(workbenchStateAtom).primaryWidth).toBe(MAX_COMPANION_PRIMARY_WIDTH)
  })

  it('keeps separate tabs for distinct artifacts and dedupes the same artifact route', () => {
    const store = createStore()
    store.set(openWorkbenchItemAtom, 'artifact/a')
    store.set(openWorkbenchItemAtom, 'artifact/b')
    store.set(openWorkbenchItemAtom, 'artifact/a')

    const state = store.get(workbenchStateAtom)
    expect(state.items.map((item) => item.route)).toEqual(['artifact/a', 'artifact/b'])
    expect(state.items.find((item) => item.id === state.activeItemId)?.route).toBe('artifact/a')
  })
})

describe('foreground conversation layout', () => {
  it('keeps at most three peer sessions without silently replacing one', () => {
    const store = createStore()
    store.set(setPrimarySurfaceRouteAtom, 'allSessions/session/s1')
    expect(store.set(addForegroundSessionAtom, 's2')).toBe(true)
    expect(store.set(addForegroundSessionAtom, 's3')).toBe(true)
    expect(store.set(addForegroundSessionAtom, 's4')).toBe(false)

    expect(store.get(foregroundSessionIdsAtom)).toEqual(['s1', 's2', 's3'])
    expect(store.get(primarySurfaceAtom).route).toBe('allSessions/session/s3')
    expect(store.get(renderedSurfaceEntriesAtom).map((entry) => entry.sessionId)).toEqual(['s1', 's2', 's3'])
  })

  it('replaces only the active presentation slot during ordinary navigation', () => {
    const store = createStore()
    store.set(setPrimarySurfaceRouteAtom, 'allSessions/session/s1')
    store.set(addForegroundSessionAtom, 's2')
    store.set(addForegroundSessionAtom, 's3')
    store.set(activateForegroundSessionAtom, 's2')
    store.set(setPrimarySurfaceRouteAtom, 'allSessions/session/s4')

    expect(store.get(foregroundSessionIdsAtom)).toEqual(['s1', 's4', 's3'])
  })

  it('cycles focus through conversations and temporarily shows only the active one beside Workbench', () => {
    const store = createStore()
    store.set(setPrimarySurfaceRouteAtom, 'allSessions/session/s1')
    store.set(addForegroundSessionAtom, 's2')
    store.set(addForegroundSessionAtom, 's3')

    store.set(focusNextSurfaceAtom)
    expect(store.get(primarySurfaceAtom).route).toBe('allSessions/session/s1')
    store.set(focusPreviousSurfaceAtom)
    expect(store.get(primarySurfaceAtom).route).toBe('allSessions/session/s3')

    store.set(openWorkbenchItemAtom, 'diff')
    expect(store.get(renderedSurfaceEntriesAtom).map((entry) => entry.sessionId ?? entry.panelType))
      .toEqual(['s3', 'diff'])
    expect(store.get(foregroundSessionIdsAtom)).toEqual(['s1', 's2', 's3'])

    store.set(collapseWorkbenchAtom)
    expect(store.get(renderedSurfaceEntriesAtom).map((entry) => entry.sessionId)).toEqual(['s1', 's2', 's3'])
  })
})

describe('legacy peer-panel migration', () => {
  it('keeps the focused Primary and converts bound routes to unique tabs', () => {
    const restore = deriveSurfaceRestoreState([
      'allSessions/session/s1',
      'diff',
      'projects/board',
      'files',
      'diff',
    ], 2)

    expect(restore).toEqual({
      primaryRoute: 'projects/board',
      workbenchRoutes: ['diff', 'files'],
      activeWorkbenchRoute: 'files',
      workbenchOpen: true,
    })
  })

  it('uses a bound focused route as the active tab without replacing Primary', () => {
    const restore = deriveSurfaceRestoreState([
      'allSessions/session/s1',
      'preview',
      'settings',
    ], 1)

    expect(restore.primaryRoute).toBe('allSessions/session/s1')
    expect(restore.activeWorkbenchRoute).toBe('preview')
  })

  it('hydrates while preserving stable ids for matching kinds', () => {
    const store = createStore()
    store.set(openWorkbenchItemAtom, 'diff')
    const id = store.get(workbenchStateAtom).activeItemId!

    store.set(hydrateSurfaceStateAtom, {
      primaryRoute: 'projects/calendar',
      workbenchRoutes: ['diff', 'context'],
      activeWorkbenchRoute: 'context',
      workbenchOpen: true,
    })

    const state = store.get(workbenchStateAtom)
    expect(store.get(primarySurfaceAtom)).toEqual({ route: 'projects/calendar', kind: 'project-management' })
    expect(state.items.find((item) => item.kind === 'diff')?.id).toBe(id)
    expect(state.items.find((item) => item.id === state.activeItemId)?.kind).toBe('context')
  })
})
