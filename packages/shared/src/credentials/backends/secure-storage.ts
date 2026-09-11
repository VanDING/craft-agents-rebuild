/**
 * Secure Storage Backend
 *
 * Stores credentials in an encrypted file at ~/.craft-agent/credentials.enc
 * Uses AES-256-GCM for authenticated encryption.
 *
 * Encryption key is derived from OS-native hardware UUID using PBKDF2:
 * - macOS: IOPlatformUUID (tied to logic board, never changes)
 * - Windows: MachineGuid from registry (set at OS install)
 * - Linux: /var/lib/dbus/machine-id (set at OS install)
 *
 * This is more stable than the previous hostname-based derivation, which could
 * change with network/DHCP. Legacy credentials are auto-migrated on first load.
 *
 * File format:
 *   [Header - 64 bytes]
 *   ├── Magic: "CRAFT01\0" (8 bytes)
 *   ├── Flags: uint32 LE (4 bytes) - reserved for future use
 *   ├── Salt: 32 bytes (PBKDF2 salt)
 *   ├── Reserved: 20 bytes
 *   [Encrypted Payload]
 *   ├── IV: 12 bytes (random per write)
 *   ├── Auth Tag: 16 bytes (GCM authentication)
 *   └── Ciphertext: variable (encrypted JSON)
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  pbkdf2Sync,
  createHash,
} from 'crypto';
import { execSync } from 'child_process';
import { existsSync, readFileSync, mkdirSync, renameSync } from 'fs';
import { atomicWriteFileSync } from '../../utils/files.ts';
import { hostname, userInfo, homedir } from 'os';
import { join, dirname } from 'path';

import type { CredentialId, StoredCredential } from '../types.ts';
import { credentialIdToAccount, accountToCredentialId } from '../types.ts';
import { createLogger } from '../../utils/debug.ts';

// File location
const CREDENTIALS_FILE = join(homedir(), '.craft-agent', 'credentials.enc');

// File format constants
const MAGIC_BYTES = Buffer.from('CRAFT01\0');
const HEADER_SIZE = 64;
const MAGIC_SIZE = 8;
const FLAGS_SIZE = 4;
const SALT_SIZE = 32;
const IV_SIZE = 12;
const AUTH_TAG_SIZE = 16;
const KEY_SIZE = 32;

// PBKDF2 iterations (balance security vs startup time)
const PBKDF2_ITERATIONS = 100000;

// Scoped diagnostic logger (only emits when debug logging is enabled)
const logger = createLogger('secure-storage');
/**
 * Optional OS-native key provider (Electron safeStorage, server KMS/keychain
 * adapter, tests). Returning null falls back to the machine-id derivation so
 * headless and keychain-less environments keep working.
 */
export interface CredentialKeyProvider {
  readonly id: string;
  getKey(): Uint8Array | null;
}

let credentialKeyProvider: CredentialKeyProvider | null = null;

/** Install an OS-native key provider. Call before the first credential access. */
export function setCredentialKeyProvider(provider: CredentialKeyProvider | null): void {
  credentialKeyProvider = provider;
}

export function getCredentialKeyProvider(): CredentialKeyProvider | null {
  return credentialKeyProvider;
}

export function getCredentialKeyProviderId(): string {
  return credentialKeyProvider?.id ?? 'machine-id';
}

/**
 * Get stable machine identifier using OS-native hardware UUID.
 * This is far more stable than hostname which can change with network/DHCP.
 * Falls back to username + homedir if hardware UUID unavailable.
 */
function getStableMachineId(): string {
  try {
    if (process.platform === 'darwin') {
      // macOS: IOPlatformUUID - tied to logic board, never changes
      const output = execSync(
        'ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    } else if (process.platform === 'win32') {
      // Windows: MachineGuid from registry - set at OS install
      const output = execSync(
        'reg query HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const match = output.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
      if (match?.[1]) return match[1];
    } else {
      // Linux: dbus machine-id - set at OS install
      const machineIdPath = '/var/lib/dbus/machine-id';
      const altPath = '/etc/machine-id';
      if (existsSync(machineIdPath)) {
        return readFileSync(machineIdPath, 'utf-8').trim();
      } else if (existsSync(altPath)) {
        return readFileSync(altPath, 'utf-8').trim();
      }
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: username + homedir (stable enough for most cases)
  return `${userInfo().username}:${homedir()}`;
}

/** Internal credential store structure */
interface CredentialStore {
  version: 1;
  credentials: Record<string, StoredCredential>;
  metadata: {
    createdAt: number;
    updatedAt: number;
  };
}

export class SecureStorageBackend {

  private cachedStore: CredentialStore | null = null;
  private encryptionKey: Buffer | null = null;
  private salt: Buffer | null = null;
  // Injectable for tests; production callers use the default ~/.craft-agent path.
  private readonly credentialsFile: string;

  constructor(credentialsFile: string = CREDENTIALS_FILE) {
    this.credentialsFile = credentialsFile;
  }

  async get(id: CredentialId): Promise<StoredCredential | null> {
    const store = await this.loadStore();
    if (!store) return null;

    const key = credentialIdToAccount(id);
    return store.credentials[key] || null;
  }

  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    let store = await this.loadStore();

    if (!store) {
      // Initialize new store
      store = {
        version: 1,
        credentials: {},
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
    }

    const key = credentialIdToAccount(id);
    store.credentials[key] = credential;
    store.metadata.updatedAt = Date.now();

    await this.saveStore(store);
  }

  async delete(id: CredentialId): Promise<boolean> {
    return this.deleteSync(id);
  }

  deleteSync(id: CredentialId): boolean {
    const store = this.loadStoreSync();
    if (!store) return false;

    const key = credentialIdToAccount(id);
    if (!(key in store.credentials)) return false;

    delete store.credentials[key];
    store.metadata.updatedAt = Date.now();

    this.saveStoreSync(store);
    return true;
  }

  async list(filter?: Partial<CredentialId>): Promise<CredentialId[]> {
    const store = await this.loadStore();
    if (!store) return [];

    const ids = Object.keys(store.credentials)
      .map(accountToCredentialId)
      .filter((id): id is CredentialId => id !== null);

    if (!filter) return ids;

    return ids.filter((id) => {
      if (filter.type && id.type !== filter.type) return false;
      if (filter.workspaceId && id.workspaceId !== filter.workspaceId) return false;
      if (filter.name && id.name !== filter.name) return false;
      return true;
    });
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private async loadStore(): Promise<CredentialStore | null> {
    return this.loadStoreSync();
  }

  private loadStoreSync(): CredentialStore | null {
    // Return cached store if available
    if (this.cachedStore) return this.cachedStore;

    if (!existsSync(this.credentialsFile)) return null;

    let fileData: Buffer;
    try {
      fileData = readFileSync(this.credentialsFile);
    } catch {
      return null;
    }

    // Validate minimum size
    if (fileData.length < HEADER_SIZE + IV_SIZE + AUTH_TAG_SIZE) {
      // File is corrupted, delete and return null
      this.handleCorruptedFile();
      return null;
    }

    // Validate magic bytes
    if (!fileData.subarray(0, MAGIC_SIZE).equals(MAGIC_BYTES)) {
      this.handleCorruptedFile();
      return null;
    }

    // Parse header
    // const flags = fileData.readUInt32LE(MAGIC_SIZE); // Reserved for future use
    const salt = fileData.subarray(MAGIC_SIZE + FLAGS_SIZE, MAGIC_SIZE + FLAGS_SIZE + SALT_SIZE);
    this.salt = salt;

    // Extract encrypted data
    const encryptedData = fileData.subarray(HEADER_SIZE);

    // Try the configured OS key provider first, then the stable machine key,
    // then the legacy hostname key. A successful fallback is re-encrypted with
    // the preferred key so migration converges after one load.
    const providerKey = this.getProviderEncryptionKey(salt);
    const stableKey = this.getStableEncryptionKey(salt);
    const legacyKey = this.getLegacyEncryptionKey(salt);
    const candidates: Array<{ key: Buffer; provider: boolean }> = [
      ...(providerKey ? [{ key: providerKey, provider: true }] : []),
      { key: stableKey, provider: false },
      { key: legacyKey, provider: false },
    ];

    for (const candidate of candidates) {
      const store = this.tryDecrypt(encryptedData, candidate.key);
      if (!store) continue;

      if (candidate.provider) {
        this.encryptionKey = candidate.key;
        this.cachedStore = store;
        return store;
      }

      // Credentials were written by an older/fallback key. Re-save through the
      // preferred key path before caching so the next load takes one attempt.
      this.encryptionKey = null;
      this.cachedStore = store;
      this.saveStoreSync(store);
      return store;
    }

    // No candidate could decrypt the file - it is truly corrupted.
    this.handleCorruptedFile();
    return null;
  }

  /**
   * Attempt to decrypt data with given key.
   * Returns parsed store on success, null on failure.
   */
  private tryDecrypt(encryptedData: Buffer, key: Buffer): CredentialStore | null {
    try {
      const iv = encryptedData.subarray(0, IV_SIZE);
      const authTag = encryptedData.subarray(IV_SIZE, IV_SIZE + AUTH_TAG_SIZE);
      const ciphertext = encryptedData.subarray(IV_SIZE + AUTH_TAG_SIZE);

      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(decrypted.toString('utf8'));
    } catch {
      return null;
    }
  }

  private async saveStore(store: CredentialStore): Promise<void> {
    this.saveStoreSync(store);
  }

  private saveStoreSync(store: CredentialStore): void {
    // Ensure directory exists
    const credentialsDir = dirname(this.credentialsFile);
    if (!existsSync(credentialsDir)) {
      mkdirSync(credentialsDir, { recursive: true, mode: 0o700 });
    }

    // Use existing salt or generate new one
    const salt = this.salt || randomBytes(SALT_SIZE);
    this.salt = salt;

    // Get encryption key
    const key = this.getEncryptionKey(salt);

    // Serialize payload
    const plaintext = Buffer.from(JSON.stringify(store), 'utf8');

    // Generate new IV for each write (critical for GCM security)
    const iv = randomBytes(IV_SIZE);

    // Encrypt
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Build header
    const header = Buffer.alloc(HEADER_SIZE);
    MAGIC_BYTES.copy(header, 0);
    header.writeUInt32LE(0, MAGIC_SIZE); // Flags (reserved)
    salt.copy(header, MAGIC_SIZE + FLAGS_SIZE);

    // Combine all parts
    const fileData = Buffer.concat([header, iv, authTag, ciphertext]);

    // Write with restrictive permissions (owner read/write only)
    // Atomic temp+rename keeps the previous credential store readable if the
    // process crashes mid-write; the helper fsyncs the temp file before rename.
    atomicWriteFileSync(this.credentialsFile, fileData, { mode: 0o600 });
    this.cachedStore = store;
  }

  private getEncryptionKey(salt: Buffer): Buffer {
    if (this.encryptionKey) return this.encryptionKey;

    this.encryptionKey = this.getProviderEncryptionKey(salt) ?? this.getStableEncryptionKey(salt);
    return this.encryptionKey;
  }

  /**
   * Derive a key from the injected OS provider material. The provider owns
   * where the root secret lives (safeStorage/DPAPI/Keychain/KMS); PBKDF2 is
   * retained here only so the on-disk key schedule stays identical to the
   * machine-id fallback (same salt/iterations/format).
   */
  private getProviderEncryptionKey(salt: Buffer): Buffer | null {
    const raw = credentialKeyProvider?.getKey();
    if (!raw || raw.length === 0) return null;
    const material = createHash('sha256').update(Buffer.from(raw)).digest();
    return pbkdf2Sync(material, salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256');
  }

  /** Stable machine ID key (v2 - hardware UUID based). */
  private getStableEncryptionKey(salt: Buffer): Buffer {
    const stableMachineId = createHash('sha256')
      .update(getStableMachineId())
      .update('craft-agent-v2') // Bumped version for new key derivation
      .digest();

    return pbkdf2Sync(stableMachineId, salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256');
  }

  /**
   * Legacy key derivation for migration from v1 (included hostname).
   * Used to decrypt credentials from older versions before re-encrypting with stable key.
   */
  private getLegacyEncryptionKey(salt: Buffer): Buffer {
    const legacyMachineId = createHash('sha256')
      .update(hostname())
      .update(userInfo().username)
      .update(homedir())
      .update('craft-agent-v1')
      .digest();

    return pbkdf2Sync(legacyMachineId, salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256');
  }

  private handleCorruptedFile(): void {
    // M-16: Preserve the corrupted file as a diagnostic backup instead of
    // deleting it — credentials are user data and the encrypted bytes may be
    // recoverable (or useful for debugging). A fresh store is written on next
    // save; the backup is named credentials.enc.corrupt-<timestamp>.
    try {
      if (existsSync(this.credentialsFile)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${this.credentialsFile}.corrupt-${timestamp}`;
        renameSync(this.credentialsFile, backupPath);
        logger.warn(
          `Credential store corrupted; preserved as ${backupPath} (user will need to re-enter credentials)`
        );
      }
    } catch {
      // Ignore rename errors (e.g. read-only filesystem) — leave the file in place.
    }
    this.cachedStore = null;
    this.encryptionKey = null;
    this.salt = null;
  }

  /** Clear cached data (for testing or forced refresh) */
  clearCache(): void {
    this.cachedStore = null;
    this.encryptionKey = null;
    this.salt = null;
  }
}
