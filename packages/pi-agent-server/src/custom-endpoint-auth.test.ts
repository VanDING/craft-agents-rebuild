import { describe, expect, it } from 'bun:test'
import {
  hasSupportedBaseUrlScheme,
  isLocalhostUrl,
  resolveCustomEndpointApiKeyFor,
} from './custom-endpoint-auth.ts'

describe('isLocalhostUrl (audit M-4)', () => {
  it('treats localhost as local', () => {
    expect(isLocalhostUrl('http://localhost:11434')).toBe(true)
  })

  it('treats any 127.0.0.0/8 address as local (not just .1)', () => {
    expect(isLocalhostUrl('http://127.0.0.1:11434')).toBe(true)
    expect(isLocalhostUrl('http://127.8.9.10:11434')).toBe(true)
  })

  it('treats IPv6 loopback ::1 as local', () => {
    expect(isLocalhostUrl('http://[::1]:11434')).toBe(true)
  })

  it('treats IPv4-mapped IPv6 loopback as local', () => {
    expect(isLocalhostUrl('http://[::ffff:127.0.0.1]:11434')).toBe(true)
    // Hex form of the embedded IPv4 (::ffff:7f00:1 = 127.0.0.1)
    expect(isLocalhostUrl('http://[::ffff:7f00:1]:11434')).toBe(true)
  })

  it('treats IPv4 link-local addresses as local', () => {
    expect(isLocalhostUrl('http://169.254.10.20:11434')).toBe(true)
  })

  it('treats IPv6 link-local fe80::/10 addresses as local', () => {
    expect(isLocalhostUrl('http://[fe80::1]:11434')).toBe(true)
    expect(isLocalhostUrl('http://[fe81::1]:11434')).toBe(true)
  })

  it('keeps private-LAN and public hosts as non-local (legacy setups)', () => {
    expect(isLocalhostUrl('http://192.168.1.5:11434')).toBe(false)
    expect(isLocalhostUrl('http://10.0.0.1:11434')).toBe(false)
    expect(isLocalhostUrl('http://172.16.0.1:11434')).toBe(false)
    expect(isLocalhostUrl('https://example.com')).toBe(false)
    expect(isLocalhostUrl('http://[2001:db8::1]')).toBe(false)
  })

  it('returns false for unparseable URLs', () => {
    expect(isLocalhostUrl('not a url')).toBe(false)
  })
})

describe('hasSupportedBaseUrlScheme (audit M-4)', () => {
  it('accepts http and https', () => {
    expect(hasSupportedBaseUrlScheme('http://localhost:11434')).toBe(true)
    expect(hasSupportedBaseUrlScheme('https://api.example.com')).toBe(true)
  })

  it('rejects other schemes', () => {
    expect(hasSupportedBaseUrlScheme('ftp://files.example.com')).toBe(false)
    expect(hasSupportedBaseUrlScheme('file:///etc/passwd')).toBe(false)
    expect(hasSupportedBaseUrlScheme('ws://localhost:11434')).toBe(false)
    expect(hasSupportedBaseUrlScheme('data:text/plain,hello')).toBe(false)
  })

  it('rejects scheme-less and unparseable base URLs', () => {
    expect(hasSupportedBaseUrlScheme('localhost:11434')).toBe(false)
    expect(hasSupportedBaseUrlScheme('')).toBe(false)
    expect(hasSupportedBaseUrlScheme('not a url')).toBe(false)
  })
})

describe('resolveCustomEndpointApiKeyFor (audit M-4)', () => {
  it('never returns the real key for loopback endpoints, even with a credential', () => {
    const config = {
      baseUrl: 'http://127.0.0.1:11434',
      piAuth: { provider: 'custom-endpoint', credential: { type: 'api_key', key: 'real-secret' } },
    }
    expect(resolveCustomEndpointApiKeyFor(config)).toBe('not-needed')
  })

  it('never returns the real key for link-local endpoints', () => {
    const config = {
      baseUrl: 'http://169.254.10.20:11434',
      apiKey: 'real-secret',
    }
    expect(resolveCustomEndpointApiKeyFor(config)).toBe('not-needed')
  })

  it('returns the placeholder for loopback endpoints with no credentials at all', () => {
    expect(resolveCustomEndpointApiKeyFor({ baseUrl: 'http://localhost:11434' })).toBe('not-needed')
  })

  it('still returns the configured key for private-LAN endpoints (legacy setups)', () => {
    const config = {
      baseUrl: 'http://192.168.1.5:11434',
      piAuth: { provider: 'custom-endpoint', credential: { type: 'api_key', key: 'lan-secret' } },
    }
    expect(resolveCustomEndpointApiKeyFor(config)).toBe('lan-secret')
  })

  it('returns the legacy apiKey for remote endpoints', () => {
    expect(resolveCustomEndpointApiKeyFor({ baseUrl: 'https://api.example.com', apiKey: 'remote-key' })).toBe('remote-key')
  })

  it('returns an empty string when a remote endpoint has no key', () => {
    expect(resolveCustomEndpointApiKeyFor({ baseUrl: 'https://api.example.com' })).toBe('')
    expect(resolveCustomEndpointApiKeyFor(null)).toBe('')
    expect(resolveCustomEndpointApiKeyFor(undefined)).toBe('')
  })
})
