/**
 * Trajectory timeline — Chrome-Network-style overview model.
 *
 * Pure helpers: time-range math, focus-index resolution, and the windowed
 * record detail used by the overview tooltips. The overview itself is a
 * view component; everything here is framework-free.
 */

import type { TrajectoryTurnModel, TrajectoryCellProps } from './trajectory-layout'

/** Fraction of the full session domain covered by the overview window. */
export interface TrajectoryTimeRange {
  start: number // 0..1
  end: number // 0..1
}

/** Windowed display mode: recorded durations or equal-width blocks. */
export type TrajectoryTimelineMode = 'actual-duration' | 'equal-width'

/** One overview block with its measured span. */
export interface TrajectoryTimelineBlock {
  cell: TrajectoryCellProps
  /** Wall-clock start (epoch ms), when known. */
  startTime: number | null
  /** Duration in ms, when known. */
  durationMs: number | null
}

const MINIMUM_VISIBLE_MS = 1

/** Session domain from the first/last cell timestamps; undefined when absent. */
export function trajectoryDomain(
  turns: readonly TrajectoryTurnModel[],
): { startMs: number; endMs: number } | undefined {
  let startMs: number | undefined
  let endMs: number | undefined
  for (const turn of turns) {
    for (const group of turn.groups) {
      for (const cell of group.cells) {
        const t = cell.startedAt ?? cell.sourceMessage?.timestamp
        if (typeof t !== 'number') continue
        if (startMs === undefined || t < startMs) startMs = t
        if (endMs === undefined || t > endMs) endMs = t
      }
    }
  }
  return startMs !== undefined && endMs !== undefined ? { startMs, endMs } : undefined
}

/** Resolve a focus index (absolute cell position) to a normalized range. */
export function trajectoryTimelineFocusIndexes(
  turns: readonly TrajectoryTurnModel[],
  focusIndex: number | null,
): TrajectoryTimeRange | null {
  if (focusIndex === null) return null
  const domain = trajectoryDomain(turns)
  if (!domain) return null

  // Walk cells to the focused index and record its timestamp.
  let index = 0
  let focusedMs: number | undefined
  for (const turn of turns) {
    for (const group of turn.groups) {
      for (const cell of group.cells) {
        if (index === focusIndex) {
          focusedMs = cell.startedAt ?? cell.sourceMessage?.timestamp
        }
        index += 1
      }
    }
  }
  if (focusedMs === undefined) return null

  const domainMs = Math.max(domain.endMs - domain.startMs, MINIMUM_VISIBLE_MS)
  const center = (focusedMs - domain.startMs) / domainMs
  const half = 0.08 // 8% window around the focused record
  return {
    start: Math.max(0, center - half),
    end: Math.min(1, center + half),
  }
}

/**
 * Build overview blocks for one turn: each cell becomes a block with its
 * measured wall-clock span. Unmeasured cells (historical sessions) get the
 * gap to the NEXT cell's start — the interval belongs to the record that
 * opened it — and the final cell reports null, leaving the view to extend
 * it to the lane edge instead of overflowing past the container.
 */
export function trajectoryTimelineBlocks(
  turn: TrajectoryTurnModel,
): readonly TrajectoryTimelineBlock[] {
  const cells: Array<{ cell: TrajectoryCellProps; startTime: number | null; measured: number | null }> = []
  for (const group of turn.groups) {
    for (const cell of group.cells) {
      const startedAt = cell.startedAt ?? cell.sourceMessage?.timestamp ?? null
      const startTime = typeof startedAt === 'number' ? startedAt : null
      const measured = cell.timeSeconds !== null ? cell.timeSeconds * 1000 : null
      cells.push({ cell, startTime, measured })
    }
  }

  const blocks: TrajectoryTimelineBlock[] = []
  for (let i = 0; i < cells.length; i++) {
    const entry = cells[i]
    if (entry === undefined) continue
    const { cell, startTime, measured } = entry
    let durationMs = measured
    const next = cells[i + 1]
    if (durationMs === null && startTime !== null && next !== undefined) {
      const nextStart = next.startTime
      if (nextStart !== null && nextStart >= startTime) durationMs = nextStart - startTime
    }
    blocks.push({
      cell,
      startTime,
      durationMs: durationMs !== null ? Math.max(durationMs, MINIMUM_VISIBLE_MS) : null,
    })
  }
  return blocks
}
