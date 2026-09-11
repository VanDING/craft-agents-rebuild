#!/usr/bin/env bun
/**
 * Cross-platform workspace test runner.
 *
 * Replaces the previous POSIX `for`/`find` shell pipeline so `bun run test`
 * works identically on Windows, macOS, and Linux. Test execution stays
 * scoped per workspace, then `.isolated.ts` files run one process each to
 * avoid Bun module-mock leakage across files.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const TEST_SUFFIXES = ['.test.ts', '.test.tsx', '.test.js', '.test.jsx', '.spec.ts', '.spec.tsx', '.spec.js', '.spec.jsx'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'release', 'out', 'build', '.git', '.cache']);

interface Workspace {
  dir: string;
  label: string;
}

function listWorkspaces(): Workspace[] {
  const workspaces: Workspace[] = [];
  for (const parent of ['packages', 'apps']) {
    const parentPath = join(ROOT, parent);
    if (!existsSync(parentPath)) continue;
    for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(parentPath, entry.name);
      if (existsSync(join(dir, 'package.json'))) {
        workspaces.push({ dir, label: `${parent}/${entry.name}` });
      }
    }
  }
  return workspaces.sort((a, b) => a.label.localeCompare(b.label));
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(join(dir, entry.name), out);
    } else {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function firstTestFile(dir: string): string | null {
  for (const file of walkFiles(dir)) {
    if (TEST_SUFFIXES.some((suffix) => file.endsWith(suffix))) return file;
  }
  return null;
}

function runBunTest(cwd: string, args: string[]): number {
  const proc = Bun.spawnSync({
    cmd: ['bun', 'test', ...args],
    cwd,
    stdio: ['inherit', 'inherit', 'inherit'],
    env: process.env,
  });
  return proc.exitCode ?? 1;
}

const listOnly = process.argv.includes('--list');
const filterArg = process.argv.find((arg) => arg.startsWith('--filter='));
const filter = filterArg ? filterArg.slice('--filter='.length).toLowerCase() : null;
const allWorkspaces = listWorkspaces();
const workspaces = filter
  ? allWorkspaces.filter((workspace) => workspace.label.toLowerCase().includes(filter))
  : allWorkspaces;

if (filter && workspaces.length === 0) {
  console.error(`No workspace matches --filter=${filter}`);
  process.exit(1);
}
const failures: string[] = [];
let ran = 0;

for (const workspace of workspaces) {
  const testFile = firstTestFile(workspace.dir);
  if (!testFile) {
    console.log(`skip ${workspace.label} (no tests)`);
    continue;
  }
  const firstRelative = relative(ROOT, testFile).replaceAll('\\', '/');
  console.log(`\n=== ${workspace.label} (${firstRelative}) ===`);
  if (listOnly) {
    ran += 1;
    continue;
  }
  ran += 1;
  const code = runBunTest(workspace.dir, []);
  if (code !== 0) failures.push(workspace.label);
}

// Isolated files must not share a Bun process with anything else.
for (const workspace of workspaces) {
  const files = walkFiles(workspace.dir).filter((file) => file.endsWith('.isolated.ts'));
  for (const file of files) {
    const rel = relative(ROOT, file).replaceAll('\\', '/');
    console.log(`\n=== isolated: ${rel} ===`);
    if (listOnly) continue;
    const code = runBunTest(ROOT, [`./${rel}`]);
    if (code !== 0) failures.push(`isolated ${rel}`);
  }
}

if (listOnly) {
  console.log(`\n${ran} workspace(s) with tests, isolated discovery complete`);
  process.exit(0);
}

if (failures.length > 0) {
  console.error(`\nTest failures: ${failures.join(', ')}`);
  process.exit(1);
}

console.log('\nAll workspace tests passed');
