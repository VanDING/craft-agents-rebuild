/** Offline fixture host: real bootstrap, RPC, SessionManager, persistence and Web UI. */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { bootstrapServer } from '@craft-agent/server-core/bootstrap'
import { createWebuiHandler, nodeHttpAdapter, validateSession } from '@craft-agent/server-core/webui'
import { registerCoreRpcHandlers, cleanupSessionFileWatchForClient } from '@craft-agent/server-core/handlers/rpc'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@craft-agent/server-core/sessions'
import { setFetcherPlatform } from '@craft-agent/server-core/model-fetchers'
import { setSearchPlatform, setImageProcessor } from '@craft-agent/server-core/services'
import { DurableRuntimeCoordinator } from '@craft-agent/server-core/durable-runtime'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { SecureStorageBackend } from '../../packages/shared/src/credentials/backends/secure-storage'
import { saveSession, loadSession, getSessionFilePath } from '@craft-agent/shared/sessions'
import { root } from '../check-environment'
import { fixtureSession, profiles, seedFixtures, workspaceId, type ProfileName } from './fixtures'

const configDir = process.env.CRAFT_CONFIG_DIR!
if (!configDir || !process.env.CRAFT_PERF_TOKEN) throw new Error('Run through perf:baseline or perf:smoke')
const token = process.env.CRAFT_PERF_TOKEN
const profile = process.env.CRAFT_PERF_PROFILE as ProfileName
// CredentialManager predates CRAFT_CONFIG_DIR. Redirect its lazy backend before
// bootstrap can read credentials; never change HOME or use the developer's store.
Object.defineProperty(getCredentialManager(), 'backend', { value: new SecureStorageBackend(join(configDir, 'credentials.enc')) })
const fixture = await seedFixtures(configDir, profile)
const bootStart = performance.now()
let web: ReturnType<typeof createWebuiHandler> | undefined
let route: ReturnType<typeof nodeHttpAdapter> | undefined
const instance = await bootstrapServer({
  serverToken: token, rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: root,
  validateSessionCookie: async cookie => await validateSession(cookie, token) !== null,
  httpHandler: (req, res) => { if (route) route(req, res); else { res.statusCode = 503; res.end() } },
  applyPlatformToSubsystems(platform) {
    setFetcherPlatform(platform); setSessionPlatform(platform)
    setSessionRuntimeHooks({ updateBadgeCount() {}, captureException: error => console.error(error) })
    setSearchPlatform(platform); setImageProcessor(platform.imageProcessor)
  },
  createSessionManager: () => new SessionManager(),
  createHandlerDeps: deps => deps,
  registerAllRpcHandlers: registerCoreRpcHandlers,
  initializeSessionManager: sm => sm.initialize(),
  bindRpcServer: (sm, server) => sm.setRpcServer(server),
  setSessionEventSink: (sm, sink) => sm.setEventSink(sink),
  initModelRefreshService: () => ({ startAll() {}, stopAll() {} }),
  cleanupSessionManager: async sm => { await sm.flushAllSessions(); sm.cleanup() },
  cleanupClientResources: cleanupSessionFileWatchForClient,
})
const bootMs = performance.now() - bootStart
const sm = instance.sessionManager
// These private seams supply synthetic agent output and advance the idle clock.
// Everything downstream runs the production implementation. Keep them here only.
const internal = sm as unknown as {
  sessions: SessionManager['sessions']
  processEvent: SessionManager['processEvent']
  sendEvent: SessionManager['sendEvent']
  releaseIdleSessions: SessionManager['releaseIdleSessions']
}
function metrics() {
  const sessions = [...internal.sessions.values()]
  return { memory: process.memoryUsage(), cpu: process.cpuUsage(), loadedSessions: sessions.filter(s => s.messagesLoaded).length,
    loadedMessages: sessions.reduce((n, s) => n + s.messages.length, 0), pid: process.pid }
}
function diskFiles(dir: string, prefix = ''): Record<string, number> {
  const files: Record<string, number> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name), key = prefix + entry.name
    if (entry.isDirectory()) Object.assign(files, diskFiles(path, key + '/'))
    else if (entry.isFile()) files[key] = statSync(path).size
  }
  return files
}
let streamRunning = false
async function stream(sessionId: string, count: number) {
  if (streamRunning) throw new Error('Stream already running')
  streamRunning = true
  try {
    await sm.getSession(sessionId)
    const managed = internal.sessions.get(sessionId)!
    const message = { id: 'perf-stream-user', role: 'user' as const, content: 'Performance stream fixture', timestamp: Date.now() }
    managed.messages.push(message); managed.isProcessing = true
    internal.sendEvent({ type: 'user_message', sessionId, message, status: 'accepted' }, workspaceId)
    let content = ''
    for (let i = 0; i < count; i++) {
      const text = i === 0 ? 'PERF_STREAM_FIRST ' : `token${i} `
      content += text
      await internal.processEvent(managed, { type: 'text_delta', text, turnId: 'perf-stream-turn' })
      await Bun.sleep(20)
    }
    content += ' PERF_STREAM_DONE'
    await internal.processEvent(managed, { type: 'text_complete', text: content, turnId: 'perf-stream-turn' })
    managed.isProcessing = false
    internal.sendEvent({ type: 'complete', sessionId }, workspaceId)
    await sm.flushSession(sessionId)
  } finally { streamRunning = false }
}
async function persistence() {
  // Flush-per-message barriers intentionally expose full-snapshot write cost;
  // this is not an estimate of writes per model token (which are coalesced).
  const results = []
  for (const size of profiles[profile].sizes) {
    const session = fixtureSession(fixture.workspaceRoot, 900 + size, size)
    await saveSession(session)
    const path = getSessionFilePath(fixture.workspaceRoot, session.id)
    const initialBytes = statSync(path).size
    const durations = [], readMs = []
    let snapshotBytes = 0, appendedContentBytes = 0
    for (let i = 0; i < profiles[profile].writes; i++) {
      const content = `Append ${i} ${'durable payload '.repeat(64)}`
      appendedContentBytes += Buffer.byteLength(content)
      session.messages.push({ id: `append-${i}`, type: 'assistant', content, timestamp: Date.now() })
      const start = performance.now(); await saveSession(session); durations.push(performance.now() - start)
      snapshotBytes += statSync(path).size
      const readStart = performance.now()
      const loaded = loadSession(fixture.workspaceRoot, session.id)
      readMs.push(performance.now() - readStart)
      if (loaded?.messages.length !== session.messages.length) throw new Error('Persistence lost messages')
    }
    results.push({ initialMessages: size, initialBytes, flushMs: durations, synchronousReadMs: readMs,
      snapshotBytes, appendedContentBytes, logicalWriteAmplification: snapshotBytes / appendedContentBytes })
  }
  const durableRoot = join(configDir, 'durable-measurement')
  const coordinator = new DurableRuntimeCoordinator()
  const durableMs = []
  try {
    for (let i = 0; i < profiles[profile].writes; i++) {
      const operationId = `perf-operation-${i}`, sessionId = 'perf-durable', turnId = `turn-${i}`
      const start = performance.now()
      coordinator.acceptRun({ workspaceRootPath: durableRoot, sessionId, operationId, turnId, userMessageId: `u-${i}`, userMessage: 'Measure durable commit' })
      coordinator.commitAssistantMessage({ workspaceRootPath: durableRoot, sessionId, operationId, turnId, messageId: `a-${i}`, content: 'verified '.repeat(128) })
      coordinator.completeRun(durableRoot, operationId, 'complete')
      durableMs.push(performance.now() - start)
    }
    const beforeBackup = diskFiles(durableRoot)
    const backupStart = performance.now()
    coordinator.backupDatabase(durableRoot, join(durableRoot, 'measured-backup.sqlite'))
    return { snapshots: results, durableCommitMs: durableMs, backupMs: performance.now() - backupStart,
      durableFilesBeforeBackup: beforeBackup, durableFilesAfterBackup: diskFiles(durableRoot) }
  } finally { coordinator.closeAll() }
}
web = createWebuiHandler({ webuiDir: join(root, 'apps/webui/dist'), secret: token, secureCookies: false,
  wsProtocol: 'ws', wsPort: instance.port, getHealthCheck: () => ({ status: 'ok' }), logger: instance.platform.logger })
route = nodeHttpAdapter(async req => {
  if (new URL(req.url).pathname !== '/__perf') return web!.fetch(req)
  if (req.method !== 'POST' || req.headers.get('authorization') !== `Bearer ${token}`) return new Response('Unauthorized', { status: 401 })
  try {
    const body = await req.json() as { command: string; sessionId: string }
    switch (body.command) {
      case 'metrics': return Response.json(metrics())
      case 'load-all': for (const session of fixture.sessions) await sm.getSession(session.id); return Response.json(metrics())
      case 'evict': await internal.releaseIdleSessions(Date.now() + 16 * 60_000); return Response.json(metrics())
      case 'stream': void stream(body.sessionId, profiles[profile].deltas).catch(error => { console.error(error); process.exitCode = 1 }); return Response.json({ started: true })
      case 'persistence': return Response.json(await persistence())
      default: return new Response('Unknown command', { status: 400 })
    }
  } catch (error) { return Response.json({ error: String(error) }, { status: 500 }) }
})
console.log('PERF_READY ' + JSON.stringify({ port: instance.port, bootMs, ...fixture, metrics: metrics() }))
let stopping = false
async function stop() { if (stopping) return; stopping = true; web?.dispose(); await instance.stop(); process.exit(process.exitCode || 0) }
process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())
