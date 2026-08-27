import {
  DURABLE_TOOL_BOUNDARY_PROTOCOL,
  type DurableOperationState,
  type DurableModelBoundary,
  type DurableModelOutcomeRequest,
  type DurableModelOutcomeResponse,
  type DurableModelPrepareRequest,
  type DurableModelPrepareResponse,
  type ModelReconciliationRequest,
  type ModelReconciliationResult,
  type DurableRecoveryEvidenceSnapshot,
  type ToolReconciliationAdapter,
  type ToolReconciliationRequest,
  type ToolReconciliationResult,
  type DurableToolBoundary,
  type DurableToolOutcomeRequest,
  type DurableToolOutcomeResponse,
  type DurableToolPrepareRequest,
  type DurableToolPrepareResponse,
  type RuntimeEvent,
  type ToolDispatchIntent,
  type ToolOutcome,
  type ToolRecoveryMode,
} from '@craft-agent/shared/durable-runtime'
import { canonicalToolArgsHash, durableToolOperationId } from './dispatcher.js'
import { redactDurablePayload } from './sensitive-payload.js'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, renameSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DurableRuntimeStore, type RuntimeDatabaseIntegrity, type RuntimeUsageRow } from './store.js'
import { DurableProjectionRunner, ProjectionSchemaMismatchError } from './projection-runner.js'
import {
  reduceWorkspaceSessionProjection,
  type DurableSessionProjection,
  type DurableWorkspaceSessionProjection,
} from './projection.js'

const SAFE_REPLAY_TOOLS = new Set([
  'read', 'grep', 'find', 'ls', 'websearch', 'web_search', 'webfetch', 'web_fetch',
])

export function defaultToolRecoveryMode(toolName: string): ToolRecoveryMode {
  const normalized = toolName.replace(/^mcp__[^_]+__/, '').toLowerCase()
  return SAFE_REPLAY_TOOLS.has(normalized) ? 'safe_replay' : 'never_auto_retry'
}

export function durableModelOperationId(runOperationId: string, providerRequestId: string): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([runOperationId, providerRequestId]))
    .digest('hex')
    .slice(0, 32)
  return `modelop_${digest}`
}

function nextState(
  state: DurableOperationState,
  phase: DurableOperationState['phase'],
  data: Record<string, unknown>,
  now: number,
): DurableOperationState {
  return {
    ...state,
    phase,
    stateVersion: state.stateVersion + 1,
    data,
    updatedAt: now,
  }
}

export interface AcceptDurableRunInput {
  workspaceRootPath: string
  sessionId: string
  turnId: string
  operationId: string
  userMessageId: string
  userMessage: string
  kind?: DurableOperationState['kind']
  modelVisible?: boolean
  acceptedAt?: number
}

export interface DurableRecoveryItem {
  operationId: string
  sessionId: string
  action: 'parked_unknown_effect' | 'terminalized_interrupted' | 'already_parked'
  unsettledToolOperationIds: string[]
  unsettledModelOperationId?: string
}

export interface DurableRecoveryReport {
  workspaceRootPath: string
  recoveredAt: number
  items: DurableRecoveryItem[]
}

export class DurableRuntimeCoordinator {
  private readonly stores = new Map<string, DurableRuntimeStore>()
  private readonly reconciliationAdapters = new Map<string, ToolReconciliationAdapter>()

  storeFor(workspaceRootPath: string): DurableRuntimeStore {
    let store = this.stores.get(workspaceRootPath)
    if (!store) {
      store = new DurableRuntimeStore(workspaceRootPath)
      this.stores.set(workspaceRootPath, store)
    }
    return store
  }

  closeAll(): void {
    for (const store of this.stores.values()) store.close()
    this.stores.clear()
  }

  checkDatabaseIntegrity(workspaceRootPath: string): RuntimeDatabaseIntegrity {
    return this.storeFor(workspaceRootPath).checkIntegrity()
  }

  backupDatabase(workspaceRootPath: string, destinationPath: string): string {
    return this.storeFor(workspaceRootPath).backupTo(destinationPath)
  }

  maintainDatabase(
    workspaceRootPath: string,
    options?: { projectionRetentionMs?: number; vacuum?: boolean },
  ): import('./store.js').RuntimeDatabaseMaintenanceResult {
    return this.storeFor(workspaceRootPath).maintain(options)
  }

  /**
   * Restore from a verified SQLite backup using same-directory atomic renames.
   * The prior live DB is retained as a pre-restore backup; rollback restores it
   * if the replacement cannot be opened or passes no integrity check.
   */
  restoreDatabase(workspaceRootPath: string, backupPath: string, restoredAt = Date.now()): {
    databasePath: string
    previousDatabasePath: string
    integrity: RuntimeDatabaseIntegrity
  } {
    const active = this.storeFor(workspaceRootPath)
    const databasePath = active.databasePath
    if (!existsSync(backupPath)) throw new Error(`Runtime database backup does not exist: ${backupPath}`)
    if (resolve(backupPath) === resolve(databasePath)) throw new Error('Restore source must differ from the live runtime database')
    const suffix = `${restoredAt}-${process.pid}`
    const stagedPath = join(dirname(databasePath), `runtime.restore-${suffix}.tmp.db`)
    const previousDatabasePath = join(dirname(databasePath), `runtime.pre-restore-${suffix}.db`)
    copyFileSync(backupPath, stagedPath)
    const staged = new DurableRuntimeStore(workspaceRootPath, { databasePath: stagedPath })
    const stagedIntegrity = staged.checkIntegrity()
    staged.close()
    if (!stagedIntegrity.ok) throw new Error(`Runtime database backup failed integrity check: ${stagedIntegrity.messages.join('; ')}`)

    // Flush WAL and retain a standalone safety copy before replacing authority.
    active.backupTo(previousDatabasePath)
    active.close()
    this.stores.delete(workspaceRootPath)
    renameSync(databasePath, `${previousDatabasePath}.original`)
    renameSync(stagedPath, databasePath)
    try {
      const restored = new DurableRuntimeStore(workspaceRootPath, { databasePath })
      const integrity = restored.checkIntegrity()
      if (!integrity.ok) throw new Error(`Restored runtime database failed integrity check: ${integrity.messages.join('; ')}`)
      this.stores.set(workspaceRootPath, restored)
      return { databasePath, previousDatabasePath, integrity }
    } catch (error) {
      if (existsSync(databasePath)) renameSync(databasePath, `${databasePath}.rejected-${suffix}`)
      renameSync(`${previousDatabasePath}.original`, databasePath)
      this.stores.set(workspaceRootPath, new DurableRuntimeStore(workspaceRootPath, { databasePath }))
      throw error
    }
  }

  /** Incrementally refresh the canonical shadow read model and return one session. */
  getCanonicalSessionProjection(
    workspaceRootPath: string,
    sessionId: string,
  ): DurableSessionProjection | undefined {
    const runner = new DurableProjectionRunner<DurableWorkspaceSessionProjection>(
      this.storeFor(workspaceRootPath),
      {
        name: 'canonical/sessions',
        schemaVersion: 2,
        initial: () => ({ sessions: {} }),
        reduce: reduceWorkspaceSessionProjection,
      },
    )
    try {
      return runner.runToEnd().snapshot.sessions[sessionId]
    } catch (error) {
      // Materialized projections are disposable. A reducer/schema upgrade must
      // rebuild from immutable runtime facts instead of permanently forcing the
      // online path back to the legacy cache.
      if (error instanceof ProjectionSchemaMismatchError) {
        return runner.rebuild().snapshot.sessions[sessionId]
      }
      throw error
    }
  }

  getCanonicalModelContext(
    workspaceRootPath: string,
    sessionId: string,
    excludeOperationId?: string,
  ): import('@craft-agent/shared/durable-runtime').DurableCanonicalModelContext {
    const projection = this.getCanonicalSessionProjection(workspaceRootPath, sessionId)
    return {
      cursor: projection?.cursor ?? 0,
      items: (projection?.items ?? []).filter(item => item.operationId !== excludeOperationId),
    }
  }

  /**
   * Commit one TaskRunner state transition before updating its JSONL/file
   * compatibility projections. The ordinal is owned by the task state machine
   * and makes a replay of the same transition idempotent.
   */
  commitTaskRunFact(input: {
    workspaceRootPath: string
    sessionId: string
    taskSlug: string
    runId: string
    ordinal: number
    entry: import('@craft-agent/shared/tasks').RunLogEntry
  }): number {
    const operationId = `taskrun:${input.taskSlug}:${input.runId}`
    const store = this.storeFor(input.workspaceRootPath)
    if (!store.getOperation(operationId)) {
      if (input.entry.kind !== 'run-started') {
        throw new Error(`Canonical task run ${input.taskSlug}:${input.runId} has no run-started fact`)
      }
      this.acceptRun({
        workspaceRootPath: input.workspaceRootPath,
        sessionId: input.sessionId,
        turnId: operationId,
        operationId,
        userMessageId: `${operationId}:definition`,
        userMessage: `Task run ${input.taskSlug}/${input.runId}`,
        kind: 'task_run',
        modelVisible: false,
        acceptedAt: Date.parse(input.entry.t) || Date.now(),
      })
    }
    const createdAt = Date.parse(input.entry.t) || Date.now()
    const [seq] = store.appendEvents([{
      eventId: `${operationId}:fact:${input.ordinal}`,
      sessionId: input.sessionId,
      turnId: operationId,
      operationId,
      type: 'task_fact_committed',
      schemaVersion: 1,
      modelVisible: false,
      partial: false,
      payload: {
        taskSlug: input.taskSlug,
        runId: input.runId,
        ordinal: input.ordinal,
        entry: input.entry,
      },
      createdAt,
    }])
    if (input.entry.kind === 'run-completed' || input.entry.kind === 'run-failed' || input.entry.kind === 'run-stopped') {
      this.completeRun(
        input.workspaceRootPath,
        operationId,
        input.entry.kind === 'run-completed' ? 'complete' : input.entry.kind === 'run-stopped' ? 'interrupted' : 'error',
      )
    }
    return seq ?? 0
  }

  /** Replay canonical TaskRunner facts in their committed order. */
  listTaskRunFacts(
    workspaceRootPath: string,
    taskSlug: string,
    runId: string,
  ): import('@craft-agent/shared/tasks').RunLogEntry[] {
    const store = this.storeFor(workspaceRootPath)
    const facts: Array<{ ordinal: number; entry: import('@craft-agent/shared/tasks').RunLogEntry }> = []
    let afterSeq = 0
    while (true) {
      const batch = store.listEvents({ afterSeq, limit: 10_000 })
      if (batch.length === 0) break
      for (const event of batch) {
        if (event.type !== 'task_fact_committed') continue
        const payload = event.payload as {
          taskSlug?: string
          runId?: string
          ordinal?: number
          entry?: import('@craft-agent/shared/tasks').RunLogEntry
        }
        if (payload.taskSlug === taskSlug && payload.runId === runId && payload.entry && typeof payload.ordinal === 'number') {
          facts.push({ ordinal: payload.ordinal, entry: payload.entry })
        }
      }
      afterSeq = batch.at(-1)?.seq ?? afterSeq
      if (batch.length < 10_000) break
    }
    return facts.sort((a, b) => a.ordinal - b.ordinal).map(fact => fact.entry)
  }

  /**
   * Safe compatibility import for branch/history context. These facts carry an
   * explicit unverified provenance and never create tool dispatch evidence or
   * operation state, so they cannot authorize recovery/replay.
   */
  importLegacyContext(
    workspaceRootPath: string,
    sessionId: string,
    messages: import('@craft-agent/core/types').Message[],
    importedAt = Date.now(),
  ): number[] {
    const operationId = `legacy-import:${sessionId}`
    const events: RuntimeEvent[] = messages.flatMap((message, index) => {
      const kind = message.toolUseId
        ? 'tool'
        : message.role === 'user'
          ? 'user'
          : message.role === 'assistant'
            ? 'assistant'
            : undefined
      if (!kind) return []
      return [{
        eventId: `${operationId}:${index}:${message.toolUseId ?? message.id}`,
        sessionId,
        turnId: message.turnId,
        operationId,
        type: 'legacy_context_imported' as const,
        schemaVersion: 1 as const,
        modelVisible: true,
        partial: false,
        payload: redactDurablePayload({
          provenance: 'legacy_cache_unverified',
          dispatchEvidence: false,
          kind,
          messageId: message.id,
          content: message.content,
          toolCallId: message.toolUseId,
          toolName: message.toolName,
          args: message.toolInput,
          result: message.toolResult,
          isError: message.isError ?? message.toolStatus === 'error',
          hasOutcome: (message.toolStatus === 'completed' || message.toolStatus === 'error')
            && message.toolResult !== undefined,
        }),
        createdAt: message.timestamp || importedAt,
      }]
    })
    return events.length > 0 ? this.storeFor(workspaceRootPath).appendEvents(events) : []
  }

  registerReconciliationAdapter(toolName: string, adapter: ToolReconciliationAdapter): void {
    this.reconciliationAdapters.set(toolName, adapter)
  }

  reconcileModel(
    workspaceRootPath: string,
    request: ModelReconciliationRequest,
    decidedAt = Date.now(),
  ): ModelReconciliationResult {
    if (!request.reason.trim()) throw new Error('Model reconciliation reason is required')
    if (!request.actor.id.trim()) throw new Error('Model reconciliation actor is required')
    const store = this.storeFor(workspaceRootPath)
    const state = store.listOperations().find(candidate => {
      const current = (candidate.data as { currentModel?: { operationId?: string } }).currentModel
      return candidate.sessionId === request.sessionId && current?.operationId === request.modelOperationId
    })
    if (!state) throw new Error(`Model operation ${request.modelOperationId} was not found`)
    if (state.phase !== 'recovery_parked') throw new Error(`Model operation ${request.modelOperationId} does not require reconciliation`)
    const checkpoint = nextState(state, 'checkpoint', {
      ...(typeof state.data === 'object' && state.data !== null ? state.data : {}),
      currentModel: null,
      unsettledModelOperationId: null,
      lastModelReconciliationDecision: request.decision,
    }, decidedAt)
    const committed = store.commitOperationTransition({
      events: [{
        eventId: `${request.modelOperationId}:reconciliation`,
        sessionId: request.sessionId,
        turnId: state.turnId,
        operationId: state.operationId,
        type: 'model_recovery_decided',
        schemaVersion: 1,
        modelVisible: false,
        partial: false,
        payload: redactDurablePayload({
          verdict: request.decision,
          reason: request.reason,
          actor: request.actor,
          evidence: request.evidence,
          decidedAt,
        }),
        createdAt: decidedAt,
      }],
      usage: [],
      operationState: checkpoint,
      expectedStateVersion: state.stateVersion,
    })
    return { committedSeq: committed.eventSeqs.at(-1) ?? 0, operationState: checkpoint }
  }

  /** Return canonical recovery evidence without mutating operation state. */
  getRecoveryEvidence(
    workspaceRootPath: string,
    toolOperationId: string,
  ): DurableRecoveryEvidenceSnapshot | undefined {
    const store = this.storeFor(workspaceRootPath)
    const evidence = store.getToolRecoveryEvidence(toolOperationId)
    const verdict = store.resolveToolRecovery(toolOperationId)
    const runOperationId = evidence?.dispatch?.runOperationId ?? evidence?.call?.runOperationId
    if (!evidence || !verdict || !runOperationId) return undefined
    const runOperation = store.getOperation(runOperationId)
    if (!runOperation) return undefined
    return {
      sessionId: runOperation.sessionId,
      runOperation,
      evidence,
      verdict,
    }
  }

  reconcileTool(
    workspaceRootPath: string,
    request: ToolReconciliationRequest,
    decidedAt = Date.now(),
  ): ToolReconciliationResult {
    const store = this.storeFor(workspaceRootPath)
    const snapshot = this.getRecoveryEvidence(workspaceRootPath, request.toolOperationId)
    if (!snapshot) throw new Error(`Tool operation ${request.toolOperationId} was not found`)
    if (snapshot.sessionId !== request.sessionId) throw new Error('Tool operation belongs to another session')
    if (snapshot.verdict.kind !== 'reconcile_required') {
      throw new Error(`Tool operation ${request.toolOperationId} does not require reconciliation`)
    }
    if (!request.reason.trim()) throw new Error('Reconciliation reason is required')
    if (!request.actor.id.trim()) throw new Error('Reconciliation actor is required')
    if (request.evidence.length === 0 && request.decision !== 'manual_abandon') {
      throw new Error('Verified evidence is required for this reconciliation decision')
    }

    const dispatch = snapshot.verdict.dispatch
    const isError = request.decision !== 'completed'
    const result = redactDurablePayload(request.result ?? {
      reconciliationDecision: request.decision,
      reason: request.reason,
    })
    const outcome: ToolOutcome = {
      runOperationId: dispatch.runOperationId,
      operationId: dispatch.operationId,
      providerToolCallId: dispatch.providerToolCallId,
      toolName: dispatch.toolName,
      canonicalArgsHash: dispatch.canonicalArgsHash,
      result,
      isError,
      externalReference: request.externalReference
        ?? request.evidence.find(item => item.externalReference)?.externalReference,
    }
    const remaining = store.listUnsettledToolOperations(dispatch.runOperationId)
      .map(item => item.dispatch?.operationId)
      .filter((id): id is string => Boolean(id) && id !== dispatch.operationId)
    const operationState = nextState(
      snapshot.runOperation,
      remaining.length > 0 ? 'recovery_parked' : 'checkpoint',
      remaining.length > 0
        ? { unsettledToolOperationIds: remaining, lastReconciliationDecision: request.decision }
        : { currentTool: null, lastReconciliationDecision: request.decision },
      decidedAt,
    )
    const auditPayload = {
      verdict: request.decision,
      reason: request.reason,
      actor: request.actor,
      evidence: redactDurablePayload(request.evidence),
      decidedAt,
    }
    const committed = store.commitToolReconciliation({
      events: [
        {
          eventId: `${dispatch.operationId}:reconciliation`,
          sessionId: request.sessionId,
          turnId: snapshot.runOperation.turnId,
          operationId: dispatch.runOperationId,
          type: 'tool_recovery_decided',
          schemaVersion: 1,
          modelVisible: false,
          partial: false,
          payload: auditPayload,
          createdAt: decidedAt,
        },
        {
          eventId: `${dispatch.operationId}:reconciled-outcome`,
          sessionId: request.sessionId,
          turnId: snapshot.runOperation.turnId,
          operationId: dispatch.runOperationId,
          type: 'tool_outcome_committed',
          schemaVersion: 1,
          modelVisible: true,
          partial: false,
          payload: outcome,
          createdAt: decidedAt,
        },
      ],
      outcome,
      operationState,
      expectedStateVersion: snapshot.runOperation.stateVersion,
      settledAt: decidedAt,
    })
    const resolved = this.getRecoveryEvidence(workspaceRootPath, request.toolOperationId)
    if (!resolved) throw new Error('Reconciled tool evidence disappeared')
    return {
      committedSeq: committed.eventSeqs.at(-1) ?? 0,
      snapshot: resolved,
    }
  }

  async queryAndReconcileTool(
    workspaceRootPath: string,
    request: Pick<ToolReconciliationRequest, 'sessionId' | 'toolOperationId' | 'actor'>,
  ): Promise<ToolReconciliationResult> {
    const snapshot = this.getRecoveryEvidence(workspaceRootPath, request.toolOperationId)
    if (!snapshot || snapshot.verdict.kind !== 'reconcile_required') {
      throw new Error(`Tool operation ${request.toolOperationId} does not require reconciliation`)
    }
    const adapter = this.reconciliationAdapters.get(snapshot.verdict.dispatch.toolName)
    if (!adapter) throw new Error(`No reconciliation adapter is registered for ${snapshot.verdict.dispatch.toolName}`)
    const callEvent = this.storeFor(workspaceRootPath).getEvent(`${snapshot.verdict.dispatch.operationId}:call`)
    const callPayload = callEvent?.payload as { args?: Record<string, unknown> } | undefined
    const queried = await adapter.queryExternal({
      operationId: snapshot.verdict.dispatch.operationId,
      idempotencyKey: snapshot.verdict.dispatch.idempotencyKey,
      toolName: snapshot.verdict.dispatch.toolName,
      args: callPayload?.args,
      externalReference: snapshot.evidence.outcome?.externalReference,
    })
    return this.reconcileTool(workspaceRootPath, {
      ...request,
      ...queried,
    })
  }

  /**
   * Reduce every non-terminal program counter after process restart. An
   * unsettled T1 tail is always parked as unknown; startup never repeats its
   * side effect. Operations with no unsettled effect are safely terminated as
   * interrupted and may be started again under a new operation identity.
   */
  recoverWorkspace(workspaceRootPath: string, recoveredAt = Date.now()): DurableRecoveryReport {
    const store = this.storeFor(workspaceRootPath)
    const items: DurableRecoveryItem[] = []
    for (const state of store.listOperations()) {
      const unsettled = store.listUnsettledToolOperations(state.operationId)
      const toolOperationIds = unsettled
        .map(item => item.dispatch?.operationId)
        .filter((id): id is string => Boolean(id))

      if (state.phase === 'recovery_parked') {
        items.push({
          operationId: state.operationId,
          sessionId: state.sessionId,
          action: 'already_parked',
          unsettledToolOperationIds: toolOperationIds,
        })
        continue
      }

      const currentModel = (state.data as { currentModel?: { operationId?: string } }).currentModel
      if (state.phase === 'model_effect_pending' && currentModel?.operationId) {
        const parked = nextState(state, 'recovery_parked', {
          ...(typeof state.data === 'object' && state.data !== null ? state.data : {}),
          unsettledModelOperationId: currentModel.operationId,
          stopReason: 'process_restart',
        }, recoveredAt)
        store.commitOperationAccepted([{
          eventId: `${currentModel.operationId}:restart-recovery`,
          sessionId: state.sessionId,
          turnId: state.turnId,
          operationId: state.operationId,
          type: 'model_recovery_decided',
          schemaVersion: 1,
          modelVisible: false,
          partial: false,
          payload: {
            verdict: 'indeterminate',
            reason: 'Process restarted after model T1 without a durable T2 outcome',
            decidedAt: recoveredAt,
          },
          createdAt: recoveredAt,
        }], parked)
        items.push({
          operationId: state.operationId,
          sessionId: state.sessionId,
          action: 'parked_unknown_effect',
          unsettledToolOperationIds: toolOperationIds,
          unsettledModelOperationId: currentModel.operationId,
        })
        continue
      }

      if (toolOperationIds.length > 0) {
        const parked = nextState(state, 'recovery_parked', {
          ...(typeof state.data === 'object' && state.data !== null ? state.data : {}),
          unsettledToolOperationIds: toolOperationIds,
          stopReason: 'process_restart',
        }, recoveredAt)
        store.commitOperationAccepted([{
          eventId: `${state.operationId}:restart-recovery`,
          sessionId: state.sessionId,
          turnId: state.turnId,
          operationId: state.operationId,
          type: 'tool_recovery_decided',
          schemaVersion: 1,
          modelVisible: false,
          partial: false,
          payload: {
            verdict: 'reconcile_required',
            reason: 'Process restarted after T1 without a durable T2 outcome',
            decidedAt: recoveredAt,
          },
          createdAt: recoveredAt,
        }], parked)
        items.push({
          operationId: state.operationId,
          sessionId: state.sessionId,
          action: 'parked_unknown_effect',
          unsettledToolOperationIds: toolOperationIds,
        })
        continue
      }

      store.deleteOperation(state.operationId, {
        eventId: `${state.operationId}:restart-terminal`,
        sessionId: state.sessionId,
        turnId: state.turnId,
        operationId: state.operationId,
        type: 'operation_terminal',
        schemaVersion: 1,
        modelVisible: false,
        partial: false,
        payload: { reason: 'interrupted', recoveredAt },
        createdAt: recoveredAt,
      })
      items.push({
        operationId: state.operationId,
        sessionId: state.sessionId,
        action: 'terminalized_interrupted',
        unsettledToolOperationIds: [],
      })
    }
    return { workspaceRootPath, recoveredAt, items }
  }

  acceptRun(input: AcceptDurableRunInput): DurableOperationState {
    const store = this.storeFor(input.workspaceRootPath)
    const existing = store.getOperation(input.operationId)
    if (existing) return existing
    const acceptedAt = input.acceptedAt ?? Date.now()
    const state: DurableOperationState = {
      operationId: input.operationId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      kind: input.kind ?? 'agent_turn',
      phase: 'accepted',
      stateVersion: 1,
      data: { userMessageId: input.userMessageId, modelVisible: input.modelVisible ?? true },
      createdAt: acceptedAt,
      updatedAt: acceptedAt,
    }
    const events: RuntimeEvent[] = [
      {
        eventId: `${input.operationId}:accepted`,
        sessionId: input.sessionId,
        turnId: input.turnId,
        operationId: input.operationId,
        type: 'operation_accepted',
        schemaVersion: 1,
        modelVisible: false,
        partial: false,
        payload: { kind: state.kind, userMessageId: input.userMessageId },
        createdAt: acceptedAt,
      },
      {
        eventId: `${input.operationId}:user`,
        sessionId: input.sessionId,
        turnId: input.turnId,
        operationId: input.operationId,
        type: 'user_message_committed',
        schemaVersion: 1,
        modelVisible: input.modelVisible ?? true,
        partial: false,
        payload: { messageId: input.userMessageId, content: input.userMessage },
        createdAt: acceptedAt,
      },
    ]
    store.commitOperationAccepted(events, state)
    return state
  }

  commitAssistantMessage(input: {
    workspaceRootPath: string
    operationId: string
    sessionId: string
    turnId?: string
    messageId: string
    content: string
    isIntermediate?: boolean
    usage?: Omit<RuntimeUsageRow, 'operationId' | 'sessionId' | 'createdAt'>
    createdAt?: number
  }): number {
    const store = this.storeFor(input.workspaceRootPath)
    const state = store.getOperation(input.operationId)
    if (!state) throw new Error(`Durable run ${input.operationId} is not open`)
    if (state.sessionId !== input.sessionId) throw new Error('Durable run belongs to another session')
    const createdAt = input.createdAt ?? Date.now()
    const assistantEvent: RuntimeEvent = {
      eventId: `${input.operationId}:assistant:${input.messageId}`,
      sessionId: input.sessionId,
      turnId: input.turnId,
      operationId: input.operationId,
      type: 'assistant_message_committed',
      schemaVersion: 1,
      modelVisible: true,
      partial: false,
      payload: { messageId: input.messageId, content: input.content, isIntermediate: input.isIntermediate ?? false },
      createdAt,
    }
    const usage: RuntimeUsageRow[] = input.usage ? [{
      ...input.usage,
      operationId: input.operationId,
      sessionId: input.sessionId,
      createdAt,
    }] : []
    const events = usage.length > 0
      ? [assistantEvent, {
          eventId: `${usage[0]!.usageId}:committed`,
          sessionId: input.sessionId,
          turnId: input.turnId,
          operationId: input.operationId,
          type: 'usage_committed' as const,
          schemaVersion: 1 as const,
          modelVisible: false,
          partial: false,
          payload: usage[0],
          createdAt,
        }]
      : [assistantEvent]
    const committed = store.commitFactsAndUsage({ events, usage })
    return committed.eventSeqs.at(-1) ?? 0
  }

  boundaryFor(workspaceRootPath: string): DurableToolBoundary {
    return {
      prepare: request => this.prepareTool(workspaceRootPath, request),
      commitOutcome: request => this.commitToolOutcome(workspaceRootPath, request),
    }
  }

  modelBoundaryFor(workspaceRootPath: string): DurableModelBoundary {
    return {
      prepare: request => this.prepareModel(workspaceRootPath, request),
      commitOutcome: request => this.commitModelOutcome(workspaceRootPath, request),
    }
  }

  async prepareModel(
    workspaceRootPath: string,
    request: DurableModelPrepareRequest,
  ): Promise<DurableModelPrepareResponse> {
    const store = this.storeFor(workspaceRootPath)
    const runState = store.getOperation(request.runOperationId)
    if (!runState) throw new Error(`Durable run ${request.runOperationId} is not open`)
    if (runState.sessionId !== request.sessionId) throw new Error('Durable run belongs to another session')
    const operationId = durableModelOperationId(request.runOperationId, request.providerRequestId)
    const outcomeEvent = store.getEvent(`${operationId}:outcome`)
    if (outcomeEvent) {
      return {
        operationId,
        idempotencyKey: operationId,
        created: false,
        status: 'outcome_committed',
        committedSeq: outcomeEvent.seq ?? 0,
      }
    }
    const currentModel = (runState.data as { currentModel?: { operationId?: string } }).currentModel
    if (runState.phase === 'model_effect_pending') {
      if (currentModel?.operationId !== operationId) {
        throw new Error(`Durable run ${request.runOperationId} already has a pending model attempt`)
      }
      const dispatch = store.getEvent(`${operationId}:dispatch`)
      return {
        operationId,
        idempotencyKey: operationId,
        created: false,
        status: 'effect_pending',
        committedSeq: dispatch?.seq ?? 0,
      }
    }
    const now = Date.now()
    const pending = nextState(runState, 'model_effect_pending', {
      ...(typeof runState.data === 'object' && runState.data !== null ? runState.data : {}),
      currentModel: {
        operationId,
        providerRequestId: request.providerRequestId,
        provider: request.provider,
        model: request.model,
        canonicalRequestHash: request.canonicalRequestHash,
      },
    }, now)
    const event: RuntimeEvent = {
      eventId: `${operationId}:dispatch`,
      sessionId: request.sessionId,
      turnId: request.turnId,
      operationId: request.runOperationId,
      type: 'model_dispatch_committed',
      schemaVersion: 1,
      modelVisible: false,
      partial: false,
      payload: { ...request, operationId, idempotencyKey: operationId },
      createdAt: now,
    }
    const committed = store.commitOperationTransition({
      events: [event],
      usage: [],
      operationState: pending,
      expectedStateVersion: runState.stateVersion,
    })
    return {
      operationId,
      idempotencyKey: operationId,
      created: true,
      status: 'effect_pending',
      committedSeq: committed.eventSeqs.at(-1) ?? 0,
    }
  }

  async commitModelOutcome(
    workspaceRootPath: string,
    request: DurableModelOutcomeRequest,
  ): Promise<DurableModelOutcomeResponse> {
    const store = this.storeFor(workspaceRootPath)
    const existing = store.getEvent(`${request.operationId}:outcome`)
    if (existing) return { committedSeq: existing.seq ?? 0 }
    const runState = store.getOperation(request.runOperationId)
    if (!runState) throw new Error(`Durable run ${request.runOperationId} is not open`)
    const currentModel = (runState.data as { currentModel?: {
      operationId?: string
      providerRequestId?: string
      provider?: string
      model?: string
      canonicalRequestHash?: string
    } }).currentModel
    if (currentModel?.operationId !== request.operationId
      || currentModel.providerRequestId !== request.providerRequestId
      || currentModel.provider !== request.provider
      || currentModel.model !== request.model
      || currentModel.canonicalRequestHash !== request.canonicalRequestHash) {
      throw new Error(`Durable run ${request.runOperationId} is not awaiting model attempt ${request.operationId}`)
    }
    const now = Date.now()
    const checkpoint = nextState(runState, 'checkpoint', {
      ...(typeof runState.data === 'object' && runState.data !== null ? runState.data : {}),
      currentModel: null,
    }, now)
    const modelVisible = (runState.data as { modelVisible?: boolean }).modelVisible !== false
    const usage: RuntimeUsageRow[] = request.usage ? [{
      usageId: `model:${request.runOperationId}:${request.providerRequestId}`,
      operationId: request.runOperationId,
      sessionId: request.sessionId,
      provider: request.provider,
      model: request.model,
      inputTokens: request.usage.inputTokens,
      outputTokens: request.usage.outputTokens,
      costUsd: request.usage.costUsd,
      payload: request.usage.payload,
      createdAt: now,
    }] : []
    const events: RuntimeEvent[] = [{
      eventId: `${request.operationId}:outcome`,
      sessionId: request.sessionId,
      turnId: request.turnId,
      operationId: request.runOperationId,
      type: 'model_outcome_committed',
      schemaVersion: 1,
      modelVisible: false,
      partial: false,
      payload: request,
      createdAt: now,
    }, ...(request.text ? [{
      eventId: `${request.operationId}:assistant`,
      sessionId: request.sessionId,
      turnId: request.turnId,
      operationId: request.runOperationId,
      type: 'assistant_message_committed' as const,
      schemaVersion: 1 as const,
      modelVisible,
      partial: false,
      payload: {
        messageId: `model:${request.operationId}`,
        content: request.text,
        isIntermediate: request.stopReason === 'toolUse',
        modelOperationId: request.operationId,
      },
      createdAt: now,
    }] : []), ...usage.map(item => ({
      eventId: `${item.usageId}:committed`,
      sessionId: request.sessionId,
      turnId: request.turnId,
      operationId: request.runOperationId,
      type: 'usage_committed' as const,
      schemaVersion: 1 as const,
      modelVisible: false,
      partial: false,
      payload: item,
      createdAt: now,
    }))]
    const committed = store.commitOperationTransition({
      events,
      usage,
      operationState: checkpoint,
      expectedStateVersion: runState.stateVersion,
    })
    return { committedSeq: committed.eventSeqs.at(-1) ?? 0 }
  }

  async prepareTool(
    workspaceRootPath: string,
    request: DurableToolPrepareRequest,
  ): Promise<DurableToolPrepareResponse> {
    const store = this.storeFor(workspaceRootPath)
    const runState = store.getOperation(request.runOperationId)
    if (!runState) throw new Error(`Durable run ${request.runOperationId} is not open`)
    if (runState.sessionId !== request.sessionId) throw new Error('Durable run belongs to another session')

    const operationId = durableToolOperationId(request.runOperationId, request.providerToolCallId)
    const recoveryMode = request.recoveryMode ?? defaultToolRecoveryMode(request.toolName)
    const canonicalArgsHash = canonicalToolArgsHash(request.toolName, request.args)
    const intent: ToolDispatchIntent = {
      protocol: DURABLE_TOOL_BOUNDARY_PROTOCOL,
      runOperationId: request.runOperationId,
      operationId,
      providerToolCallId: request.providerToolCallId,
      toolName: request.toolName,
      canonicalArgsHash,
      recoveryMode,
      idempotencyKey: operationId,
    }
    const now = Date.now()
    const pendingState = nextState(runState, 'tool_effect_pending', {
      currentTool: {
        operationId,
        providerToolCallId: request.providerToolCallId,
        toolName: request.toolName,
        canonicalArgsHash,
        recoveryMode,
      },
    }, now)
    const result = store.commitToolPrepared({
      events: [
        {
          eventId: `${operationId}:call`,
          sessionId: request.sessionId,
          turnId: request.turnId,
          operationId: request.runOperationId,
          type: 'tool_call_observed',
          schemaVersion: 1,
          modelVisible: true,
          partial: false,
          payload: {
            toolOperationId: operationId,
            providerToolCallId: request.providerToolCallId,
            toolName: request.toolName,
            args: redactDurablePayload(request.args),
          },
          createdAt: now,
        },
        {
          eventId: `${operationId}:dispatch`,
          sessionId: request.sessionId,
          turnId: request.turnId,
          operationId: request.runOperationId,
          type: 'tool_dispatch_committed',
          schemaVersion: 1,
          modelVisible: false,
          partial: false,
          payload: intent,
          createdAt: now,
        },
      ],
      intent,
      operationState: pendingState,
      expectedStateVersion: runState.stateVersion,
      preparedAt: now,
    })
    const verdict = store.resolveToolRecovery(operationId)
    if (!verdict) throw new Error(`Tool operation ${operationId} did not become durable`)
    return {
      operationId,
      idempotencyKey: operationId,
      canonicalArgsHash,
      recoveryMode,
      created: result.created,
      status: verdict.kind,
      committedSeq: result.eventSeqs.at(-1) ?? 0,
    }
  }

  async commitToolOutcome(
    workspaceRootPath: string,
    request: DurableToolOutcomeRequest,
  ): Promise<DurableToolOutcomeResponse> {
    const store = this.storeFor(workspaceRootPath)
    const runState = store.getOperation(request.runOperationId)
    if (!runState) throw new Error(`Durable run ${request.runOperationId} is not open`)
    const currentTool = (runState.data as { currentTool?: { operationId?: string } }).currentTool
    if (currentTool?.operationId !== request.operationId) {
      throw new Error(`Durable run ${request.runOperationId} is not awaiting ${request.operationId}`)
    }
    const outcome: ToolOutcome = {
      runOperationId: request.runOperationId,
      operationId: request.operationId,
      providerToolCallId: request.providerToolCallId,
      toolName: request.toolName,
      canonicalArgsHash: request.canonicalArgsHash,
      result: redactDurablePayload(request.result),
      isError: request.isError,
      externalReference: request.externalReference,
    }
    const now = Date.now()
    const checkpoint = nextState(runState, 'checkpoint', { currentTool: null }, now)
    const result = store.commitToolOutcome({
      events: [{
        eventId: `${request.operationId}:outcome`,
        sessionId: request.sessionId,
        turnId: request.turnId,
        operationId: request.runOperationId,
        type: 'tool_outcome_committed',
        schemaVersion: 1,
        modelVisible: true,
        partial: false,
        payload: outcome,
        createdAt: now,
      }],
      outcome,
      operationState: checkpoint,
      expectedStateVersion: runState.stateVersion,
      settledAt: now,
    })
    return { committedSeq: result.eventSeqs.at(-1) ?? 0 }
  }

  completeRun(
    workspaceRootPath: string,
    operationId: string,
    reason: 'complete' | 'interrupted' | 'error' | 'timeout',
  ): void {
    const store = this.storeFor(workspaceRootPath)
    const state = store.getOperation(operationId)
    if (!state) return
    const now = Date.now()
    const unsettled = store.listUnsettledToolOperations(operationId)
    if (unsettled.length > 0) {
      const parked = nextState(state, 'recovery_parked', {
        unsettledToolOperationIds: unsettled.map(item => item.dispatch?.operationId).filter(Boolean),
        stopReason: reason,
      }, now)
      store.commitOperationAccepted([{
        eventId: `${operationId}:recovery-parked`,
        sessionId: state.sessionId,
        turnId: state.turnId,
        operationId,
        type: 'tool_recovery_decided',
        schemaVersion: 1,
        modelVisible: false,
        partial: false,
        payload: { verdict: 'reconcile_required', reason: 'Run stopped with an unsettled tool effect' },
        createdAt: now,
      }], parked)
      return
    }
    const currentModel = (state.data as { currentModel?: { operationId?: string } }).currentModel
    if (state.phase === 'model_effect_pending' && currentModel?.operationId) {
      const parked = nextState(state, 'recovery_parked', {
        ...(typeof state.data === 'object' && state.data !== null ? state.data : {}),
        unsettledModelOperationId: currentModel.operationId,
        stopReason: reason,
      }, now)
      store.commitOperationAccepted([{
        eventId: `${currentModel.operationId}:recovery-parked`,
        sessionId: state.sessionId,
        turnId: state.turnId,
        operationId,
        type: 'model_recovery_decided',
        schemaVersion: 1,
        modelVisible: false,
        partial: false,
        payload: { verdict: 'indeterminate', reason: 'Run stopped with an unsettled provider request' },
        createdAt: now,
      }], parked)
      return
    }
    store.deleteOperation(operationId, {
      eventId: `${operationId}:terminal`,
      sessionId: state.sessionId,
      turnId: state.turnId,
      operationId,
      type: 'operation_terminal',
      schemaVersion: 1,
      modelVisible: false,
      partial: false,
      payload: { reason },
      createdAt: now,
    })
  }
}
