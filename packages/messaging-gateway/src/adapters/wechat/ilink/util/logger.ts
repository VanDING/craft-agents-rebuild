// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// ---------------------------------------------------------------------------
// Log levels
// ---------------------------------------------------------------------------

const enum Level {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LEVEL_NAMES: Record<string, Level> = {
  DEBUG: Level.DEBUG,
  INFO: Level.INFO,
  WARN: Level.WARN,
  ERROR: Level.ERROR,
}

const LEVEL_LABELS: Record<Level, string> = {
  [Level.DEBUG]: 'DEBUG',
  [Level.INFO]: 'INFO',
  [Level.WARN]: 'WARN',
  [Level.ERROR]: 'ERROR',
}

// ---------------------------------------------------------------------------
// Logger implementation
// ---------------------------------------------------------------------------

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  withAccount(accountId: string): Logger
  getLogFilePath(): string
  setLogLevel(level: string): void
  close(): void
}

const LOG_DIR = path.join(os.tmpdir(), 'craft-wechat-logs')
const DEFAULT_LEVEL: Level =
  LEVEL_NAMES[process.env.OPENCLAW_LOG_LEVEL ?? ''] ?? Level.INFO

class LoggerImpl implements Logger {
  private _level: Level
  readonly _accountId: string | undefined
  private _stream: fs.WriteStream | null = null
  private _currentDate: string = ''
  private _logPath: string = ''

  constructor(level: Level, accountId?: string) {
    this._level = level
    this._accountId = accountId
  }

  // ---- public interface ------------------------------------------------

  info(message: string, meta?: Record<string, unknown>): void {
    this._write(Level.INFO, message, meta)
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this._write(Level.DEBUG, message, meta)
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this._write(Level.WARN, message, meta)
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this._write(Level.ERROR, message, meta)
  }

  withAccount(accountId: string): Logger {
    return new LoggerImpl(this._level, accountId)
  }

  getLogFilePath(): string {
    this._ensureStream(new Date())
    return this._logPath
  }

  setLogLevel(level: string): void {
    const parsed = LEVEL_NAMES[level.toUpperCase()]
    if (parsed !== undefined) {
      this._level = parsed
    }
  }

  close(): void {
    if (this._stream) {
      this._stream.end()
      this._stream = null
    }
    this._currentDate = ''
    this._logPath = ''
  }

  // ---- internals -------------------------------------------------------

  private _write(level: Level, message: string, meta?: Record<string, unknown>): void {
    if (level < this._level) return

    const now = new Date()
    const entry: Record<string, unknown> = {
      timestamp: now.toISOString(),
      level: LEVEL_LABELS[level],
      message,
      pid: process.pid,
      hostname: os.hostname(),
      runtime: process.version,
      accountId: this._accountId,
      ...(meta ?? {}),
    }

    this._ensureStream(now)
    if (this._stream) {
      this._stream.write(JSON.stringify(entry) + '\n')
    }
  }

  private _ensureStream(now: Date): void {
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const today = `${y}-${m}-${d}`

    if (today === this._currentDate && this._stream) {
      return
    }

    // Day rolled over or first call — close old stream, open new
    if (this._stream) {
      this._stream.end()
      this._stream = null
    }

    // Ensure log directory exists
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true })
    }

    this._currentDate = today
    this._logPath = path.join(LOG_DIR, `openclaw-${today}.log`)
    this._stream = fs.createWriteStream(this._logPath, { flags: 'a' })
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const logger: Logger = new LoggerImpl(DEFAULT_LEVEL)
