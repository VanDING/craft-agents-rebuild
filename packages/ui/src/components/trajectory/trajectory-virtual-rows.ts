/**
 * Trajectory virtual rows — measurable row projection for long ledgers.
 *
 * Each logical cell maps to one fixed-height row (plus compact summaries),
 * so the view can virtualize without measuring the DOM.
 */

import type { TrajectoryCellProps } from './trajectory-layout'

export const CONTENT_ROW_HEIGHT = 30
export const COLLAPSED_SUMMARY_HEIGHT = 20

/** One virtualizer item. */
export interface TrajectoryVirtualRow {
  /** Cell rendered by this row. */
  cell: TrajectoryCellProps
  /** Height in px. */
  height: number
  /** Stable identity for React keys. */
  key: string
}

/** Stable key for a cell (message id when available, else index). */
export function trajectoryCellKey(cell: TrajectoryCellProps): string {
  if (cell.sourceSeq) return cell.sourceSeq
  if (cell.callId) return cell.callId
  return `cell-${cell.index}`
}

/**
 * Project flattened cells (in ledger order) into fixed-height virtual rows.
 * A collapsed turn summary row replaces its cell with the summary text.
 *
 * @param cells - Flattened cells from the layout.
 * @param collapsedKinds - Set of record kinds to render as compact summaries.
 */
export function projectVirtualRows(
  cells: readonly TrajectoryCellProps[],
  collapsedKinds: ReadonlySet<string> = new Set(),
): readonly TrajectoryVirtualRow[] {
  return cells.map(cell => {
    const collapsed = collapsedKinds.has(cell.kind)
    return {
      cell,
      height: collapsed ? COLLAPSED_SUMMARY_HEIGHT : CONTENT_ROW_HEIGHT,
      key: trajectoryCellKey(cell),
    }
  })
}

/** Flatten turn models into a single ordered cell list (with group titles). */
export function flattenTurnCells(
  turns: readonly { turn: number | null; groups: readonly { title: string; cells: readonly TrajectoryCellProps[] }[] }[],
): readonly TrajectoryCellProps[] {
  const out: TrajectoryCellProps[] = []
  for (const turn of turns) {
    for (const group of turn.groups) {
      out.push(...group.cells)
    }
  }
  return out
}
