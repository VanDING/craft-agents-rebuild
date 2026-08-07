import { RPC_CHANNELS, type CalendarEntryInput } from '@craft-agent/shared/protocol'
import {
  listCalendarEntries,
  createCalendarEntry,
  updateCalendarEntry,
  deleteCalendarEntry,
} from '@craft-agent/shared/calendar'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.calendar.LIST,
  RPC_CHANNELS.calendar.CREATE,
  RPC_CHANNELS.calendar.UPDATE,
  RPC_CHANNELS.calendar.DELETE,
] as const

export function registerCalendarHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // List all calendar entries for a workspace
  server.handle(RPC_CHANNELS.calendar.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    return listCalendarEntries(workspace.rootPath)
  })

  // Create a calendar entry
  server.handle(RPC_CHANNELS.calendar.CREATE, async (_ctx, workspaceId: string, input: CalendarEntryInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const entry = createCalendarEntry(workspace.rootPath, input)
    pushTyped(server, RPC_CHANNELS.calendar.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    return entry
  })

  // Update a calendar entry
  server.handle(RPC_CHANNELS.calendar.UPDATE, async (
    _ctx,
    workspaceId: string,
    entryId: string,
    input: CalendarEntryInput,
  ) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const entry = updateCalendarEntry(workspace.rootPath, entryId, input)
    pushTyped(server, RPC_CHANNELS.calendar.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    return entry
  })

  // Delete a calendar entry
  server.handle(RPC_CHANNELS.calendar.DELETE, async (_ctx, workspaceId: string, entryId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    deleteCalendarEntry(workspace.rootPath, entryId)
    pushTyped(server, RPC_CHANNELS.calendar.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  })
}
