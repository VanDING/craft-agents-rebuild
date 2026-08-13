/**
 * Helpers for the Claude SDK subprocess spawn site.
 *
 * Extracted to its own module so the directory probe, ENOENT detection,
 * and SDK wrapper-string regex can be unit-tested without spinning up a
 * full ClaudeAgent.
 */

import { lstatSync } from 'node:fs';

/**
 * Returns true iff `p` is an existing directory.
 *
 * Uses `lstatSync` so a symlink pointing at a missing target returns false
 * — broken symlinks must count as "missing" because spawn() will fail on them
 * anyway. Wrapped in try/catch so EACCES/ENOTDIR/etc. fall through cleanly.
 */
export function isExistingDirectory(p: string | null | undefined): boolean {
  if (!p) return false;
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}


