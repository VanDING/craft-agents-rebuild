#!/usr/bin/env bun
import { resolve } from 'node:path';

// Separate processes keep native and i18n module mocks local to each test file.
const files = [
  'packages/server-core/src/services/workspace-backup.test.ts',
  'packages/shared/src/credentials/backends/secure-storage-key-provider.isolated.ts',
  'packages/shared/src/config/__tests__/remote-token-vault.isolated.ts',
  'packages/shared/src/i18n/__tests__/startup-language.isolated.ts',
  'apps/electron/src/main/credential-key-provider.isolated.ts',
  'scripts/bundle-report.test.ts',
];
for (const file of files) {
  const child = Bun.spawnSync([process.execPath, 'test', './' + file], {
    cwd: resolve(import.meta.dir, '..'),
    stdout: 'inherit', stderr: 'inherit',
  });
  if (child.exitCode !== 0) process.exit(child.exitCode || 1);
}
