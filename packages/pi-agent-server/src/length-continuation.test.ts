import { describe, expect, it } from 'bun:test'
import {
  exhaustedModelOutputLimit,
  LengthContinuationTracker,
  MAX_AUTO_LENGTH_CONTINUATIONS,
} from './length-continuation.ts'

describe('exhaustedModelOutputLimit', () => {
  it('detects an assistant response that reached the declared model output limit', () => {
    expect(exhaustedModelOutputLimit({
      role: 'assistant',
      stopReason: 'length',
      usage: { output: 16_384 },
    }, 16_384)).toBe(true)
  })

  it('leaves context-clamped length stops to Pi compaction recovery', () => {
    expect(exhaustedModelOutputLimit({
      role: 'assistant',
      stopReason: 'length',
      usage: { output: 4_096 },
    }, 16_384)).toBe(false)
  })

  it('does not continue complete, non-assistant or unmetered responses', () => {
    expect(exhaustedModelOutputLimit({ role: 'assistant', stopReason: 'stop', usage: { output: 16_384 } }, 16_384)).toBe(false)
    expect(exhaustedModelOutputLimit({ role: 'user', stopReason: 'length', usage: { output: 16_384 } }, 16_384)).toBe(false)
    expect(exhaustedModelOutputLimit({ role: 'assistant', stopReason: 'length' }, 16_384)).toBe(false)
  })
})

describe('LengthContinuationTracker', () => {
  const cappedMessage = {
    role: 'assistant',
    stopReason: 'length',
    usage: { output: 16_384 },
  }

  it('bounds automatic continuations and resets for the next user prompt', () => {
    const tracker = new LengthContinuationTracker()

    expect(tracker.nextAttempt(cappedMessage, 16_384)).toBe(1)
    expect(tracker.nextAttempt(cappedMessage, 16_384)).toBe(2)
    expect(tracker.nextAttempt(cappedMessage, 16_384)).toBeUndefined()
    expect(MAX_AUTO_LENGTH_CONTINUATIONS).toBe(2)

    tracker.reset()
    expect(tracker.nextAttempt(cappedMessage, 16_384)).toBe(1)
  })
})
