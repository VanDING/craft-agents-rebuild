import type { TrajectoryCellKind, TrajectoryCellProps, TrajectoryTurnModel } from './trajectory-layout'
import { deriveTrajectoryTimeline, type TrajectoryTimelineMode } from './trajectory-timeline'

export interface TrajectoryMazeCluster {
  id: string
  indexes: readonly number[]
  cells: readonly TrajectoryCellProps[]
  start: number
  end: number
  turnStart: number | null
  turnEnd: number | null
  kind: TrajectoryCellKind
  count: number
  errorCount: number
  toolCount: number
  totalTokens: number
  durationMs: number | null
  label: string
}

function dominantKind(cells: readonly TrajectoryCellProps[]): TrajectoryCellKind {
  if (cells.some(cell => cell.isError)) return 'tool'
  const counts = new Map<TrajectoryCellKind, number>()
  for (const cell of cells) counts.set(cell.kind, (counts.get(cell.kind) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'message'
}

function clusterLabel(cells: readonly TrajectoryCellProps[], turns: readonly (number | null)[]): string {
  if (cells.length === 1) {
    const text = cells[0]?.text.replace(/\s+/g, ' ').trim() ?? ''
    return text.length > 34 ? `${text.slice(0, 34)}…` : text || `#${cells[0]?.index}`
  }
  const numbered = turns.filter((turn): turn is number => turn !== null)
  const first = numbered[0]
  const last = numbered.at(-1)
  const turnLabel = first === undefined ? 'Between turns' : first === last ? `T${first}` : `T${first}–T${last}`
  return `${turnLabel} · ×${cells.length}`
}

/** Deterministically aggregate a long run into a zoom-dependent execution path. */
export function buildTrajectoryMazeClusters(
  turns: readonly TrajectoryTurnModel[],
  mode: TrajectoryTimelineMode,
  detailLevel: number,
): readonly TrajectoryMazeCluster[] {
  const model = deriveTrajectoryTimeline(turns, mode)
  if (!model) return []
  const turnByIndex = new Map<number, number | null>()
  const cellByIndex = new Map<number, TrajectoryCellProps>()
  for (const turn of turns) {
    for (const group of turn.groups) {
      for (const cell of group.cells) {
        turnByIndex.set(cell.index, turn.turn)
        cellByIndex.set(cell.index, cell)
      }
    }
  }
  const spans = model.spans.filter(span => cellByIndex.has(span.index))
  const targetClusters = 18 * Math.max(1, detailLevel)
  const chunkSize = Math.max(1, Math.ceil(spans.length / targetClusters))
  const result: TrajectoryMazeCluster[] = []
  for (let offset = 0; offset < spans.length; offset += chunkSize) {
    const chunk = spans.slice(offset, offset + chunkSize)
    const cells = chunk.map(span => cellByIndex.get(span.index)!).filter(Boolean)
    const chunkTurns = chunk.map(span => turnByIndex.get(span.index) ?? null)
    const durations = cells.map(cell => cell.timeSeconds).filter((value): value is number => value !== null && Number.isFinite(value))
    const input = cells.reduce((sum, cell) => sum + (cell.input ?? 0) + (cell.cacheWrite ?? 0), 0)
    const output = cells.reduce((sum, cell) => sum + (cell.output ?? 0) + (cell.think ?? 0), 0)
    result.push({
      id: `${chunk[0]!.index}-${chunk.at(-1)!.index}`,
      indexes: chunk.map(span => span.index),
      cells,
      start: Math.min(...chunk.map(span => span.start)),
      end: Math.max(...chunk.map(span => span.end)),
      turnStart: chunkTurns[0] ?? null,
      turnEnd: chunkTurns.at(-1) ?? null,
      kind: dominantKind(cells),
      count: cells.length,
      errorCount: cells.filter(cell => cell.isError).length,
      toolCount: cells.filter(cell => cell.kind === 'tool' || cell.kind === 'subtool').length,
      totalTokens: input + output,
      durationMs: durations.length ? durations.reduce((sum, value) => sum + value * 1000, 0) : null,
      label: clusterLabel(cells, chunkTurns),
    })
  }
  return result
}
