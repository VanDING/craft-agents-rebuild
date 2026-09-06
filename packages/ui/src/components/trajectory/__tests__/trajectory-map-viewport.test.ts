import { describe, expect, it } from 'bun:test'
import { resizeMapViewport } from '../trajectory-map-viewport'

describe('map viewport resize', () => {
  const node = { x: 48, y: 48, width: 264, height: 116 }

  it('keeps the current node visible when a fitted family is narrowed', () => {
    const next = resizeMapViewport({ x: 48, y: 160, scale: 1 }, { width: 800, height: 600 }, { width: 420, height: 600 }, node)
    expect(next.scale).toBe(1)
    expect(next.x + node.x).toBeGreaterThanOrEqual(16)
    expect(next.x + node.x + node.width).toBeLessThanOrEqual(404)
  })

  it('does not undo a user pan away from the selected node', () => {
    const next = resizeMapViewport({ x: -800, y: -600, scale: 1.4 }, { width: 800, height: 600 }, { width: 420, height: 400 }, node)
    expect(next).toEqual({ x: -990, y: -700, scale: 1.4 })
  })

  it('ignores the zero box produced by a hidden Run tab', () => {
    const camera = { x: 27, y: 88, scale: 0.9 }
    expect(resizeMapViewport(camera, { width: 420, height: 600 }, { width: 0, height: 0 }, node)).toEqual(camera)
  })
})
