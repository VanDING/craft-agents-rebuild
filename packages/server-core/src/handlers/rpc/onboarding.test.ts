import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

let deferred = false

mock.module('@craft-agent/shared/auth', () => ({
  getAuthState: async () => ({
    billing: {
      type: null,
      hasCredentials: false,
      apiKey: null,
      claudeOAuthToken: null,
      migrationRequired: false,
    },
    workspace: { hasWorkspace: true, active: { id: 'ws-test' } },
  }),
  getSetupNeeds: (_state: unknown, setupDeferred?: boolean) => ({
    needsBillingConfig: true,
    needsCredentials: false,
    isFullyConfigured: Boolean(setupDeferred),
    needsMigration: false,
  }),
  prepareClaudeOAuth() { throw new Error('not used') },
  exchangeClaudeCode() { throw new Error('not used') },
  hasValidOAuthState: () => false,
  clearOAuthState() {},
  prepareMcpOAuth() { throw new Error('not used') },
}))

mock.module('@craft-agent/shared/config', () => ({
  isSetupDeferred: () => deferred,
  setSetupDeferred: (value: boolean) => { deferred = value },
}))

mock.module('@craft-agent/shared/credentials', () => ({
  getCredentialManager: () => ({ setLlmOAuth: async () => {}, setClaudeOAuthCredentials: async () => {} }),
}))

mock.module('@craft-agent/shared/mcp', () => ({
  validateMcpConnection: async () => ({ success: true }),
}))

const context = { clientId: 'test-client', workspaceId: 'ws-test', webContentsId: 1 }

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps = {
    platform: {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  } as unknown as HandlerDeps

  return import('./onboarding').then(({ registerOnboardingHandlers }) => {
    registerOnboardingHandlers(server, deps)
    return (channel: string) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`Handler not registered: ${channel}`)
      return handler
    }
  })
}

describe('onboarding RPC handlers', () => {
  beforeEach(() => { deferred = false })

  it('honors the persisted setup-deferred flag when deriving setup needs', async () => {
    deferred = true
    const handler = await createHarness()

    const result = await handler(RPC_CHANNELS.onboarding.GET_AUTH_STATE)(context)

    expect(result.setupNeeds.isFullyConfigured).toBe(true)
    expect(result.setupNeeds.needsBillingConfig).toBe(true)
  })

  it('persists setup deferral through the defer handler', async () => {
    const handler = await createHarness()

    await handler(RPC_CHANNELS.onboarding.DEFER_SETUP)(context)

    expect(deferred).toBe(true)
  })
})
