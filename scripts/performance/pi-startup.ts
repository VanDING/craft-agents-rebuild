import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { root } from '../check-environment'

/** Dist launcher readiness and actual lazy SDK initialization are separate costs. */
export async function measurePiStartup(scratch: string, environment: NodeJS.ProcessEnv, repeats: number) {
  const samples = []
  for (let i = 0; i < repeats; i++) {
    const sessionPath = join(scratch, `pi-${i}`)
    mkdirSync(join(sessionPath, 'plans'), { recursive: true })
    const start = performance.now()
    const child = spawn(process.execPath, ['--preload', join(root, 'packages/pi-agent-server/src/test-fixtures/block-network.ts'),
      join(root, 'packages/pi-agent-server/dist/index.js')], { cwd: sessionPath, env: environment, stdio: ['pipe', 'pipe', 'pipe'] })
    const exited = new Promise<void>(resolveExit => child.once('exit', () => resolveExit()))
    const errors: string[] = []
    createInterface({ input: child.stderr }).on('line', line => errors.push(line))
    try {
      samples.push(await new Promise<{ processReadyMs: number; sdkReadyMs: number; warmEnsureMs: number }>((resolveSample, reject) => {
        const timer = setTimeout(() => reject(new Error(`Pi readiness timed out: ${errors.slice(-5).join('\n')}`)), 30_000)
        let readyAt = 0, sdkAt = 0
        function send(message: object) { child.stdin.write(JSON.stringify(message) + '\n') }
        createInterface({ input: child.stdout }).on('line', line => {
          let message: { type: string; id?: string; message?: string }
          try { message = JSON.parse(line) } catch { return }
          if (message.type === 'error') { clearTimeout(timer); reject(new Error(`Pi startup: ${message.message}`)) }
          if (message.type === 'ready') {
            readyAt = performance.now(); send({ type: 'ensure_session_ready', id: 'cold' })
          } else if (message.type === 'ensure_session_ready_result' && message.id === 'cold') {
            sdkAt = performance.now(); send({ type: 'ensure_session_ready', id: 'warm' })
          } else if (message.type === 'ensure_session_ready_result' && message.id === 'warm') {
            clearTimeout(timer)
            resolveSample({ processReadyMs: readyAt - start, sdkReadyMs: sdkAt - readyAt, warmEnsureMs: performance.now() - sdkAt })
          }
        })
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Pi exited before readiness (${code})`)) })
        send({ type: 'init', apiKey: '', model: 'pi/gpt-6-astra', cwd: sessionPath, thinkingLevel: 'off',
          workspaceRootPath: sessionPath, sessionId: `perf-pi-${i}`, sessionPath, workingDirectory: sessionPath,
          plansFolderPath: join(sessionPath, 'plans'), agentDir: join(sessionPath, '.pi-agent'),
          providerType: 'pi', authType: 'oauth', browserToolEnabled: false,
          piAuth: { provider: 'openai-codex', credential: { type: 'oauth', access: 'offline-fixture', refresh: '', expires: Date.now() + 3_600_000 } } })
      }))
    } finally { child.kill('SIGKILL'); await exited }
  }
  return { model: 'pi/gpt-6-astra', offline: true, samples }
}
