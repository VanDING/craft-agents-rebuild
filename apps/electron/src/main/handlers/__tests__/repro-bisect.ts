// Bisect the working-watcher miss. Modes select which parts of the real test 3 setup run.
// Usage: repro-bisect.ts <mode>  where mode is a string of letters:
//   c = churn (tests 1+2 watcher cycles with rmSync of watched dirs)
//   f = pre-create files in workingDirA (project.ts, .gitignore, node_modules/)
//   g = run getFiles before watching
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { RPC_CHANNELS } from '../../../shared/types'
import { registerSessionsHandlers, cleanupSessionFileWatchForClient } from '@craft-agent/server-core/handlers/rpc'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

type HandlerFn = (ctx: { clientId: string }, ...args: any[]) => unknown

const mode = process.argv[2] ?? 'cfg'
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

function makeEnv() {
  const handlers = new Map<string, HandlerFn>()
  const pushed: Array<{ channel: string; target: unknown; args: any[] }> = []
  let tempRoot = ''
  let sessionDirA = '', sessionDirB = '', workingDirA = ''

  const setup = () => {
    handlers.clear()
    pushed.length = 0
    tempRoot = mkdtempSync(join(tmpdir(), 'craft-bisect-'))
    sessionDirA = join(tempRoot, 'session-a')
    sessionDirB = join(tempRoot, 'session-b')
    workingDirA = join(tempRoot, 'working-a')
    mkdirSync(sessionDirA, { recursive: true })
    mkdirSync(sessionDirB, { recursive: true })
    mkdirSync(workingDirA, { recursive: true })
    const server: RpcServer = {
      handle(channel, handler) { handlers.set(channel, handler as HandlerFn) },
      push(channel, target, ...args) { pushed.push({ channel, target, args }) },
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
    registerSessionsHandlers(server, deps as unknown as HandlerDeps)
    return { handlers, pushed, sessionDirA, sessionDirB, workingDirA }
  }

  const teardown = () => {
    cleanupSessionFileWatchForClient('client-a')
    cleanupSessionFileWatchForClient('client-b')
    rmSync(tempRoot, { recursive: true, force: true })
  }

  return { setup, teardown }
}

// Churn: register watchers, write files, close, rm dirs — like tests 1+2 with teardown.
if (mode.includes('c')) {
  {
    const env = makeEnv()
    const e = env.setup()
    const watch = e.handlers.get(RPC_CHANNELS.sessions.WATCH_FILES) as HandlerFn
    await watch({ clientId: 'client-a' }, 'session-a')
    await watch({ clientId: 'client-b' }, 'session-b')
    await delay(50)
    writeFileSync(join(e.sessionDirA, 'a.txt'), `a-${Date.now()}`)
    writeFileSync(join(e.sessionDirB, 'b.txt'), `b-${Date.now()}`)
    await delay(300)
    env.teardown()
  }
  {
    const env = makeEnv()
    const e = env.setup()
    const watch = e.handlers.get(RPC_CHANNELS.sessions.WATCH_FILES) as HandlerFn
    await watch({ clientId: 'client-a' }, 'session-a')
    await delay(50)
    cleanupSessionFileWatchForClient('client-a')
    e.pushed.length = 0
    writeFileSync(join(e.sessionDirA, 'after-cleanup.txt'), `x-${Date.now()}`)
    await delay(300)
    env.teardown()
  }
}

// Target test
{
  const env = makeEnv()
  const e = env.setup()
  const getFiles = e.handlers.get(RPC_CHANNELS.sessions.GET_FILES) as HandlerFn
  const watch = e.handlers.get(RPC_CHANNELS.sessions.WATCH_FILES) as HandlerFn

  writeFileSync(join(e.sessionDirA, 'attachment.txt'), 'session asset')
  if (mode.includes('f')) {
    writeFileSync(join(e.workingDirA, 'project.ts'), 'export {}')
    writeFileSync(join(e.workingDirA, '.gitignore'), 'node_modules')
    mkdirSync(join(e.workingDirA, 'node_modules'), { recursive: true })
    writeFileSync(join(e.workingDirA, 'node_modules', 'dependency.js'), 'ignored')
  }

  if (mode.includes('g')) {
    await getFiles({ clientId: 'client-a' }, 'session-a', 'session')
    await getFiles({ clientId: 'client-a' }, 'session-a', 'working')
  }
  await watch({ clientId: 'client-a' }, 'session-a', 'session')
  await watch({ clientId: 'client-a' }, 'session-a', 'working')
  e.pushed.length = 0

  writeFileSync(join(e.workingDirA, 'changed.ts'), `x-${Date.now()}`)
  const t0 = performance.now()
  while (performance.now() - t0 < 3000 && !e.pushed.some((evt) => evt.args[1] === 'working')) {
    await delay(20)
  }
  const arrival = Math.round(performance.now() - t0)
  const hit = e.pushed.some((evt) => evt.args[1] === 'working')
  console.log(`mode=${mode} arrivalMs=${arrival} hit=${hit}`)
  env.teardown()
}
