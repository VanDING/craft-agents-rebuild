/**
 * Trajectory data contract.
 *
 * Aligned with the DSH `ui-trajectory` contribution model (node / assistant /
 * tool / request-header / compaction / session-end / turn-end) so downstream
 * layout / timeline / search logic can be shared conceptually. Inputs come
 * from the Craft Session state (messages enriched with timestamp / usage /
 * requestSeq / parentToolUseId by the Pi event pipeline).
 */

import type { Message, PiUsage } from '@craft-agent/core/types'

/** One independently assembled contribution to the trajectory ledger. */
export type TrajectoryContribution =
  | {
      kind: 'node'
      message: Message
      /** 1-based turn ordinal; null inside a Between-turns section. */
      turn: number | null
    }
  | {
      kind: 'assistant'
      message: Message
      /** 1-based turn ordinal; null inside a Between-turns section. */
      turn: number | null
    }
  | {
      kind: 'tool'
      message: Message
      /** 1-based turn ordinal; null inside a Between-turns section. */
      turn: number | null
    }
  | {
      kind: 'request-header'
      requestSeq: number
      prompt: string
      usage?: PiUsage
      time: number
      /** 1-based turn ordinal; null inside a Between-turns section. */
      turn: number | null
    }
  | {
      kind: 'compaction'
      message: Message
      /** Compaction lives between turns: always null. */
      turn: null
    }
  | {
      kind: 'session-end'
      time: number
    }
  | {
      kind: 'turn-end'
      turn: number
      time: number
      error?: string
    }

/** Fully assembled trajectory snapshot for one session. */
export interface TrajectorySnapshot {
  /** Original session messages used by request-context and file projections. */
  messages: readonly Message[]
  /** Chronological contributions (all kinds). */
  contributions: readonly TrajectoryContribution[]
  /** Request ordinal → captured system prompt (prompt-diff source). */
  prompts: ReadonlyMap<number, string>
  /** Call id → schema JSON (tool schema inspection). */
  callSchemas: ReadonlyMap<string, string>
  /** Per-request usage by request ordinal. */
  requestUsage: ReadonlyMap<number, PiUsage>
  /** Session-level cumulative usage (sum of all request usage). */
  totalUsage: PiUsage | undefined
  /** Wall-clock session bounds for the overview timeline. */
  timeRange: { start: number; end: number } | undefined
}

/** Empty snapshot before any session data is available. */
export const EMPTY_TRAJECTORY_SNAPSHOT: TrajectorySnapshot = {
  messages: [],
  contributions: [],
  prompts: new Map(),
  callSchemas: new Map(),
  requestUsage: new Map(),
  totalUsage: undefined,
  timeRange: undefined,
}

/** Shared evidence identity used to keep Run, Files, Review, and Chat aligned. */
export interface WorkbenchFocus {
  sessionId: string
  requestSeq?: number
  turn?: number | null
  recordIndex?: number
  messageId?: string
  callId?: string
  filePath?: string
  changeId?: string
  /** Range focus is expressed in the active timeline coordinate system. */
  timelineRange?: { start: number; end: number; mode: 'sequence' | 'duration' | 'time' | 'actual' }
  source: 'run' | 'files' | 'review' | 'chat'
  updatedAt: number
}
