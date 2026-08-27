import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { DurableRuntimeCoordinator } from './coordinator.js'

const roots: string[] = []
const fixturePath = fileURLToPath(new URL('./process-crash-fixture.ts', import.meta.url))

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function waitForReady(child: ChildProcessWithoutNullStreams): Promise<{ toolOperationId?: string; modelOperationId?: string }> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
      const newline = stdout.indexOf('\n')
      if (newline < 0) return
      try {
        resolve(JSON.parse(stdout.slice(0, newline)) as { toolOperationId?: string; modelOperationId?: string })
      } catch (error) {
        reject(error)
      }
    })
    child.once('exit', code => reject(new Error(`Crash fixture exited early (${code}): ${stderr}`)))
  })
}

async function crashAt(mode: 'before-t1' | 'after-t1' | 'after-effect' | 'after-tool-t2' | 'after-model-effect' | 'after-model-t2') {
  const root = mkdtempSync(join(tmpdir(), 'craft-process-crash-'))
  roots.push(root)
  const markerPath = join(root, 'external-effects.log')
  const child = spawn(process.execPath, [fixturePath, root, mode, markerPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const ready = await waitForReady(child)
  child.kill()
  await new Promise<void>(resolve => child.once('exit', () => resolve()))
  return { root, markerPath, ...ready }
}

describe('durable runtime process crash recovery', () => {
  test('a kill before T1 produces zero external effect calls', async () => {
    const { root, markerPath } = await crashAt('before-t1')
    expect(existsSync(markerPath)).toBe(false)

    const restarted = new DurableRuntimeCoordinator()
    const report = restarted.recoverWorkspace(root)
    expect(report.items[0]?.action).toBe('terminalized_interrupted')
    expect(restarted.storeFor(root).listUnsettledToolOperations()).toHaveLength(0)
    expect(existsSync(markerPath)).toBe(false)
    restarted.closeAll()
  })

  test('a kill after an external effect but before T2 parks without replay', async () => {
    const { root, markerPath, toolOperationId } = await crashAt('after-effect')
    expect(toolOperationId).toBeDefined()
    const durableToolOperationId = toolOperationId!
    expect(readFileSync(markerPath, 'utf8').trim().split('\n')).toEqual([durableToolOperationId])

    const restarted = new DurableRuntimeCoordinator()
    const report = restarted.recoverWorkspace(root)
    expect(report.items[0]?.action).toBe('parked_unknown_effect')
    expect(restarted.getRecoveryEvidence(root, durableToolOperationId)?.verdict.kind)
      .toBe('reconcile_required')

    // Re-running startup recovery is idempotent and cannot invoke the effect.
    expect(restarted.recoverWorkspace(root).items[0]?.action).toBe('already_parked')
    expect(readFileSync(markerPath, 'utf8').trim().split('\n')).toEqual([durableToolOperationId])
    restarted.closeAll()
  })

  test('a kill after T1 but before the effect remains unknown and never executes automatically', async () => {
    const { root, markerPath, toolOperationId } = await crashAt('after-t1')
    expect(toolOperationId).toBeDefined()
    expect(existsSync(markerPath)).toBe(false)

    const restarted = new DurableRuntimeCoordinator()
    expect(restarted.recoverWorkspace(root).items[0]?.action).toBe('parked_unknown_effect')
    expect(restarted.getRecoveryEvidence(root, toolOperationId!)?.verdict.kind).toBe('reconcile_required')
    expect(existsSync(markerPath)).toBe(false)
    restarted.closeAll()
  })

  test('a kill after tool T2 but before publish rebuilds the settled outcome', async () => {
    const { root, markerPath, toolOperationId } = await crashAt('after-tool-t2')
    expect(readFileSync(markerPath, 'utf8').trim().split('\n')).toEqual([toolOperationId!])

    const restarted = new DurableRuntimeCoordinator()
    expect(restarted.getCanonicalSessionProjection(root, 'session-process-crash')?.items.at(-1))
      .toEqual(expect.objectContaining({ kind: 'tool_outcome', result: { receipt: 'accepted' } }))
    expect(restarted.recoverWorkspace(root).items[0]?.action).toBe('terminalized_interrupted')
    expect(readFileSync(markerPath, 'utf8').trim().split('\n')).toEqual([toolOperationId!])
    restarted.closeAll()
  })

  test('a kill after a billable model request but before T2 parks without rebilling', async () => {
    const { root, markerPath, modelOperationId } = await crashAt('after-model-effect')
    expect(modelOperationId).toBeDefined()
    expect(readFileSync(markerPath, 'utf8').trim().split('\n')).toEqual([modelOperationId!])

    const restarted = new DurableRuntimeCoordinator()
    const report = restarted.recoverWorkspace(root)
    expect(report.items[0]).toEqual(expect.objectContaining({
      action: 'parked_unknown_effect',
      unsettledModelOperationId: modelOperationId,
    }))
    expect(restarted.storeFor(root).listUsage()).toHaveLength(0)
    expect(restarted.recoverWorkspace(root).items[0]?.action).toBe('already_parked')
    expect(readFileSync(markerPath, 'utf8').trim().split('\n')).toEqual([modelOperationId!])
    restarted.closeAll()
  })

  test('a kill after model T2 but before publish rebuilds response and usage', async () => {
    const { root, markerPath, modelOperationId } = await crashAt('after-model-t2')
    expect(readFileSync(markerPath, 'utf8').trim().split('\n')).toEqual([modelOperationId!])

    const restarted = new DurableRuntimeCoordinator()
    expect(restarted.getCanonicalSessionProjection(root, 'session-process-crash')?.items.at(-1))
      .toEqual(expect.objectContaining({ kind: 'assistant', content: 'durable answer' }))
    expect(restarted.storeFor(root).listUsage()).toEqual([expect.objectContaining({
      inputTokens: 10, outputTokens: 2, costUsd: 0.1,
    })])
    expect(restarted.recoverWorkspace(root).items[0]?.action).toBe('terminalized_interrupted')
    expect(readFileSync(markerPath, 'utf8').trim().split('\n')).toEqual([modelOperationId!])
    restarted.closeAll()
  })
})
