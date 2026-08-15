/**
 * TrajectoryView — compact summary over a turn-aware event ledger with
 * timeline range selection, search filtering, two-level folding, and a
 * record inspector. Ported from the VanDSH view over the Craft snapshot.
 */

import { useMemo, useState } from 'react'
import type { PiUsage } from '@craft-agent/core/types'
import type { TrajectorySnapshot } from './trajectory-contract'
import { deriveTrajectoryLayout, flattenTurnRecords, type TrajectoryCellProps, type TrajectoryTurnModel } from './trajectory-layout'
import { searchTrajectory } from './trajectory-search-index'
import { trajectoryTimelineFocusIndexes, type TrajectoryTimelineMode, type TrajectoryTimeRange } from './trajectory-timeline'
import { TrajectoryToolbar } from './TrajectoryToolbar'
import { TrajectoryTimeline } from './TrajectoryTimeline'
import { TrajectoryTable } from './TrajectoryTable'
import { RecordInspector } from './RecordInspector'
import './trajectory-theme.css'

const DURATION_PREFERENCE_KEY = 'craft.trajectory.duration'

function readDurationPreference(): boolean {
  try {
    return localStorage.getItem(DURATION_PREFERENCE_KEY) === '1'
  } catch {
    return false
  }
}

export interface TrajectoryViewProps {
  snapshot: TrajectorySnapshot
  /** Session cumulative usage for the inspector's usage tab. */
  sessionTotal?: PiUsage
  /** Whether the session is currently processing (reserved for streaming). */
  isProcessing?: boolean
}

/** Stable record identity used for assistant folding. */
function assistantRecordId(cell: TrajectoryCellProps): string {
  return cell.sourceSeq ?? cell.callId ?? `index-${cell.index}`
}

export function TrajectoryView({ snapshot, sessionTotal }: TrajectoryViewProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set())
  const [collapsedAssistants, setCollapsedAssistants] = useState<ReadonlySet<string>>(new Set())
  const [selectedCell, setSelectedCell] = useState<TrajectoryCellProps | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [timelineMode, setTimelineMode] = useState<TrajectoryTimelineMode>('sequence')
  const [timelineRange, setTimelineRange] = useState<TrajectoryTimeRange | null>(null)
  const [actualDuration, setActualDuration] = useState<boolean>(readDurationPreference)
  const [actualTime, setActualTime] = useState(false)

  const turns = useMemo<readonly TrajectoryTurnModel[]>(() => {
    return deriveTrajectoryLayout({
      contributions: snapshot.contributions,
      prompts: snapshot.prompts,
      requestUsage: snapshot.requestUsage,
      callSchemas: snapshot.callSchemas,
    })
  }, [snapshot])

  const searchMatchIndexes = useMemo(
    () => searchQuery.trim() === '' ? null : searchTrajectory(flattenTurnRecords(turns), searchQuery),
    [turns, searchQuery],
  )

  const timelineFocusIndexes = useMemo(
    () => timelineRange === null
      ? null
      : trajectoryTimelineFocusIndexes(turns, timelineRange, timelineMode),
    [turns, timelineRange, timelineMode],
  )

  const allTurnsCollapsed = turns.length > 0 && turns.every(t => t.turn === null || collapsedTurns.has(t.turn))
  const allAssistantsCollapsed = useMemo(() => {
    if (turns.length === 0) return false
    let hasAssistant = false
    for (const turn of turns) {
      for (const group of turn.groups) {
        for (const cell of group.cells) {
          if (cell.kind === 'message') {
            hasAssistant = true
            if (!collapsedAssistants.has(assistantRecordId(cell))) {
              return false
            }
          }
        }
      }
    }
    return hasAssistant
  }, [turns, collapsedAssistants])

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

  const toggleAllAssistants = () => {
    const all = new Set<string>()
    if (!allAssistantsCollapsed) {
      for (const turn of turns) {
        for (const group of turn.groups) {
          for (const cell of group.cells) {
            if (cell.kind === 'message') {
              all.add(assistantRecordId(cell))
            }
          }
        }
      }
    }
    setCollapsedAssistants(all)
  }

  const toggleAssistant = (recordId: string) => {
    const next = new Set(collapsedAssistants)
    if (next.has(recordId)) next.delete(recordId)
    else next.add(recordId)
    setCollapsedAssistants(next)
  }

  const onSelectIndex = (index: number) => {
    setSelectedIndex(index)
    for (const turn of turns) {
      for (const group of turn.groups) {
        for (const cell of group.cells) {
          if (cell.index === index) {
            setSelectedCell(cell)
            return
          }
        }
      }
    }
  }

  const handleActualDurationChange = (next: boolean) => {
    setActualDuration(next)
    try {
      localStorage.setItem(DURATION_PREFERENCE_KEY, next ? '1' : '0')
    } catch {
      // storage may be unavailable (private mode) — preference is best-effort
    }
    setTimelineMode(next ? 'duration' : 'sequence')
  }

  const handleActualTimeChange = (next: boolean) => {
    setActualTime(next)
    setTimelineMode(next ? 'actual' : 'duration')
  }

  // Previous request prompt for the inspector diff tab.
  const previousPrompt = useMemo(() => {
    if (!selectedCell?.sourceMessage) return undefined
    const seq = selectedCell.sourceMessage.requestSeq
    if (seq === undefined) return undefined
    return snapshot.prompts.get(seq - 1)
  }, [selectedCell, snapshot.prompts])

  return (
    <div className="trajectory-root flex h-full min-h-0 flex-col">
      <TrajectoryToolbar
        actualDuration={actualDuration}
        onActualDurationChange={handleActualDurationChange}
        actualTime={actualTime}
        onActualTimeChange={handleActualTimeChange}
        allTurnsCollapsed={allTurnsCollapsed}
        onToggleAllTurns={toggleAllTurns}
        allAssistantsCollapsed={allAssistantsCollapsed}
        onToggleAllAssistants={toggleAllAssistants}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
      />

      <TrajectoryTimeline
        turns={turns}
        mode={timelineMode}
        range={timelineRange}
        selectedIndex={selectedIndex}
        searchMatchIndexes={searchMatchIndexes}
        onRangeChange={setTimelineRange}
        onRecordSelect={onSelectIndex}
        onRecordFocus={onSelectIndex}
      />

      <div className="flex min-h-0 flex-1">
        <TrajectoryTable
          turns={turns}
          collapsedTurns={collapsedTurns}
          onToggleTurn={toggleTurn}
          collapsedAssistants={collapsedAssistants}
          onToggleAssistant={toggleAssistant}
          searchMatchIndexes={searchMatchIndexes}
          timelineFocusIndexes={timelineFocusIndexes}
          selectedIndex={selectedIndex}
          onSelectIndex={onSelectIndex}
        />

        {selectedCell && (
          <RecordInspector
            cell={selectedCell}
            previousPrompt={previousPrompt}
            sessionTotal={sessionTotal}
            onClose={() => setSelectedCell(null)}
          />
        )}
      </div>
    </div>
  )
}
