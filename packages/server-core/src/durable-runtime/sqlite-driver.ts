import { createRequire } from 'node:module'

export interface SqliteRunResult {
  changes: number
  lastInsertRowid: number | bigint
}
export interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult): (...args: TArgs) => TResult
  close(): void
}

interface NativeStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

interface NativeDatabase {
  exec(sql: string): void
  prepare?(sql: string): NativeStatement
  query?(sql: string): NativeStatement
  close(): void
}

class RuntimeSqliteDatabase implements SqliteDatabase {
  constructor(private readonly native: NativeDatabase, private readonly bunRuntime: boolean) {}

  exec(sql: string): void {
    this.native.exec(sql)
  }

  prepare(sql: string): SqliteStatement {
    const statement = this.bunRuntime
      ? this.native.query?.(sql)
      : this.native.prepare?.(sql)
    if (!statement) throw new Error('SQLite runtime did not provide a statement API')
    return statement
  }

  transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult): (...args: TArgs) => TResult {
    return (...args: TArgs): TResult => {
      this.native.exec('BEGIN IMMEDIATE')
      try {
        const result = fn(...args)
        this.native.exec('COMMIT')
        return result
      } catch (error) {
        try { this.native.exec('ROLLBACK') } catch { /* preserve original failure */ }
        throw error
      }
    }
  }

  close(): void {
    this.native.close()
  }
}

/**
 * Use the SQLite implementation shipped with the active runtime. This avoids an
 * additional native ABI dependency while keeping the durable store available in
 * both Bun headless builds and Electron/Node.
 */
export function openSqliteDatabase(path: string): SqliteDatabase {
  const runtimeRequire = createRequire(import.meta.url)
  if (typeof process.versions.bun === 'string') {
    const { Database } = runtimeRequire('bun:sqlite') as {
      Database: new (filename: string, options?: { create?: boolean }) => NativeDatabase
    }
    return new RuntimeSqliteDatabase(new Database(path, { create: true }), true)
  }

  const { DatabaseSync } = runtimeRequire('node:sqlite') as {
    DatabaseSync: new (filename: string) => NativeDatabase
  }
  return new RuntimeSqliteDatabase(new DatabaseSync(path), false)
}
