import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { Context, Model } from '@earendil-works/pi-ai';
import { prepareRequestDiagnostics } from './request-diagnostics';

const model = { provider: 'openai', id: 'test' } as Model<any>;
for (const systemPrompt of [undefined, '', '你好\n"quoted"']) {
  for (const tools of [undefined, [], [{ name: 'read', description: 'read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }]]) {
    test(`canonical hash remains byte-identical for ${JSON.stringify({ systemPrompt, tools })}`, () => {
      const context = { systemPrompt, messages: [{ role: 'user', content: '🙂 hello', timestamp: 1 }], tools } as Context;
      const legacy = () => createHash('sha256').update(JSON.stringify({
        provider: model.provider, model: model.id, systemPrompt: context.systemPrompt,
        messages: context.messages, tools: context.tools?.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
      })).digest('hex');
      const result = prepareRequestDiagnostics(model, context);
      expect(result.canonicalRequestHash).toBe(legacy());
      const serialized = JSON.stringify(context.messages[0]);
      expect(result.contextSnapshot.messages[0]?.hash).toBe(createHash('sha256').update(serialized).digest('hex'));
      expect(result.contextSnapshot.messages[0]?.chars).toBe(serialized.length);
      context.messages.push({ role: 'user', content: 'next', timestamp: 2 });
      expect(prepareRequestDiagnostics(model, context).canonicalRequestHash).toBe(legacy());
      expect(prepareRequestDiagnostics(model, context).canonicalRequestHash).not.toBe(result.canonicalRequestHash);
    });
  }
}
