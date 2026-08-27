import { createHash } from 'node:crypto'
import {
  DURABLE_TOOL_BOUNDARY_PROTOCOL,
  type DurableOperationState,
  type RuntimeEvent,
  type ToolDispatchIntent,
  type ToolOutcome,
  type ToolRecoveryMode,
} from '@craft-agent/shared/durable-runtime'
import { canonicalJson } from './canonical-json.js'
import { DurableRuntimeStore, type RuntimeUsageRow } from './store.js'

export interface DurableToolEffectResult<TResult = unknown> {
  result: TResult
  isError?: boolean
  externalReference?: string
  usage?: RuntimeUsageRow[]
}
export interface DurableToolExecutionContext<TArgs> {
  operationId: string
  runOperationId: string
  idempotencyKey: string
  args: TArgs
}

export interface DurableToolExecutionInput<TArgs, TResult> {
  sessionId: string
  turnId?: string
  runState: DurableOperationState
  providerToolCallId: string
  toolName: string
  args: TArgs
  recoveryMode?: ToolRecoveryMode
  execute(context: DurableToolExecutionContext<TArgs>): Promise<DurableToolEffectResult<TResult>>
}

export interface DurableToolExecutionResult<TResult> {
  outcome: ToolOutcome & { result: TResult }
  runState: DurableOperationState
  replayed: boolean
}

export interface DurableToolDispatcherOptions {
  now?: () => number
  /** Fault-injection seam. Throwing here simulates a crash after the effect and before T2. */
  afterEffect?: (outcome: ToolOutcome) => void | Promise<void>
}

export class ToolRecoveryRequiredError extends Error {
  constructor(readonly operationId: string) {
    super(`Tool operation ${operationId} has an uncertain durable effect and requires reconciliation`)
    this.name = 'ToolRecoveryRequiredError'
  }
}

export function canonicalToolArgsHash(toolName: string, args: unknown): string {
  return createHash('sha256').update(canonicalJson({ toolName, args })).digest('hex')
}

export function durableToolOperationId(runOperationId: string, providerToolCallId: string): string {
  const digest = createHash('sha256')
    .update(canonicalJson([runOperationId, providerToolCallId]))
    .digest('hex')
    .slice(0, 32)
  return `toolop_${digest}`
}

function advanceState(
  state: DurableOperationState,
  phase: DurableOperationState['phase'],
  unsettledToolOperationIds: string[],
  now: number,
): DurableOperationState {
  const previousData = state.data && typeof state.data === 'object'
    ? state.data as Record<string, unknown>
    : { previousData: state.data }
  const { currentTool: _legacyCurrentTool, unsettledToolOperationIds: _previousIds, ...rest } = previousData
  return {
    ...state,
    phase,
    stateVersion: state.stateVersion + 1,
    data: unsettledToolOperationIds.length > 0
      ? { ...rest, unsettledToolOperationIds }
      : rest,
    updatedAt: now,
  }
}

function errorResult(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class DurableToolDispatcher {
  private readonly now: () => number

  constructor(
    private readonly store: DurableRuntimeStore,
    private readonly options: DurableToolDispatcherOptions = {},
  ) {
    this.now = options.now ?? Date.now
  }

  async execute<TArgs, TResult>(
    input: DurableToolExecutionInput<TArgs, TResult>,
  ): Promise<DurableToolExecutionResult<TResult>> {
    if (input.runState.operationId.length === 0) throw new Error('Durable run operation ID is required')
    if (input.runState.sessionId !== input.sessionId) throw new Error('Durable run state belongs to another session')

    const operationId = durableToolOperationId(input.runState.operationId, input.providerToolCallId)
    const canonicalArgsHash = canonicalToolArgsHash(input.toolName, input.args)
    const intent: ToolDispatchIntent = {
      protocol: DURABLE_TOOL_BOUNDARY_PROTOCOL,
      runOperationId: input.runState.operationId,
      operationId,
      providerToolCallId: input.providerToolCallId,
      toolName: input.toolName,
      canonicalArgsHash,
      recoveryMode: input.recoveryMode ?? 'never_auto_retry',
      idempotencyKey: operationId,
    }
    const preparedAt = this.now()
    const pendingState = advanceState(input.runState, 'tool_effect_pending', [operationId], preparedAt)
    const events: RuntimeEvent[] = [
      {
        eventId: `${operationId}:call`,
        sessionId: input.sessionId,
        turnId: input.turnId,
        operationId: input.runState.operationId,
        type: 'tool_call_observed',
        schemaVersion: 1,
        modelVisible: true,
        partial: false,
        payload: {
          toolOperationId: operationId,
          providerToolCallId: input.providerToolCallId,
          toolName: input.toolName,
          args: input.args,
        },
        createdAt: preparedAt,
      },
      {
        eventId: `${operationId}:dispatch`,
        sessionId: input.sessionId,
        turnId: input.turnId,
        operationId: input.runState.operationId,
        type: 'tool_dispatch_committed',
        schemaVersion: 1,
        modelVisible: false,
        partial: false,
        payload: intent,
        createdAt: preparedAt,
      },
    ]

    const prepared = this.store.commitToolPrepared({
      events,
      intent,
      operationState: pendingState,
      expectedStateVersion: input.runState.stateVersion,
      preparedAt,
    })
    if (!prepared.created) {
      const verdict = this.store.resolveToolRecovery(operationId)
      if (verdict?.kind === 'completed') {
        return {
          outcome: verdict.outcome as ToolOutcome & { result: TResult },
          runState: this.store.getOperation(input.runState.operationId) ?? pendingState,
          replayed: true,
        }
      }
      throw new ToolRecoveryRequiredError(operationId)
    }

    let effect: DurableToolEffectResult<TResult>
    try {
      effect = await input.execute({
        operationId,
        runOperationId: input.runState.operationId,
        idempotencyKey: operationId,
        args: input.args,
      })
    } catch (error) {
      effect = { result: errorResult(error) as TResult, isError: true }
    }

    const outcome: ToolOutcome & { result: TResult } = {
      runOperationId: input.runState.operationId,
      operationId,
      providerToolCallId: input.providerToolCallId,
      toolName: input.toolName,
      canonicalArgsHash,
      isError: effect.isError ?? false,
      result: effect.result,
      externalReference: effect.externalReference,
    }
    await this.options.afterEffect?.(outcome)

    const settledAt = this.now()
    const nextState = advanceState(pendingState, 'checkpoint', [], settledAt)
    const outcomeEvent: RuntimeEvent = {
      eventId: `${operationId}:outcome`,
      sessionId: input.sessionId,
      turnId: input.turnId,
      operationId: input.runState.operationId,
      type: 'tool_outcome_committed',
      schemaVersion: 1,
      modelVisible: true,
      partial: false,
      payload: outcome,
      createdAt: settledAt,
    }
    this.store.commitToolOutcome({
      events: [outcomeEvent],
      outcome,
      operationState: nextState,
      expectedStateVersion: pendingState.stateVersion,
      usage: effect.usage,
      settledAt,
    })
    return { outcome, runState: nextState, replayed: false }
  }
}
