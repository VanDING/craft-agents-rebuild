/**
 * Custom-endpoint authentication policy (audit M-4).
 *
 * A custom endpoint baseUrl is user-configurable. The security rules here are:
 *  1. Only http:/https: base URLs are supported — anything else is rejected
 *     before it can be registered with the Pi SDK.
 *  2. Loopback / link-local endpoints (Ollama, LM Studio, …) never receive a
 *     real API key — even when the user has a credential configured. The Pi
 *     SDK requires a truthy apiKey to register models, so a placeholder is
 *     used instead.
 *
 * Extracted from index.ts so the rules are unit-testable (index.ts executes
 * main() at import time).
 */

/** Minimal shape of the init/runtime config fields this policy reads. */
export interface CustomEndpointAuthConfig {
  baseUrl?: string;
  piAuth?: { credential?: { type: string; key?: string } };
  apiKey?: string;
}

/**
 * True when the URL's host is loopback (localhost, 127.0.0.0/8, ::1,
 * IPv4-mapped IPv6 like ::ffff:127.0.0.1) or link-local (169.254.0.0/16,
 * fe80::/10). Returns false for unparseable URLs or anything else.
 */
export function isLocalhostUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    const normalized = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
    return isLoopbackOrLinkLocalHost(normalized);
  } catch {
    return false;
  }
}

/**
 * True only for http:/https: base URLs. Unparseable URLs and other schemes
 * (ftp:, file:, ws:, …) are rejected.
 */
export function hasSupportedBaseUrlScheme(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Resolve the API key used to register the custom-endpoint provider.
 * Loopback / link-local hosts ALWAYS get the 'not-needed' placeholder — the
 * real key must never leave the machine to a local endpoint, regardless of
 * whether a credential exists. Remote hosts get the configured credential.
 */
export function resolveCustomEndpointApiKeyFor(
  config: CustomEndpointAuthConfig | null | undefined,
): string {
  // Audit M-4: never attach a real key to a loopback/link-local endpoint.
  if (config?.baseUrl && isLocalhostUrl(config.baseUrl)) {
    return 'not-needed';
  }
  if (config?.piAuth?.credential?.type === 'api_key') {
    return config.piAuth.credential.key ?? '';
  }
  return config?.apiKey ?? '';
}

function isLoopbackOrLinkLocalHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '::1') return true;
  // IPv4 loopback 127.0.0.0/8
  if (lower.startsWith('127.')) return true;
  // IPv4 link-local 169.254.0.0/16
  if (lower.startsWith('169.254.')) return true;
  // IPv6 link-local fe80::/10 — first hextet 0xfe80..0xfebf
  if (/^fe[89ab][0-9a-f]/.test(lower)) return true;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — loopback when the embedded IPv4 is 127.0.0.0/8
  if (lower.startsWith('::ffff:')) {
    return isMappedIpv4Loopback(lower.slice('::ffff:'.length));
  }
  return false;
}

/** Evaluate the 32-bit IPv4 embedded in an IPv4-mapped IPv6 suffix. */
function isMappedIpv4Loopback(mapped: string): boolean {
  // Dotted form: ::ffff:127.0.0.1
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(mapped)) {
    return mapped.startsWith('127.');
  }
  // Hex form: ::ffff:7f00:1 (last 32 bits span the final one or two groups)
  if (/^[0-9a-f]{1,4}(:[0-9a-f]{1,4}){1,3}$/.test(mapped)) {
    const groups = mapped.split(':');
    const last = parseInt(groups[groups.length - 1] ?? '0', 16);
    const secondLast = groups.length >= 2 ? parseInt(groups[groups.length - 2] ?? '0', 16) : 0;
    const ipv4 = (secondLast << 16) | last;
    return (ipv4 >>> 24) === 127;
  }
  return false;
}
