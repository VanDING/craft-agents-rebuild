/**
 * Trajectory snapshot builder — pure function from Craft Session state.
 *
 * Consumes the enriched message stream (timestamp / usage / requestSeq /
 * promptSnapshot / parentToolUseId / compaction added by the Pi event
 * pipeline) and folds it into a `TrajectorySnapshot` for the trajectory view.
 * No React, no side effects — fully unit-testable.
 */

import type { Message, PiUsage } from '@craft-agent/core/types'
import {
  EMPTY_TRAJECTORY_SNAPSHOT,
  type TrajectoryContribution,
  type TrajectorySnapshot,
} from './trajectory-contract'

/** Session slice the builder needs (subset of the renderer Session). */
export interface TrajectorySessionInput {
  messages: readonly Message[]
  isProcessing?: boolean
  /** Session-level cumulative usage (fallback when message usage missing). */
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    contextTokens: number
    costUsd: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    contextWindow?: number
  }
  /** Last turn's full provider usage breakdown (Pi SDK). */
  lastFullUsage?: PiUsage
}

/** Sum two PiUsage buckets into one. */
function addUsage(a: PiUsage, b: PiUsage): PiUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheWrite1h: a.cacheWrite1h !== undefined || b.cacheWrite1h !== undefined
      ? (a.cacheWrite1h ?? 0) + (b.cacheWrite1h ?? 0)
      : undefined,
    reasoning: a.reasoning !== undefined || b.reasoning !== undefined
      ? (a.reasoning ?? 0) + (b.reasoning ?? 0)
      : undefined,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: {
      input: a.cost.input + b.cost.input,
      output: a.cost.output + b.cost.output,
      cacheRead: a.cost.cacheRead + b.cost.cacheRead,
      cacheWrite: a.cost.cacheWrite + b.cost.cacheWrite,
      total: a.cost.total + b.cost.total,
    },
  }
}

/**
 * Fold a session's messages into a trajectory snapshot.
 *
 * Ordering rules:
 * - A request-header contribution is emitted immediately before its assistant
 *   message when the message carries a requestSeq (prompt-diff anchor).
 * - Compaction records (info messages with `compaction`) become their own
 *   contribution so the view can render a "Between turns" section.
 * - Tool messages carry `callId` = toolUseId for schema inspection.
 */
export function buildTrajectorySnapshot(input: TrajectorySessionInput): TrajectorySnapshot {
  const { messages, lastFullUsage } = input
  if (!messages || messages.length === 0) {
    return { ...EMPTY_TRAJECTORY_SNAPSHOT, messages, totalUsage: lastFullUsage }
  }

  const contributions: TrajectoryContribution[] = []
  const prompts = new Map<number, string>()
  const requestUsage = new Map<number, PiUsage>()
  const callSchemas = new Map<string, string>()
  let totalUsage: PiUsage | undefined

  let turnCounter = 0
  let lastTurnId: string | undefined
  let requestOrdinal = 0

  for (const message of messages) {
    // Track turn boundaries for turn-end markers.
    const messageTurnId = message.turnId
    if (messageTurnId !== lastTurnId) {
      if (lastTurnId !== undefined && turnCounter > 0) {
        contributions.push({
          kind: 'turn-end',
          turn: turnCounter,
          time: message.timestamp,
        })
      }
      turnCounter += 1
      lastTurnId = messageTurnId
    }

    // Contribution's turn ordinal: messages with a turnId belong to the
    // current turn; orphaned messages (no turnId) land in Between turns.
    const contributionTurn: number | null = messageTurnId === undefined ? null : turnCounter

    // Request header: captured system prompt + usage anchored before its
    // assistant message (prompt diff + per-request token buckets).
    if (message.role === 'assistant' && message.requestSeq !== undefined) {
      requestOrdinal += 1
      if (message.promptSnapshot !== undefined) {
        prompts.set(requestOrdinal, message.promptSnapshot)
      }
      if (message.usage) {
        requestUsage.set(requestOrdinal, message.usage)
        totalUsage = totalUsage ? addUsage(totalUsage, message.usage) : message.usage
      }
      contributions.push({
        kind: 'request-header',
        requestSeq: requestOrdinal,
        sourceRequestSeq: message.requestSeq,
        requestId: message.id,
        prompt: message.promptSnapshot ?? '',
        usage: message.usage,
        time: message.timestamp,
        turn: contributionTurn,
      })
    }

    switch (message.role) {
      case 'user':
        contributions.push({ kind: 'node', message, turn: contributionTurn })
        break
      case 'assistant':
        contributions.push({ kind: 'assistant', message, turn: contributionTurn })
        break
      case 'tool': {
        contributions.push({ kind: 'tool', message, turn: contributionTurn })
        if (message.toolUseId && message.toolInput && Object.keys(message.toolInput).length > 0) {
          try {
            callSchemas.set(message.toolUseId, JSON.stringify(message.toolInput, null, 2))
          } catch {
            // Non-serializable input — no schema inspection available.
          }
        }
        break
      }
      case 'info':
        if (message.compaction) {
          contributions.push({ kind: 'compaction', message, turn: null })
        } else {
          contributions.push({ kind: 'node', message, turn: contributionTurn })
        }
        break
      case 'error':
        contributions.push({ kind: 'node', message, turn: contributionTurn })
        break
      default:
        // status / plan / auth-request etc. — keep as node for context.
        contributions.push({ kind: 'node', message, turn: contributionTurn })
        break
    }
  }

  // Session end marker.
  const first = messages[0]
  const last = messages[messages.length - 1]
  const lastTime = last !== undefined ? last.timestamp : 0
  contributions.push({ kind: 'session-end', time: lastTime })

  const timeRange = first !== undefined && last !== undefined
    ? { start: first.timestamp, end: last.timestamp }
    : undefined

  return {
    messages,
    contributions,
    prompts,
    callSchemas,
    requestUsage,
    totalUsage: totalUsage ?? lastFullUsage,
    timeRange,
  }
}
