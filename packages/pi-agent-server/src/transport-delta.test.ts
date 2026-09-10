import { expect, test } from 'bun:test';
import { compactTextUpdate } from './transport-delta';

test('wire delta size is independent of accumulated SDK response size', () => {
  const partial = { content: 'x'.repeat(1_000_000) };
  const event = { message: partial, assistantMessageEvent: { type: 'text_delta', delta: 'hello', partial } };
  expect(compactTextUpdate(event, 42)).toEqual({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hello' }, ts: 42 });
  expect(JSON.stringify(compactTextUpdate(event, 42)).length).toBeLessThan(150);
  expect(event.message).toBe(partial);
  expect(compactTextUpdate({ assistantMessageEvent: { type: 'thinking_delta', delta: 'internal' } })).toBeUndefined();
})
