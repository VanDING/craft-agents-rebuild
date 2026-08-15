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
 * measured wall-clock span. Cells without timestamps get null spans and the
 * view falls back to equal-width layout in `actual-duration` mode.
 */
export function trajectoryTimelineBlocks(
  turn: TrajectoryTurnModel,
): readonly TrajectoryTimelineBlock[] {
  const blocks: TrajectoryTimelineBlock[] = []
  let previousEnd: number | null = null
  for (const group of turn.groups) {
    for (const cell of group.cells) {
      const startedAt = cell.startedAt ?? cell.sourceMessage?.timestamp ?? null
      const startTime = typeof startedAt === 'number' ? startedAt : null
      const durationMs = cell.timeSeconds !== null
        ? cell.timeSeconds * 1000
        : (startTime !== null && previousEnd !== null ? startTime - previousEnd : null)
      blocks.push({ cell, startTime, durationMs: durationMs !== null ? Math.max(durationMs, MINIMUM_VISIBLE_MS) : null })
      if (startTime !== null) previousEnd = startTime
    }
  }
  return blocks
}
