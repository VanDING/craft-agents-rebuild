import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { CONFIG_DIR } from '../config/paths.ts'
import { getLogoUrl } from './logo.ts'

const pending = new Map<string, Promise<string | null>>()

/** Persist image bytes, rather than relying on the browser's evictable HTTP cache. */
export async function getCachedLogo(serviceUrl: string, provider?: string): Promise<string | null> {
  const url = getLogoUrl(serviceUrl, provider)
  if (!url) return null
  const existing = pending.get(url)
  if (existing) return existing
  const request = cacheLogoUrl(url)
  pending.set(url, request)
  try { return await request } finally { pending.delete(url) }
}

export async function cacheLogoUrl(url: string, directory = join(CONFIG_DIR, 'cache', 'logos')): Promise<string | null> {
  const file = join(directory, createHash('sha256').update(url).digest('hex') + '.txt')
  try {
    const cached = await readFile(file, 'utf8')
    if (cached.startsWith('data:image/')) return cached
  } catch { /* First use: download once. */ }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim()
    if (!response.ok || !mime?.startsWith('image/')) return null
    const bytes = await response.arrayBuffer()
    if (!bytes.byteLength || bytes.byteLength > 1024 * 1024) return null
    const data = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
    try {
      await mkdir(directory, { recursive: true })
      const temporary = `${file}.${process.pid}.tmp`
      await writeFile(temporary, data, 'utf8')
      await rename(temporary, file)
    } catch { /* A read-only cache must not prevent displaying a downloaded logo. */ }
    return data
  } catch { return null }
}
