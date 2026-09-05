import { describe, expect, it } from 'bun:test'
import { handleUsageUpdate } from '../session'
import type { SessionState } from '../../types'

describe('usage updates', () => {
  it('replaces ledger totals while a compacted context shrinks, retaining the full breakdown', () => {
    const state = { session: { id: 's', messages: [], tokenUsage: {
      inputTokens: 1000, outputTokens: 100, totalTokens: 1100, contextTokens: 500, costUsd: 1,
    } }, streaming: null } as unknown as SessionState
    const full = { input: 200, output: 150, cacheRead: 1000, cacheWrite: 100, totalTokens: 1450,
      cost: { input: 0.5, output: 0.5, cacheRead: 0.4, cacheWrite: 0.1, total: 1.5 } }
    const tokenUsage = { inputTokens: 1300, outputTokens: 150, totalTokens: 1450,
      contextTokens: 0, contextWindow: 200000, costUsd: 1.5, full }
    const result = handleUsageUpdate(state, { type: 'usage_update', sessionId: 's', tokenUsage })
    expect(result.state.session.tokenUsage).toEqual(tokenUsage)
    expect(state.session.tokenUsage?.contextTokens).toBe(500)
  })
})
