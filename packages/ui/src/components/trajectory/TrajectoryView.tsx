/**
 * TrajectoryView — full trajectory panel: timeline overview + toolbar +
 * ledger + inspector. State lives here; the panel shell (TrajectoryPanel)
 * feeds the session snapshot.
 */

import { useMemo, useState } from 'react'
import type { Message, PiUsage } from '@craft-agent/core/types'
import type { TrajectorySnapshot } from './trajectory-contract'
import {
  deriveTrajectoryLayout,
  type TrajectoryCellProps,
  type TrajectoryTurnModel,
} from './trajectory-layout'
import { searchTrajectory } from './trajectory-search-index'
import { TrajectoryToolbar } from './TrajectoryToolbar'
import { TrajectoryTimeline } from './TrajectoryTimeline'
import { TrajectoryTable } from './TrajectoryTable'
import { RecordInspector } from './RecordInspector'
import type { TrajectoryTimelineMode } from './trajectory-timeline'

export interface TrajectoryViewProps {
  snapshot: TrajectorySnapshot
  /** Session-level cumulative usage (inspector "session total"). */
  sessionTotal?: PiUsage
  /** Live-updating session (for streaming turns). */
  isProcessing?: boolean
}

export function TrajectoryView({ snapshot, sessionTotal, isProcessing }: TrajectoryViewProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set())
  const [selectedCell, setSelectedCell] = useState<TrajectoryCellProps | null>(null)
  const [timelineMode, setTimelineMode] = useState<TrajectoryTimelineMode>('actual-duration')

  const turns = useMemo<readonly TrajectoryTurnModel[]>(() => {
    return deriveTrajectoryLayout({
      contributions: snapshot.contributions,
      prompts: snapshot.prompts,
      requestUsage: snapshot.requestUsage,
      callSchemas: snapshot.callSchemas,
    })
  }, [snapshot])

  const searchHits = useMemo(() => searchTrajectory(turns, searchQuery), [turns, searchQuery])
  const searchMatchIndexes = useMemo(() => {
    const set = new Set<number>()
    for (const hit of searchHits) set.add(hit.cell.index - 1)
    return set
  }, [searchHits])

  const allTurnsCollapsed = turns.length > 0 && turns.every(t => t.turn === null || collapsedTurns.has(t.turn))
  const toggleAllTurns = () => {
    const all = new Set<number>()
    if (!allTurnsCollapsed) {
      for (const t of turns) if (t.turn !== null) all.add(t.turn)
    }
    setCollapsedTurns(all)
  }

  const toggleTurn = (turn: number | null) => {
    if (turn === null) return
    const next = new Set(collapsedTurns)
    if (next.has(turn)) next.delete(turn)
    else next.add(turn)
    setCollapsedTurns(next)
  }

  // Inspector data: previous request prompt for diff.
  const previousPrompt = useMemo(() => {
    if (!selectedCell?.sourceMessage) return undefined
    const seq = selectedCell.sourceMessage.requestSeq
    if (seq === undefined) return undefined
    const previous = snapshot.prompts.get(seq - 1)
    return previous
  }, [selectedCell, snapshot.prompts])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TrajectoryToolbar
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        allTurnsCollapsed={allTurnsCollapsed}
        onToggleAllTurns={toggleAllTurns}
        actualDuration={timelineMode === 'actual-duration'}
        onActualDurationChange={(actual) => setTimelineMode(actual ? 'actual-duration' : 'equal-width')}
      />

      <TrajectoryTimeline
        turns={turns}
        mode={timelineMode}
        onRecordFocus={setSelectedCell}
      />

      <div className="flex min-h-0 flex-1">
        <TrajectoryTable
          turns={turns}
          collapsedTurns={collapsedTurns}
          onToggleTurn={toggleTurn}
          searchMatchIndexes={searchMatchIndexes}
          selectedCell={selectedCell}
          onSelectCell={setSelectedCell}
        />

        {selectedCell && (
          <div className="w-80 shrink-0">
            <RecordInspector
              cell={selectedCell}
              previousPrompt={previousPrompt}
              sessionTotal={sessionTotal}
              onClose={() => setSelectedCell(null)}
            />
          </div>
        )}
      </div>

      {isProcessing && (
        <div className="border-t px-3 py-1 text-[10px] text-muted-foreground/60">
          Session processing — trajectory updates live.
        </div>
      )}
    </div>
  )
}
