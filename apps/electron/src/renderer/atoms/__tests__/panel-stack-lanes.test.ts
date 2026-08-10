import { describe, it, expect } from 'bun:test'
import { createStore } from 'jotai'
import {
  panelStackAtom,
  focusedPanelIdAtom,
  pushPanelAtom,
  closePanelAtom,
  resizePanelsAtom,
  reconcilePanelStackAtom,
  updateFocusedPanelRouteAtom,
  type PanelStackEntry,
} from '../panel-stack'

function getStack(store: ReturnType<typeof createStore>): PanelStackEntry[] {
  return store.get(panelStackAtom)
}

describe('panel stack single-lane behavior', () => {
  it('keeps insertion order for new panels', () => {
    const store = createStore()

    store.set(pushPanelAtom, { route: 'allSessions/session/s1' })
    store.set(pushPanelAtom, { route: 'sources/source/github' })
    store.set(pushPanelAtom, { route: 'settings' })

    const stack = getStack(store)
    expect(stack).toHaveLength(3)
    expect(stack[0].route).toBe('allSessions/session/s1')
    expect(stack[1].route).toBe('sources/source/github')
    expect(stack[2].route).toBe('settings')
    expect(stack.every((p) => p.laneId === 'main')).toBe(true)
  })

  it('implicit navigation updates focused panel route', () => {
    const store = createStore()

    store.set(pushPanelAtom, { route: 'allSessions/session/s1' })
    store.set(pushPanelAtom, { route: 'sources/source/github' })

    const sourcePanel = getStack(store).find((p) => p.route === 'sources/source/github')
    expect(sourcePanel).toBeDefined()
    store.set(focusedPanelIdAtom, sourcePanel!.id)

    store.set(updateFocusedPanelRouteAtom, 'allSessions/session/s2')

    const stack = getStack(store)
    expect(stack).toHaveLength(2)
    expect(stack.some((p) => p.route === 'allSessions/session/s2')).toBe(true)
    expect(stack.some((p) => p.route === 'allSessions/session/s1')).toBe(true)
  })

  it('pushPanel afterIndex inserts immediately after the given panel', () => {
    const store = createStore()

    store.set(pushPanelAtom, { route: 'allSessions/session/s1' })
    store.set(pushPanelAtom, { route: 'allSessions/session/s2' })

    store.set(pushPanelAtom, { route: 'sources/source/linear', afterIndex: 0 })

    const stack = getStack(store)
    expect(stack).toHaveLength(3)
    expect(stack[0].route).toBe('allSessions/session/s1')
    expect(stack[1].route).toBe('sources/source/linear')
    expect(stack[2].route).toBe('allSessions/session/s2')
  })

  it('reconcile focuses by focusedIndex first when duplicate routes exist', () => {
    const store = createStore()

    const changed = store.set(reconcilePanelStackAtom, {
      entries: [
        { route: 'allSessions/session/s1', proportion: 0.5 },
        { route: 'allSessions/session/s1', proportion: 0.5 },
      ],
      focusedIndex: 1,
    })

    expect(changed).toBe(true)

    const stack = getStack(store)
    expect(stack).toHaveLength(2)
    const focusedId = store.get(focusedPanelIdAtom)
    expect(focusedId).toBe(stack[1].id)
  })

  it('reconcile no-op keeps focused index target with duplicate routes', () => {
    const store = createStore()

    store.set(reconcilePanelStackAtom, {
      entries: [
        { route: 'allSessions/session/s1', proportion: 0.5 },
        { route: 'allSessions/session/s1', proportion: 0.5 },
      ],
      focusedIndex: 1,
    })

    const stack = getStack(store)
    const firstId = stack[0].id
    const secondId = stack[1].id
    expect(firstId).not.toBe(secondId)

    const changed = store.set(reconcilePanelStackAtom, {
      entries: [
        { route: 'allSessions/session/s1', proportion: 0.5 },
        { route: 'allSessions/session/s1', proportion: 0.5 },
      ],
      focusedIndex: 1,
    })

    expect(changed).toBe(false)
    expect(store.get(focusedPanelIdAtom)).toBe(secondId)
  })
})

describe('equal proportions on count changes (decision #2)', () => {
  it('push equalizes the whole stack', () => {
    const store = createStore()

    store.set(pushPanelAtom, { route: 'allSessions/session/s1' })
    expect(getStack(store)[0].proportion).toBeCloseTo(1)

    store.set(pushPanelAtom, { route: 'sources/source/github' })
    const two = getStack(store)
    expect(two[0].proportion).toBeCloseTo(0.5)
    expect(two[1].proportion).toBeCloseTo(0.5)

    store.set(pushPanelAtom, { route: 'settings' })
    const three = getStack(store)
    expect(three).toHaveLength(3)
    for (const panel of three) expect(panel.proportion).toBeCloseTo(1 / 3)
  })

  it('close re-equalizes the remaining panels', () => {
    const store = createStore()

    store.set(pushPanelAtom, { route: 'allSessions/session/s1' })
    store.set(pushPanelAtom, { route: 'sources/source/github' })
    store.set(pushPanelAtom, { route: 'settings' })
    const middle = getStack(store)[1]
    store.set(closePanelAtom, middle.id)

    const two = getStack(store)
    expect(two).toHaveLength(2)
    expect(two[0].proportion).toBeCloseTo(0.5)
    expect(two[1].proportion).toBeCloseTo(0.5)
  })

  it('drag-resize proportions survive until the next count change', () => {
    const store = createStore()

    store.set(pushPanelAtom, { route: 'allSessions/session/s1' })
    store.set(pushPanelAtom, { route: 'sources/source/github' })
    store.set(resizePanelsAtom, { leftIndex: 0, rightIndex: 1, leftProportion: 0.7, rightProportion: 0.3 })
    let stack = getStack(store)
    expect(stack[0].proportion).toBeCloseTo(0.7)
    expect(stack[1].proportion).toBeCloseTo(0.3)

    // A push is a count change → equalize.
    store.set(pushPanelAtom, { route: 'settings' })
    stack = getStack(store)
    for (const panel of stack) expect(panel.proportion).toBeCloseTo(1 / 3)

    // Closing back to two re-equalizes — custom widths are not restored.
    store.set(closePanelAtom, stack[0].id)
    stack = getStack(store)
    expect(stack).toHaveLength(2)
    expect(stack[0].proportion).toBeCloseTo(0.5)
    expect(stack[1].proportion).toBeCloseTo(0.5)
  })
})
