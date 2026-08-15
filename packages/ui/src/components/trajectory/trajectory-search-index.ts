/**
 * Trajectory search index — full-text matching over ledger cells with
 * structured tool-call decomposition (DSH-aligned).
 *
 * Rebuilds lazily on query change (the ledger is bounded by the session's
 * message count). Returns hit cell indexes in ledger order; the view filters
 * the rendered records to matches (DSH behavior) instead of only
 * highlighting.
 */

import type { TrajectoryCellProps, TrajectoryRenderRecord } from './trajectory-layout'
import { trajectoryPreviewText } from './trajectory-preview'

/** Split a tool-call display text into name + args ("Name: args" or "Name · args"). */
export function toolCallTextParts(
  kind: string,
  text: string,
): { name: string; args: string } | undefined {
  if (kind !== 'tool' && kind !== 'subtool') return undefined
  const dotSeparator = text.indexOf(' · ')
  if (dotSeparator !== -1) {
    return { name: text.slice(0, dotSeparator), args: text.slice(dotSeparator + 3) }
  }
  const colonSeparator = text.indexOf(': ')
  if (colonSeparator !== -1) {
    return { name: text.slice(0, colonSeparator), args: text.slice(colonSeparator + 2) }
  }
  return { name: text, args: '' }
}

/** Markdown-aware single-line display text (DSH `recordDisplayText`). */
export function recordDisplayText(cell: TrajectoryCellProps): string {
  if (cell.previewMarkdown !== undefined) {
    const preview = trajectoryPreviewText(cell.previewMarkdown)
    if (cell.text === '') return preview
    return preview === '' ? cell.text : `${cell.text} · ${preview}`
  }
  if (cell.text !== '') return cell.text
  const markdown = cell.kind === 'user' || cell.kind === 'context'
    ? cell.inputDetail
    : cell.kind === 'message'
      ? cell.outputDetail ?? cell.thinkingDetail
      : undefined
  return markdown === undefined ? '' : trajectoryPreviewText(markdown)
}

function searchableJson(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function recordSources(cell: TrajectoryCellProps): readonly string[] {
  const sources: string[] = []
  const display = recordDisplayText(cell)
  if (display !== '') sources.push(display)
  const parts = toolCallTextParts(cell.kind, cell.text)
  if (parts !== undefined) {
    if (parts.name !== '') sources.push(parts.name)
    if (parts.args !== '') sources.push(parts.args)
  }
  if (cell.outputDetail) sources.push(cell.outputDetail)
  if (cell.inputDetail) sources.push(cell.inputDetail)
  if (cell.schemaDetail) sources.push(searchableJson(cell.schemaDetail))
  if (cell.result) sources.push(cell.result)
  return sources
}

/** Search matches for one query; hit cell indexes in ledger order. */
export function searchTrajectory(
  records: readonly TrajectoryRenderRecord[],
  query: string,
): ReadonlySet<number> {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return new Set()
  const hits = new Set<number>()
  for (const record of records) {
    if (record.collapsedSummary !== undefined) continue
    const sources = recordSources(record.cell).join('\n').toLowerCase()
    if (terms.every(term => sources.includes(term))) {
      hits.add(record.cell.index)
    }
  }
  return hits
}

/** Filter rendered records to search hits, preserving order (DSH behavior). */
export function filterRecords(
  records: readonly TrajectoryRenderRecord[],
  matches: ReadonlySet<number>,
): readonly TrajectoryRenderRecord[] {
  return records.filter(record =>
    record.collapsedSummary !== undefined || matches.has(record.cell.index),
  )
}
