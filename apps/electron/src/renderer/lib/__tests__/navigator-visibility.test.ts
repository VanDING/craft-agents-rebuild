import { describe, expect, it } from 'bun:test'
import { hasNavigator, shouldRevealNavigator } from '../nav-helpers'
import { parseRouteToNavigationState } from '../../../shared/route-parser'

describe('navigator visibility intent', () => {
  it('reveals all list launchers, including management details', () => {
    for (const route of ['allSessions', 'flagged', 'archived', 'state/todo', 'label/research', 'view/custom', 'settings', 'settings/shortcuts', 'projects', 'sources', 'skills', 'automations']) {
      const state = parseRouteToNavigationState(route)
      expect(state).not.toBeNull()
      expect(shouldRevealNavigator(state)).toBe(true)
    }
  })
  it('preserves the session list preference when a session is opened directly', () => {
    expect(shouldRevealNavigator(parseRouteToNavigationState('allSessions/session/s1'))).toBe(false)
  })
  it('does not reveal a nonexistent navigator for full-width pages or tools', () => {
    for (const route of ['kanban', 'calendar', 'projects/board', 'projects/calendar', 'pages', 'files', 'terminal']) {
      expect(hasNavigator(parseRouteToNavigationState(route))).toBe(false)
    }
  })
})
