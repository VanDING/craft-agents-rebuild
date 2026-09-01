#!/usr/bin/env node
/**
 * Pi Agent Server
 *
 * Out-of-process Pi agent server communicating via JSONL over stdio.
 * Wraps @earendil-works/pi-coding-agent SDK and communicates with the main
 * Electron process using a line-delimited JSON protocol.
 *
 * The main process spawns this as a child process. All Pi SDK interactions
 * (session creation, prompting, tool execution, permissions) happen here,
 * with events forwarded back to the main process for UI rendering.
 *
 * This design isolates the Pi SDK's ESM + heavy dependencies into a
 * separate process, avoiding bundling issues in the Electron main process.
 */

import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { Type } from '@sinclair/typebox';

// Pi SDK
import {
  createAgentSession,
  SessionManager as PiSessionManager,
  ModelRegistry as PiModelRegistry,
  ModelRuntime,
  createReadToolDefinition,
  createBashToolDefinition,
  createPowerShellToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type {
  AgentSession,
  AgentSessionEvent,
  AgentToolResult,
  CreateAgentSessionOptions,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { AssistantMessage, Context, Credential, Model, SimpleStreamOptions } from '@earendil-works/pi-ai';
import { createAssistantMessageEventStream, InMemoryCredentialStore } from '@earendil-works/pi-ai';

// Pi AI types
import type { TextContent as PiTextContent } from '@earendil-works/pi-ai';

// Pre-register the Bedrock provider module so the Pi SDK doesn't attempt a
// dynamic import of "./amazon-bedrock.js" — which fails in the bundled output
// because bun collapses everything into a single file.
// pi-ai is deduped (single hoisted copy), so one registration covers both
// pi-ai and pi-agent-core module scopes.
import { setBedrockProviderModule } from '@earendil-works/pi-ai/api/bedrock-converse-stream.lazy';
import { bedrockProviderModule } from '@earendil-works/pi-ai/bedrock-provider';
setBedrockProviderModule(bedrockProviderModule);

// Pre-register the Pi SDK's OAuth flow modules (GitHub Copilot, xAI, Kimi,
// OpenRouter, Anthropic, …) so the SDK never attempts its lazy dynamic import
// of e.g. "./github-copilot.js" — which fails in the bundled output because
// bun collapses everything into a single file ("Cannot find module
// './github-copilot.js' from .../pi-agent-server/index.js").
// Same rationale as setBedrockProviderModule above.
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
registerBunOAuthFlows();

// Register streamSimple as the default streamFn. pi-coding-agent's sdk.js
// does this at its own module top-level, but bun's bundler drops that
// side-effect call when bundling (the ./compat export resolves lazily), so
// Agent construction would throw "No default stream function configured"
// in the bundled output. Same pattern as setBedrockProviderModule above;
// the call is idempotent.
import { setDefaultStreamFn } from '@earendil-works/pi-agent-core';
import { streamSimple } from '@earendil-works/pi-ai/compat';

function canonicalModelRequestHash(model: Model<any>, context: Context): string {
  return createHash('sha256').update(JSON.stringify({
    provider: model.provider,
    model: model.id,
    systemPrompt: context.systemPrompt,
    messages: context.messages,
    tools: context.tools?.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
  })).digest('hex');
}

function serializedContextValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

function contextValueHash(value: unknown): { hash: string; chars: number } {
  const serialized = serializedContextValue(value);
  return {
    hash: createHash('sha256').update(serialized).digest('hex'),
    chars: serialized.length,
  };
}

function buildRequestContextSnapshot(model: Model<any>, context: Context) {
  const system = contextValueHash(context.systemPrompt ?? '');
  return {
    version: 1 as const,
    capturedAt: Date.now(),
    provider: model.provider,
    model: model.id,
    system,
    messages: context.messages.map(message => ({
      role: typeof (message as { role?: unknown }).role === 'string' ? String((message as { role: string }).role) : 'unknown',
      ...contextValueHash(message),
    })),
    tools: (context.tools ?? []).map(tool => {
      const schema = contextValueHash(tool.parameters);
      return {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        hash: schema.hash,
        schemaChars: schema.chars,
      };
    }),
  };
}

function durableStreamSimple(model: Model<any>, context: Context, options?: SimpleStreamOptions) {
  const target = createAssistantMessageEventStream();
  void (async () => {
    try {
      const requestSeq = ++promptSnapshotSeq;
      rememberPromptSnapshot(requestSeq, context.systemPrompt ?? '', buildRequestContextSnapshot(model, context));
      const providerRequestId = String(requestSeq);
      const canonicalRequestHash = canonicalModelRequestHash(model, context);
      const durableRun = currentDurableModelRun();
      if (!initConfig || !durableRun) {
        const source = streamSimple(model, context, options);
        for await (const event of source) {
          if (event.type === 'done' || event.type === 'error') {
            Object.assign((event.type === 'done' ? event.message : event.error) as object, {
              durableRequestSeq: requestSeq,
            });
          }
          target.push(event);
        }
        return;
      }
      const prepared = await requestDurableModelPrepare(
        providerRequestId,
        model.provider,
        model.id,
        canonicalRequestHash,
      );
      const source = streamSimple(model, context, options);
      for await (const event of source) {
        if (event.type === 'done' || event.type === 'error') {
          const message = event.type === 'done' ? event.message : event.error;
          const committedSeq = await requestDurableModelOutcome({
            prepared,
            providerRequestId,
            provider: model.provider,
            model: model.id,
            canonicalRequestHash,
            message,
          });
          Object.assign(message as object, {
            durableOperationId: prepared.operationId,
            durableSeq: committedSeq,
            durableRequestSeq: requestSeq,
          });
          rememberDurableToolBatch(message, prepared.operationId);
        }
        target.push(event);
      }
    } catch (error) {
      const failed: AssistantMessage = {
        role: 'assistant',
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
      target.push({ type: 'error', reason: 'error', error: failed });
    }
  })();
  return target;
}

setDefaultStreamFn(durableStreamSimple);

// Model resolution (extracted for testability + custom-endpoint precedence)
import { resolvePiModel, isDeniedMiniModelId, isModelNotFoundError } from './model-resolution.ts';
import { pickProviderAppropriateMiniModel } from './pick-mini-model.ts';
import {
  buildCustomEndpointModelDef,
  normalizeCustomEndpointModelEntry,
  stripPiPrefix,
  type CustomEndpointModelEntry,
  type CustomEndpointModelOverrides,
} from './custom-endpoint-models.ts';
import {
  LENGTH_CONTINUATION_PROMPT,
  LengthContinuationTracker,
  MAX_AUTO_LENGTH_CONTINUATIONS,
} from './length-continuation.ts';

// Direct source imports from shared (bundled by bun build)
import { handleLargeResponse, estimateTokens, tokenLimitFor } from '../../shared/src/utils/large-response.ts';
import { getSessionPlansPath, getSessionPath } from '../../shared/src/sessions/storage.ts';
import { buildCallLlmRequest, withTimeout, LLM_QUERY_TIMEOUT_MS } from '../../shared/src/agent/llm-tool.ts';
import type { LLMQueryRequest, LLMQueryResult } from '../../shared/src/agent/llm-tool.ts';
import { PI_TOOL_NAME_MAP, THINKING_TO_PI } from '../../shared/src/agent/backend/pi/constants.ts';
import { getDefaultSummarizationModel } from '../../shared/src/config/models.ts';
import { createWebFetchTool } from './tools/web-fetch.ts';
import { resolveSearchProvider } from './tools/search/resolve-provider.ts';
import { createSearchTool } from './tools/search/create-search-tool.ts';
import { allowCraftMetadataProperties, stripCraftMetadata } from './craft-metadata-schema.ts';
import { createCraftResourceLoader, setCraftSystemPrompt } from './craft-resource-loader.ts';
import { guardCallbackToken } from './callback-auth.ts';
import { proxyToolDefinitionsChanged } from './proxy-tool-sync.ts';
import type { DurableCanonicalModelContext, DurableToolExecutionIdentity, ToolRecoveryMode } from '../../shared/src/durable-runtime/types.ts';
import { attachDurableToolContext, durableToolFromContext } from './durable-tool-context.ts';
import { canonicalContextToPiMessages } from './canonical-model-context.ts';
import {
  hasSupportedBaseUrlScheme,
  isLocalhostUrl,
  resolveCustomEndpointApiKeyFor,
} from './custom-endpoint-auth.ts';

// ============================================================
// Types — JSONL Protocol
// ============================================================

/** Credential union used in init and token_update messages */
type PiCredential =
  | { type: 'api_key'; key: string }
  | { type: 'oauth'; access: string; refresh: string; expires: number }
  | { type: 'iam'; accessKeyId: string; secretAccessKey: string; region?: string; sessionToken?: string };

/** Custom endpoint protocol — determines which streaming adapter Pi SDK uses */
type CustomEndpointApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

/** Init message from main process — configures the Pi agent server */
interface InitMessage {
  type: 'init';
  apiKey: string;
  model: string;
  cwd: string;
  thinkingLevel: string;
  workspaceRootPath: string;
  sessionId: string;
  sessionPath: string;
  workingDirectory: string;
  plansFolderPath: string;
  miniModel?: string;
  agentDir?: string;
  providerType?: string;
  authType?: string;
  workspaceId?: string;
  baseUrl?: string;
  branchFromSdkSessionId?: string;
  branchFromSessionPath?: string;
  branchFromSdkTurnId?: string;
  customEndpoint?: { api: CustomEndpointApi; supportsImages?: boolean };
  customModels?: Array<string | { id: string; contextWindow?: number; maxTokens?: number; supportsImages?: boolean; supportsThinking?: boolean; thinkingLevelMap?: CustomEndpointModelEntry['thinkingLevelMap'] }>;
  piAuth?: { provider: string; credential: PiCredential };
  /** Whether the browser session tool is enabled (false = exclude via SDK denylist) */
  browserToolEnabled?: boolean;
}

interface RuntimeConfigUpdateMessage {
  type: 'update_runtime_config';
  id: string;
  model: string;
  providerType?: string;
  authType?: string;
  baseUrl?: string;
  customEndpoint?: { api: CustomEndpointApi; supportsImages?: boolean };
  customModels?: Array<string | { id: string; contextWindow?: number; maxTokens?: number; supportsImages?: boolean; supportsThinking?: boolean; thinkingLevelMap?: CustomEndpointModelEntry['thinkingLevelMap'] }>;
}

/** Messages from main process (stdin) */
type InboundMessage =
  | InitMessage
  | { type: 'prompt'; id: string; message: string; systemPrompt: string; durableRunOperationId?: string; durableTurnId?: string; canonicalContext?: DurableCanonicalModelContext; images?: Array<{ type: 'image'; data: string; mimeType: string }> }
  | { type: 'sync_tools'; tools: ProxyToolDef[] }
  | { type: 'tool_execute_response'; requestId: string; result: { content: string; isError: boolean } }
  | { type: 'pre_tool_use_response'; requestId: string; action: 'allow' | 'block' | 'modify'; input?: Record<string, unknown>; reason?: string }
  | { type: 'durable_tool_prepare_response'; requestId: string; ok: boolean; prepared?: { operationId: string; idempotencyKey: string; canonicalArgsHash: string; recoveryMode: ToolRecoveryMode; created: boolean; status: string; committedSeq: number }; reason?: string }
  | { type: 'durable_tool_outcome_response'; requestId: string; ok: boolean; committedSeq?: number; reason?: string }
  | { type: 'durable_model_prepare_response'; requestId: string; ok: boolean; prepared?: { operationId: string; idempotencyKey: string; created: boolean; status: string; committedSeq: number }; reason?: string }
  | { type: 'durable_model_outcome_response'; requestId: string; ok: boolean; committedSeq?: number; reason?: string }
  | { type: 'abort' }
  | { type: 'mini_completion'; id: string; prompt: string; durableRunOperationId?: string; durableTurnId?: string }
  | { type: 'llm_query'; id: string; request: LLMQueryRequest; durableRunOperationId?: string; durableTurnId?: string }
  | { type: 'ensure_session_ready'; id: string }
  | { type: 'set_model'; model: string }
  | { type: 'set_thinking_level'; level: string }
  | { type: 'compact'; id: string; customInstructions?: string; durableRunOperationId?: string; durableTurnId?: string }
  | { type: 'set_auto_compaction'; id: string; enabled: boolean }
  | { type: 'set_browser_tool_enabled'; enabled: boolean }
  | RuntimeConfigUpdateMessage
  | { type: 'steer'; message: string }
  | { type: 'token_update'; piAuth: { provider: string; credential: PiCredential } }
  | { type: 'shutdown' };

/** Proxy tool definition from main process */
interface ProxyToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Canonical tool metadata propagated on Pi tool start events */
interface ToolExecutionMetadata {
  intent?: string;
  displayName?: string;
  source: 'interceptor';
}

type EnrichedToolExecutionStartEvent = Extract<AgentSessionEvent, { type: 'tool_execution_start' }> & {
  toolMetadata?: ToolExecutionMetadata;
  /** Wall-clock stamp (epoch ms) added at forward time for trajectory timing. */
  ts?: number;
};

/** Trajectory-enrichment fields attached at forward time (main process reads
 *  them via the typed adapter boundary; they are not part of the SDK event). */
interface TrajectoryEventAttachments {
  /** Wall-clock stamp (epoch ms) added at forward time for trajectory timing. */
  ts?: number;
  /** Server-assigned per-session request ordinal (matches prompt snapshots). */
  requestSeq?: number;
  /** Effective system prompt captured for this request. */
  promptSnapshot?: string;
  /** Content-addressed manifest of the actual request-time context. */
  contextSnapshot?: PromptSnapshot['contextSnapshot'];
}

interface SettledUsageAttachments {
  /** Authoritative current-context occupancy reported by Pi after the run settles. */
  contextUsage?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
}

type OutboundAgentEvent =
  | AgentSessionEvent
  | (EnrichedToolExecutionStartEvent & TrajectoryEventAttachments)
  | (Extract<AgentSessionEvent, { type: 'agent_settled' }> & SettledUsageAttachments);

/** Messages to main process (stdout) */
interface OutboundReady { type: 'ready'; sessionId: string | null; callbackPort: number; callbackToken: string }
interface OutboundEvent { type: 'event'; event: OutboundAgentEvent }
interface OutboundPreToolUseReq {
  type: 'pre_tool_use_request';
  requestId: string;
  toolName: string;
  toolCallId?: string;
  input: Record<string, unknown>;
}
interface OutboundToolExecReq { type: 'tool_execute_request'; requestId: string; toolName: string; args: Record<string, unknown>; durableTool?: DurableToolExecutionIdentity }
interface OutboundDurableToolPrepareReq {
  type: 'durable_tool_prepare_request';
  requestId: string;
  sessionId: string;
  turnId: string;
  runOperationId: string;
  providerToolCallId: string;
  toolBatchId?: string;
  toolBatchOrdinal?: number;
  toolName: string;
  args: Record<string, unknown>;
}
interface OutboundDurableToolOutcomeReq {
  type: 'durable_tool_outcome_request';
  requestId: string;
  sessionId: string;
  turnId: string;
  runOperationId: string;
  operationId: string;
  providerToolCallId: string;
  toolBatchId?: string;
  toolBatchOrdinal?: number;
  toolName: string;
  canonicalArgsHash: string;
  result: unknown;
  isError: boolean;
}
interface OutboundDurableModelPrepareReq {
  type: 'durable_model_prepare_request';
  requestId: string;
  sessionId: string;
  turnId: string;
  runOperationId: string;
  providerRequestId: string;
  provider: string;
  model: string;
  canonicalRequestHash: string;
}
interface OutboundDurableModelOutcomeReq {
  type: 'durable_model_outcome_request';
  requestId: string;
  sessionId: string;
  turnId: string;
  runOperationId: string;
  operationId: string;
  providerRequestId: string;
  provider: string;
  model: string;
  canonicalRequestHash: string;
  stopReason: string;
  responseId?: string;
  content: unknown;
  text?: string;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number; payload?: unknown };
}
interface OutboundSessionToolCompleted { type: 'session_tool_completed'; toolName: string; args: Record<string, unknown>; isError: boolean }
interface OutboundMiniResult { type: 'mini_completion_result'; id: string; text: string | null }
interface OutboundLlmQueryResult {
  type: 'llm_query_result';
  id: string;
  result: LLMQueryResult | null;
  errorMessage?: string;
  /**
   * When set, signals the main process that a generic `error` with the same code
   * was also emitted on the error channel (for centralized auth-refresh detection).
   */
  errorCode?: string;
}
interface OutboundEnsureSessionReadyResult { type: 'ensure_session_ready_result'; id: string; sessionId: string | null }
interface OutboundCompactResult {
  type: 'compact_result';
  id: string;
  success: boolean;
  result?: { summary: string; firstKeptEntryId: string; tokensBefore: number };
  errorMessage?: string;
}
interface OutboundSetAutoCompactionResult {
  type: 'set_auto_compaction_result';
  id: string;
  success: boolean;
  enabled: boolean;
  errorMessage?: string;
}
interface OutboundRuntimeConfigUpdateResult {
  type: 'update_runtime_config_result';
  id: string;
  success: boolean;
  updated: boolean;
  contextWindow?: number;
  errorMessage?: string;
}
interface OutboundSetModelResult {
  type: 'set_model_result';
  model: string;
  contextWindow?: number;
}
interface OutboundThinkingLevelState {
  type: 'thinking_level_state';
  effectiveLevel: string;
  availableLevels: string[];
}
interface OutboundSessionIdUpdate { type: 'session_id_update'; sessionId: string }
interface OutboundError { type: 'error'; message: string; code?: string }

type OutboundMessage =
  | OutboundReady
  | OutboundEvent
  | OutboundPreToolUseReq
  | OutboundToolExecReq
  | OutboundDurableToolPrepareReq
  | OutboundDurableToolOutcomeReq
  | OutboundDurableModelPrepareReq
  | OutboundDurableModelOutcomeReq
  | OutboundSessionToolCompleted
  | OutboundMiniResult
  | OutboundLlmQueryResult
  | OutboundEnsureSessionReadyResult
  | OutboundCompactResult
  | OutboundSetAutoCompactionResult
  | OutboundRuntimeConfigUpdateResult
  | OutboundSetModelResult
  | OutboundThinkingLevelState
  | OutboundSessionIdUpdate
  | OutboundError;

// ============================================================
// State
// ============================================================

let piSession: AgentSession | null = null;
let piModelRuntime: ModelRuntime | null = null;
let piModelRegistry: PiModelRegistry | null = null;
let moduleCredentialStore: InMemoryCredentialStore | null = null;
let unsubscribeEvents: (() => void) | null = null;
const lengthContinuationTracker = new LengthContinuationTracker();

// Init config (set on 'init' message)
let initConfig: Extract<InboundMessage, { type: 'init' }> | null = null;

// Mutable state
let currentUserMessage = '';
let currentDurableRunOperationId: string | undefined;
let currentDurableTurnId: string | undefined;
let lastCanonicalContextCursor = 0;
const durableModelRunStorage = new AsyncLocalStorage<{ runOperationId: string; turnId: string }>();

function currentDurableModelRun(): { runOperationId: string; turnId: string } | undefined {
  return durableModelRunStorage.getStore()
    ?? (currentDurableRunOperationId && currentDurableTurnId
      ? { runOperationId: currentDurableRunOperationId, turnId: currentDurableTurnId }
      : undefined);
}

function sendThinkingLevelState(): void {
  if (!piSession) return;
  send({
    type: 'thinking_level_state',
    effectiveLevel: piSession.thinkingLevel,
    availableLevels: piSession.getAvailableThinkingLevels(),
  });
}

// Pending promises for async handshakes
const pendingPreToolUse = new Map<string, { resolve: (response: { action: string; input?: Record<string, unknown>; reason?: string }) => void }>();
const pendingToolExecutions = new Map<string, { resolve: (result: { content: string; isError: boolean }) => void }>();
const pendingDurableToolPrepares = new Map<string, { resolve: (response: { ok: boolean; prepared?: PreparedDurableTool & { created: boolean; status: string }; reason?: string }) => void }>();
const pendingDurableToolOutcomes = new Map<string, { resolve: (response: { ok: boolean; committedSeq?: number; reason?: string }) => void }>();
const pendingDurableModelPrepares = new Map<string, { resolve: (response: { ok: boolean; prepared?: { operationId: string; idempotencyKey: string; created: boolean; status: string; committedSeq: number }; reason?: string }) => void }>();
const pendingDurableModelOutcomes = new Map<string, { resolve: (response: { ok: boolean; committedSeq?: number; reason?: string }) => void }>();
const durableToolCommits = new Map<string, { operationId: string; startSeq: number; outcomeSeq?: number }>();
const durableToolBatches = new Map<string, { toolBatchId: string; toolBatchOrdinal: number }>();

function rememberDurableToolBatch(message: AssistantMessage, toolBatchId: string): void {
  let ordinal = 0;
  for (const part of message.content) {
    if (part.type !== 'toolCall') continue;
    durableToolBatches.set(part.id, { toolBatchId, toolBatchOrdinal: ordinal });
    ordinal += 1;
  }
}

// Pending session MCP tool calls for completion detection
const pendingSessionToolCalls = new Map<string, { toolName: string; arguments: Record<string, unknown> }>();

// Proxy tool definitions from main process
let proxyToolDefs: ProxyToolDef[] = [];

// Speculative prefetch for read-only tools (enables parallel execution despite Pi SDK's sequential loop).
// When the LLM emits multiple call_llm tool calls in a single message, we fire all requests
// to the main process in parallel on message_end (before executeToolCalls iterates sequentially).
// Each proxy tool's execute() then hits the cache instead of sending a new request.
// Speculative dispatch used to send proxy requests before permission and before
// a durable T1 boundary. Keep it disabled until prefetch owns the same prepare
// protocol as ordinary execution; performance must not weaken effect safety.
const PREFETCHABLE_TOOLS = new Set<string>();
const prefetchCache = new Map<string, Promise<{ content: string; isError: boolean }>>();

// ============================================================
// Prompt snapshots (trajectory request-header / prompt-diff data)
// ============================================================

/** One captured request snapshot: the effective system prompt at request time. */
export interface PromptSnapshot {
  seq: number;
  prompt: string;
  contextSnapshot?: {
    version: 1;
    capturedAt: number;
    provider: string;
    model: string;
    system: { hash: string; chars: number };
    messages: Array<{ role: string; hash: string; chars: number }>;
    tools: Array<{ name: string; description?: string; hash: string; schemaChars: number }>;
  };
}

const PROMPT_SNAPSHOT_LIMIT = 50;
const promptSnapshots = new Map<number, PromptSnapshot>();

/**
 * Monotonic request ordinal. NEVER derived from `promptSnapshots.size`: once
 * the bounded ring evicts the oldest entry the size stops growing, so
 * `size + 1` would repeat seqs and collide prompt-diff keys (trajectory view
 * groups requests by seq and diffs against seq - 1).
 */
let promptSnapshotSeq = 0;

/**
 * Capture the current session's effective system prompt under the next
 * request ordinal. Returns the seq so the caller can attach it to the
 * forwarded message_end event.
 */
function rememberPromptSnapshot(seq: number, prompt: string, contextSnapshot?: PromptSnapshot['contextSnapshot']): void {
  promptSnapshots.set(seq, { seq, prompt, contextSnapshot });

  // Bounded ring: drop oldest once over the cap.
  if (promptSnapshots.size > PROMPT_SNAPSHOT_LIMIT) {
    const oldest = promptSnapshots.keys().next().value;
    if (oldest !== undefined) promptSnapshots.delete(oldest);
  }
}

function capturePromptSnapshot(session: AgentSession): number {
  const seq = ++promptSnapshotSeq;
  rememberPromptSnapshot(seq, session.systemPrompt ?? '');
  return seq;
}

/** Reset snapshot state (session teardown / init). */
function clearPromptSnapshots(): void {
  promptSnapshots.clear();
  promptSnapshotSeq = 0;
}

function isPrefetchableTool(toolName: string): boolean {
  const stripped = toolName.replace(/^(mcp__session__|session__)/, '');
  return PREFETCHABLE_TOOLS.has(stripped);
}

// Flag: proxy tools changed since last session creation — session needs recreation
let toolsChanged = false;

// Callback server for call_llm
let callbackServer: http.Server | null = null;
let callbackPort = 0;

// Per-process secret for the local callback server (audit M-2). Generated at
// startup so no other process can invoke call_llm/spawn-session without it —
// the server only listens on loopback, but any local process could otherwise
// burn the user's LLM quota.
const callbackToken = randomBytes(32).toString('hex');

// ============================================================
// JSONL I/O
// ============================================================

function send(msg: OutboundMessage): void {
  const line = JSON.stringify(msg);
  process.stdout.write(line + '\n');
}

function debugLog(message: string): void {
  // Write debug messages to stderr so they don't interfere with JSONL protocol
  process.stderr.write(`[pi-server] ${message}\n`);
}

/** Find the most recent .jsonl session file in a directory. */
function findMostRecentSessionFile(sessionDir: string): string | null {
  if (!existsSync(sessionDir)) return null;
  let best: { path: string; mtime: number } | null = null;
  for (const entry of readdirSync(sessionDir)) {
    if (!entry.endsWith('.jsonl')) continue;
    const fullPath = join(sessionDir, entry);
    const mtime = statSync(fullPath).mtimeMs;
    if (!best || mtime > best.mtime) {
      best = { path: fullPath, mtime };
    }
  }
  return best?.path ?? null;
}

// ============================================================
// Callback Server (for call_llm from session MCP server)
// ============================================================

async function startCallbackServer(): Promise<void> {
  if (callbackServer) return;

  const server = http.createServer(async (req, res) => {
    // Audit M-2: every route on this server (call_llm, spawn-session) requires
    // the per-process callback token. The server is loopback-only, but any
    // local process could otherwise POST to it and burn the user's LLM quota.
    if (!guardCallbackToken(req, res, callbackToken)) return;

    if (req.method !== 'POST' || req.url !== '/call-llm') {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;

      debugLog('Received call_llm request via callback server');
      const result = await preExecuteCallLlm(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      debugLog(`call_llm via callback failed: ${msg}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      callbackPort = typeof addr === 'object' && addr ? addr.port : 0;
      debugLog(`Callback server listening on 127.0.0.1:${callbackPort}`);
      resolve();
    });
    server.on('error', reject);
  });

  callbackServer = server;
}

function stopCallbackServer(): void {
  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
    callbackPort = 0;
  }
}

// ============================================================
// Pi Session Management
// ============================================================

function resolvedCwd(): string {
  const wd = initConfig?.cwd || initConfig?.workingDirectory || process.cwd();
  if (wd.startsWith('~/')) return join(homedir(), wd.slice(2));
  if (wd === '~') return homedir();
  return wd;
}

// Helper: derive preferCustomEndpoint flag from init config
function shouldPreferCustomEndpoint(): boolean {
  return Boolean(initConfig?.customEndpoint && initConfig?.baseUrl?.trim());
}

/**
 * Expose the active Pi model API/provider/base URL to the interceptor process.
 * This gives the interceptor a robust routing hint (instead of brittle URL-only matching).
 */
function setInterceptorApiHints(model: { api?: string; provider?: string; baseUrl?: string } | undefined): void {
  if (!model) {
    delete process.env.CRAFT_PI_MODEL_API;
    delete process.env.CRAFT_PI_MODEL_PROVIDER;
    delete process.env.CRAFT_PI_MODEL_BASE_URL;
    return;
  }

  process.env.CRAFT_PI_MODEL_API = model.api || '';
  process.env.CRAFT_PI_MODEL_PROVIDER = model.provider || '';
  process.env.CRAFT_PI_MODEL_BASE_URL = model.baseUrl || '';

  debugLog(
    `[interceptor-hint] api=${process.env.CRAFT_PI_MODEL_API || '-'} provider=${process.env.CRAFT_PI_MODEL_PROVIDER || '-'} baseUrl=${process.env.CRAFT_PI_MODEL_BASE_URL || '-'}`,
  );
}

/**
 * Resolve the API key for custom endpoint auth.
 * Loopback/link-local endpoints (Ollama, LM Studio) always get the
 * 'not-needed' placeholder — the real key must never be sent to a local
 * endpoint, even when a credential exists (audit M-4).
 */
function resolveCustomEndpointApiKey(): string {
  const key = resolveCustomEndpointApiKeyFor(initConfig);
  if (!key && initConfig?.baseUrl) {
    debugLog('[custom-endpoint] Warning: no API key found for non-localhost endpoint — requests will likely fail');
  }
  return key;
}

/** Model IDs currently registered under the custom-endpoint provider */
let customEndpointModelIds: Set<string> = new Set();

/**
 * Register (or re-register) the custom-endpoint provider with the given models.
 * Note: registerProvider replaces the entire provider, so we maintain a Set of all
 * known model IDs and always pass the full set.
 */
const customModelOverrides = new Map<string, CustomEndpointModelOverrides>();

function registerCustomEndpointModels(
  registry: PiModelRegistry,
  api: CustomEndpointApi,
  baseUrl: string,
  models: CustomEndpointModelEntry[],
): void {
  // Audit M-4: only http/https custom endpoint base URLs are supported.
  // Reject anything else with a clear error instead of letting the Pi SDK
  // attempt requests against an unsupported scheme (or worse, a file:/data:
  // URL with the user's real key attached).
  if (!hasSupportedBaseUrlScheme(baseUrl)) {
    throw new Error(
      `Custom endpoint baseUrl "${baseUrl}" uses an unsupported scheme — only http:// and https:// URLs are allowed.`,
    );
  }
  for (const m of models) {
    customEndpointModelIds.add(m.id);
    if (
      m.contextWindow !== undefined
      || m.maxTokens !== undefined
      || m.supportsImages !== undefined
      || m.supportsThinking !== undefined
      || m.thinkingLevelMap !== undefined
    ) {
      customModelOverrides.set(m.id, {
        ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
        ...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
        ...(m.supportsImages !== undefined ? { supportsImages: m.supportsImages } : {}),
        ...(m.supportsThinking !== undefined ? { supportsThinking: m.supportsThinking } : {}),
        ...(m.thinkingLevelMap !== undefined ? { thinkingLevelMap: m.thinkingLevelMap } : {}),
      });
    }
  }
  const allIds = [...customEndpointModelIds];
  registry.registerProvider('custom-endpoint', {
    baseUrl,
    apiKey: resolveCustomEndpointApiKey(),
    api,
    authHeader: true,
    models: allIds.map(id => buildCustomEndpointModelDef(
      id,
      { supportsImages: initConfig!.customEndpoint?.supportsImages === true },
      customModelOverrides.get(id),
    )),
  });
  debugLog(`Registered custom endpoint: ${baseUrl} with ${allIds.length} model(s) [${allIds.join(', ')}], api: ${api}`);
}

/**
 * Create an in-memory credential store pre-loaded with the user's credentials
 * and a ModelRuntime backed by it. Used by both the main session and
 * ephemeral queryLlm sessions.
 */
async function createAuthenticatedRuntime(): Promise<{
  credentialStore: InMemoryCredentialStore;
  modelRuntime: ModelRuntime;
  modelRegistry: PiModelRegistry;
}> {
  // Reuse module-level credential store if already created (allows token_update to mutate it).
  // Only create a new one on first call or after re-init.
  if (!moduleCredentialStore) {
    moduleCredentialStore = new InMemoryCredentialStore();
  }
  const credentialStore = moduleCredentialStore;

  // Pre-load credentials from initConfig
  if (initConfig?.piAuth) {
    const { provider, credential } = initConfig.piAuth;
    await credentialStore.modify(provider, async () => credential as unknown as Credential);
    debugLog(`Injected ${credential.type} credential for provider: ${provider}`);
  } else {
    const apiKey = initConfig?.apiKey;
    if (apiKey) {
      await credentialStore.modify('anthropic', async () => ({ type: 'api_key', key: apiKey } as Credential));
      debugLog('Injected API key into credential store (legacy fallback)');
    }
  }

  // Create ModelRuntime with our credential store
  const modelRuntime = await ModelRuntime.create({ credentials: credentialStore, allowModelNetwork: false });

  // ModelRegistry wraps ModelRuntime for backwards-compatible operations
  const modelRegistry = new PiModelRegistry(modelRuntime);

  // Register custom endpoint models dynamically via Pi SDK's registerProvider API.
  const hasCustomEndpoint = !!initConfig?.baseUrl?.trim();
  if (hasCustomEndpoint && initConfig?.customEndpoint) {
    const { api } = initConfig.customEndpoint;
    const modelEntries: CustomEndpointModelEntry[] = (initConfig.customModels?.length
      ? initConfig.customModels
      : [initConfig.model || 'default']
    ).map(normalizeCustomEndpointModelEntry);
    customEndpointModelIds = new Set();  // Reset on fresh registry creation
    customModelOverrides.clear();
    registerCustomEndpointModels(modelRegistry, api, initConfig.baseUrl!.trim(), modelEntries);
  } else if (hasCustomEndpoint && !initConfig?.customEndpoint) {
    debugLog('Custom endpoint without protocol config — models may not resolve. Set customEndpoint.api for proper routing.');
  }

  return { credentialStore, modelRuntime, modelRegistry };
}

/** Extension isolation: agent dir under the session path so no global Pi extensions from ~/.pi/agent load. */
function resolveIsolatedAgentDir(): string {
  const agentDir = initConfig!.agentDir || join(initConfig!.sessionPath, '.pi-agent');
  mkdirSync(agentDir, { recursive: true });
  return agentDir;
}

async function ensureSession(): Promise<AgentSession> {
  if (piSession) return piSession;
  if (!initConfig) throw new Error('Cannot create session: init not received');

  const cwd = resolvedCwd();

  const { modelRuntime, modelRegistry } = await createAuthenticatedRuntime();
  // Store at module scope for set_model handler
  piModelRuntime = modelRuntime;

  // Build tools: coding tools + web tools wrapped with permission hooks + proxy tools.
  // Search provider is selected based on the user's LLM connection:
  //   - OpenAI/OpenRouter → Responses API built-in web_search
  //   - ChatGPT Plus (openai-codex) → ChatGPT backend responses endpoint
  //   - Google → Gemini API with googleSearch grounding
  //   - Others → DuckDuckGo fallback
  //
  // IMPORTANT: resolve dynamically on each search call so token_update refreshes
  // are used without recreating the session.
  const searchProvider = {
    get name() {
      return resolveSearchProvider({
        ...initConfig?.piAuth,
        apiBase: initConfig?.baseUrl,
      }).name;
    },
    async search(query: string, count: number) {
      return resolveSearchProvider({
        ...initConfig?.piAuth,
        apiBase: initConfig?.baseUrl,
      }).search(query, count);
    },
  };
  const searchTool = createSearchTool(searchProvider);
  const webFetchTool = createWebFetchTool(() =>
    initConfig ? getSessionPath(initConfig.workspaceRootPath, initConfig.sessionId) : null
  );
  const webTools = [searchTool, webFetchTool];

  // Pi SDK 0.70.0 registration contract:
  //   - `customTools` accepts ToolDefinition[] — our hook-wrapped objects go here
  //   - `tools` is a string[] name allowlist — MUST include every tool we want active,
  //     otherwise Pi SDK defaults to the built-in [read, bash, edit, write] set and
  //     silently filters out everything else. Custom tool names with matching built-in
  //     names override the SDK's raw implementation inside _refreshToolRegistry, so
  //     our hooked versions take effect (permissions + large-response summarization).
  //   - Do NOT pass tool *objects* to `tools` — `allowedToolNames = new Set(options.tools)`
  //     then `.has(name)` returns false for every string lookup → zero tools active.
  const builtinDefs = [
    createReadToolDefinition(cwd),
    process.platform === 'win32'
      ? createPowerShellToolDefinition(cwd)
      : createBashToolDefinition(cwd),
    createEditToolDefinition(cwd),
    createWriteToolDefinition(cwd),
    createGrepToolDefinition(cwd),
    createFindToolDefinition(cwd),
    createLsToolDefinition(cwd),
  ];
  const proxyTools = buildProxyTools();
  // report_progress is local, read-only and intentionally bypasses the
  // permission handshake: it is a presentation channel, not an external action.
  const wrappedAll = [
    ...wrapToolsWithHooks([...builtinDefs, ...webTools, ...proxyTools]),
    createReportProgressTool(),
  ];
  const toolAllowlist = wrappedAll.map(t => t.name);
  debugLog(`Session tools: ${builtinDefs.length} builtin + ${webTools.length} web + ${proxyTools.length} proxy + 1 progress = ${wrappedAll.length} total`);

  // Build session options
  const sessionOptions: CreateAgentSessionOptions = {
    cwd,
    modelRuntime,
    customTools: wrappedAll,
    tools: toolAllowlist,
    excludeTools: initConfig.browserToolEnabled === false ? ['mcp__session__browser_tool'] : undefined,
    resourceLoader: await createCraftResourceLoader({ cwd, agentDir: resolveIsolatedAgentDir() }),
  };

  // Extension isolation: set agentDir to a temp directory under session path
  // to prevent loading global Pi extensions from ~/.pi/agent
  if (initConfig.sessionPath) {
    sessionOptions.agentDir = resolveIsolatedAgentDir();

    // Session resume: use a per-Craft-session directory so the Pi SDK can
    // persist and resume its own session across subprocess restarts.
    // continueRecent() loads the existing session if one exists, otherwise
    // creates a new one — so this handles both first-run and resume.
    const sessionDir = join(initConfig.sessionPath, '.pi-sessions');
    mkdirSync(sessionDir, { recursive: true });

    if (initConfig.branchFromSessionPath) {
      // Branching: fork from the parent session's Pi session file.
      // Branches must not silently degrade to fresh sessions.
      const parentPiSessionDir = join(initConfig.branchFromSessionPath, '.pi-sessions');
      const parentPiSessionFile = findMostRecentSessionFile(parentPiSessionDir);
      if (!parentPiSessionFile) {
        throw new Error(`Pi branch preflight failed: no parent Pi session file found in ${parentPiSessionDir}`);
      }

      debugLog(`Forking Pi session from parent: ${parentPiSessionFile}`);
      const forkedSessionManager = PiSessionManager.forkFrom(parentPiSessionFile, cwd, sessionDir);

      // Strict branch cutoff: move leaf to the selected parent entry if provided.
      // This is Pi's equivalent of Claude resumeSessionAt.
      if (initConfig.branchFromSdkTurnId) {
        const anchorId = initConfig.branchFromSdkTurnId;
        const anchorEntry = forkedSessionManager.getEntry(anchorId);
        if (!anchorEntry) {
          throw new Error(`Pi branch preflight failed: branch anchor not found: ${anchorId}`);
        }
        forkedSessionManager.branch(anchorId);
        debugLog(`Applied Pi branch cutoff at entry: ${anchorId}`);
      }

      sessionOptions.sessionManager = forkedSessionManager;
    } else {
      sessionOptions.sessionManager = PiSessionManager.continueRecent(cwd, sessionDir);
    }

  }

  // Set model if specified
  if (initConfig.model) {
    try {
      const piModel = resolvePiModel(modelRegistry, initConfig.model, initConfig.piAuth?.provider, shouldPreferCustomEndpoint());
      if (piModel) {
        // Verify resolved model's provider is compatible with the authenticated provider.
        // Without this, a model that resolves to a different provider (e.g. azure-openai-responses
        // when authed as github-copilot) would cause "No API key found" at runtime.
        const resolvedProvider = (piModel as any)?.provider;
        const isCompatible = !initConfig.piAuth ||
          resolvedProvider === initConfig.piAuth.provider ||
          resolvedProvider === 'custom-endpoint';
        if (isCompatible) {
          sessionOptions.model = piModel;
          setInterceptorApiHints(piModel as { api?: string; provider?: string; baseUrl?: string });
        } else {
          debugLog(`Model ${initConfig.model} resolved to incompatible provider ${resolvedProvider} (expected ${initConfig.piAuth!.provider}), skipping`);
          setInterceptorApiHints(undefined);
        }
      } else {
        setInterceptorApiHints(undefined);
      }
    } catch {
      debugLog(`Could not resolve Pi model: ${initConfig.model}`);
      setInterceptorApiHints(undefined);
    }
  } else {
    setInterceptorApiHints(undefined);
  }

  // Set thinking level
  const piThinkingLevel = THINKING_TO_PI[initConfig.thinkingLevel as keyof typeof THINKING_TO_PI];
  if (piThinkingLevel) {
    sessionOptions.thinkingLevel = piThinkingLevel;
  }

  // Create the session — tools flow through customTools + allowlist (see comment above).
  const { session } = await createAgentSession(sessionOptions);
  piSession = session;

  toolsChanged = false;
  debugLog(`Created Pi session: ${session.sessionId} (${wrappedAll.length} tools)`);

  // Notify main process of session ID
  send({ type: 'session_id_update', sessionId: session.sessionId });
  sendThinkingLevelState();

  return session;
}


// ============================================================
// Tool Wrapping (Permission Enforcement + Large Response Summarization)
// ============================================================

/**
 * Shared permission enforcement for both coding tools and proxy tools.
 * Checks mode-manager rules and, in Ask mode, prompts the user via the
 * pending-permissions handshake. Throws on deny or block.
 */
/**
 * Send pre_tool_use_request to main process and wait for response.
 * Returns the (potentially modified) input if approved, throws if blocked.
 * All permission checking, transforms, and source activation happen in the main process.
 */
async function requestPreToolUseApproval(
  sdkToolName: string,
  input: Record<string, unknown>,
  toolCallId?: string,
): Promise<Record<string, unknown>> {
  const requestId = `pi-ptu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  send({
    type: 'pre_tool_use_request',
    requestId,
    toolName: sdkToolName,
    ...(toolCallId ? { toolCallId } : {}),
    input,
  });

  const response = await new Promise<{ action: string; input?: Record<string, unknown>; reason?: string }>((resolve) => {
    pendingPreToolUse.set(requestId, { resolve });
  });

  if (response.action === 'block') {
    throw new Error(response.reason || `Tool "${sdkToolName}" is not allowed`);
  }

  return response.action === 'modify' && response.input ? response.input : input;
}

interface PreparedDurableTool {
  operationId: string;
  idempotencyKey: string;
  canonicalArgsHash: string;
  recoveryMode: ToolRecoveryMode;
  toolBatchId?: string;
  toolBatchOrdinal?: number;
  committedSeq: number;
}

async function requestDurableToolPrepare(
  toolName: string,
  input: Record<string, unknown>,
  toolCallId: string,
): Promise<PreparedDurableTool> {
  if (!initConfig || !currentDurableRunOperationId || !currentDurableTurnId) {
    throw new Error(`Durable tool boundary is unavailable for "${toolName}"`);
  }
  const requestId = `pi-durable-t1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const batch = durableToolBatches.get(toolCallId);
  const responsePromise = new Promise<{ ok: boolean; prepared?: PreparedDurableTool & { created: boolean; status: string }; reason?: string }>((resolve) => {
    pendingDurableToolPrepares.set(requestId, { resolve });
  });
  send({
    type: 'durable_tool_prepare_request',
    requestId,
    sessionId: initConfig.sessionId,
    turnId: currentDurableTurnId,
    runOperationId: currentDurableRunOperationId,
    providerToolCallId: toolCallId,
    ...batch,
    toolName,
    args: input,
  });
  const response = await responsePromise;
  if (!response.ok || !response.prepared) {
    throw new Error(response.reason || `Durable T1 failed for "${toolName}"`);
  }
  if (!response.prepared.created) {
    throw new Error(`Tool operation ${response.prepared.operationId} already crossed T1 and requires recovery`);
  }
  durableToolCommits.set(toolCallId, {
    operationId: response.prepared.operationId,
    startSeq: response.prepared.committedSeq,
  });
  return response.prepared;
}

async function requestDurableToolOutcome(
  prepared: PreparedDurableTool,
  toolName: string,
  toolCallId: string,
  result: unknown,
  isError: boolean,
): Promise<number> {
  if (!initConfig || !currentDurableRunOperationId || !currentDurableTurnId) {
    throw new Error(`Durable tool outcome boundary is unavailable for "${toolName}"`);
  }
  const requestId = `pi-durable-t2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const responsePromise = new Promise<{ ok: boolean; committedSeq?: number; reason?: string }>((resolve) => {
    pendingDurableToolOutcomes.set(requestId, { resolve });
  });
  send({
    type: 'durable_tool_outcome_request',
    requestId,
    sessionId: initConfig.sessionId,
    turnId: currentDurableTurnId,
    runOperationId: currentDurableRunOperationId,
    operationId: prepared.operationId,
    providerToolCallId: toolCallId,
    toolBatchId: prepared.toolBatchId,
    toolBatchOrdinal: prepared.toolBatchOrdinal,
    toolName,
    canonicalArgsHash: prepared.canonicalArgsHash,
    result,
    isError,
  });
  const response = await responsePromise;
  if (!response.ok) throw new Error(response.reason || `Durable T2 failed for "${toolName}"`);
  if (response.committedSeq === undefined) throw new Error(`Durable T2 returned no commit sequence for "${toolName}"`);
  durableToolCommits.set(toolCallId, {
    operationId: prepared.operationId,
    startSeq: prepared.committedSeq,
    outcomeSeq: response.committedSeq,
  });
  return response.committedSeq;
}

interface PreparedDurableModel {
  operationId: string;
  idempotencyKey: string;
  committedSeq: number;
}

async function requestDurableModelPrepare(
  providerRequestId: string,
  provider: string,
  model: string,
  canonicalRequestHash: string,
): Promise<PreparedDurableModel> {
  const durableRun = currentDurableModelRun();
  if (!initConfig || !durableRun) {
    throw new Error('Durable model boundary is unavailable');
  }
  const requestId = `pi-model-t1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const responsePromise = new Promise<{ ok: boolean; prepared?: PreparedDurableModel & { created: boolean; status: string }; reason?: string }>((resolve) => {
    pendingDurableModelPrepares.set(requestId, { resolve });
  });
  send({
    type: 'durable_model_prepare_request',
    requestId,
    sessionId: initConfig.sessionId,
    turnId: durableRun.turnId,
    runOperationId: durableRun.runOperationId,
    providerRequestId,
    provider,
    model,
    canonicalRequestHash,
  });
  const response = await responsePromise;
  if (!response.ok || !response.prepared) throw new Error(response.reason || 'Durable model T1 failed');
  if (!response.prepared.created) {
    throw new Error(`Model operation ${response.prepared.operationId} already crossed T1 and requires recovery`);
  }
  return response.prepared;
}

async function requestDurableModelOutcome(input: {
  prepared: PreparedDurableModel;
  providerRequestId: string;
  provider: string;
  model: string;
  canonicalRequestHash: string;
  message: AssistantMessage;
}): Promise<number> {
  const durableRun = currentDurableModelRun();
  if (!initConfig || !durableRun) {
    throw new Error('Durable model outcome boundary is unavailable');
  }
  const requestId = `pi-model-t2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const responsePromise = new Promise<{ ok: boolean; committedSeq?: number; reason?: string }>((resolve) => {
    pendingDurableModelOutcomes.set(requestId, { resolve });
  });
  send({
    type: 'durable_model_outcome_request',
    requestId,
    sessionId: initConfig.sessionId,
    turnId: durableRun.turnId,
    runOperationId: durableRun.runOperationId,
    operationId: input.prepared.operationId,
    providerRequestId: input.providerRequestId,
    provider: input.provider,
    model: input.model,
    canonicalRequestHash: input.canonicalRequestHash,
    stopReason: input.message.stopReason,
    responseId: input.message.responseId,
    content: input.message.content,
    text: input.message.content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join(''),
    usage: {
      inputTokens: input.message.usage.input,
      outputTokens: input.message.usage.output,
      costUsd: input.message.usage.cost.total,
      payload: { kind: 'model_attempt', requestSeq: Number(input.providerRequestId), usage: input.message.usage },
    },
  });
  const response = await responsePromise;
  if (!response.ok || response.committedSeq === undefined) {
    throw new Error(response.reason || 'Durable model T2 failed');
  }
  return response.committedSeq;
}

function wrapToolsWithHooks(tools: ToolDefinition<any, any>[]): ToolDefinition<any, any>[] {
  return tools.map(tool => wrapSingleTool(tool));
}

function wrapSingleTool(tool: ToolDefinition<any, any>): ToolDefinition<any, any> {
  const originalExecute = tool.execute;
  const parameters = allowCraftMetadataProperties(tool.parameters);

  const wrappedExecute: ToolDefinition<any, any>['execute'] = async (
    toolCallId,
    params,
    signal,
    onUpdate,
    ctx,
  ) => {
    const sdkToolName = PI_TOOL_NAME_MAP[tool.name] || tool.name;
    let inputObj: Record<string, unknown> = { ...(params as Record<string, unknown>) };

    // Extract intent before main process strips metadata (used for summarization)
    const intent = typeof inputObj._intent === 'string' ? inputObj._intent : undefined;

    // Normalize Pi SDK parameter names: path → file_path
    if ((sdkToolName === 'Write' || sdkToolName === 'Edit' || sdkToolName === 'MultiEdit' || sdkToolName === 'NotebookEdit')
        && typeof inputObj.path === 'string' && !inputObj.file_path) {
      inputObj = { ...inputObj, file_path: inputObj.path };
    }

    // Send to main process for permission checking + transforms
    inputObj = await requestPreToolUseApproval(sdkToolName, inputObj, toolCallId);

    // Metadata is for Craft UI only. Keep a final defensive strip here so the
    // upstream Pi tool implementation always receives clean executable args,
    // even if a future pre-tool-use path returns `allow` without modification.
    inputObj = stripCraftMetadata(inputObj);

    // T1 must commit after preflight and before the implementation is allowed to run.
    const durable = await requestDurableToolPrepare(sdkToolName, inputObj, toolCallId);

    // Execute original tool with (potentially modified) input. T2 commits before
    // the result is returned to Pi, so the next model request cannot outrun durability.
    let result: AgentToolResult<any>;
    try {
      const durableTool: DurableToolExecutionIdentity = {
        operationId: durable.operationId,
        runOperationId: currentDurableRunOperationId!,
        idempotencyKey: durable.idempotencyKey,
        canonicalArgsHash: durable.canonicalArgsHash,
        recoveryMode: durable.recoveryMode,
        toolBatchId: durable.toolBatchId,
        toolBatchOrdinal: durable.toolBatchOrdinal,
      };
      const executionContext = attachDurableToolContext(ctx, durableTool) as typeof ctx;
      result = await originalExecute(toolCallId, inputObj, signal, onUpdate, executionContext);
    } catch (error) {
      await requestDurableToolOutcome(
        durable,
        sdkToolName,
        toolCallId,
        { error: error instanceof Error ? error.message : String(error) },
        true,
      );
      throw error;
    }
    // --- Post-execute: large response summarization ---

    const resultText = result.content
      .filter((c): c is PiTextContent => c.type === 'text')
      .map(c => c.text)
      .join('');

    // Compatibility guard for legacy/custom tools that encode failure in
    // details instead of throwing. Pi only sets toolResult.isError for thrown
    // executions, so commit the durable outcome and convert it here.
    if (result.details?.isError === true) {
      await requestDurableToolOutcome(
        durable,
        sdkToolName,
        toolCallId,
        result,
        true,
      );
      throw new Error(resultText || `${sdkToolName} failed`);
    }

    // Source the active model's contextWindow each call so the threshold
    // tracks set_model mid-session, not the model that was active at session
    // creation. Falls back to the fixed default when the model isn't set yet.
    const modelContextWindow = piSession?.agent.state.model?.contextWindow;
    if (estimateTokens(resultText) > tokenLimitFor(modelContextWindow) && initConfig) {
      try {
        const sessionPath = getSessionPath(
          initConfig.workspaceRootPath,
          initConfig.sessionId,
        );

        const largeResult = await handleLargeResponse({
          text: resultText,
          sessionPath,
          context: {
            toolName: sdkToolName,
            input: inputObj,
            intent,
            userRequest: currentUserMessage,
          },
          summarize: runMiniCompletion,
          contextWindow: modelContextWindow,
        });

        if (largeResult) {
          result = {
            content: [{ type: 'text', text: largeResult.message }],
            details: result.details,
          };
        }
      } catch (error) {
        debugLog(
          `Large response handling failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Commit exactly the representation Pi will append to model context.
    await requestDurableToolOutcome(
      durable,
      sdkToolName,
      toolCallId,
      result,
      false,
    );
    return result;
  };

  return {
    ...tool,
    parameters,
    execute: wrappedExecute,
  };
}

// ============================================================
// Proxy Tools (tools executed in main process)
// ============================================================

function buildProxyTools(): ToolDefinition<any, any>[] {
  debugLog(`Building proxy tools from ${proxyToolDefs.length} definitions: ${proxyToolDefs.map(t => t.name).join(', ')}`);

  return proxyToolDefs.map<ToolDefinition<any, any>>(def => ({
    name: def.name,
    label: def.name
      .replace(/^mcp__.*?__/, '')
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2'),
    description: def.description,
    // Pi SDK omits tools without promptSnippet from the system prompt's
    // "Available tools" section, making them invisible to the LLM.
    // Derive a snippet from the description so proxy tools are listed.
    promptSnippet: def.description.length > 200
      ? def.description.slice(0, 197) + '...'
      : def.description,
    parameters: def.inputSchema,
    execute: async (
      toolCallId: string,
      params: any,
      _signal,
      _onUpdate,
      ctx,
    ): Promise<AgentToolResult<any>> => {
      // Check speculative prefetch cache first (parallel call_llm optimization).
      // If this tool was prefetched on message_end, the request is already in-flight —
      // just await the result instead of sending a duplicate request.
      const prefetched = prefetchCache.get(toolCallId);
      if (prefetched) {
        prefetchCache.delete(toolCallId);
        debugLog(`Prefetch cache hit for ${def.name} (toolCallId: ${toolCallId})`);
        const result = await prefetched;
        if (result.isError) throw new Error(result.content);
        return {
          content: [{ type: 'text', text: result.content }],
          details: undefined,
        };
      }

      const inputObj = params as Record<string, unknown>;

      // Permission checking via main process
      const approvedInput = await requestPreToolUseApproval(def.name, inputObj, toolCallId);

      // Execute via main process
      const requestId = `proxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      send({
        type: 'tool_execute_request',
        requestId,
        toolName: def.name,
        args: approvedInput,
        durableTool: durableToolFromContext(ctx),
      });

      const result = await new Promise<{ content: string; isError: boolean }>((resolve) => {
        pendingToolExecutions.set(requestId, { resolve });
      });

      if (result.isError) throw new Error(result.content);

      return {
        content: [{ type: 'text', text: result.content }],
        details: undefined,
      };
    },
  }));
}

/**
 * A first-class progress channel for agentic runs.
 *
 * Pi treats a prose-only assistant message as the end of an agent loop. Models
 * should use this tool when they need to surface an update and then keep
 * working: the tool call keeps the native Pi loop alive, while the main-process
 * event adapter renders `message` as intermediate assistant text.
 */
function createReportProgressTool(): ToolDefinition<any, any> {
  return {
    name: 'report_progress',
    label: 'Report progress',
    description: 'Show a brief progress update to the user without ending the current task. Call this only when work remains, then continue immediately with the next tool or action.',
    promptSnippet: 'Report visible progress without ending the active task.',
    parameters: Type.Object({
      message: Type.String({ description: 'A concise, user-facing progress update.' }),
    }),
    execute: async () => ({
      content: [{
        type: 'text',
        text: 'Progress delivered. Continue the task immediately; do not wait for a user reply.',
      }],
      details: undefined,
    }),
  };
}

// ============================================================
// LLM Query (ephemeral session for call_llm + mini completions)
// ============================================================

async function queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
  if (!initConfig) throw new Error('Cannot run queryLlm: init not received');

  debugLog('[queryLlm] Starting');

  // Pick mini model. If the configured miniModel uses a different provider than
  // what the user authenticated with (e.g. gemini-2.5-pro when only anthropic
  // credentials exist), fall back to the default summarization model which uses
  // the same provider family.
  let model = request.model ?? initConfig.miniModel ?? getDefaultSummarizationModel();
  // Create authenticated runtime — used by both the provider guard and the ephemeral session.
  const { modelRuntime, modelRegistry } = await createAuthenticatedRuntime();

  const piAuthProvider = initConfig.piAuth?.provider;

  // If piAuth is set, ensure the mini model uses the same provider.
  // Pi SDK will fail with "No API key found" if the model requires a different provider.
  // Exception: 'custom-endpoint' provider is always compatible because it has its own
  // API key configured via resolveCustomEndpointApiKey() and doesn't use authStorage.
  if (initConfig.piAuth) {
    const authProvider = initConfig.piAuth.provider;
    const bareModel = model.startsWith('pi/') ? model.slice(3) : model;
    const resolved = resolvePiModel(modelRegistry, bareModel, authProvider, shouldPreferCustomEndpoint());
    const resolvedProvider = (resolved as any)?.provider;
    const isCompatible = resolvedProvider === authProvider || resolvedProvider === 'custom-endpoint';
    if (!resolved || !isCompatible || isDeniedMiniModelId(model, piAuthProvider)) {
      // Anthropic: keep Haiku (the cheap/fast mini). For every other provider
      // Haiku is unresolvable, so walk PI_PREFERRED_DEFAULTS for a model that
      // actually works under the user's auth.
      const providerDefault = authProvider === 'anthropic'
        ? undefined
        : pickProviderAppropriateMiniModel(authProvider, modelRegistry, shouldPreferCustomEndpoint());
      const fallback = providerDefault ?? getDefaultSummarizationModel();
      debugLog(`[queryLlm] Model ${bareModel} incompatible with ${authProvider} (resolved: ${resolvedProvider}), falling back to ${fallback}`);
      model = fallback;
    }
  }

  const runQueryWithModel = async (modelId: string): Promise<string> => {
    debugLog(`[queryLlm] Using model: ${modelId}`);

    // Resolve model — fail fast if unresolvable so we don't let the Pi SDK
    // fall back to its own internal default (which may require a provider
    // the user hasn't authenticated with, surfacing as a misleading
    // "No API key found for <provider>" error).
    const piModel = resolvePiModel(modelRegistry, modelId, initConfig!.piAuth?.provider, shouldPreferCustomEndpoint());
    if (!piModel) {
      throw new Error(
        `Could not resolve mini model "${modelId}" for provider "${initConfig!.piAuth?.provider ?? '(unknown)'}"`,
      );
    }

    // Prompt for this ephemeral session, captured before loader creation so the
    // loader's getPrompt closure reads it (TDZ-safe) and never touches the
    // module-level prompt used by the main session.
    const promptForSession =
      request.systemPrompt ?? 'Reply with ONLY the requested text. No explanation.';

    // Create minimal ephemeral session
    const ephemeralOptions: CreateAgentSessionOptions = {
      cwd: resolvedCwd(),
      modelRuntime,
      tools: [],
      sessionManager: PiSessionManager.inMemory(),
      model: piModel,
      resourceLoader: await createCraftResourceLoader({
        cwd: resolvedCwd(),
        agentDir: resolveIsolatedAgentDir(),
        getPrompt: () => promptForSession,
      }),
    };

    const { session: ephemeralSession } = await createAgentSession(ephemeralOptions);

    // Pi SDK ignores options.model for ephemeral sessions (same issue as options.tools).
    // Explicitly set the model after creation to ensure the mini model is used.
    try {
      await ephemeralSession.setModel(piModel);
    } catch {
      debugLog(`[queryLlm] Failed to set model on ephemeral session, proceeding with default`);
    }

    debugLog(`[queryLlm] Created ephemeral session: ${ephemeralSession.sessionId}`);

    // Collect response text and errors from events
    let result = '';
    let lastError = '';
    let completionResolve: () => void;
    const completionPromise = new Promise<void>((resolve) => {
      completionResolve = resolve;
    });

    const unsub = ephemeralSession.subscribe((event: AgentSessionEvent) => {
      if (event.type === 'message_end') {
        // Only capture assistant messages — Pi SDK emits message_end for user messages too
        const msg = event.message as {
          role?: string;
          content?: string | Array<{ type: string; text?: string }>;
          stopReason?: string;
          errorMessage?: string;
        };
        if (msg.role !== 'assistant') return;

        // Capture API errors from message_end (e.g. auth failures, model errors)
        if (msg.stopReason === 'error' && msg.errorMessage) {
          lastError = msg.errorMessage;
          debugLog(`[queryLlm] API error in message_end: ${msg.errorMessage}`);
        }

        if (typeof msg.content === 'string') {
          result = msg.content;
        } else if (Array.isArray(msg.content)) {
          result = msg.content
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text!)
            .join('');
        }
      }
      if (event.type === 'agent_settled') {
        completionResolve();
      }
    });

    try {
      await ephemeralSession.prompt(request.prompt);
      await withTimeout(
        completionPromise,
        LLM_QUERY_TIMEOUT_MS,
        `queryLlm timed out after ${LLM_QUERY_TIMEOUT_MS / 1000}s`
      );
      debugLog(`[queryLlm] Result length: ${result.trim().length}`);

      // If we got no text but captured an error, throw so callers see the real issue
      if (!result.trim() && lastError) {
        throw new Error(lastError);
      }

      return result.trim();
    } finally {
      unsub();
      ephemeralSession.dispose();
    }
  };

  const fallbackCandidates = [
    // Removed 'pi/gpt-5.1-codex-mini' (#596) — stale on several OpenAI catalogs.
    // The connection-configured miniModel is still tried via `initConfig.miniModel`.
    'pi/gpt-5-mini',
    initConfig.miniModel,
    getDefaultSummarizationModel(),
  ].filter((candidate): candidate is string => !!candidate && !isDeniedMiniModelId(candidate, piAuthProvider));

  const triedModels = new Set<string>();
  let currentModel = model;

  while (true) {
    triedModels.add(currentModel);
    try {
      const text = await runQueryWithModel(currentModel);
      return { text, model: currentModel };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const shouldRetry = isModelNotFoundError(errorMsg);

      if (!shouldRetry) {
        throw error;
      }

      const retryModel = fallbackCandidates.find(candidate => {
        if (triedModels.has(candidate)) return false;
        try {
          const resolved = resolvePiModel(modelRegistry, candidate, initConfig!.piAuth?.provider, shouldPreferCustomEndpoint());
          if (!resolved) return false;
          if (initConfig!.piAuth) {
            const rp = (resolved as any).provider;
            if (rp !== initConfig!.piAuth.provider && rp !== 'custom-endpoint') {
              return false;
            }
          }
          return true;
        } catch {
          return false;
        }
      });

      if (!retryModel) {
        throw error;
      }

      debugLog(`[queryLlm] Model ${currentModel} not found, retrying with ${retryModel}`);
      currentModel = retryModel;
    }
  }
}

async function preExecuteCallLlm(input: Record<string, unknown>): Promise<LLMQueryResult> {
  const sessionPath = initConfig
    ? getSessionPath(initConfig.workspaceRootPath, initConfig.sessionId)
    : undefined;
  const request = await buildCallLlmRequest(input, { backendName: 'Pi', sessionPath });
  return queryLlm(request);
}

async function runMiniCompletion(prompt: string): Promise<string | null> {
  try {
    const result = await queryLlm({ prompt });
    const text = result.text || null;
    debugLog(`[runMiniCompletion] Result: ${text ? `"${text.slice(0, 200)}"` : 'null'}`);
    return text;
  } catch (error) {
    debugLog(`[runMiniCompletion] Failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// ============================================================
// Event Handling
// ============================================================

function extractToolExecutionMetadata(args: Record<string, unknown> | undefined): ToolExecutionMetadata | undefined {
  if (!args) return undefined;

  const intent = typeof args._intent === 'string' ? args._intent : undefined;
  const displayName = typeof args._displayName === 'string' ? args._displayName : undefined;

  if (!intent && !displayName) return undefined;

  return {
    intent,
    displayName,
    source: 'interceptor',
  };
}

function handleSessionEvent(event: AgentSessionEvent): void {
  let forwardedEvent: OutboundAgentEvent = event;
  let lengthContinuationAttempt: number | undefined;

  // Log API errors for debugging and attach provider-native turn anchor for branch cutoffs.
  if (event.type === 'message_end') {
    const msg = event.message as {
      role?: string;
      stopReason?: string;
      errorMessage?: string;
      usage?: { output?: number };
      durableOperationId?: string;
      durableSeq?: number;
      durableRequestSeq?: number;
    } | undefined;
    if (msg?.stopReason === 'error') {
      debugLog(`API error in message_end: ${msg.errorMessage || 'unknown'}`);
    }

    if (msg?.role === 'assistant' && piSession) {
      const modelMaxTokens = piSession.agent.state.model?.maxTokens;
      lengthContinuationAttempt = lengthContinuationTracker.nextAttempt(msg, modelMaxTokens);

      // CRITICAL: do NOT read `getLeafId()` here.
      //
      // The Pi SDK fires `message_end` synchronously BEFORE calling
      // `appendMessage(event.message)` (see `agent-session.js:_processAgentEvent`).
      // At this moment the assistant entry does not yet exist in the
      // SessionManager — `leafId` still points at the *previous* leaf, which for
      // a plain text turn is the user message that triggered the response.
      // Recording that wrong anchor and using it for `branch()` makes the next
      // turn a sibling of the assistant message, dropping the assistant reply
      // from the LLM's view of history (craft-agents-oss#782).
      //
      // Instead, attach a correlation id to the forwarded event so the main
      // process can correlate this turn, then queue a microtask to read the
      // correct leaf AFTER `appendMessage` has run. The microtask drains before
      // any subsequent SDK event is dispatched, so the follow-up
      // `pi_turn_anchor` event is delivered to the main process in the right
      // order (after this `message_end`, before the next event).
      //
      // SDK 0.84 assistant messages carry no `id` at message_end — only the
      // provider `responseId` (unique per assistant message, verified against
      // persisted SDK sessions). Fall back to it for correlation.
      const sdkMessageId = (msg as { id?: string }).id ?? (msg as { responseId?: string }).responseId;

      // Per-session request ordinal + system-prompt snapshot for the
      // trajectory view's request-header grouping and prompt diff. The
      // snapshot is captured here because the SDK's `systemPrompt` getter is
      // only meaningful while a session exists, and message_end is the
      // earliest point after the request completed.
      // Deliberately NOT gated on sdkMessageId: the enrichment is independent
      // of the anchor correlation and must survive providers that omit ids.
      const requestSeq = typeof msg.durableRequestSeq === 'number'
        ? msg.durableRequestSeq
        : capturePromptSnapshot(piSession);
      if (!promptSnapshots.has(requestSeq)) rememberPromptSnapshot(requestSeq, piSession.systemPrompt ?? '');
      const snapshot = promptSnapshots.get(requestSeq);
      forwardedEvent = {
        ...(event as Record<string, unknown>),
        ...(sdkMessageId ? { sdkMessageId } : {}),
        requestSeq,
        ...(msg.durableOperationId ? { durableOperationId: msg.durableOperationId } : {}),
        ...(typeof msg.durableSeq === 'number' ? { durableSeq: msg.durableSeq } : {}),
        ...(snapshot ? { promptSnapshot: snapshot.prompt } : {}),
        ...(snapshot?.contextSnapshot ? { contextSnapshot: snapshot.contextSnapshot } : {}),
      } as unknown as OutboundAgentEvent;

      if (sdkMessageId) {
        const sessionManagerSnapshot = piSession.sessionManager;
        queueMicrotask(() => {
          // Defensive: session may have been disposed between the message_end
          // emit and the microtask drain.
          if (!piSession || piSession.sessionManager !== sessionManagerSnapshot) {
            return;
          }
          const sdkTurnAnchor = sessionManagerSnapshot.getLeafId();
          if (!sdkTurnAnchor) return;
          send({
            type: 'event',
            event: {
              type: 'pi_turn_anchor',
              sdkMessageId,
              sdkTurnAnchor,
            } as unknown as OutboundAgentEvent,
          });
        });
      }

      // Speculative prefetch: if the assistant message contains 2+ prefetchable tool calls,
      // fire all requests to the main process in parallel NOW, before executeToolCalls
      // iterates sequentially. Each proxy tool's execute() will hit the cache.
      const content = (msg as { content?: Array<{ type: string; id?: string; name?: string; arguments?: unknown }> }).content;
      if (Array.isArray(content)) {
        const prefetchableToolCalls = content.filter(
          (c) => c.type === 'toolCall' && c.name && isPrefetchableTool(c.name),
        );
        if (prefetchableToolCalls.length >= 2) {
          debugLog(`Prefetching ${prefetchableToolCalls.length} parallel ${prefetchableToolCalls[0].name} calls`);
          for (const tc of prefetchableToolCalls) {
            const requestId = `prefetch-${tc.id}`;
            const promise = new Promise<{ content: string; isError: boolean }>((resolve) => {
              pendingToolExecutions.set(requestId, { resolve });
            });
            send({
              type: 'tool_execute_request',
              requestId,
              toolName: tc.name!,
              args: (tc.arguments ?? {}) as Record<string, unknown>,
            });
            prefetchCache.set(tc.id!, promise);
          }
        }
      }
    }
  }

  // Detect session MCP tool completions + enrich tool starts with canonical metadata
  if (event.type === 'tool_execution_start') {
    const toolName = event.toolName;
    if (toolName.startsWith('session__') || toolName.startsWith('mcp__session__')) {
      const mcpToolName = toolName.replace(/^(mcp__session__|session__)/, '');
      pendingSessionToolCalls.set(event.toolCallId, {
        toolName: mcpToolName,
        arguments: (event.args ?? {}) as Record<string, unknown>,
      });
    }

    const toolMetadata = extractToolExecutionMetadata((event.args ?? {}) as Record<string, unknown>);
    // Wall-clock stamp for trajectory timing (authoritative over adapter-local time).
    const durable = durableToolCommits.get(event.toolCallId);
    forwardedEvent = {
      ...event,
      ...(toolMetadata ? { toolMetadata } : {}),
      ...(durable ? { durableOperationId: durable.operationId, durableSeq: durable.startSeq } : {}),
      ts: Date.now(),
    } as unknown as OutboundAgentEvent;
  }

  if (event.type === 'tool_execution_end') {
    const durable = durableToolCommits.get(event.toolCallId);
    const pending = pendingSessionToolCalls.get(event.toolCallId);
    if (pending) {
      pendingSessionToolCalls.delete(event.toolCallId);
      send({
        type: 'session_tool_completed',
        toolName: pending.toolName,
        args: pending.arguments,
        isError: !!event.isError,
      });
    }

    // Wall-clock stamp for trajectory duration (start → end delta).
    forwardedEvent = {
      ...event,
      ...(durable?.outcomeSeq !== undefined
        ? { durableOperationId: durable.operationId, durableSeq: durable.outcomeSeq }
        : {}),
      ts: Date.now(),
    } as unknown as OutboundAgentEvent;
    durableToolCommits.delete(event.toolCallId);
    durableToolBatches.delete(event.toolCallId);
  }

  if (event.type === 'agent_settled' && piSession) {
    // Pi's value accounts for compaction and cached conversation state. Forward
    // it instead of estimating current context from the last provider response.
    forwardedEvent = {
      ...event,
      contextUsage: piSession.getContextUsage(),
    } as OutboundAgentEvent;
  }

  // Forward all events to main process
  send({ type: 'event', event: forwardedEvent });
  if (lengthContinuationAttempt !== undefined && piSession) {
    const activeSession = piSession;
    debugLog(`Output limit reached; queuing automatic continuation ${lengthContinuationAttempt}/${MAX_AUTO_LENGTH_CONTINUATIONS}`);
    void activeSession.followUp(LENGTH_CONTINUATION_PROMPT).catch(error => {
      debugLog(`Could not queue automatic length continuation: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  if (event.type === 'agent_settled') {
    durableToolBatches.clear();
    currentDurableRunOperationId = undefined;
    currentDurableTurnId = undefined;
  }
}

// ============================================================
// Command Handlers
// ============================================================

async function handleInit(msg: Extract<InboundMessage, { type: 'init' }>): Promise<void> {
  // Clean up any existing session from a previous init
  if (piSession) {
    if (unsubscribeEvents) {
      unsubscribeEvents();
      unsubscribeEvents = null;
    }
    piSession.dispose();
    piSession = null;
    moduleCredentialStore = null; // Reset so createAuthenticatedRuntime() creates fresh store
    debugLog('Cleaned up existing session for re-init');
  }

  initConfig = msg;
  clearPromptSnapshots();
  lastCanonicalContextCursor = 0;

  // Audit M-4: custom endpoint base URLs must use http/https. Reject other
  // schemes early and neutralize the config so the invalid URL is never
  // registered (and never receives a real API key). The parent is also told
  // via an error message; registerCustomEndpointModels() re-checks as a
  // second line of defense.
  if (initConfig.baseUrl && !hasSupportedBaseUrlScheme(initConfig.baseUrl)) {
    const errorMsg = `Custom endpoint baseUrl "${initConfig.baseUrl}" uses an unsupported scheme — only http:// and https:// URLs are allowed.`;
    debugLog(`[init] ${errorMsg}`);
    send({ type: 'error', message: errorMsg, code: 'invalid_base_url' });
    initConfig.baseUrl = undefined;
  }

  // Azure OpenAI requires a tenant-specific endpoint URL.
  // The Pi SDK (via Vercel AI SDK) reads AZURE_OPENAI_BASE_URL from env.
  if (initConfig.piAuth?.provider === 'azure-openai-responses' && initConfig.baseUrl) {
    process.env.AZURE_OPENAI_BASE_URL = initConfig.baseUrl;
    debugLog(`Set AZURE_OPENAI_BASE_URL=${initConfig.baseUrl}`);
  }

  // Start callback server for call_llm (idempotent — skips if already running)
  await startCallbackServer();

  send({
    type: 'ready',
    sessionId: null,
    callbackPort,
    callbackToken,
  });
}

/**
 * Wait for any in-flight compaction to finish before sending a prompt or
 * starting another compaction. Prevents a race in the Pi SDK where concurrent
 * _runAutoCompaction calls crash on a shared AbortController
 * (see craft-agents-oss#464). Default timeout matches the RPC compact timeout
 * in PiAgent.requestCompact (300 s), since GPT compactions can legitimately
 * take 60–120 s.
 */
async function waitForCompaction(session: { isCompacting: boolean }, timeoutMs = 300_000): Promise<void> {
  if (!session.isCompacting) return;
  debugLog('Waiting for in-flight compaction to finish before prompt...');
  const start = Date.now();
  while (session.isCompacting) {
    if (Date.now() - start > timeoutMs) {
      debugLog(`Compaction wait timed out after ${Math.floor(timeoutMs / 1000)}s, proceeding anyway`);
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (Date.now() - start < timeoutMs) {
    debugLog('Compaction finished, proceeding with prompt');
  }
}

async function handlePrompt(msg: Extract<InboundMessage, { type: 'prompt' }>): Promise<void> {
  lengthContinuationTracker.reset();
  currentUserMessage = msg.message;
  durableToolBatches.clear();
  currentDurableRunOperationId = msg.durableRunOperationId;
  currentDurableTurnId = msg.durableTurnId ?? msg.id;

  try {
    // If proxy tools changed since last session creation, dispose and recreate.
    // This avoids calling _buildRuntime() for dynamic tool updates — instead
    // we create a fresh session via continueRecent() with all tools known upfront.
    if (toolsChanged && piSession) {
      debugLog('Recreating session due to tool changes');
      if (unsubscribeEvents) {
        unsubscribeEvents();
        unsubscribeEvents = null;
      }
      piSession.dispose();
      piSession = null;
    }

    const session = await ensureSession();

    if (msg.canonicalContext) {
      if (!session.isIdle) {
        debugLog('[canonical-context] session is active; retaining current Pi transcript');
      } else if (msg.canonicalContext.cursor < lastCanonicalContextCursor) {
        debugLog(`[canonical-context] stale cursor ${msg.canonicalContext.cursor} < ${lastCanonicalContextCursor}; retaining Pi transcript`);
      } else {
        session.agent.state.messages = canonicalContextToPiMessages(msg.canonicalContext, session.agent.state.model);
        lastCanonicalContextCursor = msg.canonicalContext.cursor;
        debugLog(`[canonical-context] applied ${msg.canonicalContext.items.length} committed facts at cursor ${msg.canonicalContext.cursor}`);
      }
    }

    // Supply the Craft-built system prompt via the loader's before_agent_start
    // hook — re-applied every turn, surviving the SDK's per-turn reset and
    // tool-change rebuilds (see craft-resource-loader.ts).
    if (msg.systemPrompt) {
      setCraftSystemPrompt(msg.systemPrompt);
    }

    // Wire up event handler
    if (unsubscribeEvents) {
      unsubscribeEvents();
    }
    unsubscribeEvents = session.subscribe(handleSessionEvent);

    // Wait for any in-flight auto-compaction to avoid race (craft-agents-oss#464)
    await waitForCompaction(session);

    // Fire prompt — use followUp when session is already streaming so the
    // message is queued instead of throwing "Agent is already processing".
    const invokePrompt = () => session.prompt(msg.message, {
      images: msg.images && msg.images.length > 0 ? msg.images : undefined,
      streamingBehavior: 'followUp',
    });
    if (msg.durableRunOperationId) {
      await durableModelRunStorage.run({
        runOperationId: msg.durableRunOperationId,
        turnId: msg.durableTurnId ?? msg.id,
      }, invokePrompt);
    } else {
      await invokePrompt();
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // No wrapper-side overflow recovery here. The Pi SDK's _checkCompaction
    // already runs `_runAutoCompaction("overflow", true)` on overflow and
    // calls agent.continue() to retry once. Running our own session.compact()
    // in parallel raced against the SDK and is the documented cause of the
    // AbortController crash in `_runAutoCompaction` (see
    // plans/fix-pi-gpt-compaction.md). PiEventAdapter holds the Craft event
    // queue open across the SDK's recovery flow so the recovered turn
    // reaches the UI.

    debugLog(`Prompt failed: ${errorMsg}`);
    send({ type: 'error', message: errorMsg, code: 'prompt_error' });
    // Prompt failed before Pi could establish a normal run, so synthesize the
    // same terminal boundary the SDK guarantees for started runs.
    send({ type: 'event', event: { type: 'agent_settled' } });
  }
}

function handleSyncTools(msg: Extract<InboundMessage, { type: 'sync_tools' }>): void {
  if (!proxyToolDefinitionsChanged(proxyToolDefs, msg.tools)) {
    debugLog(`Proxy tool sync unchanged (${msg.tools.length} tools)`);
    return;
  }

  // Replace the full proxy set so removed/disabled source tools cannot remain
  // visible in a resumed Pi session.
  proxyToolDefs = msg.tools;
  debugLog(`Synced ${proxyToolDefs.length} proxy tools: ${proxyToolDefs.map(t => t.name).join(', ')}`);

  // Pi registers custom tool definitions at construction time. Recreate only
  // after a real definition change, never for an identical per-turn sync.
  if (piSession) {
    toolsChanged = true;
    debugLog('Proxy tool definitions changed — session will be recreated on next prompt');
  }
}

function handleSetBrowserToolEnabled(
  msg: Extract<InboundMessage, { type: 'set_browser_tool_enabled' }>,
): void {
  if (!initConfig || initConfig.browserToolEnabled === msg.enabled) return;
  initConfig.browserToolEnabled = msg.enabled;
  // Built-in denylisting is fixed at AgentSession construction. Defer the
  // rebuild to the next prompt so an in-flight turn is never interrupted.
  if (piSession) toolsChanged = true;
  debugLog(`Browser tool ${msg.enabled ? 'enabled' : 'disabled'}; session refresh queued`);
}

function handleToolExecuteResponse(msg: Extract<InboundMessage, { type: 'tool_execute_response' }>): void {
  const pending = pendingToolExecutions.get(msg.requestId);
  if (pending) {
    pendingToolExecutions.delete(msg.requestId);
    pending.resolve(msg.result);
  } else {
    debugLog(`No pending tool execution for requestId: ${msg.requestId}`);
  }
}

function handlePreToolUseResponse(msg: Extract<InboundMessage, { type: 'pre_tool_use_response' }>): void {
  const pending = pendingPreToolUse.get(msg.requestId);
  if (pending) {
    pendingPreToolUse.delete(msg.requestId);
    pending.resolve({ action: msg.action, input: msg.input, reason: msg.reason });
  } else {
    debugLog(`No pending pre_tool_use for requestId: ${msg.requestId}`);
  }
}

function handleDurableToolPrepareResponse(
  msg: Extract<InboundMessage, { type: 'durable_tool_prepare_response' }>,
): void {
  const pending = pendingDurableToolPrepares.get(msg.requestId);
  if (!pending) {
    debugLog(`No pending durable T1 for requestId: ${msg.requestId}`);
    return;
  }
  pendingDurableToolPrepares.delete(msg.requestId);
  pending.resolve({ ok: msg.ok, prepared: msg.prepared, reason: msg.reason });
}

function handleDurableToolOutcomeResponse(
  msg: Extract<InboundMessage, { type: 'durable_tool_outcome_response' }>,
): void {
  const pending = pendingDurableToolOutcomes.get(msg.requestId);
  if (!pending) {
    debugLog(`No pending durable T2 for requestId: ${msg.requestId}`);
    return;
  }
  pendingDurableToolOutcomes.delete(msg.requestId);
  pending.resolve({ ok: msg.ok, committedSeq: msg.committedSeq, reason: msg.reason });
}

function handleDurableModelPrepareResponse(
  msg: Extract<InboundMessage, { type: 'durable_model_prepare_response' }>,
): void {
  const pending = pendingDurableModelPrepares.get(msg.requestId);
  if (!pending) return;
  pendingDurableModelPrepares.delete(msg.requestId);
  pending.resolve({ ok: msg.ok, prepared: msg.prepared, reason: msg.reason });
}

function handleDurableModelOutcomeResponse(
  msg: Extract<InboundMessage, { type: 'durable_model_outcome_response' }>,
): void {
  const pending = pendingDurableModelOutcomes.get(msg.requestId);
  if (!pending) return;
  pendingDurableModelOutcomes.delete(msg.requestId);
  pending.resolve({ ok: msg.ok, committedSeq: msg.committedSeq, reason: msg.reason });
}

async function handleAbort(): Promise<void> {
  if (piSession) {
    try {
      await piSession.abort();
    } catch (error) {
      debugLog(`Abort failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Reject all pending pre-tool-use requests
  for (const [, pending] of pendingPreToolUse) {
    pending.resolve({ action: 'block', reason: 'Aborted' });
  }
  pendingPreToolUse.clear();

  // Clear speculative prefetch cache — in-flight prefetches will resolve but never be consumed
  prefetchCache.clear();
}

function runWithDurableUtilityContext<T>(
  msg: { id: string; durableRunOperationId?: string; durableTurnId?: string },
  operation: () => Promise<T>,
): Promise<T> {
  return msg.durableRunOperationId
    ? durableModelRunStorage.run({
        runOperationId: msg.durableRunOperationId,
        turnId: msg.durableTurnId ?? msg.id,
      }, operation)
    : operation();
}

async function handleMiniCompletion(msg: Extract<InboundMessage, { type: 'mini_completion' }>): Promise<void> {
  // Call queryLlm directly (not runMiniCompletion) so auth errors propagate
  // as 'error' messages instead of being swallowed and returned as null.
  // runMiniCompletion is kept for the summarize callback where null is acceptable.
  try {
    const result = await runWithDurableUtilityContext(msg, () => queryLlm({ prompt: msg.prompt }));
    send({ type: 'mini_completion_result', id: msg.id, text: result.text || null });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[handleMiniCompletion] Error: ${errorMsg}`);
    send({ type: 'error', message: errorMsg, code: 'mini_completion_error' });
  }
}

// INVARIANT: the full LLMQueryRequest shape must pass through this RPC unchanged.
// Adding a field to LLMQueryRequest? Nothing to do here — we pass `msg.request`
// to queryLlm() verbatim. But verify queryLlm() actually honors the new field;
// request-propagation + request-honoring are independent (see #596).
async function handleLlmQuery(msg: Extract<InboundMessage, { type: 'llm_query' }>): Promise<void> {
  try {
    const result = await runWithDurableUtilityContext(msg, () => queryLlm(msg.request));
    send({ type: 'llm_query_result', id: msg.id, result });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[handleLlmQuery] Error: ${errorMsg}`);
    // Dual-emit: the generic `error` channel drives main-process OAuth
    // auth-refresh detection (centralized in PiAgent), while the targeted
    // `llm_query_result` rejects the pending promise for this specific call.
    send({ type: 'error', message: errorMsg, code: 'llm_query_error' });
    send({ type: 'llm_query_result', id: msg.id, result: null, errorMessage: errorMsg, errorCode: 'llm_query_error' });
  }
}

async function handleEnsureSessionReady(msg: Extract<InboundMessage, { type: 'ensure_session_ready' }>): Promise<void> {
  const session = await ensureSession();
  send({
    type: 'ensure_session_ready_result',
    id: msg.id,
    sessionId: session.sessionId || null,
  });
}

async function handleCompact(msg: Extract<InboundMessage, { type: 'compact' }>): Promise<void> {
  try {
    const session = await ensureSession();
    // Serialize manual /compact behind any in-flight auto-compaction. Public
    // session.compact() calls agent.abort() and uses its own controller; if
    // it runs while _runAutoCompaction is suspended, agent state churns and
    // the SDK's race surface widens. Wait for the auto-compaction to drain
    // before starting a manual one. waitForCompaction has its own timeout
    // fallback so we don't deadlock on a stuck subprocess.
    await waitForCompaction(session);
    const result = await runWithDurableUtilityContext(msg, () => session.compact(msg.customInstructions));
    send({
      type: 'compact_result',
      id: msg.id,
      success: true,
      result: {
        summary: result.summary,
        firstKeptEntryId: result.firstKeptEntryId,
        tokensBefore: result.tokensBefore,
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[compact] Failed: ${errorMsg}`);
    send({
      type: 'compact_result',
      id: msg.id,
      success: false,
      errorMessage: errorMsg,
    });
  }
}

async function handleSetAutoCompaction(msg: Extract<InboundMessage, { type: 'set_auto_compaction' }>): Promise<void> {
  try {
    const session = await ensureSession();
    session.setAutoCompactionEnabled(msg.enabled);
    send({
      type: 'set_auto_compaction_result',
      id: msg.id,
      success: true,
      enabled: session.autoCompactionEnabled,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[set_auto_compaction] Failed: ${errorMsg}`);
    send({
      type: 'set_auto_compaction_result',
      id: msg.id,
      success: false,
      enabled: msg.enabled,
      errorMessage: errorMsg,
    });
  }
}

async function handleUpdateRuntimeConfig(msg: RuntimeConfigUpdateMessage): Promise<void> {
  try {
    if (!initConfig) {
      throw new Error('Runtime config update received before init');
    }

    initConfig = {
      ...initConfig,
      model: msg.model,
      providerType: msg.providerType ?? initConfig.providerType,
      authType: msg.authType ?? initConfig.authType,
      baseUrl: msg.baseUrl,
      customEndpoint: msg.customEndpoint,
      customModels: msg.customModels,
    };

    if (piModelRegistry && initConfig.baseUrl?.trim() && initConfig.customEndpoint) {
      const modelEntries: CustomEndpointModelEntry[] = (initConfig.customModels?.length
        ? initConfig.customModels
        : [initConfig.model || 'default']
      ).map(normalizeCustomEndpointModelEntry);

      customEndpointModelIds = new Set();
      customModelOverrides.clear();
      registerCustomEndpointModels(piModelRegistry, initConfig.customEndpoint.api, initConfig.baseUrl.trim(), modelEntries);
    }

    if (piSession && piModelRegistry) {
      let piModel = resolvePiModel(piModelRegistry, msg.model, initConfig.piAuth?.provider, shouldPreferCustomEndpoint());
      if (!piModel && initConfig.baseUrl?.trim() && initConfig.customEndpoint) {
        const bareId = stripPiPrefix(msg.model);
        registerCustomEndpointModels(piModelRegistry, initConfig.customEndpoint.api, initConfig.baseUrl.trim(), [{ id: bareId }]);
        piModel = piModelRegistry.find('custom-endpoint', bareId) ?? undefined;
        debugLog(`[runtime_config] Dynamically registered custom endpoint model: ${bareId}`);
      }

      if (!piModel) {
        throw new Error(`Could not resolve model after runtime update: ${msg.model}`);
      }

      await piSession.setModel(piModel);
      setInterceptorApiHints(piModel as { api?: string; provider?: string; baseUrl?: string });
      sendThinkingLevelState();
      debugLog(`[runtime_config] Updated runtime config and active model: ${piModel.provider}/${piModel.id}`);
    } else {
      debugLog('[runtime_config] Stored update; no active session/model registry yet');
    }

    const contextWindow = piSession?.agent.state.model?.contextWindow;
    send({ type: 'update_runtime_config_result', id: msg.id, success: true, updated: true, contextWindow });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[runtime_config] Failed: ${errorMsg}`);
    send({ type: 'update_runtime_config_result', id: msg.id, success: false, updated: false, errorMessage: errorMsg });
  }
}

async function handleSetModel(msg: Extract<InboundMessage, { type: 'set_model' }>): Promise<void> {
  debugLog(`[set_model] Received: ${msg.model}`);
  if (initConfig) initConfig.model = msg.model;
  if (!piSession || !piModelRegistry) {
    debugLog(`[set_model] No active session or model registry, stored for session creation`);
    return;
  }
  let piModel = resolvePiModel(piModelRegistry, msg.model, initConfig?.piAuth?.provider, shouldPreferCustomEndpoint());

  // For custom endpoints, dynamically register unknown models so mid-session switching works.
  // Uses registerCustomEndpointModels which accumulates into the existing model set
  // (registerProvider replaces, so we track all IDs and re-register the full set).
  if (!piModel && initConfig?.baseUrl?.trim() && initConfig?.customEndpoint) {
    const bareId = stripPiPrefix(msg.model);
    registerCustomEndpointModels(piModelRegistry, initConfig.customEndpoint.api, initConfig.baseUrl!.trim(), [{ id: bareId }]);
    piModel = piModelRegistry.find('custom-endpoint', bareId) ?? undefined;
    debugLog(`[set_model] Dynamically registered custom endpoint model: ${bareId}`);
  }

  if (!piModel) {
    debugLog(`[set_model] Could not resolve model: ${msg.model}`);
    setInterceptorApiHints(undefined);
    return;
  }
  try {
    await piSession.setModel(piModel);
    setInterceptorApiHints(piModel as { api?: string; provider?: string; baseUrl?: string });
    const contextWindow = piSession.agent.state.model?.contextWindow;
    send({ type: 'set_model_result', model: msg.model, contextWindow });
    sendThinkingLevelState();
    debugLog(`[set_model] Model changed to: ${msg.model} (resolved: ${piModel.provider}/${piModel.id})`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[set_model] Failed to set model: ${errorMsg}`);
  }
}

async function handleSetThinkingLevel(msg: Extract<InboundMessage, { type: 'set_thinking_level' }>): Promise<void> {
  debugLog(`[set_thinking_level] Received: ${msg.level}`);

  if (initConfig) initConfig.thinkingLevel = msg.level;

  if (!piSession) {
    debugLog('[set_thinking_level] No active session, stored for session creation');
    return;
  }

  const piLevel = THINKING_TO_PI[msg.level as keyof typeof THINKING_TO_PI];
  if (!piLevel) {
    debugLog(`[set_thinking_level] No Pi mapping for level: ${msg.level}`);
    return;
  }

  try {
    piSession.setThinkingLevel(piLevel);
    sendThinkingLevelState();
    debugLog(`[set_thinking_level] Thinking level changed to: ${msg.level} (mapped: ${piLevel})`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[set_thinking_level] Failed to set thinking level: ${errorMsg}`);
  }
}

function handleShutdown(): void {
  debugLog('Shutdown requested');

  // Unsubscribe events
  if (unsubscribeEvents) {
    unsubscribeEvents();
    unsubscribeEvents = null;
  }

  // Dispose session
  if (piSession) {
    piSession.dispose();
    piSession = null;
  }

  // Stop callback server
  stopCallbackServer();

  // Reject pending promises
  for (const [, pending] of pendingPreToolUse) {
    pending.resolve({ action: 'block', reason: 'Server shutting down' });
  }
  pendingPreToolUse.clear();

  for (const [, pending] of pendingToolExecutions) {
    pending.resolve({ content: 'Server shutting down', isError: true });
  }
  pendingToolExecutions.clear();

  process.exit(0);
}

// ============================================================
// Main JSONL Reader Loop
// ============================================================

async function processMessage(msg: InboundMessage): Promise<void> {
  switch (msg.type) {
    case 'init':
      await handleInit(msg);
      break;

    case 'prompt':
      await handlePrompt(msg);
      break;

    case 'sync_tools':
      handleSyncTools(msg);
      break;

    case 'tool_execute_response':
      handleToolExecuteResponse(msg);
      break;

    case 'pre_tool_use_response':
      handlePreToolUseResponse(msg);
      break;

    case 'durable_tool_prepare_response':
      handleDurableToolPrepareResponse(msg);
      break;

    case 'durable_tool_outcome_response':
      handleDurableToolOutcomeResponse(msg);
      break;

    case 'durable_model_prepare_response':
      handleDurableModelPrepareResponse(msg);
      break;

    case 'durable_model_outcome_response':
      handleDurableModelOutcomeResponse(msg);
      break;

    case 'abort':
      await handleAbort();
      break;

    case 'mini_completion':
      await handleMiniCompletion(msg);
      break;

    case 'llm_query':
      await handleLlmQuery(msg);
      break;

    case 'ensure_session_ready':
      await handleEnsureSessionReady(msg);
      break;

    case 'set_model':
      await handleSetModel(msg);
      break;

    case 'set_thinking_level':
      await handleSetThinkingLevel(msg);
      break;

    case 'compact':
      await handleCompact(msg);
      break;

    case 'set_auto_compaction':
      await handleSetAutoCompaction(msg);
      break;

    case 'set_browser_tool_enabled':
      handleSetBrowserToolEnabled(msg);
      break;

    case 'update_runtime_config':
      await handleUpdateRuntimeConfig(msg);
      break;

    case 'steer':
      if (piSession) {
        debugLog(`Steering with: "${msg.message.slice(0, 100)}"`);
        await piSession.steer(msg.message);
      } else {
        debugLog('Steer ignored — no active session');
      }
      break;

    case 'token_update':
      if (moduleCredentialStore) {
        const { provider, credential } = msg.piAuth;
        await moduleCredentialStore.modify(provider, async () => credential as unknown as Credential);
        if (initConfig) {
          initConfig.piAuth = msg.piAuth;
        }
        debugLog(`Updated credential for provider: ${provider}`);
      } else {
        debugLog('token_update received but no credential store initialized');
      }
      break;

    case 'shutdown':
      handleShutdown();
      break;

    default:
      debugLog(`Unknown message type: ${(msg as any).type}`);
  }
}

function main(): void {
  debugLog('Pi agent server starting');

  const rl = createInterface({ input: process.stdin });

  rl.on('line', (line: string) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line) as InboundMessage;
      processMessage(msg).catch((error) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        debugLog(`Error processing message: ${errorMsg}`);
        send({ type: 'error', message: errorMsg });
      });
    } catch (parseError) {
      debugLog(`Failed to parse JSONL: ${parseError}`);
    }
  });

  rl.on('close', () => {
    debugLog('stdin closed, shutting down');
    handleShutdown();
  });

  // Handle unexpected errors — process state is unreliable after these,
  // so we attempt to report and then exit immediately.
  // send() is wrapped in try/catch because stdout itself may be broken
  // (e.g. EFAULT from a closed pipe), and we must not let the error
  // report trigger another uncaughtException (which would loop).
  process.on('uncaughtException', (error) => {
    debugLog(`Uncaught exception: ${error.message}`);
    try {
      send({ type: 'error', message: `Uncaught exception: ${error.message}`, code: 'uncaught' });
    } catch {
      // stdout may be broken — swallow to avoid re-triggering
    }
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    debugLog(`Unhandled rejection: ${msg}`);
    try {
      send({ type: 'error', message: `Unhandled rejection: ${msg}`, code: 'unhandled_rejection' });
    } catch {
      // stdout may be broken — swallow to avoid re-triggering
    }
    process.exit(1);
  });
}

main();
