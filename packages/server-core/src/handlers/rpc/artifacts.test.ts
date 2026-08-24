import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { registerArtifactHandlers } from './artifacts'

let workspaceRoot = ''
let contentRoot = ''
const workspaceFixture = { id: 'ws-artifacts', name: 'ws-artifacts', rootPath: '' }

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => (id === workspaceFixture.id ? workspaceFixture : null),
}))

const context: RequestContext = {
  clientId: 'artifact-test-client',
  workspaceId: workspaceFixture.id,
  webContentsId: 1,
}

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const pushes: Array<{ channel: string; args: unknown[] }> = []
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push(channel, _target, ...args) { pushes.push({ channel, args }) },
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps = {
    sessionManager: {
      async waitForInit() {},
      getSessions: () => [{
        id: 'session-1',
        workspaceId: workspaceFixture.id,
        workingDirectory: contentRoot,
      }],
    },
    oauthFlowStore: {},
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
  } as unknown as HandlerDeps
  registerArtifactHandlers(server, deps)
  return {
    pushes,
    handler(channel: string): HandlerFn {
      const registered = handlers.get(channel)
      if (!registered) throw new Error(`Handler not registered: ${channel}`)
      return registered
    },
  }
}

describe('artifact RPC handlers', () => {
  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'craft-artifact-rpc-workspace-'))
    contentRoot = mkdtempSync(join(tmpdir(), 'craft-artifact-rpc-content-'))
    workspaceFixture.rootPath = workspaceRoot
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(contentRoot, { recursive: true, force: true })
  })

  it('runs the renderer draft/review transaction and broadcasts every mutation', async () => {
    const harness = createHarness()
    const create = harness.handler(RPC_CHANNELS.artifacts.CREATE)
    const apply = harness.handler(RPC_CHANNELS.artifacts.APPLY)
    const submit = harness.handler(RPC_CHANNELS.artifacts.SUBMIT)
    const accept = harness.handler(RPC_CHANNELS.artifacts.ACCEPT)
    const list = harness.handler(RPC_CHANNELS.artifacts.LIST)

    const created = await create(context, workspaceFixture.id, {
      sessionId: 'session-1',
      kind: 'text',
      sourcePath: 'report.txt',
      initialText: 'draft',
    })
    expect(existsSync(join(contentRoot, 'report.txt'))).toBe(false)

    const updated = await apply(context, workspaceFixture.id, created.artifact.id, {
      expectedRevision: created.artifact.draftRevision,
      operation: { type: 'set_text', text: 'accepted content' },
    })
    const ready = await submit(
      context,
      workspaceFixture.id,
      created.artifact.id,
      updated.artifact.draftRevision,
    )
    expect(ready.artifact.status).toBe('ready')

    const result = await accept(context, workspaceFixture.id, created.artifact.id)
    expect(result.accepted).toBe(true)
    expect(readFileSync(join(contentRoot, 'report.txt'), 'utf8')).toBe('accepted content')

    const restored = await list(context, workspaceFixture.id, { sessionId: 'session-1' })
    expect(restored).toHaveLength(1)
    expect(restored[0]?.artifact.status).toBe('accepted')
    expect(harness.pushes.filter(({ channel }) => channel === RPC_CHANNELS.artifacts.CHANGED)).toHaveLength(4)
  })

  it('surfaces CAS conflicts without overwriting an externally changed source', async () => {
    const harness = createHarness()
    const target = join(contentRoot, 'existing.txt')
    writeFileSync(target, 'base')
    const created = await harness.handler(RPC_CHANNELS.artifacts.CREATE)(context, workspaceFixture.id, {
      sessionId: 'session-1',
      kind: 'text',
      sourcePath: target,
      initialText: 'draft',
    })
    await harness.handler(RPC_CHANNELS.artifacts.SUBMIT)(
      context,
      workspaceFixture.id,
      created.artifact.id,
      created.artifact.draftRevision,
    )
    writeFileSync(target, 'external change')

    const result = await harness.handler(RPC_CHANNELS.artifacts.ACCEPT)(
      context,
      workspaceFixture.id,
      created.artifact.id,
    )
    expect(result.accepted).toBe(false)
    expect(result.artifact.artifact.status).toBe('conflict')
    expect(readFileSync(target, 'utf8')).toBe('external change')
  })

  it('validates, previews, and accepts a real Office binary without an export step', async () => {
    const harness = createHarness()
    const stagedPath = join(contentRoot, 'generated.xlsx')
    const targetPath = join(contentRoot, 'deliverable.xlsx')
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Name', 'Score'],
      ['Ada', 98],
    ]), 'Scores')
    XLSX.writeFile(workbook, stagedPath)

    const created = await harness.handler(RPC_CHANNELS.artifacts.CREATE)(context, workspaceFixture.id, {
      sessionId: 'session-1',
      kind: 'spreadsheet',
      engineId: 'office-binary',
      sourcePath: targetPath,
      initialPath: stagedPath,
    })
    expect(existsSync(targetPath)).toBe(false)

    const ready = await harness.handler(RPC_CHANNELS.artifacts.SUBMIT)(
      context,
      workspaceFixture.id,
      created.artifact.id,
      created.artifact.draftRevision,
    )
    expect(ready.artifact.status).toBe('ready')
    expect(ready.artifact.validation?.valid).toBe(true)
    const preview = ready.artifact.previews.find((candidate: { kind: string }) => candidate.kind === 'markdown')
    expect(preview?.path).toEndWith('.md')
    expect(readFileSync(preview!.path!, 'utf8')).toContain('Ada')

    const accepted = await harness.handler(RPC_CHANNELS.artifacts.ACCEPT)(
      context,
      workspaceFixture.id,
      created.artifact.id,
    )
    expect(accepted.accepted).toBe(true)
    const delivered = XLSX.readFile(targetPath)
    expect(XLSX.utils.sheet_to_json(delivered.Sheets.Scores!)).toContainEqual({ Name: 'Ada', Score: 98 })
  })

  it('rejects drafts for sessions outside the workspace', async () => {
    const harness = createHarness()
    await expect(harness.handler(RPC_CHANNELS.artifacts.CREATE)(context, workspaceFixture.id, {
      sessionId: 'missing-session',
      kind: 'text',
      sourcePath: 'blocked.txt',
      initialText: 'blocked',
    })).rejects.toThrow('Artifact session not found')
  })

  it('treats a transport-null list filter as an omitted filter', async () => {
    const harness = createHarness()
    await harness.handler(RPC_CHANNELS.artifacts.CREATE)(context, workspaceFixture.id, {
      sessionId: 'session-1',
      kind: 'text',
      sourcePath: 'all.txt',
      initialText: 'visible',
    })

    const listed = await harness.handler(RPC_CHANNELS.artifacts.LIST)(
      context,
      workspaceFixture.id,
      null,
    )

    expect(listed).toHaveLength(1)
  })
})
