/**
 * M-1: session→workspace ownership enforcement at the RPC layer.
 *
 * Every sessions:* handler that takes a sessionId must reject access when the
 * calling client's claimed workspace (ctx.workspaceId) does not match the
 * session's workspace, and must validate the sessionId format first. Clients
 * without a claimed workspace (null) keep the previous behavior.
 */

import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import type { ISessionManager } from '../session-manager-interface'
import type { PlatformServices } from '../../runtime/platform'
import type { IOAuthFlowStore } from '../oauth-flow-store-interface'
import { registerSessionsHandlers } from './sessions'

const NOOP_LOGGER = {
  info() {},
  warn() {},
  error() {},
  debug() {},
}

const SESSIONS = [
  { id: 'session-a', workspaceId: 'ws-1' },
  { id: 'session-b', workspaceId: 'ws-2' },
]

function createHarness() {
  const handlers = new Map<string, HandlerFn>()

  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {
      return undefined
    },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }

  const base = {
    getSessions: () => SESSIONS,
    getSession: async (id: string) => SESSIONS.find(s => s.id === id) ?? null,
    getSessionPath: (id: string) => (SESSIONS.some(s => s.id === id) ? `/sessions/${id}` : null),
    waitForInit: async () => {},
  }

  // Any other ISessionManager method the handlers could reach (deleteSession,
  // sendMessage, …) must never be invoked in the rejection tests — if one IS
  // reached, the ownership guard regressed and the proxy fails loudly.
  const sessionManager = new Proxy(base, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver)
      return () => {
        throw new Error(`Unexpected sessionManager.${String(prop)} call — ownership guard did not reject`)
      }
    },
  }) as unknown as ISessionManager

  registerSessionsHandlers(server, {
    sessionManager,
    platform: {
      appRootPath: '/app',
      resourcesPath: '/res',
      isPackaged: false,
      appVersion: 'test',
      // Unused by the handlers under test; shape only.
      imageProcessor: {} as unknown as PlatformServices['imageProcessor'],
      logger: NOOP_LOGGER,
      isDebugMode: false,
    },
    oauthFlowStore: {} as unknown as IOAuthFlowStore,
  })

  const getMessages = handlers.get(RPC_CHANNELS.sessions.GET_MESSAGES)
  const sendMessage = handlers.get(RPC_CHANNELS.sessions.SEND_MESSAGE)
  const deleteSession = handlers.get(RPC_CHANNELS.sessions.DELETE)
  const command = handlers.get(RPC_CHANNELS.sessions.COMMAND)
  const getFiles = handlers.get(RPC_CHANNELS.sessions.GET_FILES)
  const setNotes = handlers.get(RPC_CHANNELS.sessions.SET_NOTES)
  const exportSession = handlers.get(RPC_CHANNELS.sessions.EXPORT)

  return { getMessages, sendMessage, deleteSession, command, getFiles, setNotes, exportSession }
}

function ctx(workspaceId: string | null): RequestContext {
  return { clientId: 'client-1', workspaceId, webContentsId: 1 }
}

describe('sessions RPC workspace ownership (M-1)', () => {
  it('allows access to sessions in the calling client workspace', async () => {
    const { getMessages, getFiles } = createHarness()

    await expect(getMessages!(ctx('ws-1'), 'session-a')).resolves.toEqual(SESSIONS[0])
    // GET_FILES reaches scanSessionDirectory('/sessions/session-a') which
    // does not exist → caught → empty tree.
    await expect(getFiles!(ctx('ws-1'), 'session-a')).resolves.toEqual([])
  })

  it('rejects access to sessions in another workspace', async () => {
    const { getMessages, sendMessage, deleteSession, command, setNotes, exportSession } = createHarness()

    await expect(getMessages!(ctx('ws-1'), 'session-b')).rejects.toThrow(/does not belong to workspace ws-1/)
    await expect(sendMessage!(ctx('ws-1'), 'session-b', 'hello')).rejects.toThrow(/does not belong to workspace ws-1/)
    await expect(deleteSession!(ctx('ws-1'), 'session-b')).rejects.toThrow(/does not belong to workspace ws-1/)
    await expect(command!(ctx('ws-1'), 'session-b', { type: 'flag' })).rejects.toThrow(/does not belong to workspace ws-1/)
    await expect(setNotes!(ctx('ws-1'), 'session-b', 'notes')).rejects.toThrow(/does not belong to workspace ws-1/)
    await expect(exportSession!(ctx('ws-1'), 'session-b')).rejects.toThrow(/does not belong to workspace ws-1/)
  })

  it('falls back to current behavior when the client has no claimed workspace', async () => {
    const { getMessages } = createHarness()

    await expect(getMessages!(ctx(null), 'session-b')).resolves.toEqual(SESSIONS[1])
  })

  it('rejects path-traversal session ids before use', async () => {
    const { getMessages, deleteSession } = createHarness()

    await expect(getMessages!(ctx('ws-1'), '../../etc/passwd')).rejects.toThrow(/path traversal/)
    await expect(deleteSession!(ctx(null), '../../etc/passwd')).rejects.toThrow(/path traversal/)
  })
})
