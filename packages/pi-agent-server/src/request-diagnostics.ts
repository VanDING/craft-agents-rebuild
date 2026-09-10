import { createHash } from 'node:crypto';
import type { Context, Model } from '@earendil-works/pi-ai';

function digest(serialized: string) {
  return { hash: createHash('sha256').update(serialized).digest('hex'), chars: serialized.length };
}

/**
 * Hash exactly the existing canonical JSON byte sequence, but serialize each
 * message only once and avoid materializing a second full-context JSON string.
 * The diagnostic manifest shares these serialized message values.
 */
export function prepareRequestDiagnostics(model: Model<any>, context: Context) {
  const hash = createHash('sha256');
  const prefix = JSON.stringify({ provider: model.provider, model: model.id, systemPrompt: context.systemPrompt });
  hash.update(prefix.slice(0, -1)).update(',"messages":[');
  const messages = context.messages.map((message, index) => {
    const serialized = JSON.stringify(message) ?? 'null';
    if (index) hash.update(',');
    hash.update(serialized);
    return { role: typeof message.role === 'string' ? message.role : 'unknown', ...digest(serialized) };
  });
  hash.update(']');
  if (context.tools !== undefined) {
    hash.update(',"tools":[');
    context.tools.forEach((tool, index) => {
      if (index) hash.update(',');
      hash.update(JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }));
    });
    hash.update(']');
  }
  hash.update('}');
  return {
    canonicalRequestHash: hash.digest('hex'),
    contextSnapshot: {
      version: 1 as const,
      capturedAt: Date.now(),
      provider: model.provider,
      model: model.id,
      system: digest(JSON.stringify(context.systemPrompt ?? '')),
      messages,
      tools: (context.tools ?? []).map(tool => {
        const schema = digest(JSON.stringify(tool.parameters) ?? '');
        return { name: tool.name, ...(tool.description ? { description: tool.description } : {}), hash: schema.hash, schemaChars: schema.chars };
      }),
    },
  };
}
