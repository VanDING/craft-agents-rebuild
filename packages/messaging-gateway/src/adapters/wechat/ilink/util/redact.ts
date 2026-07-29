// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

/**
 * Sensitive JSON field names whose values will be masked by {@link redactBody}.
 */
const SENSITIVE_FIELDS = new Set([
  'context_token',
  'bot_token',
  'token',
  'authorization',
  'Authorization',
]);

/**
 * Truncate a string with a length indicator.
 *
 * @param s   - The string to truncate.
 * @param max - Maximum length before truncation kicks in.
 * @returns The original string if short enough, otherwise the prefix followed
 *          by an ellipsis and the original total length.
 */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `... (${s.length} chars)`;
}

/**
 * Redact a security token for safe logging.
 *
 * Only the first few characters are revealed; the total length is noted so
 * callers can distinguish empty, missing, and populated tokens.
 *
 * @param token     - The token value to redact.  `undefined` / empty returns a
 *                    placeholder.
 * @param prefixLen - Number of leading characters to keep visible (default 4).
 * @returns A redacted representation such as `"abcd... (40 chars)"` or
 *          `"(no token)"`.
 */
export function redactToken(token?: string, prefixLen = 4): string {
  if (!token) return '(no token)';
  if (token.length <= prefixLen) return token;
  return token.slice(0, prefixLen) + `... (${token.length} chars)`;
}

/**
 * Redact a JSON body for safe logging.
 *
 * Known sensitive fields (context_token, bot_token, token, authorization,
 * Authorization) are masked with `"***"`.  If the body is a JSON string it is
 * parsed first; non-JSON strings are truncated directly.  The result is then
 * truncated to `maxLen`.
 *
 * @param body   - The body to redact (object, string, or absent).
 * @param maxLen - Maximum length for the final string (default 500).
 * @returns A redacted, truncated string representation.
 */
export function redactBody(body?: unknown, maxLen = 500): string {
  if (body === undefined || body === null) return '(no body)';

  let parsed: unknown;

  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return truncate(body, maxLen);
    }
  } else {
    parsed = structuredClone(body);
  }

  const redact = (obj: unknown): unknown => {
    if (Array.isArray(obj)) {
      return obj.map(redact);
    }
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = SENSITIVE_FIELDS.has(key) ? '***' : redact(value);
      }
      return result;
    }
    return obj;
  };

  const text = JSON.stringify(redact(parsed));
  return truncate(text, maxLen);
}

/**
 * Strip the query-string component from a URL for safe logging.
 *
 * @param rawUrl - The URL to redact.
 * @returns The URL without its query string, or the original string if it
 *          cannot be parsed.
 */
export function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.search = '';
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}
