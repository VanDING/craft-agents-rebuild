/**
 * Pi SDK Event Adapter
 *
 * Maps Pi Agent Core events (AgentEvent / AgentSessionEvent) to
 * Craft Agent's AgentEvent format for UI compatibility.
 *
 * Pi emits fine-grained lifecycle events. We translate them into
 * the same event vocabulary the renderer already understands from
 * Claude / Codex / Copilot backends.
 */

import type { AgentEvent as CraftAgentEvent, PiUsage, TrajectorySourceBlock } from '@craft-agent/core/types';
import type {
  AgentEvent as PiAgentEvent,
} from '@earendil-works/pi-agent-core';
import type {
  AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import { isContextOverflow } from '@earendil-works/pi-ai';
import { BaseEventAdapter } from '../base-event-adapter.ts';
import { PI_TOOL_NAME_MAP } from './constants.ts';
import { toolMetadataStore } from '../../../interceptor-common.ts';
import { parseError } from '../../errors.ts';

/**
 * Combined event type the adapter can handle.
 * AgentSessionEvent is a superset of PiAgentEvent (adds compaction_*, auto_retry_*, queue_update).
 */
type PiEvent = PiAgentEvent | AgentSessionEvent;

/**
 * Maps Pi SDK events to Craft AgentEvents for UI compatibility.
 *
 * Event mapping:
 * - message_update (text_delta in assistantMessageEvent) → text_delta
 * - message_end → text_complete
 * - tool_execution_start → tool_start
 * - tool_execution_end → tool_result
 * - agent_settled → complete
 * - compaction_start → status (with "Compacting" keyword)
 * - compaction_end → info/error
 * - auto_retry_start → status
 * - auto_retry_end → error (failure only)
 * - queue_update → ignored (no current UI consumer)
 */
export class PiEventAdapter extends BaseEventAdapter {
  // Track tool names from execution_start for proper tool_result correlation
  private toolNames: Map<string, string> = new Map();

  // Track whether streaming deltas have been received for the current message
  private hasStreamedDeltas: boolean = false;

  // Track whether a final (non-intermediate) text_complete has been emitted this turn
  private hasEmittedFinalText: boolean = false;

  // Sub-turnId isolation for tool calls within a single Pi turn
  private subTurnCounter: number = 0;
  private messageSubTurnId: string | null = null;

  // Model context window for usage_update events
  private contextWindow: number | undefined;

  // Mini model ID for call_llm display default (#596).
  // Used when the caller didn't specify an explicit model — we fill args.model
  // on the tool_start event so the UI shows the effective default instead of
  // leaving the badge blank.
  private miniModel: string | undefined;

  // Track last usage for emitting with complete event
  private lastUsage: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: { total: number } } | undefined;

  // Tool wall-clock tracking: toolCallId → start timestamp (epoch ms).
  // Server-forwarded `ts` on tool_execution_start (set by pi-agent-server)
  // is authoritative; Date.now() is the fallback when absent.
  private toolStartTimes: Map<string, number> = new Map();

  // Per-session request ordinal for trajectory request-header grouping.
  // Incremented on each assistant message_end (matches turn request count).
  private requestSeq: number = 0;

  // Last assistant usage (full PiUsage) for text_complete emission.
  private lastFullUsage: PiUsage | undefined;

  // Assistant step timing (trajectory TTFT / decoding): stepStartTime from
  // message_start, firstTokenTime from the first text_delta, completedTime
  // from message_end. Server-forwarded `ts` is authoritative when present.
  private pendingStepStart: number | null = null;
  private pendingFirstToken: number | null = null;

  // Pi 0.84.3 emits `agent_settled` only after retry, compaction and queued
  // continuations are exhausted. Hold an overflow error until that boundary so
  // successful SDK recovery stays invisible while failed recovery remains useful.
  private pendingOverflowError: string | null = null;
  private pendingLengthError: string | null = null;

  constructor() {
    super('pi-event');
  }

  /**
   * Set the model's context window size for usage reporting.
   */
  setContextWindow(cw: number): void {
    this.contextWindow = cw;
  }

  /** Complete only at Pi's fully-settled boundary, never at a single agent loop. */
  shouldCompleteQueue(isAgentSettled: boolean): boolean {
    return isAgentSettled;
  }

  /**
   * Reset overflow-recovery state. Call from session disposal so a stale
   * fallback timer doesn't fire on a torn-down adapter.
   */
  resetOverflowState(): void {
    this.pendingOverflowError = null;
  }

  /**
   * Set the mini model ID for call_llm badge default.
   * When the agent's call_llm invocation omits `args.model`, we fill it with
   * this so the UI badge shows the effective default instead of nothing.
   * Explicit `args.model` values from the agent are always preserved.
   */
  setMiniModel(model: string | undefined): void {
    this.miniModel = model;
  }

  /**
   * Generate a unique sub-turnId for a text block within the current turn.
   */
  private nextSubTurnId(prefix: string): string {
    const base = this.currentTurnId || 'unknown';
    return `${base}__${prefix}${this.subTurnCounter++}`;
  }

  protected onTurnStart(): void {
    this.toolNames.clear();
    this.hasStreamedDeltas = false;
    this.hasEmittedFinalText = false;
    this.subTurnCounter = 0;
    this.messageSubTurnId = null;
    this.log.debug('Turn started', { turnIndex: this.turnIndex });
  }

  /**
   * Adapt a Pi SDK event to zero or more Craft AgentEvents.
   */
  *adaptEvent(event: PiEvent): Generator<CraftAgentEvent> {
    // Craft-injected event from pi-agent-server (not part of the Pi SDK).
    // The subprocess emits this immediately after each `message_end` to deliver
    // the correct `sdkTurnAnchor` (the leaf id AFTER the SDK has appended the
    // assistant entry). We forward it through as-is — SessionManager correlates
    // it to a Craft assistant message via `sdkMessageId`. See craft-agents-oss#782.
    if ((event as { type?: string }).type === 'pi_turn_anchor') {
      const e = event as unknown as { sdkMessageId?: string; sdkTurnAnchor?: string };
      if (e.sdkMessageId && e.sdkTurnAnchor) {
        yield {
          type: 'pi_turn_anchor',
          sdkMessageId: e.sdkMessageId,
          sdkTurnAnchor: e.sdkTurnAnchor,
        };
      }
      return;
    }

    switch (event.type) {
      // ============================================================
      // Agent lifecycle events
      // ============================================================

      case 'agent_start':
        // Internal — agent run has started
        break;

      case 'agent_end':
        // One Pi agent loop ended. Retry, compaction or an extension-queued
        // continuation may still follow, so this is deliberately non-terminal.
        break;

      case 'agent_settled':
        // Pi guarantees this event only after automatic retry, compaction and
        // queued continuations have drained. This is Craft's terminal boundary.
        {
          const settled = event as typeof event & {
            contextUsage?: { tokens: number | null; contextWindow: number };
          };
          const settledContextTokens = settled.contextUsage?.tokens;
          const settledContextWindow = settled.contextUsage?.contextWindow;
          if (settledContextTokens !== null && settledContextTokens !== undefined) {
            yield {
              type: 'usage_update',
              usage: {
                inputTokens: settledContextTokens,
                contextWindow: settledContextWindow,
              },
            };
          }
          if (this.pendingOverflowError) {
            yield { type: 'error', message: this.pendingOverflowError };
            this.pendingOverflowError = null;
          }
          if (this.pendingLengthError) {
            yield { type: 'error', message: this.pendingLengthError };
            this.pendingLengthError = null;
          }
          if (this.lastUsage) {
            const lastCallInputTokens = this.lastUsage.input + (this.lastUsage.cacheRead || 0);
            yield {
              type: 'complete',
              usage: {
                // getContextUsage() is authoritative after compaction. Falling
                // back preserves compatibility with older/synthetic events.
                inputTokens: settledContextTokens ?? lastCallInputTokens,
                outputTokens: this.lastUsage.output,
                cacheReadTokens: this.lastUsage.cacheRead,
                cacheCreationTokens: this.lastUsage.cacheWrite,
                costUsd: this.lastUsage.cost.total,
                contextWindow: settledContextWindow ?? this.contextWindow,
              },
            };
          } else {
            yield { type: 'complete' };
          }
        }
        break;

      // ============================================================
      // Turn events
      // ============================================================

      case 'turn_start':
        // Pi SDK turn_start has no ID, so generate one for event correlation
        this.currentTurnId = `pi-turn-${this.turnIndex}`;
        break;

      case 'turn_end':
        // Don't emit 'complete' here — agent_end handles it.
        // Emitting from both causes duplicate messages in session persistence.
        this.currentTurnId = null;
        this.hasStreamedDeltas = false;
        this.hasEmittedFinalText = false;
        this.subTurnCounter = 0;
        this.messageSubTurnId = null;
        break;

      // ============================================================
      // Message events (text streaming)
      // ============================================================

      case 'message_start': {
        // Pi SDK emits message_start for user messages too — only assistant
        // steps carry timing (step start → first delta → completion).
        const role = (event.message as { role?: string } | undefined)?.role;
        if (role === 'assistant') {
          this.pendingStepStart = this.serverTimestamp(event) ?? Date.now();
          this.pendingFirstToken = null;
        }
        break;
      }

      case 'message_update': {
        // Pi SDK emits message_update only for assistant messages (streaming deltas)
        const amEvent: AssistantMessageEvent = event.assistantMessageEvent;
        if (amEvent.type === 'text_delta' && amEvent.delta) {
          // First delta of the step marks firstTokenTime for TTFT.
          if (this.pendingFirstToken === null && this.pendingStepStart !== null) {
            this.pendingFirstToken = this.serverTimestamp(event) ?? Date.now();
          }
          this.hasStreamedDeltas = true;
          if (!this.messageSubTurnId) {
            this.messageSubTurnId = this.nextSubTurnId('m');
          }
          yield {
            type: 'text_delta',
            text: amEvent.delta,
            turnId: this.messageSubTurnId,
          };
        }
        break;
      }

      case 'message_end': {
        // Pi SDK emits message_end for ALL messages (user, assistant, toolResult).
        // Only process assistant messages — skip user prompts and tool results.
        const msg = event.message as { role?: string; stopReason?: string; errorMessage?: string; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: { total: number } }; id?: string } | undefined;
        // SDK message id, set by pi-agent-server when forwarding the event.
        // SessionManager uses this to correlate the follow-up `pi_turn_anchor`
        // event to the Craft assistant message created here (#782).
        // SDK 0.84 messages carry no `id` at message_end — fall back to the
        // provider `responseId` (pi-agent-server forwards the same fallback).
        const sdkMessageId = (event as { sdkMessageId?: string }).sdkMessageId
          ?? msg?.id
          ?? (msg as { responseId?: string }).responseId;
        if (msg?.role !== 'assistant') break;

        // Surface API errors — Pi SDK sets stopReason: 'error' and errorMessage on failures
        if (msg.stopReason === 'error' && msg.errorMessage) {
          // Context overflow: hand recovery to the SDK's _runAutoCompaction
          // and keep the UI quiet until we know the outcome (recovered turn
          // arrives, or compaction fails). Suppress the raw provider error.
          if (isContextOverflow(event.message as AssistantMessage, this.contextWindow)) {
            this.pendingOverflowError = msg.errorMessage;
            break;
          }

          // Classify the error — auth/billing errors should be typed so SessionManager
          // can trigger its auth-retry pipeline (refresh token + resend).
          const parsed = parseError(new Error(msg.errorMessage));
          const isClassified = parsed.code !== 'unknown_error';
          if (isClassified) {
            yield { type: 'typed_error', error: parsed };
          } else {
            yield { type: 'error', message: msg.errorMessage };
          }
          break;
        }

        const isLengthLimited = msg.stopReason === 'length';
        if (isLengthLimited) {
          this.pendingLengthError = 'Model output reached its token limit before the turn completed. The partial response was preserved; continue the task to resume.';
        } else {
          // A later complete assistant response means any held provider limit was recovered.
          this.pendingOverflowError = null;
          this.pendingLengthError = null;
        }

        // Extract text content from the final assistant message
        const textContent = this.extractTextFromMessage(event.message);
        // Pi SDK stopReason: 'toolUse' means the model will call tools next (intermediate commentary),
        // 'stop'/'end_turn' means final response. Same logic as Claude's stop_reason === 'tool_use'.
        const isIntermediate = msg.stopReason === 'toolUse' || isLengthLimited;
        if (textContent && (isIntermediate || !this.hasEmittedFinalText)) {
          if (!isIntermediate) this.hasEmittedFinalText = true;

          const mTurnId = this.messageSubTurnId || this.nextSubTurnId('m');
          this.messageSubTurnId = null;
          // Server-assigned request ordinal (authoritative, matches the prompt
          // snapshot captured in pi-agent-server); fall back to local counter.
          const serverSeq = (event as { requestSeq?: unknown }).requestSeq;
          if (typeof serverSeq === 'number') {
            this.requestSeq = serverSeq;
          } else {
            this.requestSeq += 1;
          }

          // Capture full provider usage for trajectory per-request buckets.
          const usage = this.lastFullUsage;

          // Wall-clock step metrics for TTFT / decoding / throughput.
          const stepStartTime = this.pendingStepStart;
          const firstTokenTime = this.pendingFirstToken;
          const completedTime = this.extractMessageTimestamp(event.message) ?? Date.now();
          const assistantMetrics = {
            timingRecorded: stepStartTime !== null && firstTokenTime !== null,
            stepStartTime,
            firstTokenTime,
            completedTime,
            usageProvided: !!msg.usage,
            outputTokens: typeof msg.usage?.output === 'number' ? msg.usage.output : null,
          };
          this.pendingStepStart = null;
          this.pendingFirstToken = null;

          yield {
            type: 'text_complete',
            text: textContent,
            isIntermediate,
            turnId: mTurnId,
            sdkMessageId,
            timestamp: this.extractMessageTimestamp(event.message),
            usage,
            requestSeq: this.requestSeq,
            promptSnapshot: (event as { promptSnapshot?: unknown }).promptSnapshot as string | undefined,
            assistantMetrics,
            outputBlocks: this.extractSourceBlocks(event.message),
            ...this.durableAttachments(event),
          };
          this.hasStreamedDeltas = false;
        }

        // Emit usage_update if the assistant message includes token usage
        if (msg.usage && typeof msg.usage.input === 'number') {
          this.lastUsage = msg.usage;
          this.lastFullUsage = msg.usage as PiUsage;
          const inputTokens = msg.usage.input + (msg.usage.cacheRead || 0);
          yield {
            type: 'usage_update',
            usage: {
              inputTokens,
              contextWindow: this.contextWindow,
            },
            full: msg.usage as PiUsage,
          };
        }
        break;
      }

      // ============================================================
      // Tool events
      // ============================================================

      case 'tool_execution_start': {
        const durable = this.durableAttachments(event);
        const toolCallId = event.toolCallId;
        const toolName = this.resolveToolName(event.toolName);
        this.toolNames.set(toolCallId, toolName);

        // Server-forwarded `ts` (pi-agent-server Date.now() stamp) is
        // authoritative; fall back to local time when absent.
        const startTs = this.serverTimestamp(event) ?? Date.now();
        this.toolStartTimes.set(toolCallId, startTs);

        // Normalize Pi field names to Craft's canonical UI schema.
        const args = this.normalizeToolInput(toolName, (event.args ?? {}) as Record<string, unknown>);

        if (toolName === 'report_progress') {
          const message = typeof args.message === 'string' ? args.message.trim() : '';
          if (message) {
            yield {
              type: 'text_complete',
              text: message,
              isIntermediate: true,
              turnId: this.nextSubTurnId('progress'),
              timestamp: startTs,
            };
          }
          break;
        }

        // For call_llm, fill in the default display model when the caller didn't
        // specify one — Pi's call_llm defaults to miniModel. We only fill the gap;
        // we never overwrite an explicit agent-provided model (that was the #596 bug).
        if (toolName.includes('call_llm') && this.miniModel && !args.model) {
          args.model = this.miniModel;
        }

        // Canonical metadata from subprocess event payload (interceptor/bridge-authoritative path).
        const eventMeta = this.extractToolMetadataFromEvent(event);

        // Backward-compatibility fallback: shared store (legacy side-channel),
        // with id canonicalization fallback for mixed call-id formats.
        const { meta: storedMeta, keyTried } = this.resolveStoredMetadata(toolCallId);

        // Last-resort fallback: args metadata if present.
        const argsIntent = typeof args._intent === 'string' ? args._intent : undefined;
        const argsDisplayName = typeof args._displayName === 'string' ? args._displayName : undefined;

        const intent = eventMeta?.intent
          || storedMeta?.intent
          || argsIntent
          || (typeof args.description === 'string' ? args.description : undefined);

        const displayName = eventMeta?.displayName
          || storedMeta?.displayName
          || argsDisplayName
          || this.getToolDisplayName(toolName);

        const metadataSource = eventMeta
          ? 'event'
          : storedMeta
            ? `store(${keyTried})`
            : (argsIntent || argsDisplayName)
              ? 'args'
              : (typeof args.description === 'string')
                ? 'description'
                : 'fallback';

        this.log.debug('Tool metadata resolution', {
          toolName,
          toolCallId,
          metadataSource,
          hasIntent: !!intent,
          hasDisplayName: !!displayName,
        });

        // Classify bash commands that are actually file reads
        if (toolName === 'Bash' && typeof args.command === 'string') {
          const readInfo = this.classifyReadCommand(toolCallId, args.command);
          if (readInfo) {
            yield { ...this.createReadToolStart(
              toolCallId,
              readInfo,
              intent,
              'Read File',
            ), ...durable };
            break;
          }
        }

        yield { ...this.createToolStart(
          toolCallId,
          toolName,
          args,
          intent,
          displayName,
        ), ...durable };
        break;
      }

      case 'tool_execution_update': {
        // Accumulate partial output for streaming tool results
        const partialResult = event.partialResult;
        if (partialResult && typeof partialResult === 'object') {
          const content = (partialResult as { content?: Array<{ type: string; text?: string }> }).content;
          if (Array.isArray(content)) {
            for (const part of content) {
              if (part.type === 'text' && part.text) {
                this.accumulateOutput(event.toolCallId, part.text);
              }
            }
          }
        }
        break;
      }

      case 'tool_execution_end': {
        const durable = this.durableAttachments(event);
        const toolCallId = event.toolCallId;
        const resolvedToolName = this.toolNames.get(toolCallId) || 'tool';
        this.toolNames.delete(toolCallId);

        // Wall-clock duration from the tracked start stamp (server ts or local).
        const endTs = this.serverTimestamp(event) ?? Date.now();
        const startTs = this.toolStartTimes.get(toolCallId);
        this.toolStartTimes.delete(toolCallId);
        const durationMs = startTs !== undefined ? endTs - startTs : undefined;

        if (resolvedToolName === 'report_progress') {
          // The corresponding start event is rendered as intermediate text;
          // the internal tool acknowledgement is only for the model.
          this.hasEmittedFinalText = false;
          this.messageSubTurnId = null;
          break;
        }

        // Use accumulated output from partial results if available
        const accumulatedOutput = this.consumeOutput(toolCallId);

        const isError = event.isError;
        let result: string;

        if (accumulatedOutput) {
          result = accumulatedOutput;
        } else {
          result = this.extractToolResult(event.result, isError);
        }

        // After tool completion, the assistant may generate new text
        this.hasEmittedFinalText = false;
        this.messageSubTurnId = null;

        // Check if this was classified as a file read
        const readInfo = this.consumeReadCommand(toolCallId);
        if (readInfo) {
          yield { ...this.createToolResult(toolCallId, 'Read', result, isError, undefined, endTs, durationMs), ...durable };
          break;
        }

        yield { ...this.createToolResult(toolCallId, resolvedToolName, result, isError, undefined, endTs, durationMs), ...durable };
        break;
      }

      // ============================================================
      // Session-level events (AgentSessionEvent extensions)
      // ============================================================

      case 'compaction_start': {
        const startEvent = event as Extract<AgentSessionEvent, { type: 'compaction_start' }>;
        // Structured event for the trajectory view (Between turns section).
        yield { type: 'compaction_start', reason: startEvent.reason };
        // Use "Compacting" keyword so session handler detects statusType: 'compacting'
        yield { type: 'status', message: 'Compacting context...' };
        break;
      }

      case 'compaction_end': {
        const compactionEvent = event as Extract<AgentSessionEvent, { type: 'compaction_end' }>;
        // Structured outcome for the trajectory view, emitted for every
        // terminal state (success, aborted, or failed).
        yield {
          type: 'compaction_end',
          reason: compactionEvent.reason,
          aborted: compactionEvent.aborted,
          willRetry: compactionEvent.willRetry,
          errorMessage: compactionEvent.errorMessage,
        };
        if (compactionEvent.result && !compactionEvent.aborted) {
          this.pendingOverflowError = null;
          // Use "Compacted" keyword so session handler detects statusType: 'compaction_complete'
          yield { type: 'info', message: 'Compacted context to fit within limits' };
        } else if (compactionEvent.errorMessage) {
          yield {
            type: 'error',
            message: `Context compaction failed: ${compactionEvent.errorMessage}`,
          };
          // Avoid repeating the provider overflow at agent_settled: the
          // compaction failure above is the actionable terminal error.
          this.pendingOverflowError = null;
        }
        break;
      }

      case 'auto_retry_start': {
        const retryEvent = event as Extract<AgentSessionEvent, { type: 'auto_retry_start' }>;
        yield {
          type: 'status',
          message: `Retrying (attempt ${retryEvent.attempt}/${retryEvent.maxAttempts})...`,
        };
        break;
      }

      case 'auto_retry_end': {
        const retryEndEvent = event as Extract<AgentSessionEvent, { type: 'auto_retry_end' }>;
        if (!retryEndEvent.success && retryEndEvent.finalError) {
          yield { type: 'error', message: `Retry failed: ${retryEndEvent.finalError}` };
        }
        break;
      }

      case 'queue_update':
        // Queue contents are currently reflected by existing session/message state.
        // Ignore the event explicitly so newer Pi SDK sessions don't log noisy
        // "Unknown Pi event" warnings until we add a dedicated UI consumer.
        break;

      default:
        this.log.warn(`Unknown Pi event type: ${(event as { type: string }).type}`);
        break;
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Read the server-forwarded wall-clock stamp (`ts`) that pi-agent-server
   * attaches to tool_execution_start/end events. Not part of the typed
   * AgentSessionEvent surface, so narrow through an indexed read + typeof.
   */
  private serverTimestamp(event: PiEvent): number | undefined {
    if (typeof event !== 'object' || event === null) return undefined;
    const ts = (event as { ts?: unknown }).ts;
    return typeof ts === 'number' ? ts : undefined;
  }

  private durableAttachments(event: PiEvent): { durableOperationId?: string; durableSeq?: number } {
    if (typeof event !== 'object' || event === null) return {};
    const attachment = event as { durableOperationId?: unknown; durableSeq?: unknown };
    return {
      ...(typeof attachment.durableOperationId === 'string'
        ? { durableOperationId: attachment.durableOperationId }
        : {}),
      ...(typeof attachment.durableSeq === 'number' ? { durableSeq: attachment.durableSeq } : {}),
    };
  }

  /**
   * Extract the SDK message timestamp (epoch ms) from a Pi AgentMessage when
   * present. AssistantMessage / ToolResultMessage carry `timestamp` in the
   * pi-ai Message shape.
   */
  private extractMessageTimestamp(message: unknown): number | undefined {
    if (typeof message !== 'object' || message === null) return undefined;
    const ts = (message as { timestamp?: unknown }).timestamp;
    return typeof ts === 'number' ? ts : undefined;
  }

  /**
   * Extract canonical tool metadata from enriched tool_execution_start events.
   * This is the interceptor-authoritative path emitted by pi-agent-server.
   */
  private extractToolMetadataFromEvent(event: PiEvent): { intent?: string; displayName?: string } | undefined {
    const metadata = (event as {
      toolMetadata?: { intent?: unknown; displayName?: unknown };
    }).toolMetadata;

    if (!metadata) return undefined;

    const intent = typeof metadata.intent === 'string' ? metadata.intent : undefined;
    const displayName = typeof metadata.displayName === 'string' ? metadata.displayName : undefined;

    if (!intent && !displayName) return undefined;
    return { intent, displayName };
  }

  /**
   * Resolve stored metadata by tool call id with fallback variants.
   * Handles mixed id forms like `call_xxx|fc_yyy` by trying the base id.
   */
  private resolveStoredMetadata(toolCallId: string): { meta?: { intent?: string; displayName?: string }; keyTried?: string } {
    const candidates = new Set<string>([toolCallId]);
    if (toolCallId.includes('|')) {
      const [base] = toolCallId.split('|');
      if (base) candidates.add(base);
    }

    for (const candidate of candidates) {
      const meta = toolMetadataStore.get(candidate, this.sessionDir);
      if (meta) return { meta, keyTried: candidate };
    }

    return { meta: undefined, keyTried: Array.from(candidates).join(' -> ') };
  }

  /**
   * Normalize Pi SDK tool input field names to Craft's canonical UI schema.
   * Pi uses camelCase (oldText, newText, path), while the persisted Craft
   * protocol keeps snake_case fields for backward-compatible rendering.
   */
  private normalizeToolInput(
    toolName: string,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    if (toolName === 'Edit') {
      const normalized = { ...args };
      if ('path' in normalized && !('file_path' in normalized)) {
        normalized.file_path = normalized.path;
        delete normalized.path;
      }

      // Pi SDK >= 0.63.2 uses edits[] array instead of top-level oldText/newText.
      // Preserve the full edits[] payload so the renderer can expand and display
      // every replacement block. Also derive the first edit into flat old/new
      // fields as a compatibility bridge for UI paths that still expect them.
      const edits = normalized.edits as Array<{ oldText?: string; newText?: string }> | undefined;
      if (Array.isArray(edits) && edits.length > 0 && edits[0]) {
        const first = edits[0];
        if (first.oldText != null && !('old_string' in normalized)) {
          normalized.old_string = first.oldText;
        }
        if (first.newText != null && !('new_string' in normalized)) {
          normalized.new_string = first.newText;
        }
      }

      // Legacy path: top-level oldText/newText (Pi SDK < 0.63.2 or resumed sessions)
      if ('oldText' in normalized && !('old_string' in normalized)) {
        normalized.old_string = normalized.oldText;
        delete normalized.oldText;
      }
      if ('newText' in normalized && !('new_string' in normalized)) {
        normalized.new_string = normalized.newText;
        delete normalized.newText;
      }
      return normalized;
    }

    if (toolName === 'Write') {
      const normalized = { ...args };
      if ('path' in normalized && !('file_path' in normalized)) {
        normalized.file_path = normalized.path;
        delete normalized.path;
      }
      return normalized;
    }

    if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') {
      const normalized = { ...args };
      if ('path' in normalized && !('file_path' in normalized)) {
        normalized.file_path = normalized.path;
        delete normalized.path;
      }
      return normalized;
    }

    return args;
  }

  /**
   * Resolve Pi tool name to PascalCase for UI consistency.
   * Pi tools use lowercase names (read, write, edit, bash, grep, find, ls).
   */
  private resolveToolName(rawName: string): string {
    return PI_TOOL_NAME_MAP[rawName] || rawName;
  }

  /**
   * Extract text content from a Pi AgentMessage.
   * Pi messages use the pi-ai Message format with content arrays.
   */
  private extractTextFromMessage(message: unknown): string | null {
    if (!message || typeof message !== 'object') return null;

    const msg = message as {
      role?: string;
      content?: string | Array<{ type: string; text?: string }>;
    };

    if (typeof msg.content === 'string') {
      return msg.content || null;
    }

    if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text!);
      return textParts.length > 0 ? textParts.join('') : null;
    }

    return null;
  }

  /**
   * Extract structured content blocks (text / image / tool-call) from a Pi
   * AgentMessage content array, preserving model order for the trajectory
   * details panel. Mirrors the VanDSH TrajectorySourceBlock shape.
   */
  private extractSourceBlocks(message: unknown): TrajectorySourceBlock[] | undefined {
    if (!message || typeof message !== 'object') return undefined;
    const msg = message as { content?: string | Array<Record<string, unknown>> };
    if (!Array.isArray(msg.content) || msg.content.length === 0) return undefined;

    const blocks: TrajectorySourceBlock[] = [];
    for (const block of msg.content) {
      const type = typeof block.type === 'string' ? block.type : 'other';
      if (type === 'text') {
        if (typeof block.text === 'string' && block.text.length > 0) {
          blocks.push({ type: 'text', content: block.text });
        }
      } else if (type === 'image') {
        const source = block.source as { type?: string; data?: string; url?: string; mediaType?: string } | undefined;
        blocks.push({
          type: 'image',
          imageSrc: typeof source?.data === 'string'
            ? `data:${source.mediaType ?? 'image/png'};base64,${source.data}`
            : typeof source?.url === 'string' ? source.url : undefined,
          imageAlt: typeof block.alt === 'string' ? block.alt : undefined,
        });
      } else if (type === 'tool_use') {
        blocks.push({
          type: 'tool-call',
          callId: typeof block.id === 'string' ? block.id : undefined,
          toolName: typeof block.name === 'string' ? block.name : undefined,
        });
      } else if (type === 'tool_result') {
        const content = block.content;
        const text = Array.isArray(content)
          ? content
            .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && typeof c.text === 'string')
            .map((c) => c.text as string)
            .join('')
          : undefined;
        blocks.push({
          type: 'tool-result',
          content: text,
          callId: typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined,
        });
      }
    }
    return blocks.length > 0 ? blocks : undefined;
  }

  /**
   * Extract a string result from Pi tool execution result.
   */
  private extractToolResult(result: unknown, isError: boolean): string {
    if (!result) {
      return isError ? 'Tool execution failed' : 'Success';
    }

    if (typeof result === 'string') return result;

    // Pi tool results follow the AgentToolResult shape: { content: [...], details: ... }
    const typed = result as {
      content?: Array<{ type: string; text?: string }>;
      details?: unknown;
    };

    if (Array.isArray(typed.content)) {
      const texts = typed.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text!);
      if (texts.length > 0) return texts.join('\n');
    }

    // Fall back to JSON
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }

  /**
   * Get a human-readable display name for a tool.
   */
  private getToolDisplayName(toolName: string): string | undefined {
    switch (toolName) {
      case 'Bash':
        return 'Run Command';
      case 'Read':
        return 'Read File';
      case 'Write':
        return 'Write File';
      case 'Edit':
        return 'Edit File';
      case 'Glob':
      case 'Find':
        return 'Search Files';
      case 'Grep':
        return 'Search Content';
      case 'Ls':
        return 'List Directory';
      default:
        return undefined;
    }
  }
}
