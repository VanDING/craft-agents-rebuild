#!/usr/bin/env bun
import { spawn, execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { checkEnvironment, manifest, root, run } from '../check-environment'
import { profiles, type ProfileName } from './fixtures'
import { measurePiStartup } from './pi-startup'

checkEnvironment()
const profile: ProfileName = process.argv.includes('--smoke') ? 'smoke' : 'baseline'
const options = profiles[profile]
const outputArg = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length)
const output = resolve(outputArg ?? join(root, '.cache/performance', profile + '.json'))
const reusedBuilds = process.argv.includes('--skip-build')
if (!reusedBuilds) {
  await run(['run', 'webui:build'])
  await run(['run', 'build'], join(root, 'packages/pi-agent-server'))
}
// `git.revision` describes the source tree, not the artifact under test: with
// --skip-build the two can differ, so record what was actually measured.
const bundles = ['apps/webui/dist/index.html', 'packages/pi-agent-server/dist/index.js'].map(path => {
  if (!existsSync(join(root, path))) throw new Error(`Build required: ${path}`)
  const stats = statSync(join(root, path))
  return { path, bytes: stats.size, modifiedAt: new Date(stats.mtimeMs).toISOString() }
})
mkdirSync(dirname(output), { recursive: true })
const scratch = mkdtempSync(join(tmpdir(), 'craft-performance-'))
const token = crypto.randomUUID() + crypto.randomUUID()
const environment: NodeJS.ProcessEnv = { CRAFT_CONFIG_DIR: scratch, CRAFT_PERF_TOKEN: token, CRAFT_PERF_PROFILE: profile }
for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) {
  if (process.env[key]) environment[key] = process.env[key]
}
const serverLog: string[] = []
const started = performance.now()
const server = spawn(process.execPath, [join(root, 'scripts/performance/server.ts')], {
  cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
})
let browser: Browser | undefined
let page: Page | undefined
const report: Record<string, unknown> = {
  schemaVersion: 1, profile, options, createdAt: new Date().toISOString(),
  git: { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() },
  machine: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(), bun: Bun.version, bunExecutableArch: process.arch,
    node: execFileSync('node', ['--version'], { encoding: 'utf8' }).trim() },
  builds: { reused: reusedBuilds, bundles },
  version: manifest.version,
  scope: 'Production Web UI + real WebSocket RPC + SessionManager, synthetic offline workload. No Electron main/native startup or provider inference. Idle eviction uses an advanced clock; soak uses real time. Frame proxy = marker present plus two requestAnimationFrame callbacks, not hardware presentation. RSS is sampled, not peak or retained heap.',
}
function log(line: string) { serverLog.push(line); if (serverLog.length > 300) serverLog.shift() }
createInterface({ input: server.stderr }).on('line', log)
async function frames() { await page!.evaluate(() => new Promise<void>(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())))) }
try {
  const ready = await new Promise<{ port: number; bootMs: number; sessions: { id: string; messageCount: number }[]; metrics: unknown }>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture server startup timed out')), 60_000)
    createInterface({ input: server.stdout }).on('line', line => {
      log(line)
      if (line.startsWith('PERF_READY ')) { clearTimeout(timer); resolveReady(JSON.parse(line.slice(11))) }
    })
    server.once('error', error => { clearTimeout(timer); reject(error) })
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture server exited ${code}`)) })
  })
  report.serverStartup = { processToFixtureReadyMs: performance.now() - started, bootstrapMs: ready.bootMs, initial: ready.metrics }
  const origin = `http://127.0.0.1:${ready.port}`
  async function control(command: string, sessionId?: string) {
    const response = await fetch(origin + '/__perf', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ command, sessionId }), signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`Fixture ${command}: ${await response.text()}`)
    return response.json()
  }
  browser = await chromium.launch()
  report.chromium = browser.version()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
  const blockedRequests: string[] = []
  await context.route('**/*', route => {
    const url = route.request().url()
    if (url.startsWith(origin + '/') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue()
    blockedRequests.push(url); return route.abort()
  })
  const login = await context.request.post(origin + '/api/auth', { data: { password: token } })
  if (!login.ok()) throw new Error(`Fixture login failed ${login.status()}`)
  page = await context.newPage()
  page.setDefaultTimeout(60_000)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  let wsBytes = 0, wsFrames = 0
  page.on('websocket', socket => socket.on('framereceived', event => {
    wsFrames++; wsBytes += typeof event.payload === 'string' ? Buffer.byteLength(event.payload) : event.payload.length
  }))
  await page.addInitScript(() => {
    const state = { longTasks: [] as number[], frameGaps: [] as number[], lastFrame: 0 }
    Object.assign(window, { __perf: state })
    new PerformanceObserver(list => { for (const entry of list.getEntries()) state.longTasks.push(entry.duration) }).observe({ type: 'longtask', buffered: true })
    function frame(now: number) { if (state.lastFrame) state.frameGaps.push(now - state.lastFrame); state.lastFrame = now; requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  async function sample() {
    const [perf, dom, backend] = await Promise.all([cdp.send('Performance.getMetrics'), cdp.send('Memory.getDOMCounters'), control('metrics')])
    return { atMs: performance.now() - started, renderer: Object.fromEntries(perf.metrics.map(m => [m.name, m.value])), dom, backend, wsBytes, wsFrames }
  }
  console.log(`[performance] ${profile}: browser startup`)
  const startupMs: number[] = []
  for (let i = 0; i < 2; i++) {
    const start = performance.now()
    await page.goto(origin + '/?route=allSessions/session/perf-000', { waitUntil: 'domcontentloaded' })
    await page.getByText('PERF_END_perf-000', { exact: true }).waitFor({ state: 'visible' })
    await frames()
    startupMs.push(performance.now() - start)
  }
  report.navigationStartup = { firstNavigationMs: startupMs[0], secondNavigationMs: startupMs[1], after: await sample() }
  async function select(id: string) {
    // Exercise the actual SessionItem mouse-down handler; exclude Playwright's
    // actionability polling/animation delay from the timestamp.
    const row = page!.locator(`[data-session-id="${id}"] button`).first()
    await row.waitFor({ state: 'attached' })
    await row.dispatchEvent('mousedown', { button: 0 })
    await page!.getByText(`PERF_END_${id}`, { exact: true }).waitFor({ state: 'visible' })
    await frames()
  }
  const loads = []
  for (const session of ready.sessions.slice(0, 3)) {
    console.log(`[performance] ${session.messageCount} messages: load and warm switches`)
    await select('perf-003')
    const before = await sample()
    const start = performance.now(); await select(session.id); const firstMs = performance.now() - start
    const first = await sample()
    const warmMs: number[] = []
    for (let i = 0; i < options.repeats; i++) {
      await select('perf-003')
      const start = performance.now(); await select(session.id); warmMs.push(performance.now() - start)
    }
    loads.push({ ...session, firstVisitMs: firstMs, warmSwitchMs: warmMs, before, first, after: await sample() })
  }
  report.sessionLoads = loads
  console.log('[performance] 50 deltas/second on the longest conversation')
  await page.evaluate(() => { const state = (window as any).__perf; state.longTasks = []; state.frameGaps = [] })
  const streamBefore = await sample()
  const streamStart = performance.now()
  await control('stream', 'perf-002')
  await page.getByText('PERF_STREAM_FIRST', { exact: false }).first().waitFor({ state: 'visible' })
  await frames()
  const firstFrameMs = performance.now() - streamStart
  await page.getByText('PERF_STREAM_DONE', { exact: false }).first().waitFor({ state: 'visible' })
  await frames()
  report.streaming = { firstFrameMs, completeFrameMs: performance.now() - streamStart,
    browserTiming: await page.evaluate(() => (window as any).__perf), before: streamBefore, after: await sample() }
  console.log(`[performance] ${options.sessions} backend histories, ${options.soakSeconds}s real idle, accelerated eviction`)
  report.retention = { beforeLoad: await control('metrics'), afterLoad: await control('load-all'),
    afterAdvancedClockSweep: await control('evict') }
  const soak = []
  for (let seconds = 0; seconds < options.soakSeconds; seconds += 3) {
    await new Promise(resolveWait => setTimeout(resolveWait, Math.min(3, options.soakSeconds - seconds) * 1000))
    soak.push(await sample())
  }
  report.idleSamples = soak
  console.log('[performance] atomic JSONL barriers, synchronous reads, SQLite commits and backup')
  report.persistence = await control('persistence')
  console.log('[performance] Pi distribution process and lazy SDK initialization (offline)')
  report.piStartup = await measurePiStartup(scratch, environment, options.repeats)
  report.browserErrors = pageErrors
  report.blockedExternalRequestCount = blockedRequests.length
  if (pageErrors.length) throw new Error(`Production UI errors: ${pageErrors.join('; ')}`)
  if (server.exitCode != null) throw new Error(`Server exited unexpectedly: ${server.exitCode}`)
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.error = String(error)
  if (page) { await page.screenshot({ path: output.replace(/\.json$/, '') + '.failure.png' }).catch(() => {}); report.failureBody = (await page.locator('body').innerText().catch(() => '')).slice(0, 5000) }
  throw error
} finally {
  await browser?.close()
  const stopped = new Promise<void>(resolveStop => server.once('exit', () => resolveStop()))
  if (server.exitCode == null) {
    server.kill('SIGTERM')
    await Promise.race([stopped, new Promise(resolveWait => setTimeout(resolveWait, 5000))])
    if (server.exitCode == null) { server.kill('SIGKILL'); await stopped }
  }
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  writeFileSync(output.replace(/\.json$/, '') + '.server.log', serverLog.join('\n') + '\n')
  rmSync(scratch, { recursive: true, force: true })
  console.log(`[performance] ${report.status}: ${output}`)
}
