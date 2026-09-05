import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SessionHeader, StoredSession } from '../types'
import { getSessionFilePath } from '../storage'
import { SessionPersistenceQueue, getHeaderMetadataSignature, mergeHeaderWithExternalMetadata } from '../persistence-queue'

function makeHeader(overrides: Partial<SessionHeader> = {}): SessionHeader {
  return {
    id: 's1',
    workspaceRootPath: '~/.craft-agent/workspaces/ws',
    createdAt: 1,
    lastUsedAt: 2,
    messageCount: 0,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      contextTokens: 0,
    },
    ...overrides,
  }
}

describe('session persistence header conflict helpers', () => {
  it('metadata signature ignores non-metadata fields', () => {
    const a = makeHeader({ name: 'A', lastUsedAt: 100 })
    const b = makeHeader({ name: 'A', lastUsedAt: 999, messageCount: 42 })

    expect(getHeaderMetadataSignature(a)).toBe(getHeaderMetadataSignature(b))
  })

  it('metadata signature changes when metadata changes', () => {
    const a = makeHeader({ name: 'A', labels: ['x'] })
    const b = makeHeader({ name: 'B', labels: ['x'] })

    expect(getHeaderMetadataSignature(a)).not.toBe(getHeaderMetadataSignature(b))
  })

  it('merge preserves external metadata while keeping local computed fields', () => {
    const local = makeHeader({
      name: 'Local Name',
      labels: ['local'],
      isFlagged: false,
      sessionStatus: 'todo',
      permissionMode: 'allow-all',
      hasUnread: true,
      lastReadMessageId: 'm-local',
      messageCount: 99,
      lastUsedAt: 500,
    })

    const disk = makeHeader({
      name: 'Disk Name',
      labels: ['disk'],
      isFlagged: true,
      sessionStatus: 'needs-review',
      permissionMode: 'safe',
      hasUnread: false,
      lastReadMessageId: 'm-disk',
      messageCount: 1,
      lastUsedAt: 50,
    })

    const merged = mergeHeaderWithExternalMetadata(local, disk)

    expect(merged.name).toBe('Disk Name')
    expect(merged.labels).toEqual(['disk'])
    expect(merged.isFlagged).toBe(true)
    expect(merged.sessionStatus).toBe('needs-review')
    expect(merged.permissionMode).toBe('safe')
    expect(merged.hasUnread).toBe(false)
    expect(merged.lastReadMessageId).toBe('m-disk')

    // Local computed/runtime persistence fields remain local
    expect(merged.messageCount).toBe(99)
    expect(merged.lastUsedAt).toBe(500)
  })

  it('startup scenario: external metadata differs from local signature', () => {
    const local = makeHeader({ name: 'Local Name', labels: ['local'] })
    const disk = makeHeader({ name: 'External Name', labels: ['external'] })

    const localSig = getHeaderMetadataSignature(local)
    const diskSig = getHeaderMetadataSignature(disk)

    // This is the condition used by persistence queue at startup:
    // no previousSig yet, disk differs from local → preserve external metadata.
    const hasExternalMetadataChange = diskSig !== localSig
      && (undefined === undefined || diskSig !== undefined)

    expect(hasExternalMetadataChange).toBe(true)

    const merged = mergeHeaderWithExternalMetadata(local, disk)
    expect(merged.name).toBe('External Name')
    expect(merged.labels).toEqual(['external'])
  })
})

// ---------------------------------------------------------------------------
// M-17: flush()/flushAll() must await in-flight (already-started) writes
// ---------------------------------------------------------------------------

function makeStoredSession(workspaceRootPath: string, id: string, messageCount: number): StoredSession {
  const messages = Array.from({ length: messageCount }, (_, i) => ({
    id: `m-${i}`,
    type: 'user',
    content: `message payload ${i} `.repeat(30),
    timestamp: 1,
  }))
  return {
    id,
    workspaceRootPath,
    workingDirectory: workspaceRootPath,
    sdkCwd: workspaceRootPath,
    createdAt: 1,
    lastUsedAt: 1,
    messageCount,
    messages,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    },
  } as unknown as StoredSession
}

describe('SessionPersistenceQueue in-flight write tracking (M-17)', () => {
  // A payload large enough that the async write is still in flight for a few
  // event-loop turns, letting us observe flush() waiting on it deterministically.
  const PAYLOAD_MESSAGES = 10_000

  it('tracks a debounce-started write so flush() awaits it even when nothing is pending', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-pq-flush-'))
    try {
      // Long debounce: the timer stays armed while we start the write manually,
      // exactly as the debounce timer does in production.
      const queue = new SessionPersistenceQueue(60_000)
      const session = makeStoredSession(root, 's1', PAYLOAD_MESSAGES)
      queue.enqueue(session)

      // Start the write the way the timer would. It consumes the pending entry
      // and (with M-17) registers itself in writeInProgress.
      const writePromise = (queue as any).write(session.id)
      expect(queue.hasPending(session.id)).toBe(false)
      expect((queue as any).writeInProgress.has(session.id)).toBe(true)

      // flush() must await the in-flight write even though nothing is pending.
      let flushDone = false
      const flushPromise = queue.flush(session.id).then(() => { flushDone = true })

      // While the write is still in flight, flush must not resolve early.
      let observedInFlight = false
      const deadline = Date.now() + 10_000
      while ((queue as any).writeInProgress.has(session.id) && Date.now() < deadline) {
        observedInFlight = true
        expect(flushDone).toBe(false)
        await new Promise((r) => setTimeout(r, 1))
      }
      expect(observedInFlight).toBe(true)
      await flushPromise
      expect(flushDone).toBe(true)
      expect((queue as any).writeInProgress.size).toBe(0)

      // The write completed and the JSONL file is fully on disk.
      const filePath = getSessionFilePath(root, session.id)
      expect(existsSync(filePath)).toBe(true)
      const lines = readFileSync(filePath, 'utf-8').trim().split('\n')
      expect(lines.length).toBe(1 + session.messages.length)

      queue.cancel(session.id) // disarm the pending debounce timer
      await writePromise
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('flushAll() awaits in-flight writes so quit never drops data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-pq-flushall-'))
    try {
      const queue = new SessionPersistenceQueue(60_000)
      const session = makeStoredSession(root, 's2', PAYLOAD_MESSAGES)
      queue.enqueue(session)

      const writePromise = (queue as any).write(session.id)
      expect((queue as any).writeInProgress.has(session.id)).toBe(true)

      let flushAllDone = false
      const flushAllPromise = queue.flushAll().then(() => { flushAllDone = true })

      let observedInFlight = false
      const deadline = Date.now() + 10_000
      while ((queue as any).writeInProgress.has(session.id) && Date.now() < deadline) {
        observedInFlight = true
        expect(flushAllDone).toBe(false)
        await new Promise((r) => setTimeout(r, 1))
      }
      expect(observedInFlight).toBe(true)
      await flushAllPromise
      expect(flushAllDone).toBe(true)
      expect((queue as any).writeInProgress.size).toBe(0)
      expect(existsSync(getSessionFilePath(root, session.id))).toBe(true)

      queue.cancel(session.id)
      await writePromise
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('SessionPersistenceQueue write failures', () => {
  it('reports a failed write without skipping a newer queued snapshot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-pq-recover-'))
    const queue = new SessionPersistenceQueue(60_000)
    const internal = queue as any
    const performWrite = internal.performWrite.bind(queue)
    let fail!: (error: Error) => void
    const blocked = new Promise<void>((_resolve, reject) => { fail = reject })
    let attempts = 0
    internal.performWrite = (...args: unknown[]) => ++attempts === 1 ? blocked : performWrite(...args)
    try {
      queue.enqueue(makeStoredSession(root, 's1', 1))
      const first = queue.flush('s1')
      const rejected = first.catch(error => error)
      queue.enqueue(makeStoredSession(root, 's1', 2))
      const second = queue.flush('s1')
      fail(new Error('disk unavailable'))
      expect((await rejected).message).toBe('disk unavailable')
      await second
      await queue.flushAll()
      expect(attempts).toBe(2)
      expect(readFileSync(getSessionFilePath(root, 's1'), 'utf8').trim().split('\n')).toHaveLength(3)
    } finally {
      queue.cancel('s1')
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not treat a failed file write as the last saved metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-pq-metadata-fail-'))
    const queue = new SessionPersistenceQueue(60_000)
    const session = makeStoredSession(root, 's1', 1)
    try {
      queue.enqueue({ ...session, name: 'Original' })
      await queue.flush('s1')
      const signature = queue.getLastWrittenSignature('s1')
      const file = getSessionFilePath(root, 's1')
      mkdirSync(file + '.tmp') // Force a real write failure without changing the last good snapshot.
      queue.enqueue({ ...session, name: 'Failed update' })
      await expect(queue.flush('s1')).rejects.toThrow()
      expect(queue.getLastWrittenSignature('s1')).toBe(signature)
      expect(JSON.parse(readFileSync(file, 'utf8').split('\n')[0]!).name).toBe('Original')
      rmSync(file + '.tmp', { recursive: true })
      queue.enqueue({ ...session, name: 'Latest update' })
      await queue.flush('s1')
      expect(JSON.parse(readFileSync(file, 'utf8').split('\n')[0]!).name).toBe('Latest update')
    } finally {
      queue.cancel('s1')
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps a debounce failure observable until a newer write succeeds', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-pq-debounce-fail-'))
    const queue = new SessionPersistenceQueue(0)
    const internal = queue as any
    const performWrite = internal.performWrite.bind(queue)
    let attempted!: () => void
    const attempt = new Promise<void>(resolve => { attempted = resolve })
    internal.performWrite = async () => { attempted(); throw new Error('disk unavailable') }
    try {
      queue.enqueue(makeStoredSession(root, 's1', 1))
      await attempt
      await expect(queue.flushAll()).rejects.toThrow('disk unavailable')
      queue.cancel('s1')
      await Promise.resolve()
      await queue.flushAll()
      internal.performWrite = performWrite
      queue.enqueue(makeStoredSession(root, 's1', 2))
      await queue.flushAll()
      expect(readFileSync(getSessionFilePath(root, 's1'), 'utf8').trim().split('\n')).toHaveLength(3)
    } finally {
      queue.cancel('s1')
      rmSync(root, { recursive: true, force: true })
    }
  })
})
