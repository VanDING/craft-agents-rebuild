import { expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialManager } from './manager.ts';
import { SecureStorageBackend } from './backends/secure-storage.ts';

it('round-trips connection credentials and shares sync/async deletion through one encrypted store', async () => {
  const root = mkdtempSync(join(tmpdir(), 'craft-credential-manager-'));
  const file = join(root, 'credentials.enc');
  const manager = new CredentialManager();
  // Keep test credentials away from the user's store without adding a runtime backend registry.
  (manager as unknown as { backend: SecureStorageBackend }).backend = new SecureStorageBackend(file);
  try {
    await manager.setLlmApiKey('test-connection', 'test-secret');
    expect(await manager.getLlmApiKey('test-connection')).toBe('test-secret');
    expect(await manager.list({ type: 'llm_api_key' })).toEqual([{ type: 'llm_api_key', connectionSlug: 'test-connection' }]);
    expect(readFileSync(file).includes(Buffer.from('test-secret'))).toBe(false);
    const stored = new SecureStorageBackend(file);
    expect(await stored.get({ type: 'llm_api_key', connectionSlug: 'test-connection' })).toEqual({ value: 'test-secret' });
    expect(manager.deleteSync({ type: 'llm_api_key', connectionSlug: 'test-connection' })).toBe(true);
    expect(await manager.getLlmApiKey('test-connection')).toBeNull();
    await manager.setLlmApiKey('test-connection', 'replacement');
    expect(await manager.deleteLlmApiKey('test-connection')).toBe(true);
    expect(await manager.list()).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
