import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFileSync } from '../files.ts';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'craft-atomic-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('atomicWriteFileSync', () => {
  it('writes new files and replaces existing content without a torn target', () => {
    withTempDir((dir) => {
      const file = join(dir, 'data.json');
      atomicWriteFileSync(file, '{"version":1}');
      expect(readFileSync(file, 'utf8')).toBe('{"version":1}');

      atomicWriteFileSync(file, '{"version":2}');
      expect(readFileSync(file, 'utf8')).toBe('{"version":2}');
    });
  });

  it('preserves the previous target when the rename fails and removes its temp file', () => {
    withTempDir((dir) => {
      const target = join(dir, 'target-dir');
      mkdirSync(target);
      writeFileSync(join(target, 'keep.txt'), 'keep');

      expect(() => atomicWriteFileSync(target, 'replacement')).toThrow();

      expect(readdirSync(target)).toEqual(['keep.txt']);
      expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('keep');
      expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false);
    });
  });
});
