import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DurableRuntimeStore } from '../durable-runtime/store';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWorkspaceBackup,
  restoreWorkspaceBackup,
  verifyWorkspaceBackup,
} from './workspace-backup.ts';

function withTempDir<T>(prefix: string, fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('workspace backup', () => {
  it('creates a verifiable backup and restores it to a new directory', () => {
    withTempDir('craft-backup-src-', (base) => {
      const workspace = join(base, 'workspace');
      const backup = join(base, 'backup');
      const restored = join(base, 'restored');
      mkdirSync(join(workspace, 'sessions', 's1'), { recursive: true });
      writeFileSync(join(workspace, 'sessions', 's1', 'session.jsonl'), '{"id":"s1"}\n');
      writeFileSync(join(workspace, 'work-items.json'), '{"items":[]}');

      const manifest = createWorkspaceBackup(workspace, backup);
      expect(manifest.fileCount).toBe(2);
      expect(verifyWorkspaceBackup(backup)).toMatchObject({ ok: true });

      const restoredManifest = restoreWorkspaceBackup(backup, restored);
      expect(restoredManifest.fileCount).toBe(2);
      expect(readFileSync(join(restored, 'sessions', 's1', 'session.jsonl'), 'utf8')).toBe('{"id":"s1"}\n');
      expect(readFileSync(join(restored, 'work-items.json'), 'utf8')).toBe('{"items":[]}');
    });
  });

  it('fails verification when a backed-up file is modified', () => {
    withTempDir('craft-backup-corrupt-', (base) => {
      const workspace = join(base, 'workspace');
      const backup = join(base, 'backup');
      mkdirSync(workspace, { recursive: true });
      writeFileSync(join(workspace, 'data.json'), '{"ok":true}');

      createWorkspaceBackup(workspace, backup);
      writeFileSync(join(backup, 'data.json'), '{"ok":false}');

      const result = verifyWorkspaceBackup(backup);
      expect(result.ok).toBe(false);
      expect(result.issues.join('\n')).toMatch(/mismatch/i);
      expect(existsSync(join(backup, 'manifest.json'))).toBe(true);
    });
  });
});


describe('workspace backup recovery boundaries', () => {
  it('backs up a live SQLite store once without WAL and restores over stale files', () => {
    withTempDir('craft-backup-db-', base => {
      const workspace = join(base, 'workspace'), backup = join(base, 'backup'), target = join(base, 'target');
      const store = new DurableRuntimeStore(workspace);
      try {
        const manifest = createWorkspaceBackup(workspace, backup);
        expect(manifest.files.map(f => f.path)).toEqual(['runtime/runtime.db']);
        expect(verifyWorkspaceBackup(backup).ok).toBe(true);
        mkdirSync(join(target, 'runtime'), { recursive: true });
        writeFileSync(join(target, 'runtime/runtime.db-wal'), 'stale');
        writeFileSync(join(target, 'old.txt'), 'preserve in safety copy');
        restoreWorkspaceBackup(backup, target, { force: true });
        expect(existsSync(join(target, 'runtime/runtime.db-wal'))).toBe(false);
        expect(existsSync(join(target, 'old.txt'))).toBe(false);
        const safety = readdirSync(base).find(name => name.startsWith('target.pre-restore-'))!;
        expect(readFileSync(join(base, safety, 'old.txt'), 'utf8')).toBe('preserve in safety copy');
        const restored = new DurableRuntimeStore(target);
        try { expect(restored.checkIntegrity().ok).toBe(true); } finally { restored.close(); }
      } finally { store.close(); }
    });
  });

  it('rejects traversal, duplicate entries, malformed manifests and symlink sources before restore', () => {
    withTempDir('craft-backup-boundary-', base => {
      const backup = join(base, 'source', 'backup'), target = join(base, 'target');
      mkdirSync(backup, { recursive: true });
      mkdirSync(target);
      const content = 'fixture';
      writeFileSync(join(base, 'source', 'outside.txt'), content);
      writeFileSync(join(backup, 'safe.txt'), content);
      const entry = { path: 'safe.txt', size: content.length, sha256: createHash('sha256').update(content).digest('hex') };
      const manifests = [null, {}, { manifestVersion: 1, files: null },
        ...['../outside.txt', '/outside.txt', 'a/../../outside.txt', 'C:/outside.txt', 'a\\outside.txt'].map(path => ({ manifestVersion: 1, files: [{ ...entry, path }], fileCount: 1, totalBytes: content.length })),
        { manifestVersion: 1, files: [entry, entry], fileCount: 2, totalBytes: 2 * content.length },
      ];
      for (const manifest of manifests) {
        writeFileSync(join(backup, 'manifest.json'), JSON.stringify(manifest));
        expect(verifyWorkspaceBackup(backup).ok).toBe(false);
        expect(() => restoreWorkspaceBackup(backup, target)).toThrow();
        expect(readdirSync(target)).toEqual([]);
      }
      // Directory junctions work without Windows symlink privileges.
      symlinkSync(join(base, 'source'), join(backup, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      writeFileSync(join(backup, 'manifest.json'), JSON.stringify({ manifestVersion: 1, files: [{ ...entry, path: 'linked/outside.txt' }], fileCount: 1, totalBytes: content.length }));
      expect(verifyWorkspaceBackup(backup).ok).toBe(false);
    });
  });

  it('rejects nested backup destinations before creating them', () => {
    withTempDir('craft-backup-nested-', base => {
      const workspace = join(base, 'workspace'); mkdirSync(workspace);
      expect(() => createWorkspaceBackup(workspace, join(workspace, 'backup'))).toThrow();
      expect(existsSync(join(workspace, 'backup'))).toBe(false);
    });
  });
});
