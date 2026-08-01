// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import { randomInt } from 'node:crypto';
import { loadConfigBotAgent, loadConfigRouteTag } from '../auth/accounts';
import { logger } from '../util/logger';
import { redactBody, redactUrl } from '../util/redact';
import type {
  BaseInfo,
  GetUploadUrlReq,
  GetUploadUrlResp,
  GetUpdatesReq,
  GetUpdatesResp,
  NotifyStopResp,
  NotifyStartResp,
  SendMessageReq,
  SendMessageResp,
  SendTypingReq,
  GetConfigResp,
} from './types';

// ── Constants ───────────────────────────────────────────────────────────────

/** Upstream package version string used in client-version computation. */
export const CHANNEL_VERSION = '2.4.4';

/** Default iLink app identifier sent in every request header. */
export const ILINK_APP_ID = 'bot';

/** Default bot-agent value used when no config override is available. */
export const DEFAULT_BOT_AGENT = 'CraftAgent/0.9.6';

/**
 * Build a 4-byte client-version integer from a semver string.
 * Encoding: `0x00MMNNPP` where MM = major, NN = minor, PP = patch.
 *
 * @example buildClientVersion('2.4.4') → 0x00020404 → 132100
 */
export function buildClientVersion(version: string): number {
  const parts = version.split('.').map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return (major << 16) | (minor << 8) | patch;
}

/** Pre-computed client version for the vendored CHANNEL_VERSION. */
export const ILINK_APP_CLIENT_VERSION = buildClientVersion(CHANNEL_VERSION);

// ── Types ───────────────────────────────────────────────────────────────────

export type WeixinApiOptions = {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  longPollTimeoutMs?: number;
};

/**
 * Error thrown by {@link apiPostFetch} when the iLink server answers with a
 * non-2xx HTTP status. Carries the status and the (redacted-at-log) body so
 * callers can decide whether the failure is transient.
 */
export class ApiHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;

  constructor(status: number, statusText: string, body: string, label: string) {
    const detail = body.trim() ? ` — ${redactBody(body)}` : '';
    super(`${label} failed: HTTP ${status} ${statusText}${detail}`);
    this.name = 'ApiHttpError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

/**
 * Whether an HTTP status code represents a transient failure worth retrying
 * (rate limiting or server-side errors).
 */
export function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Combine an internal AbortController (e.g. for a timeout) with an external
 * AbortSignal (e.g. for caller-initiated cancellation).
 *
 * Returns the combined signal and a cleanup function that MUST be called
 * when the request completes to avoid leaking the event listener.
 *
 * - When only `external` is provided, returns it directly (no-op cleanup).
 * - When only `internal` is provided, returns its signal (no-op cleanup).
 * - When both are provided, the external abort is forwarded to the internal
 *   controller so that aborting either signal aborts the request.
 */
export function combineAbortSignals(options: {
  internal?: AbortController;
  external?: AbortSignal;
}): { signal: AbortSignal; cleanup: () => void } {
  const { internal, external } = options;

  if (!internal && !external) {
    return { signal: new AbortController().signal, cleanup: () => {} };
  }
  if (!internal) {
    return { signal: external!, cleanup: () => {} };
  }
  if (!external) {
    return { signal: internal.signal, cleanup: () => {} };
  }

  // Both present: forward external abort to the internal controller.
  const onAbort = () => {
    if (!internal.signal.aborted) {
      internal.abort(external.reason);
    }
  };

  if (external.aborted) {
    internal.abort(external.reason);
  } else {
    external.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: internal.signal,
    cleanup: () => external.removeEventListener('abort', onAbort),
  };
}

/**
 * Strict UA-style sanitization of a raw bot-agent string. Removes non-printable
 * ASCII characters and trims whitespace. Returns {@link DEFAULT_BOT_AGENT} when
 * the input is empty, undefined, or the sanitized result is empty.
 */
export function sanitizeBotAgent(raw: string | undefined): string {
  if (!raw) return DEFAULT_BOT_AGENT;
  const sanitized = raw.replace(/[^\x20-\x7E]/g, '').trim();
  return sanitized.length > 0 ? sanitized : DEFAULT_BOT_AGENT;
}

/**
 * Build a standard `BaseInfo` payload using the default iLink app identifier.
 */
export function buildBaseInfo(): BaseInfo {
  return { appid: ILINK_APP_ID };
}

// ── Low-level fetch helpers ────────────────────────────────────────────────

/**
 * Assemble the common iLink HTTP headers used by every request.
 *
 * Headers set:
 * - `iLink-App-Id`
 * - `iLink-App-ClientVersion`
 * - `Content-Type: application/json`
 * - `X-WECHAT-UIN` (random per-request value)
 * - `SKRouteTag` (when the route tag is available)
 * - `AuthorizationType: ilink_bot_token` + `Authorization: Bearer {token}`
 *   (when a token is supplied)
 */
function buildCommonHeaders(token?: string, routeTag?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
    'Content-Type': 'application/json',
    'X-WECHAT-UIN': Buffer.from(randomInt(0, 0xFFFFFFFF).toString(10)).toString('base64'),
  };

  if (routeTag) {
    headers['SKRouteTag'] = routeTag;
  }

  if (token) {
    headers['AuthorizationType'] = 'ilink_bot_token';
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Perform a GET request with common iLink headers and optional timeout.
 *
 * @param params.baseUrl  - Base URL of the iLink API server.
 * @param params.endpoint - API path (e.g. `/GetConfig`).
 * @param params.timeoutMs - Optional timeout in milliseconds.
 * @param params.label    - Optional log label (defaults to the endpoint).
 * @returns The raw response body as a string.
 */
export async function apiGetFetch(params: {
  baseUrl: string;
  endpoint: string;
  timeoutMs?: number;
  label?: string;
}): Promise<string> {
  const url = `${params.baseUrl}${params.endpoint}`;
  const routeTag = loadConfigRouteTag();
  const headers = buildCommonHeaders(undefined, routeTag);
  const label = params.label ?? `GET ${params.endpoint}`;

  logger.info(label, { url: redactUrl(url) });

  const signal = params.timeoutMs ? AbortSignal.timeout(params.timeoutMs) : undefined;

  const response = await fetch(url, { method: 'GET', headers, signal });

  if (!response.ok) {
    const text = await response.text();
    logger.warn(`${label} returned ${response.status}`, {
      status: response.status,
      body: redactBody(text),
    });
    return text;
  }

  return response.text();
}

/**
 * Perform a POST request with common iLink headers, optional Authorization,
 * optional timeout, and optional external abort signal.
 *
 * @param params.baseUrl     - Base URL of the iLink API server.
 * @param params.endpoint    - API path (e.g. `/SendMessage`).
 * @param params.body        - JSON-serializable request body.
 * @param params.token       - Optional bearer token for authorization.
 * @param params.timeoutMs   - Optional timeout in milliseconds.
 * @param params.label       - Optional log label (defaults to the endpoint).
 * @param params.abortSignal - Optional external signal for caller cancellation.
 * @returns The raw response body as a string.
 */
export async function apiPostFetch(params: {
  baseUrl: string;
  endpoint: string;
  body: unknown;
  token?: string;
  timeoutMs?: number;
  label?: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const url = `${params.baseUrl}${params.endpoint}`;
  const routeTag = loadConfigRouteTag();
  const headers = buildCommonHeaders(params.token, routeTag);
  const label = params.label ?? `POST ${params.endpoint}`;

  logger.info(label, { url: redactUrl(url) });

  // Combine internal timeout with external abort signal.
  let signal: AbortSignal | undefined;
  let cleanup: (() => void) | undefined;

  if (params.timeoutMs !== undefined && params.abortSignal) {
    const internal = new AbortController();
    const combined = combineAbortSignals({ internal, external: params.abortSignal });
    const timeoutId = setTimeout(
      () => internal.abort(new DOMException('Timeout', 'AbortError')),
      params.timeoutMs,
    );
    signal = combined.signal;
    cleanup = () => {
      clearTimeout(timeoutId);
      combined.cleanup();
    };
  } else if (params.timeoutMs !== undefined) {
    signal = AbortSignal.timeout(params.timeoutMs);
  } else if (params.abortSignal) {
    signal = params.abortSignal;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(params.body),
      signal,
    });

    const text = await response.text();

    if (!response.ok) {
      logger.warn(`${label} returned ${response.status}`, {
        status: response.status,
        body: redactBody(text),
      });
      // Treat non-2xx responses as failures (H-6): previously the raw body was
      // returned and JSON-parsable error bodies were consumed as success.
      throw new ApiHttpError(response.status, response.statusText, text, label);
    }

    return text;
  } finally {
    cleanup?.();
  }
}

// ── iLink API endpoint functions ───────────────────────────────────────────

/**
 * Long-poll for incoming messages.
 *
 * This is the primary mechanism for receiving real-time messages from the
 * iLink server. The request blocks until messages arrive or the long-poll
 * timeout elapses.
 *
 * On timeout or external abort (both manifest as `AbortError`) this function
 * returns an empty response instead of throwing, which is the expected
 * behaviour for long-polling consumers.
 *
 * @param params.session_id        - Optional session identifier.
 * @param params.get_updates_buf   - Opaque continuation token from a previous
 *                                   response (provides at-least-once delivery).
 * @param params.longpolling_timeout_ms - Server-side long-poll timeout hint.
 * @param params.baseUrl           - Base URL of the iLink API server.
 * @param params.token             - Optional bearer token.
 * @param params.timeoutMs         - Client-side timeout (default 65 s).
 * @param params.abortSignal       - Optional external cancellation signal.
 */
export async function getUpdates(
  params: GetUpdatesReq & {
    baseUrl: string;
    token?: string;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
  },
): Promise<GetUpdatesResp> {
  const timeoutMs = params.timeoutMs ?? 65_000;

  try {
    const respText = await apiPostFetch({
      baseUrl: params.baseUrl,
      endpoint: 'ilink/bot/getupdates',
      body: {
        session_id: params.session_id,
        get_updates_buf: params.get_updates_buf,
        longpolling_timeout_ms: params.longpolling_timeout_ms,
      },
      token: params.token,
      timeoutMs,
      abortSignal: params.abortSignal,
      label: 'getUpdates',
    });
    return JSON.parse(respText) as GetUpdatesResp;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        ret: 0,
        errcode: 0,
        errmsg: '',
        msgs: [],
        get_updates_buf: params.get_updates_buf ?? '',
        longpolling_timeout_ms: params.longpolling_timeout_ms ?? 0,
      };
    }
    throw err;
  }
}

/**
 * Obtain an upload URL and token for uploading media files to the iLink CDN.
 *
 * @param params.media_type - Type of media being uploaded (see UploadMediaType).
 * @param params.file_size  - File size in bytes.
 * @param params.file_name  - Optional file name.
 * @param params.md5        - Optional MD5 hex digest of the file content.
 */
export async function getUploadUrl(
  params: GetUploadUrlReq & WeixinApiOptions,
): Promise<GetUploadUrlResp> {
  const respText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/getuploadurl',
    body: {
      media_type: params.media_type,
      file_size: params.file_size,
      file_name: params.file_name,
      md5: params.md5,
    },
    token: params.token,
    timeoutMs: params.timeoutMs,
    label: 'getUploadUrl',
  });
  return JSON.parse(respText) as GetUploadUrlResp;
}

/**
 * Parse a `SendMessage` response body.
 *
 * Returns `null` for empty bodies, which the caller treats as an implicit
 * success. Non-JSON bodies are a failure and throw (H-6): a malformed
 * response must never be consumed as success.
 */
function parseSendMessageResp(raw: string): SendMessageResp | null {
  if (!raw || raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `sendMessage failed: server returned a non-JSON body: ${redactBody(raw)}`,
    );
  }
  return parsed as SendMessageResp;
}

/**
 * Whether a parsed sendMessage response carries a transient business errcode
 * worth retrying (rate limit / server-side errors), mirroring the HTTP-status
 * classification in {@link isTransientHttpStatus}.
 */
function isTransientSendErrcode(resp: SendMessageResp | null): boolean {
  const code = resp?.errcode;
  return typeof code === 'number' && (code === 429 || code >= 500);
}

/** Maximum attempts for one logical send (1 initial + 2 retries). */
const MAX_SEND_ATTEMPTS = 3;

/** Base delay for sendMessage retry backoff (doubles per attempt). */
const SEND_RETRY_BASE_DELAY_MS = 300;

/** Sleep for `ms` milliseconds. */
async function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * Send a message to a WeChat user.
 *
 * Parses the server response and logs the outcome with state, clientId,
 * ret, errcode, and errmsg. Throws when `ret` or `errcode` is non-zero, when
 * the body is not JSON, and when the HTTP request fails (non-2xx).
 *
 * Transient failures — HTTP 429/5xx or transient business errcodes — are
 * retried up to {@link MAX_SEND_ATTEMPTS} attempts with exponential backoff.
 * The same request body (and therefore the same `client_id`) is reused across
 * retries of the same logical send.
 */
export async function sendMessage(
  params: WeixinApiOptions & { body: SendMessageReq },
): Promise<void> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const respText = await apiPostFetch({
        baseUrl: params.baseUrl,
        endpoint: 'ilink/bot/sendmessage',
        body: params.body,
        token: params.token,
        timeoutMs: params.timeoutMs,
        label: 'sendMessage',
      });

      const resp = parseSendMessageResp(respText);

      const msg = params.body.msg;
      logger.info('sendMessage outcome', {
        state: (resp as Record<string, unknown> | null)?.state,
        clientId: msg?.client_id,
        ret: resp?.ret,
        errcode: resp?.errcode,
        errmsg: resp?.errmsg,
      });

      const rejected =
        resp
        && ((resp.ret !== undefined && resp.ret !== 0)
          || (resp.errcode !== undefined && resp.errcode !== 0));

      if (!rejected) {
        return; // success (including empty success bodies)
      }

      if (attempt < MAX_SEND_ATTEMPTS && isTransientSendErrcode(resp)) {
        await sleep(SEND_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }

      throw new Error(
        `sendMessage failed: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ''}`,
      );
    } catch (err) {
      if (
        attempt < MAX_SEND_ATTEMPTS
        && err instanceof ApiHttpError
        && isTransientHttpStatus(err.status)
      ) {
        await sleep(SEND_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Fetch the agent configuration for a given iLink user.
 *
 * @param params.ilinkUserId  - The iLink user identifier.
 * @param params.contextToken - Optional context token for session continuity.
 */
export async function getConfig(
  params: WeixinApiOptions & { ilinkUserId: string; contextToken?: string },
): Promise<GetConfigResp> {
  const respText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/getconfig',
    body: {
      ilink_user_id: params.ilinkUserId,
      context_token: params.contextToken,
    },
    token: params.token,
    timeoutMs: params.timeoutMs,
    label: 'getConfig',
  });
  return JSON.parse(respText) as GetConfigResp;
}

/**
 * Send a typing indicator to a WeChat user.
 */
export async function sendTyping(
  params: WeixinApiOptions & { body: SendTypingReq },
): Promise<void> {
  await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/sendtyping',
    body: params.body,
    token: params.token,
    timeoutMs: params.timeoutMs,
    label: 'sendTyping',
  });
}

/**
 * Notify the server that the bot has stopped processing messages for the
 * current session.
 */
export async function notifyStop(
  params: WeixinApiOptions,
): Promise<NotifyStopResp> {
  const respText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/msg/notifystop',
    body: {},
    token: params.token,
    timeoutMs: params.timeoutMs,
    label: 'notifyStop',
  });
  return JSON.parse(respText) as NotifyStopResp;
}

/**
 * Notify the server that the bot has started processing messages for the
 * current session.
 */
export async function notifyStart(
  params: WeixinApiOptions,
): Promise<NotifyStartResp> {
  const respText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/msg/notifystart',
    body: {},
    token: params.token,
    timeoutMs: params.timeoutMs,
    label: 'notifyStart',
  });
  return JSON.parse(respText) as NotifyStartResp;
}
