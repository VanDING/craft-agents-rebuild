import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SecureStorageBackend } from './secure-storage.ts'

describe('SecureStorageBackend corrupted-file handling (M-16)', () => {
  it('preserves a corrupted store as credentials.enc.corrupt-<timestamp> instead of deleting it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-secure-storage-'))
    const file = join(dir, 'credentials.enc')
    try {
      // 200 bytes of garbage: passes the minimum-size check, fails the magic check.
      const corrupted = Buffer.alloc(200, 0x42)
      writeFileSync(file, corrupted)

      const backend = new SecureStorageBackend(file)
      // Any load path (list -> loadStoreSync) hits the corruption branch.
      await backend.list({})

      // The corrupted file must NOT be deleted — it is renamed to a backup.
      expect(existsSync(file)).toBe(false)
      const backups = readdirSync(dir).filter((name) => name.startsWith('credentials.enc.corrupt-'))
      expect(backups.length).toBe(1)
      expect(readFileSync(join(dir, backups[0]!)).equals(corrupted)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('recovers with a fresh store after backing up the corrupted file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-secure-storage-'))
    const file = join(dir, 'credentials.enc')
    try {
      writeFileSync(file, Buffer.alloc(64, 0x00)) // too short: fails the size check
      const backend = new SecureStorageBackend(file)

      await backend.list({})
      expect(existsSync(file)).toBe(false)
      expect(readdirSync(dir).filter((n) => n.startsWith('credentials.enc.corrupt-')).length).toBe(1)

      // The backend can still persist a brand-new store at the original path.
      const id = { type: 'source_apikey' as const, workspaceId: 'ws', sourceId: 'svc' }
      await backend.set(id, { value: 'secret' })
      expect(existsSync(file)).toBe(true)
      const stored = await backend.get(id)
      expect(stored).toEqual({ value: 'secret' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
