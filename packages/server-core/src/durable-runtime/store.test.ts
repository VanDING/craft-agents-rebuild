import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DURABLE_TOOL_BOUNDARY_PROTOCOL,
  type DurableOperationState,
  type RuntimeEvent,
  type ToolDispatchIntent,
  type ToolOutcome,
} from '@craft-agent/shared/durable-runtime'
import { classifyRuntimeDatabaseFailure, DurableRuntimeStore } from './store.js'
import { openSqliteDatabase } from './sqlite-driver.js'

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

  test('migrates a schema-v1 runtime database through the latest schema without losing canonical facts', () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-runtime-store-v1-'))
    roots.push(root)
    const original = new DurableRuntimeStore(root)
    original.appendEvents([event('pre-migration', 'user_message_committed', { content: 'kept' })])
    const databasePath = original.databasePath
    original.close()

    const legacy = openSqliteDatabase(databasePath)
    legacy.exec('DROP TABLE projection_snapshots; PRAGMA user_version = 1;')
    legacy.close()

    const migrated = new DurableRuntimeStore(root)
    expect(migrated.listEvents().map(item => item.eventId)).toEqual(['pre-migration'])
    migrated.commitMaterializedProjection({
      projection: 'ui/sessions',
      schemaVersion: 1,
      expectedCursor: 0,
      nextCursor: 1,
      snapshot: { sessions: 1 },
    })
    expect(migrated.getMaterializedProjection('ui/sessions')?.snapshot).toEqual({ sessions: 1 })
    migrated.close()
  })

  test('checks integrity and creates a standalone consistent backup', () => {
    const store = createStore()
    store.appendEvents([event('backed-up', 'user_message_committed', { content: 'kept' })])
    expect(store.checkIntegrity()).toMatchObject({ ok: true, messages: ['ok'] })

    const backupPath = join(dirname(store.databasePath), 'backups', 'runtime-backup.db')
    expect(store.backupTo(backupPath)).toBe(backupPath)
    expect(() => store.backupTo(backupPath)).toThrow('backup already exists')

    const restored = new DurableRuntimeStore(dirname(backupPath), { databasePath: backupPath })
    expect(restored.checkIntegrity().ok).toBe(true)
    expect(restored.listEvents().map(item => item.eventId)).toEqual(['backed-up'])
    restored.close()
    store.close()
  })

  test('retires only stale rebuildable projections and vacuums without deleting facts', () => {
    const store = createStore()
    store.appendEvents([event('immutable', 'user_message_committed', { content: 'kept' })])
    store.commitMaterializedProjection({
      projection: 'stale/view',
      schemaVersion: 1,
      expectedCursor: 0,
      nextCursor: 1,
      snapshot: { disposable: true },
      updatedAt: 1,
    })

    const result = store.maintain({ projectionRetentionMs: 0, vacuum: true })

    expect(result).toMatchObject({ removedProjections: ['stale/view'], vacuumed: true })
    expect(store.getMaterializedProjection('stale/view')).toBeUndefined()
    expect(store.listEvents().map(item => item.eventId)).toEqual(['immutable'])
    store.close()
  })

  test('persists parity observations as rollout/dashboard evidence', () => {
    const store = createStore()
    store.recordProjectionParity({
      projection: 'canonical/sessions', sessionId: 'session-1', cursor: 7,
      canonicalFacts: 4, legacyMessages: 4, issueCount: 0,
      issueCounts: { missing_legacy_message: 0 }, parityRatio: 1, observedAt: 100,
    })
    store.recordProjectionParity({
      projection: 'canonical/sessions', sessionId: 'session-1', cursor: 7,
      canonicalFacts: 4, legacyMessages: 5, issueCount: 1,
      issueCounts: { legacy_fact_missing: 1 }, parityRatio: 0.75, observedAt: 101,
    })

    expect(store.listProjectionParity('session-1')).toEqual([expect.objectContaining({
      cursor: 7,
      issueCount: 1,
      issueCounts: { legacy_fact_missing: 1 },
      parityRatio: 0.75,
      observedAt: 101,
    })])
    store.close()
  })

  test('classifies actionable SQLite lifecycle failures', () => {
    expect(classifyRuntimeDatabaseFailure(new Error('database is locked'))).toBe('busy')
    expect(classifyRuntimeDatabaseFailure(new Error('attempt to write a readonly database'))).toBe('readonly')
    expect(classifyRuntimeDatabaseFailure(Object.assign(new Error('write failed'), { code: 'ENOSPC' }))).toBe('full')
    expect(classifyRuntimeDatabaseFailure(new Error('database disk image is malformed'))).toBe('corrupt')
    expect(classifyRuntimeDatabaseFailure(new Error('disk I/O error'))).toBe('io')
  })

  test('fails closed with a structured busy error under a real competing writer lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-runtime-busy-'))
    roots.push(root)
    const store = new DurableRuntimeStore(root, { busyTimeoutMs: 10 })
    const competing = openSqliteDatabase(store.databasePath)
    competing.exec('PRAGMA busy_timeout = 1; BEGIN IMMEDIATE;')
    try {
      expect(() => store.appendEvents([
        event('blocked-write', 'user_message_committed', { content: 'must not partially commit' }),
      ])).toThrow(expect.objectContaining({
        name: 'RuntimeDatabaseError',
        kind: 'busy',
        operation: 'append events',
      }))
      expect(store.listEvents()).toHaveLength(0)
    } finally {
      competing.exec('ROLLBACK')
      competing.close()
      store.close()
    }
  })

  test('fails closed with a structured readonly error from real SQLite query-only mode', () => {
    const store = createStore()
    ;(store as unknown as { db: { exec(sql: string): void } }).db.exec('PRAGMA query_only = ON')
    expect(() => store.appendEvents([
      event('readonly-write', 'user_message_committed', { content: 'blocked' }),
    ])).toThrow(expect.objectContaining({
      name: 'RuntimeDatabaseError', kind: 'readonly', operation: 'append events',
    }))
    expect(store.listEvents()).toHaveLength(0)
    store.close()
  })

  test('fails closed with a structured full error at SQLite max_page_count', () => {
    const store = createStore()
    const db = (store as unknown as { db: { exec(sql: string): void; prepare(sql: string): { get(): unknown } } }).db
    const pageCount = Number(Object.values(db.prepare('PRAGMA page_count').get() as Record<string, unknown>)[0])
    db.exec(`PRAGMA max_page_count = ${pageCount}`)
    expect(() => store.appendEvents([
      event('full-write', 'user_message_committed', { content: 'x'.repeat(128 * 1024) }),
    ])).toThrow(expect.objectContaining({
      name: 'RuntimeDatabaseError', kind: 'full', operation: 'append events',
    }))
    expect(store.listEvents()).toHaveLength(0)
    store.close()
  })

  test('fails closed with a classified error for a corrupt runtime database', () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-runtime-corrupt-'))
    roots.push(root)
    const runtimeDir = join(root, 'runtime')
    mkdirSync(runtimeDir)
    writeFileSync(join(runtimeDir, 'runtime.db'), 'not a sqlite database')

    expect(() => new DurableRuntimeStore(root)).toThrow(expect.objectContaining({
      name: 'RuntimeDatabaseError',
      kind: 'corrupt',
      operation: 'open/migrate',
    }))
  })
})
