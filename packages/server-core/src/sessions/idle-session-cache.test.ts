import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createManagedSession, SessionManager } from './SessionManager'

test('idle eviction flushes pending changes and reloads the complete transcript', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'craft-idle-reload-'))
  const runtime = new SessionManager() as any
  const now = Date.now()
  const session = createManagedSession({ id: 'reload', name: 'saved title' }, { id: 'ws', rootPath } as any, {
    messagesLoaded: true, lastAccessAt: now - 20 * 60_000,
    messages: [{ id: 'a', role: 'assistant', content: '完整内容 🌍', timestamp: 1 }],
  })
  runtime.sessions.set(session.id, session)
  try {
    runtime.enqueuePersist(session)
    await runtime.releaseIdleSessions(now)
    expect(session.messagesLoaded).toBe(false)
    expect(session.messages).toEqual([])
    await runtime.ensureMessagesLoaded(session)
    expect(session.messagesLoaded).toBe(true)
    expect(session.messages.map((message: { id: string; content: string }) => [message.id, message.content]))
      .toEqual([['a', '完整内容 🌍']])
    expect(session.name).toBe('saved title')
  } finally {
    await runtime.flushSession(session.id)
    // Release the durable-runtime SQLite handles; Windows cannot delete an
    // open .db/.db-wal/.db-shm while the runtime still owns them.
    runtime.cleanup()
    rmSync(rootPath, { recursive: true, force: true })
  }
})

test('idle cleanup protects running work and retires eligible runtime resources', async () => {
  const manager = new SessionManager()
  const runtime = manager as any
  const now = Date.now()
  const workspace = { id: 'test', name: 'test', rootPath: '/tmp/unused-idle-test', createdAt: now }
  const make = (id: string) => createManagedSession({ id }, workspace as any, {
    messagesLoaded: true,
    lastAccessAt: now - 20 * 60_000,
    messages: [{ id: `message-${id}`, role: 'assistant', content: 'saved answer', timestamp: 1 }],
  })
  const idle = make('idle')
  const running = make('running')
  running.isProcessing = true
  const pending = make('pending')
  pending.agent = { canHibernate: () => false } as any
  let disposed = 0
  idle.agent = { canHibernate: () => true, disposeForRestart: async () => { disposed++ } } as any
  runtime.sessions.set(idle.id, idle)
  runtime.sessions.set(running.id, running)
  runtime.sessions.set(pending.id, pending)
  runtime.flushSession = async () => {}
  await runtime.releaseIdleSessions(now)
  expect(disposed).toBe(1)
  expect(idle.agent).toBeNull()
  expect(idle.messagesLoaded).toBe(false)
  expect(idle.messages).toEqual([])
  expect(idle.messageCount).toBe(1)
  expect(running.messagesLoaded).toBe(true)
  expect(pending.messagesLoaded).toBe(true)
})

test('a session accessed during flush is not evicted', async () => {
  const manager = new SessionManager()
  const runtime = manager as any
  const now = Date.now()
  const session = createManagedSession({ id: 'raced' }, { id: 'ws', rootPath: '/tmp/unused-idle-test' } as any, {
    messagesLoaded: true, lastAccessAt: now - 20 * 60_000,
    messages: [{ id: 'a', role: 'assistant', content: 'keep', timestamp: 1 }],
  })
  runtime.sessions.set(session.id, session)
  runtime.flushSession = async () => { session.lastAccessAt = now }
  await runtime.releaseIdleSessions(now)
  expect(session.messagesLoaded).toBe(true)
  expect(session.messages).toHaveLength(1)
})

test('failed persistence prevents idle eviction', async () => {
  const runtime = new SessionManager() as any
  const now = Date.now()
  const session = createManagedSession({ id: 'unsaved' }, { id: 'ws', rootPath: '/tmp/unused-idle-test' } as any, {
    messagesLoaded: true, lastAccessAt: now - 20 * 60_000,
    messages: [{ id: 'a', role: 'assistant', content: 'unsaved', timestamp: 1 }],
  })
  runtime.sessions.set(session.id, session)
  runtime.flushSession = async () => { throw new Error('disk full') }
  await expect(runtime.releaseIdleSessions(now)).rejects.toThrow('disk full')
  expect(session.messagesLoaded).toBe(true)
  expect(session.messages).toHaveLength(1)
  expect(runtime.idleSweepRunning).toBe(false)
})

test('a new turn during runtime retirement retains its history', async () => {
  const runtime = new SessionManager() as any
  const now = Date.now()
  const session = createManagedSession({ id: 'resume' }, { id: 'ws', rootPath: '/tmp/unused-idle-test' } as any, {
    messagesLoaded: true, lastAccessAt: now - 20 * 60_000,
    messages: [{ id: 'a', role: 'assistant', content: 'keep', timestamp: 1 }],
  })
  let finish!: () => void
  let retiring!: () => void
  const started = new Promise<void>(resolve => { retiring = resolve })
  session.agent = { canHibernate: () => true, disposeForRestart: () => {
    retiring()
    return new Promise<void>(resolve => { finish = resolve })
  } } as any
  runtime.sessions.set(session.id, session)
  runtime.flushSession = async () => {}
  const sweep = runtime.releaseIdleSessions(now)
  await started
  expect(runtime.agentRefreshLocks.has(session.id)).toBe(true)
  session.isProcessing = true
  session.lastAccessAt = now
  finish()
  await sweep
  expect(session.messagesLoaded).toBe(true)
  expect(session.messages).toHaveLength(1)
  expect(runtime.agentRefreshLocks.has(session.id)).toBe(false)
})
