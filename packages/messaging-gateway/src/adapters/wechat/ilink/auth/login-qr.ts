// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import { randomUUID } from 'node:crypto';
import * as readline from 'node:readline';
import { apiGetFetch, apiPostFetch } from '../api/api';
import { loadWeixinAccount, listIndexedWeixinAccountIds } from './accounts';
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
const POLL_INTERVAL_MS = 2_000;

/** Maximum number of QR code refresh attempts after expiry. */
const MAX_REFRESH_ATTEMPTS = 3;

/** Default timeout for the wait loop (2 minutes). */
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;

/** Maximum per-poll timeout in milliseconds. */
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
  /** The WeChat account identifier. */
  accountId?: string;
  /** Base URL for subsequent API calls (may differ from the original). */
  baseUrl?: string;
  /** The WeChat user identifier. */
  userId?: string;
  /** Human-readable status message. */
  message: string;
}

/**
 * Raw response from the QR code status polling endpoint.
 */
interface QrPollResponse {
  status: string;
  qrcode_url?: string;
  session_key?: string;
  bot_token?: string;
  account_id?: string;
  user_id?: string;
  base_url?: string;
  redirect_url?: string;
  verify_code_token?: string;
  message?: string;
}

/**
 * In-memory record for active login session tracking.
 */
interface ActiveLogin {
  sessionKey: string;
  startedAt: number;
  expiresAt: number;
  refreshCount: number;
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
 */
function trackLogin(sessionKey: string): void {
  purgeExpiredLogins();
  const now = Date.now();
  activeLogins.set(sessionKey, {
    sessionKey,
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
 * Submit a verification code during the `need_verifycode` status phase.
 *
 * @param apiBaseUrl  - The iLink API base URL.
 * @param sessionKey  - The current login session key.
 * @param verifyCode  - The verification code provided by the user.
 * @returns The parsed response from the submission endpoint.
 */
async function submitVerifyCode(
  apiBaseUrl: string,
  sessionKey: string,
  verifyCode: string,
): Promise<QrPollResponse> {
  const raw = await apiPostFetch({
    baseUrl: apiBaseUrl,
    endpoint: 'ilink/bot/submit_verify_code',
    body: { session_key: sessionKey, verify_code: verifyCode },
  });
  return JSON.parse(raw) as QrPollResponse;
}

/**
 * Refresh an expired QR code, keeping the same session key.
 *
 * @param apiBaseUrl - The iLink API base URL.
 * @param sessionKey - The existing session key.
 * @param botType    - The bot type identifier.
 * @returns The parsed response containing a new QR code URL.
 */
async function refreshQrCode(
  apiBaseUrl: string,
  sessionKey: string,
  botType: string,
): Promise<QrPollResponse> {
  const raw = await apiPostFetch({
    baseUrl: apiBaseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${botType}`,
    body: { session_key: sessionKey },
  });
  return JSON.parse(raw) as QrPollResponse;
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
 * Fetches a QR code from the iLink API and optionally collects up to 10
 * local account tokens for session reuse.  Use the returned `sessionKey`
 * with {@link waitForWeixinLogin} to poll for completion.
 *
 * @param opts             - Login options.
 * @param opts.apiBaseUrl  - iLink API base URL.
 * @param opts.verbose     - Enable verbose logging to the iLink logger.
 * @param opts.force       - Skip collecting local account tokens.
 * @param opts.accountId   - Restrict token collection to a specific account.
 * @param opts.botType     - Bot type (defaults to `DEFAULT_ILINK_BOT_TYPE`).
 * @returns The QR code URL, session key, and any API message.
 */
export async function startWeixinLoginWithQr(
  opts: {
    verbose?: boolean;
    force?: boolean;
    accountId?: string;
    apiBaseUrl: string;
    botType?: string;
  },
): Promise<WeixinQrStartResult> {
  const baseUrl = opts.apiBaseUrl;
  const botType = opts.botType ?? DEFAULT_ILINK_BOT_TYPE;

  // Collect up to 10 local tokens for session reuse
  const localTokens: string[] = [];
  if (!opts.force) {
    const accountIds = opts.accountId
      ? [opts.accountId]
      : listIndexedWeixinAccountIds();

    for (const id of accountIds) {
      if (localTokens.length >= 10) break;
      const account = loadWeixinAccount(id);
      if (account?.token) {
        localTokens.push(account.token);
      }
    }
  }

  if (opts.verbose) {
    logger.info('Fetching QR code', {
      botType,
      localTokenCount: localTokens.length,
    });
  }

  const raw = await apiPostFetch({
    baseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${botType}`,
    body: { local_token_list: localTokens },
  });

  const data: QrPollResponse = JSON.parse(raw);
  const sessionKey = data.session_key ?? randomUUID();

  trackLogin(sessionKey);

  const result: WeixinQrStartResult = {
    qrcodeUrl: data.qrcode_url,
    message: data.message ?? '',
    sessionKey,
  };

  if (opts.verbose) {
    logger.info('QR code fetched', {
      sessionKey: redactToken(sessionKey),
      hasUrl: !!data.qrcode_url,
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
   * reports `need_verifycode`.  Leave unset to skip verify-code
   * submission (the poll will continue, likely cycling back to
   * `need_verifycode`).
   */
  verifyCodeProvider?: () => Promise<string>;

  /**
   * Callback invoked on each status transition.
   * Receives the raw status string (`"wait"`, `"scaned"`,
   * `"need_verifycode"`, `"expired"`, `"confirmed"`, etc.).
   */
  onStatus?: (status: string) => void;
}

/**
 * Wait for a WeChat login to complete by polling the QR code status.
 *
 * Long-polls the `ilink/bot/get_qrcode_status` endpoint and handles
 * the full state machine: QR wait, scan detected, verification code
 * prompts, expired QR refresh (up to 3 attempts), redirects, and
 * confirmed login credentials.
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

  let apiBaseUrl = opts.apiBaseUrl;
  let refreshCount = 0;

  // Ensure this session is tracked
  if (!activeLogins.has(opts.sessionKey)) {
    trackLogin(opts.sessionKey);
  }

  /**
   * Log and emit a status update.
   */
  const emitStatus = (status: string, extra?: Record<string, unknown>): void => {
    if (opts.verbose) {
      logger.info(`QR status: ${status}`, {
        sessionKey: redactToken(opts.sessionKey),
        ...extra,
      });
    }
    opts.onStatus?.(status);
  };

  while (Date.now() - startTime < timeoutMs) {
    const elapsed = Date.now() - startTime;
    const remaining = timeoutMs - elapsed;

    try {
      const raw = await apiPostFetch({
        baseUrl: apiBaseUrl,
        endpoint: 'ilink/bot/get_qrcode_status',
        body: { session_key: opts.sessionKey },
        timeoutMs: Math.min(MAX_POLL_TIMEOUT_MS, Math.max(5_000, remaining)),
      });

      const data: QrPollResponse = JSON.parse(raw);
      const status = data.status;

      switch (status) {
        // ----- Pending states: keep polling -----
        case 'wait': {
          emitStatus('wait');
          await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1_000, remaining)));
          continue;
        }

        case 'scaned': {
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
              await submitVerifyCode(apiBaseUrl, opts.sessionKey, code);
            }
          }
          await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1_000, remaining)));
          continue;
        }

        // ----- QR code expired — refresh if under limit -----
        case 'expired': {
          refreshCount++;
          if (refreshCount > MAX_REFRESH_ATTEMPTS) {
            emitStatus('expired', { refreshCount });
            return {
              connected: false,
              message: `QR code expired after ${MAX_REFRESH_ATTEMPTS} refresh attempts`,
            };
          }
          emitStatus('expired', { refreshCount });
          const refreshed = await refreshQrCode(apiBaseUrl, opts.sessionKey, botType);
          if (refreshed.qrcode_url) {
            await displayQRCode(refreshed.qrcode_url);
          }
          continue;
        }

        // ----- Too many wrong verify-code attempts -----
        case 'verify_code_blocked': {
          emitStatus('verify_code_blocked');
          return {
            connected: false,
            message: data.message ?? 'Verification code attempt blocked',
          };
        }

        // ----- Already bound to another session -----
        case 'binded_redirect': {
          emitStatus('binded_redirect');
          return {
            connected: true,
            alreadyConnected: true,
            botToken: data.bot_token,
            accountId: data.account_id,
            baseUrl: data.base_url,
            userId: data.user_id,
            message: data.message ?? 'Already connected',
          };
        }

        // ----- Scanned on phone — redirect polling to new host -----
        case 'scaned_but_redirect': {
          emitStatus('scaned_but_redirect');
          if (data.redirect_url) {
            apiBaseUrl = data.redirect_url;
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
          emitStatus('confirmed');
          return {
            connected: true,
            botToken: data.bot_token,
            accountId: data.account_id,
            baseUrl: data.base_url ?? apiBaseUrl,
            userId: data.user_id,
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
      // Brief backoff before retrying after an error
      await sleep(Math.min(3_000, Math.max(1_000, remaining)));
    }
  }

  // Timeout reached without confirmation
  return {
    connected: false,
    message: `Login timed out after ${timeoutMs}ms`,
  };
}
