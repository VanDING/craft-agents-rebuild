/**
 * TrajectoryTable — turn-aware event ledger with fold, search filtering,
 * request boundaries, and selection. Ported from the VanDSH table over the
 * Craft render-record stream; virtualized with fixed-height rows.
 */

import { memo, useMemo } from 'react'
import { MessageSquare, RefreshCw, Settings, User, Wrench, FileText } from 'lucide-react'
import type { TrajectoryCellKind, TrajectoryRenderRecord, TrajectoryTurnModel } from './trajectory-layout'
import { collapseAssistantRecords, collapseTurnRecords, flattenTurnRecords, trajectoryRecordId } from './trajectory-layout'
import { filterRecords } from './trajectory-search-index'
import { projectVirtualRows } from './trajectory-virtual-rows'
import { TrajectoryCell } from './TrajectoryCell'
import css from './TrajectoryTable.module.css'

export interface TrajectoryTableProps {
  turns: readonly TrajectoryTurnModel[]
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
  turns,
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
    const flat = flattenTurnRecords(turns)
    const withTurnFolds = collapseTurnRecords(flat, collapsedTurns)
    const withAssistantFolds = collapseAssistantRecords(withTurnFolds, collapsedAssistants)
    const final = searchMatchIndexes === null
      ? withAssistantFolds
      : filterRecords(withAssistantFolds, searchMatchIndexes)
    return projectVirtualRows(final)
  }, [turns, collapsedTurns, collapsedAssistants, searchMatchIndexes])

  // Simple windowed virtualization over fixed heights.
  const virtualRows = rows

  return (
    <div className={css.tablePane}>
      <table className={css.table} data-scroll-ready="true" role="table" aria-rowcount={rows.length}>
        <colgroup>
          <col className={css.eventColumn} />
          <col className={css.contentColumn} />
        </colgroup>
        <tbody>
          {virtualRows.map((row, index) => {
            const record = row.record
            const cell = record.cell
            const isCollapsedSummary = record.collapsedSummary !== undefined
            const selected = !isCollapsedSummary && selectedIndex === cell.index
            const focus = isCollapsedSummary || timelineFocusIndexes === null
              ? undefined
              : timelineFocusIndexes.has(cell.index) ? 'inside' : 'outside'
            const requestLabel = cell.kind === 'system'
              ? `Request ${cell.index}`
              : undefined
            return (
              <tr
                key={row.key}
                role="row"
                tabIndex={isCollapsedSummary ? -1 : 0}
                aria-selected={selected || undefined}
                data-kind={cell.kind}
                data-error={cell.isError || undefined}
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
                    <TrajectoryCell
                      index={cell.index}
                      kind={cell.kind}
                      text={cell.text}
                      timeSeconds={cell.timeSeconds}
                      input={cell.input}
                      output={cell.output}
                      think={cell.think}
                      selected={selected}
                      title={requestLabel ?? cell.text}
                    />
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
    </div>
  )
})
