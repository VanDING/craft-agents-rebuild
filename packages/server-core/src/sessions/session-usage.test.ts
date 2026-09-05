import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PiUsage } from '@craft-agent/core/types'
import { readSessionJsonl, writeSessionJsonl } from '@craft-agent/shared/sessions/jsonl'
import { SessionManager, createManagedSession } from './SessionManager.ts'

describe('session usage ledger authority', () => {
  let root: string
  let manager: SessionManager
  let internals: any
  let managed: ReturnType<typeof createManagedSession>
  let sent: any[]

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'craft-session-usage-'))
    manager = new SessionManager()
    internals = manager as any
    sent = []
    internals.sendEvent = (event: unknown) => sent.push(structuredClone(event))
    managed = createManagedSession({ id: 's', createdAt: 1 }, {
      id: 'ws', slug: 'test', name: 'Test', rootPath: root, createdAt: 1,
    }, { messagesLoaded: true })
    internals.durableRuntime.acceptRun({
      workspaceRootPath: root, sessionId: 's', turnId: 'turn', operationId: 'run',
      userMessageId: 'user', userMessage: 'test', acceptedAt: 1,
    })
  })

  afterEach(() => {
    internals.durableRuntime.closeAll()
    rmSync(root, { recursive: true, force: true })
  })

  async function commit(requestSeq: number, usage: PiUsage, stopReason: 'toolUse' | 'error' | 'stop') {
    const boundary = internals.durableRuntime.modelBoundaryFor(root)
    const request = {
      sessionId: 's', turnId: 'turn', runOperationId: 'run',
      providerRequestId: String(requestSeq), provider: 'test', model: 'test',
      canonicalRequestHash: `hash-${requestSeq}`,
    }
    const prepared = await boundary.prepare(request)
    const outcome = { ...request, operationId: prepared.operationId, stopReason, content: [], text: '',
      usage: { inputTokens: usage.input, outputTokens: usage.output, costUsd: usage.cost.total, payload: { usage } },
    }
    await boundary.commitOutcome(outcome)
    // A repeated provider acknowledgement must not become another billed request.
    await boundary.commitOutcome(outcome)
  }

  it('counts all requests and caches, keeps context separate, and survives repeated completion and reload', async () => {
    await commit(1, { input: 100, output: 10, cacheRead: 20, cacheWrite: 5, totalTokens: 135,
      cost: { input: 0.01, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 } }, 'toolUse')
    await commit(2, { input: 130, output: 15, cacheRead: 30, cacheWrite: 7, totalTokens: 182,
      cost: { input: 0.02, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.02 } }, 'error')
    await internals.processEvent(managed, { type: 'usage_update', usage: { inputTokens: 182, contextWindow: 1000 } })
    const complete = { type: 'complete', usage: {
      inputTokens: 292, outputTokens: 25, contextTokens: 50, costUsd: 0.03,
    } }
    await internals.processEvent(managed, complete)
    await internals.processEvent(managed, complete)
    expect(managed.tokenUsage).toMatchObject({
      inputTokens: 292, outputTokens: 25, totalTokens: 317, contextTokens: 50,
      costUsd: 0.03, cacheReadTokens: 50, cacheCreationTokens: 12,
      full: { input: 230, output: 25, totalTokens: 317 },
    })
    expect(sent[0].tokenUsage).toMatchObject({ inputTokens: 292, contextTokens: 182, totalTokens: 317 })

    const file = join(root, 'session.jsonl')
    writeSessionJsonl(file, { id: 's', workspaceRootPath: root, createdAt: 1, lastUsedAt: 1,
      messages: [], tokenUsage: managed.tokenUsage! })
    const loaded = readSessionJsonl(file)!
    const { messages: _messages, ...metadata } = loaded
    const reloaded = createManagedSession(metadata, managed.workspace, { messagesLoaded: true })
    internals.applyDurableUsageProjection(reloaded)
    expect(reloaded.tokenUsage).toEqual(managed.tokenUsage)

    // Compaction changes context only, including a legitimate empty context.
    await internals.processEvent(managed, { type: 'usage_update', usage: { inputTokens: 0 } })
    expect(managed.tokenUsage).toMatchObject({ contextTokens: 0, totalTokens: 317, inputTokens: 292 })
    expect(sent.at(-1).tokenUsage).toMatchObject({ contextTokens: 0, totalTokens: 317 })
  })

  it('leaves sessions without a ledger unchanged', async () => {
    managed.tokenUsage = { inputTokens: 5, outputTokens: 2, totalTokens: 7, contextTokens: 5, costUsd: 0 }
    internals.applyDurableUsageProjection(managed)
    expect(managed.tokenUsage.totalTokens).toBe(7)
  })
})
