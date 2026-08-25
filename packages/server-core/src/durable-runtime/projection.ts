import type { RuntimeEvent, ToolOutcome } from '@craft-agent/shared/durable-runtime'

export type DurableProjectionItem =
  | { kind: 'user'; eventId: string; seq: number; content: string }
  | { kind: 'assistant'; eventId: string; seq: number; content: string }
  | { kind: 'tool_call'; eventId: string; seq: number; toolOperationId: string; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { kind: 'tool_outcome'; eventId: string; seq: number; toolOperationId: string; toolCallId: string; toolName: string; result: unknown; isError: boolean }

export interface DurableSessionProjection {
  cursor: number
  items: DurableProjectionItem[]
}

/**
 * Rebuild a semantic session view from canonical facts only. Partial transport
 * fragments and internal control events can never leak into model context.
 */
export function projectDurableSession(events: RuntimeEvent[]): DurableSessionProjection {
  const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  const items: DurableProjectionItem[] = []
  let cursor = 0

  for (const event of ordered) {
    const seq = event.seq ?? 0
    cursor = Math.max(cursor, seq)
    if (!event.modelVisible || event.partial) continue

    if (event.type === 'user_message_committed' || event.type === 'assistant_message_committed') {
      const payload = event.payload as { content?: unknown }
      if (typeof payload.content !== 'string') continue
      items.push({
        kind: event.type === 'user_message_committed' ? 'user' : 'assistant',
        eventId: event.eventId,
        seq,
        content: payload.content,
      })
      continue
    }

    if (event.type === 'tool_call_observed') {
      const payload = event.payload as {
        toolOperationId?: unknown
        providerToolCallId?: unknown
        toolName?: unknown
        args?: unknown
      }
      if (typeof payload.toolOperationId !== 'string'
        || typeof payload.providerToolCallId !== 'string'
        || typeof payload.toolName !== 'string'
        || typeof payload.args !== 'object'
        || payload.args === null
        || Array.isArray(payload.args)) continue
      items.push({
        kind: 'tool_call',
        eventId: event.eventId,
        seq,
        toolOperationId: payload.toolOperationId,
        toolCallId: payload.providerToolCallId,
        toolName: payload.toolName,
        args: payload.args as Record<string, unknown>,
      })
      continue
    }

    if (event.type === 'tool_outcome_committed') {
      const outcome = event.payload as ToolOutcome
      if (!outcome.operationId || !outcome.providerToolCallId || !outcome.toolName) continue
      items.push({
        kind: 'tool_outcome',
        eventId: event.eventId,
        seq,
        toolOperationId: outcome.operationId,
        toolCallId: outcome.providerToolCallId,
        toolName: outcome.toolName,
        result: outcome.result,
        isError: outcome.isError,
      })
    }
  }

  return { cursor, items }
}

export function projectModelContext(events: RuntimeEvent[]): DurableProjectionItem[] {
  return projectDurableSession(events).items
}
