import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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

const SCHEMA_VERSION = 4

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
  tool_batch_id: string | null
  tool_batch_ordinal: number | null
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

export interface CommitToolReconciliationInput {
  events: RuntimeEvent[]
  outcome: ToolOutcome
  operationState: DurableOperationState
  expectedStateVersion: number
  settledAt: number
}

export interface CommitFactsAndUsageInput {
  events: RuntimeEvent[]
  usage: RuntimeUsageRow[]
}

export interface CommitOperationTransitionInput extends CommitFactsAndUsageInput {
  operationState: DurableOperationState
  expectedStateVersion: number
}

export interface CommitResult {
  created: boolean
  eventSeqs: number[]
}

export interface RuntimeStoreOptions {
  databasePath?: string
  busyTimeoutMs?: number
}

export type RuntimeDatabaseFailureKind = 'busy' | 'readonly' | 'full' | 'corrupt' | 'io' | 'unknown'

export class RuntimeDatabaseError extends Error {
  constructor(
    readonly kind: RuntimeDatabaseFailureKind,
    readonly operation: string,
    cause: unknown,
  ) {
    super(`Runtime database ${operation} failed (${kind}): ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = 'RuntimeDatabaseError'
  }
}

export interface RuntimeDatabaseIntegrity {
  ok: boolean
  messages: string[]
  checkedAt: number
}

export interface RuntimeDatabaseMaintenanceResult {
  removedProjections: string[]
  vacuumed: boolean
  maintainedAt: number
}

export interface ProjectionParityObservation {
  projection: string
  sessionId: string
  cursor: number
  canonicalFacts: number
  legacyMessages: number
  issueCount: number
  issueCounts: Record<string, number>
  parityRatio: number
  observedAt: number
}

export function classifyRuntimeDatabaseFailure(error: unknown): RuntimeDatabaseFailureKind {
  const candidate = error as { code?: string; errno?: string | number; message?: string }
  const text = `${candidate.code ?? ''} ${candidate.errno ?? ''} ${candidate.message ?? String(error)}`.toLowerCase()
  if (text.includes('busy') || text.includes('locked')) return 'busy'
  if (text.includes('readonly') || text.includes('read-only') || text.includes('permission denied') || text.includes('eperm') || text.includes('eacces')) return 'readonly'
  if (text.includes('database or disk is full') || text.includes('disk full') || text.includes('sqlite_full') || text.includes('enospc')) return 'full'
  if (text.includes('malformed') || text.includes('corrupt') || text.includes('not a database')) return 'corrupt'
  if (text.includes('sqlite_ioerr') || text.includes('i/o error') || text.includes('input/output')) return 'io'
  return 'unknown'
}

export interface MaterializedProjection<TSnapshot = unknown> {
  projection: string
  schemaVersion: number
  cursor: number
  snapshot: TSnapshot
  updatedAt: number
}

export interface CommitProjectionInput<TSnapshot = unknown> {
  projection: string
  schemaVersion: number
  expectedCursor: number
  nextCursor: number
  snapshot: TSnapshot
  updatedAt?: number
}

export function durableRuntimeDatabasePath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'runtime', 'runtime.db')
}

export class DurableRuntimeStore {
  readonly databasePath: string
  private readonly db: SqliteDatabase

  constructor(workspaceRootPath: string, options: RuntimeStoreOptions = {}) {
    this.databasePath = options.databasePath ?? durableRuntimeDatabasePath(workspaceRootPath)
    let database: SqliteDatabase | undefined
    try {
      if (this.databasePath !== ':memory:') {
        mkdirSync(dirname(this.databasePath), { recursive: true, mode: 0o700 })
      }
      database = openSqliteDatabase(this.databasePath)
      this.db = database
      this.db.exec('PRAGMA journal_mode = WAL')
      this.db.exec('PRAGMA synchronous = FULL')
      this.db.exec('PRAGMA foreign_keys = ON')
      const busyTimeoutMs = options.busyTimeoutMs ?? 5000
      if (!Number.isFinite(busyTimeoutMs) || busyTimeoutMs < 0) throw new Error('busyTimeoutMs must be non-negative')
      this.db.exec(`PRAGMA busy_timeout = ${Math.floor(busyTimeoutMs)}`)
      this.migrate()
    } catch (error) {
      try { database?.close() } catch { /* preserve the classified open/migration failure */ }
      throw new RuntimeDatabaseError(classifyRuntimeDatabaseFailure(error), 'open/migrate', error)
    }
  }

  close(): void {
    this.db.close()
  }

  checkIntegrity(): RuntimeDatabaseIntegrity {
    try {
      const rows = this.db.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>
      const messages = rows.map(row => String(row.integrity_check ?? Object.values(row)[0] ?? 'unknown'))
      return { ok: messages.length === 1 && messages[0]!.toLowerCase() === 'ok', messages, checkedAt: Date.now() }
    } catch (error) {
      throw new RuntimeDatabaseError(classifyRuntimeDatabaseFailure(error), 'integrity check', error)
    }
  }

  /** Create a transactionally consistent standalone copy without overwriting an existing backup. */
  backupTo(destinationPath: string): string {
    if (this.databasePath === ':memory:') throw new Error('In-memory runtime databases cannot be backed up to disk')
    const destination = resolve(destinationPath)
    if (destination === resolve(this.databasePath)) throw new Error('Runtime database backup destination must differ from the source')
    if (existsSync(destination)) throw new Error(`Runtime database backup already exists: ${destination}`)
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
    const sqlPath = destination.replaceAll("'", "''")
    try {
      this.db.exec('PRAGMA wal_checkpoint(FULL)')
      this.db.exec(`VACUUM INTO '${sqlPath}'`)
      return destination
    } catch (error) {
      throw new RuntimeDatabaseError(classifyRuntimeDatabaseFailure(error), 'backup', error)
    }
  }

  /**
   * Maintain only rebuildable/physical state. Immutable semantic facts and the
   * usage ledger are deliberately outside retention.
   */
  maintain(options: { projectionRetentionMs?: number; vacuum?: boolean } = {}): RuntimeDatabaseMaintenanceResult {
    const maintainedAt = Date.now()
    try {
      this.db.exec('PRAGMA wal_checkpoint(FULL)')
      const removedProjections: string[] = []
      if (options.projectionRetentionMs !== undefined) {
        if (!Number.isFinite(options.projectionRetentionMs) || options.projectionRetentionMs < 0) {
          throw new Error('projectionRetentionMs must be a non-negative finite number')
        }
        const cutoff = maintainedAt - options.projectionRetentionMs
        const rows = this.db.prepare('SELECT projection FROM projection_snapshots WHERE updated_at < ?')
          .all(cutoff) as Array<{ projection: string }>
        this.db.transaction(() => {
          for (const row of rows) {
            this.db.prepare('DELETE FROM projection_snapshots WHERE projection = ?').run(row.projection)
            this.db.prepare('DELETE FROM projection_cursors WHERE projection = ?').run(row.projection)
            removedProjections.push(row.projection)
          }
        })()
      }
      if (options.vacuum) this.db.exec('VACUUM')
      this.db.exec('PRAGMA optimize')
      return { removedProjections, vacuumed: options.vacuum === true, maintainedAt }
    } catch (error) {
      throw new RuntimeDatabaseError(classifyRuntimeDatabaseFailure(error), 'maintenance', error)
    }
  }

  appendEvents(events: RuntimeEvent[]): number[] {
    return this.databaseOperation('append events', () =>
      this.db.transaction((items: RuntimeEvent[]) => items.map(event => this.appendEvent(event)))(events))
  }

  commitOperationAccepted(events: RuntimeEvent[], state: DurableOperationState): CommitResult {
    return this.databaseOperation('commit operation accepted', () => this.db.transaction(() => {
      const eventSeqs = events.map(event => this.appendEvent(event))
      this.writeOperationState(state)
      return { created: true, eventSeqs }
    })())
  }

  commitToolPrepared(input: CommitToolPreparedInput): CommitResult {
    return this.databaseOperation('commit tool T1', () => this.db.transaction(() => {
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
          run_operation_id, operation_id, provider_tool_call_id, tool_batch_id, tool_batch_ordinal,
          tool_name, canonical_args_hash, recovery_mode, idempotency_key, status, prepared_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'effect_pending', ?)
      `).run(
        input.intent.runOperationId,
        input.intent.operationId,
        input.intent.providerToolCallId,
        input.intent.toolBatchId ?? null,
        input.intent.toolBatchOrdinal ?? null,
        input.intent.toolName,
        input.intent.canonicalArgsHash,
        input.intent.recoveryMode,
        input.intent.idempotencyKey,
        input.preparedAt,
      )
      this.writeOperationState(input.operationState)
      return { created: true, eventSeqs }
    })())
  }

  commitToolOutcome(input: CommitToolOutcomeInput): CommitResult {
    return this.databaseOperation('commit tool T2', () => this.db.transaction(() => {
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
      if (existing.status === 'reconciled') {
        throw new Error(`Tool operation ${input.outcome.operationId} is already reconciled`)
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
      const remaining = this.countUnsettledToolOperations(input.outcome.runOperationId)
      const expectedPhase = remaining > 0 ? 'tool_effect_pending' : 'checkpoint'
      if (input.operationState.phase !== expectedPhase) {
        throw new Error(`Tool outcome aggregate expected phase ${expectedPhase}, found ${input.operationState.phase}`)
      }
      this.writeOperationState(input.operationState)
      return { created: true, eventSeqs }
    })())
  }

  commitFactsAndUsage(input: CommitFactsAndUsageInput): CommitResult {
    return this.databaseOperation('commit facts and usage', () => this.db.transaction(() => {
      const eventSeqs = input.events.map(event => this.appendEvent(event))
      for (const usage of input.usage) this.appendUsage(usage)
      return { created: true, eventSeqs }
    })())
  }

  commitOperationTransition(input: CommitOperationTransitionInput): CommitResult {
    return this.databaseOperation('commit operation transition', () => this.db.transaction(() => {
      this.assertExpectedStateVersion(input.operationState.operationId, input.expectedStateVersion)
      const eventSeqs = input.events.map(event => this.appendEvent(event))
      for (const usage of input.usage) this.appendUsage(usage)
      this.writeOperationState(input.operationState)
      return { created: true, eventSeqs }
    })())
  }

  commitToolReconciliation(input: CommitToolReconciliationInput): CommitResult {
    return this.databaseOperation('commit tool reconciliation', () => this.db.transaction(() => {
      const existing = this.getToolOperationRow(input.outcome.operationId)
      if (!existing) throw new Error(`Tool operation ${input.outcome.operationId} has no durable T1 intent`)
      this.assertToolIdentity(existing, input.outcome)
      if (existing.status === 'outcome_committed') {
        throw new Error(`Tool operation ${input.outcome.operationId} already has a committed outcome`)
      }
      if (existing.status === 'reconciled') {
        throw new Error(`Tool operation ${input.outcome.operationId} is already reconciled`)
      }
      this.assertExpectedStateVersion(input.outcome.runOperationId, input.expectedStateVersion)
      const eventSeqs = input.events.map(event => this.appendEvent(event))
      this.db.prepare(`
        UPDATE tool_operations SET
          status = 'reconciled',
          outcome_json = ?,
          external_reference = ?,
          settled_at = ?
        WHERE operation_id = ?
      `).run(
        canonicalJson(input.outcome),
        input.outcome.externalReference ?? null,
        input.settledAt,
        input.outcome.operationId,
      )
      this.writeOperationState(input.operationState)
      return { created: true, eventSeqs }
    })())
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
    return this.databaseOperation('delete terminal operation', () => this.db.transaction(() => {
      const seq = this.appendEvent(terminalEvent)
      this.db.prepare('DELETE FROM operations WHERE operation_id = ?').run(operationId)
      return seq
    })())
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
      toolBatchId: row.tool_batch_id ?? undefined,
      toolBatchOrdinal: row.tool_batch_ordinal ?? undefined,
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

  listAllEvents(options: { sessionId?: string; afterSeq?: number } = {}): RuntimeEvent[] {
    const events: RuntimeEvent[] = []
    let afterSeq = options.afterSeq ?? 0
    while (true) {
      const batch = this.listEvents({ sessionId: options.sessionId, afterSeq, limit: 10_000 })
      events.push(...batch)
      if (batch.length < 10_000) break
      afterSeq = batch.at(-1)?.seq ?? afterSeq
    }
    return events
  }

  getEvent(eventId: string): RuntimeEvent | undefined {
    const row = this.db.prepare('SELECT * FROM runtime_events WHERE event_id = ?')
      .get(eventId) as RuntimeEventRow | undefined
    return row ? this.decodeEvent(row) : undefined
  }

  getLatestEventSeq(): number {
    const row = this.db.prepare('SELECT MAX(seq) AS seq FROM runtime_events').get() as { seq: number | null }
    return row.seq ?? 0
  }

  listUsage(options: { sessionId?: string; operationId?: string } = {}): RuntimeUsageRow[] {
    const where: string[] = []
    const params: string[] = []
    if (options.sessionId) {
      where.push('session_id = ?')
      params.push(options.sessionId)
    }
    if (options.operationId) {
      where.push('operation_id = ?')
      params.push(options.operationId)
    }
    const rows = this.db.prepare(`
      SELECT * FROM usage_ledger
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at ASC, usage_id ASC
    `).all(...params) as Array<{
      usage_id: string
      operation_id: string
      session_id: string
      provider: string | null
      model: string | null
      input_tokens: number | null
      output_tokens: number | null
      cost_usd: number | null
      payload_json: string | null
      created_at: number
    }>
    return rows.map(row => ({
      usageId: row.usage_id,
      operationId: row.operation_id,
      sessionId: row.session_id,
      provider: row.provider ?? undefined,
      model: row.model ?? undefined,
      inputTokens: row.input_tokens ?? undefined,
      outputTokens: row.output_tokens ?? undefined,
      costUsd: row.cost_usd ?? undefined,
      payload: row.payload_json ? JSON.parse(row.payload_json) : undefined,
      createdAt: row.created_at,
    }))
  }

  recordProjectionParity(observation: ProjectionParityObservation): void {
    this.databaseOperation('record projection parity', () => {
      this.db.prepare(`
        INSERT INTO projection_parity_observations (
          projection, session_id, cursor, canonical_facts, legacy_messages,
          issue_count, issue_counts_json, parity_ratio, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(projection, session_id, cursor) DO UPDATE SET
          canonical_facts = excluded.canonical_facts,
          legacy_messages = excluded.legacy_messages,
          issue_count = excluded.issue_count,
          issue_counts_json = excluded.issue_counts_json,
          parity_ratio = excluded.parity_ratio,
          observed_at = excluded.observed_at
      `).run(
        observation.projection,
        observation.sessionId,
        observation.cursor,
        observation.canonicalFacts,
        observation.legacyMessages,
        observation.issueCount,
        canonicalJson(observation.issueCounts),
        observation.parityRatio,
        observation.observedAt,
      )
    })
  }

  listProjectionParity(sessionId?: string): ProjectionParityObservation[] {
    const rows = this.db.prepare(`
      SELECT * FROM projection_parity_observations
      ${sessionId ? 'WHERE session_id = ?' : ''}
      ORDER BY observed_at DESC, projection ASC, session_id ASC
    `).all(...(sessionId ? [sessionId] : [])) as Array<{
      projection: string
      session_id: string
      cursor: number
      canonical_facts: number
      legacy_messages: number
      issue_count: number
      issue_counts_json: string
      parity_ratio: number
      observed_at: number
    }>
    return rows.map(row => ({
      projection: row.projection,
      sessionId: row.session_id,
      cursor: row.cursor,
      canonicalFacts: row.canonical_facts,
      legacyMessages: row.legacy_messages,
      issueCount: row.issue_count,
      issueCounts: JSON.parse(row.issue_counts_json) as Record<string, number>,
      parityRatio: row.parity_ratio,
      observedAt: row.observed_at,
    }))
  }

  getMaterializedProjection<TSnapshot = unknown>(projection: string): MaterializedProjection<TSnapshot> | undefined {
    const row = this.db.prepare(`
      SELECT p.projection, p.schema_version, p.snapshot_json, p.updated_at, c.last_seq
      FROM projection_snapshots p
      JOIN projection_cursors c ON c.projection = p.projection
      WHERE p.projection = ?
    `).get(projection) as {
      projection: string
      schema_version: number
      snapshot_json: string
      updated_at: number
      last_seq: number
    } | undefined
    return row ? {
      projection: row.projection,
      schemaVersion: row.schema_version,
      cursor: row.last_seq,
      snapshot: JSON.parse(row.snapshot_json) as TSnapshot,
      updatedAt: row.updated_at,
    } : undefined
  }

  /** Atomically replace a projection snapshot and advance its persisted cursor. */
  commitMaterializedProjection<TSnapshot>(input: CommitProjectionInput<TSnapshot>): void {
    if (!input.projection.trim()) throw new Error('Projection name is required')
    if (input.nextCursor < input.expectedCursor) throw new Error('Projection cursor cannot regress')
    this.databaseOperation('commit materialized projection', () => this.db.transaction(() => {
      const actualCursor = this.getProjectionCursor(input.projection)
      if (actualCursor !== input.expectedCursor) {
        throw new Error(`Projection ${input.projection} expected cursor ${input.expectedCursor}, found ${actualCursor}`)
      }
      const latestEventSeq = this.getLatestEventSeq()
      if (input.nextCursor > latestEventSeq) {
        throw new Error(`Projection ${input.projection} cursor ${input.nextCursor} is ahead of event log ${latestEventSeq}`)
      }
      const updatedAt = input.updatedAt ?? Date.now()
      this.db.prepare(`
        INSERT INTO projection_snapshots (projection, schema_version, snapshot_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(projection) DO UPDATE SET
          schema_version = excluded.schema_version,
          snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at
      `).run(input.projection, input.schemaVersion, canonicalJson(input.snapshot), updatedAt)
      this.db.prepare(`
        INSERT INTO projection_cursors (projection, last_seq, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(projection) DO UPDATE SET
          last_seq = excluded.last_seq,
          updated_at = excluded.updated_at
      `).run(input.projection, input.nextCursor, updatedAt)
    })())
  }

  /** Drop rebuildable state only; immutable runtime facts are never removed. */
  resetMaterializedProjection(projection: string): void {
    this.databaseOperation('reset materialized projection', () => this.db.transaction(() => {
      this.db.prepare('DELETE FROM projection_snapshots WHERE projection = ?').run(projection)
      this.db.prepare('DELETE FROM projection_cursors WHERE projection = ?').run(projection)
    })())
  }

  private databaseOperation<T>(operation: string, action: () => T): T {
    try {
      return action()
    } catch (error) {
      if (error instanceof RuntimeDatabaseError) throw error
      throw new RuntimeDatabaseError(classifyRuntimeDatabaseFailure(error), operation, error)
    }
  }

  private migrate(): void {
    const currentRow = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    const current = currentRow.user_version
    if (current > SCHEMA_VERSION) {
      throw new Error(`Runtime database schema ${current} is newer than supported ${SCHEMA_VERSION}`)
    }
    if (current < 1) this.db.exec(`
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
    if (current < 2) this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS projection_snapshots (
        projection TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      PRAGMA user_version = 2;
      COMMIT;
    `)
    if (current < 3) this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS projection_parity_observations (
        projection TEXT NOT NULL,
        session_id TEXT NOT NULL,
        cursor INTEGER NOT NULL,
        canonical_facts INTEGER NOT NULL,
        legacy_messages INTEGER NOT NULL,
        issue_count INTEGER NOT NULL,
        issue_counts_json TEXT NOT NULL,
        parity_ratio REAL NOT NULL,
        observed_at INTEGER NOT NULL,
        PRIMARY KEY (projection, session_id, cursor)
      );
      CREATE INDEX IF NOT EXISTS ix_projection_parity_observed
        ON projection_parity_observations(observed_at DESC);
      PRAGMA user_version = 3;
      COMMIT;
    `)
    if (current < 4) {
      const columns = new Set(
        (this.db.prepare('PRAGMA table_info(tool_operations)').all() as Array<{ name: string }>)
          .map(column => column.name),
      )
      this.db.exec('BEGIN IMMEDIATE')
      try {
        if (!columns.has('tool_batch_id')) {
          this.db.exec('ALTER TABLE tool_operations ADD COLUMN tool_batch_id TEXT')
        }
        if (!columns.has('tool_batch_ordinal')) {
          this.db.exec('ALTER TABLE tool_operations ADD COLUMN tool_batch_ordinal INTEGER CHECK(tool_batch_ordinal IS NULL OR tool_batch_ordinal >= 0)')
        }
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS ix_tool_operations_batch
            ON tool_operations(run_operation_id, tool_batch_id, tool_batch_ordinal);
          PRAGMA user_version = 4;
          COMMIT;
        `)
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
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

  private countUnsettledToolOperations(runOperationId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM tool_operations
      WHERE run_operation_id = ? AND status IN ('effect_pending', 'recovery_parked')
    `).get(runOperationId) as { count: number }
    return row.count
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
    toolBatchId?: string
    toolBatchOrdinal?: number
    toolName: string
    canonicalArgsHash: string
  }): void {
    if (existing.run_operation_id !== identity.runOperationId
      || existing.operation_id !== identity.operationId
      || existing.provider_tool_call_id !== identity.providerToolCallId
      || (existing.tool_batch_id ?? undefined) !== identity.toolBatchId
      || (existing.tool_batch_ordinal ?? undefined) !== identity.toolBatchOrdinal
      || existing.tool_name !== identity.toolName
      || existing.canonical_args_hash !== identity.canonicalArgsHash) {
      throw new Error(`Tool operation ${identity.operationId} identity or arguments changed`)
    }
  }

  private appendUsage(usage: RuntimeUsageRow): void {
    const existing = this.listUsage().find(item => item.usageId === usage.usageId)
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(usage)) {
        throw new Error(`Usage identity ${usage.usageId} already exists with different content`)
      }
      return
    }
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
