import { createHash } from 'node:crypto'
import { canonicalJson } from './canonical-json.js'

export function canonicalToolArgsHash(toolName: string, args: unknown): string {
  return createHash('sha256').update(canonicalJson({ toolName, args })).digest('hex')
}

export function durableToolOperationId(runOperationId: string, providerToolCallId: string): string {
  const digest = createHash('sha256')
    .update(canonicalJson([runOperationId, providerToolCallId]))
    .digest('hex')
    .slice(0, 32)
  return `toolop_${digest}`
}
