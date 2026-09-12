import { mock, test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('never replaces an existing protected key when the keychain is unavailable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'craft-os-key-'));
  const file = join(dir, '.craft-agent/credentials.key');
  let available = false;
  mock.module('node:os', () => ({ homedir: () => dir }));
  mock.module('electron', () => ({ safeStorage: {
    isEncryptionAvailable: () => available,
    decryptString: () => { throw new Error('keychain locked'); },
    encryptString: () => { throw new Error('must not create replacement'); },
  } }));
  mock.module('./logger', () => ({ mainLog: { warn() {}, info() {} } }));
  mock.module('@craft-agent/shared/credentials', () => ({ setCredentialKeyProvider() {} }));
  try {
    mkdirSync(join(dir, '.craft-agent'));
    writeFileSync(file, 'original-key');
    const { installElectronCredentialKeyProvider } = await import('./credential-key-provider');
    expect(() => installElectronCredentialKeyProvider()).toThrow('unavailable');
    available = true;
    expect(() => installElectronCredentialKeyProvider()).toThrow('keychain locked');
    expect(readFileSync(file, 'utf8')).toBe('original-key');
  } finally { mock.restore(); rmSync(dir, { recursive: true, force: true }); }
});
