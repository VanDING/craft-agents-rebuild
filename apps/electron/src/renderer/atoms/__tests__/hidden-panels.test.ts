import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createStore } from 'jotai'
import {
  panelStackAtom,
  focusedPanelIdAtom,
  visibleSessionIdsAtom,
  resizePanelsAtom,
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
  touchPanelActivity,
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

  it('LRU-evicts the least recently used foreground panel when the 4th opens', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    store.set(openPanelAtom, { route: 'sources/source/github' })
    store.set(openPanelAtom, { route: 'settings' })
    // Each open touches the new panel, so the first panel is the LRU.
    const firstId = getStack(store)[0].id

    store.set(openPanelAtom, { route: 'diff' })

    expect(getStack(store)).toHaveLength(MAX_FOREGROUND_PANELS)
    expect(getStack(store).map(routeOf)).toEqual(['sources/source/github', 'settings', 'diff'])
    expect(getHidden(store).map(routeOf)).toEqual(['allSessions/session/s1'])
    expect(getHidden(store)[0].id).toBe(firstId)
  })

  it('never evicts the focused panel (touching it makes it most recent)', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    store.set(openPanelAtom, { route: 'allSessions/session/s2' })
    store.set(openPanelAtom, { route: 'allSessions/session/s3' })

    const stack = getStack(store)
    const firstId = stack[0].id
    // Focus the first panel — it becomes the most recently used.
    store.set(focusedPanelIdAtom, firstId)
    touchPanelActivity(firstId)

    store.set(openPanelAtom, { route: 'diff' })

    expect(getStack(store).map(routeOf)).toEqual(['allSessions/session/s1', 'allSessions/session/s3', 'diff'])
    expect(getHidden(store).map(routeOf)).toEqual(['allSessions/session/s2'])
  })

  it('restores a hidden panel preserving its id, evicting the LRU when full', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    store.set(openPanelAtom, { route: 'allSessions/session/s2' })
    store.set(openPanelAtom, { route: 'allSessions/session/s3' })
    const hiddenId = getStack(store)[0].id // s1 (LRU)
    store.set(openPanelAtom, { route: 'diff' }) // s1 → hidden
    expect(getHidden(store)).toHaveLength(1)

    store.set(restorePanelAtom, hiddenId)

    const stack = getStack(store)
    expect(stack).toHaveLength(3)
    expect(stack.some((entry) => entry.id === hiddenId)).toBe(true)
    // Foreground was full → one of the remaining foreground panels (the LRU
    // among s2/s3 — timestamps tie within the same millisecond) moved to hidden.
    expect(getHidden(store)).toHaveLength(1)
    expect(['allSessions/session/s2', 'allSessions/session/s3']).toContain(getHidden(store)[0].route)
    expect(getStack(store).some((entry) => entry.route === getHidden(store)[0].route)).toBe(false)
    expect(store.get(focusedPanelIdAtom)).toBe(hiddenId)
  })

  it('restore equalizes widths and ignores the saved proportion (decision #2)', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    store.set(openPanelAtom, { route: 'diff' })
    store.set(openPanelAtom, { route: 'board' })
    store.set(resizePanelsAtom, { leftIndex: 0, rightIndex: 1, leftProportion: 0.7, rightProportion: 0.3 })
    // 4th open evicts the LRU (s1) → hidden with its custom proportion 0.7.
    store.set(openPanelAtom, { route: 'files' })
    expect(getHidden(store)[0].route).toBe('allSessions/session/s1')
    expect(getHidden(store)[0].proportion).toBeCloseTo(0.7)

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
    store.set(openPanelAtom, { route: 'diff' }) // s1 → hidden

    const visible = store.get(visibleSessionIdsAtom)
    expect(visible.has('s1')).toBe(false)
    expect(visible.has('s2')).toBe(true)
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
    expect(getHidden(store2).map(routeOf)).toEqual(['allSessions/session/s1'])

    // Another workspace has its own (empty) set.
    const store3 = createStore()
    store3.set(restoreHiddenPanelsForWorkspaceAtom, 'ws-beta')
    expect(getHidden(store3)).toHaveLength(0)
  })

  it('dedupes hidden entries that reappear in the foreground (back/forward consistency)', () => {
    const store = createStore()

    store.set(openPanelAtom, { route: 'allSessions/session/s1' })
    store.set(openPanelAtom, { route: 'allSessions/session/s2' })
    store.set(openPanelAtom, { route: 'allSessions/session/s3' })
    store.set(openPanelAtom, { route: 'diff' }) // s1 → hidden

    // Simulate history back to the 4-panel state: s1 is back in the foreground.
    store.set(openPanelAtom, { route: 'allSessions/session/s1' })

    expect(getStack(store).some((entry) => entry.route === 'allSessions/session/s1')).toBe(true)
    expect(getHidden(store).some((entry) => entry.route === 'allSessions/session/s1')).toBe(true)

    store.set(dedupeHiddenPanelsAtom)

    expect(getHidden(store).some((entry) => entry.route === 'allSessions/session/s1')).toBe(false)
  })
})
