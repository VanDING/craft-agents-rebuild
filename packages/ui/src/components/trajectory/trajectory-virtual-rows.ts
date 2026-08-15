/**
 * Trajectory virtual rows — measurable row projection for long ledgers.
 *
 * Each flat render record maps to one fixed-height row, so the view can
 * virtualize without measuring the DOM.
 */

import type { TrajectoryRenderRecord } from './trajectory-layout'
import { trajectoryRecordId } from './trajectory-layout'

export const CONTENT_ROW_HEIGHT = 38
export const COLLAPSED_SUMMARY_HEIGHT = 30

/** One virtualizer item. */
export interface TrajectoryVirtualRow {
  /** Record rendered by this row. */
  record: TrajectoryRenderRecord
  /** Height in px. */
  height: number
  /** Stable identity for React keys. */
  key: string
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
    height: record.collapsedSummary !== undefined ? COLLAPSED_SUMMARY_HEIGHT : CONTENT_ROW_HEIGHT,
    key: record.collapsedSummary !== undefined
      ? `summary-${record.turn ?? 'between'}-${index}`
      : trajectoryRecordId(record.cell),
  }))
}
