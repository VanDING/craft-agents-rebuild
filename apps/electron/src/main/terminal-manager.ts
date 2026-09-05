import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { IPty } from 'node-pty'
import type { TerminalCreateOptions, TerminalDataEvent, TerminalExitEvent, TerminalInfo, TerminalReadResult } from '@craft-agent/shared/protocol'

const MAX_BUFFER_CHARS = 1_000_000
const DEFAULT_READ_CHARS = 20_000
const require = createRequire(__filename)

function loadNodePty(): typeof import('node-pty') {
  try {
    ensureSpawnHelperExecutable(dirname(require.resolve('node-pty/package.json')))
    return require('node-pty')
  } catch (error) {
    if (process.resourcesPath) {
      const packageRoot = join(process.resourcesPath, 'app', 'node_modules', 'node-pty')
      ensureSpawnHelperExecutable(packageRoot)
      return require(packageRoot)
    }
    throw error
  }
}

function ensureSpawnHelperExecutable(packageRoot: string): void {
  if (process.platform === 'win32') return
  const helper = join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
  if (existsSync(helper)) chmodSync(helper, 0o755)
}

/**
 * Resolve the interactive terminal shell on Windows.
 *
 * Preference order matches the agent shell channel (Pi SDK PowerShell tool):
 * PowerShell 7 (pwsh) first, then Windows PowerShell 5.1 (powershell.exe),
 * then the legacy COMSPEC (cmd.exe) as a last resort. cmd.exe used to be the
 * default via COMSPEC, which made the integrated terminal behave differently
 * from agent command execution and lacked modern PS7 features (UTF-8 by
 * default, better quoting for native executables).
 *
 * Result is cached for the process lifetime (a pwsh install does not change
 * while the app runs).
 */
let cachedWindowsShell: string | undefined

function resolveWindowsShell(): string {
  if (cachedWindowsShell) return cachedWindowsShell
  for (const candidate of ['pwsh.exe', 'powershell.exe']) {
    const probe = spawnSync('where.exe', [candidate], { encoding: 'utf8' })
    const found = probe.stdout?.split(/\r?\n/).map(line => line.trim()).find(Boolean)
    if (found) {
      cachedWindowsShell = found
      return found
    }
  }
  cachedWindowsShell = process.env.COMSPEC || 'powershell.exe'
  return cachedWindowsShell
}

export function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '')
    .replace(/\r(?!\n)/g, '\n')
}

interface ManagedTerminal extends Omit<TerminalInfo, 'output'> { pty: IPty; output: string }

export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>()
  private workspaceTerminals = new Map<string, string>()
  private dataListeners = new Set<(event: TerminalDataEvent) => void>()
  private exitListeners = new Set<(event: TerminalExitEvent) => void>()

  create(options: TerminalCreateOptions): TerminalInfo {
    const existing = this.getForWorkspace(options.workspaceId)
    if (existing?.running) return existing
    if (!existsSync(options.cwd) || !statSync(options.cwd).isDirectory()) throw new Error(`Terminal working directory does not exist: ${options.cwd}`)

    const shell = process.platform === 'win32'
      ? resolveWindowsShell()
      : process.env.SHELL || '/bin/zsh'
    const pty = loadNodePty().spawn(shell, [], {
      name: 'xterm-256color',
      cols: Math.max(2, options.cols ?? 80),
      rows: Math.max(1, options.rows ?? 24),
      cwd: options.cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
    })
    if (existing) this.destroy(existing.id)
    const id = randomUUID()
    const terminal: ManagedTerminal = { id, workspaceId: options.workspaceId, cwd: options.cwd, shell, running: true, pty, output: '' }
    this.terminals.set(id, terminal)
    this.workspaceTerminals.set(options.workspaceId, id)
    pty.onData((data) => {
      terminal.output = (terminal.output + data).slice(-MAX_BUFFER_CHARS)
      for (const listener of this.dataListeners) listener({ id, data })
    })
    pty.onExit(({ exitCode, signal }) => {
      terminal.running = false
      terminal.exitCode = exitCode
      for (const listener of this.exitListeners) listener({ id, exitCode, signal })
    })
    return this.toInfo(terminal)
  }

  getForWorkspace(workspaceId: string): TerminalInfo | null {
    const id = this.workspaceTerminals.get(workspaceId)
    const terminal = id ? this.terminals.get(id) : undefined
    return terminal ? this.toInfo(terminal) : null
  }

  write(id: string, data: string): void { this.requireRunning(id).pty.write(data) }
  resize(id: string, cols: number, rows: number): void { this.requireRunning(id).pty.resize(Math.max(2, cols), Math.max(1, rows)) }

  destroy(id: string): void {
    const terminal = this.terminals.get(id)
    if (!terminal) return
    if (terminal.running) terminal.pty.kill()
    this.terminals.delete(id)
    if (this.workspaceTerminals.get(terminal.workspaceId) === id) this.workspaceTerminals.delete(terminal.workspaceId)
  }

  destroyForWorkspace(workspaceId: string): void {
    const id = this.workspaceTerminals.get(workspaceId)
    if (id) this.destroy(id)
  }

  destroyAll(): void { for (const id of [...this.terminals.keys()]) this.destroy(id) }
  onData(listener: (event: TerminalDataEvent) => void): () => void { this.dataListeners.add(listener); return () => this.dataListeners.delete(listener) }
  onExit(listener: (event: TerminalExitEvent) => void): () => void { this.exitListeners.add(listener); return () => this.exitListeners.delete(listener) }

  readForWorkspace(workspaceId: string, maxChars = DEFAULT_READ_CHARS): TerminalReadResult | null {
    const id = this.workspaceTerminals.get(workspaceId)
    const terminal = id ? this.terminals.get(id) : undefined
    if (!terminal) return null
    const clean = stripTerminalControlSequences(terminal.output)
    const bounded = Math.max(1_000, Math.min(maxChars, 100_000))
    return { terminalId: terminal.id, cwd: terminal.cwd, running: terminal.running, text: clean.slice(-bounded), truncated: clean.length > bounded }
  }

  private requireRunning(id: string): ManagedTerminal {
    const terminal = this.terminals.get(id)
    if (!terminal?.running) throw new Error('Terminal is not running')
    return terminal
  }
  private toInfo(terminal: ManagedTerminal): TerminalInfo {
    const { pty: _pty, ...info } = terminal
    return info
  }
}
