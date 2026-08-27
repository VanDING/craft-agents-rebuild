import { appendFileSync } from 'node:fs'
import { DurableRuntimeCoordinator } from './coordinator.js'

const [workspaceRootPath, mode, markerPath] = process.argv.slice(2)
if (!workspaceRootPath || !mode || !markerPath) {
  throw new Error('Expected workspace root, mode, and marker path')
}

const coordinator = new DurableRuntimeCoordinator()
coordinator.acceptRun({
  workspaceRootPath,
  sessionId: 'session-process-crash',
  turnId: 'turn-process-crash',
  operationId: 'run-process-crash',
  userMessageId: 'message-process-crash',
  userMessage: 'perform external effect',
})

if (mode === 'after-effect' || mode === 'after-t1' || mode === 'after-tool-t2') {
  const prepared = await coordinator.prepareTool(workspaceRootPath, {
    sessionId: 'session-process-crash',
    turnId: 'turn-process-crash',
    runOperationId: 'run-process-crash',
    providerToolCallId: 'call-process-crash',
    toolName: 'send_email',
    args: { to: 'recipient@example.com' },
  })
  if (mode !== 'after-t1') {
    // Simulate an external system accepting the effect after T1.
    appendFileSync(markerPath, `${prepared.operationId}\n`, { encoding: 'utf8', flush: true })
  }
  if (mode === 'after-tool-t2') {
    await coordinator.commitToolOutcome(workspaceRootPath, {
      sessionId: 'session-process-crash', turnId: 'turn-process-crash', runOperationId: 'run-process-crash',
      operationId: prepared.operationId, providerToolCallId: 'call-process-crash', toolName: 'send_email',
      canonicalArgsHash: prepared.canonicalArgsHash, result: { receipt: 'accepted' }, isError: false,
      externalReference: 'receipt-1',
    })
  }
  process.stdout.write(`${JSON.stringify({ ready: true, toolOperationId: prepared.operationId })}\n`)
} else if (mode === 'after-model-effect') {
  const prepared = await coordinator.prepareModel(workspaceRootPath, {
    sessionId: 'session-process-crash',
    turnId: 'turn-process-crash',
    runOperationId: 'run-process-crash',
    providerRequestId: '1',
    provider: 'test-provider',
    model: 'test-model',
    canonicalRequestHash: 'test-request-hash',
  })
  // Simulate the provider accepting a billable request after model T1 but before T2.
  appendFileSync(markerPath, `${prepared.operationId}\n`, { encoding: 'utf8', flush: true })
  process.stdout.write(`${JSON.stringify({ ready: true, modelOperationId: prepared.operationId })}\n`)
} else if (mode === 'after-model-t2') {
  const prepared = await coordinator.prepareModel(workspaceRootPath, {
    sessionId: 'session-process-crash', turnId: 'turn-process-crash', runOperationId: 'run-process-crash',
    providerRequestId: '1', provider: 'test-provider', model: 'test-model', canonicalRequestHash: 'test-request-hash',
  })
  appendFileSync(markerPath, `${prepared.operationId}\n`, { encoding: 'utf8', flush: true })
  await coordinator.commitModelOutcome(workspaceRootPath, {
    sessionId: 'session-process-crash', turnId: 'turn-process-crash', runOperationId: 'run-process-crash',
    operationId: prepared.operationId, providerRequestId: '1', provider: 'test-provider', model: 'test-model',
    canonicalRequestHash: 'test-request-hash', stopReason: 'stop', responseId: 'response-process-crash',
    content: [{ type: 'text', text: 'durable answer' }], text: 'durable answer',
    usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.1, payload: { usage: { input: 10, output: 2 } } },
  })
  process.stdout.write(`${JSON.stringify({ ready: true, modelOperationId: prepared.operationId })}\n`)
} else if (mode === 'before-t1') {
  process.stdout.write(`${JSON.stringify({ ready: true })}\n`)
} else {
  throw new Error(`Unknown crash fixture mode: ${mode}`)
}

// The parent test terminates this process at the requested crash boundary.
await new Promise(() => {})
