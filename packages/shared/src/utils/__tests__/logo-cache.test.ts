import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cacheLogoUrl } from '../logo-cache'

describe('persistent logo cache', () => {
  let directory: string
  let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'craft-logo-test-'))
    network = spyOn(globalThis, 'fetch')
  })
  afterEach(async () => {
    network.mockRestore()
    await rm(directory, { recursive: true, force: true })
  })
  it('loads image bytes from disk while offline without another request', async () => {
    network.mockResolvedValue(new Response('image bytes', { headers: { 'content-type': 'image/png' } }))
    const first = await cacheLogoUrl('https://example.com/icon.png', directory)
    expect(first).toBe('data:image/png;base64,aW1hZ2UgYnl0ZXM=')
    network.mockRejectedValue(new Error('offline'))
    expect(await cacheLogoUrl('https://example.com/icon.png', directory)).toBe(first)
    expect(network).toHaveBeenCalledTimes(1)
  })
  it('does not persist failures or HTML responses and retries on the next load', async () => {
    network.mockResolvedValue(new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }))
    expect(await cacheLogoUrl('https://example.com/icon.png', directory)).toBeNull()
    network.mockResolvedValue(new Response('recovered', { headers: { 'content-type': 'image/png' } }))
    expect(await cacheLogoUrl('https://example.com/icon.png', directory)).toStartWith('data:image/png;base64,')
    expect(network).toHaveBeenCalledTimes(2)
  })
})
