import { describe, expect, it } from 'bun:test'
import { routes } from '../routes'
import {
  buildRouteFromNavigationState,
  parseCompoundRoute,
  parseRouteToNavigationState,
} from '../route-parser'
import { getNavigationStateKey, parseNavigationStateKey } from '../types'

describe('Project Management routes', () => {
  it('round-trips every enabled projection through its canonical projects route', () => {
    for (const view of ['overview', 'list', 'board', 'calendar'] as const) {
      const route = routes.view.projectManagement(view)
      const state = parseRouteToNavigationState(route)

      expect(state).toEqual({ navigator: 'projects', view, details: null })
      expect(state && buildRouteFromNavigationState(state)).toBe(route)
    }
  })

  it('migrates legacy standalone aliases to canonical project routes', () => {
    const board = parseRouteToNavigationState('board')
    const calendar = parseRouteToNavigationState('calendar')

    expect(board).toEqual({ navigator: 'projects', view: 'board', details: null })
    expect(calendar).toEqual({ navigator: 'projects', view: 'calendar', details: null })
    expect(board && buildRouteFromNavigationState(board)).toBe('projects/board')
    expect(calendar && buildRouteFromNavigationState(calendar)).toBe('projects/calendar')
  })

  it('normalizes an explicit overview segment to the compact projects route', () => {
    const state = parseRouteToNavigationState('projects/overview')

    expect(state).toEqual({ navigator: 'projects', view: 'overview', details: null })
    expect(state && buildRouteFromNavigationState(state)).toBe('projects')
  })

  it('keeps project details inside the overview projection', () => {
    const state = parseRouteToNavigationState('projects/project/craft-agent')

    expect(state).toEqual({
      navigator: 'projects',
      view: 'overview',
      details: { type: 'project', projectSlug: 'craft-agent' },
    })
    expect(state && buildRouteFromNavigationState(state)).toBe('projects/project/craft-agent')
  })

  it('round-trips a full-page WorkItem editor inside its originating projection', () => {
    const route = routes.view.projectWorkItem('board', 'task / 42')
    const state = parseRouteToNavigationState(route)

    expect(route).toBe('projects/board/work-item/task%20%2F%2042')
    expect(state).toEqual({
      navigator: 'projects',
      view: 'board',
      details: { type: 'workItem', workItemId: 'task / 42' },
    })
    expect(state && buildRouteFromNavigationState(state)).toBe(route)
    expect(getNavigationStateKey(state!)).toBe(route)
    expect(parseNavigationStateKey(route)).toEqual(state)
  })

  it('round-trips full-page schedule create and edit routes', () => {
    const route = routes.view.projectSchedule('new:2026-08-25@14:30')
    const state = parseRouteToNavigationState(route)

    expect(state).toEqual({
      navigator: 'projects',
      view: 'calendar',
      details: { type: 'calendarEntry', calendarEntryId: 'new:2026-08-25@14:30' },
    })
    expect(state && buildRouteFromNavigationState(state)).toBe(route)
    expect(getNavigationStateKey(state!)).toBe(route)
    expect(parseNavigationStateKey(route)).toEqual(state)
  })

  it('persists project projection navigation keys without conflating sessions', () => {
    const state = { navigator: 'projects', view: 'calendar', details: null } as const

    expect(getNavigationStateKey(state)).toBe('projects/calendar')
    expect(parseNavigationStateKey('projects/calendar')).toEqual(state)
  })

  it('does not expose the reserved gantt view before it is implemented', () => {
    expect(parseCompoundRoute('projects/gantt')).toBeNull()
  })
})

describe('Artifact Workbench routes', () => {
  it('round-trips encoded artifact ids without losing the contextual identity', () => {
    const route = routes.view.artifact('report / v1')
    const state = parseRouteToNavigationState(route)

    expect(route).toBe('artifact/report%20%2F%20v1')
    expect(state).toEqual({ navigator: 'other', panel: 'artifact', artifactId: 'report / v1' })
    expect(state && buildRouteFromNavigationState(state)).toBe(route)
    expect(getNavigationStateKey(state!)).toBe('other:artifact:report / v1')
    expect(parseNavigationStateKey('other:artifact:report / v1')).toEqual(state)
  })

  it('rejects an artifact route without an id', () => {
    expect(parseRouteToNavigationState('artifact' as never)).toBeNull()
  })
})
