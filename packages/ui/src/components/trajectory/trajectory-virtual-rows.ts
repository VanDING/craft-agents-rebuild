/**
 * Trajectory virtual rows — measurable row projection for long ledgers.
 *
 * Each flat render record maps to one fixed-height row, so the view can
 * virtualize without measuring the DOM.
 */

import type { TrajectoryRenderRecord } from './trajectory-layout'
import { trajectoryRecordId } from './trajectory-layout'

export const CONTENT_ROW_HEIGHT = 30
export const COLLAPSED_SUMMARY_HEIGHT = 24
export const REQUEST_BOUNDARY_HEIGHT = 16

/** One virtualizer item. */
export interface TrajectoryVirtualRow {
  /** Record rendered by this row. */
  record: TrajectoryRenderRecord
  /** Height in px. */
  height: number
  /** Stable identity for React keys. */
  key: string
}

/** Extra rows rendered beyond each visible edge to avoid blank flashes while scrolling. */
export const VIRTUAL_OVERSCAN = 5

/** A visible window over fixed-height rows plus spacer sizes. */
export interface VirtualRowWindow {
  /** First row index to render (inclusive). */
  start: number
  /** One past the last row index to render. */
  end: number
  /** Height of the top spacer (rows before `start`). */
  top: number
  /** Height of the bottom spacer (rows at/after `end`). */
  bottom: number
}

/**
 * Compute which fixed-height rows overlap the scroll viewport, plus the
 * spacer heights that keep the scrollbar's total height stable. One offset
 * pass over the rows — cheap relative to rendering even a small slice.
 */
export function computeVirtualRowWindow(
  rows: readonly TrajectoryVirtualRow[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number = VIRTUAL_OVERSCAN,
): VirtualRowWindow {
  const offsets = rowOffsets(rows)
  const total = offsets[offsets.length - 1] ?? 0
  const top = Math.max(0, scrollTop)
  const bottomEdge = top + Math.max(0, viewportHeight)

  let start = 0
  while (start < rows.length && (offsets[start + 1] ?? 0) <= top) start += 1
  let end = start
  while (end < rows.length && (offsets[end] ?? 0) < bottomEdge) end += 1

  const windowStart = Math.max(0, start - overscan)
  const windowEnd = Math.min(rows.length, end + overscan)

  return {
    start: windowStart,
    end: windowEnd,
    top: offsets[windowStart] ?? 0,
    bottom: total - (offsets[windowEnd] ?? total),
  }
}

function rowOffsets(rows: readonly TrajectoryVirtualRow[]): number[] {
  const offsets = new Array<number>(rows.length + 1)
  offsets[0] = 0
  for (let i = 0; i < rows.length; i++) {
    offsets[i + 1] = (offsets[i] ?? 0) + (rows[i]?.height ?? 0)
  }
  return offsets
}

/**
 * Project flat render records (post-fold, in ledger order) into fixed-height
 * virtual rows; collapsed-summary rows get the compact height.
 */
export function projectVirtualRows(
  records: readonly TrajectoryRenderRecord[],
): readonly TrajectoryVirtualRow[] {
  return records.map((record, index) => ({
    record,
    height: record.collapsedSummary !== undefined
      ? COLLAPSED_SUMMARY_HEIGHT
      : record.cell.kind === 'system' && record.cell.requestSeq !== undefined
        ? REQUEST_BOUNDARY_HEIGHT
        : CONTENT_ROW_HEIGHT,
    key: record.collapsedSummary !== undefined
      ? `summary-${record.turn ?? 'between'}-${index}`
      : trajectoryRecordId(record.cell),
  }))
}
