import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

/** Wrap the session's actual stream, preserving SDK authentication and retry options. */
export function wrapDurableModelStream(
  stream: StreamFn,
  prepare: (
    model: Parameters<StreamFn>[0],
    context: Parameters<StreamFn>[1],
  ) => Promise<(message: AssistantMessage) => Promise<void>>,
): StreamFn {
  return (model, context, options) => {
    const target = createAssistantMessageEventStream();
    void (async () => {
      try {
        const commit = await prepare(model, context);
        const source = await stream(model, context, options);
        for await (const event of source) {
          if (event.type === 'done' || event.type === 'error') {
            // Commit metered partial/error responses as well as successful ones.
            await commit(event.type === 'done' ? event.message : event.error);
          }
          target.push(event);
        }
      } catch (error) {
        const failed: AssistantMessage = {
          role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'error', errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        };
        target.push({ type: 'error', reason: 'error', error: failed });
      }
    })();
    return target;
  };
}
