import { describe, expect, it } from 'bun:test'
import type { TrajectoryTurnModel } from '../trajectory-layout'
import { buildTrajectorySessionMapLayout, selectTrajectorySessionFamily, type TrajectoryMapSession } from '../trajectory-session-map'

const sessions: TrajectoryMapSession[] = [
  { id: 'root', title: 'Root', createdAt: 1 },
  { id: 'current', title: 'Current', branchFromSessionId: 'root', branchFromMessageId: 'root-answer', createdAt: 2 },
  { id: 'branch-a', title: 'Branch A', branchFromSessionId: 'current', branchFromMessageId: 'answer-1', createdAt: 3 },
  { id: 'branch-b', title: 'Branch B', branchFromSessionId: 'current', branchFromMessageId: 'answer-1', createdAt: 4 },
  { id: 'task', title: 'Task', parentSessionId: 'current', createdAt: 5 },
  { id: 'grandchild', title: 'Grandchild', parentSessionId: 'task', createdAt: 6 },
  { id: 'unrelated', title: 'Unrelated', createdAt: 7 },
]

const turns: TrajectoryTurnModel[] = [{
  turn: 1,
  groups: [{
    title: 'User',
    cells: [{ index: 1, kind: 'user', text: 'How does it work?', sourceSeq: 'user-1', timeSeconds: 0 }],
  }, {
    title: 'Assistant',
    cells: [{ index: 2, kind: 'message', text: 'Here is the answer', sourceSeq: 'answer-1', timeSeconds: 1 }],
  }, {
    title: 'Tools',
    cells: [{ index: 3, kind: 'tool', text: 'Read', callId: 'call-1', isError: true, timeSeconds: 0.2 }],
  }],
}]

describe('trajectory session map', () => {
  it('selects only the connected session family', () => {
    expect(selectTrajectorySessionFamily('current', sessions).map(session => session.id)).toEqual([
      'root', 'current', 'branch-a', 'branch-b', 'task', 'grandchild',
    ])
  })

  it('keeps turns inside the active session and annotates real branch edges', () => {
    const layout = buildTrajectorySessionMapLayout(turns, { currentSessionId: 'current', sessions })
    expect(layout.nodes.every(node => node.type === 'session')).toBe(true)
    expect(layout.nodes.find(node => node.session.id === 'current')?.turnCount).toBe(1)
    expect(layout.edges).toContainEqual({
      id: 'session:current->session:branch-a',
      from: 'session:current',
      to: 'session:branch-a',
      kind: 'branch',
      sourceTurn: 1,
    })
    expect(layout.nodes.find(node => node.session.id === 'branch-a')?.branchFromTurn).toBe(1)
  })

  it('does not grow the canvas when a session accumulates more turns', () => {
    const longRun = Array.from({ length: 50 }, (_, index): TrajectoryTurnModel => ({
      turn: index + 1,
      groups: [{
        title: 'User',
        cells: [{ index, kind: 'user', text: `Question ${index + 1}`, sourceSeq: `user-${index + 1}`, timeSeconds: index }],
      }],
    }))
    const shortLayout = buildTrajectorySessionMapLayout(turns, { currentSessionId: 'current', sessions })
    const longLayout = buildTrajectorySessionMapLayout(longRun, { currentSessionId: 'current', sessions })
    expect(longLayout.width).toBe(shortLayout.width)
    expect(longLayout.height).toBe(shortLayout.height)
    expect(longLayout.nodes.find(node => node.session.id === 'current')?.turnCount).toBe(50)
  })

  it('places siblings from the same source turn without overlap', () => {
    const layout = buildTrajectorySessionMapLayout(turns, { currentSessionId: 'current', sessions })
    const first = layout.nodes.find(node => node.session.id === 'branch-a')!
    const second = layout.nodes.find(node => node.session.id === 'branch-b')!
    const overlaps = first.x < second.x + second.width
      && first.x + first.width > second.x
      && first.y < second.y + second.height
      && first.y + first.height > second.y
    expect(overlaps).toBe(false)
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeGreaterThanOrEqual(0)
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width)
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height)
    }
  })

  it('keeps the collapsed session visible while hiding its descendants', () => {
    const layout = buildTrajectorySessionMapLayout(
      turns,
      { currentSessionId: 'current', sessions },
      new Set(['task']),
    )
    expect(layout.nodes.some(node => node.session.id === 'task')).toBe(true)
    expect(layout.nodes.some(node => node.session.id === 'grandchild')).toBe(false)
  })
})
