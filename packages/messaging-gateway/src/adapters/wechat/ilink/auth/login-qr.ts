// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.
//
// Local adaptations (vs. upstream):
// - Workspace-scoped state root support (stateRoot) for account token pinning.
// - Security: never re-submit historical account tokens; only the pinned
//   account's token may be submitted for session reuse (via accountId).
// - verifyCodeProvider callback (promise-based) instead of stdin prompts, so
//   the Electron UI can collect the verification code.
// - onStatus callback for UI state transitions; 'expired' carries the
//   refreshed QR URL so the UI can re-render it.
// - Field names follow the LIVE iLink API contract (verified 2026-08-08):
//   get_bot_qrcode returns { qrcode, qrcode_img_content, ... } and
//   get_qrcode_status is a GET long-poll keyed by `qrcode` (plus optional
//   `verify_code`), returning ilink_bot_id / bot_token / baseurl /
//   ilink_user_id on confirmation. Earlier adaptations read qrcode_url /
//   session_key which the API never returns, breaking QR login entirely.

import { randomUUID } from 'node:crypto';
import * as readline from 'node:readline';
import { apiGetFetch, apiPostFetch } from '../api/api';
import { loadWeixinAccount } from './accounts';
import { logger } from '../util/logger';
import { redactToken } from '../util/redact';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default iLink ClawBot type identifier. */
export const DEFAULT_ILINK_BOT_TYPE = '3';

/** Fixed production base URL for the iLink API. */
export const FIXED_BASE_URL = 'https://ilinkai.weixin.qq.com';

/** TTL for active login session tracking (5 minutes). */
const LOGIN_TTL_MS = 5 * 60 * 1000;

/** Polling interval between QR code status checks. */
const POLL_INTERVAL_MS = 1_000;

/** Maximum number of QR code refresh attempts after expiry. */
const MAX_REFRESH_ATTEMPTS = 3;

/** Default timeout for the wait loop (2 minutes). */
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;

/** Maximum per-poll timeout in milliseconds (long-poll). */
const MAX_POLL_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeixinQrStartResult {
  /** URL of the QR code image to display. */
  qrcodeUrl?: string;
  /** Human-readable message from the API. */
  message: string;
  /** Session key to pass to {@link waitForWeixinLogin}. */
  sessionKey: string;
}

export interface WeixinQrWaitResult {
  /** Whether the login completed successfully. */
  connected: boolean;
  /** True when the account was already bound (no new session needed). */
  alreadyConnected?: boolean;
  /** The bot token returned on successful confirmation. */
  botToken?: string;
  /** The WeChat account identifier (ilink_bot_id). */
  accountId?: string;
  /** Base URL for subsequent API calls (may differ from the original). */
  baseUrl?: string;
  /** The WeChat user identifier (ilink_user_id). */
  userId?: string;
  /** Human-readable status message. */
  message: string;
}

/**
 * Raw response shapes from the iLink QR endpoints.
 *
 * - `ilink/bot/get_bot_qrcode` returns `qrcode` (QR session id) and
 *   `qrcode_img_content` (the scannable URL).
 * - `ilink/bot/get_qrcode_status` is a GET long-poll keyed by the `qrcode`
 *   query parameter; on confirmation it returns `ilink_bot_id`,
 *   `bot_token`, `baseurl`, and `ilink_user_id`.
 */
interface QrPollResponse {
  ret?: number;
  status?: string;
  qrcode?: string;
  qrcode_img_content?: string;
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  redirect_host?: string;
  message?: string;
}

/**
 * In-memory record for active login session tracking.
 */
interface ActiveLogin {
  sessionKey: string;
  /** QR session id returned by get_bot_qrcode — the key for status polls. */
  qrcode: string;
  /** Scannable QR image URL. */
  qrcodeUrl: string;
  startedAt: number;
  expiresAt: number;
  /** Number of QR refreshes performed (bounded by MAX_REFRESH_ATTEMPTS). */
  refreshCount: number;
  /** Verification code collected from the user, sent with the next poll. */
  pendingVerifyCode?: string;
  /** Polling base URL; may be redirected (scaned_but_redirect). */
  currentApiBaseUrl?: string;
}

// ---------------------------------------------------------------------------
// Active login tracking (TTL: 5 minutes)
// ---------------------------------------------------------------------------

/** Map of session keys to active login records. */
const activeLogins = new Map<string, ActiveLogin>();

/**
 * Remove login records that have exceeded the TTL.
 * Called implicitly before each new login session is registered.
 */
function purgeExpiredLogins(): void {
  const now = Date.now();
  for (const [key, login] of activeLogins) {
    if (now >= login.expiresAt) {
      activeLogins.delete(key);
      logger.debug('Purged expired login session', {
        sessionKey: redactToken(login.sessionKey),
      });
    }
  }
}

/**
 * Register a new active login session.
 *
 * @param sessionKey - The session key to track.
 * @param qrcode     - QR session id from get_bot_qrcode.
 * @param qrcodeUrl  - Scannable QR image URL.
 */
function trackLogin(sessionKey: string, qrcode: string, qrcodeUrl: string): void {
  purgeExpiredLogins();
  const now = Date.now();
  activeLogins.set(sessionKey, {
    sessionKey,
    qrcode,
    qrcodeUrl,
    startedAt: now,
    expiresAt: now + LOGIN_TTL_MS,
    refreshCount: 0,
  });
}

/**
 * Return a copy of the active logins map (for introspection / tests).
 */
export function getActiveLogins(): ReadonlyMap<string, ActiveLogin> {
  return new Map(activeLogins);
}

/** Promise-based sleep. */
function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

// ---------------------------------------------------------------------------
// QR code display
// ---------------------------------------------------------------------------

/**
 * Display a QR code in the terminal.
 *
 * Attempts to use the `qrcode-terminal` module for inline rendering and
 * falls back to printing the URL when the optional dependency is absent.
 *
 * @param qrcodeUrl - The URL to encode as a QR code.
 */
export async function displayQRCode(qrcodeUrl: string): Promise<void> {
  try {
    // Dynamic import: qrcode-terminal is an optional peer dependency not
    // guaranteed at install time, so a static import would fail at module
    // load on systems that lack it.
    // Non-literal dynamic import: qrcode-terminal is optional.
    const qrModule: string = 'qrcode-terminal';
    const mod: { default: { generate: (text: string, opts?: { small?: boolean }) => void } } = await import(qrModule) as unknown as { default: { generate: (text: string, opts?: { small?: boolean }) => void } };
    mod.default.generate(qrcodeUrl, { small: true });
  } catch {
    // qrcode-terminal not installed — print the URL for manual scanning
    console.log(`\nScan the following URL to log in to WeChat:\n${qrcodeUrl}\n`);
  }
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a fresh QR code (used for the initial login and expiry refresh).
 *
 * @param apiBaseUrl - The iLink API base URL.
 * @param botType    - The bot type identifier.
 * @param localTokens - Optional account tokens for session reuse. Only the
 *                      pinned account's token may be submitted; a fresh
 *                      refresh submits none.
 * @returns The parsed get_bot_qrcode response.
 */
async function fetchQrCode(
  apiBaseUrl: string,
  botType: string,
  localTokens: string[],
): Promise<QrPollResponse> {
  const raw = await apiPostFetch({
    baseUrl: apiBaseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    body: { local_token_list: localTokens },
    label: 'fetchQRCode',
  });
  return JSON.parse(raw) as QrPollResponse;
}

/**
 * Refresh an expired QR code, keeping the same session key.
 *
 * @param apiBaseUrl - The iLink API base URL.
 * @param sessionKey - The existing session key.
 * @param botType    - The bot type identifier.
 * @returns The parsed response containing a new QR code.
 */
async function refreshQrCode(
  apiBaseUrl: string,
  sessionKey: string,
  botType: string,
): Promise<QrPollResponse> {
  // Security: a refresh never re-submits stored account tokens (see the
  // module header). The new QR binds a fresh session on scan.
  const data = await fetchQrCode(apiBaseUrl, botType, []);
  if (data.qrcode) {
    logger.info('Refreshed QR code', {
      sessionKey: redactToken(sessionKey),
      hasQrcode: true,
    });
  }
  return data;
}

// ---------------------------------------------------------------------------
// CLI verify code reader
// ---------------------------------------------------------------------------

/**
 * Read a verification code from the terminal (stdin).
 *
 * Provides a simple CLI prompt for use as a {@link WaitForWeixinLoginOptions.verifyCodeProvider}
 * when no interactive UI layer is available.
 *
 * @returns The trimmed verification code entered by the user.
 */
export function readVerifyCodeFromStdin(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const { promise, resolve } = Promise.withResolvers<string>();
  rl.question('Enter verification code from WeChat: ', (answer) => {
    rl.close();
    resolve(answer.trim());
  });
  return promise;
}

// ---------------------------------------------------------------------------
// Start QR login
// ---------------------------------------------------------------------------

/**
 * Start a WeChat QR code login flow for the iLink ClawBot.
 *
 * Fetches a QR code from the iLink API. Only the token of the account being
 * logged in (pinned via `accountId`) may be submitted for session reuse;
 * historical tokens from other accounts are never re-submitted. Use the
 * returned `sessionKey` with {@link waitForWeixinLogin} to poll for completion.
 *
 * @param opts             - Login options.
 * @param opts.apiBaseUrl  - iLink API base URL.
 * @param opts.verbose     - Enable verbose logging to the iLink logger.
 * @param opts.force       - Skip collecting the current account's local token.
 * @param opts.accountId   - Pin the account whose token may be submitted.
 * @param opts.botType     - Bot type (defaults to `DEFAULT_ILINK_BOT_TYPE`).
 * @param opts.stateRoot   - Optional workspace-scoped state root; the pinned
 *                           account's token is read from this root instead of
 *                           the shared state dir, so a QR login never ships a
 *                           sibling workspace's stored token.
 * @returns The QR code URL, session key, and any API message.
 */
export async function startWeixinLoginWithQr(
  opts: {
    verbose?: boolean;
    force?: boolean;
    accountId?: string;
    apiBaseUrl: string;
    botType?: string;
    stateRoot?: string;
  },
): Promise<WeixinQrStartResult> {
  const baseUrl = opts.apiBaseUrl;
  const botType = opts.botType ?? DEFAULT_ILINK_BOT_TYPE;

  // Security: never re-submit historical tokens on a QR login. Re-submitting
  // up to 10 previously-stored account tokens lets the new session silently
  // re-validate credentials the operator may have forgotten or rotated, and
  // cross-links accounts that were never part of this login. Only the token of
  // the account currently being logged in is submitted (when one is pinned via
  // `accountId`); fresh logins submit none.
  const localTokens: string[] = [];
  if (!opts.force && opts.accountId) {
    const account = loadWeixinAccount(opts.accountId, opts.stateRoot);
    if (account?.token) {
      localTokens.push(account.token);
    }
  }

  if (opts.verbose) {
    logger.info('Fetching QR code', {
      botType,
      localTokenCount: localTokens.length,
    });
  }

  const data = await fetchQrCode(baseUrl, botType, localTokens);

  if (!data.qrcode || !data.qrcode_img_content) {
    const message = data.message ?? 'Failed to fetch QR code from iLink API';
    if (opts.verbose) {
      logger.warn('QR code fetch failed', { message, ret: data.ret });
    }
    return { qrcodeUrl: undefined, message, sessionKey: randomUUID() };
  }

  const sessionKey = opts.accountId ?? randomUUID();
  trackLogin(sessionKey, data.qrcode, data.qrcode_img_content);

  const result: WeixinQrStartResult = {
    qrcodeUrl: data.qrcode_img_content,
    message: data.message ?? '',
    sessionKey,
  };

  if (opts.verbose) {
    logger.info('QR code fetched', {
      sessionKey: redactToken(sessionKey),
      hasUrl: !!data.qrcode_img_content,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Wait for login
// ---------------------------------------------------------------------------

export interface WaitForWeixinLoginOptions {
  /**
   * Maximum time in milliseconds to wait for the login to complete.
   * @default 120000
   */
  timeoutMs?: number;

  /** Enable verbose logging. */
  verbose?: boolean;

  /** Session key returned by {@link startWeixinLoginWithQr}. */
  sessionKey: string;

  /** iLink API base URL (the original URL; may be redirected during polling). */
  apiBaseUrl: string;

  /** Bot type (defaults to `DEFAULT_ILINK_BOT_TYPE`). */
  botType?: string;

  /**
   * Async callback to obtain a verification code when the API
   * reports `need_verifycode`. Leave unset to skip verify-code
   * submission (the poll will continue, likely cycling back to
   * `need_verifycode`). Resolving with an empty string cancels the flow.
   */
  verifyCodeProvider?: () => Promise<string>;

  /**
   * Callback invoked on each status transition. Receives the raw status
   * string (`"wait"`, `"scaned"`, `"need_verifycode"`, `"expired"`,
   * `"confirmed"`, etc.). For `"expired"` the second argument carries the
   * refreshed QR image URL so the UI can re-render it.
   */
  onStatus?: (status: string, extra?: { qrcodeUrl?: string }) => void;
}

/**
 * Wait for a WeChat login to complete by polling the QR code status.
 *
 * Long-polls the `ilink/bot/get_qrcode_status` endpoint (GET, keyed by the
 * `qrcode` query parameter — NOT a POST with a session_key body) and handles
 * the full state machine: QR wait, scan detected, verification code prompts,
 * expired QR refresh (up to 3 attempts), redirects, and confirmed login
 * credentials.
 *
 * @param opts - Wait options.
 * @returns The login result with credentials on success.
 */
export async function waitForWeixinLogin(
  opts: WaitForWeixinLoginOptions,
): Promise<WeixinQrWaitResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const botType = opts.botType ?? DEFAULT_ILINK_BOT_TYPE;
  const startTime = Date.now();

  const activeLogin = activeLogins.get(opts.sessionKey);
  if (!activeLogin) {
    logger.warn('waitForWeixinLogin: no active login session', {
      sessionKey: redactToken(opts.sessionKey),
    });
    return { connected: false, message: 'No active login session — start the login first.' };
  }

  let apiBaseUrl = opts.apiBaseUrl;
  let refreshCount = activeLogin.refreshCount;

  /**
   * Log and emit a status update.
   */
  const emitStatus = (status: string, extra?: { qrcodeUrl?: string }): void => {
    if (opts.verbose) {
      logger.info(`QR status: ${status}`, {
        sessionKey: redactToken(opts.sessionKey),
        ...extra,
      });
    }
    opts.onStatus?.(status, extra);
  };

  while (Date.now() - startTime < timeoutMs) {
    const elapsed = Date.now() - startTime;
    const remaining = timeoutMs - elapsed;

    try {
      // Long-poll the status endpoint, keyed by the QR id (not a session key).
      // A client-side timeout is the normal long-poll outcome — treat it as
      // "wait" and poll again.
      let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(activeLogin.qrcode)}`;
      if (activeLogin.pendingVerifyCode) {
        endpoint += `&verify_code=${encodeURIComponent(activeLogin.pendingVerifyCode)}`;
      }
      const raw = await apiGetFetch({
        baseUrl: apiBaseUrl,
        endpoint,
        timeoutMs: Math.min(MAX_POLL_TIMEOUT_MS, Math.max(5_000, remaining)),
        label: 'pollQRStatus',
      });

      let data: QrPollResponse;
      try {
        data = JSON.parse(raw);
      } catch {
        // Non-JSON body — treat as transient and keep polling.
        emitStatus('wait');
        await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1_000, remaining)));
        continue;
      }
      const status = data.status;

      switch (status) {
        // ----- Pending states: keep polling -----
        case 'wait': {
          emitStatus('wait');
          await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1_000, remaining)));
          continue;
        }

        case 'scaned': {
          // A submitted verify code that got this far was accepted.
          activeLogin.pendingVerifyCode = undefined;
          emitStatus('scaned');
          await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1_000, remaining)));
          continue;
        }

        // ----- Verification code required -----
        case 'need_verifycode': {
          emitStatus('need_verifycode');
          if (opts.verifyCodeProvider) {
            const code = await opts.verifyCodeProvider();
            if (code) {
              activeLogin.pendingVerifyCode = code;
              // Poll again immediately with the code attached.
              continue;
            }
            // Empty code — the flow was cancelled by the caller.
            activeLogins.delete(opts.sessionKey);
            return { connected: false, message: 'Login cancelled' };
          }
          await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1_000, remaining)));
          continue;
        }

        // ----- QR code expired — refresh if under limit -----
        case 'expired': {
          refreshCount++;
          if (refreshCount > MAX_REFRESH_ATTEMPTS) {
            emitStatus('expired');
            activeLogins.delete(opts.sessionKey);
            return {
              connected: false,
              message: `QR code expired after ${MAX_REFRESH_ATTEMPTS} refresh attempts`,
            };
          }
          const refreshed = await refreshQrCode(apiBaseUrl, opts.sessionKey, botType);
          if (refreshed.qrcode && refreshed.qrcode_img_content) {
            activeLogin.qrcode = refreshed.qrcode;
            activeLogin.qrcodeUrl = refreshed.qrcode_img_content;
            activeLogin.refreshCount = refreshCount;
            await displayQRCode(refreshed.qrcode_img_content);
            emitStatus('expired', { qrcodeUrl: refreshed.qrcode_img_content });
          } else {
            emitStatus('expired');
          }
          continue;
        }

        // ----- Too many wrong verify-code attempts -----
        case 'verify_code_blocked': {
          emitStatus('verify_code_blocked');
          activeLogin.pendingVerifyCode = undefined;
          refreshCount++;
          if (refreshCount > MAX_REFRESH_ATTEMPTS) {
            activeLogins.delete(opts.sessionKey);
            return {
              connected: false,
              message: data.message ?? 'Verification code attempt blocked',
            };
          }
          const refreshed = await refreshQrCode(apiBaseUrl, opts.sessionKey, botType);
          if (refreshed.qrcode && refreshed.qrcode_img_content) {
            activeLogin.qrcode = refreshed.qrcode;
            activeLogin.qrcodeUrl = refreshed.qrcode_img_content;
            activeLogin.refreshCount = refreshCount;
            await displayQRCode(refreshed.qrcode_img_content);
            emitStatus('expired', { qrcodeUrl: refreshed.qrcode_img_content });
          }
          continue;
        }

        // ----- Already bound to another session -----
        case 'binded_redirect': {
          emitStatus('binded_redirect');
          activeLogins.delete(opts.sessionKey);
          return {
            connected: true,
            alreadyConnected: true,
            botToken: data.bot_token,
            accountId: data.ilink_bot_id,
            baseUrl: data.baseurl,
            userId: data.ilink_user_id,
            message: data.message ?? 'Already connected',
          };
        }

        // ----- Scanned on phone — redirect polling to new host -----
        case 'scaned_but_redirect': {
          emitStatus('scaned_but_redirect');
          if (data.redirect_host) {
            apiBaseUrl = `https://${data.redirect_host}`;
            activeLogin.currentApiBaseUrl = apiBaseUrl;
            if (opts.verbose) {
              logger.info('Redirected polling to new host', {
                newBaseUrl: apiBaseUrl,
              });
            }
          }
          await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1_000, remaining)));
          continue;
        }

        // ----- Login confirmed — return credentials -----
        case 'confirmed': {
          if (!data.ilink_bot_id) {
            activeLogins.delete(opts.sessionKey);
            return { connected: false, message: 'Login confirmed but ilink_bot_id missing' };
          }
          emitStatus('confirmed');
          activeLogins.delete(opts.sessionKey);
          return {
            connected: true,
            botToken: data.bot_token,
            accountId: data.ilink_bot_id,
            baseUrl: data.baseurl ?? apiBaseUrl,
            userId: data.ilink_user_id,
            message: data.message ?? 'Login confirmed',
          };
        }

        // ----- Unknown status — log and keep polling -----
        default: {
          emitStatus(`unknown:${status}`);
          await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1_000, remaining)));
          continue;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (opts.verbose) {
        logger.warn('QR poll error', { error: message });
      }
      // Brief backoff before retrying after an error (network blips, 5xx).
      await sleep(Math.min(3_000, Math.max(1_000, remaining)));
    }
  }

  // Timeout reached without confirmation
  activeLogins.delete(opts.sessionKey);
  return {
    connected: false,
    message: `Login timed out after ${timeoutMs}ms`,
  };
}
