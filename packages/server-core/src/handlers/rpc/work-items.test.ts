import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { listWorkItemEvents, listWorkItems } from '@craft-agent/shared/work-items'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { registerWorkItemHandlers } from './work-items'

let workspaceRoot = ''
const workspaceFixture = { id: 'ws-test', name: 'ws-test', rootPath: '' }

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => (id === workspaceFixture.id ? workspaceFixture : null),
}))

const context: RequestContext = {
  clientId: 'test-client',
  workspaceId: workspaceFixture.id,
  webContentsId: 1,
}

interface SessionFixture {
  id: string
  name?: string
  preview?: string
  projectId?: string
  sessionStatus?: string
  kanbanColumn?: string
  parentSessionId?: string
  createdAt?: number
  lastMessageAt?: number
  isArchived?: boolean
  hidden?: boolean
  taskDraft?: unknown
}

function createHarness(options?: {
  sessions?: SessionFixture[]
  failRename?: boolean
}) {
  const sessions = options?.sessions ?? []
  const handlers = new Map<string, HandlerFn>()
  const pushes: Array<{ channel: string; args: unknown[] }> = []
  const calls: string[] = []
  const warnings: unknown[][] = []
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push(channel, _target, ...args) {
      pushes.push({ channel, args })
    },
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const sessionManager = {
    async waitForInit() {},
    getSessions: () => sessions,
    async renameSession(sessionId: string, title: string) {
      calls.push(`title:${sessionId}:${title}`)
      if (options?.failRename) throw new Error('session mirror failed')
    },
    async setSessionProjectId(sessionId: string, projectId: string | null) {
      calls.push(`project:${sessionId}:${projectId ?? ''}`)
    },
    async setSessionStatus(sessionId: string, statusId: string) {
      calls.push(`status:${sessionId}:${statusId}`)
    },
    async setKanbanColumn(sessionId: string, columnId: string | null) {
      calls.push(`column:${sessionId}:${columnId ?? ''}`)
    },
  } as unknown as HandlerDeps['sessionManager']
  const deps: HandlerDeps = {
    sessionManager,
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: {
        info() {},
        warn: (...args: unknown[]) => warnings.push(args),
        error() {},
        debug() {},
      },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
  }
  registerWorkItemHandlers(server, deps)

  const handler = (channel: string): HandlerFn => {
    const registered = handlers.get(channel)
    if (!registered) throw new Error(`Handler not registered: ${channel}`)
    return registered
  }

  return { sessions, pushes, calls, warnings, handler }
}

describe('work item RPC handlers', () => {
  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'craft-agent-work-items-rpc-'))
    workspaceFixture.rootPath = workspaceRoot
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('continuously reconciles eligible top-level sessions after migration', async () => {
    const harness = createHarness({
      sessions: [
        { id: 'legacy', name: 'Legacy task', projectId: 'project-a', sessionStatus: 'todo', createdAt: 10, lastMessageAt: 20 },
        { id: 'child', name: 'Child', parentSessionId: 'legacy' },
        { id: 'archived', name: 'Archived', isArchived: true },
        { id: 'draft', name: 'Draft', taskDraft: { title: 'Draft' } },
      ],
    })
    const list = harness.handler(RPC_CHANNELS.workItems.LIST)

    const first = await list(context, workspaceFixture.id)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      title: 'Legacy task',
      projectId: 'project-a',
      primarySessionId: 'legacy',
      sessionIds: ['legacy'],
    })

    harness.sessions.push({ id: 'later', name: 'Later plain conversation' })
    const second = await list(context, workspaceFixture.id)
    expect(second).toHaveLength(2)
    expect(second.some((item: { primarySessionId?: string }) => item.primarySessionId === 'later')).toBe(true)
    expect(harness.pushes.filter(({ channel }) => channel === RPC_CHANNELS.workItems.CHANGED)).toHaveLength(2)
  })

  it('keeps the WorkItem durable when the compatibility Session mirror fails', async () => {
    const harness = createHarness({ sessions: [{ id: 'session-1', name: 'Old' }], failRename: true })
    const create = harness.handler(RPC_CHANNELS.workItems.CREATE)

    const item = await create(context, workspaceFixture.id, {
      title: 'Durable task',
      projectId: 'project-a',
      statusId: 'doing',
      columnId: 'active',
      sessionIds: ['session-1'],
      primarySessionId: 'session-1',
    })

    expect(listWorkItems(workspaceRoot)).toEqual([item])
    expect(harness.calls).toEqual(['title:session-1:Durable task'])
    expect(harness.warnings).toHaveLength(1)
    expect(harness.pushes.some(({ channel }) => channel === RPC_CHANNELS.workItems.CHANGED)).toBe(true)
  })

  it('mirrors only explicitly updated compatibility fields in deterministic order', async () => {
    const harness = createHarness({ sessions: [{ id: 'session-1', name: 'Old' }] })
    const create = harness.handler(RPC_CHANNELS.workItems.CREATE)
    const update = harness.handler(RPC_CHANNELS.workItems.UPDATE)
    const standalone = await create(context, workspaceFixture.id, { title: 'Standalone' })
    harness.calls.length = 0

    const linked = await update(context, workspaceFixture.id, standalone.id, {
      title: 'Linked task',
      projectId: 'project-b',
      statusId: 'done',
      columnId: 'complete',
      sessionIds: ['session-1'],
      primarySessionId: 'session-1',
    })

    expect(linked.primarySessionId).toBe('session-1')
    expect(harness.calls).toEqual([
      'title:session-1:Linked task',
      'project:session-1:project-b',
      'status:session-1:done',
      'column:session-1:complete',
    ])
  })

  it('exposes actor-aware item history', async () => {
    const harness = createHarness()
    const createItem = harness.handler(RPC_CHANNELS.workItems.CREATE)
    const updateItem = harness.handler(RPC_CHANNELS.workItems.UPDATE)
    const listEvents = harness.handler(RPC_CHANNELS.workItems.LIST_EVENTS)

    const item = await createItem(context, workspaceFixture.id, { title: 'History task' })
    await updateItem(context, workspaceFixture.id, item.id, { statusId: 'done' })
    const events = await listEvents(context, workspaceFixture.id, item.id)
    expect(events.map((event: { action: string }) => event.action)).toEqual(['transitioned', 'created'])
    expect(listWorkItemEvents(workspaceRoot, item.id).every(({ actor }) => actor.type === 'user')).toBe(true)
  })
})
