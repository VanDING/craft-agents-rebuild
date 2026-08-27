import {
  DURABLE_TOOL_BOUNDARY_PROTOCOL,
  type ToolDispatchIntent,
  type ToolOutcome,
  type ToolRecoveryEvidence,
  type ToolRecoveryVerdict,
} from './types.js'

type ToolIdentity = {
  runOperationId: string
  operationId: string
  providerToolCallId: string
  toolName: string
  canonicalArgsHash: string
}

function identityMatches(
  left: ToolIdentity,
  right: ToolIdentity,
): boolean {
  return left.operationId === right.operationId
    && left.runOperationId === right.runOperationId
    && left.providerToolCallId === right.providerToolCallId
    && left.toolName === right.toolName
    && left.canonicalArgsHash === right.canonicalArgsHash
}

export function resolveToolRecovery(evidence: ToolRecoveryEvidence): ToolRecoveryVerdict {
  const { call, dispatch, outcome } = evidence

  if (dispatch && dispatch.protocol !== DURABLE_TOOL_BOUNDARY_PROTOCOL) {
    return { kind: 'corruption', reason: `Unsupported dispatch protocol: ${dispatch.protocol}` }
  }

  if (dispatch && call && !identityMatches(dispatch, call)) {
    return { kind: 'corruption', reason: 'Tool call and dispatch identity do not match' }
  }

  if (outcome) {
    const source = dispatch ?? call
    if (!source) {
      return { kind: 'corruption', reason: 'Tool outcome has no matching call or dispatch' }
    }
    if (!identityMatches(source, outcome)) {
      return { kind: 'corruption', reason: 'Tool outcome identity does not match its source' }
    }
    return { kind: 'completed', outcome }
  }

  if (dispatch) {
    return { kind: 'reconcile_required', dispatch }
  }

  if (call && evidence.boundaryProtocol === DURABLE_TOOL_BOUNDARY_PROTOCOL) {
    return { kind: 'definitely_not_dispatched' }
  }

  if (call) {
    return {
      kind: 'indeterminate',
      reason: 'Legacy or unknown boundary protocol cannot prove that the tool was not dispatched',
    }
  }

  return { kind: 'corruption', reason: 'Recovery evidence contains no tool call' }
}
