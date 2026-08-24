import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  acceptArtifact,
  acquireArtifactLease,
  applyArtifactDraft,
  createArtifactDraft,
  discardArtifact,
  getArtifact,
  inspectArtifact,
  listArtifacts,
  releaseArtifactLease,
  registerCurrentArtifact,
  reviseArtifact,
  submitArtifact,
  type ApplyArtifactDraftInput,
  type ArtifactListFilter,
  type ArtifactStorageScope,
  type CreateArtifactDraftInput,
  type RegisterCurrentArtifactInput,
} from '@craft-agent/shared/artifacts'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { getWorkspaceAllowedDirs } from '@craft-agent/server-core/handlers'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { renderOfficeArtifactPreview } from '../../services/artifact-preview'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.artifacts.LIST,
  RPC_CHANNELS.artifacts.GET,
  RPC_CHANNELS.artifacts.REGISTER_CURRENT,
  RPC_CHANNELS.artifacts.CREATE,
  RPC_CHANNELS.artifacts.APPLY,
  RPC_CHANNELS.artifacts.INSPECT,
  RPC_CHANNELS.artifacts.SUBMIT,
  RPC_CHANNELS.artifacts.REVISE,
  RPC_CHANNELS.artifacts.ACCEPT,
  RPC_CHANNELS.artifacts.DISCARD,
  RPC_CHANNELS.artifacts.ACQUIRE_LEASE,
  RPC_CHANNELS.artifacts.RELEASE_LEASE,
] as const

function workspaceRoot(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function scopeForSession(deps: HandlerDeps, workspaceId: string, sessionId: string): ArtifactStorageScope {
  const rootPath = workspaceRoot(workspaceId)
  const session = deps.sessionManager.getSessions(workspaceId).find((candidate) => candidate.id === sessionId)
  if (!session) throw new Error(`Artifact session not found in workspace: ${sessionId}`)
  const contentRootPath = session.workingDirectory || rootPath
  return {
    workspaceRootPath: rootPath,
    workspaceId,
    contentRootPath,
    allowedRoots: [...getWorkspaceAllowedDirs(workspaceId), contentRootPath],
  }
}

function scopeForArtifact(deps: HandlerDeps, workspaceId: string, artifactId: string): ArtifactStorageScope {
  const rootPath = workspaceRoot(workspaceId)
  const existing = getArtifact({ workspaceRootPath: rootPath }, artifactId)
  return scopeForSession(deps, workspaceId, existing.artifact.sessionId)
}

function broadcastChanged(server: RpcServer, workspaceId: string): void {
  pushTyped(server, RPC_CHANNELS.artifacts.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
}

export function registerArtifactHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.artifacts.LIST, async (_ctx, workspaceId: string, filter?: ArtifactListFilter) => {
    await deps.sessionManager.waitForInit()
    // Some transports preserve an omitted optional positional argument as
    // `null`; normalize at the RPC boundary before the domain filter reads it.
    return listArtifacts({ workspaceRootPath: workspaceRoot(workspaceId) }, filter ?? {})
  })

  server.handle(RPC_CHANNELS.artifacts.GET, async (_ctx, workspaceId: string, artifactId: string) => {
    return getArtifact({ workspaceRootPath: workspaceRoot(workspaceId) }, artifactId)
  })

  server.handle(RPC_CHANNELS.artifacts.REGISTER_CURRENT, async (
    _ctx,
    workspaceId: string,
    input: RegisterCurrentArtifactInput,
  ) => {
    await deps.sessionManager.waitForInit()
    const scope = scopeForSession(deps, workspaceId, input.sessionId)
    const registered = registerCurrentArtifact(scope, input)
    const artifact = await renderOfficeArtifactPreview(scope, registered)
    broadcastChanged(server, workspaceId)
    return artifact
  })

  server.handle(RPC_CHANNELS.artifacts.CREATE, async (_ctx, workspaceId: string, input: CreateArtifactDraftInput) => {
    await deps.sessionManager.waitForInit()
    const artifact = createArtifactDraft(scopeForSession(deps, workspaceId, input.sessionId), input)
    broadcastChanged(server, workspaceId)
    return artifact
  })

  server.handle(RPC_CHANNELS.artifacts.APPLY, async (
    _ctx,
    workspaceId: string,
    artifactId: string,
    input: ApplyArtifactDraftInput,
  ) => {
    const artifact = applyArtifactDraft(scopeForArtifact(deps, workspaceId, artifactId), artifactId, input)
    broadcastChanged(server, workspaceId)
    return artifact
  })

  server.handle(RPC_CHANNELS.artifacts.INSPECT, async (
    _ctx,
    workspaceId: string,
    artifactId: string,
    leaseId?: string,
  ) => {
    const scope = scopeForArtifact(deps, workspaceId, artifactId)
    const inspected = inspectArtifact(scope, artifactId, { leaseId })
    const artifact = await renderOfficeArtifactPreview(scope, inspected)
    broadcastChanged(server, workspaceId)
    return artifact
  })

  server.handle(RPC_CHANNELS.artifacts.SUBMIT, async (
    _ctx,
    workspaceId: string,
    artifactId: string,
    expectedRevision?: string,
    leaseId?: string,
  ) => {
    const scope = scopeForArtifact(deps, workspaceId, artifactId)
    const inspected = inspectArtifact(scope, artifactId, { leaseId })
    await renderOfficeArtifactPreview(scope, inspected)
    const artifact = submitArtifact(scope, artifactId, { expectedRevision, leaseId })
    broadcastChanged(server, workspaceId)
    return artifact
  })

  server.handle(RPC_CHANNELS.artifacts.REVISE, async (_ctx, workspaceId: string, artifactId: string) => {
    const artifact = reviseArtifact(scopeForArtifact(deps, workspaceId, artifactId), artifactId)
    broadcastChanged(server, workspaceId)
    return artifact
  })

  server.handle(RPC_CHANNELS.artifacts.ACCEPT, async (_ctx, workspaceId: string, artifactId: string) => {
    const result = acceptArtifact(scopeForArtifact(deps, workspaceId, artifactId), artifactId)
    broadcastChanged(server, workspaceId)
    return result
  })

  server.handle(RPC_CHANNELS.artifacts.DISCARD, async (_ctx, workspaceId: string, artifactId: string) => {
    const artifact = discardArtifact(scopeForArtifact(deps, workspaceId, artifactId), artifactId)
    broadcastChanged(server, workspaceId)
    return artifact
  })

  server.handle(RPC_CHANNELS.artifacts.ACQUIRE_LEASE, async (
    _ctx,
    workspaceId: string,
    artifactId: string,
    owner: 'agent' | 'user',
    durationMs?: number,
  ) => {
    const scope = scopeForArtifact(deps, workspaceId, artifactId)
    const artifact = acquireArtifactLease(scope, artifactId, owner, durationMs)
    broadcastChanged(server, workspaceId)
    return artifact
  })

  server.handle(RPC_CHANNELS.artifacts.RELEASE_LEASE, async (
    _ctx,
    workspaceId: string,
    artifactId: string,
    leaseId: string,
  ) => {
    const scope = scopeForArtifact(deps, workspaceId, artifactId)
    const artifact = releaseArtifactLease(scope, artifactId, leaseId)
    broadcastChanged(server, workspaceId)
    return artifact
  })
}
