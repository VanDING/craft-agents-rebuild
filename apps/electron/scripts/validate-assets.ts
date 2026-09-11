#!/usr/bin/env bun
/**
 * Validate a staged Electron build before `electron:build` / electron-builder
 * consumes it. Catches the silent failure mode where copy steps are skipped
 * and the packaged app starts without the renderer, preload, Pi subprocess, or
 * bundled resources.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(import.meta.dir, '..', 'dist');

const required = [
  'main.cjs',
  'bootstrap-preload.cjs',
  'browser-toolbar-preload.cjs',
  'interceptor.cjs',
  'renderer/index.html',
  'resources/pi-agent-server/index.js',
  'resources/pi-agent-server/bundle.js',
  'resources/themes/default.json',
  'resources/docs',
];

const missing = required.filter((relative) => !existsSync(join(DIST, relative)));
if (missing.length > 0) {
  console.error('Electron build validation failed. Missing artifacts:');
  for (const item of missing) console.error(`  - dist/${item}`);
  console.error('\nRun `bun run electron:build` from the repository root and retry.');
  process.exit(1);
}

// A zero-byte artifact is just as broken as a missing one.
const empty = required.filter((relative) => {
  const path = join(DIST, relative);
  return existsSync(path) && statSync(path).isFile() && statSync(path).size === 0;
});
if (empty.length > 0) {
  console.error('Electron build validation failed. Empty artifacts:');
  for (const item of empty) console.error(`  - dist/${item}`);
  process.exit(1);
}

console.log(`Electron build validation OK (${required.length} artifacts)`);
