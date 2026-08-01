/**
 * Callback server token gate (audit M-2).
 *
 * The pi-agent-server exposes a loopback-only HTTP callback server so the
 * session MCP server can execute call_llm / spawn-session with the user's real
 * credentials. Without a secret, ANY local process could POST to that server
 * and burn the user's LLM quota. This module implements the per-process token
 * check; it lives outside index.ts so the security rules are unit-testable
 * (index.ts executes main() at import time).
 */

import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** HTTP header carrying the per-process callback token. */
export const CALLBACK_TOKEN_HEADER = 'x-craft-callback-token';

/**
 * Constant-time comparison of a request's token header against the expected
 * per-process token. Node may deliver repeated headers as string[] — in that
 * case only the first value is considered.
 */
export function isValidCallbackToken(
  headerValue: string | string[] | undefined,
  expectedToken: string,
): boolean {
  const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!provided || provided.length !== expectedToken.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expectedToken));
}

/**
 * Request guard for the local callback server: any request without a valid
 * callback token is rejected with 401. Returns true when the request is
 * authorized (the caller should continue handling it); false when a 401
 * response has already been written.
 */
export function guardCallbackToken(
  req: IncomingMessage,
  res: ServerResponse,
  expectedToken: string,
): boolean {
  if (isValidCallbackToken(req.headers[CALLBACK_TOKEN_HEADER], expectedToken)) {
    return true;
  }
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: `Unauthorized: missing or invalid ${CALLBACK_TOKEN_HEADER} header` }));
  return false;
}
