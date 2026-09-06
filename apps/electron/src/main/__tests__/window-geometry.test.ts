import { describe, expect, it } from 'bun:test'
import { defaultWindowBounds, fitWindowBounds } from '../window-geometry'

describe('window geometry', () => {
  it('centers new windows within the current display and caps large screens', () => {
    expect(defaultWindowBounds({ x: 0, y: 25, width: 1920, height: 1055 })).toEqual({ x: 160, y: 78, width: 1600, height: 950 })
    expect(defaultWindowBounds({ x: 1920, y: 0, width: 3840, height: 2160 })).toEqual({ x: 3040, y: 580, width: 1600, height: 1000 })
  })
  it('keeps focused windows small and fits tiny work areas', () => {
    expect(defaultWindowBounds({ x: 0, y: 0, width: 1920, height: 1080 }, true)).toEqual({ x: 510, y: 190, width: 900, height: 700 })
    expect(defaultWindowBounds({ x: 0, y: 0, width: 720, height: 500 })).toEqual({ x: 0, y: 0, width: 720, height: 500 })
  })
  it('preserves valid saved bounds and brings disconnected-display windows into view', () => {
    const workArea = { x: 0, y: 25, width: 1440, height: 875 }
    const saved = { x: 100, y: 100, width: 1100, height: 700 }
    expect(fitWindowBounds(saved, workArea)).toEqual(saved)
    expect(fitWindowBounds({ x: 2500, y: -100, width: 1800, height: 1200 }, workArea)).toEqual(workArea)
    expect(fitWindowBounds({ x: 0, y: 0, width: NaN, height: 800 }, workArea)).toEqual(defaultWindowBounds(workArea))
  })
})
