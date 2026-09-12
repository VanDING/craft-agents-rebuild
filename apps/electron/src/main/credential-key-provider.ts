/**
 * Electron OS-keychain credential provider.
 *
 * A random 32-byte key is protected by Electron's `safeStorage` (DPAPI on
 * Windows, Keychain on macOS, libsecret/kwallet on Linux) and stored next to
 * the encrypted credential store. Shared secure-storage consumes that key
 * instead of deriving one from a stable machine id, so a copied credentials.enc
 * is useless without the OS user profile.
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { safeStorage } from 'electron';
import { setCredentialKeyProvider } from '@craft-agent/shared/credentials';
import { atomicWriteFileSync } from '@craft-agent/shared/utils/files';
import { mainLog } from './logger';

const KEY_FILE = join(homedir(), '.craft-agent', 'credentials.key');

function loadOrCreateKey(): Buffer {
  if (existsSync(KEY_FILE)) {
    const encrypted = Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
    const hex = safeStorage.decryptString(encrypted);
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Invalid protected credential key; original file preserved');
    return Buffer.from(hex, 'hex');
  }

  const key = randomBytes(32);
  const protectedKey = safeStorage.encryptString(key.toString('hex')).toString('base64');
  mkdirSync(dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  atomicWriteFileSync(KEY_FILE, protectedKey, { mode: 0o600 });
  return key;
}

/**
 * Install the Electron key provider when the platform backend is available.
 * Returns the provider id, or null when the machine-id fallback should be used.
 */
export function installElectronCredentialKeyProvider(): string | null {
  if (!safeStorage.isEncryptionAvailable()) {
    if (existsSync(KEY_FILE)) throw new Error('OS credential key unavailable; unlock the keychain and retry');
    mainLog.warn(
      '[credentials] OS encryption backend unavailable; using machine-id credential derivation',
    );
    return null;
  }

  try {
    const key = loadOrCreateKey();
    const providerId = 'electron-safeStorage';
    setCredentialKeyProvider({ id: providerId, getKey: () => key });
    mainLog.info('[credentials] using OS-protected credential key');
    return providerId;
  } catch (error) {
    mainLog.warn('[credentials] failed to install OS credential provider; original key preserved', {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
