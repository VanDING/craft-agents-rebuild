// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

/** iLink API error code indicating the session has expired and needs re-auth. */
export const SESSION_EXPIRED_ERRCODE = -14;

/** Pause duration: 60 minutes in milliseconds. */
const PAUSE_DURATION_MS = 60 * 60 * 1000;

/** Per-account pause start timestamps (ms since epoch). */
const pausedUntil = new Map<string, number>();

/**
 * Pauses API calls for the given account for 60 minutes.
 * Call this when a SESSION_EXPIRED_ERRCODE (-14) is received.
 */
export function pauseSession(accountId: string): void {
  pausedUntil.set(accountId, Date.now());
}

/**
 * Returns `true` if the account's API calls are currently paused.
 */
export function isSessionPaused(accountId: string): boolean {
  const start = pausedUntil.get(accountId);
  if (start === undefined) return false;
  if (Date.now() - start >= PAUSE_DURATION_MS) {
    pausedUntil.delete(accountId);
    return false;
  }
  return true;
}

/**
 * Returns the number of milliseconds remaining in the pause for the given
 * account, or 0 if the account is not currently paused.
 */
export function getRemainingPauseMs(accountId: string): number {
  const start = pausedUntil.get(accountId);
  if (start === undefined) return 0;
  const elapsed = Date.now() - start;
  if (elapsed >= PAUSE_DURATION_MS) {
    pausedUntil.delete(accountId);
    return 0;
  }
  return PAUSE_DURATION_MS - elapsed;
}

/**
 * Throws an `Error` if the account's API calls are currently paused.
 * Use this as a guard before making iLink API requests.
 */
export function assertSessionActive(accountId: string): void {
  if (isSessionPaused(accountId)) {
    const remaining = PAUSE_DURATION_MS - (Date.now() - (pausedUntil.get(accountId) ?? 0));
    const minutes = Math.ceil(remaining / 60_000);
    throw new Error(
      `Session for account "${accountId}" is paused for session expiry (${minutes} min remaining). Call login() to re-authenticate.`,
    );
  }
}

/**
 * Resets all pause state. Intended for test teardown only.
 */
export function _resetForTest(): void {
  pausedUntil.clear();
}
