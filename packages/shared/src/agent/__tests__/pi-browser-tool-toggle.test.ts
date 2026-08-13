/**
 * Pi `browser_tool` toggle test.
 *
 * Verifies that when `getBrowserToolEnabled()` returns false, the Pi backend
 * excludes `mcp__session__browser_tool` from the session via the SDK's
 * `excludeTools` denylist — matching Claude's existing gate.
 *
 * The gate spans two sides: `PiAgent` (main process) sends
 * `browserToolEnabled` in the init message, and the pi-agent-server
 * subprocess sets `excludeTools` in the SDK session options. To avoid
 * spinning up a full subprocess, we do a textual contract check on the
 * source files. If the init field or the excludeTools line is removed or
 * the tool name renamed, the test fails so the regression is caught.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('pi-agent browser_tool toggle (contract)', () => {
  const piAgentSource = readFileSync(join(__dirname, '..', 'pi-agent.ts'), 'utf-8')
  const serverSource = readFileSync(join(__dirname, '..', '..', '..', '..', 'pi-agent-server', 'src', 'index.ts'), 'utf-8')

  it('imports getBrowserToolEnabled from config storage', () => {
    expect(piAgentSource).toContain('getBrowserToolEnabled')
    expect(piAgentSource).toMatch(/from ['"]\.\.\/config\/storage(\.ts)?['"]/)
  })

  it('sends browserToolEnabled in the init message', () => {
    // The init payload must carry the toggle so the subprocess can gate the tool.
    expect(piAgentSource).toContain('browserToolEnabled: getBrowserToolEnabled()')
  })

  it('no longer filters the tool manually in the main process', () => {
    // The old inline def filter is gone; gating moved to the SDK denylist.
    expect(piAgentSource).not.toContain('!getBrowserToolEnabled()')
    expect(piAgentSource).not.toContain("d.name !== 'mcp__session__browser_tool'")
  })

  it('excludes mcp__session__browser_tool via SDK excludeTools when toggle is off', () => {
    // The subprocess must set the denylist from the init flag (default keeps the tool).
    expect(serverSource).toContain("excludeTools: initConfig.browserToolEnabled === false ? ['mcp__session__browser_tool'] : undefined")
  })
})
