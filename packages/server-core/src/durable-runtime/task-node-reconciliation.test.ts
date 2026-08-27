import { describe, expect, test } from 'bun:test'
import { createTaskNodeReconciliationAdapter, type ReconciliationTaskChild } from './task-node-reconciliation.js'

describe('task_node_dispatch production reconciliation adapter', () => {
  test('requires a committed child input before deciding the dispatch completed', async () => {
    const child: ReconciliationTaskChild = {
      id: 'child-1', taskSlug: 'build', taskRunId: 'r1', taskNodeId: 'write', messages: [],
    }
    const adapter = createTaskNodeReconciliationAdapter(() => [child], async () => {})
    const input = {
      operationId: 'tool-op', idempotencyKey: 'tool-op',
      args: { taskSlug: 'build', runId: 'r1', nodeId: 'write', attempt: 1 },
    }

    await expect(adapter.queryExternal(input)).rejects.toThrow(/without a committed input message/)
    child.messages.push({ id: 'user-1', role: 'user' })
    await expect(adapter.queryExternal(input)).resolves.toMatchObject({
      decision: 'completed',
      result: { childSessionId: 'child-1', userMessageId: 'user-1' },
      externalReference: 'child-1',
    })
  })

  test('only reports definitely-not-executed when no child identity exists', async () => {
    const adapter = createTaskNodeReconciliationAdapter(() => [], async () => {})
    await expect(adapter.queryExternal({
      operationId: 'tool-op', idempotencyKey: 'tool-op',
      args: { taskSlug: 'build', runId: 'r1', nodeId: 'write' },
    })).resolves.toMatchObject({ decision: 'definitely_not_executed', result: { childSessionId: null } })
  })
})
