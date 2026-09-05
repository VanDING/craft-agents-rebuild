import { useCallback, useEffect, useState } from 'react'
import type {
  AcceptArtifactResult,
  ApplyArtifactDraftInput,
  ArtifactListFilter,
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
  ): Promise<ResolvedArtifact> => {
    const result = await operation()
    setArtifacts((previous) => upsertArtifact(previous, result))
    return result
  }, [])

  const apply = useCallback((artifactId: string, input: ApplyArtifactDraftInput) => {
    if (!workspaceId) return Promise.reject(new Error('No active workspace'))
    return run(() => window.electronAPI.applyArtifact(workspaceId, artifactId, input))
  }, [run, workspaceId])

  const submit = useCallback((artifactId: string, expectedRevision?: string, leaseId?: string) => {
    if (!workspaceId) return Promise.reject(new Error('No active workspace'))
    return run(
      () => window.electronAPI.submitArtifact(workspaceId, artifactId, expectedRevision, leaseId),
    )
  }, [run, workspaceId])

  const revise = useCallback((artifactId: string) => {
    if (!workspaceId) return Promise.reject(new Error('No active workspace'))
    return run(() => window.electronAPI.reviseArtifact(workspaceId, artifactId))
  }, [run, workspaceId])

  const accept = useCallback(async (artifactId: string): Promise<AcceptArtifactResult> => {
    if (!workspaceId) throw new Error('No active workspace')
    const result = await window.electronAPI.acceptArtifact(workspaceId, artifactId)
    setArtifacts((previous) => upsertArtifact(previous, result.artifact))
    return result
  }, [workspaceId])

  const discard = useCallback((artifactId: string) => {
    if (!workspaceId) return Promise.reject(new Error('No active workspace'))
    return run(() => window.electronAPI.discardArtifact(workspaceId, artifactId))
  }, [run, workspaceId])

  const acquireLease = useCallback((artifactId: string, durationMs?: number) => {
    if (!workspaceId) return Promise.reject(new Error('No active workspace'))
    return run(
      () => window.electronAPI.acquireArtifactLease(workspaceId, artifactId, 'user', durationMs),
    )
  }, [run, workspaceId])

  return {
    artifacts,
    isLoading,
    error,
    refresh,
    apply,
    submit,
    revise,
    accept,
    discard,
    acquireLease,
  }
}
