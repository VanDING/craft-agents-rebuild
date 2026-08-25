import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DurableOperationState, RuntimeEvent } from '@craft-agent/shared/durable-runtime'
import { DurableToolDispatcher, ToolRecoveryRequiredError, durableToolOperationId } from './dispatcher.js'
import { DurableRuntimeStore } from './store.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'craft-dispatcher-'))
  roots.push(root)
  const store = new DurableRuntimeStore(root)
  const state: DurableOperationState = {
    operationId: 'run-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    kind: 'agent_turn',
    phase: 'accepted',
    stateVersion: 1,
    data: {},
    createdAt: 1,
    updatedAt: 1,
  }
  const accepted: RuntimeEvent = {
    eventId: 'run-1:accepted',
    sessionId: 'session-1',
    turnId: 'turn-1',
    operationId: 'run-1',
    type: 'operation_accepted',
    schemaVersion: 1,
    modelVisible: false,
    partial: false,
    payload: {},
    createdAt: 1,
  }
  store.commitOperationAccepted([accepted], state)
  return { store, state }
}

describe('DurableToolDispatcher', () => {
  test('commits T1 before invoking the effect and T2 after it', async () => {
    const { store, state } = setup()
    const observed: string[] = []
    const dispatcher = new DurableToolDispatcher(store, { now: () => 10 })
    const result = await dispatcher.execute({
      sessionId: 'session-1',
      turnId: 'turn-1',
      runState: state,
      providerToolCallId: 'call-1',
      toolName: 'create_ticket',
      args: { title: 'broken' },
      recoveryMode: 'idempotent_keyed',
      execute: async ({ operationId }) => {
        observed.push(store.resolveToolRecovery(operationId)?.kind ?? 'missing')
        return { result: { ticket: 'T-1' }, externalReference: 'T-1' }
      },
    })
    expect(observed).toEqual(['reconcile_required'])
    expect(result.outcome.result).toEqual({ ticket: 'T-1' })
    expect(store.resolveToolRecovery(result.outcome.operationId)?.kind).toBe('completed')
    expect(store.getOperation('run-1')?.phase).toBe('checkpoint')
    store.close()
  })

  test('does not invoke the effect when T1 cannot commit', async () => {
    const { store, state } = setup()
    let calls = 0
    const dispatcher = new DurableToolDispatcher(store)
    await expect(dispatcher.execute({
      sessionId: 'session-1',
      runState: { ...state, stateVersion: 9 },
      providerToolCallId: 'call-1',
      toolName: 'send_email',
      args: {},
      execute: async () => {
        calls += 1
        return { result: 'sent' }
      },
    })).rejects.toThrow('expected state version 9')
    expect(calls).toBe(0)
    store.close()
  })

  test('parks a crash tail instead of executing the effect twice', async () => {
    const { store, state } = setup()
    let calls = 0
    const crashing = new DurableToolDispatcher(store, {
      afterEffect: () => { throw new Error('simulated crash') },
    })
    const input = {
      sessionId: 'session-1',
      runState: state,
      providerToolCallId: 'call-1',
      toolName: 'send_email',
      args: { to: 'a@example.com' },
      recoveryMode: 'never_auto_retry' as const,
      execute: async () => {
        calls += 1
        return { result: 'sent' }
      },
    }
    await expect(crashing.execute(input)).rejects.toThrow('simulated crash')
    expect(calls).toBe(1)

    const restarted = new DurableToolDispatcher(store)
    await expect(restarted.execute(input)).rejects.toBeInstanceOf(ToolRecoveryRequiredError)
    expect(calls).toBe(1)
    expect(store.resolveToolRecovery(durableToolOperationId('run-1', 'call-1'))?.kind)
      .toBe('reconcile_required')
    store.close()
  })
})
