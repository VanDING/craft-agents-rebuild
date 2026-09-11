/**
 * Electron OS-keychain credential provider.
 *
 * A random 32-byte key is protected by Electron's `safeStorage` (DPAPI on
 * Windows, Keychain on macOS, libsecret/kwallet on Linux) and stored next to
 * the encrypted credential store. Shared secure-storage consumes that key
 * instead of deriving one from a stable machine id, so a copied credentials.enc
 * is useless without the OS user profile.
 */
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import { setCredentialKeyProvider } from '@craft-agent/shared/credentials';
import { atomicWriteFileSync } from '@craft-agent/shared/utils/files';
import { mainLog } from './logger';

const KEY_FILE = join(homedir(), '.craft-agent', 'credentials.key');

function backupCorruptKeyFile(): void {
  try {
    if (!existsSync(KEY_FILE)) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    renameSync(KEY_FILE, `${KEY_FILE}.corrupt-${timestamp}`);
  } catch {
    // Best effort: a new key is generated either way and the old file is ignored.
  }
}

function loadOrCreateKey(): Buffer {
  if (existsSync(KEY_FILE)) {
    try {
      const encrypted = Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
      const hex = safeStorage.decryptString(encrypted);
      const key = Buffer.from(hex, 'hex');
      if (key.length === 32) return key;
      throw new Error(`unexpected key length ${key.length}`);
    } catch (error) {
      mainLog.warn('[credentials] OS-protected key could not be read; regenerating', {
        message: error instanceof Error ? error.message : String(error),
      });
      backupCorruptKeyFile();
    }
  }

  const key = randomBytes(32);
  const protectedKey = safeStorage.encryptString(key.toString('hex')).toString('base64');
  atomicWriteFileSync(KEY_FILE, protectedKey, { mode: 0o600 });
  return key;
}

/**
 * Install the Electron key provider when the platform backend is available.
 * Returns the provider id, or null when the machine-id fallback should be used.
 */
export function installElectronCredentialKeyProvider(): string | null {
  if (!safeStorage.isEncryptionAvailable()) {
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
    mainLog.warn('[credentials] failed to install OS credential provider; falling back', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
