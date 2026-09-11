#!/usr/bin/env bun
/**
 * Offline workspace backup CLI.
 *
 * Usage:
 *   bun run scripts/workspace-backup.ts create --workspace <dir> --output <new-dir>
 *   bun run scripts/workspace-backup.ts verify --backup <dir>
 *   bun run scripts/workspace-backup.ts restore --backup <dir> --workspace <dir> [--force]
 *
 * Stop the desktop app/server before backing up or restoring a workspace.
 */
import {
  createWorkspaceBackup,
  verifyWorkspaceBackup,
  restoreWorkspaceBackup,
} from '@craft-agent/server-core/services';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const withEquals = process.argv.find((value) => value.startsWith(prefix));
  if (withEquals) return withEquals.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArg(name: string): string {
  const value = arg(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

const command = process.argv[2];
try {
  if (command === 'create') {
    const manifest = createWorkspaceBackup(requireArg('workspace'), requireArg('output'));
    console.log(`Backup created: ${manifest.fileCount} files, ${manifest.totalBytes} bytes`);
  } else if (command === 'verify') {
    const result = verifyWorkspaceBackup(requireArg('backup'));
    if (result.ok) {
      console.log(`Backup OK: ${result.manifest.fileCount} files, ${result.manifest.totalBytes} bytes`);
    } else {
      console.error(`Backup verification failed:\n${result.issues.join('\n')}`);
      process.exit(1);
    }
  } else if (command === 'restore') {
    const manifest = restoreWorkspaceBackup(requireArg('backup'), requireArg('workspace'), {
      force: process.argv.includes('--force'),
    });
    console.log(`Backup restored: ${manifest.fileCount} files to ${requireArg('workspace')}`);
  } else {
    console.error('Usage: workspace-backup.ts <create|verify|restore> --workspace <dir> --output/--backup <dir> [--force]');
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
