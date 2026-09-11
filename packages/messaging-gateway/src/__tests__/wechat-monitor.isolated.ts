/**
 * Monitor poll-handling behavior tests.
 *
 * Two concerns:
 *
 * 1. Ack-cursor semantics — the monitor advances the persisted
 *    `get_updates_buf` cursor only after a batch dispatches cleanly
 *    (at-least-once). A batch whose messages keep failing must not wedge the
 *    channel forever — after `MAX_FAILED_BATCH_REDELIVERIES` identical failed
 *    batches the cursor is forced forward and the poison messages are dropped.
 *
 * 2. Response classification — the live iLink server returns successful
 *    getupdates responses WITHOUT `ret`/`errcode` (regression: `ret !== 0`
 *    classified every successful poll as an API error and discarded every
 *    message batch, so `/pair <code>` never reached the gateway), and it
 *    reports expired sessions via `errcode: -14` (not `ret`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  monitorWeixinProvider,
  MAX_FAILED_BATCH_REDELIVERIES,
} from '../adapters/wechat/ilink/monitor/monitor'
import { setStateDir } from '../adapters/wechat/ilink/storage/state-dir'
import { getSyncBufFilePath } from '../adapters/wechat/ilink/storage/sync-buf'
import { getRemainingPauseMs, _resetForTest } from '../adapters/wechat/ilink/api/session-guard'
import type { GetUpdatesResp, WeixinMessage } from '../adapters/wechat/ilink/api/types'

const realFetch = globalThis.fetch

let stateDir: string

const RESP: GetUpdatesResp = {
  ret: 0,
  errcode: 0,
  errmsg: '',
  msgs: [{ message_id: 1, from_user_id: 'u1', item_list: [] }],
  get_updates_buf: 'cursor-1',
  longpolling_timeout_ms: 0,
}

/** Live-server success shape: no `ret`/`errcode`/`errmsg` fields at all. */
const LIVE_SHAPE_RESP = {
  msgs: [{ message_id: 2, from_user_id: 'u2', item_list: [] }],
  get_updates_buf: 'cursor-2',
  longpolling_timeout_ms: 0,
} as unknown as GetUpdatesResp

/** Live-server session-expired shape: the code arrives via `errcode`. */
const SESSION_EXPIRED_RESP = {
  errcode: -14,
  errmsg: 'session timeout',
} as unknown as GetUpdatesResp

let currentResp: GetUpdatesResp = RESP

/** Stub fetch so every poll returns the configured response. */
function stubFetch(): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(currentResp), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
  setStateDir(undefined)
  _resetForTest()
})

/** Run the monitor until `abortAfterPolls` responses were seen, then abort. */
async function runMonitor(
  abortAfterPolls: number,
  onMessage: (msg: WeixinMessage) => Promise<void> | void,
  opts: { onSessionExpired?: (accountId: string) => void } = {},
): Promise<{ polls: number }> {
  const ac = new AbortController()
  let polls = 0
  let aborted = false
  await monitorWeixinProvider({
    baseUrl: 'https://x.example',
    token: 'tok',
    accountId: 'bot-1',
    stateRoot: stateDir,
    abortSignal: ac.signal,
    onMessage,
    onSessionExpired: opts.onSessionExpired,
    onPoll: () => {
      polls += 1
      if (polls >= abortAfterPolls && !aborted) {
        aborted = true
        ac.abort()
      }
    },
  })
  return { polls }
}

function readCursor(): string | null {
  const fp = getSyncBufFilePath('bot-1', stateDir)
  if (!existsSync(fp)) return null
  // SyncBufData — the on-disk format is { get_updates_buf: string }.
  const data = JSON.parse(readFileSync(fp, 'utf-8')) as { get_updates_buf: string }
  return data.get_updates_buf
}

describe('monitorWeixinProvider ack-cursor', () => {
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'wechat-monitor-'))
    setStateDir(stateDir)
    currentResp = RESP
    stubFetch()
  })

  it('persists the cursor after a clean batch dispatch', async () => {
    await runMonitor(2, async () => {})
    expect(readCursor()).toBe('cursor-1')
  })

  it('keeps the cursor unchanged while a failing batch is still retrying', async () => {
    const deliveries: number[] = []
    await runMonitor(
      MAX_FAILED_BATCH_REDELIVERIES - 1,
      async () => {
        deliveries.push(1)
        throw new Error('poison message')
      },
    )
    expect(deliveries.length).toBeGreaterThanOrEqual(MAX_FAILED_BATCH_REDELIVERIES - 2)
    expect(readCursor()).toBeNull()
  })

  it('forces the cursor forward after MAX_FAILED_BATCH_REDELIVERIES consecutive failures (escape hatch)', async () => {
    const deliveries: number[] = []
    await runMonitor(
      MAX_FAILED_BATCH_REDELIVERIES + 2,
      async () => {
        deliveries.push(1)
        throw new Error('poison message')
      },
    )
    expect(deliveries.length).toBeGreaterThanOrEqual(MAX_FAILED_BATCH_REDELIVERIES)
    expect(readCursor()).toBe('cursor-1')
  })
})

describe('monitorWeixinProvider response classification', () => {
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'wechat-monitor-'))
    setStateDir(stateDir)
    stubFetch()
  })

  it('processes msgs from a success response that omits ret/errcode (live server shape)', async () => {
    currentResp = LIVE_SHAPE_RESP
    const delivered: Array<{ id?: number; from?: string }> = []
    await runMonitor(2, async (msg) => {
      delivered.push({ id: msg.message_id, from: msg.from_user_id })
    })
    expect(delivered.length).toBeGreaterThanOrEqual(1)
    expect(delivered[0]).toEqual({ id: 2, from: 'u2' })
    expect(readCursor()).toBe('cursor-2')
  })

  it('does not treat a missing ret/errcode as an API error (no spurious backoff)', async () => {
    currentResp = LIVE_SHAPE_RESP
    let delivered = 0
    const { polls } = await runMonitor(3, async () => {
      delivered += 1
    })
    // No backoff between polls — all 3 polls ran back to back.
    expect(polls).toBe(3)
    expect(delivered).toBe(3)
  })

  it('pauses and notifies onSessionExpired when the server reports errcode -14', async () => {
    currentResp = SESSION_EXPIRED_RESP
    const expired: string[] = []
    // Abort right after the first poll: the -14 branch pauses, and the
    // pause guard's 60-minute sleep aborts immediately.
    const { polls } = await runMonitor(1, async () => {}, {
      onSessionExpired: (id) => expired.push(id),
    })
    expect(expired).toEqual(['bot-1'])
    expect(getRemainingPauseMs('bot-1')).toBeGreaterThan(0)
    // The pause guard stops further polling (60-minute sleep, aborted in test).
    expect(polls).toBe(1)
  })
})
