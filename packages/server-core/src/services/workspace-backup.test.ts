import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
