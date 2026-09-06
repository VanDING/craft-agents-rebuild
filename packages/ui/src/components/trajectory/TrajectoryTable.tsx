/**
 * TrajectoryTable — turn-aware event ledger with fold, search filtering,
 * request boundaries, and selection. Ported from the VanDSH table over the
 * Craft render-record stream; virtualized with fixed-height rows.
 */

import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, RefreshCw, Settings, User, Wrench, FileText } from 'lucide-react'
import type { TrajectoryCellKind, TrajectoryRenderRecord } from './trajectory-layout'
import { collapseAssistantRecords, collapseTurnRecords, formatElapsedSeconds, trajectoryRecordId } from './trajectory-layout'
import { filterRecords, recordDisplayText } from './trajectory-search-index'
import { computeVirtualRowWindow, projectVirtualRows } from './trajectory-virtual-rows'
import css from './TrajectoryTable.module.css'

export interface TrajectoryTableProps {
  flatRecords: readonly TrajectoryRenderRecord[]
  /** Folded turn numbers (rendered as summary rows). */
  collapsedTurns: ReadonlySet<number>
  onToggleTurn: (turn: number | null) => void
  /** Folded assistant record ids (their tool calls collapse into summaries). */
  collapsedAssistants: ReadonlySet<string>
  onToggleAssistant: (recordId: string) => void
  /** Search hit indexes; null when there is no active query (no filtering). */
  searchMatchIndexes: ReadonlySet<number> | null
  /** Timeline focus interval hit indexes; null when no interval selected. */
  timelineFocusIndexes: ReadonlySet<number> | null
  /** Selected record index. */
  selectedIndex: number | null
  onSelectIndex: (index: number) => void
}

const KIND_LABEL: Record<TrajectoryCellKind, string> = {
  system: 'System',
  user: 'User',
  context: 'Context',
  compacted: 'Compacted',
  message: 'Message',
  tool: 'Tool',
  subtool: 'Sub-tool',
}

function KindIcon({ kind }: { kind: TrajectoryCellKind }) {
  const iconClass = css.kindTagIcon ?? ''
  switch (kind) {
    case 'system': return <Settings className={iconClass} aria-hidden="true" />
    case 'user': return <User className={iconClass} aria-hidden="true" />
    case 'context': return <FileText className={iconClass} aria-hidden="true" />
    case 'compacted': return <RefreshCw className={iconClass} aria-hidden="true" />
    case 'tool':
    case 'subtool': return <Wrench className={iconClass} aria-hidden="true" />
    default: return <MessageSquare className={iconClass} aria-hidden="true" />
  }
}

function kindTagClass(kind: TrajectoryCellKind): string {
  switch (kind) {
    case 'system': return css.systemNeutral ?? ''
    case 'context': return css.contextGreen ?? ''
    case 'compacted': return css.compacted ?? ''
    case 'tool': return css.toolAmber ?? ''
    case 'message': return css.assistantVioletBright ?? ''
    case 'subtool': return css.subtoolAmber ?? ''
    default: return ''
  }
}

function sectionLabel(turn: number | null): string {
  return turn === null ? 'Between turns' : `Turn ${turn}`
}

export const TrajectoryTable = memo(function TrajectoryTable({
  flatRecords,
  collapsedTurns,
  onToggleTurn,
  collapsedAssistants,
  onToggleAssistant,
  searchMatchIndexes,
  timelineFocusIndexes,
  selectedIndex,
  onSelectIndex,
}: TrajectoryTableProps) {
  const rows = useMemo(() => {
    const withTurnFolds = collapseTurnRecords(flatRecords, collapsedTurns)
    const withAssistantFolds = collapseAssistantRecords(withTurnFolds, collapsedAssistants)
    const final = searchMatchIndexes === null
      ? withAssistantFolds
      : filterRecords(withAssistantFolds, searchMatchIndexes)
    return projectVirtualRows(final)
  }, [flatRecords, collapsedTurns, collapsedAssistants, searchMatchIndexes])

  const paneRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  useLayoutEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    const observer = new ResizeObserver(() => setViewportHeight(pane.clientHeight))
    observer.observe(pane)
    setViewportHeight(pane.clientHeight)
    return () => observer.disconnect()
  }, [])

  const visibleWindow = useMemo(
    () => computeVirtualRowWindow(rows, scrollTop, viewportHeight),
    [rows, scrollTop, viewportHeight],
  )
  const visibleRows = rows.slice(visibleWindow.start, visibleWindow.end)

  useLayoutEffect(() => {
    if (selectedIndex === null) return
    const pane = paneRef.current
    const rowIndex = rows.findIndex(row => row.record.cell.index === selectedIndex)
    if (!pane || rowIndex < 0) return
    const top = rows.slice(0, rowIndex).reduce((sum, row) => sum + row.height, 0)
    const bottom = top + (rows[rowIndex]?.height ?? 0)
    if (top < pane.scrollTop) pane.scrollTo({ top, behavior: 'smooth' })
    else if (bottom > pane.scrollTop + pane.clientHeight) pane.scrollTo({ top: Math.max(0, bottom - pane.clientHeight), behavior: 'smooth' })
  }, [rows, selectedIndex])

  return (
    <div
      ref={paneRef}
      className={css.tablePane}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      {visibleWindow.top > 0 && <div style={{ height: visibleWindow.top }} aria-hidden="true" />}
      <table className={css.table} role="table" aria-rowcount={rows.length}>
        <colgroup>
          <col className={css.eventColumn} />
          <col className={css.contentColumn} />
        </colgroup>
        <tbody>
          {visibleRows.map((row) => {
            const record = row.record
            const cell = record.cell
            const isCollapsedSummary = record.collapsedSummary !== undefined
            const selected = !isCollapsedSummary && selectedIndex === cell.index
            const focus = isCollapsedSummary || timelineFocusIndexes === null
              ? undefined
              : timelineFocusIndexes.has(cell.index) ? 'inside' : 'outside'
            const displayText = isCollapsedSummary ? ''
              : cell.kind === 'system' && cell.requestSeq !== undefined
                ? `System prompt · Request #${cell.requestSeq}`
                : recordDisplayText(cell)
            const resultText = !isCollapsedSummary && cell.result !== undefined && cell.result !== ''
              ? cell.result
              : undefined
            return (
              <tr
                key={row.key}
                role="row"
                tabIndex={isCollapsedSummary ? -1 : 0}
                aria-selected={selected || undefined}
                data-kind={cell.kind}
                data-error={cell.isError || undefined}
                data-request-only={cell.kind === 'system' && cell.requestSeq !== undefined || undefined}
                data-collapsed-summary={record.collapsedSummaryKind}
                data-timeline-focus={focus}
                data-record-index={isCollapsedSummary ? undefined : cell.index}
                data-turn-start={record.turnStart || undefined}
                data-group-start={record.groupStart || undefined}
                onClick={() => {
                  if (isCollapsedSummary) {
                    if (record.collapsedSummaryKind === 'turn' && record.turn !== null) {
                      onToggleTurn(record.turn)
                    } else {
                      onToggleAssistant(trajectoryRecordId(record.cell))
                    }
                    return
                  }
                  onSelectIndex(cell.index)
                }}
                onKeyDown={(event) => {
                  if (isCollapsedSummary) return
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  onSelectIndex(cell.index)
                }}
              >
                <td className={css.event}>
                  {record.turn !== null && record.turnStart && (
                    <span className={css.turnLabel} aria-label={sectionLabel(record.turn)}>
                      <span className={css.turnLabelFull} aria-hidden="true">{sectionLabel(record.turn)}</span>
                      <span className={css.turnLabelCompact} aria-hidden="true">#{record.turn}</span>
                    </span>
                  )}
                  {selected && <span className={css.selectionRail} aria-hidden="true" />}
                  <div className={css.eventInner}>
                    {!isCollapsedSummary && (
                      <span className={css.kindSlot}>
                        <span
                          className={`${css.kindTag} ${kindTagClass(cell.kind)}`}
                          data-role-kind={cell.kind}
                          title={KIND_LABEL[cell.kind]}
                        >
                          <KindIcon kind={cell.kind} />
                          <span className={css.kindTagLabel}>{KIND_LABEL[cell.kind]}</span>
                        </span>
                      </span>
                    )}
                  </div>
                </td>
                <td className={css.content}>
                  {isCollapsedSummary ? (
                    <span className={css.collapsedTurnContent} title={record.collapsedSummary}>
                      <span className={css.collapsedTurnEllipsis}>…</span>
                      <span className={css.collapsedTurnText}>{record.collapsedSummary}</span>
                    </span>
                  ) : (
                    <div className={css.contentRow}>
                      <span className={css.contentText} title={displayText}>
                        {displayText}
                        {resultText !== undefined && (
                          <span className={cell.isError ? `${css.inlineResult} ${css.error}` : css.inlineResult}>
                            <span className={css.arrow}>→</span>
                            <span className={css.inlineResultText}>{resultText}</span>
                          </span>
                        )}
                      </span>
                      {cell.timeSeconds !== null && (
                        <span className={css.time}>{formatElapsedSeconds(cell.timeSeconds)}</span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr className={css.eventInner}>
              <td colSpan={2} className={css.content}>
                <span className={css.contentText}>No records yet — start a session to see its trajectory.</span>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {visibleWindow.bottom > 0 && <div style={{ height: visibleWindow.bottom }} aria-hidden="true" />}
    </div>
  )
})
