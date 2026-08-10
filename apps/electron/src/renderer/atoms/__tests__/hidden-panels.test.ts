import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createStore } from 'jotai'
import {
  panelStackAtom,
  focusedPanelIdAtom,
  visibleSessionIdsAtom,
  resizePanelsAtom,
  closePanelAtom,
  type PanelStackEntry,
} from '../panel-stack'
import {
  hiddenPanelsAtom,
  openPanelAtom,
  restorePanelAtom,
  closeHiddenPanelAtom,
  restoreHiddenPanelsForWorkspaceAtom,
  persistHiddenPanelsAtom,
  dedupeHiddenPanelsAtom,
  MAX_FOREGROUND_PANELS,
  type HiddenPanelEntry,
} from '../hidden-panels'

function getStack(store: ReturnType<typeof createStore>): PanelStackEntry[] {
  return store.get(panelStackAtom)
}

function getHidden(store: ReturnType<typeof createStore>): HiddenPanelEntry[] {
  return store.get(hiddenPanelsAtom)
}

function routeOf(entry: PanelStackEntry | HiddenPanelEntry): string {
  return entry.route
}

// In-memory localStorage shim (local-storage.ts reads the global).
const memoryStorage = new Map<string, string>()
beforeEach(() => {
  memoryStorage.clear()
  ;(globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => { memoryStorage.set(key, value) },
    removeItem: (key: string) => { memoryStorage.delete(key) },
    clear: () => memoryStorage.clear(),
    key: (index: number) => [...memoryStorage.keys()][index] ?? null,
    get length() { return memoryStorage.size },
  }
})
afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage
})

describe('hidden panels (foreground ≤3 + background set)', () => {
  it('opens panels up to the foreground limit without hiding anything', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    store.set(openPanelAtom, { route: 'sources/source/github' })
    store.set(openPanelAtom, { route: 'settings' })

    expect(getStack(store)).toHaveLength(3)
    expect(getHidden(store)).toHaveLength(0)
  })

  it('evicts the leftmost non-focused panel when the 4th opens (decision #6)', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    store.set(openPanelAtom, { route: 'sources/source/github' })
    store.set(openPanelAtom, { route: 'settings' })
    const githubId = getStack(store)[1].id

    store.set(openPanelAtom, { route: 'diff' })

    expect(getStack(store)).toHaveLength(MAX_FOREGROUND_PANELS)
    // s1 is the main session (index 0) → never evicted; github is the
    // leftmost non-focused candidate.
    expect(getStack(store).map(routeOf)).toEqual(['allSessions/session/s1', 'settings', 'diff'])
    expect(getHidden(store).map(routeOf)).toEqual(['sources/source/github'])
    expect(getHidden(store)[0].id).toBe(githubId)
  })

  it('never evicts the focused panel — leftmost non-focused wins', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    store.set(openPanelAtom, { route: 'allSessions/session/s2' })
    store.set(openPanelAtom, { route: 'allSessions/session/s3' })

    const stack = getStack(store)
    const secondId = stack[1].id
    // Focus the second panel.
    store.set(focusedPanelIdAtom, secondId)

    store.set(openPanelAtom, { route: 'diff' })

    // s1 (index 0, main session) is locked; s2 is focused; s3 is evicted.
    expect(getStack(store).map(routeOf)).toEqual(['allSessions/session/s1', 'allSessions/session/s2', 'diff'])
    expect(getHidden(store).map(routeOf)).toEqual(['allSessions/session/s3'])
  })

  it('keeps the focused main session at index 0 while evicting others', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    store.set(openPanelAtom, { route: 'sources/source/github' })
    store.set(openPanelAtom, { route: 'settings' })
    store.set(focusedPanelIdAtom, getStack(store)[0].id)

    store.set(openPanelAtom, { route: 'diff' })

    expect(getStack(store).map(routeOf)).toEqual(['allSessions/session/s1', 'settings', 'diff'])
    expect(getHidden(store).map(routeOf)).toEqual(['sources/source/github'])
  })

  it('restores a hidden panel preserving its id, evicting the leftmost non-focused when full', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    store.set(openPanelAtom, { route: 'allSessions/session/s2' })
    store.set(openPanelAtom, { route: 'allSessions/session/s3' })
    // 4th open: s1 is the locked main session → s2 (leftmost non-focused) is evicted.
    store.set(openPanelAtom, { route: 'diff' }) // s2 → hidden
    expect(getHidden(store)).toHaveLength(1)
    const hiddenId = getHidden(store)[0].id

    store.set(restorePanelAtom, hiddenId)

    const stack = getStack(store)
    expect(stack).toHaveLength(3)
    expect(stack.some((entry) => entry.id === hiddenId)).toBe(true)
    // Foreground was full → s3 (leftmost non-focused, main session still locked) moved to hidden.
    expect(getHidden(store).map(routeOf)).toEqual(['allSessions/session/s3'])
    expect(getStack(store).map(routeOf)).toEqual(['allSessions/session/s1', 'diff', 'allSessions/session/s2'])
    expect(getStack(store).some((entry) => entry.route === getHidden(store)[0].route)).toBe(false)
    expect(store.get(focusedPanelIdAtom)).toBe(hiddenId)
  })

  it('opens a session panel at index 0 when that slot is not a session (decision #8)', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'diff' })
    store.set(openPanelAtom, { route: 'files' })
    expect(getStack(store)[0].route).toBe('diff')

    store.set(openPanelAtom, { route: 'allSessions/session/s9' })

    const stack = getStack(store)
    expect(stack[0].route).toBe('allSessions/session/s9')
    expect(stack.map(routeOf)).toEqual(['allSessions/session/s9', 'diff', 'files'])
    expect(store.get(focusedPanelIdAtom)).toBe(stack[0].id)
  })

  it('restores a session panel at index 0 when that slot is not a session', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'diff' })
    store.set(openPanelAtom, { route: 'files' })
    store.set(openPanelAtom, { route: 'board' })
    // Full (no session yet) → opening a session evicts the leftmost panel and pins at 0.
    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    expect(getStack(store)[0].route).toBe('allSessions/session/s1')
    expect(getHidden(store).map(routeOf)).toEqual(['diff'])

    // Push two more panels so a later eviction can target the non-main session.
    store.set(openPanelAtom, { route: 'allSessions/session/s2' })
    store.set(openPanelAtom, { route: 'context' })
    // s1 (index 0) is locked; s2 (index 1) is now the leftmost non-focused → hidden.
    store.set(openPanelAtom, { route: 'calendar' })
    expect(getHidden(store).map(routeOf)).toEqual(['diff', 'files', 'board', 'allSessions/session/s2'])
    const hiddenSessionId = getHidden(store)[3].id

    // Free index 0: close the main session and the remaining session panel.
    store.set(closePanelAtom, getStack(store)[0].id) // close s1 → [context, calendar]
    store.set(closePanelAtom, getStack(store)[0].id) // close context → [calendar]
    expect(getStack(store)[0].route).toBe('calendar')

    store.set(restorePanelAtom, hiddenSessionId)
    expect(getStack(store)[0].route).toBe('allSessions/session/s2')
    expect(getStack(store).map(routeOf)).toEqual(['allSessions/session/s2', 'calendar'])
    expect(getHidden(store).map(routeOf)).toEqual(['diff', 'files', 'board'])
  })

  it('restore equalizes widths and ignores the saved proportion (decision #2)', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    store.set(openPanelAtom, { route: 'diff' })
    store.set(openPanelAtom, { route: 'board' })
    store.set(resizePanelsAtom, { leftIndex: 0, rightIndex: 1, leftProportion: 0.7, rightProportion: 0.3 })
    // 4th open evicts the leftmost non-focused panel (diff — s1 at index 0 is
    // the locked main session) → hidden with its custom proportion 0.3.
    store.set(openPanelAtom, { route: 'files' })
    expect(getHidden(store)[0].route).toBe('diff')
    expect(getHidden(store)[0].proportion).toBeCloseTo(0.3)

    store.set(restorePanelAtom, getHidden(store)[0].id)

    const stack = getStack(store)
    expect(stack).toHaveLength(3)
    for (const entry of stack) expect(entry.proportion).toBeCloseTo(1 / 3)
  })

  it('keeps the foreground at or below the limit across many opens', () => {
    const store = createStore()

    for (let i = 0; i < 12; i++) {
      store.set(openPanelAtom, { route: `allSessions/session/s${i}` })
      expect(getStack(store).length).toBeLessThanOrEqual(MAX_FOREGROUND_PANELS)
    }
    expect(getHidden(store).length).toBe(9)
  })

  it('hidden sessions stay out of visibleSessionIds (background-chip semantics)', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    store.set(openPanelAtom, { route: 'allSessions/session/s2' })
    store.set(openPanelAtom, { route: 'allSessions/session/s3' })
    store.set(openPanelAtom, { route: 'diff' }) // s2 → hidden (s1 is the locked main session)

    const visible = store.get(visibleSessionIdsAtom)
    expect(visible.has('s1')).toBe(true)
    expect(visible.has('s2')).toBe(false)
    expect(visible.has('s3')).toBe(true)
  })

  it('closeHiddenPanelAtom removes a hidden panel without touching the foreground', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    store.set(openPanelAtom, { route: 'allSessions/session/s2' })
    store.set(openPanelAtom, { route: 'allSessions/session/s3' })
    store.set(openPanelAtom, { route: 'diff' })
    const hiddenId = getHidden(store)[0].id

    store.set(closeHiddenPanelAtom, hiddenId)

    expect(getHidden(store)).toHaveLength(0)
    expect(getStack(store)).toHaveLength(3)
  })

  it('replaceFocused swaps the focused panel content in place', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    store.set(openPanelAtom, { route: 'allSessions/session/s2' })

    const focusedId = store.get(focusedPanelIdAtom)
    store.set(openPanelAtom, { route: 'diff', replaceFocused: true })

    const stack = getStack(store)
    expect(stack).toHaveLength(2)
    const focused = stack.find((entry) => entry.id === focusedId)
    expect(focused?.route).toBe('diff')
    expect(focused?.panelType).toBe('diff')
    expect(getHidden(store)).toHaveLength(0)
  })

  it('persists and restores the hidden set per workspace', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    store.set(openPanelAtom, { route: 'allSessions/session/s2' })
    store.set(openPanelAtom, { route: 'allSessions/session/s3' })
    store.set(openPanelAtom, { route: 'diff' })

    store.set(persistHiddenPanelsAtom, 'ws-alpha')
    expect(memoryStorage.has('craft-hidden-panels:ws-alpha')).toBe(true)

    // A fresh store (new app session) restores the same routes.
    const store2 = createStore()
    store2.set(restoreHiddenPanelsForWorkspaceAtom, 'ws-alpha')
    expect(getHidden(store2).map(routeOf)).toEqual(['allSessions/session/s2'])

    // Another workspace has its own (empty) set.
    const store3 = createStore()
    store3.set(restoreHiddenPanelsForWorkspaceAtom, 'ws-beta')
    expect(getHidden(store3)).toHaveLength(0)
  })

  it('dedupes hidden entries that reappear in the foreground (back/forward consistency)', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'diff' })
    store.set(openPanelAtom, { route: 'files' })
    store.set(openPanelAtom, { route: 'board' })
    store.set(openPanelAtom, { route: 'context' }) // diff → hidden

    // Simulate history back to the 4-panel state: diff is back in the foreground.
    store.set(openPanelAtom, { route: 'diff' }) // files → hidden, diff re-opened

    expect(getStack(store).some((entry) => entry.route === 'diff')).toBe(true)
    expect(getHidden(store).some((entry) => entry.route === 'diff')).toBe(true)

    store.set(dedupeHiddenPanelsAtom)

    expect(getHidden(store).some((entry) => entry.route === 'diff')).toBe(false)
  })
})
