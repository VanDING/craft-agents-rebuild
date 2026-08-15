/**
 * TrajectoryToolbar — sticky toolbar: live search, fold controls, and
 * timeline display mode.
 */

import { useId } from 'react'
import { cn } from '../../lib/utils'
import { Search, ChevronsUpDown, ChevronsDownUp, Clock } from 'lucide-react'

export interface TrajectoryToolbarProps {
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  /** Whether every collapsible turn is currently folded. */
  allTurnsCollapsed: boolean
  onToggleAllTurns: () => void
  /** Whether timeline blocks use recorded durations instead of equal widths. */
  actualDuration: boolean
  onActualDurationChange: (actual: boolean) => void
}

export function TrajectoryToolbar({
  searchQuery,
  onSearchQueryChange,
  allTurnsCollapsed,
  onToggleAllTurns,
  actualDuration,
  onActualDurationChange,
}: TrajectoryToolbarProps) {
  const searchId = useId()

  return (
    <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
        <input
          id={searchId}
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Search ledger…"
          className="h-7 w-full rounded border bg-transparent pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/40 focus:border-ring"
        />
      </div>
      <button
        type="button"
        onClick={onToggleAllTurns}
        title={allTurnsCollapsed ? 'Expand all turns' : 'Collapse all turns'}
        className="inline-flex h-7 w-7 items-center justify-center rounded border text-muted-foreground hover:bg-accent"
      >
        {allTurnsCollapsed ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => onActualDurationChange(!actualDuration)}
        title={actualDuration ? 'Equal-width timeline' : 'Recorded-duration timeline'}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded border text-muted-foreground hover:bg-accent',
          actualDuration && 'border-ring text-foreground',
        )}
      >
        <Clock className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
