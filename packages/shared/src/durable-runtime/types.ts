export const DURABLE_TOOL_BOUNDARY_PROTOCOL = 't1_after_preflight_v1' as const

export type DurableToolBoundaryProtocol = typeof DURABLE_TOOL_BOUNDARY_PROTOCOL

export type ToolRecoveryMode =
  | 'safe_replay'
  | 'idempotent_keyed'
  | 'reconcilable'
  | 'never_auto_retry'

export type RuntimeEventType =
  | 'operation_accepted'
  | 'user_message_committed'
  | 'assistant_message_committed'
  | 'tool_call_observed'
  | 'tool_dispatch_committed'
  | 'tool_outcome_committed'
  | 'tool_recovery_decided'
  | 'usage_committed'
  | 'operation_terminal'

export interface RuntimeEvent<TPayload = unknown> {
  eventId: string
  seq?: number
  sessionId: string
  turnId?: string
  operationId: string
  type: RuntimeEventType
  schemaVersion: 1
  modelVisible: boolean
  partial: boolean
  payload: TPayload
  createdAt: number
}

export interface ToolDispatchIntent {
  protocol: DurableToolBoundaryProtocol
  /** Parent agent-turn/task operation whose program counter advances with this call. */
  runOperationId: string
  /** Stable identity of this individual external effect. */
  operationId: string
  providerToolCallId: string
  toolName: string
  canonicalArgsHash: string
  recoveryMode: ToolRecoveryMode
  idempotencyKey: string
}

export interface ToolOutcome {
  runOperationId: string
  operationId: string
  providerToolCallId: string
  toolName: string
  canonicalArgsHash: string
  isError: boolean
  result: unknown
  externalReference?: string
}

export type OperationPhase =
  | 'accepted'
  | 'model_effect_pending'
  | 'tool_planned'
  | 'tool_effect_pending'
  | 'checkpoint'
  | 'recovery_parked'
  | 'terminal'

export interface DurableOperationState<TData = unknown> {
  operationId: string
  sessionId: string
  turnId?: string
  kind: 'agent_turn' | 'task_node' | 'automation' | 'system'
  phase: OperationPhase
  stateVersion: number
  data: TData
  createdAt: number
  updatedAt: number
}

export interface ToolRecoveryEvidence {
  call?: {
    runOperationId: string
    operationId: string
    providerToolCallId: string
    toolName: string
    canonicalArgsHash: string
  }
  dispatch?: ToolDispatchIntent
  outcome?: ToolOutcome
  boundaryProtocol?: DurableToolBoundaryProtocol | 'legacy' | 'unknown'
}

export type ToolRecoveryVerdict =
  | { kind: 'completed'; outcome: ToolOutcome }
  | { kind: 'definitely_not_dispatched' }
  | { kind: 'reconcile_required'; dispatch: ToolDispatchIntent }
  | { kind: 'indeterminate'; reason: string }
  | { kind: 'corruption'; reason: string }

export interface ToolRecoveryDecisionPayload {
  verdict: ToolRecoveryVerdict['kind']
  reason?: string
  decidedAt: number
}

export interface DurableToolPrepareRequest {
  sessionId: string
  turnId?: string
  runOperationId: string
  providerToolCallId: string
  toolName: string
  args: Record<string, unknown>
  recoveryMode?: ToolRecoveryMode
}

export interface DurableToolPrepareResponse {
  operationId: string
  idempotencyKey: string
  canonicalArgsHash: string
  created: boolean
  status: ToolRecoveryVerdict['kind']
  /** Sequence of the last fact atomically committed at T1. */
  committedSeq: number
}

export interface DurableToolOutcomeResponse {
  /** Sequence of the last fact atomically committed at T2. */
  committedSeq: number
}

export interface DurableToolOutcomeRequest {
  sessionId: string
  turnId?: string
  runOperationId: string
  operationId: string
  providerToolCallId: string
  toolName: string
  canonicalArgsHash: string
  result: unknown
  isError: boolean
  externalReference?: string
}

export interface DurableToolBoundary {
  prepare(request: DurableToolPrepareRequest): Promise<DurableToolPrepareResponse>
  commitOutcome(request: DurableToolOutcomeRequest): Promise<DurableToolOutcomeResponse>
}
