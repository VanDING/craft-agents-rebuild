/**
 * Trajectory layout — folds a trajectory snapshot into a turn-aware ledger
 * model (turns → groups → cells), mirroring the DSH `layout.ts` projection
 * over the Craft contribution model.
 */

import type { Message, PiUsage } from '@craft-agent/core/types'
import type { TrajectoryContribution, TrajectorySnapshot } from './trajectory-contract'

/** Closed set of trajectory record kinds (DSH-aligned). */
export type TrajectoryCellKind =
  | 'system'
  | 'user'
  | 'context'
  | 'compacted'
  | 'message'
  | 'tool'
  | 'subtool'

/** Recorded inputs needed to derive assistant TTFT and decode throughput. */
export interface AssistantMetricDetail {
  timingRecorded: boolean
  stepStartTime: number | null
  firstTokenTime: number | null
  completedTime: number | null
  usageProvided: boolean
  outputTokens: number | null
}

/** One source content block preserved in model order for the details panel. */
export interface TrajectorySourceBlock {
  type: string
  content: string
  imageSrc?: string
  imageAlt?: string
  callId?: string
  toolName?: string
}

/** Data and presentation attributes for one trajectory record. */
export interface TrajectoryCellProps {
  /** 1-based record index shown as `#N`. */
  index: number
  /** Projection-stable identity. */
  recordId?: string
  kind: TrajectoryCellKind
  /** Non-Markdown summary or prefix. */
  text: string
  /** Raw Markdown source for the single-line summary. */
  previewMarkdown?: string
  /** Whether this user record opens a new model turn. */
  opensTurn?: boolean
  /** Source message id for cross-record navigation. */
  sourceSeq?: string
  /** Full request/message content for the details panel. */
  inputDetail?: string
  /** Effective system prompt for this request (prompt diff). */
  promptDetail?: string
  /** Full assistant/tool result content for the details panel. */
  outputDetail?: string
  /** Full assistant reasoning content for the details panel. */
  thinkingDetail?: string
  /** Tool call id used to link source blocks to tool records. */
  callId?: string
  /** Call-time tool schema for the details panel. */
  schemaDetail?: string
  /** Tool-only result summary paired with the call in the same record. */
  result?: string
  /** Raw Markdown source converted into the tool-result summary. */
  resultPreviewMarkdown?: string
  /** Tool-only result failure state. */
  isError?: boolean
  /** Assistant-only timing and token facts for the details panel. */
  assistantMetrics?: AssistantMetricDetail
  /** Own duration in seconds, or `null` when no duration is known. */
  timeSeconds: number | null
  /** Unix epoch ms when this operation started, when known. */
  startedAt?: number | null
  /** Message-only token buckets. */
  input?: number
  cacheRead?: number
  cacheWrite?: number
  output?: number
  think?: number
  /** Whether the cell renders its selection treatment. */
  selected?: boolean
  /** Underlying Craft message (for inspector access to raw fields). */
  sourceMessage?: Message
}

/** One Message or Step group inside a turn. */
export interface TrajectoryGroupModel {
  title: string
  description?: string
  cells: readonly TrajectoryCellProps[]
}

/** One sticky turn, or a standalone compaction section between turns. */
export interface TrajectoryTurnModel {
  turn: number | null
  groups: readonly TrajectoryGroupModel[]
}

/** Folding input (subset of the trajectory snapshot). */
export interface TrajectoryLayoutInput {
  contributions: readonly TrajectoryContribution[]
  prompts: ReadonlyMap<number, string>
  requestUsage: ReadonlyMap<number, PiUsage>
  callSchemas: ReadonlyMap<string, string>
}

const KIND_LABEL: Record<TrajectoryCellKind, string> = {
  system: 'System',
  user: 'User',
  context: 'Context',
  compacted: 'Compacted',
  message: 'Message',
  tool: 'Tool',
  subtool: 'Sub-tool',
}

/** Tool result text (truncated for the row summary). */
function toolResultSummary(result: string | undefined): string {
  if (!result) return ''
  const singleLine = result.replace(/\s+/g, ' ').trim()
  return singleLine.length > 160 ? `${singleLine.slice(0, 160)}…` : singleLine
}

function messageText(message: Message): string {
  const content = message.content ?? ''
  const singleLine = content.replace(/\s+/g, ' ').trim()
  return singleLine.length > 200 ? `${singleLine.slice(0, 200)}…` : singleLine
}

function usageToCell(
  cell: TrajectoryCellProps,
  usage: PiUsage | undefined,
): TrajectoryCellProps {
  if (!usage) return cell
  return {
    ...cell,
    input: usage.input + usage.cacheRead,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    output: usage.output,
    think: usage.reasoning,
  }
}

/**
 * Fold contributions into turn → group → cell models.
 *
 * - `request-header` contributions open a group titled "Request N" whose
 *   cells carry the captured prompt (prompt diff) and usage buckets.
 * - Assistant messages become `message` cells; tool messages become `tool`
 *   cells (subtool when the message has a parentToolUseId).
 * - Compaction contributions become a standalone `turn: null` section.
 */
export function deriveTrajectoryLayout(input: TrajectoryLayoutInput): readonly TrajectoryTurnModel[] {
  const { contributions, prompts, requestUsage, callSchemas } = input
  const turns: TrajectoryTurnModel[] = []
  let index = 0

  // Current section accumulator (mutable container so closure control-flow
  // analysis does not narrow the captured variables to never).
  const state: {
    turn: TrajectoryTurnModel | null
    group: TrajectoryGroupModel | null
  } = { turn: null, group: null }

  const ensureTurn = (turn: number | null): TrajectoryTurnModel => {
    if (state.turn !== null && state.turn.turn === turn) return state.turn
    state.turn = { turn, groups: [] }
    turns.push(state.turn)
    state.group = null
    return state.turn
  }

  const ensureGroup = (turn: TrajectoryTurnModel, title: string): TrajectoryGroupModel => {
    const last = turn.groups.length > 0 ? turn.groups[turn.groups.length - 1] : undefined
    if (last !== undefined && last.title === title) return last
    state.group = { title, cells: [] }
    turn.groups = [...turn.groups, state.group]
    return state.group
  }

  for (const contribution of contributions) {
    switch (contribution.kind) {
      case 'request-header': {
        index += 1
        const usage = requestUsage.get(contribution.requestSeq)
        const prompt = prompts.get(contribution.requestSeq)
        const turn = ensureTurn(state.turn?.turn ?? null)
        const group = ensureGroup(turn, `Request ${contribution.requestSeq}`)
        const cell: TrajectoryCellProps = {
          index,
          kind: 'system',
          text: prompt ? `System prompt (${prompt.length} chars)` : 'System prompt',
          previewMarkdown: prompt,
          inputDetail: prompt,
          timeSeconds: null,
          startedAt: contribution.time,
        }
        state.group = { ...group, cells: [...group.cells, usageToCell(cell, usage)] }
        turn.groups = [...turn.groups.slice(0, -1), state.group]
        break
      }

      case 'node':
      case 'assistant':
      case 'tool': {
        const message = contribution.message
        index += 1
        const turn = ensureTurn(state.turn?.turn ?? null)

        if (message.role === 'user') {
          const group = ensureGroup(turn, 'User')
          state.group = {
            ...group,
            cells: [
              ...group.cells,
              {
                index,
                kind: 'user',
                text: messageText(message),
                previewMarkdown: message.content,
                opensTurn: true,
                sourceSeq: message.id,
                inputDetail: message.content,
                timeSeconds: null,
                startedAt: message.timestamp,
                sourceMessage: message,
              },
            ],
          }
          turn.groups = [...turn.groups.slice(0, -1), state.group]
        } else if (message.role === 'assistant') {
          const group = ensureGroup(turn, 'Assistant')
          const base: TrajectoryCellProps = {
            index,
            kind: 'message',
            text: messageText(message),
            previewMarkdown: message.content,
            sourceSeq: message.id,
            inputDetail: message.content,
            timeSeconds: null,
            startedAt: message.timestamp,
            sourceMessage: message,
          }
          const cell = message.usage ? usageToCell(base, message.usage) : base
          state.group = { ...group, cells: [...group.cells, cell] }
          turn.groups = [...turn.groups.slice(0, -1), state.group]
        } else {
          // Tool or subtool.
          const isSub = message.parentToolUseId !== undefined
          const group = ensureGroup(turn, isSub ? 'Sub-tools' : 'Tools')
          const result = message.toolResult ?? ''
          // Wall-clock duration only when the pipeline measured it
          // (server ts + adapter delta). Historical messages predating the
          // measurement have no reliable duration — report unknown rather
          // than a misleading 0ms.
          const duration = message.toolDuration !== undefined
            ? message.toolDuration / 1000
            : null
          const schema = message.toolUseId !== undefined
            ? callSchemas.get(message.toolUseId)
            : undefined
          const cell: TrajectoryCellProps = {
            index,
            kind: isSub ? 'subtool' : 'tool',
            text: `${message.toolDisplayName ?? message.toolName ?? 'Tool'}: ${messageText(message)}`,
            callId: message.toolUseId,
            isError: message.isError,
            result: toolResultSummary(result),
            outputDetail: result,
            schemaDetail: schema,
            inputDetail: message.toolInput !== undefined ? JSON.stringify(message.toolInput, null, 2) : undefined,
            timeSeconds: duration,
            startedAt: message.timestamp,
            sourceMessage: message,
          }
          state.group = { ...group, cells: [...group.cells, cell] }
          turn.groups = [...turn.groups.slice(0, -1), state.group]
        }
        break
      }

      case 'compaction': {
        const message = contribution.message
        index += 1
        // Compaction lands in a standalone "Between turns" section (turn: null).
        const section = ensureTurn(null)
        const group = ensureGroup(section, 'Between turns')
        const outcome = message.compaction?.aborted
          ? 'aborted'
          : message.compaction?.errorMessage
            ? 'failed'
            : 'complete'
        state.group = {
          ...group,
          cells: [
            ...group.cells,
            {
              index,
              kind: 'compacted',
              text: `Compaction ${outcome} (${message.compaction?.reason ?? 'unknown'} trigger)`,
              sourceSeq: message.id,
              inputDetail: message.content,
              timeSeconds: null,
              startedAt: message.timestamp,
              sourceMessage: message,
            },
          ],
        }
        section.groups = [...section.groups.slice(0, -1), state.group]
        break
      }

      case 'turn-end':
      case 'session-end':
        // Boundary markers are implicit in the model; nothing to render.
        break
    }
  }

  return turns
}

export { KIND_LABEL }
