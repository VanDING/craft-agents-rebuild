import { afterAll, beforeAll, expect, it } from 'bun:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { registerFilesHandlers } from './files'

let root: string
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'craft-file-rpc-')))
  await writeFile(join(root, '报告.md'), 'session file')
})
afterAll(() => rm(root, { recursive: true, force: true }))

it('resolves conversation links in that session directory and rejects other workspace sessions', async () => {
  const handlers = new Map<string, HandlerFn>()
  let queriedWorkspace: string | undefined
  registerFilesHandlers({
    handle: (channel, handler) => { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  } satisfies RpcServer, {
    sessionManager: {
      waitForInit: async () => {},
      getSessions: (workspaceId: string | undefined) => {
        queriedWorkspace = workspaceId
        return [
          { id: 'current', workspaceId: 'file-rpc-workspace', workingDirectory: root },
          { id: 'foreign', workspaceId: 'other-workspace', workingDirectory: root },
        ]
      },
    },
  } as unknown as HandlerDeps)
  const resolve = handlers.get(RPC_CHANNELS.file.RESOLVE)!
  const ctx = { webContentsId: 1, clientId: 'test', workspaceId: 'file-rpc-workspace' }
  const target = await resolve(ctx, '报告.md', 'current')
  expect(target).toMatchObject({ path: join(root, '报告.md'), type: 'file' })
  expect(queriedWorkspace).toBe(ctx.workspaceId)
  await expect(resolve(ctx, '报告.md', 'foreign')).rejects.toThrow('current workspace')
  await expect(resolve(ctx, '报告.md', 'missing')).rejects.toThrow('current workspace')
})
