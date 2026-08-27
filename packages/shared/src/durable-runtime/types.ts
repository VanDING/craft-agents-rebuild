export const DURABLE_TOOL_BOUNDARY_PROTOCOL = 't1_after_preflight_v1' as const

export type DurableToolBoundaryProtocol = typeof DURABLE_TOOL_BOUNDARY_PROTOCOL

export type ToolRecoveryMode =
  | 'safe_replay'
  | 'idempotent_keyed'
  | 'reconcilable'
  | 'never_auto_retry'

export type RuntimeEventType =
  | 'operation_accepted'
  | 'model_dispatch_committed'
  | 'model_outcome_committed'
  | 'model_recovery_decided'
  | 'user_message_committed'
  | 'assistant_message_committed'
  | 'tool_call_observed'
  | 'tool_dispatch_committed'
  | 'tool_outcome_committed'
  | 'tool_recovery_decided'
  | 'usage_committed'
  | 'task_fact_committed'
  | 'legacy_context_imported'
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
  kind: 'agent_turn' | 'task_run' | 'task_node' | 'automation' | 'system'
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

/** Read-only recovery state exposed to trusted runtime clients for diagnosis. */
export interface DurableRecoveryEvidenceSnapshot {
  sessionId: string
  runOperation: DurableOperationState
  evidence: ToolRecoveryEvidence
  verdict: ToolRecoveryVerdict
}

export interface ToolRecoveryDecisionPayload {
  verdict: ToolRecoveryVerdict['kind']
  reason?: string
  decidedAt: number
}

export type ToolReconciliationDecision =
  | 'completed'
  | 'definitely_not_executed'
  | 'failed'
  | 'manual_abandon'

export interface ToolReconciliationEvidenceRecord {
  source: 'external_query' | 'operator_observation' | 'provider_receipt' | 'other'
  summary: string
  observedAt: number
  externalReference?: string
  payload?: unknown
}

export interface ToolReconciliationRequest {
  sessionId: string
  toolOperationId: string
  decision: ToolReconciliationDecision
  reason: string
  actor: {
    type: 'user' | 'administrator' | 'system'
    id: string
  }
  evidence: ToolReconciliationEvidenceRecord[]
  result?: unknown
  externalReference?: string
}

export interface ToolReconciliationResult {
  committedSeq: number
  snapshot: DurableRecoveryEvidenceSnapshot
}

export interface ToolReconciliationAdapter {
  queryExternal(input: {
    operationId: string
    idempotencyKey: string
    toolName?: string
    args?: Record<string, unknown>
    externalReference?: string
  }): Promise<{
    decision: Exclude<ToolReconciliationDecision, 'manual_abandon'>
    reason: string
    evidence: ToolReconciliationEvidenceRecord[]
    result?: unknown
    externalReference?: string
  }>
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
  recoveryMode: ToolRecoveryMode
  created: boolean
  status: ToolRecoveryVerdict['kind']
  /** Sequence of the last fact atomically committed at T1. */
  committedSeq: number
}

/** Stable identity injected into native/MCP/API tool execution contexts. */
export interface DurableToolExecutionIdentity {
  operationId: string
  runOperationId: string
  idempotencyKey: string
  canonicalArgsHash: string
  recoveryMode: ToolRecoveryMode
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

export interface DurableModelPrepareRequest {
  sessionId: string
  turnId?: string
  runOperationId: string
  providerRequestId: string
  provider: string
  model: string
  canonicalRequestHash: string
}

export interface DurableModelPrepareResponse {
  operationId: string
  idempotencyKey: string
  created: boolean
  status: 'effect_pending' | 'outcome_committed'
  committedSeq: number
}

export interface DurableModelOutcomeRequest {
  sessionId: string
  turnId?: string
  runOperationId: string
  operationId: string
  providerRequestId: string
  provider: string
  model: string
  canonicalRequestHash: string
  stopReason: string
  responseId?: string
  content: unknown
  text?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    costUsd?: number
    payload?: unknown
  }
}

export interface DurableModelOutcomeResponse {
  committedSeq: number
}

export interface DurableModelBoundary {
  prepare(request: DurableModelPrepareRequest): Promise<DurableModelPrepareResponse>
  commitOutcome(request: DurableModelOutcomeRequest): Promise<DurableModelOutcomeResponse>
}

export type ModelReconciliationDecision =
  | 'provider_not_billed'
  | 'billed_response_unavailable'
  | 'manual_abandon'

export interface ModelReconciliationRequest {
  sessionId: string
  modelOperationId: string
  decision: ModelReconciliationDecision
  reason: string
  actor: ToolReconciliationRequest['actor']
  evidence: ToolReconciliationEvidenceRecord[]
}

export interface ModelReconciliationResult {
  committedSeq: number
  operationState: DurableOperationState
}

export type DurableCanonicalContextItem =
  | { kind: 'user'; eventId: string; seq: number; operationId: string; content: string }
  | { kind: 'assistant'; eventId: string; seq: number; operationId: string; content: string }
  | { kind: 'tool_call'; eventId: string; seq: number; operationId: string; toolOperationId: string; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { kind: 'tool_outcome'; eventId: string; seq: number; operationId: string; toolOperationId: string; toolCallId: string; toolName: string; result: unknown; isError: boolean }

export interface DurableCanonicalModelContext {
  cursor: number
  items: DurableCanonicalContextItem[]
}
