import type { DurableCanonicalContextItem, RuntimeEvent, ToolOutcome } from '@craft-agent/shared/durable-runtime'
import type { Message } from '@craft-agent/core/types'
import type { RuntimeUsageRow } from './store.js'

export type DurableProjectionItem = DurableCanonicalContextItem

export interface DurableSessionProjection {
  cursor: number
  items: DurableProjectionItem[]
}

export interface DurableWorkspaceSessionProjection {
  sessions: Record<string, DurableSessionProjection>
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

    if (event.type === 'legacy_context_imported') {
      const payload = event.payload as {
        kind?: unknown; content?: unknown; toolCallId?: unknown
        toolName?: unknown; args?: unknown; result?: unknown; isError?: unknown; hasOutcome?: unknown
      }
      if ((payload.kind === 'user' || payload.kind === 'assistant') && typeof payload.content === 'string') {
        items.push({ kind: payload.kind, eventId: event.eventId, seq, operationId: event.operationId, content: payload.content })
      } else if (payload.kind === 'tool' && typeof payload.toolCallId === 'string' && typeof payload.toolName === 'string') {
        items.push({
          kind: 'tool_call', eventId: `${event.eventId}:call`, seq, operationId: event.operationId,
          toolOperationId: `legacy:${payload.toolCallId}`, toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          args: payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args) ? payload.args as Record<string, unknown> : {},
        })
        if (payload.hasOutcome === true) items.push({
          kind: 'tool_outcome', eventId: `${event.eventId}:outcome`, seq, operationId: event.operationId,
          toolOperationId: `legacy:${payload.toolCallId}`, toolCallId: payload.toolCallId,
          toolName: payload.toolName, result: payload.result, isError: payload.isError === true,
        })
      }
      continue
    }

    if (event.type === 'user_message_committed' || event.type === 'assistant_message_committed') {
      const payload = event.payload as { content?: unknown }
      if (typeof payload.content !== 'string') continue
      items.push({
        kind: event.type === 'user_message_committed' ? 'user' : 'assistant',
        eventId: event.eventId,
        seq,
        operationId: event.operationId,
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
        operationId: event.operationId,
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
        operationId: event.operationId,
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

/**
 * Reorder and overwrite the model-visible portion of the rich legacy UI cache
 * from canonical facts. Rich UI-only metadata remains a compatibility overlay;
 * execution order, content, tool input and settled outcome come from runtime.db.
 */
export function projectCanonicalSessionMessages(events: RuntimeEvent[], legacy: Message[]): Message[] {
  const byMessageId = new Map(legacy.map(message => [message.id, message]))
  const byToolCallId = new Map(legacy.filter(message => message.toolUseId).map(message => [message.toolUseId!, message]))
  const canonical: Message[] = []
  const canonicalToolIndex = new Map<string, number>()
  const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))

  for (const event of ordered) {
    if (!event.modelVisible || event.partial) continue
    if (event.type === 'legacy_context_imported') {
      const payload = event.payload as {
        kind?: unknown; messageId?: unknown; content?: unknown; toolCallId?: unknown
        toolName?: unknown; args?: unknown; result?: unknown; isError?: unknown; hasOutcome?: unknown
      }
      if ((payload.kind === 'user' || payload.kind === 'assistant') && typeof payload.messageId === 'string' && typeof payload.content === 'string') {
        const cached = byMessageId.get(payload.messageId)
        if (cached) canonical.push({ ...cached, content: payload.content, durableOperationId: event.operationId, durableSeq: event.seq })
      } else if (payload.kind === 'tool' && typeof payload.toolCallId === 'string' && typeof payload.toolName === 'string') {
        const cached = byToolCallId.get(payload.toolCallId)
        if (cached) {
          canonicalToolIndex.set(payload.toolCallId, canonical.length)
          canonical.push({
            ...cached,
            toolName: payload.toolName,
            toolInput: payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args) ? payload.args as Record<string, unknown> : cached.toolInput,
            toolResult: payload.hasOutcome === true
              ? (typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result))
              : cached.toolResult,
            toolStatus: payload.hasOutcome === true ? (payload.isError === true ? 'error' : 'completed') : cached.toolStatus,
            isError: payload.hasOutcome === true ? payload.isError === true : cached.isError,
            durableOperationId: event.operationId,
            durableSeq: event.seq,
          })
        }
      }
      continue
    }

    if (event.type === 'user_message_committed' || event.type === 'assistant_message_committed') {
      const payload = event.payload as { messageId?: unknown; content?: unknown }
      if (typeof payload.messageId !== 'string' || typeof payload.content !== 'string') continue
      const cached = byMessageId.get(payload.messageId)
      if (!cached) continue
      canonical.push({
        ...cached,
        role: event.type === 'user_message_committed' ? 'user' : 'assistant',
        content: payload.content,
        durableOperationId: event.operationId,
        durableSeq: event.seq,
      })
      continue
    }
    if (event.type === 'tool_call_observed') {
      const payload = event.payload as { providerToolCallId?: unknown; toolName?: unknown; args?: unknown; toolOperationId?: unknown }
      if (typeof payload.providerToolCallId !== 'string' || typeof payload.toolName !== 'string') continue
      const cached = byToolCallId.get(payload.providerToolCallId)
      if (!cached) continue
      canonicalToolIndex.set(payload.providerToolCallId, canonical.length)
      canonical.push({
        ...cached,
        toolUseId: payload.providerToolCallId,
        toolName: payload.toolName,
        toolInput: payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args)
          ? payload.args as Record<string, unknown>
          : cached.toolInput,
        durableOperationId: typeof payload.toolOperationId === 'string' ? payload.toolOperationId : cached.durableOperationId,
        durableSeq: event.seq,
      })
      continue
    }
    if (event.type === 'tool_outcome_committed') {
      const outcome = event.payload as ToolOutcome
      const index = canonicalToolIndex.get(outcome.providerToolCallId)
      if (index === undefined) continue
      const cached = canonical[index]!
      canonical[index] = {
        ...cached,
        toolResult: typeof outcome.result === 'string' ? outcome.result : JSON.stringify(outcome.result),
        toolStatus: outcome.isError ? 'error' : 'completed',
        isError: outcome.isError,
        durableOperationId: outcome.operationId,
        durableSeq: event.seq,
      }
    }
  }

  // Preserve UI-only messages (warnings, plans, status/compaction records) in
  // their existing slots while replacing semantic slots in canonical order.
  let semanticIndex = 0
  const merged: Message[] = []
  for (const message of legacy) {
    const modelVisible = message.role === 'user' || message.role === 'assistant' || Boolean(message.toolUseId)
    if (modelVisible) {
      const replacement = canonical[semanticIndex++]
      if (replacement) merged.push(replacement)
    } else {
      merged.push(message)
    }
  }
  merged.push(...canonical.slice(semanticIndex))
  return merged
}

export function reduceWorkspaceSessionProjection(
  previous: DurableWorkspaceSessionProjection,
  events: RuntimeEvent[],
): DurableWorkspaceSessionProjection {
  const sessions = { ...previous.sessions }
  const grouped = new Map<string, RuntimeEvent[]>()
  for (const event of events) {
    const group = grouped.get(event.sessionId) ?? []
    group.push(event)
    grouped.set(event.sessionId, group)
  }
  for (const [sessionId, sessionEvents] of grouped) {
    const prior = sessions[sessionId] ?? { cursor: 0, items: [] }
    const delta = projectDurableSession(sessionEvents)
    sessions[sessionId] = {
      cursor: Math.max(prior.cursor, delta.cursor),
      items: [...prior.items, ...delta.items],
    }
  }
  return { sessions }
}

export interface DurableUsageProjection {
  attempts: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  cacheReadTokens: number
  cacheCreationTokens: number
  lastFullUsage?: unknown
}

/** Rebuild UI token/cost totals exclusively from deduplicated usage facts. */
export function projectDurableUsage(rows: RuntimeUsageRow[]): DurableUsageProjection {
  const ordered = [...rows].sort((left, right) =>
    left.createdAt - right.createdAt || left.usageId.localeCompare(right.usageId))
  const last = ordered.at(-1)
  const lastPayload = last?.payload && typeof last.payload === 'object'
    ? last.payload as { usage?: { cacheRead?: number; cacheWrite?: number } }
    : undefined
  const inputTokens = last?.inputTokens ?? 0
  const outputTokens = ordered.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0)
  return {
    attempts: ordered.length,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: ordered.reduce((sum, item) => sum + (item.costUsd ?? 0), 0),
    cacheReadTokens: lastPayload?.usage?.cacheRead ?? 0,
    cacheCreationTokens: lastPayload?.usage?.cacheWrite ?? 0,
    lastFullUsage: lastPayload?.usage,
  }
}
