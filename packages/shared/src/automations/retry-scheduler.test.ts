import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RetryScheduler, type RetryQueueEntry } from './retry-scheduler.ts';
import { AUTOMATIONS_RETRY_QUEUE_FILE } from './constants.ts';

it('preserves a webhook enqueued while a retry is waiting for its response', async () => {
  const root = mkdtempSync(join(tmpdir(), 'craft-retry-'));
  let entered!: () => void;
  let respond!: () => void;
  const requested = new Promise<void>(resolve => { entered = resolve; });
  const response = new Promise<void>(resolve => { respond = resolve; });
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch() {
    entered();
    await response;
    return new Response('ok');
  } });
  const scheduler = new RetryScheduler({ workspaceRootPath: root });
  const queuePath = join(root, AUTOMATIONS_RETRY_QUEUE_FILE);
  const action = { type: 'webhook' as const, url: `http://127.0.0.1:${server.port}/hook` };
  writeFileSync(queuePath, JSON.stringify({ id: 'due', matcherId: 'old', action, expandedUrl: action.url,
    deferredAttempt: 0, nextRetryAt: 0, createdAt: 0 } satisfies RetryQueueEntry) + '\n');
  try {
    scheduler.start();
    const tick = (scheduler as any).tick();
    await requested;
    // enqueue must complete before the network response, and survive the rewrite.
    await scheduler.enqueue('new', action, action.url);
    expect(readFileSync(queuePath, 'utf8')).toContain('"matcherId":"new"');
    respond();
    await tick;
    const entries = readFileSync(queuePath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(entries).toHaveLength(1);
    expect(entries[0].matcherId).toBe('new');
  } finally {
    respond();
    scheduler.dispose();
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
});

describe('retry shutdown', () => {
  it('does not start another retry after disposal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-retry-stop-'));
    const scheduler = new RetryScheduler({ workspaceRootPath: root });
    let requests = 0;
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch() {
      requests++;
      return new Response('ok');
    } });
    const action = { type: 'webhook' as const, url: `http://127.0.0.1:${server.port}/hook` };
    const queuePath = join(root, AUTOMATIONS_RETRY_QUEUE_FILE);
    const original = JSON.stringify({ id: 'due', matcherId: 'old', action, expandedUrl: action.url,
      deferredAttempt: 0, nextRetryAt: 0, createdAt: 0 } satisfies RetryQueueEntry) + '\n';
    writeFileSync(queuePath, original);
    try {
      scheduler.start();
      scheduler.dispose();
      await (scheduler as any).tick();
      expect(requests).toBe(0);
      expect(readFileSync(queuePath, 'utf8')).toBe(original);
    } finally {
      scheduler.dispose();
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

it('preserves the last queue snapshot when writing its replacement fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'craft-retry-write-fail-'));
  const scheduler = new RetryScheduler({ workspaceRootPath: root });
  const queuePath = join(root, AUTOMATIONS_RETRY_QUEUE_FILE);
  const action = { type: 'webhook' as const, url: 'http://127.0.0.1:9/unused' };
  try {
    await scheduler.enqueue('pending', action, action.url);
    const original = readFileSync(queuePath, 'utf8');
    mkdirSync(queuePath + '.tmp');
    scheduler.start();
    await (scheduler as any).tick();
    expect(readFileSync(queuePath, 'utf8')).toBe(original);
    await scheduler.enqueue('new', action, action.url);
    expect(readFileSync(queuePath, 'utf8')).toContain('"matcherId":"new"');
  } finally {
    scheduler.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
