#!/usr/bin/env bun
/**
 * Post-packaging release artifact manifest.
 *
 * Writes SHA256SUMS and release-manifest.json next to the built installers so a
 * downloaded artifact can be verified before installation. This is deliberately
 * provider-neutral: signing/notarization and publishing remain release-workflow
 * steps, but the checksum manifest is generated from the actual bytes.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(import.meta.dir, '..');
const RELEASE_DIR = join(ROOT, 'apps', 'electron', 'release');
const OUTPUT_DIR = process.env.CRAFT_RELEASE_OUTPUT ?? RELEASE_DIR;

if (!existsSync(RELEASE_DIR)) {
  console.error(`Release directory not found: ${RELEASE_DIR}`);
  process.exit(1);
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'win-unpacked' || entry.name === 'mac' || entry.name === 'linux-unpacked') {
        out.push(...walk(full));
      } else {
        walk(full, out);
      }
    } else {
      out.push(full);
    }
  }
  return out;
}

const files = walk(RELEASE_DIR)
  .filter((file) => !['SHA256SUMS', 'release-manifest.json'].includes(relative(RELEASE_DIR, file)))
  .sort();

const entries = files.map((file) => {
  const stats = statSync(file);
  return {
    path: relative(RELEASE_DIR, file).replaceAll('\\', '/'),
    size: stats.size,
    sha256: sha256(file),
  };
});

let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {
  // Source archives without git metadata still produce a usable manifest.
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: string };
const manifest = {
  generatedAt: new Date().toISOString(),
  version: pkg.version ?? '0.0.0',
  commit,
  fileCount: entries.length,
  totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
  files: entries,
};

writeFileSync(join(OUTPUT_DIR, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(
  join(OUTPUT_DIR, 'SHA256SUMS'),
  entries.map((entry) => `${entry.sha256}  ${entry.path}`).join('\n') + '\n',
);
console.log(`Release manifest written: ${entries.length} files, ${manifest.totalBytes} bytes`);
