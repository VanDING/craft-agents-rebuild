/**
 * Web UI session authentication.
 *
 * Cookie-based JWT session auth for the browser-served web UI.
 * - Login: verify password → issue signed JWT → set HttpOnly cookie
 * - Validation: check cookie on every HTTP request + WebSocket upgrade
 * - Rate limiting: per-IP brute-force protection on /api/auth
 */

import { SignJWT, jwtVerify } from 'jose'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// JWT helpers (via jose library)
// ---------------------------------------------------------------------------

const JWT_EXPIRY_SECONDS = 86_400 // 24 hours

export interface JwtPayload {
  sub: string
  iat: number
  exp: number
  /** Unique token id — lets logout revoke this specific session server-side. */
  jti?: string
}

// ---------------------------------------------------------------------------
// JWT revocation (in-memory, server-side)
// ---------------------------------------------------------------------------

/** Revoked session token ids (jti → revocation timestamp ms). Pruned lazily. */
const revokedJtis = new Map<string, number>()
/** Retain revoked ids for at most one token lifetime — after that the token has expired anyway. */
const REVOCATION_RETENTION_MS = JWT_EXPIRY_SECONDS * 1000

function pruneRevoked(): void {
  const cutoff = Date.now() - REVOCATION_RETENTION_MS
  for (const [jti, revokedAt] of revokedJtis) {
    if (revokedAt < cutoff) revokedJtis.delete(jti)
  }
}

/** Revoke a session token id so every verifyJwt of that token fails until it expires. */
export function revokeJwt(jti: string): void {
  pruneRevoked()
  revokedJtis.set(jti, Date.now())
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  const builder = new SignJWT({ sub: payload.sub } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(payload.iat)
    .setExpirationTime(payload.exp)
  if (payload.jti) builder.setJti(payload.jti)
  return builder.sign(key)
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const key = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
    // A logged-out session must be rejected even if the cookie is replayed.
    if (typeof payload.jti === 'string' && revokedJtis.has(payload.jti)) return null
    return {
      sub: payload.sub as string,
      iat: payload.iat as number,
      exp: payload.exp as number,
      ...(typeof payload.jti === 'string' ? { jti: payload.jti } : {}),
    }
  } catch {
    return null
  }
}

export async function createSessionToken(secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return signJwt({ sub: 'webui', iat: now, exp: now + JWT_EXPIRY_SECONDS, jti: randomUUID() }, secret)
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

const SESSION_COOKIE_NAME = 'craft_session'

export function buildSessionCookie(jwt: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${jwt}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${JWT_EXPIRY_SECONDS}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function buildLogoutCookie(secure = false): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function extractSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  for (const pair of cookieHeader.split(';')) {
    const [name, ...rest] = pair.trim().split('=')
    if (name === SESSION_COOKIE_NAME) return rest.join('=')
  }
  return null
}

// ---------------------------------------------------------------------------
// Password verification (argon2id via Bun.password)
// ---------------------------------------------------------------------------

let hashedPassword: string | null = null

/**
 * Hash the login password at startup. Must be called before any auth requests.
 * The hash is stored in memory — the raw password is not retained.
 */
export async function initPasswordHash(plaintext: string): Promise<void> {
  hashedPassword = await Bun.password.hash(plaintext, { algorithm: 'argon2id' })
}

/**
 * Verify a user-supplied password against the pre-hashed password.
 * Uses Bun's built-in argon2id verification (constant-time).
 */
export async function verifyPassword(input: string): Promise<boolean> {
  if (!hashedPassword) return false
  return Bun.password.verify(input, hashedPassword)
}

// ---------------------------------------------------------------------------
// Rate limiter (per-IP + global, sliding window)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  attempts: number
  windowStart: number
}

export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>()
  private readonly maxAttempts: number
  private readonly windowMs: number
  /** Global counter — blocks all IPs after too many total failures (defeats IP spoofing). */
  private readonly maxGlobalAttempts: number
  private globalAttempts = 0
  private globalWindowStart = Date.now()

  constructor(maxAttempts = 5, windowMs = 60_000, maxGlobalAttempts = 20) {
    this.maxAttempts = maxAttempts
    this.windowMs = windowMs
    this.maxGlobalAttempts = maxGlobalAttempts
  }

  /** Returns true if the request should be allowed, false if rate-limited. */
  check(ip: string): boolean {
    const now = Date.now()

    // Reset global window if expired
    if (now - this.globalWindowStart > this.windowMs) {
      this.globalAttempts = 0
      this.globalWindowStart = now
    }

    // Global rate limit — blocks everyone if too many total attempts
    this.globalAttempts++
    if (this.globalAttempts > this.maxGlobalAttempts) return false

    // Per-IP rate limit
    const entry = this.entries.get(ip)

    if (!entry || now - entry.windowStart > this.windowMs) {
      this.entries.set(ip, { attempts: 1, windowStart: now })
      return true
    }

    entry.attempts++
    if (entry.attempts > this.maxAttempts) return false
    return true
  }

  /** Periodic cleanup of stale entries (call on a timer). */
  cleanup(): void {
    const now = Date.now()
    for (const [ip, entry] of this.entries) {
      if (now - entry.windowStart > this.windowMs * 2) {
        this.entries.delete(ip)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Session validator (used by both HTTP and WebSocket)
// ---------------------------------------------------------------------------

export async function validateSession(
  cookieHeader: string | null,
  secret: string,
): Promise<JwtPayload | null> {
  const token = extractSessionCookie(cookieHeader)
  if (!token) return null
  return verifyJwt(token, secret)
}
