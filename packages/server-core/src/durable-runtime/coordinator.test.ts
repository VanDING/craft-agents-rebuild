import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DurableRuntimeCoordinator } from './coordinator.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'craft-coordinator-'))
  roots.push(root)
  const coordinator = new DurableRuntimeCoordinator()
  coordinator.acceptRun({
    workspaceRootPath: root,
    sessionId: 'session-1',
    turnId: 'turn-1',
    operationId: 'run-1',
    userMessageId: 'message-1',
    userMessage: 'send it',
    acceptedAt: 1,
  })
  return { root, coordinator }
}

describe('DurableRuntimeCoordinator', () => {
  test('owns a complete cross-process T1/T2 boundary', async () => {
    const { root, coordinator } = setup()
    const boundary = coordinator.boundaryFor(root)
    const prepared = await boundary.prepare({
      sessionId: 'session-1',
      turnId: 'turn-1',
      runOperationId: 'run-1',
      providerToolCallId: 'call-1',
      toolName: 'send_email',
      args: { to: 'a@example.com' },
    })
    expect(prepared.created).toBe(true)
    expect(prepared.status).toBe('reconcile_required')

    await boundary.commitOutcome({
      sessionId: 'session-1',
      turnId: 'turn-1',
      runOperationId: 'run-1',
      operationId: prepared.operationId,
      providerToolCallId: 'call-1',
      toolName: 'send_email',
      canonicalArgsHash: prepared.canonicalArgsHash,
      result: { messageId: 'remote-1' },
      isError: false,
      externalReference: 'remote-1',
    })
    expect(coordinator.storeFor(root).resolveToolRecovery(prepared.operationId)?.kind)
      .toBe('completed')

    coordinator.completeRun(root, 'run-1', 'complete')
    expect(coordinator.storeFor(root).getOperation('run-1')).toBeUndefined()
    coordinator.closeAll()
  })

  test('commits final assistant output before it is projected', () => {
    const { root, coordinator } = setup()
    const seq = coordinator.commitAssistantMessage({
      workspaceRootPath: root,
      operationId: 'run-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      messageId: 'assistant-1',
      content: 'done',
      createdAt: 2,
    })
    expect(seq).toBeGreaterThan(0)
    expect(coordinator.storeFor(root).listEvents().at(-1)?.type).toBe('assistant_message_committed')
    coordinator.closeAll()
  })

  test('parks a run whose tool outcome is unknown', async () => {
    const { root, coordinator } = setup()
    await coordinator.boundaryFor(root).prepare({
      sessionId: 'session-1',
      turnId: 'turn-1',
      runOperationId: 'run-1',
      providerToolCallId: 'call-1',
      toolName: 'send_email',
      args: { to: 'a@example.com' },
    })
    coordinator.completeRun(root, 'run-1', 'interrupted')
    expect(coordinator.storeFor(root).getOperation('run-1')?.phase).toBe('recovery_parked')
    expect(coordinator.storeFor(root).listEvents().at(-1)?.type).toBe('tool_recovery_decided')
    coordinator.closeAll()
  })

  test('startup recovery parks an unknown effect without replaying it', async () => {
    const { root, coordinator } = setup()
    const prepared = await coordinator.boundaryFor(root).prepare({
      sessionId: 'session-1',
      turnId: 'turn-1',
      runOperationId: 'run-1',
      providerToolCallId: 'call-1',
      toolName: 'send_email',
      args: { to: 'a@example.com' },
    })
    const report = coordinator.recoverWorkspace(root, 10)
    expect(report.items).toEqual([{
      operationId: 'run-1',
      sessionId: 'session-1',
      action: 'parked_unknown_effect',
      unsettledToolOperationIds: [prepared.operationId],
    }])
    expect(coordinator.storeFor(root).getOperation('run-1')?.phase).toBe('recovery_parked')
    expect(coordinator.recoverWorkspace(root, 11).items[0]?.action).toBe('already_parked')
    coordinator.closeAll()
  })

  test('startup recovery terminalizes an interrupted run with no unknown effect', () => {
    const { root, coordinator } = setup()
    expect(coordinator.recoverWorkspace(root, 10).items[0]?.action).toBe('terminalized_interrupted')
    expect(coordinator.storeFor(root).getOperation('run-1')).toBeUndefined()
    coordinator.closeAll()
  })
})
