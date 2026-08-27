import { describe, expect, test } from 'bun:test'
import { durableToolMeta } from './durable-tool-meta.ts'

describe('MCP durable tool metadata', () => {
  test('uses a namespaced request metadata key without modifying tool arguments', () => {
    const identity = {
      operationId: 'tool-op-1',
      runOperationId: 'run-1',
      idempotencyKey: 'tool-op-1',
      canonicalArgsHash: 'sha256:args',
      recoveryMode: 'idempotent_keyed' as const,
    }
    const args = { title: 'Keep payload stable' }
    expect(durableToolMeta(identity)).toEqual({ 'craft/durable-operation': identity })
    expect(args).toEqual({ title: 'Keep payload stable' })
  })

  test('omits metadata for legacy callers', () => {
    expect(durableToolMeta()).toBeUndefined()
  })
})
