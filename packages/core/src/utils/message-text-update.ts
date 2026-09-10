import type { Message } from '../types/index.ts'

// Weak references prevent the stream's previous array versions from keeping
// an entire conversation alive. Missing provenance always uses the full path.
const updates = new WeakMap<Message[], { previous: WeakRef<Message[]>; index: number; structure: WeakRef<Message[]> }>()

export function recordMessageTextUpdate(previous: Message[], next: Message[], index: number): void {
  const structure = next[index]?.annotations?.length
    ? next
    : updates.get(previous)?.structure.deref() ?? previous
  updates.set(next, { previous: new WeakRef(previous), index, structure: new WeakRef(structure) })
}

export function getMessageTextUpdate(messages: Message[]): { previous: Message[]; index: number } | undefined {
  const update = updates.get(messages)
  const previous = update?.previous.deref()
  return previous && update ? { previous, index: update.index } : undefined
}

/** Content-independent selectors can reuse the last structural transcript version.
 * Annotated text is excluded because selection anchors depend on its content.
 */
export function getMessageStructureSource(messages: Message[]): Message[] {
  return updates.get(messages)?.structure.deref() ?? messages
}
