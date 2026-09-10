/** The host adapter consumes text deltas; complete content/usage arrives at message_end. */
export function compactTextUpdate(event: { assistantMessageEvent: { type: string; delta?: string } }, now = Date.now()) {
  const update = event.assistantMessageEvent;
  if (update.type !== 'text_delta' || !update.delta) return undefined;
  return {
    type: 'message_update' as const,
    assistantMessageEvent: { type: 'text_delta' as const, delta: update.delta },
    ts: now,
  };
}
