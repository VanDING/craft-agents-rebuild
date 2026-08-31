import { describe, expect, test } from 'bun:test'
import { parseRouteToNavigationState } from '../route-parser'
import { routes } from '../routes'

describe('Terminal Workbench route', () => {
  test('parses as the singleton terminal panel', () => {
    expect(parseRouteToNavigationState(routes.view.terminal())).toEqual({ navigator: 'other', panel: 'terminal' })
  })
})
