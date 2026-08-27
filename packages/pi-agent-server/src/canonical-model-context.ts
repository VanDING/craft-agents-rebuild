import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai/compat';
import type { DurableCanonicalModelContext } from '../../shared/src/durable-runtime/types.ts';

const zeroUsage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function resultText(result: unknown): string {
  if (typeof result === 'string') return result;
  try { return JSON.stringify(result); } catch { return String(result); }
}

/** Convert canonical committed facts into the exact transcript consumed by Pi. */
export function canonicalContextToPiMessages(
  context: DurableCanonicalModelContext,
  model: Model<any>,
): AgentMessage[] {
  const messages: AgentMessage[] = [];
  let lastAssistantOperationId: string | undefined;
  for (const item of context.items) {
    if (item.kind === 'user') {
      messages.push({ role: 'user', content: item.content, timestamp: item.seq });
      lastAssistantOperationId = undefined;
      continue;
    }
    if (item.kind === 'assistant') {
      messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: item.content }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: zeroUsage(),
        stopReason: 'stop',
        timestamp: item.seq,
      });
      lastAssistantOperationId = item.operationId;
      continue;
    }
    if (item.kind === 'tool_call') {
      const last = messages.at(-1);
      if (last?.role === 'assistant' && lastAssistantOperationId === item.operationId) {
        last.content.push({ type: 'toolCall', id: item.toolCallId, name: item.toolName, arguments: item.args });
        last.stopReason = 'toolUse';
      } else {
        messages.push({
          role: 'assistant',
          content: [{ type: 'toolCall', id: item.toolCallId, name: item.toolName, arguments: item.args }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: zeroUsage(),
          stopReason: 'toolUse',
          timestamp: item.seq,
        });
        lastAssistantOperationId = item.operationId;
      }
      continue;
    }
    messages.push({
      role: 'toolResult',
      toolCallId: item.toolCallId,
      toolName: item.toolName,
      content: [{ type: 'text', text: resultText(item.result) }],
      isError: item.isError,
      timestamp: item.seq,
    });
    lastAssistantOperationId = undefined;
  }
  return messages;
}
