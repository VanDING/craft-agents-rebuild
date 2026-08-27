import { describe, expect, test } from 'bun:test'
import { attachDurableToolContext, durableToolFromContext } from './durable-tool-context.ts'

const durableTool = {
  operationId: 'tool-op-1',
  runOperationId: 'run-1',
  idempotencyKey: 'tool-op-1',
  canonicalArgsHash: 'sha256:args',
  recoveryMode: 'idempotent_keyed' as const,
}

describe('durable tool execution context', () => {
  test('adds stable identity without mutating the original SDK context', () => {
    const original = { sessionId: 'pi-session-1' }
    const attached = attachDurableToolContext(original, durableTool)
    expect(attached).toEqual({ ...original, durableTool })
    expect(original).toEqual({ sessionId: 'pi-session-1' })
  })

  test('proxy tools recover the exact identity from the fifth execute argument', () => {
    expect(durableToolFromContext(attachDurableToolContext(undefined, durableTool)))
      .toEqual(durableTool)
    expect(durableToolFromContext(undefined)).toBeUndefined()
  })
})
