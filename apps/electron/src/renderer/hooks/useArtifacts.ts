import { useCallback, useEffect, useState } from 'react'
import type {
  AcceptArtifactResult,
  ApplyArtifactDraftInput,
  ArtifactListFilter,
  CreateArtifactDraftInput,
  RegisterCurrentArtifactInput,
  ResolvedArtifact,
} from '@craft-agent/shared/artifacts/browser'

function upsertArtifact(previous: ResolvedArtifact[], next: ResolvedArtifact): ResolvedArtifact[] {
  const found = previous.some(({ artifact }) => artifact.id === next.artifact.id)
  return (found
    ? previous.map((candidate) => candidate.artifact.id === next.artifact.id ? next : candidate)
    : [next, ...previous]
  ).sort((left, right) => right.artifact.updatedAt - left.artifact.updatedAt)
}

export function useArtifacts(workspaceId: string | null, sessionId?: string) {
  const [artifacts, setArtifacts] = useState<ResolvedArtifact[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setArtifacts([])
      setError(null)
      setIsLoading(false)
      return
    }
    try {
      setIsLoading(true)
      const filter: ArtifactListFilter | undefined = sessionId ? { sessionId } : undefined
      setArtifacts(await window.electronAPI.listArtifacts(workspaceId, filter))
      setError(null)
    } catch (cause) {
      console.error('[useArtifacts] Failed to load artifacts:', cause)
      setError(cause instanceof Error ? cause.message : 'Failed to load artifacts')
    } finally {
      setIsLoading(false)
    }
  }, [sessionId, workspaceId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!workspaceId) return
    return window.electronAPI.onArtifactsChanged((changedWorkspaceId) => {
      if (changedWorkspaceId === workspaceId) void refresh()
    })
  }, [refresh, workspaceId])

  const run = useCallback(async (
    operation: () => Promise<ResolvedArtifact>,
    label: string,
  ): Promise<ResolvedArtifact | null> => {
    try {
      const result = await operation()
      setArtifacts((previous) => upsertArtifact(previous, result))
      setError(null)
      return result
    } catch (cause) {
      console.error(`[useArtifacts] ${label}:`, cause)
      setError(cause instanceof Error ? cause.message : label)
      return null
    }
  }, [])

  const create = useCallback((input: CreateArtifactDraftInput) => {
    if (!workspaceId) return Promise.resolve(null)
    return run(() => window.electronAPI.createArtifact(workspaceId, input), 'Failed to create artifact')
  }, [run, workspaceId])

  const registerCurrent = useCallback((input: RegisterCurrentArtifactInput) => {
    if (!workspaceId) return Promise.resolve(null)
    return run(
      () => window.electronAPI.registerCurrentArtifact(workspaceId, input),
      'Failed to register artifact preview',
    )
  }, [run, workspaceId])

  const apply = useCallback((artifactId: string, input: ApplyArtifactDraftInput) => {
    if (!workspaceId) return Promise.resolve(null)
    return run(() => window.electronAPI.applyArtifact(workspaceId, artifactId, input), 'Failed to update artifact')
  }, [run, workspaceId])

  const inspect = useCallback((artifactId: string, leaseId?: string) => {
    if (!workspaceId) return Promise.resolve(null)
    return run(() => window.electronAPI.inspectArtifact(workspaceId, artifactId, leaseId), 'Failed to inspect artifact')
  }, [run, workspaceId])

  const submit = useCallback((artifactId: string, expectedRevision?: string, leaseId?: string) => {
    if (!workspaceId) return Promise.resolve(null)
    return run(
      () => window.electronAPI.submitArtifact(workspaceId, artifactId, expectedRevision, leaseId),
      'Failed to submit artifact',
    )
  }, [run, workspaceId])

  const revise = useCallback((artifactId: string) => {
    if (!workspaceId) return Promise.resolve(null)
    return run(() => window.electronAPI.reviseArtifact(workspaceId, artifactId), 'Failed to revise artifact')
  }, [run, workspaceId])

  const accept = useCallback(async (artifactId: string): Promise<AcceptArtifactResult | null> => {
    if (!workspaceId) return null
    try {
      const result = await window.electronAPI.acceptArtifact(workspaceId, artifactId)
      setArtifacts((previous) => upsertArtifact(previous, result.artifact))
      setError(null)
      return result
    } catch (cause) {
      console.error('[useArtifacts] Failed to accept artifact:', cause)
      setError(cause instanceof Error ? cause.message : 'Failed to accept artifact')
      return null
    }
  }, [workspaceId])

  const discard = useCallback((artifactId: string) => {
    if (!workspaceId) return Promise.resolve(null)
    return run(() => window.electronAPI.discardArtifact(workspaceId, artifactId), 'Failed to discard artifact')
  }, [run, workspaceId])

  const acquireLease = useCallback((artifactId: string, durationMs?: number) => {
    if (!workspaceId) return Promise.resolve(null)
    return run(
      () => window.electronAPI.acquireArtifactLease(workspaceId, artifactId, 'user', durationMs),
      'Failed to acquire artifact edit lease',
    )
  }, [run, workspaceId])

  const releaseLease = useCallback((artifactId: string, leaseId: string) => {
    if (!workspaceId) return Promise.resolve(null)
    return run(
      () => window.electronAPI.releaseArtifactLease(workspaceId, artifactId, leaseId),
      'Failed to release artifact edit lease',
    )
  }, [run, workspaceId])

  return {
    artifacts,
    isLoading,
    error,
    refresh,
    create,
    registerCurrent,
    apply,
    inspect,
    submit,
    revise,
    accept,
    discard,
    acquireLease,
    releaseLease,
  }
}
