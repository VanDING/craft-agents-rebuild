import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Simulate the full test-file sequence: create+close watchers (as tests 1-2 do),
// then register session+working scopes, write a file, and time the push arrival.
const { watch, rmSync: rm } = await import('fs')

const sessions = await import('@craft-agent/server-core/handlers/rpc')
const { RPC_CHANNELS } = await import('../../../shared/types')

type HandlerFn = (ctx: { clientId: string }, ...args: any[]) => unknown
const handlers = new Map<string, HandlerFn>()
const pushed: Array<{ channel: string; target: unknown; args: unknown[] }> = []

const tempRoot = mkdtempSync(join(tmpdir(), 'craft-session-watchers-latency-'))
const mk = (name: string) => {
  const dir = join(tempRoot, name)
  mkdirSync(dir, { recursive: true })
  return dir
}
const sessionDirA = mk('session-a')
const sessionDirB = mk('session-b')
const workingDirA = mk('working-a')

const server = {
  handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
  push(channel: string, target: unknown, ...args: unknown[]) { pushed.push({ channel, target, args }) },
  async invokeClient() { return null },
  hasClientCapability() { return false },
  findClientsWithCapability() { return [] },
}
const deps = {
  sessionManager: {
    getSessionPath: (id: string) => (id === 'session-a' ? sessionDirA : id === 'session-b' ? sessionDirB : null),
    getSessionWorkingDirectory: (id: string) => (id === 'session-a' ? workingDirA : undefined),
  },
  platform: {
    appRootPath: '', resourcesPath: '', isPackaged: false, appVersion: '0.0.0-test', isDebugMode: true,
    imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  },
  oauthFlowStore: {
    store: () => {}, getByState: () => null, remove: () => {}, cleanup: () => {}, dispose: () => {},
    get size() { return 0 },
  },
}
sessions.registerSessionsHandlers(server as never, deps as never)

const watchFn = handlers.get(RPC_CHANNELS.sessions.WATCH_FILES) as HandlerFn

// Pre-seed watcher churn like tests 1+2 (create then clean up)
for (const client of ['client-a', 'client-b']) {
  await watchFn({ clientId: client }, 'session-a')
  await watchFn({ clientId: client }, 'session-b')
}
sessions.cleanupSessionFileWatchForClient('client-a')
sessions.cleanupSessionFileWatchForClient('client-b')

// Now the failing scenario: session + working scopes for one client
await watchFn({ clientId: 'client-a' }, 'session-a', 'session')
await watchFn({ clientId: 'client-a' }, 'session-a', 'working')

for (let i = 0; i < 10; i++) {
  pushed.length = 0
  const t0 = performance.now()
  writeFileSync(join(workingDirA, `changed-${i}.ts`), `x-${Date.now()}`)
  const deadline = t0 + 2000
  while (performance.now() < deadline && pushed.length === 0) {
    await new Promise((r) => setTimeout(r, 10))
  }
  const latency = Math.round(performance.now() - t0)
  const hit = pushed.some((e) => (e.args as string[])[1] === 'working')
  console.log(`iter ${i}: latency=${latency}ms hit=${hit} events=${pushed.length}`)
}

sessions.cleanupSessionFileWatchForClient('client-a')
rm(tempRoot, { recursive: true, force: true })
