import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  resolveToolRecovery,
  type DurableOperationState,
  type RuntimeEvent,
  type ToolDispatchIntent,
  type ToolOutcome,
  type ToolRecoveryEvidence,
  type ToolRecoveryVerdict,
} from '@craft-agent/shared/durable-runtime'
import { canonicalJson } from './canonical-json.js'
import { openSqliteDatabase, type SqliteDatabase } from './sqlite-driver.js'

const SCHEMA_VERSION = 1

interface RuntimeEventRow {
  seq: number
  event_id: string
  session_id: string
  turn_id: string | null
  operation_id: string
  event_type: RuntimeEvent['type']
  schema_version: 1
  model_visible: 0 | 1
  partial: 0 | 1
  payload_json: string
  created_at: number
}

interface OperationRow {
  operation_id: string
  session_id: string
  turn_id: string | null
  kind: DurableOperationState['kind']
  phase: DurableOperationState['phase']
  state_version: number
  state_json: string
  created_at: number
  updated_at: number
}

interface ToolOperationRow {
  run_operation_id: string
  operation_id: string
  provider_tool_call_id: string
  tool_name: string
  canonical_args_hash: string
  recovery_mode: ToolDispatchIntent['recoveryMode']
  idempotency_key: string
  status: 'effect_pending' | 'outcome_committed' | 'recovery_parked' | 'reconciled'
  outcome_json: string | null
  external_reference: string | null
  prepared_at: number
  settled_at: number | null
}

export interface RuntimeUsageRow {
  usageId: string
  operationId: string
  sessionId: string
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  payload?: unknown
  createdAt: number
}

export interface CommitToolPreparedInput {
  events: RuntimeEvent[]
  intent: ToolDispatchIntent
  operationState: DurableOperationState
  expectedStateVersion?: number
  preparedAt: number
}

export interface CommitToolOutcomeInput {
  events: RuntimeEvent[]
  outcome: ToolOutcome
  operationState: DurableOperationState
  expectedStateVersion: number
  usage?: RuntimeUsageRow[]
  settledAt: number
}

export interface CommitResult {
  created: boolean
  eventSeqs: number[]
}

export interface RuntimeStoreOptions {
  databasePath?: string
}

export function durableRuntimeDatabasePath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'runtime', 'runtime.db')
}

export class DurableRuntimeStore {
  readonly databasePath: string
  private readonly db: SqliteDatabase

  constructor(workspaceRootPath: string, options: RuntimeStoreOptions = {}) {
    this.databasePath = options.databasePath ?? durableRuntimeDatabasePath(workspaceRootPath)
    if (this.databasePath !== ':memory:') {
      mkdirSync(dirname(this.databasePath), { recursive: true, mode: 0o700 })
    }
    this.db = openSqliteDatabase(this.databasePath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = FULL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  appendEvents(events: RuntimeEvent[]): number[] {
    return this.db.transaction((items: RuntimeEvent[]) => items.map(event => this.appendEvent(event)))(events)
  }

  commitOperationAccepted(events: RuntimeEvent[], state: DurableOperationState): CommitResult {
    return this.db.transaction(() => {
      const eventSeqs = events.map(event => this.appendEvent(event))
      this.writeOperationState(state)
      return { created: true, eventSeqs }
    })()
  }

  commitToolPrepared(input: CommitToolPreparedInput): CommitResult {
    return this.db.transaction(() => {
      const existing = this.getToolOperationRow(input.intent.operationId)
      if (existing) {
        this.assertToolIdentity(existing, input.intent)
        const eventSeqs = input.events.map(event => this.getEventSeq(event.eventId) ?? this.appendEvent(event))
        return { created: false, eventSeqs }
      }

      if (input.operationState.operationId !== input.intent.runOperationId) {
        throw new Error('Tool intent parent does not match the durable operation state')
      }
      this.assertExpectedStateVersion(input.intent.runOperationId, input.expectedStateVersion)
      const eventSeqs = input.events.map(event => this.appendEvent(event))
      this.db.prepare(`
        INSERT INTO tool_operations (
          run_operation_id, operation_id, provider_tool_call_id, tool_name, canonical_args_hash,
          recovery_mode, idempotency_key, status, prepared_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'effect_pending', ?)
      `).run(
        input.intent.runOperationId,
        input.intent.operationId,
        input.intent.providerToolCallId,
        input.intent.toolName,
        input.intent.canonicalArgsHash,
        input.intent.recoveryMode,
        input.intent.idempotencyKey,
        input.preparedAt,
      )
      this.writeOperationState(input.operationState)
      return { created: true, eventSeqs }
    })()
  }

  commitToolOutcome(input: CommitToolOutcomeInput): CommitResult {
    return this.db.transaction(() => {
      const existing = this.getToolOperationRow(input.outcome.operationId)
      if (!existing) throw new Error(`Tool operation ${input.outcome.operationId} has no durable T1 intent`)
      this.assertToolIdentity(existing, input.outcome)

      if (existing.status === 'outcome_committed') {
        const stored = existing.outcome_json ? JSON.parse(existing.outcome_json) as ToolOutcome : undefined
        if (canonicalJson(stored) !== canonicalJson(input.outcome)) {
          throw new Error(`Tool operation ${input.outcome.operationId} already has a different outcome`)
        }
        const eventSeqs = input.events.map(event => this.getEventSeq(event.eventId) ?? this.appendEvent(event))
        return { created: false, eventSeqs }
      }

      if (input.operationState.operationId !== input.outcome.runOperationId) {
        throw new Error('Tool outcome parent does not match the durable operation state')
      }
      this.assertExpectedStateVersion(input.outcome.runOperationId, input.expectedStateVersion)
      const eventSeqs = input.events.map(event => this.appendEvent(event))
      for (const usage of input.usage ?? []) this.appendUsage(usage)
      this.db.prepare(`
        UPDATE tool_operations
        SET status = 'outcome_committed', outcome_json = ?, external_reference = ?, settled_at = ?
        WHERE operation_id = ?
      `).run(
        canonicalJson(input.outcome),
        input.outcome.externalReference ?? null,
        input.settledAt,
        input.outcome.operationId,
      )
      this.writeOperationState(input.operationState)
      return { created: true, eventSeqs }
    })()
  }

  getOperation(operationId: string): DurableOperationState | undefined {
    const row = this.db.prepare('SELECT * FROM operations WHERE operation_id = ?')
      .get(operationId) as OperationRow | undefined
    return row ? JSON.parse(row.state_json) as DurableOperationState : undefined
  }

  listOperations(): DurableOperationState[] {
    const rows = this.db.prepare('SELECT * FROM operations ORDER BY updated_at ASC').all() as OperationRow[]
    return rows.map(row => JSON.parse(row.state_json) as DurableOperationState)
  }

  deleteOperation(operationId: string, terminalEvent: RuntimeEvent): number {
    return this.db.transaction(() => {
      const seq = this.appendEvent(terminalEvent)
      this.db.prepare('DELETE FROM operations WHERE operation_id = ?').run(operationId)
      return seq
    })()
  }

  listEvents(options: { sessionId?: string; afterSeq?: number; limit?: number } = {}): RuntimeEvent[] {
    const where: string[] = []
    const params: Array<string | number> = []
    if (options.sessionId) {
      where.push('session_id = ?')
      params.push(options.sessionId)
    }
    if (options.afterSeq !== undefined) {
      where.push('seq > ?')
      params.push(options.afterSeq)
    }
    const limit = Math.max(1, Math.min(options.limit ?? 1000, 10_000))
    params.push(limit)
    const rows = this.db.prepare(`
      SELECT * FROM runtime_events
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY seq ASC
      LIMIT ?
    `).all(...params) as RuntimeEventRow[]
    return rows.map(row => this.decodeEvent(row))
  }

  getToolRecoveryEvidence(operationId: string): ToolRecoveryEvidence | undefined {
    const row = this.getToolOperationRow(operationId)
    if (!row) return undefined
    const dispatch: ToolDispatchIntent = {
      protocol: 't1_after_preflight_v1',
      runOperationId: row.run_operation_id,
      operationId: row.operation_id,
      providerToolCallId: row.provider_tool_call_id,
      toolName: row.tool_name,
      canonicalArgsHash: row.canonical_args_hash,
      recoveryMode: row.recovery_mode,
      idempotencyKey: row.idempotency_key,
    }
    return {
      call: {
        runOperationId: row.run_operation_id,
        operationId: row.operation_id,
        providerToolCallId: row.provider_tool_call_id,
        toolName: row.tool_name,
        canonicalArgsHash: row.canonical_args_hash,
      },
      dispatch,
      outcome: row.outcome_json ? JSON.parse(row.outcome_json) as ToolOutcome : undefined,
      boundaryProtocol: dispatch.protocol,
    }
  }

  resolveToolRecovery(operationId: string): ToolRecoveryVerdict | undefined {
    const evidence = this.getToolRecoveryEvidence(operationId)
    return evidence ? resolveToolRecovery(evidence) : undefined
  }

  listUnsettledToolOperations(runOperationId?: string): ToolRecoveryEvidence[] {
    const rows = this.db.prepare(`
      SELECT * FROM tool_operations
      WHERE status IN ('effect_pending', 'recovery_parked')
        ${runOperationId ? 'AND run_operation_id = ?' : ''}
      ORDER BY prepared_at ASC
    `).all(...(runOperationId ? [runOperationId] : [])) as ToolOperationRow[]
    return rows.map(row => this.getToolRecoveryEvidence(row.operation_id)!)
  }

  setProjectionCursor(projection: string, seq: number, updatedAt = Date.now()): void {
    this.db.prepare(`
      INSERT INTO projection_cursors (projection, last_seq, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(projection) DO UPDATE SET
        last_seq = CASE WHEN excluded.last_seq > last_seq THEN excluded.last_seq ELSE last_seq END,
        updated_at = CASE WHEN excluded.last_seq > last_seq THEN excluded.updated_at ELSE updated_at END
    `).run(projection, seq, updatedAt)
  }

  getProjectionCursor(projection: string): number {
    const row = this.db.prepare('SELECT last_seq FROM projection_cursors WHERE projection = ?')
      .get(projection) as { last_seq: number } | undefined
    return row?.last_seq ?? 0
  }

  private migrate(): void {
    const currentRow = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    const current = currentRow.user_version
    if (current > SCHEMA_VERSION) {
      throw new Error(`Runtime database schema ${current} is newer than supported ${SCHEMA_VERSION}`)
    }
    if (current === SCHEMA_VERSION) return

    this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS runtime_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        turn_id TEXT,
        operation_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        model_visible INTEGER NOT NULL CHECK(model_visible IN (0, 1)),
        partial INTEGER NOT NULL CHECK(partial IN (0, 1)),
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_runtime_events_session_seq
        ON runtime_events(session_id, seq);
      CREATE INDEX IF NOT EXISTS ix_runtime_events_operation_seq
        ON runtime_events(operation_id, seq);

      CREATE TABLE IF NOT EXISTS operations (
        operation_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn_id TEXT,
        kind TEXT NOT NULL,
        phase TEXT NOT NULL,
        state_version INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_operations_session ON operations(session_id, updated_at);

      CREATE TABLE IF NOT EXISTS tool_operations (
        operation_id TEXT PRIMARY KEY,
        run_operation_id TEXT NOT NULL,
        provider_tool_call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        canonical_args_hash TEXT NOT NULL,
        recovery_mode TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL,
        outcome_json TEXT,
        external_reference TEXT,
        prepared_at INTEGER NOT NULL,
        settled_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ux_tool_operations_run_provider_call
        ON tool_operations(run_operation_id, provider_tool_call_id);

      CREATE TABLE IF NOT EXISTS usage_ledger (
        usage_id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cost_usd REAL,
        payload_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_usage_session_created
        ON usage_ledger(session_id, created_at);

      CREATE TABLE IF NOT EXISTS projection_cursors (
        projection TEXT PRIMARY KEY,
        last_seq INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      PRAGMA user_version = 1;
      COMMIT;
    `)
  }

  private appendEvent(event: RuntimeEvent): number {
    const payloadJson = canonicalJson(event.payload)
    const existing = this.db.prepare('SELECT * FROM runtime_events WHERE event_id = ?')
      .get(event.eventId) as RuntimeEventRow | undefined
    if (existing) {
      const expected = this.decodeEvent(existing)
      if (canonicalJson({ ...expected, seq: undefined }) !== canonicalJson({ ...event, seq: undefined })) {
        throw new Error(`Runtime event ${event.eventId} already exists with different content`)
      }
      return existing.seq
    }
    const result = this.db.prepare(`
      INSERT INTO runtime_events (
        event_id, session_id, turn_id, operation_id, event_type, schema_version,
        model_visible, partial, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      event.sessionId,
      event.turnId ?? null,
      event.operationId,
      event.type,
      event.schemaVersion,
      event.modelVisible ? 1 : 0,
      event.partial ? 1 : 0,
      payloadJson,
      event.createdAt,
    )
    return Number(result.lastInsertRowid)
  }

  private writeOperationState(state: DurableOperationState): void {
    const encoded = canonicalJson(state)
    const existing = this.db.prepare('SELECT * FROM operations WHERE operation_id = ?')
      .get(state.operationId) as OperationRow | undefined
    if (existing) {
      if (state.stateVersion < existing.state_version) {
        throw new Error(`Operation ${state.operationId} state version regressed`)
      }
      if (state.stateVersion === existing.state_version) {
        if (encoded !== existing.state_json) {
          throw new Error(`Operation ${state.operationId} reused state version ${state.stateVersion}`)
        }
        return
      }
    }
    this.db.prepare(`
      INSERT INTO operations (
        operation_id, session_id, turn_id, kind, phase, state_version,
        state_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(operation_id) DO UPDATE SET
        session_id = excluded.session_id,
        turn_id = excluded.turn_id,
        kind = excluded.kind,
        phase = excluded.phase,
        state_version = excluded.state_version,
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `).run(
      state.operationId,
      state.sessionId,
      state.turnId ?? null,
      state.kind,
      state.phase,
      state.stateVersion,
      encoded,
      state.createdAt,
      state.updatedAt,
    )
  }

  private assertExpectedStateVersion(operationId: string, expected: number | undefined): void {
    if (expected === undefined) return
    const existing = this.db.prepare('SELECT state_version FROM operations WHERE operation_id = ?')
      .get(operationId) as { state_version: number } | undefined
    const actual = existing?.state_version ?? 0
    if (actual !== expected) {
      throw new Error(`Operation ${operationId} expected state version ${expected}, found ${actual}`)
    }
  }

  private getToolOperationRow(operationId: string): ToolOperationRow | undefined {
    return this.db.prepare('SELECT * FROM tool_operations WHERE operation_id = ?')
      .get(operationId) as ToolOperationRow | undefined
  }

  private getEventSeq(eventId: string): number | undefined {
    const row = this.db.prepare('SELECT seq FROM runtime_events WHERE event_id = ?')
      .get(eventId) as { seq: number } | undefined
    return row?.seq
  }

  private assertToolIdentity(existing: ToolOperationRow, identity: {
    runOperationId: string
    operationId: string
    providerToolCallId: string
    toolName: string
    canonicalArgsHash: string
  }): void {
    if (existing.run_operation_id !== identity.runOperationId
      || existing.operation_id !== identity.operationId
      || existing.provider_tool_call_id !== identity.providerToolCallId
      || existing.tool_name !== identity.toolName
      || existing.canonical_args_hash !== identity.canonicalArgsHash) {
      throw new Error(`Tool operation ${identity.operationId} identity or arguments changed`)
    }
  }

  private appendUsage(usage: RuntimeUsageRow): void {
    const existing = this.db.prepare('SELECT * FROM usage_ledger WHERE usage_id = ?')
      .get(usage.usageId) as Record<string, unknown> | undefined
    if (existing) return
    this.db.prepare(`
      INSERT INTO usage_ledger (
        usage_id, operation_id, session_id, provider, model, input_tokens,
        output_tokens, cost_usd, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      usage.usageId,
      usage.operationId,
      usage.sessionId,
      usage.provider ?? null,
      usage.model ?? null,
      usage.inputTokens ?? null,
      usage.outputTokens ?? null,
      usage.costUsd ?? null,
      usage.payload === undefined ? null : canonicalJson(usage.payload),
      usage.createdAt,
    )
  }

  private decodeEvent(row: RuntimeEventRow): RuntimeEvent {
    return {
      eventId: row.event_id,
      seq: row.seq,
      sessionId: row.session_id,
      turnId: row.turn_id ?? undefined,
      operationId: row.operation_id,
      type: row.event_type,
      schemaVersion: row.schema_version,
      modelVisible: row.model_visible === 1,
      partial: row.partial === 1,
      payload: JSON.parse(row.payload_json),
      createdAt: row.created_at,
    }
  }
}
