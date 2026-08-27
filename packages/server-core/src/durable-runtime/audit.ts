import type { Message } from '@craft-agent/core/types'
import type { RuntimeEvent, ToolOutcome } from '@craft-agent/shared/durable-runtime'

export interface ProjectionAuditIssue {
  kind: 'missing_legacy_message' | 'legacy_fact_missing' | 'legacy_cursor_ahead' | 'outcome_not_reflected'
  identity: string
  durableSeq?: number
}

export interface ProjectionParityReport {
  canonicalFacts: number
  legacyMessages: number
  issueCount: number
  issueCounts: Record<ProjectionAuditIssue['kind'], number>
  parityRatio: number
  issues: ProjectionAuditIssue[]
}

/** Compare the canonical fact log with the legacy JSONL/UI cache. Read-only. */
export function auditLegacyProjection(events: RuntimeEvent[], messages: Message[]): ProjectionAuditIssue[] {
  const issues: ProjectionAuditIssue[] = []
  const byMessageId = new Map(messages.map(message => [message.id, message]))
  const byToolCallId = new Map(messages.filter(message => message.toolUseId).map(message => [message.toolUseId!, message]))
  const maxSeq = Math.max(0, ...events.map(event => event.seq ?? 0))

  for (const event of events) {
    if (event.type === 'legacy_context_imported') {
      const payload = event.payload as { messageId?: unknown; toolCallId?: unknown }
      const identity = typeof payload.toolCallId === 'string' ? payload.toolCallId : payload.messageId
      const exists = typeof payload.toolCallId === 'string'
        ? byToolCallId.has(payload.toolCallId)
        : typeof payload.messageId === 'string' && byMessageId.has(payload.messageId)
      if (typeof identity === 'string' && !exists) {
        issues.push({ kind: 'missing_legacy_message', identity, durableSeq: event.seq })
      }
      continue
    }
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
    const modelVisibleLegacy = message.role === 'user' || message.role === 'assistant' || !!message.toolUseId
    if (modelVisibleLegacy) {
      const represented = message.toolUseId
        ? events.some(event => (event.type === 'tool_call_observed'
          && (event.payload as { providerToolCallId?: unknown }).providerToolCallId === message.toolUseId)
          || (event.type === 'legacy_context_imported'
            && (event.payload as { toolCallId?: unknown }).toolCallId === message.toolUseId))
        : events.some(event => ((event.type === 'user_message_committed' || event.type === 'assistant_message_committed')
          && (event.payload as { messageId?: unknown }).messageId === message.id)
          || (event.type === 'legacy_context_imported'
            && (event.payload as { messageId?: unknown }).messageId === message.id))
      if (!represented) issues.push({ kind: 'legacy_fact_missing', identity: message.toolUseId ?? message.id })
    }
    if ((message.durableSeq ?? 0) > maxSeq) {
      issues.push({ kind: 'legacy_cursor_ahead', identity: message.id, durableSeq: message.durableSeq })
    }
  }
  return issues
}

/** Structured shadow-read metric suitable for logging and a future parity dashboard. */
export function reportLegacyProjectionParity(events: RuntimeEvent[], messages: Message[]): ProjectionParityReport {
  const issues = auditLegacyProjection(events, messages)
  const canonicalFacts = events.filter(event =>
    event.type === 'user_message_committed'
    || event.type === 'assistant_message_committed'
    || event.type === 'tool_call_observed'
    || event.type === 'tool_outcome_committed'
    || event.type === 'legacy_context_imported').length
  const issueCounts: ProjectionParityReport['issueCounts'] = {
    missing_legacy_message: 0,
    legacy_fact_missing: 0,
    legacy_cursor_ahead: 0,
    outcome_not_reflected: 0,
  }
  for (const issue of issues) issueCounts[issue.kind] += 1
  return {
    canonicalFacts,
    legacyMessages: messages.length,
    issueCount: issues.length,
    issueCounts,
    parityRatio: canonicalFacts === 0 ? 1 : Math.max(0, (canonicalFacts - issues.length) / canonicalFacts),
    issues,
  }
}
