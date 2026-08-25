import {
  DURABLE_TOOL_BOUNDARY_PROTOCOL,
  type DurableOperationState,
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
import { DurableRuntimeStore } from './store.js'

const SAFE_REPLAY_TOOLS = new Set([
  'read', 'grep', 'find', 'ls', 'websearch', 'web_search', 'webfetch', 'web_fetch',
])

export function defaultToolRecoveryMode(toolName: string): ToolRecoveryMode {
  const normalized = toolName.replace(/^mcp__[^_]+__/, '').toLowerCase()
  return SAFE_REPLAY_TOOLS.has(normalized) ? 'safe_replay' : 'never_auto_retry'
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
  acceptedAt?: number
}

export interface DurableRecoveryItem {
  operationId: string
  sessionId: string
  action: 'parked_unknown_effect' | 'terminalized_interrupted' | 'already_parked'
  unsettledToolOperationIds: string[]
}

export interface DurableRecoveryReport {
  workspaceRootPath: string
  recoveredAt: number
  items: DurableRecoveryItem[]
}

export class DurableRuntimeCoordinator {
  private readonly stores = new Map<string, DurableRuntimeStore>()

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
      data: { userMessageId: input.userMessageId },
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
        modelVisible: true,
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
    createdAt?: number
  }): number {
    const store = this.storeFor(input.workspaceRootPath)
    const state = store.getOperation(input.operationId)
    if (!state) throw new Error(`Durable run ${input.operationId} is not open`)
    if (state.sessionId !== input.sessionId) throw new Error('Durable run belongs to another session')
    const createdAt = input.createdAt ?? Date.now()
    return store.appendEvents([{
      eventId: `${input.operationId}:assistant:${input.messageId}`,
      sessionId: input.sessionId,
      turnId: input.turnId,
      operationId: input.operationId,
      type: 'assistant_message_committed',
      schemaVersion: 1,
      modelVisible: true,
      partial: false,
      payload: { messageId: input.messageId, content: input.content },
      createdAt,
    }])[0] ?? 0
  }

  boundaryFor(workspaceRootPath: string): DurableToolBoundary {
    return {
      prepare: request => this.prepareTool(workspaceRootPath, request),
      commitOutcome: request => this.commitToolOutcome(workspaceRootPath, request),
    }
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
            args: request.args,
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
      result: request.result,
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
