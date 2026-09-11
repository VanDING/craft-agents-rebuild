#!/usr/bin/env bun
/**
 * Synthetic session hot-path benchmark: streaming reducer and JSONL read/write
 * scaling at 100 / 1,000 / 5,000 messages. See docs/performance-implementation
 * notes for how these numbers gate further structural changes.
 *
 * Run: bun run scripts/benchmark-session-io.ts
 */
import { rmSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message } from '../packages/core/src/types/index.ts';
import { handleTextDelta } from '../apps/electron/src/renderer/event-processor/handlers/text.ts';
import { readSessionJsonl, writeSessionJsonl } from '../packages/shared/src/sessions/jsonl.ts';
import { estimateTranscriptBytes } from '../packages/core/src/utils/transcript-size.ts';

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

function makeHistory(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `history message ${index} `.repeat(8),
    timestamp: index,
    turnId: `turn-${Math.floor(index / 2)}`,
  })) as Message[];
}

const results: Array<Record<string, number>> = [];

for (const count of [100, 1000, 5000, 10_000, 25_000]) {
  const history = makeHistory(count);

  // Streaming reducer: 200 deltas after a 50-sample warmup.
  let state = { session: { messages: history }, streaming: null } as never as Parameters<typeof handleTextDelta>[0];
  const deltaTimes: number[] = [];
  for (let index = 0; index < 250; index += 1) {
    const started = performance.now();
    state = handleTextDelta(state, {
      type: 'text_delta',
      text: `chunk-${index} `,
      turnId: 'turn-stream',
    } as never);
    const elapsed = performance.now() - started;
    if (index >= 50) deltaTimes.push(elapsed);
  }

  // JSONL write/read: the full-snapshot atomic writer used by imports and
  // compatibility persistence.
  const dir = mkdtempSync(join(tmpdir(), `craft-bench-io-${count}-`));
  const file = join(dir, 'session.jsonl');
  const storedSession = {
    id: `bench-${count}`,
    workspaceRootPath: dir,
    createdAt: 1,
    lastUsedAt: 1,
    messages: history,
    tokenUsage: undefined,
  } as never;
  const writeTimes: number[] = [];
  const readTimes: number[] = [];
  try {
    for (let index = 0; index < 10; index += 1) {
      const writeStarted = performance.now();
      writeSessionJsonl(file, storedSession as never);
      writeTimes.push(performance.now() - writeStarted);
      const readStarted = performance.now();
      readSessionJsonl(file);
      readTimes.push(performance.now() - readStarted);
    }
    results.push({
      messages: count,
      deltaP50Ms: Number(percentile(deltaTimes, 0.5).toFixed(3)),
      deltaP95Ms: Number(percentile(deltaTimes, 0.95).toFixed(3)),
      jsonlWriteP95Ms: Number(percentile(writeTimes, 0.95).toFixed(1)),
      jsonlReadP95Ms: Number(percentile(readTimes, 0.95).toFixed(1)),
      transcriptEstimateBytes: estimateTranscriptBytes(history),
      jsonlBytes: statSync(file).size,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(JSON.stringify(results, null, 2));
