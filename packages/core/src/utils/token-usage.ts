import type { PiUsage } from '../types/message.ts';

/** Pi normalizes input, cache reads and cache writes into disjoint buckets. */
export function sumTokenUsage(usages: readonly PiUsage[]): PiUsage {
  const total: PiUsage = {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  for (const usage of usages) {
    total.input += usage.input ?? 0;
    total.output += usage.output ?? 0;
    total.cacheRead += usage.cacheRead ?? 0;
    total.cacheWrite += usage.cacheWrite ?? 0;
    if (usage.reasoning !== undefined) total.reasoning = (total.reasoning ?? 0) + usage.reasoning;
    if (usage.cacheWrite1h !== undefined) total.cacheWrite1h = (total.cacheWrite1h ?? 0) + usage.cacheWrite1h;
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const) {
      total.cost[key] += usage.cost?.[key] ?? 0;
    }
  }
  // Reasoning is a subset of output; one-hour cache writes are a subset of cacheWrite.
  total.totalTokens = total.input + total.output + total.cacheRead + total.cacheWrite;
  return total;
}
