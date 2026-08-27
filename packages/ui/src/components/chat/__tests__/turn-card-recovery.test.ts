import { describe, expect, it } from 'bun:test'
import { canBranchFromTurn } from '../recovery-policy'
import type { ActivityItem } from '../TurnCard'

function activity(status: ActivityItem['status']): ActivityItem {
  return {
    id: `activity-${status}`,
    type: 'tool',
    status,
    toolName: 'SendEmail',
    timestamp: 1,
  }
}

describe('TurnCard recovery policy', () => {
  it('disables branch/replay actions while any tool outcome is unknown', () => {
    expect(canBranchFromTurn([
      activity('completed'),
      activity('unknown'),
    ])).toBe(false)
  })

  it('keeps branch actions available for terminal known outcomes', () => {
    expect(canBranchFromTurn([
      activity('completed'),
      activity('error'),
    ])).toBe(true)
  })
})
