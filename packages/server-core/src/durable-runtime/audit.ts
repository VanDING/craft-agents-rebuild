import type { Message } from '@craft-agent/core/types'
import type { RuntimeEvent, ToolOutcome } from '@craft-agent/shared/durable-runtime'

export interface ProjectionAuditIssue {
  kind: 'missing_legacy_message' | 'legacy_cursor_ahead' | 'outcome_not_reflected'
  identity: string
  durableSeq?: number
}

/** Compare the canonical fact log with the legacy JSONL/UI cache. Read-only. */
export function auditLegacyProjection(events: RuntimeEvent[], messages: Message[]): ProjectionAuditIssue[] {
  const issues: ProjectionAuditIssue[] = []
  const byMessageId = new Map(messages.map(message => [message.id, message]))
  const byToolCallId = new Map(messages.filter(message => message.toolUseId).map(message => [message.toolUseId!, message]))
  const maxSeq = Math.max(0, ...events.map(event => event.seq ?? 0))

  for (const event of events) {
    if (event.type === 'user_message_committed' || event.type === 'assistant_message_committed') {
      const messageId = (event.payload as { messageId?: unknown }).messageId
      if (typeof messageId === 'string' && !byMessageId.has(messageId)) {
        issues.push({ kind: 'missing_legacy_message', identity: messageId, durableSeq: event.seq })
      }
    } else if (event.type === 'tool_call_observed') {
      const toolCallId = (event.payload as { providerToolCallId?: unknown }).providerToolCallId
      if (typeof toolCallId === 'string' && !byToolCallId.has(toolCallId)) {
        issues.push({ kind: 'missing_legacy_message', identity: toolCallId, durableSeq: event.seq })
      }
    } else if (event.type === 'tool_outcome_committed') {
      const outcome = event.payload as ToolOutcome
      const message = byToolCallId.get(outcome.providerToolCallId)
      if (message && message.toolStatus !== 'completed' && message.toolStatus !== 'error') {
        issues.push({ kind: 'outcome_not_reflected', identity: outcome.providerToolCallId, durableSeq: event.seq })
      }
    }
  }

  for (const message of messages) {
    if ((message.durableSeq ?? 0) > maxSeq) {
      issues.push({ kind: 'legacy_cursor_ahead', identity: message.id, durableSeq: message.durableSeq })
    }
  }
  return issues
}
