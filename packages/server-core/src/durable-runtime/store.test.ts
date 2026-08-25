import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DURABLE_TOOL_BOUNDARY_PROTOCOL,
  type DurableOperationState,
  type RuntimeEvent,
  type ToolDispatchIntent,
  type ToolOutcome,
} from '@craft-agent/shared/durable-runtime'
import { DurableRuntimeStore } from './store.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createStore(): DurableRuntimeStore {
  const root = mkdtempSync(join(tmpdir(), 'craft-runtime-store-'))
  roots.push(root)
  return new DurableRuntimeStore(root)
}

function event(eventId: string, type: RuntimeEvent['type'], payload: unknown): RuntimeEvent {
  return {
    eventId,
    sessionId: 'session-1',
    turnId: 'turn-1',
    operationId: 'op-1',
    type,
    schemaVersion: 1,
    modelVisible: type !== 'tool_dispatch_committed',
    partial: false,
    payload,
    createdAt: 100,
  }
}

function state(version: number, phase: DurableOperationState['phase']): DurableOperationState {
  return {
    operationId: 'op-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    kind: 'agent_turn',
    phase,
    stateVersion: version,
    data: { step: version },
    createdAt: 100,
    updatedAt: 100 + version,
  }
}

const intent: ToolDispatchIntent = {
  protocol: DURABLE_TOOL_BOUNDARY_PROTOCOL,
  runOperationId: 'op-1',
  operationId: 'tool-op-1',
  providerToolCallId: 'call-1',
  toolName: 'send_email',
  canonicalArgsHash: 'args-1',
  recoveryMode: 'reconcilable',
  idempotencyKey: 'tool-op-1',
}

describe('DurableRuntimeStore', () => {
  test('commits T1 and classifies its uncertain tail for reconciliation', () => {
    const store = createStore()
    store.commitOperationAccepted([event('e-accept', 'operation_accepted', {})], state(1, 'accepted'))
    const result = store.commitToolPrepared({
      events: [event('e-dispatch', 'tool_dispatch_committed', intent)],
      intent,
      operationState: state(2, 'tool_effect_pending'),
      expectedStateVersion: 1,
      preparedAt: 102,
    })
    expect(result.created).toBe(true)
    expect(store.resolveToolRecovery('tool-op-1')?.kind).toBe('reconcile_required')
    expect(store.getOperation('op-1')?.phase).toBe('tool_effect_pending')
    store.close()
  })

  test('commits T2, usage, and next operation state atomically', () => {
    const store = createStore()
    store.commitOperationAccepted([event('e-accept', 'operation_accepted', {})], state(1, 'accepted'))
    store.commitToolPrepared({
      events: [event('e-dispatch', 'tool_dispatch_committed', intent)],
      intent,
      operationState: state(2, 'tool_effect_pending'),
      expectedStateVersion: 1,
      preparedAt: 102,
    })
    const outcome: ToolOutcome = {
      runOperationId: 'op-1',
      operationId: 'tool-op-1',
      providerToolCallId: 'call-1',
      toolName: 'send_email',
      canonicalArgsHash: 'args-1',
      isError: false,
      result: { messageId: 'remote-1' },
      externalReference: 'remote-1',
    }
    store.commitToolOutcome({
      events: [event('e-outcome', 'tool_outcome_committed', outcome)],
      outcome,
      operationState: state(3, 'checkpoint'),
      expectedStateVersion: 2,
      settledAt: 103,
    })
    expect(store.resolveToolRecovery('tool-op-1')).toEqual({ kind: 'completed', outcome })
    expect(store.listEvents().map(item => item.seq)).toEqual([1, 2, 3])
    store.close()
  })

  test('rolls back events when the expected operation version is stale', () => {
    const store = createStore()
    store.commitOperationAccepted([event('e-accept', 'operation_accepted', {})], state(1, 'accepted'))
    expect(() => store.commitToolPrepared({
      events: [event('e-dispatch', 'tool_dispatch_committed', intent)],
      intent,
      operationState: state(2, 'tool_effect_pending'),
      expectedStateVersion: 9,
      preparedAt: 102,
    })).toThrow('expected state version 9')
    expect(store.listEvents()).toHaveLength(1)
    expect(store.getToolRecoveryEvidence('tool-op-1')).toBeUndefined()
    store.close()
  })

  test('rejects operation identity reuse with different arguments', () => {
    const store = createStore()
    store.commitOperationAccepted([event('e-accept', 'operation_accepted', {})], state(1, 'accepted'))
    store.commitToolPrepared({
      events: [event('e-dispatch', 'tool_dispatch_committed', intent)],
      intent,
      operationState: state(2, 'tool_effect_pending'),
      expectedStateVersion: 1,
      preparedAt: 102,
    })
    expect(() => store.commitToolPrepared({
      events: [],
      intent: { ...intent, canonicalArgsHash: 'different' },
      operationState: state(2, 'tool_effect_pending'),
      preparedAt: 102,
    })).toThrow('identity or arguments changed')
    store.close()
  })

  test('maintains monotonic projection cursors', () => {
    const store = createStore()
    store.setProjectionCursor('ui/session-1', 10)
    store.setProjectionCursor('ui/session-1', 4)
    expect(store.getProjectionCursor('ui/session-1')).toBe(10)
    store.close()
  })
})
