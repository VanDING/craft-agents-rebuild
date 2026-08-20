/**
 * Regression test: ChatGPT Plus OAuth must reach the Pi SDK as an `oauth`
 * credential, not `api_key`.
 *
 * The SDK's `openai-codex` provider is OAuth-only (`auth.oauth`, no
 * `auth.apiKey`). Passing the bearer JWT as `api_key` made provider-aware
 * auth resolution return undefined, surfacing as
 * "No API key found for openai-codex" on every chat request.
 */
import { describe, it, expect } from 'bun:test';
import { buildPiAuthCredential } from '../pi-agent.ts';

const ACCESS = 'jwt.access.token';
const REFRESH = 'refresh-token';
const EXPIRES = 1787234961358;

describe('buildPiAuthCredential', () => {
  it('passes ChatGPT Plus (openai-codex) as an oauth credential', () => {
    expect(buildPiAuthCredential('openai-codex', { accessToken: ACCESS, refreshToken: REFRESH, expiresAt: EXPIRES }))
      .toEqual({ type: 'oauth', access: ACCESS, refresh: REFRESH, expires: EXPIRES });
  });

  it('openai-codex tolerates a missing refresh token (refresh becomes empty)', () => {
    expect(buildPiAuthCredential('openai-codex', { accessToken: ACCESS, expiresAt: EXPIRES }))
      .toEqual({ type: 'oauth', access: ACCESS, refresh: '', expires: EXPIRES });
  });

  it('openai-codex tolerates a missing expiry (expires becomes 0)', () => {
    expect(buildPiAuthCredential('openai-codex', { accessToken: ACCESS }))
      .toEqual({ type: 'oauth', access: ACCESS, refresh: '', expires: 0 });
  });

  it('keeps the Copilot full-oauth shape when a refresh token exists', () => {
    expect(buildPiAuthCredential('github-copilot', { accessToken: ACCESS, refreshToken: REFRESH, expiresAt: EXPIRES }))
      .toEqual({ type: 'oauth', access: ACCESS, refresh: REFRESH, expires: EXPIRES });
  });

  it('falls back to api_key for Copilot without a refresh token', () => {
    expect(buildPiAuthCredential('github-copilot', { accessToken: ACCESS }))
      .toEqual({ type: 'api_key', key: ACCESS });
  });

  it('keeps the api_key bearer shape for other OAuth providers', () => {
    expect(buildPiAuthCredential('anthropic', { accessToken: ACCESS, refreshToken: REFRESH, expiresAt: EXPIRES }))
      .toEqual({ type: 'api_key', key: ACCESS });
  });

  it('returns null when no access token is stored', () => {
    expect(buildPiAuthCredential('openai-codex', { refreshToken: REFRESH })).toBeNull();
    expect(buildPiAuthCredential('openai-codex', null)).toBeNull();
    expect(buildPiAuthCredential('openai-codex', undefined)).toBeNull();
  });
});
