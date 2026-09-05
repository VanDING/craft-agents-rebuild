import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAppShellContext } from '@/context/AppShellContext'

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!value) return fallback
  return value.includes('(') ? value : `hsl(${value})`
}

function terminalTheme() {
  return {
    background: '#00000000',
    foreground: cssColor('--foreground', '#d4d4d4'),
    cursor: cssColor('--foreground', '#d4d4d4'),
    selectionBackground: cssColor('--accent', '#355b85'),
    black: '#4b5563', red: '#ef4444', green: '#22c55e', yellow: '#eab308', blue: '#3b82f6', magenta: '#a855f7', cyan: '#06b6d4', white: '#e5e7eb',
    brightBlack: '#6b7280', brightRed: '#f87171', brightGreen: '#4ade80', brightYellow: '#facc15', brightBlue: '#60a5fa', brightMagenta: '#c084fc', brightCyan: '#22d3ee', brightWhite: '#f9fafb',
  }
}

export function TerminalPanel() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const { activeWorkspaceId, activeSessionWorkingDirectory, workspaces } = useAppShellContext()
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId)
  const workspaceRootPath = workspace?.rootPath
  const remoteServer = workspace?.remoteServer
  // The session directory is only the initial cwd for a workspace's shell.
  const initialCwdRef = useRef(activeSessionWorkingDirectory)
  initialCwdRef.current = activeSessionWorkingDirectory

  useEffect(() => {
    if (!hostRef.current || !workspaceRootPath || !activeWorkspaceId || remoteServer) return
    setError(null)
    let terminalId: string | null = null
    const terminal = new Terminal({ allowTransparency: true, convertEol: true, cursorBlink: true, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12, scrollback: 5000, theme: terminalTheme() })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(hostRef.current)
    fit.fit()
    let disposed = false
    const cwd = initialCwdRef.current || workspaceRootPath
    void window.electronAPI.createTerminal({ workspaceId: activeWorkspaceId, cwd, cols: terminal.cols, rows: terminal.rows })
      .then(async (info) => {
        if (disposed) return
        terminalId = info.running ? info.id : null
        if (info.output) terminal.write(info.output)
        if (!info.running) terminal.writeln(`\r\n[process exited ${info.exitCode ?? ''}]`)
        terminal.focus()
        if (info.running) await window.electronAPI.resizeTerminal(info.id, terminal.cols, terminal.rows)
      }).catch((cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)) })
    const offData = window.electronAPI.onTerminalData(({ id, data }) => { if (id === terminalId) terminal.write(data) })
    const offExit = window.electronAPI.onTerminalExit(({ id, exitCode }) => { if (id === terminalId) terminal.writeln(`\r\n[process exited ${exitCode}]`) })
    const input = terminal.onData((data) => { const id = terminalId; if (id) void window.electronAPI.writeTerminal(id, data) })
    const resize = new ResizeObserver(() => { fit.fit(); const id = terminalId; if (id) void window.electronAPI.resizeTerminal(id, terminal.cols, terminal.rows) })
    resize.observe(hostRef.current)
    const themeObserver = new MutationObserver(() => { terminal.options.theme = terminalTheme() })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => { disposed = true; offData(); offExit(); input.dispose(); resize.disconnect(); themeObserver.disconnect(); terminal.dispose() }
  }, [activeWorkspaceId, workspaceRootPath, remoteServer])

  if (remoteServer) return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">The integrated terminal is available for local workspaces only.</div>
  return (
    <div className="flex h-full min-h-0 flex-col bg-background/40 p-2">
      {error && <div className="p-4 text-sm text-destructive">{error}</div>}
      <div ref={hostRef} className="min-h-0 w-full flex-1 overflow-hidden" />
    </div>
  )
}
