import type { ArtifactDescriptor, ArtifactEventSnapshot, ResolvedArtifact } from './types.ts';

export const ARTIFACT_EVENT_PREFIX = 'CRAFT_ARTIFACT_EVENT:';

export function createArtifactEventSnapshot(resolved: ResolvedArtifact): ArtifactEventSnapshot {
  const artifact = resolved.artifact;
  return {
    type: 'artifact_event',
    artifactId: artifact.id,
    sessionId: artifact.sessionId,
    turnId: artifact.turnId,
    title: artifact.title,
    kind: artifact.kind,
    status: artifact.status,
    revision: artifact.draftRevision ?? artifact.currentRevision,
    sourcePath: artifact.sourcePath,
    validation: artifact.validation,
    timestamp: artifact.updatedAt,
  };
}

export function serializeArtifactEvent(resolved: ResolvedArtifact): string {
  return `${ARTIFACT_EVENT_PREFIX}${JSON.stringify(createArtifactEventSnapshot(resolved))}`;
}

export function parseArtifactEvent(text: string | undefined): ArtifactEventSnapshot | null {
  if (!text) return null;
  const index = text.indexOf(ARTIFACT_EVENT_PREFIX);
  if (index < 0) return null;
  const payload = text.slice(index + ARTIFACT_EVENT_PREFIX.length).trim().split('\n')[0];
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as ArtifactEventSnapshot;
    if (
      parsed?.type !== 'artifact_event'
      || typeof parsed.artifactId !== 'string'
      || typeof parsed.sessionId !== 'string'
      || typeof parsed.title !== 'string'
      || typeof parsed.sourcePath !== 'string'
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function artifactRevision(descriptor: Pick<ArtifactDescriptor, 'draftRevision' | 'currentRevision'>): string | null {
  return descriptor.draftRevision ?? descriptor.currentRevision;
}
