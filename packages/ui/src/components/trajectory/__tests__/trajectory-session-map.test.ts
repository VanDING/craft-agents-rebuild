import { describe, expect, it } from 'bun:test'
import type { TrajectoryTurnModel } from '../trajectory-layout'
import { buildTrajectorySessionMapLayout, selectTrajectorySessionFamily, type TrajectoryMapSession } from '../trajectory-session-map'

const sessions: TrajectoryMapSession[] = [
  { id: 'root', title: 'Root', createdAt: 1 },
  { id: 'current', title: 'Current', branchFromSessionId: 'root', branchFromMessageId: 'root-answer', createdAt: 2 },
  { id: 'branch', title: 'Branch', branchFromSessionId: 'current', branchFromMessageId: 'answer-1', createdAt: 3 },
  { id: 'task', title: 'Task', parentSessionId: 'current', createdAt: 4 },
  { id: 'grandchild', title: 'Grandchild', parentSessionId: 'task', createdAt: 5 },
  { id: 'unrelated', title: 'Unrelated', createdAt: 6 },
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
      'root', 'current', 'branch', 'task', 'grandchild',
    ])
  })

  it('anchors a branch to its source turn and preserves turn summaries', () => {
    const layout = buildTrajectorySessionMapLayout(turns, { currentSessionId: 'current', sessions })
    const turn = layout.nodes.find(node => node.id === 'turn:1')
    expect(turn?.type).toBe('turn')
    if (turn?.type === 'turn') {
      expect(turn.question).toBe('How does it work?')
      expect(turn.toolCount).toBe(1)
      expect(turn.errorCount).toBe(1)
    }
    expect(layout.edges).toContainEqual({
      id: 'turn:1->session:branch',
      from: 'turn:1',
      to: 'session:branch',
      kind: 'branch',
    })
  })

  it('keeps the collapsed session visible while hiding its descendants', () => {
    const layout = buildTrajectorySessionMapLayout(
      turns,
      { currentSessionId: 'current', sessions },
      new Set(['task']),
    )
    expect(layout.nodes.some(node => node.id === 'session:task')).toBe(true)
    expect(layout.nodes.some(node => node.id === 'session:grandchild')).toBe(false)
  })
})
