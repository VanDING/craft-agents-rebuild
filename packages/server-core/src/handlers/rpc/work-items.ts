import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  createWorkItem,
  createWorkItemView,
  deleteWorkItem,
  deleteWorkItemView,
  listWorkItemEvents,
  listWorkItemViews,
  migrateLegacySessionWorkItems,
  updateWorkItem,
  updateWorkItemView,
  type CreateWorkItemInput,
  type CreateWorkItemViewInput,
  type UpdateWorkItemInput,
  type UpdateWorkItemViewInput,
  type WorkItemMutationContext,
} from '@craft-agent/shared/work-items'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.workItems.LIST,
  RPC_CHANNELS.workItems.CREATE,
  RPC_CHANNELS.workItems.UPDATE,
  RPC_CHANNELS.workItems.DELETE,
  RPC_CHANNELS.workItems.LIST_EVENTS,
  RPC_CHANNELS.workItems.LIST_VIEWS,
  RPC_CHANNELS.workItems.CREATE_VIEW,
  RPC_CHANNELS.workItems.UPDATE_VIEW,
  RPC_CHANNELS.workItems.DELETE_VIEW,
] as const

function workspaceRoot(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function broadcastChanged(server: RpcServer, workspaceId: string): void {
  pushTyped(server, RPC_CHANNELS.workItems.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
}

function userMutation(clientId: string): WorkItemMutationContext {
  return { actor: { type: 'user', id: clientId } }
}

async function mirrorToPrimarySession(
  deps: HandlerDeps,
  workspaceId: string,
  item: ReturnType<typeof createWorkItem>,
  fields: {
    title?: boolean
    projectId?: boolean
    statusId?: boolean
    columnId?: boolean
  },
): Promise<void> {
  const sessionId = item.primarySessionId
  if (!sessionId) return
  const exists = deps.sessionManager.getSessions(workspaceId)
    .some((session) => session.id === sessionId)
  if (!exists) return

  try {
    // Deliberately sequential: each Session mutation persists the same JSONL
    // header, so parallel writes would make the final projection nondeterministic.
    if (fields.title) await deps.sessionManager.renameSession(sessionId, item.title)
    if (fields.projectId) await deps.sessionManager.setSessionProjectId(sessionId, item.projectId ?? null)
    if (fields.statusId) await deps.sessionManager.setSessionStatus(sessionId, item.statusId)
    if (fields.columnId) await deps.sessionManager.setKanbanColumn(sessionId, item.columnId ?? null)
  } catch (error) {
    // WorkItem is durable-first and remains authoritative. A later Session write
    // or explicit WorkItem edit will reconcile the compatibility projection.
    deps.platform.logger.warn('[work-items] Failed to mirror WorkItem to primary session:', {
      workItemId: item.id,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function registerWorkItemHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.workItems.LIST, async (_ctx, workspaceId: string) => {
    await deps.sessionManager.waitForInit()
    const rootPath = workspaceRoot(workspaceId)
    const legacySources = deps.sessionManager
      .getSessions(workspaceId)
      .filter((session) => !session.parentSessionId && !session.isArchived && !session.hidden && !session.taskDraft)
      .map((session) => ({
        id: session.id,
        title: session.name?.trim() || session.preview?.trim() || 'Untitled task',
        projectId: session.projectId,
        statusId: session.sessionStatus,
        columnId: session.kanbanColumn,
        createdAt: session.createdAt,
        updatedAt: session.lastMessageAt,
      }))
    const migration = migrateLegacySessionWorkItems(rootPath, legacySources)
    if (!migration.alreadyCompleted) broadcastChanged(server, workspaceId)
    return migration.items
  })

  server.handle(
    RPC_CHANNELS.workItems.CREATE,
    async (ctx, workspaceId: string, input: CreateWorkItemInput) => {
      const item = createWorkItem(workspaceRoot(workspaceId), input, userMutation(ctx.clientId))
      broadcastChanged(server, workspaceId)
      await mirrorToPrimarySession(deps, workspaceId, item, {
        title: true,
        projectId: true,
        statusId: true,
        columnId: true,
      })
      return item
    },
  )

  server.handle(
    RPC_CHANNELS.workItems.UPDATE,
    async (ctx, workspaceId: string, itemId: string, patch: UpdateWorkItemInput) => {
      const item = updateWorkItem(workspaceRoot(workspaceId), itemId, patch, userMutation(ctx.clientId))
      broadcastChanged(server, workspaceId)
      await mirrorToPrimarySession(deps, workspaceId, item, {
        title: patch.title !== undefined,
        projectId: 'projectId' in patch,
        statusId: patch.statusId !== undefined,
        columnId: 'columnId' in patch,
      })
      return item
    },
  )

  server.handle(RPC_CHANNELS.workItems.DELETE, async (ctx, workspaceId: string, itemId: string) => {
    deleteWorkItem(workspaceRoot(workspaceId), itemId, userMutation(ctx.clientId))
    broadcastChanged(server, workspaceId)
  })

  server.handle(RPC_CHANNELS.workItems.LIST_EVENTS, (_ctx, workspaceId: string, itemId: string, limit?: number) =>
    listWorkItemEvents(workspaceRoot(workspaceId), itemId, limit),
  )

  server.handle(RPC_CHANNELS.workItems.LIST_VIEWS, (_ctx, workspaceId: string) =>
    listWorkItemViews(workspaceRoot(workspaceId)),
  )

  server.handle(
    RPC_CHANNELS.workItems.CREATE_VIEW,
    (_ctx, workspaceId: string, input: CreateWorkItemViewInput) => {
      const view = createWorkItemView(workspaceRoot(workspaceId), input)
      broadcastChanged(server, workspaceId)
      return view
    },
  )

  server.handle(
    RPC_CHANNELS.workItems.UPDATE_VIEW,
    (_ctx, workspaceId: string, viewId: string, patch: UpdateWorkItemViewInput) => {
      const view = updateWorkItemView(workspaceRoot(workspaceId), viewId, patch)
      broadcastChanged(server, workspaceId)
      return view
    },
  )

  server.handle(RPC_CHANNELS.workItems.DELETE_VIEW, (_ctx, workspaceId: string, viewId: string) => {
    deleteWorkItemView(workspaceRoot(workspaceId), viewId)
    broadcastChanged(server, workspaceId)
  })
}
