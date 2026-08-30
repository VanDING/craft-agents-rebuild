import { describe, expect, it } from 'bun:test'
import type { TrajectoryCellProps, TrajectoryTurnModel } from '../trajectory-layout'
import { buildTrajectoryMazeClusters } from '../trajectory-maze'

function turnsWithCells(cells: readonly TrajectoryCellProps[]): readonly TrajectoryTurnModel[] {
  return [{ turn: 1, groups: [{ title: 'Execution', cells: [...cells] }] }]
}

describe('buildTrajectoryMazeClusters', () => {
  it('progressively expands a long execution path', () => {
    const cells = Array.from({ length: 80 }, (_, index): TrajectoryCellProps => ({
      index: index + 1,
      kind: index % 3 === 0 ? 'tool' : 'message',
      text: `Operation ${index + 1}`,
      timeSeconds: 0.1,
    }))
    const overview = buildTrajectoryMazeClusters(turnsWithCells(cells), 'sequence', 1)
    const detailed = buildTrajectoryMazeClusters(turnsWithCells(cells), 'sequence', 4)

    expect(overview.length).toBeLessThanOrEqual(18)
    expect(detailed.length).toBeGreaterThan(overview.length)
    expect(detailed.length).toBeLessThanOrEqual(72)
    expect(overview.reduce((sum, cluster) => sum + cluster.count, 0)).toBe(80)
  })

  it('preserves errors, tools, tokens, duration and projected range', () => {
    const cells: readonly TrajectoryCellProps[] = [
      { index: 1, kind: 'message', text: 'Plan', timeSeconds: 0.5, input: 10, output: 5 },
      { index: 2, kind: 'tool', text: 'Read', timeSeconds: 1.5, isError: true, input: 2, cacheWrite: 3 },
    ]
    const clusters = buildTrajectoryMazeClusters(turnsWithCells(cells), 'sequence', 1)

    expect(clusters).toHaveLength(2)
    expect(clusters[0]).toMatchObject({ start: 0, end: 1, totalTokens: 15, durationMs: 500 })
    expect(clusters[1]).toMatchObject({ start: 1, end: 2, errorCount: 1, toolCount: 1, totalTokens: 5, durationMs: 1500 })
  })

  it('omits untimed records from clock projections', () => {
    const cells: readonly TrajectoryCellProps[] = [
      { index: 1, kind: 'message', text: 'Untimed', timeSeconds: null },
      { index: 2, kind: 'tool', text: 'Timed', startedAt: 2_000, timeSeconds: 1 },
    ]

    expect(buildTrajectoryMazeClusters(turnsWithCells(cells), 'actual', 1).map(cluster => cluster.indexes)).toEqual([[2]])
  })
})
