import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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

  test('aggregates a parallel tool batch and accepts out-of-order T2 commits', async () => {
    const { root, coordinator } = setup()
    const boundary = coordinator.boundaryFor(root)
    const calls = await Promise.all(['call-a', 'call-b', 'call-c'].map((providerToolCallId, toolBatchOrdinal) =>
      boundary.prepare({
        sessionId: 'session-1',
        turnId: 'turn-1',
        runOperationId: 'run-1',
        providerToolCallId,
        toolBatchId: 'modelop-batch-1',
        toolBatchOrdinal,
        toolName: 'read',
        args: { path: `${providerToolCallId}.txt` },
      })))

    expect(coordinator.storeFor(root).getOperation('run-1')).toMatchObject({
      phase: 'tool_effect_pending',
      data: { unsettledToolOperationIds: calls.map(call => call.operationId) },
    })
    expect(coordinator.storeFor(root).getToolRecoveryEvidence(calls[1]!.operationId)?.dispatch)
      .toMatchObject({ toolBatchId: 'modelop-batch-1', toolBatchOrdinal: 1 })

    const commit = (index: number) => boundary.commitOutcome({
      sessionId: 'session-1',
      turnId: 'turn-1',
      runOperationId: 'run-1',
      operationId: calls[index]!.operationId,
      providerToolCallId: `call-${String.fromCharCode(97 + index)}`,
      toolBatchId: 'modelop-batch-1',
      toolBatchOrdinal: index,
      toolName: 'read',
      canonicalArgsHash: calls[index]!.canonicalArgsHash,
      result: { index },
      isError: false,
    })

    await commit(1)
    expect(coordinator.storeFor(root).getOperation('run-1')?.phase).toBe('tool_effect_pending')
    await commit(0)
    expect(coordinator.storeFor(root).getOperation('run-1')).toMatchObject({
      phase: 'tool_effect_pending',
      data: { unsettledToolOperationIds: [calls[2]!.operationId] },
    })
    await commit(2)
    expect(coordinator.storeFor(root).getOperation('run-1')).toMatchObject({ phase: 'checkpoint' })
    expect(coordinator.storeFor(root).getOperation('run-1')?.data).not.toHaveProperty('currentTool')
    expect(coordinator.storeFor(root).getOperation('run-1')?.data).not.toHaveProperty('unsettledToolOperationIds')

    coordinator.completeRun(root, 'run-1', 'complete')
    expect(coordinator.storeFor(root).getOperation('run-1')).toBeUndefined()
    coordinator.closeAll()
  })

  test('does not start the next model attempt while any tool effect is unsettled', async () => {
    const { root, coordinator } = setup()
    await coordinator.prepareTool(root, {
      sessionId: 'session-1',
      turnId: 'turn-1',
      runOperationId: 'run-1',
      providerToolCallId: 'call-1',
      toolName: 'read',
      args: { path: 'a.txt' },
    })

    await expect(coordinator.prepareModel(root, {
      sessionId: 'session-1',
      turnId: 'turn-1',
      runOperationId: 'run-1',
      providerRequestId: '2',
      provider: 'openai',
      model: 'gpt-test',
      canonicalRequestHash: 'hash-2',
    })).rejects.toThrow('still has 1 unsettled tool operation')
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
    const snapshot = coordinator.getRecoveryEvidence(root, prepared.operationId)
    expect(snapshot?.sessionId).toBe('session-1')
    expect(snapshot?.runOperation.phase).toBe('recovery_parked')
    expect(snapshot?.evidence.dispatch?.operationId).toBe(prepared.operationId)
    expect(snapshot?.verdict.kind).toBe('reconcile_required')
    expect(coordinator.getRecoveryEvidence(root, 'missing-operation')).toBeUndefined()
    expect(coordinator.recoverWorkspace(root, 11).items[0]?.action).toBe('already_parked')
    coordinator.closeAll()
  })

  test('startup recovery terminalizes an interrupted run with no unknown effect', () => {
    const { root, coordinator } = setup()
    expect(coordinator.recoverWorkspace(root, 10).items[0]?.action).toBe('terminalized_interrupted')
    expect(coordinator.storeFor(root).getOperation('run-1')).toBeUndefined()
    coordinator.closeAll()
  })

  test('atomically commits an assistant model outcome and deduplicated usage', () => {
    const { root, coordinator } = setup()
    const commit = () => coordinator.commitAssistantMessage({
      workspaceRootPath: root,
      operationId: 'run-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      messageId: 'assistant-usage-1',
      content: 'paid response',
      usage: {
        usageId: 'model:run-1:1',
        provider: 'anthropic',
        model: 'claude-test',
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.01,
        payload: { kind: 'model_attempt', requestSeq: 1 },
      },
      createdAt: 2,
    })

    expect(commit()).toBeGreaterThan(0)
    expect(commit()).toBeGreaterThan(0)
    const store = coordinator.storeFor(root)
    expect(store.listUsage({ sessionId: 'session-1' })).toEqual([expect.objectContaining({
      usageId: 'model:run-1:1',
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.01,
    })])
    expect(store.listEvents().map(item => item.type)).toContain('usage_committed')
    coordinator.closeAll()
  })

  test('owns model T1/T2 and usage across the provider effect boundary', async () => {
    const { root, coordinator } = setup()
    const boundary = coordinator.modelBoundaryFor(root)
    const prepared = await boundary.prepare({
      sessionId: 'session-1',
      turnId: 'turn-1',
      runOperationId: 'run-1',
      providerRequestId: '1',
      provider: 'anthropic',
      model: 'claude-test',
      canonicalRequestHash: 'request-hash',
    })
    expect(prepared.created).toBe(true)
    expect(coordinator.storeFor(root).getOperation('run-1')?.phase).toBe('model_effect_pending')

    const duplicate = await boundary.prepare({
      sessionId: 'session-1',
      turnId: 'turn-1',
      runOperationId: 'run-1',
      providerRequestId: '1',
      provider: 'anthropic',
      model: 'claude-test',
      canonicalRequestHash: 'request-hash',
    })
    expect(duplicate).toEqual(expect.objectContaining({ created: false, status: 'effect_pending' }))

    await boundary.commitOutcome({
      sessionId: 'session-1',
      turnId: 'turn-1',
      runOperationId: 'run-1',
      operationId: prepared.operationId,
      providerRequestId: '1',
      provider: 'anthropic',
      model: 'claude-test',
      canonicalRequestHash: 'request-hash',
      stopReason: 'stop',
      responseId: 'response-1',
      content: 'answer',
      text: 'answer',
      usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.1, payload: { usage: { input: 10, output: 2 } } },
    })
    expect(coordinator.storeFor(root).getOperation('run-1')?.phase).toBe('checkpoint')
    expect(coordinator.storeFor(root).listUsage({ operationId: 'run-1' })).toHaveLength(1)
    expect(coordinator.getCanonicalSessionProjection(root, 'session-1')?.items.at(-1))
      .toEqual(expect.objectContaining({ kind: 'assistant', content: 'answer' }))
    expect(coordinator.getCanonicalModelContext(root, 'session-1', 'run-1')).toMatchObject({ items: [] })
    coordinator.closeAll()
  })

  test('parks a provider request left between model T1 and T2', async () => {
    const { root, coordinator } = setup()
    const prepared = await coordinator.modelBoundaryFor(root).prepare({
      sessionId: 'session-1', turnId: 'turn-1', runOperationId: 'run-1',
      providerRequestId: '1', provider: 'openai', model: 'gpt-test', canonicalRequestHash: 'hash',
    })
    const report = coordinator.recoverWorkspace(root, 50)
    expect(report.items[0]).toEqual(expect.objectContaining({
      action: 'parked_unknown_effect',
      unsettledModelOperationId: prepared.operationId,
    }))
    expect(coordinator.storeFor(root).getOperation('run-1')?.phase).toBe('recovery_parked')
    expect(coordinator.storeFor(root).listUsage()).toHaveLength(0)
    coordinator.closeAll()
  })

  test('durably resolves an unknown provider attempt without retrying it', async () => {
    const { root, coordinator } = setup()
    const prepared = await coordinator.modelBoundaryFor(root).prepare({
      sessionId: 'session-1', turnId: 'turn-1', runOperationId: 'run-1',
      providerRequestId: '1', provider: 'openai', model: 'gpt-test', canonicalRequestHash: 'hash',
    })
    coordinator.recoverWorkspace(root, 50)

    const result = coordinator.reconcileModel(root, {
      sessionId: 'session-1', modelOperationId: prepared.operationId,
      decision: 'billed_response_unavailable',
      reason: 'Provider billing log confirms the request but no response can be retrieved',
      actor: { type: 'administrator', id: 'admin-1' },
      evidence: [{ source: 'provider_receipt', summary: 'Billing attempt recorded', observedAt: 51 }],
    }, 52)

    expect(result.operationState.phase).toBe('checkpoint')
    expect(coordinator.storeFor(root).listUsage()).toHaveLength(0)
    expect(coordinator.storeFor(root).getEvent(`${prepared.operationId}:reconciliation`)?.payload)
      .toMatchObject({ verdict: 'billed_response_unavailable', actor: { id: 'admin-1' } })
    coordinator.closeAll()
  })

  test('atomically commits a verified reconciliation and resumes the program counter', async () => {
    const { root, coordinator } = setup()
    const prepared = await coordinator.prepareTool(root, {
      sessionId: 'session-1',
      turnId: 'turn-1',
      runOperationId: 'run-1',
      providerToolCallId: 'call-1',
      toolName: 'send_email',
      args: { to: 'a@example.com' },
    })
    coordinator.recoverWorkspace(root, 10)

    const result = coordinator.reconcileTool(root, {
      sessionId: 'session-1',
      toolOperationId: prepared.operationId,
      decision: 'completed',
      reason: 'Provider receipt confirms delivery',
      actor: { type: 'administrator', id: 'admin-1' },
      evidence: [{
        source: 'provider_receipt',
        summary: 'Message remote-1 was accepted',
        observedAt: 11,
        externalReference: 'remote-1',
      }],
      result: { messageId: 'remote-1' },
    }, 12)

    expect(result.snapshot.verdict.kind).toBe('completed')
    expect(result.snapshot.runOperation.phase).toBe('checkpoint')
    expect(result.snapshot.evidence.outcome?.externalReference).toBe('remote-1')
    const events = coordinator.storeFor(root).listEvents({ sessionId: 'session-1' })
    expect(events.slice(-2).map(event => event.type)).toEqual([
      'tool_recovery_decided',
      'tool_outcome_committed',
    ])
    expect(events.at(-2)?.payload).toMatchObject({
      actor: { type: 'administrator', id: 'admin-1' },
      verdict: 'completed',
    })
    expect(() => coordinator.reconcileTool(root, {
      sessionId: 'session-1',
      toolOperationId: prepared.operationId,
      decision: 'manual_abandon',
      reason: 'duplicate',
      actor: { type: 'administrator', id: 'admin-1' },
      evidence: [],
    })).toThrow('does not require reconciliation')
    coordinator.closeAll()
  })

  test('queries a registered adapter using the durable idempotency identity', async () => {
    const { root, coordinator } = setup()
    const prepared = await coordinator.prepareTool(root, {
      sessionId: 'session-1',
      runOperationId: 'run-1',
      providerToolCallId: 'call-1',
      toolName: 'create_ticket',
      args: { title: 'broken' },
      recoveryMode: 'reconcilable',
    })
    coordinator.recoverWorkspace(root, 10)
    const queries: Array<{ operationId: string; idempotencyKey: string; toolName?: string; args?: Record<string, unknown> }> = []
    coordinator.registerReconciliationAdapter('create_ticket', {
      async queryExternal(input) {
        queries.push(input)
        return {
          decision: 'definitely_not_executed',
          reason: 'No ticket exists for this idempotency key',
          evidence: [{
            source: 'external_query',
            summary: 'Provider lookup returned no matching ticket',
            observedAt: 11,
          }],
        }
      },
    })

    const result = await coordinator.queryAndReconcileTool(root, {
      sessionId: 'session-1',
      toolOperationId: prepared.operationId,
      actor: { type: 'system', id: 'ticket-adapter' },
    })
    expect(queries).toEqual([{
      operationId: prepared.operationId,
      idempotencyKey: prepared.operationId,
      toolName: 'create_ticket',
      args: { title: 'broken' },
    }])
    expect(result.snapshot.evidence.outcome?.isError).toBe(true)
    expect(result.snapshot.runOperation.phase).toBe('checkpoint')
    coordinator.closeAll()
  })

  test('makes TaskRunner facts authoritative and replayable after terminal cleanup', () => {
    const { root, coordinator } = setup()
    const base = {
      workspaceRootPath: root,
      sessionId: 'orchestrator-1',
      taskSlug: 'build',
      runId: 'run-1',
    }
    coordinator.commitTaskRunFact({
      ...base,
      ordinal: 0,
      entry: { t: '2026-08-26T00:00:00.000Z', kind: 'run-started', taskId: 'build', runId: 'run-1', orchestratorSessionId: 'orchestrator-1' },
    })
    coordinator.commitTaskRunFact({
      ...base,
      ordinal: 1,
      entry: { t: '2026-08-26T00:00:01.000Z', kind: 'node-finished', nodeId: 'write', sessionId: 'child-1', state: 'done', output: { text: 'done' } },
    })
    coordinator.commitTaskRunFact({
      ...base,
      ordinal: 2,
      entry: { t: '2026-08-26T00:00:02.000Z', kind: 'run-completed' },
    })

    expect(coordinator.storeFor(root).getOperation('taskrun:build:run-1')).toBeUndefined()
    expect(coordinator.listTaskRunFacts(root, 'build', 'run-1')).toEqual([
      expect.objectContaining({ kind: 'run-started' }),
      expect.objectContaining({ kind: 'node-finished', output: { text: 'done' } }),
      expect.objectContaining({ kind: 'run-completed' }),
    ])
    coordinator.closeAll()
  })

  test('restores a verified backup atomically while retaining the previous live database', () => {
    const { root, coordinator } = setup()
    coordinator.acceptRun({
      workspaceRootPath: root, sessionId: 'session-1', turnId: 'turn-1', operationId: 'run-1',
      userMessageId: 'm1', userMessage: 'before backup',
    })
    const backupPath = join(root, 'backups', 'restore-source.db')
    coordinator.backupDatabase(root, backupPath)
    coordinator.commitAssistantMessage({
      workspaceRootPath: root, operationId: 'run-1', sessionId: 'session-1',
      messageId: 'a1', content: 'after backup',
    })

    const restored = coordinator.restoreDatabase(root, backupPath, 1234)

    expect(restored.integrity.ok).toBe(true)
    expect(existsSync(restored.previousDatabasePath)).toBe(true)
    expect(coordinator.storeFor(root).listEvents().map(item => item.eventId)).not.toContain('run-1:assistant:a1')
    expect(coordinator.storeFor(root).listEvents().map(item => item.eventId)).toContain('run-1:user')
    coordinator.closeAll()
  })

  test('imports branch history without fabricating tool dispatch evidence', () => {
    const { root, coordinator } = setup()
    coordinator.importLegacyContext(root, 'branch-1', [
      { id: 'u1', role: 'user', content: 'question', timestamp: 1 },
      {
        id: 't1', role: 'assistant', content: '', timestamp: 2,
        toolUseId: 'call-legacy', toolName: 'Read', toolInput: { path: 'a', apiKey: 'secret' },
        toolStatus: 'completed', toolResult: 'answer',
      },
      { id: 'a1', role: 'assistant', content: 'done', timestamp: 3 },
    ])

    const context = coordinator.getCanonicalModelContext(root, 'branch-1')
    expect(context.items.map(item => item.kind)).toEqual(['user', 'tool_call', 'tool_outcome', 'assistant'])
    expect(context.items.find(item => item.kind === 'tool_call')).toMatchObject({ args: { path: 'a', apiKey: '[REDACTED]' } })
    expect(coordinator.storeFor(root).listUnsettledToolOperations()).toHaveLength(0)
    expect(coordinator.storeFor(root).listOperations().some(item => item.sessionId === 'branch-1')).toBe(false)
    coordinator.closeAll()
  })
})
