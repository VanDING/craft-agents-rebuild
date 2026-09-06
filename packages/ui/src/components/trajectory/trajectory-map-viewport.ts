export interface MapViewportTransform {
  x: number
  y: number
  scale: number
}

interface Size { width: number; height: number }
interface NodeBounds extends Size { x: number; y: number }

/** Preserve zoom and camera center on resize. If the selected node was visible,
 * keep it readable in the smaller pane without snapping back from a user pan. */
export function resizeMapViewport(
  transform: MapViewportTransform,
  previous: Size,
  next: Size,
  selected?: NodeBounds,
): MapViewportTransform {
  if (previous.width <= 0 || previous.height <= 0 || next.width <= 0 || next.height <= 0) return transform
  const result = {
    ...transform,
    x: transform.x + (next.width - previous.width) / 2,
    y: transform.y + (next.height - previous.height) / 2,
  }
  if (!selected) return result
  const left = transform.x + selected.x * transform.scale
  const top = transform.y + selected.y * transform.scale
  const width = selected.width * transform.scale
  const height = selected.height * transform.scale
  const wasVisible = left >= 0 && top >= 0 && left + width <= previous.width && top + height <= previous.height
  if (!wasVisible) return result
  const padding = 16
  if (width <= next.width - padding * 2) {
    result.x = Math.max(padding - selected.x * transform.scale,
      Math.min(result.x, next.width - padding - (selected.x * transform.scale + width)))
  }
  if (height <= next.height - padding * 2) {
    result.y = Math.max(padding - selected.y * transform.scale,
      Math.min(result.y, next.height - padding - (selected.y * transform.scale + height)))
  }
  return result
}
