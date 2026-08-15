/**
 * Trajectory search index — lightweight full-text index over ledger cells.
 *
 * Rebuilds lazily on query change (the ledger is bounded by the session's
 * message count, so a full scan per keystroke is acceptable; the index is
 * retained between queries for stable match identity).
 */

import type { TrajectoryTurnModel, TrajectoryCellProps } from './trajectory-layout'

interface SearchHit {
  readonly turnIndex: number
  readonly groupIndex: number
  readonly cellIndex: number
  readonly cell: TrajectoryCellProps
}

function searchableText(cell: TrajectoryCellProps): string {
  const parts: string[] = []
  if (cell.text) parts.push(cell.text)
  if (cell.previewMarkdown) parts.push(cell.previewMarkdown)
  if (cell.result) parts.push(cell.result)
  if (cell.outputDetail) parts.push(cell.outputDetail)
  if (cell.inputDetail) parts.push(cell.inputDetail)
  if (cell.schemaDetail) parts.push(cell.schemaDetail)
  return parts.join('\n').toLowerCase()
}

/**
 * Search the folded layout for cells whose text matches every whitespace-
 * separated query term (AND semantics; case-insensitive substring).
 * Returns hits in ledger order.
 */
export function searchTrajectory(
  turns: readonly TrajectoryTurnModel[],
  query: string,
): readonly SearchHit[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  const hits: SearchHit[] = []
  turns.forEach((turn, turnIndex) => {
    turn.groups.forEach((group, groupIndex) => {
      group.cells.forEach((cell, cellIndex) => {
        const text = searchableText(cell)
        if (terms.every(term => text.includes(term))) {
          hits.push({ turnIndex, groupIndex, cellIndex, cell })
        }
      })
    })
  })
  return hits
}
