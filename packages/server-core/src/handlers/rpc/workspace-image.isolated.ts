import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer, HandlerFn } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { registerWorkspaceCoreHandlers } from './workspace'

// Workspace fixture resolved via a mocked getWorkspaceByNameOrId (never touches real config).
let wsRoot = ''
const workspaceFixture = { id: 'ws-test', name: 'ws-test', rootPath: '' }

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => (id === 'ws-test' ? workspaceFixture : null),
  addWorkspace: () => undefined,
  setActiveWorkspace: () => undefined,
  updateWorkspaceRemoteServer: () => undefined,
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
    sessionManager: {} as HandlerDeps['sessionManager'],
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
  registerWorkspaceCoreHandlers(server, deps)
  const writeImage = handlers.get(RPC_CHANNELS.workspace.WRITE_IMAGE)
  const readImage = handlers.get(RPC_CHANNELS.workspace.READ_IMAGE)
  if (!writeImage || !readImage) throw new Error('workspace image handlers not registered')
  return { writeImage, readImage }
}

const b64 = (text: string) => Buffer.from(text, 'utf-8').toString('base64')
const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'

describe('workspace WRITE_IMAGE SVG gate (H-9)', () => {
  beforeEach(() => {
    wsRoot = mkdtempSync(join(tmpdir(), 'craft-agent-ws-icon-'))
    workspaceFixture.rootPath = wsRoot
  })
  afterEach(() => {
    try { rmSync(wsRoot, { recursive: true, force: true }) } catch { /* best-effort */ }
  })

  it('rejects SVGs containing <script> tags', async () => {
    const { writeImage } = createTestHarness()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    await expect(
      writeImage({ clientId: 'c', workspaceId: 'ws-test', webContentsId: 1 }, 'ws-test', 'icon.svg', b64(svg), 'image/svg+xml'),
    ).rejects.toThrow('Invalid SVG')
    expect(existsSync(join(wsRoot, 'icon.svg'))).toBe(false)
  })

  it('rejects SVGs with on* event-handler attributes', async () => {
    const { writeImage } = createTestHarness()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'
    await expect(
      writeImage({ clientId: 'c', workspaceId: 'ws-test', webContentsId: 1 }, 'ws-test', 'icon.svg', b64(svg), 'image/svg+xml'),
    ).rejects.toThrow('Invalid SVG')
    expect(existsSync(join(wsRoot, 'icon.svg'))).toBe(false)
  })

  it('rejects SVGs with javascript: URLs', async () => {
    const { writeImage } = createTestHarness()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>x</text></a></svg>'
    await expect(
      writeImage({ clientId: 'c', workspaceId: 'ws-test', webContentsId: 1 }, 'ws-test', 'icon.svg', b64(svg), 'image/svg+xml'),
    ).rejects.toThrow('Invalid SVG')
  })

  it('rejects SVGs containing foreignObject', async () => {
    const { writeImage } = createTestHarness()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>html</div></foreignObject></svg>'
    await expect(
      writeImage({ clientId: 'c', workspaceId: 'ws-test', webContentsId: 1 }, 'ws-test', 'icon.svg', b64(svg), 'image/svg+xml'),
    ).rejects.toThrow('Invalid SVG')
  })

  it('blocks case-mangled payloads (defense-in-depth)', async () => {
    const { writeImage } = createTestHarness()
    const variants = [
      '<svg xmlns="http://www.w3.org/2000/svg"><SCRIPT>alert(1)</SCRIPT></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" oNlOaD="alert(1)"></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="JaVaScRiPt:alert(1)"><text>x</text></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignobject><div>x</div></foreignobject></svg>',
    ]
    for (const svg of variants) {
      await expect(
        writeImage({ clientId: 'c', workspaceId: 'ws-test', webContentsId: 1 }, 'ws-test', 'icon.svg', b64(svg), 'image/svg+xml'),
      ).rejects.toThrow('Invalid SVG')
    }
  })

  it('accepts clean SVGs and writes them', async () => {
    const { writeImage, readImage } = createTestHarness()
    await writeImage({ clientId: 'c', workspaceId: 'ws-test', webContentsId: 1 }, 'ws-test', 'icon.svg', b64(CLEAN_SVG), 'image/svg+xml')
    expect(existsSync(join(wsRoot, 'icon.svg'))).toBe(true)
    // READ_IMAGE still returns the raw SVG text for the renderer's data-URL pipeline
    const raw = await readImage({ clientId: 'c', workspaceId: 'ws-test', webContentsId: 1 }, 'ws-test', 'icon.svg')
    expect(raw).toBe(CLEAN_SVG)
  })

  it('leaves raster images unaffected by the SVG gate', async () => {
    const { writeImage } = createTestHarness()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')
    await writeImage({ clientId: 'c', workspaceId: 'ws-test', webContentsId: 1 }, 'ws-test', 'icon.png', png, 'image/png')
    expect(existsSync(join(wsRoot, 'icon.png'))).toBe(true)
  })

  it('rejects script-capable content even when mimeType is image/svg+xml but ext differs', async () => {
    const { writeImage } = createTestHarness()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    await expect(
      writeImage({ clientId: 'c', workspaceId: 'ws-test', webContentsId: 1 }, 'ws-test', 'icon.bin.svg', b64(svg), 'image/svg+xml'),
    ).rejects.toThrow('Invalid SVG')
  })
})
