/**
 * TrajectoryView — compact summary over a turn-aware event ledger with
 * timeline range selection, search filtering, two-level folding, and a
 * record inspector. Ported from the VanDSH view over the Craft snapshot.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { motionTween } from '../../lib/motion'
import { useTranslation } from 'react-i18next'
import type { PiUsage } from '@craft-agent/core/types'
import type { TrajectorySnapshot, WorkbenchFocus } from './trajectory-contract'
import { deriveTrajectoryLayout, flattenTurnRecords, type TrajectoryCellProps, type TrajectoryTurnModel } from './trajectory-layout'
import { searchTrajectory } from './trajectory-search-index'
import { trajectoryTimelineFocusIndexes, type TrajectoryTimelineMode, type TrajectoryTimeRange } from './trajectory-timeline'
import { TrajectoryToolbar } from './TrajectoryToolbar'
import { TrajectoryStrip } from './TrajectoryStrip'
import { TrajectoryTable } from './TrajectoryTable'
import { RecordInspector } from './RecordInspector'
import { TrajectoryOverview } from './TrajectoryOverview'
import { TrajectoryContextView } from './TrajectoryContextView'
import { TrajectoryMapView } from './TrajectoryMapView'
import type { TrajectorySessionMap } from './trajectory-session-map'
import './trajectory-theme.css'

const DURATION_PREFERENCE_KEY = 'craft.trajectory.duration'
const VIEW_PREFERENCE_KEY = 'craft.trajectory.view'
const RUN_VIEWS = ['overview', 'trajectory', 'context', 'map'] as const

export type TrajectoryRunView = 'overview' | 'trajectory' | 'context' | 'map'

function readDurationPreference(): boolean {
  try {
    return localStorage.getItem(DURATION_PREFERENCE_KEY) === '1'
  } catch {
    return false
  }
}

function readViewPreference(): TrajectoryRunView {
  try {
    const value = localStorage.getItem(VIEW_PREFERENCE_KEY)
    if (value === 'prompt') return 'context'
    if (value === 'timeline' || value === 'events') return 'trajectory'
    if (value === 'overview' || value === 'trajectory' || value === 'context' || value === 'map') return value
  } catch {
    // Best-effort preference only.
  }
  return 'overview'
}

export interface TrajectoryViewProps {
  snapshot: TrajectorySnapshot
  /** Session cumulative usage for the inspector's usage tab. */
  sessionTotal?: PiUsage
  /** Whether the session is currently processing (reserved for streaming). */
  isProcessing?: boolean
  /** Session/environment facts formerly shown in the standalone Context panel. */
  contextSummary?: TrajectoryContextSummary
  /** Current session and its connected branch/subtask family. */
  sessionMap?: TrajectorySessionMap
  onOpenChat?: (messageId: string) => void
  onOpenReview?: (changeId: string) => void
  onOpenFile?: (path: string) => void
  onOpenSession?: (sessionId: string) => void
  focus?: WorkbenchFocus
  onFocusChange?: (focus: Omit<WorkbenchFocus, 'sessionId' | 'updatedAt'>) => void
}

export interface TrajectoryContextSummary {
  name?: string
  status?: string
  model?: string
  permissionMode?: string
  workingDirectory?: string
  labels?: readonly string[]
  messageCount?: number
  createdAt?: number
  lastActivityAt?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  contextTokens?: number
  costUsd?: number
}

/** Stable record identity used for assistant folding. */
function assistantRecordId(cell: TrajectoryCellProps): string {
  return cell.sourceSeq ?? cell.callId ?? `index-${cell.index}`
}

export function TrajectoryView({ snapshot, sessionTotal, isProcessing, contextSummary, sessionMap, onOpenChat, onOpenReview, onOpenFile, onOpenSession, focus, onFocusChange }: TrajectoryViewProps) {
  const { t } = useTranslation()
  const [runView, setRunView] = useState<TrajectoryRunView>(readViewPreference)
  const [visitedViews, setVisitedViews] = useState(() => new Set<TrajectoryRunView>([runView]))
  const viewId = useId()
  const reduceMotion = useReducedMotion()
  const [searchQuery, setSearchQuery] = useState('')
  const [eventFilter, setEventFilter] = useState<'all' | 'conversation' | 'tools' | 'errors'>('all')
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set())
  const [collapsedAssistants, setCollapsedAssistants] = useState<ReadonlySet<string>>(new Set())
  const [selectedCell, setSelectedCell] = useState<TrajectoryCellProps | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [timelineMode, setTimelineMode] = useState<TrajectoryTimelineMode>(() => readDurationPreference() ? 'duration' : 'sequence')
  const [timelineRange, setTimelineRange] = useState<TrajectoryTimeRange | null>(null)
  const [actualDuration, setActualDuration] = useState<boolean>(readDurationPreference)
  const [actualTime, setActualTime] = useState(false)
  const seenAssistantIdsRef = useRef(new Set<string>())

  const turns = useMemo<readonly TrajectoryTurnModel[]>(() => {
    return deriveTrajectoryLayout({
      contributions: snapshot.contributions,
      prompts: snapshot.prompts,
      requestUsage: snapshot.requestUsage,
      callSchemas: snapshot.callSchemas,
    })
  }, [snapshot])

  const flatRecords = useMemo(() => flattenTurnRecords(turns), [turns])
  const eventRecords = useMemo(() => flatRecords.filter(record => {
    if (eventFilter === 'all') return true
    if (eventFilter === 'errors') return record.cell.isError
    if (eventFilter === 'tools') return record.cell.kind === 'tool' || record.cell.kind === 'subtool'
    return record.cell.kind === 'system' || record.cell.kind === 'user' || record.cell.kind === 'message' || record.cell.kind === 'context'
  }), [eventFilter, flatRecords])

  const searchMatchIndexes = useMemo(
    () => searchQuery.trim() === '' ? null : searchTrajectory(flatRecords, searchQuery),
    [flatRecords, searchQuery],
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

  useEffect(() => {
    const newAssistantIds: string[] = []
    for (const turn of turns) {
      for (const group of turn.groups) {
        for (const cell of group.cells) {
          if (cell.kind !== 'message') continue
          const id = assistantRecordId(cell)
          if (!seenAssistantIdsRef.current.has(id)) newAssistantIds.push(id)
        }
      }
    }
    if (newAssistantIds.length === 0) return
    for (const id of newAssistantIds) seenAssistantIdsRef.current.add(id)
    setCollapsedAssistants((current) => new Set([...current, ...newAssistantIds]))
  }, [turns])

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
            onFocusChange?.({
              source: 'run',
              recordIndex: index,
              requestSeq: cell.requestSeq ?? cell.sourceMessage?.requestSeq,
              turn: turn.turn,
              messageId: cell.sourceSeq,
              callId: cell.callId,
            })
            return
          }
        }
      }
    }
  }

  const selectRunView = (view: TrajectoryRunView) => {
    setVisitedViews(current => current.has(view) ? current : new Set([...current, view]))
    setRunView(view)
    try {
      localStorage.setItem(VIEW_PREFERENCE_KEY, view)
    } catch {
      // Best-effort preference only.
    }
  }

  const openTrajectory = (index?: number) => {
    selectRunView('trajectory')
    if (index !== undefined) onSelectIndex(index)
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
    const seq = selectedCell?.requestSeq
    if (seq === undefined) return undefined
    return snapshot.prompts.get(seq - 1)
  }, [selectedCell, snapshot.prompts])

  const toolbar = (showTimelineControls: boolean, showEventFilters = false) => (
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
      searchMatchCount={searchMatchIndexes?.size}
      showTimelineControls={showTimelineControls}
      isProcessing={isProcessing}
      eventFilter={showEventFilters ? eventFilter : undefined}
      onEventFilterChange={showEventFilters ? setEventFilter : undefined}
      eventCount={showEventFilters ? eventRecords.length : undefined}
    />
  )

  const inspector = selectedCell && (
    <RecordInspector
      cell={selectedCell}
      previousPrompt={previousPrompt}
      sessionTotal={sessionTotal}
      onOpenChat={onOpenChat}
      onOpenReview={onOpenReview}
      onOpenFile={onOpenFile}
      onClose={() => setSelectedCell(null)}
    />
  )

  const ledger = (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <TrajectoryTable
        flatRecords={eventRecords}
        collapsedTurns={collapsedTurns}
        onToggleTurn={toggleTurn}
        collapsedAssistants={collapsedAssistants}
        onToggleAssistant={toggleAssistant}
        searchMatchIndexes={searchMatchIndexes}
        timelineFocusIndexes={timelineFocusIndexes}
        selectedIndex={selectedIndex}
        onSelectIndex={onSelectIndex}
      />

      {inspector}
    </div>
  )

  return (
    <div className="trajectory-root flex h-full min-h-0 flex-col @container/trajectory">
      <LayoutGroup id={viewId}>
        <div className="flex h-10 shrink-0 items-end gap-5 overflow-x-auto border-b border-border/50 bg-background/80 px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label={t('trajectory.views.label')}>
          {RUN_VIEWS.map((view, index) => (
            <button
              key={view}
              type="button"
              role="tab"
              id={`${viewId}-tab-${view}`}
              aria-controls={`${viewId}-panel-${view}`}
              tabIndex={runView === view ? 0 : -1}
              aria-selected={runView === view}
              onKeyDown={event => {
                const next = event.key === 'ArrowRight' ? (index + 1) % RUN_VIEWS.length
                  : event.key === 'ArrowLeft' ? (index + RUN_VIEWS.length - 1) % RUN_VIEWS.length
                    : event.key === 'Home' ? 0 : event.key === 'End' ? RUN_VIEWS.length - 1 : null
                if (next === null) return
                event.preventDefault()
                const target = RUN_VIEWS[next]!
                selectRunView(target)
                document.getElementById(`${viewId}-tab-${target}`)?.focus()
              }}
              onClick={() => selectRunView(view)}
              className={`relative h-10 shrink-0 px-0.5 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${runView === view ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t(`trajectory.views.${view}`)}
              {runView === view && <motion.span layoutId="run-active-view" className="absolute inset-x-0 bottom-0 h-0.5 rounded-t bg-accent" transition={motionTween(reduceMotion, 'standard', 'move')} />}
            </button>
          ))}
        </div>

      </LayoutGroup>
      <div className="min-h-0 flex-1">
        {visitedViews.has('overview') && (
          <section id={`${viewId}-panel-overview`} role="tabpanel" aria-labelledby={`${viewId}-tab-overview`} hidden={runView !== 'overview'} className="h-full min-h-0 motion-view-enter">
            <TrajectoryOverview
              snapshot={snapshot}
              turns={turns}
              records={flatRecords}
              isProcessing={isProcessing}
              contextSummary={contextSummary}
              onOpenTrajectory={openTrajectory}
              onOpenContext={(requestSeq) => {
                if (requestSeq !== undefined) onFocusChange?.({ source: 'run', requestSeq })
                selectRunView('context')
              }}
            />
          </section>
        )}
        {visitedViews.has('trajectory') && (
          <section id={`${viewId}-panel-trajectory`} role="tabpanel" aria-labelledby={`${viewId}-tab-trajectory`} hidden={runView !== 'trajectory'} className="h-full min-h-0 motion-view-enter">
            <div className="flex h-full min-h-0 flex-col">
              {toolbar(true, true)}
              <TrajectoryStrip
                turns={turns}
                mode={timelineMode}
                range={timelineRange}
                selectedIndex={selectedIndex}
                onRangeChange={(range) => {
                  setTimelineRange(range)
                  if (range) onFocusChange?.({ source: 'run', timelineRange: { ...range, mode: timelineMode } })
                }}
                onRecordSelect={onSelectIndex}
              />
              {ledger}
            </div>
          </section>
        )}
        {visitedViews.has('context') && (
          <section id={`${viewId}-panel-context`} role="tabpanel" aria-labelledby={`${viewId}-tab-context`} hidden={runView !== 'context'} className="h-full min-h-0 motion-view-enter">
            <TrajectoryContextView
              snapshot={snapshot}
              focusedRequestSeq={focus?.requestSeq}
              onRequestFocus={(requestSeq) => onFocusChange?.({ source: 'run', requestSeq })}
              onOpenChat={onOpenChat}
              onOpenFile={onOpenFile}
            />
          </section>
        )}
        {visitedViews.has('map') && sessionMap && (
          <section id={`${viewId}-panel-map`} role="tabpanel" aria-labelledby={`${viewId}-tab-map`} hidden={runView !== 'map'} className="h-full min-h-0 motion-view-enter">
            <TrajectoryMapView
              turns={turns}
              sessionMap={sessionMap}
              onSelectRecord={(index) => {
                onSelectIndex(index)
                selectRunView('trajectory')
              }}
              onOpenSession={onOpenSession}
            />
          </section>
        )}
      </div>
    </div>
  )
}
