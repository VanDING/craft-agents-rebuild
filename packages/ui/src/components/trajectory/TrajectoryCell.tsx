/**
 * TrajectoryCell — one record row in the trajectory ledger.
 *
 * Dense row: index, kind icon, summary text, status, and duration. Clicking
 * selects the row for the inspector (parent-managed via `onSelect`).
 */

import { memo } from 'react'
import { cn } from '../../lib/utils'
import type { TrajectoryCellProps } from './trajectory-layout'

export interface TrajectoryCellComponentProps {
  cell: TrajectoryCellProps
  selected?: boolean
  onSelect?: (cell: TrajectoryCellProps) => void
}

const KIND_STYLES: Record<string, string> = {
  system: 'text-violet-500',
  user: 'text-sky-500',
  context: 'text-slate-400',
  compacted: 'text-amber-500',
  message: 'text-emerald-500',
  tool: 'text-orange-500',
  subtool: 'text-orange-400/70',
}

const KIND_GLYPH: Record<string, string> = {
  system: '⚙',
  user: '❯',
  context: '·',
  compacted: '↻',
  message: '✎',
  tool: '▶',
  subtool: '↳',
}

function formatMs(seconds: number | null): string {
  if (seconds === null) return ''
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  return `${seconds.toFixed(1)}s`
}

export const TrajectoryCell = memo(function TrajectoryCell({
  cell,
  selected,
  onSelect,
}: TrajectoryCellComponentProps) {
  const statusText = cell.isError ? 'error' : cell.result ? 'done' : undefined
  const statusClass = cell.isError ? 'text-rose-500' : 'text-emerald-500/80'

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => onSelect?.(cell)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect?.(cell)
        }
      }}
      className={cn(
        'group flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-[12px] leading-4',
        'hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        selected && 'bg-accent text-accent-foreground',
      )}
    >
      <span className="w-8 shrink-0 select-none text-right tabular-nums text-muted-foreground/50">
        #{cell.index}
      </span>
      <span className={cn('w-3 shrink-0 select-none text-center', KIND_STYLES[cell.kind])}>
        {KIND_GLYPH[cell.kind] ?? '·'}
      </span>
      <span className="min-w-0 flex-1 truncate" title={cell.text}>
        {cell.text}
      </span>
      {statusText !== undefined && (
        <span className={cn('shrink-0 text-[10px] uppercase', statusClass)}>{statusText}</span>
      )}
      {cell.timeSeconds !== null && (
        <span className="shrink-0 tabular-nums text-muted-foreground/60">{formatMs(cell.timeSeconds)}</span>
      )}
    </div>
  )
})
