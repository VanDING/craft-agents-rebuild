/**
 * Workspace backup, verification, and restore.
 *
 * Backups are directory trees with a deterministic manifest (SHA-256 per file)
 * so users can verify integrity before restoring. `runtime/runtime.db` is
 * copied through SQLite's VACUUM INTO path when possible, not by copying live
 * WAL pages.
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  lstatSync,
  realpathSync,
  renameSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { DurableRuntimeStore } from '../durable-runtime/store.js';

const MANIFEST_NAME = 'manifest.json';
const MANIFEST_VERSION = 1;

export interface WorkspaceBackupFile {
  path: string;
  size: number;
  sha256: string;
}

export interface WorkspaceBackupManifest {
  manifestVersion: number;
  createdAt: string;
  workspaceRootPath: string;
  fileCount: number;
  totalBytes: number;
  files: WorkspaceBackupFile[];
}

export type WorkspaceBackupVerification =
  | { ok: true; manifest: WorkspaceBackupManifest; issues: [] }
  | { ok: false; manifest: WorkspaceBackupManifest | null; issues: string[] };

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function ensureEmptyDirectory(path: string): void {
  if (existsSync(path)) {
    const entries = readdirSync(path);
    if (entries.length > 0) {
      throw new Error(`Backup destination is not empty: ${path}`);
    }
  } else {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
}

function walkFiles(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
    else throw new Error(`Unsupported workspace entry: ${full}`);
  }
  return out;
}

function canonicalPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  if (parent === path) throw new Error(`Cannot resolve ${path}`);
  return join(canonicalPath(parent), basename(path));
}

function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'));
}

function assertSeparateDirectories(a: string, b: string): void {
  if (contains(a, b) || contains(b, a)) throw new Error('Source and destination directories must not overlap');
}

function safeBackupFile(root: string, path: string): string {
  if (typeof path !== 'string' || !path || /[\\:\x00]/.test(path)
      || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid backup path: ${String(path)}`);
  }
  let file = root;
  for (const part of path.split('/')) {
    file = join(file, part);
    if (lstatSync(file).isSymbolicLink()) throw new Error(`Symlink in backup: ${path}`);
  }
  if (!statSync(file).isFile()) throw new Error(`Not a regular file: ${path}`);
  return file;
}

function copyFilePreservingMode(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  try {
    chmodSync(target, statSync(source).mode & 0o777);
  } catch {
    // Best effort; Windows ACLs do not map to POSIX modes.
  }
}

function prepareRuntimeDatabaseCopy(workspaceRootPath: string, tempDir: string): string | null {
  const databasePath = join(workspaceRootPath, 'runtime', 'runtime.db');
  if (!existsSync(databasePath)) return null;

  const tempDatabase = join(tempDir, `runtime-${process.pid}-${randomBytes(4).toString('hex')}.db`);
  const store = new DurableRuntimeStore(workspaceRootPath);
  try {
    store.backupTo(tempDatabase);
  } finally {
    store.close();
  }
  return tempDatabase;
}

export function createWorkspaceBackup(workspaceRootPath: string, outputPath: string): WorkspaceBackupManifest {
  const root = canonicalPath(resolve(workspaceRootPath));
  const output = canonicalPath(resolve(outputPath));
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Workspace directory not found: ${root}`);
  }
  assertSeparateDirectories(root, output);
  ensureEmptyDirectory(output);

  const tempDir = join(tmpdir(), `craft-workspace-backup-${process.pid}-${randomBytes(4).toString('hex')}`);
  mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  try {
    const runtimeCopy = prepareRuntimeDatabaseCopy(root, tempDir);
    const files: WorkspaceBackupFile[] = [];
    let totalBytes = 0;

    for (const source of walkFiles(root)) {
      const relativePath = relative(root, source).replaceAll('\\', '/');
      if (/^runtime\/runtime\.db(?:-wal|-shm)?$/.test(relativePath)) continue;
      if (relativePath === MANIFEST_NAME) throw new Error('Workspace contains reserved manifest.json');
      const target = join(output, relativePath);
      copyFilePreservingMode(source, target);
      const size = statSync(target).size;
      files.push({ path: relativePath, size, sha256: sha256File(target) });
      totalBytes += size;
    }

    if (runtimeCopy) {
      const relativePath = 'runtime/runtime.db';
      const target = join(output, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(runtimeCopy, target);
      const size = statSync(runtimeCopy).size;
      files.push({ path: relativePath, size, sha256: sha256File(runtimeCopy) });
      totalBytes += size;
    }

    files.sort((a, b) => a.path.localeCompare(b.path));
    const manifest: WorkspaceBackupManifest = {
      manifestVersion: MANIFEST_VERSION,
      createdAt: new Date().toISOString(),
      workspaceRootPath: root,
      fileCount: files.length,
      totalBytes,
      files,
    };
    writeFileSync(join(output, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    return manifest;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function verifyWorkspaceBackup(backupPath: string): WorkspaceBackupVerification {
  const root = resolve(backupPath);
  const manifestPath = join(root, MANIFEST_NAME);
  if (!existsSync(manifestPath)) {
    return { ok: false, manifest: null, issues: [`Missing ${MANIFEST_NAME}`] };
  }

  let manifest: WorkspaceBackupManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WorkspaceBackupManifest;
  } catch (error) {
    return { ok: false, manifest: null, issues: [`Unparseable ${MANIFEST_NAME}: ${String(error)}`] };
  }

  if (!manifest || manifest.manifestVersion !== MANIFEST_VERSION || !Array.isArray(manifest.files)
      || !Number.isSafeInteger(manifest.fileCount) || manifest.fileCount !== manifest.files.length
      || !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0) {
    return { ok: false, manifest: null, issues: ['Invalid backup manifest schema'] };
  }

  const issues: string[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of manifest.files) {
    try {
      if (!file || typeof file.path !== 'string' || !Number.isSafeInteger(file.size) || file.size < 0
          || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid file entry');
      const key = file.path.toLowerCase();
      if (seen.has(key) || key === MANIFEST_NAME || /^runtime\/runtime\.db-(wal|shm)$/.test(key)) {
        throw new Error(`Duplicate or reserved path: ${file.path}`);
      }
      seen.add(key);
      totalBytes += file.size;
      const filePath = safeBackupFile(root, file.path);
      if (statSync(filePath).size !== file.size) throw new Error(`Size mismatch: ${file.path}`);
      if (sha256File(filePath) !== file.sha256) throw new Error(`Checksum mismatch: ${file.path}`);
    } catch (error) { issues.push(String(error)); }
  }
  if (totalBytes !== manifest.totalBytes) issues.push('Manifest totalBytes mismatch');

  return issues.length === 0 ? { ok: true, manifest, issues: [] } : { ok: false, manifest, issues };
}

export function restoreWorkspaceBackup(
  backupPath: string,
  targetPath: string,
  options: { force?: boolean } = {},
): WorkspaceBackupManifest {
  const verification = verifyWorkspaceBackup(backupPath);
  if (!verification.ok) {
    throw new Error(`Backup verification failed:\n${verification.issues.join('\n')}`);
  }

  const root = canonicalPath(resolve(backupPath));
  const requestedTarget = resolve(targetPath);
  if (existsSync(requestedTarget) && lstatSync(requestedTarget).isSymbolicLink()) throw new Error('Restore target must not be a symlink');
  const target = canonicalPath(requestedTarget);
  assertSeparateDirectories(root, target);
  if (existsSync(target) && readdirSync(target).length > 0 && !options.force) {
    throw new Error(`Restore target is not empty: ${target}. Pass --force to replace it.`);
  }
  mkdirSync(dirname(target), { recursive: true });
  const staging = mkdtempSync(join(dirname(target), '.craft-restore-'));
  let safety: string | undefined;
  try {
    for (const file of verification.manifest.files) {
      const destination = join(staging, file.path);
      copyFilePreservingMode(safeBackupFile(root, file.path), destination);
      if (statSync(destination).size !== file.size || sha256File(destination) !== file.sha256) {
        throw new Error(`Backup changed during restore: ${file.path}`);
      }
    }
    // Replace the entire offline workspace, never overlay old WAL or stale files.
    if (existsSync(target)) {
      safety = `${target}.pre-restore-${Date.now()}-${randomBytes(4).toString('hex')}`;
      renameSync(target, safety);
    }
    try { renameSync(staging, target); }
    catch (error) {
      if (safety) renameSync(safety, target);
      throw error;
    }
    return verification.manifest;
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
