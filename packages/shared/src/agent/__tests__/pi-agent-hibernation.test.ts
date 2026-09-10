import { expect, test } from 'bun:test'
import { PiAgent } from '../pi-agent'
import type { BackendConfig } from '../backend/types'

test('hibernation requires every pending RPC and tool boundary to settle', () => {
  const agent = new PiAgent({ provider: 'pi', workspace: { id: 'ws', name: 'test', rootPath: '/tmp/unused-pi-idle' },
    session: { id: 'idle', workspaceRootPath: '/tmp/unused-pi-idle', createdAt: 1, lastUsedAt: 1 }, isHeadless: true } as BackendConfig)
  const runtime = agent as any
  try {
    expect(agent.canHibernate()).toBe(true)
    runtime._isProcessing = true
    expect(agent.canHibernate()).toBe(false)
    runtime._isProcessing = false
    for (const name of ['pendingPermissions', 'pendingToolExecutions', 'pendingMiniCompletions', 'pendingLlmQueries',
      'pendingEnsureSessionReady', 'pendingCompactions', 'pendingAutoCompactionToggles', 'pendingRuntimeConfigUpdates', 'bufferedDurableToolStarts']) {
      runtime[name].set('pending', {})
      expect(agent.canHibernate()).toBe(false)
      runtime[name].delete('pending')
      expect(agent.canHibernate()).toBe(true)
    }
  } finally {
    agent.destroy()
  }
})
