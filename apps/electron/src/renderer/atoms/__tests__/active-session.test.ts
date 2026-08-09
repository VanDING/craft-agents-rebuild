import { describe, it, expect } from 'bun:test'
import { createStore } from 'jotai'
import { pushPanelAtom, focusedSessionIdAtom } from '../panel-stack'
import { activeSessionIdAtom, lastActiveSessionIdAtom } from '../active-session'

/**
 * `lastActiveSessionIdAtom` is written by NavigationContext's sync effect in the
 * running app; in these pure-store tests we simulate that write explicitly.
 */
function syncLastActive(store: ReturnType<typeof createStore>): void {
  const focused = store.get(focusedSessionIdAtom)
  if (focused) store.set(lastActiveSessionIdAtom, focused)
}

describe('active session memory', () => {
  it('follows the focused session', () => {
    const store = createStore()

    store.set(pushPanelAtom, { route: 'allSessions/session/s1' })
    const active = store.get(activeSessionIdAtom)
    expect(active).toBe('s1')
  })

  it('switches when focus moves to another session', () => {
    const store = createStore()

    store.set(pushPanelAtom, { route: 'allSessions/session/s1' })
    store.set(pushPanelAtom, { route: 'allSessions/session/s2' }) // focuses s2 panel

    expect(store.get(activeSessionIdAtom)).toBe('s2')
  })

  it('holds the last active session while a non-session panel is focused', () => {
    const store = createStore()

    store.set(pushPanelAtom, { route: 'allSessions/session/s1' })
    syncLastActive(store) // NavigationContext effect instead writes focused → last

    // Focus a bound diff panel — not a session.
    store.set(pushPanelAtom, { route: 'diff' })

    expect(store.get(focusedSessionIdAtom)).toBeNull()
    // Prev logic: active = focused ?? last
    store.set(lastActiveSessionIdAtom, 's1')
    expect(store.get(activeSessionIdAtom)).toBe('s1')

    // Board/calendar behave the same way.
    store.set(pushPanelAtom, { route: 'calendar' })
    expect(store.get(activeSessionIdAtom)).toBe('s1')
  })

  it('does not overwrite last with null when a non-session panel is focused', () => {
    const store = createStore()

    store.set(pushPanelAtom, { route: 'diff' })
    // What NavigationContext would do: only write when focused is non-null.
    syncLastActive(store)
    expect(store.get(lastActiveSessionIdAtom)).toBeNull()
    expect(store.get(activeSessionIdAtom)).toBeNull()
  })

  it('returns null when no panel exists', () => {
    const store = createStore()
    expect(store.get(activeSessionIdAtom)).toBeNull()
  })
})
