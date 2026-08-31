import { describe, expect, test } from 'bun:test'
import { stripTerminalControlSequences } from '../terminal-manager'

describe('integrated terminal output sanitizing', () => {
  test('removes ANSI styling and OSC title sequences for agent reads', () => {
    const raw = '\u001b]0;project\u0007\u001b[32mready\u001b[0m\rprompt'
    expect(stripTerminalControlSequences(raw)).toBe('ready\nprompt')
  })
})
