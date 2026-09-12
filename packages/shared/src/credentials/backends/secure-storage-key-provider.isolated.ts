import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installCredentialKeyProviderFromEnv } from '../env-key-provider.ts';
import {
  SecureStorageBackend,
  getCredentialKeyProviderId,
  setCredentialKeyProvider,
} from './secure-storage.ts';

const id = { type: 'source_apikey' as const, workspaceId: 'ws', sourceId: 'svc' };

function providerFor(secret: string) {
  return {
    id: `test:${secret}`,
    getKey: () => new TextEncoder().encode(secret),
  };
}

afterEach(() => {
  setCredentialKeyProvider(null);
});

describe('SecureStorageBackend OS key provider', () => {
  it('round-trips credentials through the injected provider and reports its id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-secure-key-'));
    const file = join(dir, 'credentials.enc');
    try {
      setCredentialKeyProvider(providerFor('provider-key-a'));
      expect(getCredentialKeyProviderId()).toBe('test:provider-key-a');

      const writer = new SecureStorageBackend(file);
      await writer.set(id, { value: 'provider-secret' });

      const reader = new SecureStorageBackend(file);
      expect(await reader.get(id)).toEqual({ value: 'provider-secret' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates a machine-key store to the provider on the next load', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-secure-key-'));
    const file = join(dir, 'credentials.enc');
    try {
      // Legacy/fallback path: no provider configured.
      const legacy = new SecureStorageBackend(file);
      await legacy.set(id, { value: 'from-machine-key' });

      // First load with a provider decrypts via the stable machine key, then
      // re-saves through the provider key path.
      setCredentialKeyProvider(providerFor('provider-key-b'));
      const migrated = new SecureStorageBackend(file);
      expect(await migrated.get(id)).toEqual({ value: 'from-machine-key' });

      // A second load must succeed directly via the provider key.
      const providerOnly = new SecureStorageBackend(file);
      expect(await providerOnly.get(id)).toEqual({ value: 'from-machine-key' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('credential key provider from env', () => {
  it('accepts a hex key and rejects short material', () => {
    expect(
      installCredentialKeyProviderFromEnv({
        CRAFT_CREDENTIAL_KEY: 'ab'.repeat(32),
      } as NodeJS.ProcessEnv),
    ).toBe('env:CRAFT_CREDENTIAL_KEY');
    expect(getCredentialKeyProviderId()).toBe('env:CRAFT_CREDENTIAL_KEY');

    expect(() =>
      installCredentialKeyProviderFromEnv({ CRAFT_CREDENTIAL_KEY: 'abc' } as NodeJS.ProcessEnv),
    ).toThrow('CRAFT_CREDENTIAL_KEY');
  });
});


it('preserves provider-encrypted stores when the key is absent or wrong, including pre-flag stores', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'craft-key-unavailable-'));
  const file = join(dir, 'credentials.enc');
  try {
    for (const legacyHeader of [false, true]) {
      setCredentialKeyProvider(providerFor('correct-key'));
      await new SecureStorageBackend(file).set(id, { value: 'preserved-secret' });
      if (legacyHeader) {
        const bytes = readFileSync(file); bytes.writeUInt32LE(0, 8); writeFileSync(file, bytes);
      }
      const original = readFileSync(file);
      for (const provider of [null, providerFor('wrong-key')]) {
        setCredentialKeyProvider(provider);
        const reader = new SecureStorageBackend(file);
        await expect(reader.get(id)).rejects.toThrow('original file preserved');
        await expect(reader.set(id, { value: 'replacement' })).rejects.toThrow('original file preserved');
        expect(existsSync(file)).toBe(true);
        expect(readFileSync(file)).toEqual(original);
      }
      setCredentialKeyProvider(providerFor('correct-key'));
      expect(await new SecureStorageBackend(file).get(id)).toEqual({ value: 'preserved-secret' });
    }
  } finally { setCredentialKeyProvider(null); rmSync(dir, { recursive: true, force: true }); }
});
