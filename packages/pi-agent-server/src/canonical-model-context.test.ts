import { describe, expect, test } from 'bun:test';
import type { Model } from '@earendil-works/pi-ai/compat';
import { canonicalContextToPiMessages } from './canonical-model-context.ts';

const model = { api: 'openai-responses', provider: 'openai', id: 'gpt-test' } as Model<any>;

describe('canonical model context', () => {
  test('rebuilds a provider-safe tool exchange from committed facts', () => {
    const messages = canonicalContextToPiMessages({
      cursor: 4,
      items: [
        { kind: 'user', eventId: 'e1', seq: 1, operationId: 'r1', content: 'inspect' },
        { kind: 'assistant', eventId: 'e2', seq: 2, operationId: 'r1', content: 'checking' },
        { kind: 'tool_call', eventId: 'e3', seq: 3, operationId: 'r1', toolOperationId: 't1', toolCallId: 'call1', toolName: 'Read', args: { path: 'a' } },
        { kind: 'tool_outcome', eventId: 'e4', seq: 4, operationId: 'r1', toolOperationId: 't1', toolCallId: 'call1', toolName: 'Read', result: { text: 'ok' }, isError: false },
      ],
    }, model);

    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'toolResult']);
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      stopReason: 'toolUse',
      content: [
        { type: 'text', text: 'checking' },
        { type: 'toolCall', id: 'call1', name: 'Read', arguments: { path: 'a' } },
      ],
    });
    expect(messages[2]).toMatchObject({ role: 'toolResult', toolCallId: 'call1', isError: false });
  });

  test('does not include an accepted current run excluded by Runtime Host', () => {
    const messages = canonicalContextToPiMessages({
      cursor: 2,
      items: [{ kind: 'user', eventId: 'old', seq: 1, operationId: 'old-run', content: 'old' }],
    }, model);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'old' });
  });
});
