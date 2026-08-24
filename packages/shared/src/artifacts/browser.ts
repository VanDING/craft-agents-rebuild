/** Browser-safe Artifact contracts and event helpers. */
export type {
  AcceptArtifactResult,
  ApplyArtifactDraftInput,
  ArtifactApplyOperation,
  ArtifactCapabilities,
  ArtifactDeliverable,
  ArtifactDescriptor,
  ArtifactEventSnapshot,
  ArtifactKind,
  ArtifactLease,
  ArtifactListFilter,
  ArtifactPreview,
  ArtifactRevision,
  ArtifactRevisionOrigin,
  ArtifactStatus,
  ArtifactStorageScope,
  ArtifactValidation,
  CreateArtifactDraftInput,
  RegisterCurrentArtifactInput,
  ResolvedArtifact,
} from './types.ts';

export { ARTIFACT_KINDS } from './types.ts';
export {
  ARTIFACT_EVENT_PREFIX,
  artifactRevision,
  createArtifactEventSnapshot,
  parseArtifactEvent,
  serializeArtifactEvent,
} from './events.ts';
