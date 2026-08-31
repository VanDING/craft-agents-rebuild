import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { TerminalCreateOptions } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { pushTyped } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'

export function registerTerminalHandlers(server: RpcServer, deps: HandlerDeps): void {
  const manager = deps.terminalManager
  if (!manager) return
  server.handle(RPC_CHANNELS.terminal.CREATE, (_ctx, options: TerminalCreateOptions) => manager.create(options))
  server.handle(RPC_CHANNELS.terminal.GET_FOR_WORKSPACE, (_ctx, workspaceId: string) => manager.getForWorkspace(workspaceId))
  server.handle(RPC_CHANNELS.terminal.WRITE, (_ctx, id: string, data: string) => manager.write(id, data))
  server.handle(RPC_CHANNELS.terminal.RESIZE, (_ctx, id: string, cols: number, rows: number) => manager.resize(id, cols, rows))
  server.handle(RPC_CHANNELS.terminal.DESTROY, (_ctx, id: string) => manager.destroy(id))
  server.handle(RPC_CHANNELS.terminal.DESTROY_FOR_WORKSPACE, (_ctx, workspaceId: string) => manager.destroyForWorkspace(workspaceId))
  manager.onData((event) => pushTyped(server, RPC_CHANNELS.terminal.DATA, { to: 'all' }, event))
  manager.onExit((event) => pushTyped(server, RPC_CHANNELS.terminal.EXIT, { to: 'all' }, event))
}
