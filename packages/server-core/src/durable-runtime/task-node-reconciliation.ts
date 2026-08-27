import type { ToolReconciliationAdapter } from '@craft-agent/shared/durable-runtime'

export interface ReconciliationTaskChild {
  id: string
  taskSlug?: string
  taskRunId?: string
  taskNodeId?: string
  messages: Array<{ id: string; role: string }>
}

export function createTaskNodeReconciliationAdapter(
  listSessions: () => ReconciliationTaskChild[],
  ensureLoaded: (session: ReconciliationTaskChild) => Promise<void>,
): ToolReconciliationAdapter {
  return {
    queryExternal: async ({ args }) => {
      const taskSlug = typeof args?.taskSlug === 'string' ? args.taskSlug : undefined
      const runId = typeof args?.runId === 'string' ? args.runId : undefined
      const nodeId = typeof args?.nodeId === 'string' ? args.nodeId : undefined
      if (!taskSlug || !runId || !nodeId) {
        throw new Error('task_node_dispatch reconciliation is missing canonical task identity')
      }
      const matches = listSessions().filter(session =>
        session.taskSlug === taskSlug && session.taskRunId === runId && session.taskNodeId === nodeId)
      if (matches.length > 1) {
        throw new Error(`task_node_dispatch reconciliation found ${matches.length} child sessions; operator review is required`)
      }
      const observedAt = Date.now()
      const child = matches[0]
      if (child) {
        await ensureLoaded(child)
        const dispatchedMessage = child.messages.find(message => message.role === 'user')
        if (!dispatchedMessage) {
          throw new Error(`task_node_dispatch found child session ${child.id} without a committed input message; operator review is required`)
        }
        return {
          decision: 'completed',
          reason: 'The authoritative session registry contains the dispatched task child and its committed input',
          evidence: [{
            source: 'external_query',
            summary: `Found child session ${child.id} with committed input ${dispatchedMessage.id} for ${taskSlug}/${runId}/${nodeId}`,
            observedAt,
            externalReference: child.id,
          }],
          result: { childSessionId: child.id, userMessageId: dispatchedMessage.id },
          externalReference: child.id,
        }
      }
      return {
        decision: 'definitely_not_executed',
        reason: 'The fully loaded authoritative session registry contains no matching task child',
        evidence: [{
          source: 'external_query',
          summary: `No child session exists for ${taskSlug}/${runId}/${nodeId}`,
          observedAt,
        }],
        result: { childSessionId: null },
      }
    },
  }
}
