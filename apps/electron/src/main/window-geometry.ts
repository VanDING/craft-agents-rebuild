import type { WindowBounds } from './window-state'

/** All values are device-independent pixels, including Electron work areas. */
export function defaultWindowBounds(workArea: WindowBounds, focused = false): WindowBounds {
  const width = Math.min(workArea.width, focused ? 900 : Math.max(800, Math.min(1600, Math.round(workArea.width * 0.9))))
  const height = Math.min(workArea.height, focused ? 700 : Math.max(600, Math.min(1000, Math.round(workArea.height * 0.9))))
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  }
}

export function fitWindowBounds(saved: WindowBounds, workArea: WindowBounds): WindowBounds {
  if (![saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) return defaultWindowBounds(workArea)
  const width = Math.min(workArea.width, Math.max(800, Math.round(saved.width)))
  const height = Math.min(workArea.height, Math.max(600, Math.round(saved.height)))
  return {
    x: Math.round(Math.max(workArea.x, Math.min(saved.x, workArea.x + workArea.width - width))),
    y: Math.round(Math.max(workArea.y, Math.min(saved.y, workArea.y + workArea.height - height))),
    width,
    height,
  }
}
