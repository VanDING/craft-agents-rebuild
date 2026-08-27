const SENSITIVE_KEY = /(?:^|[_-])(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|cookie|set[_-]?cookie|private[_-]?key)(?:$|[_-])/i
const MAX_DEPTH = 32
const REDACTED = '[REDACTED]'

/**
 * Remove credential-shaped values before they enter immutable runtime facts.
 * The canonical argument hash is computed from the original request, so
 * idempotency and identity checks remain exact without persisting secrets.
 */
export function redactDurablePayload(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > MAX_DEPTH) return '[TRUNCATED]'
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  if (Array.isArray(value)) return value.map(item => redactDurablePayload(item, depth + 1, seen))

  const output: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
    output[key] = SENSITIVE_KEY.test(normalizedKey)
      ? REDACTED
      : redactDurablePayload(nested, depth + 1, seen)
  }
  return output
}
