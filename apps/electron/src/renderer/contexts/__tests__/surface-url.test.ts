import { describe, expect, it } from 'bun:test'
import { createPrimarySurfaceState, createWorkbenchItem, hydrateSurfaceStateAtom, workbenchStateAtom, type WorkbenchState } from '../../atoms/workbench'
import { createStore } from 'jotai'
import { filesPanelViewAtom } from '../../atoms/content-panel-ui'
import { normalizePanelRouteForReconcile } from '../navigation-reconcile'
import {
  legacySidebarToWorkbenchRoute,
  parseSurfaceUrlParams,
  writeSurfaceUrlParams,
} from '../surface-url'
import type { ViewRoute } from '../../../shared/routes'

const normalizeRoute = (route: string) => normalizePanelRouteForReconcile(route as ViewRoute, state => state)

describe('v2 Surface URL', () => {
  it('round-trips Primary and collapsed Workbench tabs independently', () => {
    const files = createWorkbenchItem('diff')!
    files.binding = { type: 'session', sessionId: 's1' }
    const state: WorkbenchState = {
      open: false,
      activeItemId: files.id,
      items: [files],
      primaryWidth: 432,
      expandedItemId: null,
    }
    const params = new URLSearchParams('ws=demo&panels=stale&fi=2')

    writeSurfaceUrlParams(params, createPrimarySurfaceState('projects/calendar'), state, ['s1', 's2'])
    const parsed = parseSurfaceUrlParams(params, {
      fallbackPrimaryRoute: 'allSessions',
      normalizeRoute,
    })

    expect(params.get('sv')).toBe('2')
    expect(params.has('panels')).toBe(false)
    expect(params.has('fi')).toBe(false)
    expect(parsed).toEqual({
      source: 'v2',
      restore: {
        primaryRoute: 'calendar',
        foregroundSessionIds: ['s1', 's2'],
        workbenchRoutes: ['files'],
        activeWorkbenchRoute: 'files',
        workbenchOpen: false,
        companionPrimaryWidth: 432,
        workbenchBindings: {
          files: { type: 'session', sessionId: 's1' },
        },
      },
    })
  })

  it('marks an empty Workbench as v2 so legacy state is not resurrected', () => {
    const params = new URLSearchParams()
    writeSurfaceUrlParams(params, createPrimarySurfaceState('settings'), {
      open: false,
      activeItemId: null,
      items: [],
      primaryWidth: 420,
      expandedItemId: null,
    })

    expect(params.toString()).toContain('sv=2')
    expect(params.has('ww')).toBe(false)
    expect(params.has('wb')).toBe(false)
    expect(params.get('pw')).toBe('420')
    const parsed = parseSurfaceUrlParams(params, {
      fallbackPrimaryRoute: 'allSessions',
      normalizeRoute,
    })
    expect(parsed?.source).toBe('v2')
    expect(parsed?.restore.companionPrimaryWidth).toBe(420)
  })

  it('ignores malformed Workbench bindings without rejecting the surface URL', () => {
    const params = new URLSearchParams('sv=2&route=allSessions&workbench=diff&wb=not-json')
    const parsed = parseSurfaceUrlParams(params, {
      fallbackPrimaryRoute: 'allSessions',
      normalizeRoute,
    })

    expect(parsed?.restore.workbenchRoutes).toEqual(['diff'])
    expect(parsed?.restore.workbenchBindings).toBeUndefined()
  })

  it('round-trips foreground conversation presentation independently of Session data', () => {
    const params = new URLSearchParams()
    writeSurfaceUrlParams(params, createPrimarySurfaceState('allSessions/session/s2'), {
      open: false,
      activeItemId: null,
      items: [],
      primaryWidth: 420,
      expandedItemId: null,
    }, ['s1', 's2', 's3'])

    const parsed = parseSurfaceUrlParams(params, {
      fallbackPrimaryRoute: 'allSessions',
      normalizeRoute,
    })
    expect(params.get('fg')).toBe('s1|s2|s3')
    expect(parsed?.restore.foregroundSessionIds).toEqual(['s1', 's2', 's3'])
  })
})

describe('legacy panel URL migration', () => {
  for (const [alias, kind, view] of [
    ['context', 'trajectory', 'explorer'],
    ['preview', 'files', 'opened'],
    ['diff', 'files', 'changed'],
  ] as const) {
    it(`preserves ${alias} intent through URL normalization and hydration`, () => {
      for (const query of [
        `route=${alias}`,
        `panels=allSessions,${alias}&fi=1`,
        `sv=2&route=allSessions&workbench=${alias}&wa=${alias}&wo=1`,
      ]) {
        const parsed = parseSurfaceUrlParams(new URLSearchParams(query), {
          fallbackPrimaryRoute: 'allSessions', normalizeRoute,
        })
        expect(parsed).not.toBeNull()
        const store = createStore()
        store.set(hydrateSurfaceStateAtom, parsed!.restore)
        expect(store.get(workbenchStateAtom).items.map(item => item.kind)).toEqual([kind])
        expect(store.get(filesPanelViewAtom)).toBe(view)
      }
    })
  }

  it('selects the focused legacy Primary and converts bound routes to tabs', () => {
    const params = new URLSearchParams()
    params.set('panels', 'allSessions/session/s1:0.4000,diff:0.3000,projects/board:0.3000')
    params.set('fi', '2')

    const parsed = parseSurfaceUrlParams(params, {
      fallbackPrimaryRoute: 'allSessions',
      normalizeRoute,
    })

    expect(parsed).toEqual({
      source: 'legacy-panels',
      restore: {
        primaryRoute: 'kanban',
        workbenchRoutes: ['files'],
        activeWorkbenchRoute: 'files',
        workbenchOpen: true,
        filesView: 'changed',
      },
    })
  })

  it('keeps the fallback Primary when an old single route is bound', () => {
    const parsed = parseSurfaceUrlParams(new URLSearchParams('route=preview'), {
      fallbackPrimaryRoute: 'allSessions/session/s1',
      normalizeRoute,
    })

    expect(parsed?.restore.primaryRoute).toBe('allSessions/session/s1')
    expect(parsed?.restore.workbenchRoutes).toEqual(['files'])
    expect(parsed?.restore.activeWorkbenchRoute).toBe('files')
  })
})

describe('legacy right-sidebar migration', () => {
  it('maps supported sidebars to typed Workbench routes', () => {
    expect(legacySidebarToWorkbenchRoute('files/path/to/report.md')).toBe('files')
    expect(legacySidebarToWorkbenchRoute('history')).toBe('trajectory')
  })

  it('ignores absent, closed, and unknown sidebar values', () => {
    expect(legacySidebarToWorkbenchRoute()).toBeNull()
    expect(legacySidebarToWorkbenchRoute('none')).toBeNull()
    expect(legacySidebarToWorkbenchRoute('unknown')).toBeNull()
    expect(legacySidebarToWorkbenchRoute('files-unknown')).toBeNull()
  })
})
