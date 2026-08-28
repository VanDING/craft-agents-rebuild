import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { RPC_CHANNELS } from '../../../shared/types'
import { registerSessionsHandlers, cleanupSessionFileWatchForClient } from '@craft-agent/server-core/handlers/rpc'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

type HandlerFn = (ctx: { clientId: string }, ...args: any[]) => Promise<any> | any

const handlers = new Map<string, HandlerFn>()
const pushed: Array<{ channel: string; target: any; args: any[] }> = []

const tempRoot = mkdtempSync(join(tmpdir(), 'craft-session-watchers-repro-'))
const sessionDirA = join(tempRoot, 'session-a')
const workingDirA = join(tempRoot, 'working-a')
mkdirSync(sessionDirA, { recursive: true })
mkdirSync(workingDirA, { recursive: true })

const server: RpcServer = {
  handle(channel, handler) { handlers.set(channel, handler as HandlerFn) },
  push(channel, target, ...args) { pushed.push({ channel, target, args }); console.log('PUSH', channel, target, JSON.stringify(args)) },
  async invokeClient() { return null },
  hasClientCapability() { return false },
  findClientsWithCapability() { return [] },
}

const deps = {
  sessionManager: {
    getSessionPath: () => sessionDirA,
    getSessionWorkingDirectory: () => workingDirA,
  },
  platform: {
    appRootPath: '', resourcesPath: '', isPackaged: false, appVersion: '0.0.0-test', isDebugMode: true,
    imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    logger: { info: () => {}, warn: () => {}, error: (...a: any[]) => console.log('LOG-ERR', ...a), debug: () => {} },
  },
  oauthFlowStore: { store: () => {}, getByState: () => null, remove: () => {}, cleanup: () => {}, dispose: () => {}, get size() { return 0 } },
} as unknown as HandlerDeps

registerSessionsHandlers(server, deps)

const watch = handlers.get(RPC_CHANNELS.sessions.WATCH_FILES)!
const getFiles = handlers.get(RPC_CHANNELS.sessions.GET_FILES)!

const sessionFiles = await getFiles({ clientId: 'c' }, 'session-a', 'session')
console.log('session files:', (sessionFiles as any[]).map(f => f.name))
const workingFiles = await getFiles({ clientId: 'c' }, 'session-a', 'working')
console.log('working files:', (workingFiles as any[]).map(f => f.name))

await watch({ clientId: 'c' }, 'session-a', 'session')
console.log('watched session')
await watch({ clientId: 'c' }, 'session-a', 'working')
console.log('watched working')
pushed.length = 0

writeFileSync(join(workingDirA, 'changed.ts'), `x-${Date.now()}`)
console.log('wrote changed.ts, waiting...')
await new Promise(r => setTimeout(r, 500))
console.log('events after write:', pushed.length)
cleanupSessionFileWatchForClient('c')
rmSync(tempRoot, { recursive: true, force: true })
