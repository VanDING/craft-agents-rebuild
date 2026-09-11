import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer, HandlerFn } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { registerFilesHandlers } from './files'

// Drafts fixture: getWorkspaceByNameOrId resolves a temp dir; getAllSessionDrafts
// returns a controllable record (never touches the real ~/.craft-agent/drafts.json).
let drafts: Record<string, { text: string; attachments?: Array<{ path: string; name: string }> }> = {}
let workspaceSessionIds: string[] = []

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: () => null,
  getAllSessionDrafts: () => drafts,
}))

function createTestHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps: HandlerDeps = {
    sessionManager: {
      getSessions: (workspaceId?: string) =>
        workspaceSessionIds.map(id => ({ id, workspaceId: workspaceId ?? 'ws-test' })),
    } as unknown as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
  }
  registerFilesHandlers(server, deps)
  const readUserAttachment = handlers.get(RPC_CHANNELS.file.READ_USER_ATTACHMENT)
  if (!readUserAttachment) throw new Error('READ_USER_ATTACHMENT handler not registered')
  return { readUserAttachment }
}

describe('file READ_USER_ATTACHMENT provenance (H-7)', () => {
  let dir: string
  let attachedFile: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'craft-agent-draft-'))
    attachedFile = join(dir, 'report.pdf')
    writeFileSync(attachedFile, 'dummy bytes')
    workspaceSessionIds = ['ws-test-session-1']
    drafts = {
      'ws-test-session-1': {
        text: '',
        attachments: [{ path: attachedFile, name: 'report.pdf' }],
      },
      'ws-test-session-2': {
        text: '',
        attachments: [{ path: join(dir, 'other-session-file.txt'), name: 'other.txt' }],
      },
    }
  })
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ }
  })

  it('denies arbitrary absolute paths not recorded in any draft', async () => {
    const { readUserAttachment } = createTestHarness()
    const result = await readUserAttachment(
      { clientId: 'c', workspaceId: 'ws-test', webContentsId: 1 },
      join(process.env.HOME ?? '/', '.ssh', 'id_rsa'),
    )
    expect(result).toBeNull()
  })

  it('denies a path recorded only in another workspace’s draft', async () => {
    const { readUserAttachment } = createTestHarness()
    const otherFile = drafts['ws-test-session-2'].attachments![0].path
    writeFileSync(otherFile, 'x')
    const result = await readUserAttachment(
      { clientId: 'c', workspaceId: 'ws-test', webContentsId: 1 },
      otherFile,
    )
    expect(result).toBeNull()
  })

  it('allows a path recorded in a draft of the calling workspace', async () => {
    const { readUserAttachment } = createTestHarness()
    const result = await readUserAttachment(
      { clientId: 'c', workspaceId: 'ws-test', webContentsId: 1 },
      attachedFile,
    )
    expect(result).not.toBeNull()
  })

  it('denies paths when the workspace has no drafts at all', async () => {
    drafts = {}
    const { readUserAttachment } = createTestHarness()
    const result = await readUserAttachment(
      { clientId: 'c', workspaceId: 'ws-test', webContentsId: 1 },
      attachedFile,
    )
    expect(result).toBeNull()
  })

  it('falls back to all drafts when no workspace context is available', async () => {
    workspaceSessionIds = []
    const { readUserAttachment } = createTestHarness()
    const otherFile = drafts['ws-test-session-2'].attachments![0].path
    writeFileSync(otherFile, 'x')
    const result = await readUserAttachment(
      { clientId: 'c', workspaceId: null, webContentsId: null },
      otherFile,
    )
    expect(result).not.toBeNull()
  })

  it('still rejects non-draft paths with no workspace context', async () => {
    workspaceSessionIds = []
    const { readUserAttachment } = createTestHarness()
    const result = await readUserAttachment(
      { clientId: 'c', workspaceId: null, webContentsId: null },
      join(process.env.HOME ?? '/', '.aws', 'credentials'),
    )
    expect(result).toBeNull()
  })
})
