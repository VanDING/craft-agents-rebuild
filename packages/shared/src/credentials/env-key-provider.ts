import { setCredentialKeyProvider, type CredentialKeyProvider } from './backends/secure-storage.ts';

const MIN_KEY_BYTES = 16;
const MAX_KEY_BYTES = 64;

function decodeKey(raw: string): Uint8Array | null {
  const trimmed = raw.trim();
  try {
    if (/^[0-9a-f]+$/i.test(trimmed) && trimmed.length % 2 === 0) {
      const bytes = Buffer.from(trimmed, 'hex');
      return bytes.length >= MIN_KEY_BYTES && bytes.length <= MAX_KEY_BYTES ? bytes : null;
    }
    const bytes = Buffer.from(trimmed, 'base64');
    return bytes.length >= MIN_KEY_BYTES && bytes.length <= MAX_KEY_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Headless/server key provider. `CRAFT_CREDENTIAL_KEY` carries a high-entropy
 * key (hex or base64) supplied by the deployment secret manager. Desktop builds
 * install the Electron safeStorage provider instead; this fallback keeps
 * headless deployments off the machine-id derivation.
 */
export function installCredentialKeyProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.CRAFT_CREDENTIAL_KEY;
  if (!raw?.trim()) return null;

  const key = decodeKey(raw);
  if (!key) {
    throw new Error(
      'CRAFT_CREDENTIAL_KEY must be 16-64 bytes encoded as hex or base64',
    );
  }

  const provider: CredentialKeyProvider = {
    id: 'env:CRAFT_CREDENTIAL_KEY',
    getKey: () => key,
  };
  setCredentialKeyProvider(provider);
  return provider.id;
}
