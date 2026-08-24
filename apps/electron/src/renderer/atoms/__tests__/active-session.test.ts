import { describe, it, expect } from 'bun:test'
import { createStore } from 'jotai'
import { openWorkbenchItemAtom, primarySessionIdAtom, setPrimarySurfaceRouteAtom } from '../workbench'
import { activeSessionIdAtom, lastActiveSessionIdAtom } from '../active-session'

/**
 * `lastActiveSessionIdAtom` is written by NavigationContext's sync effect in the
 * running app; in these pure-store tests we simulate that write explicitly.
 */
function syncLastActive(store: ReturnType<typeof createStore>): void {
  const focused = store.get(primarySessionIdAtom)
  if (focused) store.set(lastActiveSessionIdAtom, focused)
}

describe('active session memory', () => {
  it('follows the Primary Session', () => {
    const store = createStore()

    store.set(setPrimarySurfaceRouteAtom, 'allSessions/session/s1')
    const active = store.get(activeSessionIdAtom)
    expect(active).toBe('s1')
  })

  it('switches when Primary navigates to another session', () => {
    const store = createStore()

    store.set(setPrimarySurfaceRouteAtom, 'allSessions/session/s1')
    store.set(setPrimarySurfaceRouteAtom, 'allSessions/session/s2')

    expect(store.get(activeSessionIdAtom)).toBe('s2')
  })

  it('keeps Primary Session active while Context Workbench is focused', () => {
    const store = createStore()

    store.set(setPrimarySurfaceRouteAtom, 'allSessions/session/s1')
    syncLastActive(store) // NavigationContext effect instead writes focused → last

    store.set(openWorkbenchItemAtom, 'diff')

    expect(store.get(primarySessionIdAtom)).toBe('s1')
    expect(store.get(activeSessionIdAtom)).toBe('s1')

    // A non-session Primary falls back to last Primary Session.
    store.set(setPrimarySurfaceRouteAtom, 'projects/calendar')
    expect(store.get(activeSessionIdAtom)).toBe('s1')
  })

  it('does not invent a session when opening Workbench before any session', () => {
    const store = createStore()

    store.set(openWorkbenchItemAtom, 'diff')
    syncLastActive(store)
    expect(store.get(lastActiveSessionIdAtom)).toBeNull()
    expect(store.get(activeSessionIdAtom)).toBeNull()
  })

  it('returns null when the default Primary has no selected session', () => {
    const store = createStore()
    expect(store.get(activeSessionIdAtom)).toBeNull()
  })
})
