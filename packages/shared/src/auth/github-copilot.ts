/**
 * GitHub Copilot OAuth flow
 *
 * Replaces @earendil-works/pi-ai/oauth which became type-only in pi-ai@0.80.8+.
 * These functions were originally from pi-ai's internal utils/oauth/github-copilot.ts.
 */

// ── Constants ──────────────────────────────────────────────────────────

const CLIENT_ID = atob('SXYxLmI1MDdhMDhjODdlY2ZlOTg='); // Iv1.b507a08c87ecfe98

const COPILOT_HEADERS = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
} as const;

const COPILOT_API_VERSION = '2026-06-01';

// ── Types ──────────────────────────────────────────────────────────────

export interface CopilotCredentials {
  access: string;       // Copilot API token
  refresh: string;      // GitHub access token (reused as refresh)
  expires: number;      // expiry timestamp (ms)
  enterpriseUrl?: string;
  availableModelIds?: string[];
}

interface DeviceCodeResult {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

export interface GitHubCopilotLoginOptions {
  onDeviceCode: (info: { userCode: string; verificationUri: string }) => void;
  onPrompt: (prompt: { message: string; placeholder?: string; allowEmpty?: boolean }) => Promise<string>;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

// ── Helpers ────────────────────────────────────────────────────────────

function getUrls(domain: string) {
  return {
    deviceCodeUrl: `https://${domain}/login/device/code`,
    accessTokenUrl: `https://${domain}/login/oauth/access_token`,
    copilotTokenUrl: `https://api.${domain}/copilot_internal/v2/token`,
  };
}

export function getGitHubCopilotBaseUrl(token?: string, enterpriseDomain?: string): string {
  if (token) {
    const match = token.match(/proxy-ep=([^;]+)/);
    if (match) {
      const apiHost = match[1].replace(/^proxy\./, 'api.');
      return `https://${apiHost}`;
    }
  }
  if (enterpriseDomain) return `https://copilot-api.${enterpriseDomain}`;
  return 'https://api.individual.githubcopilot.com';
}

export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.includes('://') ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.hostname;
  } catch {
    return null;
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return response.json();
}

// ── Device Code Flow ───────────────────────────────────────────────────

async function startDeviceFlow(domain: string): Promise<DeviceCodeResult> {
  const urls = getUrls(domain);
  const data = await fetchJson(urls.deviceCodeUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'GitHubCopilotChat/0.35.0',
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: 'read:user',
    }),
  });

  if (!data || typeof data !== 'object') throw new Error('Invalid device code response');

  const d = data as Record<string, unknown>;
  const deviceCode = d.device_code;
  const userCode = d.user_code;
  const verificationUri = d.verification_uri;
  const interval = d.interval;
  const expiresIn = d.expires_in;

  if (
    typeof deviceCode !== 'string' ||
    typeof userCode !== 'string' ||
    typeof verificationUri !== 'string' ||
    (interval !== undefined && typeof interval !== 'number') ||
    typeof expiresIn !== 'number'
  ) {
    throw new Error('Invalid device code response fields');
  }

  let parsedUri: URL;
  try {
    parsedUri = new URL(verificationUri);
  } catch {
    throw new Error('Untrusted verification_uri in device code response');
  }
  if (parsedUri.protocol !== 'https:' && parsedUri.protocol !== 'http:') {
    throw new Error('Untrusted verification_uri in device code response');
  }

  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: parsedUri.href,
    interval: typeof interval === 'number' ? interval : 5,
    expires_in: expiresIn,
  };
}

async function pollForGitHubAccessToken(
  domain: string,
  device: DeviceCodeResult,
  signal?: AbortSignal,
): Promise<string> {
  const urls = getUrls(domain);

  const deadline = Date.now() + device.expires_in * 1000;
  let intervalMs = Math.max(1000, Math.floor((device.interval || 5) * 1000));
  let slowDownCount = 0;
  const CANCEL_MSG = 'Login cancelled';

  const abortableSleep = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new Error(CANCEL_MSG)); return; }
      const onAbort = () => { clearTimeout(t); reject(new Error(CANCEL_MSG)); };
      const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });

  // Wait before first poll
  await abortableSleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error(CANCEL_MSG);

    const raw = await fetchJson(urls.accessTokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'GitHubCopilotChat/0.35.0',
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        device_code: device.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).access_token === 'string') {
      return (raw as Record<string, unknown>).access_token as string;
    }

    if (raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).error === 'string') {
      const r = raw as Record<string, unknown>;
      const error = r.error as string;
      if (error === 'authorization_pending') {
        // continue polling
      } else if (error === 'slow_down') {
        slowDownCount++;
        intervalMs = Math.max(
          1000,
          typeof r.interval === 'number' && r.interval > 0
            ? Math.floor(r.interval * 1000)
            : intervalMs + 5000,
        );
      } else {
        const desc = r.error_description ? `: ${r.error_description}` : '';
        throw new Error(`Device flow failed: ${error}${desc}`);
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await abortableSleep(Math.min(intervalMs, remaining));
  }

  throw new Error(slowDownCount > 0
    ? 'Device flow timed out after slow_down responses. Check clock sync in WSL/VM.'
    : 'Device flow timed out');
}

async function refreshCopilotApiToken(
  githubToken: string,
  enterpriseDomain?: string,
): Promise<CopilotCredentials> {
  const domain = enterpriseDomain || 'github.com';
  const urls = getUrls(domain);

  const raw = await fetchJson(urls.copilotTokenUrl, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${githubToken}`,
      ...COPILOT_HEADERS,
    },
  });

  if (!raw || typeof raw !== 'object') throw new Error('Invalid Copilot token response');

  const r = raw as Record<string, unknown>;
  const token = r.token;
  const expiresAt = r.expires_at;

  if (typeof token !== 'string' || typeof expiresAt !== 'number') {
    throw new Error('Invalid Copilot token response fields');
  }

  return {
    refresh: githubToken,
    access: token,
    expires: expiresAt * 1000 - 5 * 60 * 1000,
    enterpriseUrl: enterpriseDomain,
  };
}

async function fetchAvailableModelIds(copilotToken: string, enterpriseDomain?: string): Promise<string[]> {
  const baseUrl = getGitHubCopilotBaseUrl(copilotToken, enterpriseDomain);
  const raw = await fetchJson(`${baseUrl}/models`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${copilotToken}`,
      ...COPILOT_HEADERS,
      'X-GitHub-Api-Version': COPILOT_API_VERSION,
    },
    signal: AbortSignal.timeout(5000),
  });

  return parseAvailableCopilotModelIds(raw);
}

function parseAvailableCopilotModelIds(raw: unknown): string[] {
  const data = (raw as Record<string, unknown>)?.data;
  if (!Array.isArray(data)) throw new Error('Invalid Copilot models response');

  const ids: string[] = [];
  for (const rawItem of data) {
    const item = rawItem as Record<string, unknown> | undefined;
    if (!item) continue;
    const id = item.id;
    const policy = item.policy as Record<string, unknown> | undefined;
    const capabilities = item.capabilities as Record<string, unknown> | undefined;
    const supports = capabilities?.supports as Record<string, unknown> | undefined;
    if (
      typeof id === 'string' &&
      item.model_picker_enabled === true &&
      policy?.state !== 'disabled' &&
      supports?.tool_calls !== false
    ) {
      ids.push(id);
    }
  }
  return ids;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Refresh a GitHub Copilot token using a stored GitHub access token.
 * Returns { access, refresh, expires, enterpriseUrl, availableModelIds }.
 */
export async function refreshGitHubCopilotToken(
  refreshToken: string,
  enterpriseDomain?: string,
): Promise<CopilotCredentials> {
  const credentials = await refreshCopilotApiToken(refreshToken, enterpriseDomain);
  credentials.availableModelIds = await fetchAvailableModelIds(credentials.access, enterpriseDomain);
  return credentials;
}

/**
 * Login to GitHub Copilot via OAuth device code flow.
 *
 * @param options.onDeviceCode - Called with the user code and verification URI
 * @param options.onPrompt - Called to prompt for enterprise domain (return '' for github.com)
 * @param options.onProgress - Optional progress callback
 * @param options.signal - Optional AbortSignal for cancellation
 */
export async function loginGitHubCopilot(options: GitHubCopilotLoginOptions): Promise<CopilotCredentials> {
  const input = await options.onPrompt({
    message: 'GitHub Enterprise URL/domain (blank for github.com)',
    placeholder: 'company.ghe.com',
    allowEmpty: true,
  });

  if (options.signal?.aborted) throw new Error('Login cancelled');

  const trimmed = input.trim();
  const enterpriseDomain = normalizeDomain(input);
  if (trimmed && !enterpriseDomain) {
    throw new Error('Invalid GitHub Enterprise URL/domain');
  }

  const domain = enterpriseDomain || 'github.com';
  const device = await startDeviceFlow(domain);

  options.onDeviceCode({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
  });

  const githubAccessToken = await pollForGitHubAccessToken(domain, device, options.signal);
  const credentials = await refreshCopilotApiToken(githubAccessToken, enterpriseDomain ?? undefined);

  options.onProgress?.('Enabling models...');

  // Fetch available models after login
  credentials.availableModelIds = await fetchAvailableModelIds(
    credentials.access,
    enterpriseDomain ?? undefined,
  );

  return credentials;
}
