import { describe, expect, it } from 'bun:test'
import { isVisibleActivity } from '../turn-utils'
import type { ActivityItem } from '../TurnCard'

function intermediate(overrides: Partial<ActivityItem>): ActivityItem {
  return {
    id: 'int-1',
    type: 'intermediate',
    status: 'completed',
    content: 'some commentary',
    timestamp: 1,
    ...overrides,
  }
}

describe('isVisibleActivity', () => {
  it('hides completed intermediate rows without text content', () => {
    expect(isVisibleActivity(intermediate({ content: '' }))).toBe(false)
    expect(isVisibleActivity(intermediate({ content: '   ' }))).toBe(false)
  })

  it('keeps intermediate rows with text content', () => {
    expect(isVisibleActivity(intermediate({ content: 'Checking for auth handlers' }))).toBe(true)
  })

  it('keeps running intermediate rows with no content as "Thinking..."', () => {
    expect(isVisibleActivity(intermediate({ status: 'running', content: '' }))).toBe(true)
  })

  it('keeps tool activities regardless of intermediate criteria', () => {
    expect(isVisibleActivity({
      id: 't1',
      type: 'tool',
      status: 'completed',
      toolName: 'Bash',
      timestamp: 1,
    })).toBe(true)
  })
})
