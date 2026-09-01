export const MAX_AUTO_LENGTH_CONTINUATIONS = 2

export const LENGTH_CONTINUATION_PROMPT = [
  'Continue exactly where the previous response was cut off.',
  'Do not repeat completed content.',
  'Finish the current task, including any pending tool work, and only stop when it is complete.',
].join(' ')

export interface LengthLimitedAssistantMessage {
  role?: string
  stopReason?: string
  usage?: { output?: number }
}

/**
 * Pi already compact-and-retries length stops caused by context pressure when
 * output is below the model's declared maximum. Craft only auto-continues a
 * response that actually exhausted that declared output ceiling; doing so
 * earlier would bypass Pi's context recovery path.
 */
export function exhaustedModelOutputLimit(
  message: LengthLimitedAssistantMessage,
  modelMaxTokens: number | undefined,
): boolean {
  const outputTokens = message.usage?.output
  return message.role === 'assistant'
    && message.stopReason === 'length'
    && typeof modelMaxTokens === 'number'
    && modelMaxTokens > 0
    && typeof outputTokens === 'number'
    && outputTokens >= modelMaxTokens
}

export class LengthContinuationTracker {
  private attempts = 0

  reset(): void {
    this.attempts = 0
  }

  nextAttempt(
    message: LengthLimitedAssistantMessage,
    modelMaxTokens: number | undefined,
  ): number | undefined {
    if (this.attempts >= MAX_AUTO_LENGTH_CONTINUATIONS) return undefined
    if (!exhaustedModelOutputLimit(message, modelMaxTokens)) return undefined
    this.attempts += 1
    return this.attempts
  }
}
