import type { DurableToolExecutionIdentity } from '../../shared/src/durable-runtime/types.ts'

export type ContextWithDurableTool<T> = T & {
  durableTool: DurableToolExecutionIdentity
}

export function attachDurableToolContext<T>(
  context: T,
  durableTool: DurableToolExecutionIdentity,
): ContextWithDurableTool<T> {
  return {
    ...(context && typeof context === 'object' ? context : {}),
    durableTool,
  } as ContextWithDurableTool<T>
}

export function durableToolFromContext(context: unknown): DurableToolExecutionIdentity | undefined {
  if (!context || typeof context !== 'object') return undefined
  return (context as { durableTool?: DurableToolExecutionIdentity }).durableTool
}
