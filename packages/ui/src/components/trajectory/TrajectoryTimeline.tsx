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
            const startMs = block.startTime ?? domain.startMs
            const rawWidth = block.durationMs !== null && mode === 'actual-duration'
              ? (block.durationMs / domainMs) * 100
              : 100 / Math.max(blocks.length, 1)
            const width = Math.max(Math.min(rawWidth, 100), 1)
            const left = block.startTime !== null
              ? ((block.startTime - domain.startMs) / domainMs) * 100
              : 0
            return (
              <div
                key={block.cell.index}
                title={block.cell.text}
                onClick={() => onRecordFocus?.(block.cell)}
                className={cn(
                  'h-3 shrink-0 cursor-pointer rounded-sm opacity-80 hover:opacity-100',
                  BLOCK_COLORS[block.cell.kind] ?? 'bg-slate-400/60',
                )}
                style={{ width: `${width}%`, marginLeft: left > 0 ? `${left}%` : undefined }}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
})
