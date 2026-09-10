import type { Message } from '../types/index.ts'

/** Conservative string/record estimate for cache admission; does not serialize payloads. */
export function estimateTranscriptBytes(messages: Message[]): number {
  let bytes = 0
  for (const message of messages) {
    bytes += 512 + 2 * (message.content.length + (message.toolResult?.length ?? 0) + (message.promptSnapshot?.length ?? 0))
    const context = message.contextSnapshot
    if (context) bytes += context.messages.length * 192 + context.tools.length * 256
  }
  return bytes
}
