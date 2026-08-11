// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.
//
// Adapted from OpenClaw's channelRuntime / processOneMessage long-poll loop.
// The original code couples polling with channel lifecycle management.
// This version replaces that coupling with an injected onMessage callback
// and exposes pause / retry handling to the caller.

import { getUpdates } from '../api/api';
import {
  SESSION_EXPIRED_ERRCODE,
  getRemainingPauseMs,
  pauseSession,
} from '../api/session-guard';
import {
  getSyncBufFilePath,
  loadGetUpdatesBuf,
  saveGetUpdatesBuf,
} from '../storage/sync-buf';
import { logger } from '../util/logger';
import type { Logger } from '../util/logger';
import { redactBody } from '../util/redact';
import type { GetUpdatesResp, WeixinMessage } from '../api/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Consecutive redeliveries of the same failed batch before the ack-based
 * cursor is forced forward. Without this, a single persistently-failing
 * message (e.g. an outbound reply the server rejects) wedges the whole
 * channel: the cursor never advances and every newer message sits behind
 * the poison one forever.
 */
export const MAX_FAILED_BATCH_REDELIVERIES = 5;

export interface MonitorWeixinOpts {
  /** iLink provider base URL. */
  baseUrl: string;
  /** Optional bearer token for authenticated requests. */
  token?: string;
  /** Account identifier used for state isolation and session tracking. */
  accountId: string;
  /**
   * Optional workspace-scoped state root. When provided, the sync-buf cursor
   * is persisted under this root instead of the shared state dir, so two
   * workspaces binding the same account never share an offset file.
   */
  stateRoot?: string;
  /** Callback invoked for each received message. */
  onMessage: (msg: WeixinMessage) => Promise<void> | void;
  /** When signalled the poll loop exits after the current iteration. */
  abortSignal?: AbortSignal;
  /**
   * Default long-poll timeout in milliseconds.
   * The server may advertise a different value via
   * {@link GetUpdatesResp.longpolling_timeout_ms}, which takes precedence for
   * subsequent requests.
   */
  longPollTimeoutMs?: number;
  /**
   * Optional callback invoked after each poll attempt with the full API
   * response (including error responses).  Useful for telemetry or external
   * monitoring.
   */
  onPoll?: (resp: GetUpdatesResp) => void;
  /**
   * Invoked when the server reports the bot session as expired
   * (`ret`/`errcode` = -14). The host can surface a "re-scan the QR code"
   * state to the user; the monitor pauses polling for 60 minutes.
   */
  onSessionExpired?: (accountId: string) => void;
  /**
   * Simple log / error functions provided by the runtime (e.g. OpenClaw
   * framework).  When present these take precedence over the project-wide
   * {@link Logger} singleton.
   */
  runtime?: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Promise-based delay that short-circuits when the provided signal is aborted.
 *
 * @param ms     - Sleep duration in milliseconds.
 * @param signal - Optional abort signal that cancels the sleep early.
 * @throws `DOMException` with name `'AbortError'` when cancelled via signal.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort);
  });
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

/**
 * Long-poll message monitoring loop for the iLink WeChat provider.
 *
 * Repeatedly calls {@link getUpdates} to receive new messages, handling
 * session expiry (ret = -14) with a 60-minute pause, transient API errors with
 * exponential-like backoff (2 s / 30 s after 3 consecutive failures), and
 * buffer persistence across restarts.
 *
 * Each received message is forwarded to the
 * {@link MonitorWeixinOpts.onMessage} callback.  Individual message processing
 * errors are logged but do not interrupt the loop.
 *
 * The loop exits cleanly when {@link MonitorWeixinOpts.abortSignal} is
 * signalled or the current iteration is interrupted by an abort during a pause
 * or backoff delay.
 *
 * @param opts - Configuration and callbacks.
 */
export async function monitorWeixinProvider(
  opts: MonitorWeixinOpts,
): Promise<void> {
  const {
    baseUrl,
    token,
    accountId,
    onMessage,
    abortSignal,
    longPollTimeoutMs,
    onPoll,
    onSessionExpired,
    runtime,
  } = opts;

  // ---- Logger bridge ----
  // When the caller provides runtime log/error functions (e.g. from the
  // OpenClaw framework) they are used instead of the project-wide logger.
  const info =
    runtime?.log ??
    ((msg: string) => {
      logger.info(msg);
    });
  const warn =
    runtime?.log ??
    ((msg: string) => {
      logger.warn(msg);
    });
  const err =
    runtime?.error ??
    ((msg: string) => {
      logger.error(msg);
    });

  // ---- Persisted state ----
  const bufFilePath = getSyncBufFilePath(accountId, opts.stateRoot);
  let buf = loadGetUpdatesBuf(bufFilePath) ?? '';

  // Server-advertised long-poll timeout.  Starts from the caller's default and
  // is updated whenever the server returns a non-zero value.
  let adjustedTimeout = longPollTimeoutMs;

  // Consecutive-error counter for backoff.
  let consecutiveErrors = 0;

  // Failed-batch redelivery tracking for the ack-cursor escape hatch.
  let lastFailedBuf: string | undefined;
  let failedBatchCount = 0;

  // ---- Poll loop ----
  while (!abortSignal?.aborted) {
    // -----------------------------------------------------------------------
    // Session-pause guard
    // -----------------------------------------------------------------------
    const pauseRemaining = getRemainingPauseMs(accountId);
    if (pauseRemaining > 0) {
      info(
        `session paused for account "${accountId}", waiting ${Math.ceil(pauseRemaining / 1000)} s`,
      );
      try {
        await sleep(pauseRemaining, abortSignal);
      } catch {
        break; // aborted
      }
      continue;
    }

    // -----------------------------------------------------------------------
    // Poll
    // -----------------------------------------------------------------------
    try {
      const resp: GetUpdatesResp = await getUpdates({
        baseUrl,
        token,
        get_updates_buf: buf,
        longpolling_timeout_ms: adjustedTimeout,
        abortSignal,
      });

      consecutiveErrors = 0;

      // Apply server-suggested timeout for the next request.
      if (resp.longpolling_timeout_ms > 0) {
        adjustedTimeout = resp.longpolling_timeout_ms;
      }

      // Notify observer (e.g. telemetry, external monitoring).
      onPoll?.(resp);

      // -------------------------------------------------------------------
      // Session expired
      // -------------------------------------------------------------------
      // The live server reports the expired-session code (-14) via `errcode`
      // (with `ret` absent); older builds used `ret`. Check both, otherwise
      // a dead session loops forever with backoff instead of pausing.
      if (
        resp.ret === SESSION_EXPIRED_ERRCODE ||
        resp.errcode === SESSION_EXPIRED_ERRCODE
      ) {
        warn(
          `session expired for account "${accountId}" (ret=${resp.ret} errcode=${resp.errcode}), pausing 60 min`,
        );
        pauseSession(accountId);
        opts.onSessionExpired?.(accountId);
        // The next loop iteration will hit the pause guard above.
        continue;
      }

      // -------------------------------------------------------------------
      // Other API-level errors
      // -------------------------------------------------------------------
      // A successful response may omit `ret`/`errcode` entirely — the live
      // server returns `{msgs, sync_buf, get_updates_buf}` with no `ret`.
      // Only DEFINED non-zero codes are errors; `ret !== 0` on an undefined
      // field classified every successful poll as an error and discarded
      // every message batch.
      const isApiError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);
      if (isApiError) {
        consecutiveErrors++;
        const delay = consecutiveErrors >= 3 ? 30_000 : 2_000;
        warn(
          `API error for account "${accountId}": ret=${resp.ret} errcode=${resp.errcode} errmsg=${redactBody(resp.errmsg)}, backoff ${delay} ms`,
        );
        try {
          await sleep(delay, abortSignal);
        } catch {
          break; // aborted
        }
        continue;
      }

      // -------------------------------------------------------------------
      // Success
      // -------------------------------------------------------------------

      // Dispatch each message to the consumer.
      const msgs = resp.msgs ?? [];
      let allDispatched = true;
      if (msgs.length > 0) {
        info(
          `received ${msgs.length} message(s) for account "${accountId}"`,
        );
        for (const msg of msgs) {
          try {
            await onMessage(msg);
          } catch (cause) {
            allDispatched = false;
            err(
              `error processing message ${msg.message_id} for account "${accountId}": ${cause instanceof Error ? cause.message : String(cause)}`,
            );
          }
        }
      }

      // Advance the cursor only after the whole batch dispatched cleanly
      // (ack-based cursor). Persisting before dispatch could commit the new
      // offset while messages are still in flight, silently dropping them if
      // the process dies mid-batch. On any dispatch failure the buffer is
      // left unchanged so the next poll redelivers the failed batch —
      // duplicates are tolerated upstream via message ids.
      if (resp.get_updates_buf && allDispatched) {
        buf = resp.get_updates_buf;
        saveGetUpdatesBuf(bufFilePath, buf, opts.stateRoot);
        lastFailedBuf = undefined;
        failedBatchCount = 0;
      } else if (resp.get_updates_buf && !allDispatched) {
        // Escape hatch: the same batch failing forever must not starve every
        // newer message. After MAX_FAILED_BATCH_REDELIVERIES consecutive
        // identical failed batches, force the cursor forward — the poison
        // message is dropped (at-least-once degrades to at-most-once for
        // that batch) and the channel unblocks.
        if (resp.get_updates_buf === lastFailedBuf) {
          failedBatchCount += 1;
        } else {
          lastFailedBuf = resp.get_updates_buf;
          failedBatchCount = 1;
        }
        if (failedBatchCount >= MAX_FAILED_BATCH_REDELIVERIES) {
          err(
            `batch failed ${failedBatchCount} consecutive redeliveries for account "${accountId}"; advancing sync cursor to unblock the channel — the failed messages are dropped`,
          );
          buf = resp.get_updates_buf;
          saveGetUpdatesBuf(bufFilePath, buf, opts.stateRoot);
          lastFailedBuf = undefined;
          failedBatchCount = 0;
        }
      }
    } catch (cause) {
      // Network errors or unexpected failures from getUpdates.
      consecutiveErrors++;
      const delay = consecutiveErrors >= 3 ? 30_000 : 2_000;
      err(
        `poll error for account "${accountId}": ${cause instanceof Error ? cause.message : String(cause)}, backoff ${delay} ms`,
      );
      try {
        await sleep(delay, abortSignal);
      } catch {
        break; // aborted
      }
    }
  }
}
