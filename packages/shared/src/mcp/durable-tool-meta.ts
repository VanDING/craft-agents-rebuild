import type { DurableToolExecutionIdentity } from '../durable-runtime/types.ts'

export function durableToolMeta(durableTool?: DurableToolExecutionIdentity): Record<string, unknown> | undefined {
  return durableTool
    ? { 'craft/durable-operation': durableTool }
    : undefined
}
