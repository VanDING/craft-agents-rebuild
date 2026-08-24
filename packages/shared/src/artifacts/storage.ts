import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts';
import type {
  AcceptArtifactResult,
  ApplyArtifactDraftInput,
  ArtifactCapabilities,
  ArtifactDescriptor,
  ArtifactKind,
  ArtifactLease,
  ArtifactListFilter,
  ArtifactPreview,
  ArtifactRevision,
  ArtifactRevisionOrigin,
  ArtifactStorageScope,
  ArtifactValidation,
  CreateArtifactDraftInput,
  RegisterCurrentArtifactInput,
  ResolvedArtifact,
} from './types.ts';

const STORE_VERSION = 1;
const STORE_DIR = 'artifacts';
const STORE_FILE = 'artifacts/manifest.json';
const REVISION_DIR = 'artifacts/revisions';
const CHECKOUT_DIR = 'artifacts/checkouts';
const PREVIEW_DIR = 'artifacts/previews';
const DEFAULT_LEASE_MS = 15 * 60_000;
const MAX_LEASE_MS = 60 * 60_000;

interface StoredRevision extends ArtifactRevision {
  relativePath: string;
}

interface StoredPreview extends Omit<ArtifactPreview, 'path'> {
  relativePath?: string;
}

interface StoredArtifact extends Omit<ArtifactDescriptor, 'revisions' | 'previews'> {
  revisions: StoredRevision[];
  previews: StoredPreview[];
  checkoutRelativePath: string | null;
}

interface ArtifactStoreFile {
  version: typeof STORE_VERSION;
  artifacts: StoredArtifact[];
}

function manifestPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, STORE_FILE);
}

function hashBuffer(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function fileHash(path: string): string | null {
  return existsSync(path) ? hashBuffer(readFileSync(path)) : null;
}

/** Resolve symlinks in the nearest existing ancestor, including new targets. */
function canonicalPath(path: string): string {
  let cursor = resolve(path);
  const missingSegments: string[] = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    missingSegments.unshift(basename(cursor));
    cursor = parent;
  }
  const base = existsSync(cursor) ? realpathSync(cursor) : cursor;
  return resolve(base, ...missingSegments);
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(canonicalPath(root), canonicalPath(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function allowedRoots(scope: ArtifactStorageScope): string[] {
  const roots = scope.allowedRoots?.length
    ? scope.allowedRoots
    : [scope.contentRootPath ?? scope.workspaceRootPath, scope.workspaceRootPath];
  return [...new Set(roots.map((root) => resolve(root)))];
}

function resolveContentPath(scope: ArtifactStorageScope, input: string, field: string): string {
  const normalized = input.trim();
  if (!normalized) throw new Error(`Artifact ${field} must not be empty`);
  const candidate = isAbsolute(normalized)
    ? resolve(normalized)
    : resolve(scope.contentRootPath ?? scope.workspaceRootPath, normalized);
  if (!allowedRoots(scope).some((root) => isInside(root, candidate))) {
    throw new Error(`Artifact ${field} is outside the session/workspace scope: ${candidate}`);
  }
  return canonicalPath(candidate);
}

function optionalText(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function mimeTypeFor(kind: ArtifactKind, path: string, explicit?: string): string {
  const normalized = optionalText(explicit);
  if (normalized) return normalized;
  const ext = extname(path).toLowerCase();
  const byExtension: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return byExtension[ext] ?? (kind === 'text' ? 'text/plain' : 'application/octet-stream');
}

function capabilitiesFor(kind: ArtifactKind, engineId?: string): ArtifactCapabilities {
  const isInteractiveUniverSheet = kind === 'spreadsheet' && engineId === 'univer-sheet';
  return {
    preview: isInteractiveUniverSheet || ['text', 'data', 'image', 'pdf', 'html'].includes(kind),
    inspect: true,
    edit: isInteractiveUniverSheet || ['text', 'data', 'html'].includes(kind),
    materialize: false,
  };
}

function inferArtifactKind(path: string): ArtifactKind {
  const ext = extname(path).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') return 'spreadsheet';
  if (ext === '.docx' || ext === '.doc' || ext === '.md') return 'document';
  if (ext === '.pptx' || ext === '.ppt') return 'presentation';
  if (ext === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) return 'image';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.json') return 'data';
  return 'text';
}

function previewFor(kind: ArtifactKind, mimeType: string, revision: string): StoredPreview {
  const previewKind: ArtifactPreview['kind'] = kind === 'image'
    ? 'image'
    : kind === 'pdf'
      ? 'pdf'
      : mimeType === 'application/json'
        ? 'json'
        : kind === 'text' || kind === 'data' || kind === 'html'
          ? 'text'
          : 'source';
  return {
    id: `source:${revision}`,
    revision,
    kind: previewKind,
    mimeType,
  };
}

function publicDescriptor(
  scope: Pick<ArtifactStorageScope, 'workspaceRootPath'>,
  stored: StoredArtifact,
): ArtifactDescriptor {
  const { checkoutRelativePath: _checkoutRelativePath, revisions, ...descriptor } = stored;
  return {
    ...descriptor,
    revisions: revisions.map(({ relativePath: _relativePath, ...revision }) => ({ ...revision })),
    previews: descriptor.previews.map(({ relativePath, ...preview }) => ({
      ...preview,
      path: relativePath ? join(scope.workspaceRootPath, relativePath) : undefined,
    })),
    deliverables: descriptor.deliverables.map((deliverable) => ({ ...deliverable })),
    lease: descriptor.lease ? { ...descriptor.lease } : undefined,
    validation: descriptor.validation
      ? {
          ...descriptor.validation,
          errors: [...descriptor.validation.errors],
          warnings: [...descriptor.validation.warnings],
        }
      : undefined,
  };
}

function activeRevision(stored: StoredArtifact): StoredRevision | undefined {
  const revisionId = stored.status === 'accepted'
    ? stored.currentRevision
    : stored.draftRevision ?? stored.currentRevision;
  return revisionId
    ? stored.revisions.find((revision) => revision.id === revisionId)
    : undefined;
}

function resolvedArtifact(scope: Pick<ArtifactStorageScope, 'workspaceRootPath'>, stored: StoredArtifact): ResolvedArtifact {
  const revision = activeRevision(stored);
  const activePath = stored.status === 'accepted' && existsSync(stored.sourcePath)
    ? stored.sourcePath
    : revision
      ? join(scope.workspaceRootPath, revision.relativePath)
      : null;
  const editablePath = stored.status === 'draft' && stored.checkoutRelativePath
    ? join(scope.workspaceRootPath, stored.checkoutRelativePath)
    : null;
  return { artifact: publicDescriptor(scope, stored), activePath, editablePath };
}

function assertRevision(revision: StoredRevision): void {
  if (!revision.id || !/^[a-f0-9]{64}$/.test(revision.contentHash) || revision.id !== revision.contentHash) {
    throw new Error('Invalid artifact revision hash');
  }
  if (!Number.isFinite(revision.size) || revision.size < 0 || !Number.isFinite(revision.createdAt)) {
    throw new Error(`Invalid artifact revision metadata: ${revision.id}`);
  }
  if (!revision.relativePath || isAbsolute(revision.relativePath) || revision.relativePath.includes('..')) {
    throw new Error(`Invalid artifact revision path: ${revision.id}`);
  }
}

function assertStoredArtifact(stored: StoredArtifact): void {
  if (!stored.id || !stored.workspaceId || !stored.sessionId || !stored.title || !stored.sourcePath) {
    throw new Error('Invalid artifact descriptor');
  }
  if (!isAbsolute(stored.sourcePath)) throw new Error(`Artifact sourcePath must be absolute: ${stored.id}`);
  if (!Array.isArray(stored.revisions) || !Array.isArray(stored.previews) || !Array.isArray(stored.deliverables)) {
    throw new Error(`Invalid artifact collections: ${stored.id}`);
  }
  stored.revisions.forEach(assertRevision);
  for (const preview of stored.previews) {
    if (!preview.id || !preview.revision || !preview.kind || !preview.mimeType) {
      throw new Error(`Invalid artifact preview metadata: ${stored.id}`);
    }
    if (preview.relativePath && (isAbsolute(preview.relativePath) || preview.relativePath.includes('..'))) {
      throw new Error(`Invalid artifact preview path: ${stored.id}`);
    }
  }
  const ids = new Set(stored.revisions.map((revision) => revision.id));
  if (stored.draftRevision && !ids.has(stored.draftRevision)) throw new Error(`Missing draft revision: ${stored.id}`);
  if (stored.currentRevision && !ids.has(stored.currentRevision)) throw new Error(`Missing current revision: ${stored.id}`);
  if (!Number.isFinite(stored.createdAt) || !Number.isFinite(stored.updatedAt)) {
    throw new Error(`Invalid artifact timestamps: ${stored.id}`);
  }
}

function readStore(workspaceRootPath: string): ArtifactStoreFile {
  const path = manifestPath(workspaceRootPath);
  if (!existsSync(path)) return { version: STORE_VERSION, artifacts: [] };
  let parsed: ArtifactStoreFile;
  try {
    parsed = readJsonFileSync<ArtifactStoreFile>(path);
  } catch (error) {
    throw new Error(`Unable to read artifact store: ${path}`, { cause: error });
  }
  if (parsed?.version !== STORE_VERSION || !Array.isArray(parsed.artifacts)) {
    throw new Error(`Unsupported artifact store format: ${path}`);
  }
  const ids = new Set<string>();
  for (const artifact of parsed.artifacts) {
    assertStoredArtifact(artifact);
    if (ids.has(artifact.id)) throw new Error(`Duplicate artifact id: ${artifact.id}`);
    ids.add(artifact.id);
  }
  return parsed;
}

function saveStore(workspaceRootPath: string, store: ArtifactStoreFile): void {
  store.artifacts.forEach(assertStoredArtifact);
  mkdirSync(join(workspaceRootPath, STORE_DIR), { recursive: true });
  atomicWriteFileSync(manifestPath(workspaceRootPath), `${JSON.stringify(store, null, 2)}\n`);
}

function atomicWriteBuffer(path: string, content: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(tempPath, 'wx');
    writeFileSync(fd, content);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tempPath, path);
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* best effort */ }
    }
    try { unlinkSync(tempPath); } catch { /* best effort */ }
    throw error;
  }
}

function storeRevision(
  scope: Pick<ArtifactStorageScope, 'workspaceRootPath'>,
  artifact: StoredArtifact,
  content: Uint8Array,
  origin: ArtifactRevisionOrigin,
): StoredRevision {
  const hash = hashBuffer(content);
  const existing = artifact.revisions.find((revision) => revision.id === hash);
  if (existing) return existing;
  // Keep a safe source extension on immutable revisions. Preview adapters use
  // the path extension to select image/PDF/markdown renderers; storing every
  // revision as `.bin` made otherwise valid binary artifacts unpreviewable.
  const sourceExtension = extname(artifact.sourcePath);
  const extension = /^\.[a-z0-9]{1,12}$/i.test(sourceExtension)
    ? sourceExtension.toLowerCase()
    : artifact.kind === 'pdf'
      ? '.pdf'
      : artifact.kind === 'image'
        ? artifact.mimeType === 'image/svg+xml' ? '.svg' : '.png'
        : artifact.mimeType.includes('json')
          ? '.json'
          : artifact.kind === 'html'
            ? '.html'
            : artifact.kind === 'text'
              ? '.txt'
              : '.bin';
  const relativePath = join(REVISION_DIR, artifact.id, `${hash}${extension}`);
  atomicWriteBuffer(join(scope.workspaceRootPath, relativePath), content);
  const revision: StoredRevision = {
    id: hash,
    contentHash: hash,
    size: content.byteLength,
    createdAt: Date.now(),
    origin,
    relativePath,
  };
  artifact.revisions.push(revision);
  return revision;
}

function findArtifact(store: ArtifactStoreFile, artifactId: string): StoredArtifact {
  const artifact = store.artifacts.find((candidate) => candidate.id === artifactId);
  if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
  return artifact;
}

function assertSession(artifact: StoredArtifact, sessionId?: string): void {
  if (sessionId && artifact.sessionId !== sessionId) {
    throw new Error(`Artifact ${artifact.id} does not belong to session ${sessionId}`);
  }
}

function effectiveLease(artifact: StoredArtifact, now = Date.now()): ArtifactLease | undefined {
  if (!artifact.lease || artifact.lease.expiresAt <= now) return undefined;
  return artifact.lease;
}

function assertLease(artifact: StoredArtifact, leaseId?: string): void {
  const lease = effectiveLease(artifact);
  if (!lease) {
    artifact.lease = undefined;
    return;
  }
  if (lease.id !== leaseId) {
    throw new Error(`Artifact ${artifact.id} is being edited by ${lease.owner}`);
  }
}

function validateContent(kind: ArtifactKind, mimeType: string, revision: string, content: Uint8Array): ArtifactValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isTextual = kind === 'text' || kind === 'data' || kind === 'html' || mimeType.includes('json') || mimeType.startsWith('text/');
  let text: string | undefined;
  if (isTextual) {
    text = Buffer.from(content).toString('utf8');
    if (text.includes('\u0000')) errors.push('Text content contains NUL bytes.');
    if (mimeType.includes('json')) {
      try { JSON.parse(text); } catch (error) {
        errors.push(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (kind === 'pdf' && !Buffer.from(content.subarray(0, 5)).equals(Buffer.from('%PDF-'))) {
    errors.push('PDF content is missing the %PDF- signature.');
  }
  if (kind === 'image') {
    const header = Buffer.from(content.subarray(0, 16));
    const imageSignature =
      header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      || header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      || header.subarray(0, 6).toString('ascii') === 'GIF87a'
      || header.subarray(0, 6).toString('ascii') === 'GIF89a'
      || (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP')
      || (mimeType === 'image/svg+xml' && Buffer.from(content).toString('utf8').includes('<svg'));
    if (!imageSignature) errors.push('Image content does not match a supported image signature.');
  }
  if (mimeType.includes('openxmlformats-officedocument')) {
    const buffer = Buffer.from(content);
    const hasZipSignature = buffer.length >= 4
      && buffer[0] === 0x50
      && buffer[1] === 0x4b
      && ((buffer[2] === 0x03 && buffer[3] === 0x04) || (buffer[2] === 0x05 && buffer[3] === 0x06));
    if (!hasZipSignature) {
      errors.push('Office document is not a valid ZIP/Open XML package.');
    } else {
      // ZIP central-directory entry names are stored verbatim even when entry
      // bodies are compressed, so required package parts can be checked without
      // extracting untrusted archives in the shared validation layer.
      const packageIndex = buffer.toString('latin1');
      const requiredPart = kind === 'spreadsheet'
        ? 'xl/workbook.xml'
        : kind === 'document'
          ? 'word/document.xml'
          : kind === 'presentation'
            ? 'ppt/presentation.xml'
            : null;
      if (!packageIndex.includes('[Content_Types].xml')) {
        errors.push('Office package is missing [Content_Types].xml.');
      }
      if (requiredPart && !packageIndex.includes(requiredPart)) {
        errors.push(`Office package is missing ${requiredPart}.`);
      }
    }
  }
  if (content.byteLength === 0) warnings.push('Artifact content is empty.');
  return {
    revision,
    valid: errors.length === 0,
    checkedAt: Date.now(),
    errors,
    warnings,
    summary: errors.length > 0
      ? `${errors.length} validation error${errors.length === 1 ? '' : 's'}`
      : warnings.length > 0
        ? `Valid with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
        : 'Validation passed',
  };
}

function syncCheckoutRevision(
  scope: ArtifactStorageScope,
  artifact: StoredArtifact,
  origin: ArtifactRevisionOrigin = 'external-edit',
): StoredRevision {
  if (!artifact.checkoutRelativePath) throw new Error(`Artifact ${artifact.id} has no editable checkout`);
  const checkoutPath = join(scope.workspaceRootPath, artifact.checkoutRelativePath);
  if (!existsSync(checkoutPath) || statSync(checkoutPath).isDirectory()) {
    throw new Error(`Artifact checkout is missing: ${artifact.id}`);
  }
  const revision = storeRevision(scope, artifact, readFileSync(checkoutPath), origin);
  if (artifact.draftRevision !== revision.id) {
    artifact.draftRevision = revision.id;
    artifact.previews = [previewFor(artifact.kind, artifact.mimeType, revision.id)];
    artifact.validation = undefined;
    artifact.updatedAt = Date.now();
  }
  return revision;
}

export function listArtifacts(scope: Pick<ArtifactStorageScope, 'workspaceRootPath'>, filter: ArtifactListFilter = {}): ResolvedArtifact[] {
  const statuses = filter.statuses?.length ? new Set(filter.statuses) : undefined;
  return readStore(scope.workspaceRootPath).artifacts
    .filter((artifact) => !filter.sessionId || artifact.sessionId === filter.sessionId)
    .filter((artifact) => !statuses || statuses.has(artifact.status))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((artifact) => resolvedArtifact(scope, artifact));
}

export function getArtifact(scope: Pick<ArtifactStorageScope, 'workspaceRootPath'>, artifactId: string): ResolvedArtifact {
  return resolvedArtifact(scope, findArtifact(readStore(scope.workspaceRootPath), artifactId));
}

export function registerCurrentArtifact(
  scope: ArtifactStorageScope,
  input: RegisterCurrentArtifactInput,
): ResolvedArtifact {
  const sourcePath = resolveContentPath(scope, input.sourcePath, 'sourcePath');
  if (!existsSync(sourcePath) || statSync(sourcePath).isDirectory()) {
    throw new Error(`Artifact preview source is not a file: ${sourcePath}`);
  }
  const content = readFileSync(sourcePath);
  const kind = input.kind ?? inferArtifactKind(sourcePath);
  const mimeType = mimeTypeFor(kind, sourcePath, input.mimeType);
  const store = readStore(scope.workspaceRootPath);
  let artifact = [...store.artifacts].reverse().find((candidate) => (
    candidate.sessionId === input.sessionId
    && candidate.sourcePath === sourcePath
    && candidate.status === 'current'
  ));
  const now = Date.now();

  if (!artifact) {
    artifact = {
      id: randomUUID(),
      workspaceId: scope.workspaceId,
      sessionId: input.sessionId.trim(),
      title: optionalText(input.title) ?? basename(sourcePath),
      kind,
      engineId: 'native-preview',
      sourcePath,
      mimeType,
      baseRevision: null,
      currentRevision: null,
      draftRevision: null,
      status: 'current',
      capabilities: capabilitiesFor(kind, 'native-preview'),
      previews: [],
      deliverables: [],
      revisions: [],
      checkoutRelativePath: null,
      createdAt: now,
      updatedAt: now,
    };
    if (!artifact.sessionId) throw new Error('Artifact sessionId must not be empty');
    store.artifacts.push(artifact);
  }

  const revision = storeRevision(scope, artifact, content, 'external-edit');
  artifact.title = optionalText(input.title) ?? artifact.title;
  artifact.kind = kind;
  artifact.mimeType = mimeType;
  artifact.baseRevision = revision.id;
  artifact.currentRevision = revision.id;
  artifact.previews = [previewFor(kind, mimeType, revision.id)];
  artifact.deliverables = [{
    id: `source:${revision.id}`,
    revision: revision.id,
    path: sourcePath,
    mimeType,
  }];
  artifact.validation = undefined;
  artifact.updatedAt = now;
  saveStore(scope.workspaceRootPath, store);
  return resolvedArtifact(scope, artifact);
}

export function putArtifactTextPreview(
  scope: Pick<ArtifactStorageScope, 'workspaceRootPath'>,
  artifactId: string,
  input: {
    revision: string;
    text: string;
    kind?: 'markdown' | 'html' | 'text';
    mimeType?: string;
  },
): ResolvedArtifact {
  const store = readStore(scope.workspaceRootPath);
  const artifact = findArtifact(store, artifactId);
  const revision = activeRevision(artifact);
  if (!revision || revision.id !== input.revision) {
    throw new Error(`Artifact preview revision conflict: expected active ${revision?.id ?? 'none'}, received ${input.revision}`);
  }
  const kind = input.kind ?? 'markdown';
  const extension = kind === 'html' ? '.html' : kind === 'markdown' ? '.md' : '.txt';
  const mimeType = input.mimeType ?? (kind === 'html' ? 'text/html' : kind === 'markdown' ? 'text/markdown' : 'text/plain');
  const relativePath = join(PREVIEW_DIR, artifact.id, `${input.revision}${extension}`);
  atomicWriteBuffer(join(scope.workspaceRootPath, relativePath), Buffer.from(input.text, 'utf8'));
  const preview: StoredPreview = {
    id: `render:${kind}:${input.revision}`,
    revision: input.revision,
    kind,
    mimeType,
    relativePath,
  };
  artifact.previews = [
    ...artifact.previews.filter((candidate) => candidate.id !== preview.id),
    preview,
  ];
  artifact.updatedAt = Date.now();
  saveStore(scope.workspaceRootPath, store);
  return resolvedArtifact(scope, artifact);
}

export function createArtifactDraft(scope: ArtifactStorageScope, input: CreateArtifactDraftInput): ResolvedArtifact {
  const sourcePath = resolveContentPath(scope, input.sourcePath, 'sourcePath');
  const initialSources = [input.initialPath !== undefined, input.initialText !== undefined, input.initialBase64 !== undefined]
    .filter(Boolean).length;
  if (initialSources > 1) throw new Error('Artifact draft accepts only one initial content source');
  const sourceContent = existsSync(sourcePath) ? readFileSync(sourcePath) : null;
  const content = input.initialPath
    ? readFileSync(resolveContentPath(scope, input.initialPath, 'initialPath'))
    : input.initialText !== undefined
      ? Buffer.from(input.initialText, 'utf8')
      : input.initialBase64 !== undefined
        ? Buffer.from(input.initialBase64, 'base64')
        : sourceContent
          ? sourceContent
          : Buffer.alloc(0);
  const baseRevision = sourceContent ? hashBuffer(sourceContent) : null;
  const now = Date.now();
  const id = randomUUID();
  const engineId = optionalText(input.engineId) ?? 'native-file';
  const checkoutRelativePath = join(CHECKOUT_DIR, id, basename(sourcePath) || 'artifact.bin');
  const artifact: StoredArtifact = {
    id,
    workspaceId: scope.workspaceId,
    sessionId: input.sessionId.trim(),
    turnId: optionalText(input.turnId),
    title: optionalText(input.title) ?? (basename(sourcePath) || 'Untitled artifact'),
    kind: input.kind,
    engineId,
    sourcePath,
    mimeType: mimeTypeFor(input.kind, sourcePath, input.mimeType),
    baseRevision,
    currentRevision: null,
    draftRevision: null,
    status: 'draft',
    capabilities: capabilitiesFor(input.kind, engineId),
    previews: [],
    deliverables: [],
    revisions: [],
    checkoutRelativePath,
    createdAt: now,
    updatedAt: now,
  };
  if (!artifact.sessionId) throw new Error('Artifact sessionId must not be empty');
  atomicWriteBuffer(join(scope.workspaceRootPath, checkoutRelativePath), content);
  if (sourceContent) {
    artifact.currentRevision = storeRevision(scope, artifact, sourceContent, 'create').id;
  }
  const revision = storeRevision(scope, artifact, content, 'create');
  artifact.draftRevision = revision.id;
  artifact.previews = [previewFor(artifact.kind, artifact.mimeType, revision.id)];
  const store = readStore(scope.workspaceRootPath);
  store.artifacts.push(artifact);
  saveStore(scope.workspaceRootPath, store);
  return resolvedArtifact(scope, artifact);
}

export function applyArtifactDraft(
  scope: ArtifactStorageScope,
  artifactId: string,
  input: ApplyArtifactDraftInput,
  sessionId?: string,
): ResolvedArtifact {
  const store = readStore(scope.workspaceRootPath);
  const artifact = findArtifact(store, artifactId);
  assertSession(artifact, sessionId);
  if (artifact.status !== 'draft') throw new Error(`Artifact ${artifactId} must be draft before editing`);
  assertLease(artifact, input.leaseId);
  syncCheckoutRevision(scope, artifact);
  if (artifact.draftRevision !== input.expectedRevision) {
    throw new Error(`Artifact revision conflict: expected ${input.expectedRevision}, found ${artifact.draftRevision}`);
  }
  if (!artifact.capabilities.edit) throw new Error(`Artifact kind ${artifact.kind} is not text-editable`);
  const checkoutPath = join(scope.workspaceRootPath, artifact.checkoutRelativePath!);
  const previous = readFileSync(checkoutPath, 'utf8');
  let next: string;
  switch (input.operation.type) {
    case 'set_text':
      next = input.operation.text;
      break;
    case 'set_json':
      next = `${JSON.stringify(input.operation.value, null, 2)}\n`;
      break;
    case 'replace_text': {
      if (!input.operation.search) throw new Error('replace_text search must not be empty');
      if (!previous.includes(input.operation.search)) throw new Error('replace_text search was not found');
      next = input.operation.replaceAll
        ? previous.split(input.operation.search).join(input.operation.replacement)
        : previous.replace(input.operation.search, input.operation.replacement);
      break;
    }
  }
  atomicWriteBuffer(checkoutPath, Buffer.from(next, 'utf8'));
  const revision = storeRevision(scope, artifact, Buffer.from(next, 'utf8'), 'apply');
  artifact.draftRevision = revision.id;
  artifact.previews = [previewFor(artifact.kind, artifact.mimeType, revision.id)];
  artifact.validation = undefined;
  artifact.updatedAt = Date.now();
  saveStore(scope.workspaceRootPath, store);
  return resolvedArtifact(scope, artifact);
}

export function inspectArtifact(
  scope: ArtifactStorageScope,
  artifactId: string,
  options: { sessionId?: string; leaseId?: string } = {},
): ResolvedArtifact {
  const store = readStore(scope.workspaceRootPath);
  const artifact = findArtifact(store, artifactId);
  assertSession(artifact, options.sessionId);
  if (artifact.status === 'draft') {
    assertLease(artifact, options.leaseId);
    syncCheckoutRevision(scope, artifact);
  }
  const revision = activeRevision(artifact);
  if (!revision) throw new Error(`Artifact ${artifactId} has no inspectable revision`);
  const content = readFileSync(join(scope.workspaceRootPath, revision.relativePath));
  artifact.validation = validateContent(artifact.kind, artifact.mimeType, revision.id, content);
  artifact.updatedAt = Date.now();
  saveStore(scope.workspaceRootPath, store);
  return resolvedArtifact(scope, artifact);
}

export function submitArtifact(
  scope: ArtifactStorageScope,
  artifactId: string,
  options: { expectedRevision?: string; sessionId?: string; leaseId?: string } = {},
): ResolvedArtifact {
  const store = readStore(scope.workspaceRootPath);
  const artifact = findArtifact(store, artifactId);
  assertSession(artifact, options.sessionId);
  if (artifact.status !== 'draft') throw new Error(`Artifact ${artifactId} must be draft before submit`);
  assertLease(artifact, options.leaseId);
  const revision = syncCheckoutRevision(scope, artifact);
  if (options.expectedRevision && revision.id !== options.expectedRevision) {
    throw new Error(`Artifact revision conflict: expected ${options.expectedRevision}, found ${revision.id}`);
  }
  artifact.validation = validateContent(
    artifact.kind,
    artifact.mimeType,
    revision.id,
    readFileSync(join(scope.workspaceRootPath, revision.relativePath)),
  );
  if (!artifact.validation.valid) {
    saveStore(scope.workspaceRootPath, store);
    throw new Error(`Artifact validation failed: ${artifact.validation.errors.join(' ')}`);
  }
  artifact.status = 'ready';
  artifact.lease = undefined;
  artifact.updatedAt = Date.now();
  saveStore(scope.workspaceRootPath, store);
  return resolvedArtifact(scope, artifact);
}

export function reviseArtifact(
  scope: ArtifactStorageScope,
  artifactId: string,
  sessionId?: string,
): ResolvedArtifact {
  const store = readStore(scope.workspaceRootPath);
  const artifact = findArtifact(store, artifactId);
  assertSession(artifact, sessionId);
  if (artifact.status !== 'ready') throw new Error(`Artifact ${artifactId} must be ready before revise`);
  artifact.status = 'draft';
  artifact.updatedAt = Date.now();
  saveStore(scope.workspaceRootPath, store);
  return resolvedArtifact(scope, artifact);
}

export function acceptArtifact(
  scope: ArtifactStorageScope,
  artifactId: string,
  sessionId?: string,
): AcceptArtifactResult {
  const store = readStore(scope.workspaceRootPath);
  const artifact = findArtifact(store, artifactId);
  assertSession(artifact, sessionId);
  if (artifact.status !== 'ready') throw new Error(`Artifact ${artifactId} must be ready before accept`);
  const actualRevision = fileHash(artifact.sourcePath);
  if (actualRevision !== artifact.baseRevision) {
    artifact.status = 'conflict';
    artifact.updatedAt = Date.now();
    artifact.lease = undefined;
    saveStore(scope.workspaceRootPath, store);
    return {
      artifact: resolvedArtifact(scope, artifact),
      accepted: false,
      conflict: { expectedBaseRevision: artifact.baseRevision, actualRevision },
    };
  }
  const revision = activeRevision(artifact);
  if (!revision || revision.id !== artifact.draftRevision) throw new Error(`Artifact ${artifactId} draft revision is missing`);
  const content = readFileSync(join(scope.workspaceRootPath, revision.relativePath));
  atomicWriteBuffer(artifact.sourcePath, content);
  const acceptedAt = Date.now();
  artifact.status = 'accepted';
  artifact.currentRevision = revision.id;
  artifact.baseRevision = revision.id;
  artifact.acceptedAt = acceptedAt;
  artifact.updatedAt = acceptedAt;
  artifact.lease = undefined;
  artifact.deliverables = [{
    id: `source:${revision.id}`,
    revision: revision.id,
    path: artifact.sourcePath,
    mimeType: artifact.mimeType,
  }];
  saveStore(scope.workspaceRootPath, store);
  return { artifact: resolvedArtifact(scope, artifact), accepted: true };
}

export function discardArtifact(
  scope: ArtifactStorageScope,
  artifactId: string,
  sessionId?: string,
): ResolvedArtifact {
  const store = readStore(scope.workspaceRootPath);
  const artifact = findArtifact(store, artifactId);
  assertSession(artifact, sessionId);
  if (!['draft', 'ready', 'conflict'].includes(artifact.status)) {
    throw new Error(`Artifact ${artifactId} cannot be discarded from ${artifact.status}`);
  }
  artifact.status = 'discarded';
  artifact.discardedAt = Date.now();
  artifact.updatedAt = artifact.discardedAt;
  artifact.lease = undefined;
  saveStore(scope.workspaceRootPath, store);
  return resolvedArtifact(scope, artifact);
}

export function acquireArtifactLease(
  scope: Pick<ArtifactStorageScope, 'workspaceRootPath'>,
  artifactId: string,
  owner: ArtifactLease['owner'],
  durationMs = DEFAULT_LEASE_MS,
  sessionId?: string,
): ResolvedArtifact {
  const store = readStore(scope.workspaceRootPath);
  const artifact = findArtifact(store, artifactId);
  assertSession(artifact, sessionId);
  if (artifact.status !== 'draft') throw new Error(`Artifact ${artifactId} must be draft before editing`);
  const current = effectiveLease(artifact);
  if (current) throw new Error(`Artifact ${artifactId} is already leased by ${current.owner}`);
  const now = Date.now();
  artifact.lease = {
    id: randomUUID(),
    owner,
    acquiredAt: now,
    expiresAt: now + Math.min(MAX_LEASE_MS, Math.max(1_000, Math.round(durationMs))),
  };
  artifact.updatedAt = now;
  saveStore(scope.workspaceRootPath, store);
  return resolvedArtifact(scope, artifact);
}

export function releaseArtifactLease(
  scope: Pick<ArtifactStorageScope, 'workspaceRootPath'>,
  artifactId: string,
  leaseId: string,
  sessionId?: string,
): ResolvedArtifact {
  const store = readStore(scope.workspaceRootPath);
  const artifact = findArtifact(store, artifactId);
  assertSession(artifact, sessionId);
  const lease = effectiveLease(artifact);
  if (lease && lease.id !== leaseId) throw new Error(`Artifact ${artifactId} lease token does not match`);
  artifact.lease = undefined;
  artifact.updatedAt = Date.now();
  saveStore(scope.workspaceRootPath, store);
  return resolvedArtifact(scope, artifact);
}
