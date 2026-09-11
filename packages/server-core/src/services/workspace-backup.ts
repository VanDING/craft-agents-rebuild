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
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
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
  }
  return out;
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
  const root = resolve(workspaceRootPath);
  const output = resolve(outputPath);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Workspace directory not found: ${root}`);
  }
  if (output === root || root.startsWith(output + '/') || root.startsWith(output + '\\')) {
    throw new Error('Backup destination must be outside the workspace directory');
  }
  ensureEmptyDirectory(output);

  const tempDir = join(tmpdir(), `craft-workspace-backup-${process.pid}-${randomBytes(4).toString('hex')}`);
  mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  try {
    const runtimeCopy = prepareRuntimeDatabaseCopy(root, tempDir);
    const files: WorkspaceBackupFile[] = [];
    let totalBytes = 0;

    for (const source of walkFiles(root)) {
      const relativePath = relative(root, source).replaceAll('\\', '/');
      const target = join(output, relativePath);
      copyFilePreservingMode(source, target);
      const size = statSync(source).size;
      files.push({ path: relativePath, size, sha256: sha256File(source) });
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

  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    return { ok: false, manifest, issues: [`Unsupported manifest version ${String(manifest.manifestVersion)}`] };
  }

  const issues: string[] = [];
  for (const file of manifest.files) {
    const filePath = join(root, file.path);
    if (!existsSync(filePath)) {
      issues.push(`Missing file: ${file.path}`);
      continue;
    }
    const size = statSync(filePath).size;
    if (size !== file.size) {
      issues.push(`Size mismatch: ${file.path} (expected ${file.size}, got ${size})`);
      continue;
    }
    const sha256 = sha256File(filePath);
    if (sha256 !== file.sha256) issues.push(`Checksum mismatch: ${file.path}`);
  }

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

  const root = resolve(backupPath);
  const target = resolve(targetPath);
  if (existsSync(target)) {
    const entries = readdirSync(target);
    if (entries.length > 0 && !options.force) {
      throw new Error(`Restore target is not empty: ${target}. Pass --force to overwrite files.`);
    }
    if (entries.length > 0 && options.force) {
      const safety = join(dirname(target), `${basename(target)}.pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      copyDirectory(target, safety);
    }
  } else {
    mkdirSync(target, { recursive: true, mode: 0o700 });
  }

  for (const file of verification.manifest.files) {
    copyFilePreservingMode(join(root, file.path), join(target, file.path));
  }
  return verification.manifest;
}

function copyDirectory(source: string, target: string): void {
  for (const file of walkFiles(source)) {
    copyFilePreservingMode(file, join(target, relative(source, file)));
  }
}
