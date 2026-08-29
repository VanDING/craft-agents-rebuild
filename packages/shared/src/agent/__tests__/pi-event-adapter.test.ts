/**
 * Tests for PiEventAdapter
 *
 * Tests the Pi SDK AgentEvent / AgentSessionEvent → Craft AgentEvent conversion.
 * Each test provides mock Pi SDK event objects and verifies the AgentEvents produced.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PiEventAdapter } from '../backend/pi/event-adapter.ts';
import { toolMetadataStore } from '../../interceptor-common.ts';

// Helper: collect all events from a generator
function collect(gen: Generator<any>): any[] {
  return [...gen];
}

describe('PiEventAdapter', () => {
  let adapter: PiEventAdapter;
  let sessionDir: string;

  beforeEach(() => {
    adapter = new PiEventAdapter();
    sessionDir = mkdtempSync(join(tmpdir(), 'pi-adapter-'));
    adapter.setSessionDir(sessionDir);
    toolMetadataStore.setSessionDir(sessionDir);
    adapter.startTurn();
  });

  afterEach(() => {
    toolMetadataStore._clearForTesting();
    rmSync(sessionDir, { recursive: true, force: true });
  });

  // ============================================================
  // Agent lifecycle
  // ============================================================

  describe('agent lifecycle', () => {
    it('should emit nothing for agent_start', () => {
      const events = collect(adapter.adaptEvent({ type: 'agent_start' } as any));
      expect(events).toHaveLength(0);
    });

    it('should wait for agent_settled before emitting complete', () => {
      const events = collect(adapter.adaptEvent({ type: 'agent_end' } as any));
      expect(events).toHaveLength(0);
      expect(adapter.shouldCompleteQueue(false)).toBe(false);

      const settledEvents = collect(adapter.adaptEvent({ type: 'agent_settled' } as any));
      expect(settledEvents).toMatchObject([{ type: 'complete' }]);
      expect(adapter.shouldCompleteQueue(true)).toBe(true);
    });

    it('should forward Pi context usage at the settled boundary', () => {
      const events = collect(adapter.adaptEvent({
        type: 'agent_settled',
        contextUsage: { tokens: 42_000, contextWindow: 200_000, percent: 21 },
      } as any));

      expect(events).toEqual([
        { type: 'usage_update', usage: { inputTokens: 42_000, contextWindow: 200_000 } },
        { type: 'complete' },
      ]);
    });

    it('should preserve settled context usage in the terminal complete event', () => {
      collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: 'Done',
          usage: {
            input: 80_000,
            output: 500,
            cacheRead: 10_000,
            cacheWrite: 1_000,
            cost: { total: 0.25 },
          },
        },
      } as any));

      const events = collect(adapter.adaptEvent({
        type: 'agent_settled',
        contextUsage: { tokens: 42_000, contextWindow: 200_000, percent: 21 },
      } as any));

      expect(events.at(-1)).toMatchObject({
        type: 'complete',
        usage: {
          inputTokens: 42_000,
          outputTokens: 500,
          contextWindow: 200_000,
        },
      });
    });
  });

  // ============================================================
  // Turn lifecycle
  // ============================================================

  describe('turn lifecycle', () => {
    it('should set currentTurnId on turn_start', () => {
      // turn_start is handled internally — emits no events
      const events = collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      expect(events).toHaveLength(0);
    });

    it('should emit nothing on turn_end', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({ type: 'turn_end' } as any));
      expect(events).toHaveLength(0);
    });

    it('should generate sequential turn IDs across turns', () => {
      // First turn (turnIndex=1 from beforeEach startTurn)
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events1 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Hello' },
      } as any));
      expect(events1[0].turnId).toMatch(/^pi-turn-1/);

      // End first turn, start second
      collect(adapter.adaptEvent({ type: 'turn_end' } as any));
      adapter.startTurn();
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      const events2 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'World' },
      } as any));
      expect(events2[0].turnId).toMatch(/^pi-turn-2/);
    });
  });

  // ============================================================
  // Message events — text streaming
  // ============================================================

  describe('message events', () => {
    it('should emit nothing for message_start', () => {
      const events = collect(adapter.adaptEvent({ type: 'message_start' } as any));
      expect(events).toHaveLength(0);
    });

    it('should emit text_delta for message_update with text_delta', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'text_delta',
        text: 'Hello',
      });
      expect(events[0].turnId).toMatch(/^pi-turn-1__m0$/);
    });

    it('should skip message_update without text_delta type', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'usage_delta', delta: null },
      } as any));
      expect(events).toHaveLength(0);
    });

    it('should skip message_update with empty delta', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: '' },
      } as any));
      expect(events).toHaveLength(0);
    });

    it('should reuse same sub-turnId for consecutive deltas', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      const events1 = collect(adapter.adaptEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
      } as any));
      const events2 = collect(adapter.adaptEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: ' World' },
      } as any));

      expect(events1[0].turnId).toBe(events2[0].turnId);
    });

    it('should emit text_complete for final assistant message_end', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Hello there' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'text_complete',
        text: 'Hello there',
        isIntermediate: false,
      });
    });

    it('should attach sdkMessageId from message_end onto the text_complete', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        sdkMessageId: 'msg_pi_abc123',
        message: { role: 'assistant', stopReason: 'stop', content: 'Anchored output', id: 'msg_pi_abc123' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'text_complete',
        text: 'Anchored output',
        sdkMessageId: 'msg_pi_abc123',
      });
      // sdkTurnAnchor is delivered separately by a follow-up pi_turn_anchor event.
      expect((events[0] as { sdkTurnAnchor?: string }).sdkTurnAnchor).toBeUndefined();
    });

    it('should preserve the committed model T2 cursor on text_complete', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        durableOperationId: 'modelop_1',
        durableSeq: 42,
        requestSeq: 3,
        message: { role: 'assistant', stopReason: 'stop', content: 'Durable output' },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'text_complete',
        durableOperationId: 'modelop_1',
        durableSeq: 42,
        requestSeq: 3,
      });
    });

    it('should fall back to responseId when message_end carries no id (SDK 0.84 shape)', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      // SDK 0.84 assistant messages at message_end have no `id` — only the
      // provider responseId (pi-agent-server forwards the same fallback).
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Anchored output', responseId: 'resp_abc123' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'text_complete',
        text: 'Anchored output',
        sdkMessageId: 'resp_abc123',
      });
    });

    it('should forward pi_turn_anchor events as Craft AgentEvents', () => {
      const events = collect(adapter.adaptEvent({
        type: 'pi_turn_anchor',
        sdkMessageId: 'msg_pi_abc123',
        sdkTurnAnchor: 'entry_abc123',
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'pi_turn_anchor',
        sdkMessageId: 'msg_pi_abc123',
        sdkTurnAnchor: 'entry_abc123',
      });
    });

    it('should drop pi_turn_anchor events with missing fields', () => {
      // No sdkTurnAnchor — useless to consumers.
      const e1 = collect(adapter.adaptEvent({
        type: 'pi_turn_anchor',
        sdkMessageId: 'msg_pi_abc123',
      } as any));
      expect(e1).toHaveLength(0);
      // No sdkMessageId — cannot correlate.
      const e2 = collect(adapter.adaptEvent({
        type: 'pi_turn_anchor',
        sdkTurnAnchor: 'entry_abc123',
      } as any));
      expect(e2).toHaveLength(0);
    });

    it('should skip non-assistant message_end', () => {
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'user', content: 'Hello' },
      } as any));
      expect(events).toHaveLength(0);
    });

    it('should skip toolResult message_end', () => {
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'toolResult', content: 'result' },
      } as any));
      expect(events).toHaveLength(0);
    });

    it('should extract text from content array', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: [
            { type: 'text', text: 'Part 1' },
            { type: 'text', text: ' Part 2' },
          ],
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].text).toBe('Part 1 Part 2');
    });

    it('should skip message_end with no text content', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: [{ type: 'tool_use', id: 'tool1' }],
        },
      } as any));
      expect(events).toHaveLength(0);
    });
  });

  // ============================================================
  // Intermediate vs final text classification
  // ============================================================

  describe('intermediate text classification', () => {
    it('should set isIntermediate: true when stopReason is toolUse', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'toolUse',
          content: 'Let me check that...',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'text_complete',
        text: 'Let me check that...',
        isIntermediate: true,
      });
    });

    it('preserves length-limited output as intermediate and reports an incomplete turn at settle', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const messageEvents = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'length',
          content: 'Partial answer',
        },
      } as any));
      expect(messageEvents).toEqual([
        expect.objectContaining({ type: 'text_complete', text: 'Partial answer', isIntermediate: true }),
      ]);

      const settledEvents = collect(adapter.adaptEvent({ type: 'agent_settled' } as any));
      expect(settledEvents).toEqual([
        expect.objectContaining({ type: 'error', message: expect.stringContaining('token limit') }),
        expect.objectContaining({ type: 'complete' }),
      ]);
    });

    it('clears a held length error when Pi continues to a complete response', () => {
      collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'length', content: [] },
      } as any));
      collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Recovered' },
      } as any));

      expect(collect(adapter.adaptEvent({ type: 'agent_settled' } as any)))
        .toEqual([expect.objectContaining({ type: 'complete' })]);
    });

    it('should set isIntermediate: false when stopReason is stop', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: 'Here is the final answer.',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'text_complete',
        text: 'Here is the final answer.',
        isIntermediate: false,
      });
    });

    it('attaches the current response usage and cost to text_complete', () => {
      const usage = {
        input: 1_200,
        output: 80,
        cacheRead: 300,
        cacheWrite: 20,
        totalTokens: 1_600,
        cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.001, total: 0.032 },
      };
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: 'Priced response',
          usage,
        },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'text_complete',
        usage: { cost: { total: 0.032 } },
      });
    });

    it('should allow multiple intermediate messages in a turn', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // First intermediate message
      const events1 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'toolUse',
          content: 'Let me read the file...',
        },
      } as any));

      // Simulate tool execution between intermediates
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'tool1',
        toolName: 'read',
        args: { path: '/foo.ts' },
      } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 'tool1',
        result: 'file content',
        isError: false,
      } as any));

      // Second intermediate message
      const events2 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'toolUse',
          content: 'Now let me check the tests...',
        },
      } as any));

      expect(events1).toHaveLength(1);
      expect(events1[0].isIntermediate).toBe(true);

      expect(events2).toHaveLength(1);
      expect(events2[0].isIntermediate).toBe(true);
    });

    it('should block duplicate final messages in same turn', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // First final message
      const events1 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: 'Final answer',
        },
      } as any));

      // Duplicate final message (should be blocked)
      const events2 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: 'Duplicate final',
        },
      } as any));

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(0);
    });

    it('should allow final message after tool completion resets state', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // Intermediate message
      collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'toolUse', content: 'Checking...' },
      } as any));

      // Tool execution
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'tool1',
        toolName: 'read',
        args: {},
      } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 'tool1',
        result: 'output',
        isError: false,
      } as any));

      // Final message after tool — should work because tool_execution_end resets hasEmittedFinalText
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Here is the answer.' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].isIntermediate).toBe(false);
    });
  });

  // ============================================================
  // Sub-turnId isolation
  // ============================================================

  describe('sub-turnId isolation', () => {
    it('should generate unique sub-turnIds for text blocks', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // First text block
      const events1 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'toolUse', content: 'First' },
      } as any));

      // Tool between text blocks
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'read',
        args: {},
      } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 't1',
        result: 'ok',
        isError: false,
      } as any));

      // Second text block
      const events2 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Second' },
      } as any));

      expect(events1[0].turnId).not.toBe(events2[0].turnId);
      expect(events1[0].turnId).toMatch(/^pi-turn-1__m/);
      expect(events2[0].turnId).toMatch(/^pi-turn-1__m/);
    });

    it('should use streaming sub-turnId when deltas preceded text_complete', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // Stream deltas first
      const deltaEvents = collect(adapter.adaptEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
      } as any));

      // Then text_complete
      const completeEvents = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Hello world' },
      } as any));

      // text_complete should reuse the delta's sub-turnId
      expect(completeEvents[0].turnId).toBe(deltaEvents[0].turnId);
    });

    it('should reset sub-turnId counter across turns', () => {
      // First turn
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events1 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Turn 1' },
      } as any));

      // End turn, start new one
      collect(adapter.adaptEvent({ type: 'turn_end' } as any));
      adapter.startTurn();
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      const events2 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Turn 2' },
      } as any));

      // Sub-turn counter resets: both should end with m0
      expect(events1[0].turnId).toBe('pi-turn-1__m0');
      expect(events2[0].turnId).toBe('pi-turn-2__m0');
    });
  });

  // ============================================================
  // Error surfacing
  // ============================================================

  describe('error surfacing', () => {
    it('should emit plain error for unclassified error messages', () => {
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'Something went wrong internally',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'error',
        message: 'Something went wrong internally',
      });
    });

    it('should emit typed_error for raw HTML proxy pages', () => {
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: '<html><head><title>400 Bad Request</title></head><body><center><h1>400 Bad Request</h1></center><hr><center>cloudflare</center></body></html>',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('typed_error');
      expect((events[0] as any).error.code).toBe('proxy_error');
      expect((events[0] as any).error.message.toLowerCase()).not.toContain('<html');
    });

    it('should emit typed_error for auth-expiry error messages', () => {
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'Provided authentication token is expired. Please try signing in again.',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('typed_error');
      expect(events[0].error.code).toBe('expired_oauth_token');
    });

    it('should emit typed_error for 401 unauthorized errors', () => {
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: '401 Unauthorized',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('typed_error');
      expect(events[0].error.code).toBe('invalid_api_key');
    });

    it('should emit typed_error for billing/402 errors', () => {
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: '402 Payment required',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('typed_error');
      expect(events[0].error.code).toBe('billing_error');
    });

    it('should emit typed_error for rate limit errors', () => {
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: '429 Too many requests - rate limit exceeded',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('typed_error');
      expect(events[0].error.code).toBe('rate_limited');
    });

    it('should not emit error without errorMessage even if stopReason is error', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          // No errorMessage — fall through to normal text extraction
          content: 'Some partial content',
        },
      } as any));

      // Should emit as text_complete, not error
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('text_complete');
    });
  });

  // ============================================================
  // Tool events
  // ============================================================

  describe('tool events', () => {
    it('renders report_progress as intermediate text and suppresses its internal tool result', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const startEvents = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'progress-1',
        toolName: 'report_progress',
        args: { message: 'I found the cause; now I am applying the fix.' },
      } as any));

      expect(startEvents).toMatchObject([{
        type: 'text_complete',
        text: 'I found the cause; now I am applying the fix.',
        isIntermediate: true,
      }]);

      const endEvents = collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 'progress-1',
        toolName: 'report_progress',
        result: { content: [{ type: 'text', text: 'Progress delivered.' }] },
        isError: false,
      } as any));
      expect(endEvents).toHaveLength(0);
    });

    it('should emit tool_start for tool_execution_start', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_123',
        toolName: 'bash',
        args: { command: 'ls -la', description: 'List files' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolName: 'Bash',
        toolUseId: 'call_123',
        input: { command: 'ls -la', description: 'List files' },
        displayName: 'Run Command',
      });
    });

    it('should fallback to args metadata when store has no entry', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_no_store',
        toolName: 'bash',
        args: {
          command: 'npm test',
          _intent: 'Run unit tests',
          _displayName: 'Run Tests',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolName: 'Bash',
        toolUseId: 'call_no_store',
        intent: 'Run unit tests',
        displayName: 'Run Tests',
      });
    });

    it('should preserve edits[] for Pi edit tools while deriving legacy diff fields', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_edit',
        toolName: 'edit',
        args: {
          path: '/src/app.ts',
          edits: [
            { oldText: 'const a = 1', newText: 'const a = 2' },
            { oldText: 'const b = 1', newText: 'const b = 2' },
          ],
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolName: 'Edit',
        toolUseId: 'call_edit',
        input: {
          file_path: '/src/app.ts',
          old_string: 'const a = 1',
          new_string: 'const a = 2',
          edits: [
            { oldText: 'const a = 1', newText: 'const a = 2' },
            { oldText: 'const b = 1', newText: 'const b = 2' },
          ],
        },
      });
    });

    it('should prefer store metadata over args metadata when both exist', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      toolMetadataStore.set('call_store_wins', {
        intent: 'Stored intent',
        displayName: 'Stored name',
        timestamp: Date.now(),
      });

      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_store_wins',
        toolName: 'bash',
        args: {
          command: 'npm test',
          _intent: 'Args intent',
          _displayName: 'Args name',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolUseId: 'call_store_wins',
        intent: 'Stored intent',
        displayName: 'Stored name',
      });
    });

    it('should use canonical metadata from event payload', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_canonical',
        toolName: 'bash',
        args: { command: 'npm test' },
        toolMetadata: {
          intent: 'Canonical intent',
          displayName: 'Canonical name',
          source: 'interceptor',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolUseId: 'call_canonical',
        intent: 'Canonical intent',
        displayName: 'Canonical name',
      });
    });

    it('should fallback to base id metadata when toolCallId includes a pipe suffix', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      toolMetadataStore.set('call_base_id', {
        intent: 'Stored base intent',
        displayName: 'Stored base name',
        timestamp: Date.now(),
      });

      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_base_id|fc_123',
        toolName: 'bash',
        args: { command: 'npm test' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolUseId: 'call_base_id|fc_123',
        intent: 'Stored base intent',
        displayName: 'Stored base name',
      });
    });

    it('should prefer canonical metadata over store and args', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      toolMetadataStore.set('call_canonical_wins', {
        intent: 'Stored intent',
        displayName: 'Stored name',
        timestamp: Date.now(),
      });

      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_canonical_wins',
        toolName: 'bash',
        args: {
          command: 'npm test',
          _intent: 'Args intent',
          _displayName: 'Args name',
        },
        toolMetadata: {
          intent: 'Canonical intent',
          displayName: 'Canonical name',
          source: 'interceptor',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolUseId: 'call_canonical_wins',
        intent: 'Canonical intent',
        displayName: 'Canonical name',
      });
    });

    it('should resolve Pi lowercase tool names to PascalCase', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      const toolTests = [
        { piName: 'read', expected: 'Read' },
        { piName: 'write', expected: 'Write' },
        { piName: 'edit', expected: 'Edit' },
        { piName: 'grep', expected: 'Grep' },
        { piName: 'find', expected: 'Find' },
        { piName: 'ls', expected: 'Ls' },
      ];

      for (const { piName, expected } of toolTests) {
        const events = collect(adapter.adaptEvent({
          type: 'tool_execution_start',
          toolCallId: `call_${piName}`,
          toolName: piName,
          args: {},
        } as any));

        expect(events[0].toolName).toBe(expected);
      }
    });

    it('should emit tool_result for tool_execution_end', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // Start tool first
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'read',
        args: { path: '/foo.ts' },
      } as any));

      // End tool
      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        result: { content: [{ type: 'text', text: 'file contents' }] },
        isError: false,
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_result',
        toolUseId: 'call_1',
        toolName: 'Read',
        result: 'file contents',
        isError: false,
      });
    });

    it('should handle string result in tool_execution_end', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'bash',
        args: {},
      } as any));

      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        result: 'command output',
        isError: false,
      } as any));

      expect(events[0].result).toBe('command output');
    });

    it('should handle error tool results', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'bash',
        args: {},
      } as any));

      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        result: null,
        isError: true,
      } as any));

      expect(events[0]).toMatchObject({
        type: 'tool_result',
        isError: true,
        result: 'Tool execution failed',
      });
    });

    it('should accumulate partial output from tool_execution_update', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'bash',
        args: {},
      } as any));

      // Partial updates
      collect(adapter.adaptEvent({
        type: 'tool_execution_update',
        toolCallId: 'call_1',
        partialResult: { content: [{ type: 'text', text: 'line 1\n' }] },
      } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_update',
        toolCallId: 'call_1',
        partialResult: { content: [{ type: 'text', text: 'line 2\n' }] },
      } as any));

      // End — should use accumulated output
      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        result: 'ignored because accumulated',
        isError: false,
      } as any));

      expect(events[0].result).toBe('line 1\nline 2\n');
    });

    it('should use description as intent for bash tools', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'bash',
        args: { command: 'npm test', description: 'Run unit tests' },
      } as any));

      expect(events[0].intent).toBe('Run unit tests');
    });

    it('should classify bash cat commands as Read tool starts', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'bash',
        args: { command: 'cat /path/to/file.ts' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].toolName).toBe('Read');
      expect(events[0].displayName).toBe('Read File');
    });

    it('should reset hasEmittedFinalText after tool_execution_end', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // Emit final text
      collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'toolUse', content: 'Checking...' },
      } as any));

      // Tool execution
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'read',
        args: {},
      } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 't1',
        result: 'ok',
        isError: false,
      } as any));

      // Another text after tool — should succeed
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Done!' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].text).toBe('Done!');
    });
  });

  // ============================================================
  // Session-level events
  // ============================================================

  describe('session events', () => {
    it('should emit status for compaction_start', () => {
      const events = collect(adapter.adaptEvent({
        type: 'compaction_start',
        reason: 'context_window_exceeded',
      } as any));

      // Structured event for the trajectory view + user-facing status.
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: 'compaction_start',
        reason: 'context_window_exceeded',
      });
      expect(events[1]).toMatchObject({
        type: 'status',
        message: 'Compacting context...',
      });
    });

    it('should emit info for successful compaction_end', () => {
      const events = collect(adapter.adaptEvent({
        type: 'compaction_end',
        result: { /* compaction result */ },
        aborted: false,
      } as any));

      // Structured outcome for the trajectory view + user-facing info.
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: 'compaction_end',
        aborted: false,
      });
      expect(events[1]).toMatchObject({
        type: 'info',
        message: 'Compacted context to fit within limits',
      });
    });

    it('should emit error for failed compaction_end', () => {
      const events = collect(adapter.adaptEvent({
        type: 'compaction_end',
        result: null,
        aborted: false,
        errorMessage: 'Out of memory',
      } as any));

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: 'compaction_end',
        aborted: false,
        errorMessage: 'Out of memory',
      });
      expect(events[1]).toMatchObject({
        type: 'error',
        message: 'Context compaction failed: Out of memory',
      });
    });

    it('emits only the structured outcome for aborted compaction', () => {
      const events = collect(adapter.adaptEvent({
        type: 'compaction_end',
        result: null,
        aborted: true,
      } as any));

      // No user-facing status/error — but the trajectory view still gets
      // the structured outcome for every terminal compaction state.
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'compaction_end',
        aborted: true,
      });
    });

    it('should emit status for auto_retry_start', () => {
      const events = collect(adapter.adaptEvent({
        type: 'auto_retry_start',
        attempt: 2,
        maxAttempts: 3,
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'status',
        message: 'Retrying (attempt 2/3)...',
      });
    });

    it('should emit error for failed auto_retry_end', () => {
      const events = collect(adapter.adaptEvent({
        type: 'auto_retry_end',
        success: false,
        finalError: 'Max retries exceeded',
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'error',
        message: 'Retry failed: Max retries exceeded',
      });
    });

    it('should emit nothing for successful auto_retry_end', () => {
      const events = collect(adapter.adaptEvent({
        type: 'auto_retry_end',
        success: true,
      } as any));

      expect(events).toHaveLength(0);
    });

    it('should emit nothing for queue_update', () => {
      const events = collect(adapter.adaptEvent({
        type: 'queue_update',
        steering: ['Focus on tests'],
        followUp: ['Then summarize the diff'],
      } as any));

      expect(events).toHaveLength(0);
    });
  });

  // ============================================================
  // Full multi-turn flow
  // ============================================================

  describe('full multi-turn flow', () => {
    it('should handle intermediate → tool → final message flow', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // 1. Intermediate commentary
      const intermediateEvents = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'toolUse',
          content: 'Let me check the file...',
        },
      } as any));

      // 2. Tool execution
      const toolStartEvents = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'read',
        args: { path: '/src/index.ts' },
      } as any));

      const toolEndEvents = collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        result: 'file contents here',
        isError: false,
      } as any));

      // 3. Final response
      const finalEvents = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: 'The file contains your code.',
        },
      } as any));

      // Verify complete flow
      expect(intermediateEvents[0]).toMatchObject({
        type: 'text_complete',
        isIntermediate: true,
        text: 'Let me check the file...',
      });
      expect(toolStartEvents[0]).toMatchObject({
        type: 'tool_start',
        toolName: 'Read',
      });
      expect(toolEndEvents[0]).toMatchObject({
        type: 'tool_result',
        toolName: 'Read',
      });
      expect(finalEvents[0]).toMatchObject({
        type: 'text_complete',
        isIntermediate: false,
        text: 'The file contains your code.',
      });

      // All events should have pi-turn-1 prefix
      expect(intermediateEvents[0].turnId).toMatch(/^pi-turn-1/);
      expect(toolStartEvents[0].turnId).toMatch(/^pi-turn-1/);
      expect(finalEvents[0].turnId).toMatch(/^pi-turn-1/);
    });
  });

  // ============================================================
  // Overflow recovery at Pi's settled boundary
  // ============================================================
  //
  // The Pi SDK's _checkCompaction fires _runAutoCompaction("overflow", true)
  // on context_length_exceeded, then agent.continue() to retry. The recovered
  // turn arrives AFTER the original agent_end. Pi 0.84.4 emits agent_settled
  // only after that recovery/retry/continuation work has finished.

  describe('overflow recovery', () => {
    const overflowMessage = {
      role: 'assistant',
      stopReason: 'error',
      errorMessage: 'Your input exceeds the context window of this model. Please adjust your input and try again. (context_length_exceeded)',
    };

    it('success path: holds queue open, surfaces recovered turn, completes once', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // 1. Overflow message_end — adapter swallows the error.
      const errEvents = collect(adapter.adaptEvent({
        type: 'message_end',
        message: overflowMessage,
      } as any));
      expect(errEvents).toHaveLength(0);

      // 2. Original agent_end — one loop ended, but the run is not settled.
      const heldAgentEnd = collect(adapter.adaptEvent({ type: 'agent_end' } as any));
      expect(heldAgentEnd).toHaveLength(0);
      expect(adapter.shouldCompleteQueue(false)).toBe(false);

      // 3. compaction_start — structured event + status surfaces.
      const startEvents = collect(adapter.adaptEvent({ type: 'compaction_start' } as any));
      expect(startEvents.map(e => e.type)).toEqual(['compaction_start', 'status']);
      expect(startEvents[1]).toMatchObject({ type: 'status', message: 'Compacting context...' });

      // 4. compaction_end success — structured outcome + info surfaces, still no complete.
      const endEvents = collect(adapter.adaptEvent({
        type: 'compaction_end',
        result: { /* compaction result */ },
        aborted: false,
      } as any));
      expect(endEvents.map(e => e.type)).toEqual(['compaction_end', 'info']);
      expect(endEvents[1]).toMatchObject({ type: 'info', message: 'Compacted context to fit within limits' });
      expect(adapter.shouldCompleteQueue(false)).toBe(false);

      // 5. Recovered text + final agent_end still do not complete Craft.
      const recoveredText = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Recovered answer' },
      } as any));
      expect(recoveredText).toMatchObject([{ type: 'text_complete', text: 'Recovered answer' }]);

      const finalAgentEnd = collect(adapter.adaptEvent({ type: 'agent_end' } as any));
      expect(finalAgentEnd).toHaveLength(0);
      expect(adapter.shouldCompleteQueue(false)).toBe(false);

      const settledEvents = collect(adapter.adaptEvent({ type: 'agent_settled' } as any));
      expect(settledEvents).toMatchObject([{ type: 'complete' }]);
      expect(adapter.shouldCompleteQueue(true)).toBe(true);

      // The original context_length_exceeded never reached the UI.
      const allYields = [...errEvents, ...heldAgentEnd, ...startEvents, ...endEvents, ...recoveredText, ...finalAgentEnd, ...settledEvents];
      const errorYields = allYields.filter(e => e.type === 'error' || e.type === 'typed_error');
      expect(errorYields).toHaveLength(0);
    });

    it('keeps a post-tool threshold compaction inside the active run', () => {
      const allEvents: any[] = [];
      const push = (event: any) => allEvents.push(...collect(adapter.adaptEvent(event)));

      push({ type: 'turn_start' });
      push({
        type: 'tool_execution_start',
        toolCallId: 'large-read',
        toolName: 'read',
        args: { path: '/tmp/large.txt' },
      });
      push({
        type: 'tool_execution_end',
        toolCallId: 'large-read',
        toolName: 'read',
        result: { content: [{ type: 'text', text: 'large tool result' }], details: {} },
        isError: false,
      });
      push({ type: 'turn_end', message: { role: 'assistant' }, toolResults: [] });

      // Pi 0.84.4 compacts here, before the next provider request in the same run.
      push({ type: 'compaction_start', reason: 'threshold' });
      push({ type: 'compaction_end', reason: 'threshold', result: {}, aborted: false });
      expect(allEvents.some(event => event.type === 'complete')).toBe(false);
      expect(adapter.shouldCompleteQueue(false)).toBe(false);

      push({ type: 'turn_start' });
      push({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Continued after compaction' },
      });
      push({ type: 'turn_end', message: { role: 'assistant' }, toolResults: [] });
      push({ type: 'agent_end' });
      expect(allEvents.some(event => event.type === 'complete')).toBe(false);

      push({ type: 'agent_settled' });
      expect(allEvents.filter(event => event.type === 'complete')).toHaveLength(1);
      expect(allEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'text_complete',
          turnId: expect.any(String),
          text: 'Continued after compaction',
          isIntermediate: false,
        }),
      ]));
      expect(adapter.shouldCompleteQueue(true)).toBe(true);
    });

    it('failure path reports compaction error and completes only when settled', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      collect(adapter.adaptEvent({ type: 'message_end', message: overflowMessage } as any));
      collect(adapter.adaptEvent({ type: 'agent_end' } as any));
      collect(adapter.adaptEvent({ type: 'compaction_start' } as any));

      const failureEvents = collect(adapter.adaptEvent({
        type: 'compaction_end',
        result: null,
        aborted: false,
        errorMessage: 'Out of memory during summary',
      } as any));

      expect(failureEvents.map(e => e.type)).toEqual(['compaction_end', 'error']);
      expect(failureEvents[0]).toMatchObject({
        type: 'compaction_end',
        errorMessage: 'Out of memory during summary',
      });
      expect(failureEvents[1]).toEqual({
        type: 'error',
        message: 'Context compaction failed: Out of memory during summary',
      });
      expect(adapter.shouldCompleteQueue(false)).toBe(false);

      const settledEvents = collect(adapter.adaptEvent({ type: 'agent_settled' } as any));
      expect(settledEvents).toEqual([{ type: 'complete' }]);
      expect(adapter.shouldCompleteQueue(true)).toBe(true);
    });

    it('surfaces a held overflow if Pi settles without recovery events', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      collect(adapter.adaptEvent({ type: 'message_end', message: overflowMessage } as any));
      collect(adapter.adaptEvent({ type: 'agent_end' } as any));

      const settledEvents = collect(adapter.adaptEvent({ type: 'agent_settled' } as any));
      expect(settledEvents).toEqual([
        { type: 'error', message: overflowMessage.errorMessage },
        { type: 'complete' },
      ]);
      expect(adapter.shouldCompleteQueue(true)).toBe(true);
    });

    it('non-overflow regression: rate-limit error preserves existing behavior', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'Rate limit exceeded; please try again in 30s',
        },
      } as any));

      // Rate-limit yields a typed_error immediately, while completion still
      // waits for the SDK's terminal boundary.
      expect(events).toHaveLength(1);
      expect(events[0].type).toMatch(/^(error|typed_error)$/);

      const agentEndEvents = collect(adapter.adaptEvent({ type: 'agent_end' } as any));
      expect(agentEndEvents).toHaveLength(0);
      expect(adapter.shouldCompleteQueue(false)).toBe(false);

      const settledEvents = collect(adapter.adaptEvent({ type: 'agent_settled' } as any));
      expect(settledEvents).toEqual([{ type: 'complete' }]);
      expect(adapter.shouldCompleteQueue(true)).toBe(true);
    });
  });
});
