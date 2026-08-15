/**
 * TrajectoryTimeline — Chrome-Network-style overview strip above the ledger.
 *
 * Blocks are laid out across the full session domain; clicking a block
 * focuses it in the ledger. The range window is not draggable in this
 * revision — focus navigation via blocks and the toolbar mode switch.
 */

import { memo, useMemo } from 'react'
import { cn } from '../../lib/utils'
import type { TrajectoryTurnModel, TrajectoryCellProps } from './trajectory-layout'
import {
  trajectoryDomain,
  trajectoryTimelineBlocks,
  type TrajectoryTimelineMode,
} from './trajectory-timeline'

export interface TrajectoryTimelineProps {
  turns: readonly TrajectoryTurnModel[]
  mode: TrajectoryTimelineMode
  onRecordFocus?: (cell: TrajectoryCellProps) => void
}

const BLOCK_COLORS: Record<string, string> = {
  system: 'bg-violet-500/70',
  user: 'bg-sky-500/70',
  context: 'bg-slate-500/50',
  compacted: 'bg-amber-500/70',
  message: 'bg-emerald-500/70',
  tool: 'bg-orange-500/70',
  subtool: 'bg-orange-400/50',
}

export const TrajectoryTimeline = memo(function TrajectoryTimeline({
  turns,
  mode,
  onRecordFocus,
}: TrajectoryTimelineProps) {
  const domain = useMemo(() => trajectoryDomain(turns), [turns])

  // Flatten blocks across all turns with per-turn lane breaks.
  const lanes = useMemo(() => {
    return turns.map((turn) => ({
      turn,
      blocks: trajectoryTimelineBlocks(turn),
    }))
  }, [turns])

  if (!domain) {
    return <div className="h-8 border-b" />
  }

  const domainMs = Math.max(domain.endMs - domain.startMs, 1)

  return (
    <div className="space-y-0.5 border-b px-2 py-1.5">
      {lanes.map(({ turn, blocks }) => (
        <div key={turn.turn ?? 'between'} className="flex h-3 items-center gap-px">
          {blocks.map((block) => {
            const left = block.startTime !== null
              ? ((block.startTime - domain.startMs) / domainMs) * 100
              : 0
            const timed = mode === 'actual-duration'
            const remaining = 100 - left
            const rawWidth = block.durationMs !== null && timed
              ? (block.durationMs / domainMs) * 100
              // Unknown span (final record): stretch from its start to the
              // lane edge instead of overflowing past the container; when the
              // record already sits at the edge there is no room, so skip.
              : timed
                ? remaining
                : 100 / Math.max(blocks.length, 1)
            const width = timed && block.durationMs === null
              ? remaining
              : Math.max(Math.min(rawWidth, timed ? remaining : 100), 1)
            return width > 0.5 ? (
              <div
                key={block.cell.index}
                title={block.cell.text}
                onClick={() => onRecordFocus?.(block.cell)}
                className={cn(
                  'h-3 shrink-0 cursor-pointer rounded-sm opacity-80 hover:opacity-100',
                  BLOCK_COLORS[block.cell.kind] ?? 'bg-slate-400/60',
                )}
                style={{ width: `${width}%`, marginLeft: timed && left > 0 ? `${left}%` : undefined }}
              />
            ) : null
          })}
        </div>
      ))}
    </div>
  )
})
