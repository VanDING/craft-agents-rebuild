import { describe, expect, it } from 'bun:test'
import { isSessionWorkItemEligible } from './work-item-eligibility'

describe('session work item eligibility', () => {
  it('rejects empty placeholders and accepts the first message before title generation', () => {
    expect(isSessionWorkItemEligible({ messages: [], name: '  ' })).toBe(false)
    expect(isSessionWorkItemEligible({ messages: [{ role: 'user', content: 'Hello' }] })).toBe(true)
  })

  it('recognizes unloaded conversations and explicitly named tasks', () => {
    expect(isSessionWorkItemEligible({ messageCount: 2 })).toBe(true)
    expect(isSessionWorkItemEligible({ preview: 'Hello' })).toBe(true)
    expect(isSessionWorkItemEligible({ name: 'Planned task' })).toBe(true)
  })

  it('keeps excluded sessions off the board even with content', () => {
    for (const exclusion of [{ parentSessionId: 'parent' }, { hidden: true }, { isArchived: true }, { taskDraft: {} }]) {
      expect(isSessionWorkItemEligible({ name: 'Task', ...exclusion })).toBe(false)
    }
  })
})
