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
    }
  | {
      kind: 'assistant'
      message: Message
    }
  | {
      kind: 'tool'
      message: Message
    }
  | {
      kind: 'request-header'
      requestSeq: number
      prompt: string
      usage?: PiUsage
      time: number
    }
  | {
      kind: 'compaction'
      message: Message
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
  contributions: [],
  prompts: new Map(),
  callSchemas: new Map(),
  requestUsage: new Map(),
  totalUsage: undefined,
  timeRange: undefined,
}
