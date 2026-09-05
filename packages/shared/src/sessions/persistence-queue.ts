import { open, rename } from 'fs/promises'
import { dirname } from 'path'
import type { StoredSession, SessionHeader } from './types.js'
import { getSessionFilePath, ensureSessionsDir, ensureSessionDir } from './storage.js'
import { toPortablePath } from '../utils/paths.js'
import { createSessionHeader, makeSessionPathPortable, readSessionHeader } from './jsonl.js'
import { debug } from '../utils/debug.js'

interface PendingWrite {
  data: StoredSession
  timer: ReturnType<typeof setTimeout>
}

interface HeaderMetadataSignature {
  name?: string
  labels?: string[]
  isFlagged?: boolean
  sessionStatus?: string
  permissionMode?: string
  hasUnread?: boolean
  lastReadMessageId?: string
}

function getHeaderMetadataSignature(header: SessionHeader): string {
  const signature: HeaderMetadataSignature = {
    name: header.name,
    labels: header.labels,
    isFlagged: header.isFlagged,
    sessionStatus: header.sessionStatus,
    permissionMode: header.permissionMode,
    hasUnread: header.hasUnread,
    lastReadMessageId: header.lastReadMessageId,
  }
  return JSON.stringify(signature)
}

function mergeHeaderWithExternalMetadata(localHeader: SessionHeader, diskHeader: SessionHeader): SessionHeader {
  return {
    ...localHeader,
    name: diskHeader.name,
    labels: diskHeader.labels,
    isFlagged: diskHeader.isFlagged,
    sessionStatus: diskHeader.sessionStatus,
    permissionMode: diskHeader.permissionMode,
    hasUnread: diskHeader.hasUnread,
    lastReadMessageId: diskHeader.lastReadMessageId,
  }
}

/**
 * Debounced async session persistence queue.
 * Prevents main thread blocking by using async writes and coalescing
 * rapid successive persist calls into a single write.
 *
 * IMPORTANT: Writes are serialized per-session to prevent race conditions
 * when rapid successive flushes (e.g., clearSessionForRecovery + onSdkSessionIdUpdate)
 * would otherwise write to the same .tmp file concurrently.
 */
class SessionPersistenceQueue {
  private pending = new Map<string, PendingWrite>()
  private writeInProgress = new Map<string, Promise<void>>()
  private lastWrittenHeaderSignature = new Map<string, string>()
  private debounceMs: number

  constructor(debounceMs = 500) {
    this.debounceMs = debounceMs
  }

  /**
   * Queue a session for persistence. If a write is already pending for this
   * session, it will be replaced with the new data and the timer reset.
   */
  enqueue(session: StoredSession): void {
    const existing = this.pending.get(session.id)
    if (existing) {
      clearTimeout(existing.timer)
    }

    const timer = setTimeout(() => {
      // performWrite logs the failure; retain it for an explicit flush to observe.
      void this.write(session.id).catch(() => {})
    }, this.debounceMs)

    this.pending.set(session.id, { data: session, timer })
  }

  /**
   * Write a session to disk immediately in JSONL format.
   * Uses atomic write (write-to-temp-then-rename) to prevent corruption on crash.
   *
   * M-17: The returned promise is registered in writeInProgress so flush()/
   * flushAll() can await writes already started by the debounce timer — not just
   * writes that are still pending in the queue. Writes are serialized per-session
   * by chaining on any prior in-flight write (shared .tmp file safety).
   */
  private write(sessionId: string): Promise<void> {
    const entry = this.pending.get(sessionId)
    if (!entry) return Promise.resolve()

    this.pending.delete(sessionId)
    clearTimeout(entry.timer)

    const prev = this.writeInProgress.get(sessionId) ?? Promise.resolve()
    const perform = () => this.performWrite(sessionId, entry)
    // A failed snapshot must not prevent a newer snapshot from being saved.
    const writePromise = prev.then(perform, perform)
    this.writeInProgress.set(sessionId, writePromise)
    void writePromise.then(() => {
      // Only clear the slot if this is still the latest write for the session —
      // flush() may have started a newer write while this one was in flight.
      if (this.writeInProgress.get(sessionId) === writePromise) {
        this.writeInProgress.delete(sessionId)
      }
    }, () => { /* Keep the failed write visible to flush()/flushAll(). */ })
    return writePromise
  }

  private async performWrite(sessionId: string, entry: PendingWrite): Promise<void> {
    try {
      const { data } = entry
      ensureSessionsDir(data.workspaceRootPath)
      ensureSessionDir(data.workspaceRootPath, sessionId)

      const filePath = getSessionFilePath(data.workspaceRootPath, sessionId)

      // Prepare session with portable paths for cross-machine compatibility
      const storageSession: StoredSession = {
        ...data,
        workspaceRootPath: toPortablePath(data.workspaceRootPath),
        workingDirectory: data.workingDirectory ? toPortablePath(data.workingDirectory) : undefined,
        sdkCwd: data.sdkCwd ? toPortablePath(data.sdkCwd) : undefined,
        lastUsedAt: Date.now(),
      }

      // Create JSONL content: header + messages (one per line)
      // Filter out intermediate messages - they're transient streaming status updates
      const localHeader = createSessionHeader(storageSession)
      const localSig = getHeaderMetadataSignature(localHeader)
      const diskHeader = readSessionHeader(filePath)
      const previousSig = this.lastWrittenHeaderSignature.get(sessionId)
      const diskSig = diskHeader ? getHeaderMetadataSignature(diskHeader) : undefined

      // Queue writes should never clobber session metadata changed externally
      // (watcher edits, direct header edits, other instances), but they must
      // still persist local metadata updates (e.g. generated title).
      //
      // Preserve disk metadata only when disk diverged from our last written
      // signature, which indicates an external mutation.
      const hasMetadataMismatch = !!diskHeader && !!diskSig && diskSig !== localSig
      const hasExternalMetadataChange = !!diskHeader && !!diskSig && !!previousSig && diskSig !== previousSig
      const header = hasExternalMetadataChange && diskHeader
        ? mergeHeaderWithExternalMetadata(localHeader, diskHeader)
        : localHeader

      if (hasMetadataMismatch) {
        const baseline = previousSig ? `, previousSig=${previousSig.slice(0, 12)}` : ', previousSig=<none>'
        const mode = hasExternalMetadataChange ? 'disk preserved' : 'local preserved'
        debug(`[PersistenceQueue] Session ${sessionId} metadata mismatch detected (${mode}${baseline})`)
      }

      const persistableMessages = storageSession.messages
      // Use original absolute sessionDir (before toPortablePath) for path replacement
      const sessionDir = dirname(filePath)
      const lines = [
        makeSessionPathPortable(JSON.stringify(header), sessionDir),
        ...persistableMessages.map(m => makeSessionPathPortable(JSON.stringify(m), sessionDir)),
      ]

      // Atomic write: write to .tmp then rename over the real file.
      // If the process crashes mid-write, only the .tmp is corrupted —
      // the original session.jsonl remains intact.
      const tmpFile = filePath + '.tmp'
      // M-23: session transcripts are private — owner read/write only.
      const tempHandle = await open(tmpFile, 'w', 0o600)
      try {
        await tempHandle.writeFile(lines.join('\n') + '\n', { encoding: 'utf-8' })
        await tempHandle.sync()
      } finally {
        await tempHandle.close()
      }
      // Atomic replacement: never unlink the last good snapshot first. If a
      // platform cannot replace the target atomically, fail closed and leave
      // the fsynced .tmp available for startup recovery.
      // Publish the signature just before replacement so watcher events recognize
      // self-writes. A failed replacement must not become the next merge baseline.
      this.lastWrittenHeaderSignature.set(sessionId, getHeaderMetadataSignature(header))
      try {
        await rename(tmpFile, filePath)
      } catch (error) {
        if (previousSig === undefined) this.lastWrittenHeaderSignature.delete(sessionId)
        else this.lastWrittenHeaderSignature.set(sessionId, previousSig)
        throw error
      }
      // Windows does not support fsync on directory handles (EPERM). The file
      // itself was fsynced and rename is atomic on the same volume, so only
      // suppress that documented platform limitation; every other failure is
      // still fatal and leaves the caller aware persistence was incomplete.
      let directoryHandle: Awaited<ReturnType<typeof open>> | undefined
      try {
        directoryHandle = await open(dirname(filePath), 'r')
        await directoryHandle.sync()
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        const unsupportedOnWindows = process.platform === 'win32'
          && (code === 'EPERM' || code === 'EINVAL' || code === 'ENOTSUP')
        if (!unsupportedOnWindows) throw error
      } finally {
        await directoryHandle?.close()
      }
      debug(`[PersistenceQueue] Wrote session ${sessionId}`)
    } catch (error) {
      console.error(`[PersistenceQueue] Failed to write session ${sessionId}:`, error)
      throw error
    }
  }

  /**
   * Immediately flush a specific session if pending.
   * M-17: always awaits any in-flight write for the session — including writes
   * already started by the debounce timer — so flushAll() on quit does not drop
   * writes that have begun but are not yet in the pending queue.
   */
  async flush(sessionId: string): Promise<void> {
    const entry = this.pending.get(sessionId)
    if (entry) {
      clearTimeout(entry.timer)
    }

    // write() serializes a newer snapshot even if the preceding write failed.
    if (this.pending.has(sessionId)) {
      await this.write(sessionId)
    } else {
      await this.writeInProgress.get(sessionId)
    }
  }

  /**
   * Cancel a pending write for a session (e.g., when deleting the session).
   */
  cancel(sessionId: string): void {
    const entry = this.pending.get(sessionId)
    if (entry) {
      clearTimeout(entry.timer)
      this.pending.delete(sessionId)
      debug(`[PersistenceQueue] Cancelled pending write for session ${sessionId}`)
    }
    const inProgress = this.writeInProgress.get(sessionId)
    // Forget a cancelled failure, while still tracking any write that is running.
    void inProgress?.catch(() => {
      if (this.writeInProgress.get(sessionId) === inProgress) this.writeInProgress.delete(sessionId)
    })
    this.lastWrittenHeaderSignature.delete(sessionId)
  }

  /**
   * Flush all pending sessions. Call this on app quit.
   * M-17: also awaits in-flight (already-started) writes so quit never drops data.
   */
  async flushAll(): Promise<void> {
    const sessionIds = new Set<string>([
      ...this.pending.keys(),
      ...this.writeInProgress.keys(),
    ])
    await Promise.all([...sessionIds].map(id => this.flush(id)))
  }

  /**
   * Check if a session has a pending write.
   */
  hasPending(sessionId: string): boolean {
    return this.pending.has(sessionId)
  }

  /**
   * Get the metadata signature of the last header we wrote for a session.
   * Used by ConfigWatcher to suppress self-triggered metadata change events.
   */
  getLastWrittenSignature(sessionId: string): string | undefined {
    return this.lastWrittenHeaderSignature.get(sessionId)
  }

  /**
   * Get count of pending writes.
   */
  get pendingCount(): number {
    return this.pending.size
  }
}

// Singleton instance
export const sessionPersistenceQueue = new SessionPersistenceQueue()

// Named exports for testing/customization
export { SessionPersistenceQueue, getHeaderMetadataSignature, mergeHeaderWithExternalMetadata }
