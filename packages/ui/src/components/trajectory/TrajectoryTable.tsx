/**
 * TrajectoryTable — turn-aware ledger with fold, selection, and search
 * highlight. Rows are projected through the virtual-row helper (fixed
 * heights) so long sessions stay smooth without DOM measurement.
 */

import { memo, useMemo } from 'react'
import { cn } from '../../lib/utils'
import type { TrajectoryTurnModel, TrajectoryCellProps } from './trajectory-layout'
import { TrajectoryCell } from './TrajectoryCell'
import { flattenTurnCells, projectVirtualRows } from './trajectory-virtual-rows'

export interface TrajectoryTableProps {
  turns: readonly TrajectoryTurnModel[]
  /** Folded turn numbers (rendered as a summary row). */
  collapsedTurns: ReadonlySet<number>
  onToggleTurn: (turn: number | null) => void
  /** Search hit cell indexes (0-based absolute position). */
  searchMatchIndexes: ReadonlySet<number>
  selectedCell: TrajectoryCellProps | null
  onSelectCell: (cell: TrajectoryCellProps) => void
}

/** Absolute position of a cell across the whole ledger. */
function cellAbsoluteIndex(cell: TrajectoryCellProps): number {
  return cell.index - 1
}

export const TrajectoryTable = memo(function TrajectoryTable({
  turns,
  collapsedTurns,
  onToggleTurn,
  searchMatchIndexes,
  selectedCell,
  onSelectCell,
}: TrajectoryTableProps) {
  const flatCells = useMemo(() => flattenTurnCells(turns), [turns])
  const rows = useMemo(() => projectVirtualRows(flatCells), [flatCells])

  return (
    <div role="table" className="min-w-0 flex-1 overflow-auto px-1 py-1">
      {turns.map((turn) => {
        const turnKey = turn.turn ?? -1
        const collapsed = turn.turn !== null && collapsedTurns.has(turn.turn)
        const cellCount = turn.groups.reduce((n, g) => n + g.cells.length, 0)

        return (
          <div key={turnKey} className="mb-1">
            {/* Turn boundary header */}
            <button
              type="button"
              onClick={() => onToggleTurn(turn.turn)}
              className={cn(
                'flex w-full items-center gap-2 rounded border-y border-t-2 px-2 py-1 text-left',
                'border-t-muted-foreground/30 text-[10px] font-semibold uppercase tracking-wide',
                'text-muted-foreground hover:bg-accent/40',
              )}
            >
              <span className="text-muted-foreground/50">{collapsed ? '▸' : '▾'}</span>
              <span>{turn.turn === null ? 'Between turns' : `Turn ${turn.turn}`}</span>
              <span className="ml-auto font-normal normal-case text-muted-foreground/50">{cellCount} records</span>
            </button>

            {collapsed ? (
              <div className="px-2 py-1 text-[11px] text-muted-foreground/60">
                {turn.groups.map((g) => g.title).join(' · ')} — {cellCount} records (folded)
              </div>
            ) : (
              turn.groups.map((group, gi) => (
                <div key={`${turnKey}-${gi}`} className="py-0.5">
                  <div className="px-2 text-[10px] font-medium text-muted-foreground/40">
                    {group.title}
                  </div>
                  {group.cells.map((cell) => {
                    const absIndex = cellAbsoluteIndex(cell)
                    const matched = searchMatchIndexes.has(absIndex)
                    const selected = selectedCell !== null && selectedCell.index === cell.index
                    return (
                      <div
                        key={cell.index}
                        className={cn(
                          matched && 'rounded bg-yellow-500/10 ring-1 ring-yellow-500/30',
                        )}
                      >
                        <TrajectoryCell
                          cell={cell}
                          selected={selected}
                          onSelect={onSelectCell}
                        />
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        )
      })}

      {rows.length === 0 && (
        <div className="px-4 py-10 text-center text-xs text-muted-foreground/50">
          No records yet — start a session to see its trajectory.
        </div>
      )}
    </div>
  )
})
