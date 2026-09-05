import { describe, expect, it } from 'bun:test';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { wrapDurableModelStream } from './durable-model-stream.ts';

const model = { id: 'test', provider: 'test', api: 'openai-responses' } as Parameters<StreamFn>[0];
const response: AssistantMessage = {
  role: 'assistant', model: 'test', provider: 'test', api: 'openai-responses',
  content: [], timestamp: 1, stopReason: 'toolUse',
  usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 0, totalTokens: 115,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.1 } },
};

describe('durable model stream', () => {
  for (const failed of [false, true]) {
    it(`commits ${failed ? 'failed partial' : 'tool-only'} usage before forwarding the response`, async () => {
      const order: string[] = [];
      const context = { messages: [] };
      const options = { apiKey: 'test-only', maxRetries: 2 };
      const message = { ...response, stopReason: failed ? 'error' as const : 'toolUse' as const };
      const stream = wrapDurableModelStream(async (actualModel, actualContext, actualOptions) => {
        order.push('request');
        expect(actualModel).toBe(model);
        expect(actualContext).toBe(context);
        expect(actualOptions).toBe(options);
        const source = createAssistantMessageEventStream();
        source.push(failed
          ? { type: 'error', reason: 'error', error: message }
          : { type: 'done', reason: 'toolUse', message });
        return source;
      }, async () => {
        order.push('prepare');
        return async completed => {
          await Promise.resolve();
          expect(completed.usage.totalTokens).toBe(115);
          order.push('commit');
        };
      });
      for await (const event of await stream(model, context, options)) {
        expect(event.type).toBe(failed ? 'error' : 'done');
        order.push('visible');
      }
      expect(order).toEqual(['prepare', 'request', 'commit', 'visible']);
    });
  }

  it('does not call the provider when preparation fails', async () => {
    let requested = false;
    const stream = wrapDurableModelStream(() => {
      requested = true;
      return createAssistantMessageEventStream();
    }, async () => { throw new Error('ledger unavailable'); });
    const result = await (await stream(model, { messages: [] })).result();
    expect(requested).toBe(false);
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toBe('ledger unavailable');
  });

  it('does not publish successful completion when the usage commit fails', async () => {
    const stream = wrapDurableModelStream(() => {
      const source = createAssistantMessageEventStream();
      source.push({ type: 'done', reason: 'toolUse', message: response });
      return source;
    }, async () => async () => { throw new Error('commit failed'); });
    const result = await (await stream(model, { messages: [] })).result();
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toBe('commit failed');
  });
});
