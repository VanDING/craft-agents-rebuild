export const ARTIFACT_KINDS = [
  'spreadsheet',
  'document',
  'presentation',
  'data',
  'diagram',
  'pdf',
  'image',
  'audio',
  'video',
  'archive',
  'file',
  'html',
  'text',
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type ArtifactStatus = 'current' | 'draft' | 'ready' | 'accepted' | 'discarded' | 'conflict';
export type ArtifactRevisionOrigin = 'create' | 'apply' | 'external-edit' | 'accept';

export interface ArtifactCapabilities {
  preview: boolean;
  inspect: boolean;
  edit: boolean;
  materialize: boolean;
}

export interface ArtifactRevision {
  id: string;
  contentHash: string;
  size: number;
  createdAt: number;
  origin: ArtifactRevisionOrigin;
}

export interface ArtifactValidation {
  revision: string;
  valid: boolean;
  checkedAt: number;
  errors: string[];
  warnings: string[];
  summary: string;
}

export interface ArtifactPreview {
  id: string;
  revision: string;
  kind: 'source' | 'text' | 'json' | 'image' | 'pdf' | 'markdown' | 'html';
  mimeType: string;
  /** Resolved local preview path. Managed previews are immutable per revision. */
  path?: string;
}

export interface ArtifactDeliverable {
  id: string;
  revision: string;
  path: string;
  mimeType: string;
}

export interface ArtifactLease {
  id: string;
  owner: 'agent' | 'user';
  acquiredAt: number;
  expiresAt: number;
}

export interface ArtifactProvenance {
  origin: 'generated' | 'imported' | 'tool';
  tool?: string;
  provider?: string;
  connectionSlug?: string;
  model?: string;
  prompt?: string;
  parameters?: Record<string, string | number | boolean | null>;
  createdAt: number;
}

/** Engine-independent artifact projection consumed by cards and workbench UI. */
export interface ArtifactDescriptor {
  id: string;
  workspaceId: string;
  sessionId: string;
  turnId?: string;
  title: string;
  kind: ArtifactKind;
  engineId: string;
  /** Absolute deliverable path. Never points at the managed draft revision. */
  sourcePath: string;
  mimeType: string;
  baseRevision: string | null;
  currentRevision: string | null;
  draftRevision: string | null;
  status: ArtifactStatus;
  capabilities: ArtifactCapabilities;
  previews: ArtifactPreview[];
  deliverables: ArtifactDeliverable[];
  revisions: ArtifactRevision[];
  validation?: ArtifactValidation;
  provenance?: ArtifactProvenance;
  lease?: ArtifactLease;
  createdAt: number;
  updatedAt: number;
  acceptedAt?: number;
  discardedAt?: number;
}

/** Descriptor plus server-resolved paths for preview/editor adapters. */
export interface ResolvedArtifact {
  artifact: ArtifactDescriptor;
  /** Immutable reviewed revision, or accepted source path after commit. */
  activePath: string | null;
  /** Mutable managed checkout. Only present while the artifact is a draft. */
  editablePath: string | null;
}

export interface ArtifactStorageScope {
  workspaceRootPath: string;
  workspaceId: string;
  /** Relative target paths resolve here (normally the Session working directory). */
  contentRootPath?: string;
  /** Every source/initial path must remain inside one of these roots. */
  allowedRoots?: readonly string[];
}

export interface CreateArtifactDraftInput {
  sessionId: string;
  turnId?: string;
  title?: string;
  kind: ArtifactKind;
  engineId?: string;
  sourcePath: string;
  mimeType?: string;
  /** Optional existing file used as draft content without touching sourcePath. */
  initialPath?: string;
  initialText?: string;
  initialBase64?: string;
  provenance?: ArtifactProvenance;
}

/** Register an existing file as a read-only/current Artifact preview. */
export interface RegisterCurrentArtifactInput {
  sessionId: string;
  sourcePath: string;
  title?: string;
  kind?: ArtifactKind;
  mimeType?: string;
}

export type ArtifactApplyOperation =
  | { type: 'set_text'; text: string }
  | { type: 'set_json'; value: unknown }
  | { type: 'replace_text'; search: string; replacement: string; replaceAll?: boolean };

export interface ApplyArtifactDraftInput {
  expectedRevision: string;
  operation: ArtifactApplyOperation;
  leaseId?: string;
}

export interface ArtifactListFilter {
  sessionId?: string;
  statuses?: readonly ArtifactStatus[];
}

export interface AcceptArtifactResult {
  artifact: ResolvedArtifact;
  accepted: boolean;
  conflict?: {
    expectedBaseRevision: string | null;
    actualRevision: string | null;
  };
}

/** Immutable event payload written into an Agent tool result for Turn replay. */
export interface ArtifactEventSnapshot {
  type: 'artifact_event';
  artifactId: string;
  sessionId: string;
  turnId?: string;
  title: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  revision: string | null;
  sourcePath: string;
  /** Stable path for rendering the revision represented by this event. */
  previewPath?: string;
  mimeType?: string;
  validation?: ArtifactValidation;
  provenance?: ArtifactProvenance;
  timestamp: number;
}
