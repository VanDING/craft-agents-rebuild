import { describe, expect, test } from 'bun:test'
import { DURABLE_TOOL_BOUNDARY_PROTOCOL, type ToolRecoveryEvidence } from './types.js'
import { resolveToolRecovery } from './recovery.js'

const call = {
  runOperationId: 'run-1',
  operationId: 'op-1',
  providerToolCallId: 'call-1',
  toolName: 'send_email',
  canonicalArgsHash: 'hash-1',
}

const dispatch = {
  ...call,
  protocol: DURABLE_TOOL_BOUNDARY_PROTOCOL,
  recoveryMode: 'reconcilable' as const,
  idempotencyKey: 'op-1',
}

describe('resolveToolRecovery', () => {
  test('marks a matching outcome completed', () => {
    const outcome = { ...call, result: { messageId: 'm-1' }, isError: false }
    const evidence: ToolRecoveryEvidence = {
      call,
      dispatch,
      outcome,
    }
    expect(resolveToolRecovery(evidence)).toEqual({
      kind: 'completed',
      outcome,
    })
  })

  test('requires reconciliation after dispatch without an outcome', () => {
    expect(resolveToolRecovery({ call, dispatch })).toEqual({
      kind: 'reconcile_required',
      dispatch,
    })
  })

  test('proves non-dispatch only under the current boundary protocol', () => {
    expect(resolveToolRecovery({ call, boundaryProtocol: DURABLE_TOOL_BOUNDARY_PROTOCOL }))
      .toEqual({ kind: 'definitely_not_dispatched' })
  })

  test('fails closed for the same legacy evidence', () => {
    expect(resolveToolRecovery({ call, boundaryProtocol: 'legacy' }).kind)
      .toBe('indeterminate')
  })

  test('detects identity and argument mismatches', () => {
    expect(resolveToolRecovery({
      call,
      dispatch: { ...dispatch, canonicalArgsHash: 'different' },
    }).kind).toBe('corruption')
  })
})
