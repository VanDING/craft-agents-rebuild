import { describe, expect, mock, spyOn, test } from 'bun:test'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import type { IPty } from 'node-pty'
import { TerminalManager, stripTerminalControlSequences } from '../terminal-manager'

const nodePty = createRequire(import.meta.url)('node-pty') as typeof import('node-pty')

describe('integrated terminal output sanitizing', () => {
  test('removes ANSI styling and OSC title sequences for agent reads', () => {
    const raw = '\u001b]0;project\u0007\u001b[32mready\u001b[0m\rprompt'
    expect(stripTerminalControlSequences(raw)).toBe('ready\nprompt')
  })
})

describe('workspace terminal lifecycle', () => {
  test('reuses the running shell and releases an exited record only after replacement succeeds', () => {
    const processes: Array<{ exit: (event: { exitCode: number }) => void; kill: ReturnType<typeof mock> }> = []
    const spawn = spyOn(nodePty, 'spawn').mockImplementation(() => {
      const process = { exit: (_event: { exitCode: number }) => {}, kill: mock(() => {}) }
      processes.push(process)
      return {
        kill: process.kill,
        onData: () => ({ dispose() {} }),
        onExit: (listener: typeof process.exit) => { process.exit = listener; return { dispose() {} } },
      } as unknown as IPty
    })
    const manager = new TerminalManager()
    try {
      const first = manager.create({ workspaceId: 'ws', cwd: tmpdir() })
      expect(manager.create({ workspaceId: 'ws', cwd: '/missing-session-directory' }).id).toBe(first.id)
      expect(spawn).toHaveBeenCalledTimes(1)
      processes[0]!.exit({ exitCode: 0 })
      expect(() => manager.create({ workspaceId: 'ws', cwd: '/missing-session-directory' })).toThrow()
      expect(manager.getForWorkspace('ws')?.id).toBe(first.id)

      const second = manager.create({ workspaceId: 'ws', cwd: tmpdir() })
      expect(second.id).not.toBe(first.id)
      expect(manager.readForWorkspace('ws')?.terminalId).toBe(second.id)
      // An old id is no longer retained as an exited terminal.
      expect(() => manager.write(first.id, 'input')).toThrow('Terminal is not running')
      const destroy = spyOn(manager, 'destroy')
      manager.destroyAll()
      expect(destroy.mock.calls.map(([id]) => id)).toEqual([second.id])
      expect(processes[0]!.kill).not.toHaveBeenCalled()
      expect(processes[1]!.kill).toHaveBeenCalledTimes(1)
    } finally {
      manager.destroyAll()
      spawn.mockRestore()
    }
  })
})
