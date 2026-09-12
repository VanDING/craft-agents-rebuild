/**
 * End-to-end regression coverage for the remote-server token vault.
 *
 * Runs as an isolated Bun process because `CONFIG_DIR` is captured at module
 * load time from CRAFT_CONFIG_DIR. Setting it here before the dynamic import
 * keeps the test away from the developer's real ~/.craft-agent profile.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const configDir = mkdtempSync(join(tmpdir(), 'craft-remote-token-vault-'))
process.env.CRAFT_CONFIG_DIR = configDir

const storage = await import('../storage.ts')
const { getCredentialManager } = await import('../../credentials/manager.ts')
const { SecureStorageBackend, setCredentialKeyProvider } = await import('../../credentials/backends/secure-storage.ts')

// The credential store normally lives in ~/.craft-agent regardless of
// CRAFT_CONFIG_DIR, so point the process-global manager at a temp file. The
// injected key provider keeps the test independent from the machine id.
setCredentialKeyProvider({ id: 'test:remote-token-vault', getKey: () => new Uint8Array(32).fill(7) })
const credentialManager = getCredentialManager()
;(credentialManager as unknown as { backend: InstanceType<typeof SecureStorageBackend> }).backend =
  new SecureStorageBackend(join(configDir, 'credentials.enc'))

const workspaceRoot = join(configDir, 'workspaces', 'remote-ws')
mkdirSync(workspaceRoot, { recursive: true })
writeFileSync(
  join(workspaceRoot, 'config.json'),
  JSON.stringify({ id: 'ws-remote', name: 'Remote', slug: 'remote-ws', createdAt: Date.now(), updatedAt: Date.now() }, null, 2),
  'utf-8',
)

const configPath = join(configDir, 'config.json')
const WORKSPACE_ID = 'ws-remote'

function writeRootConfig(remoteServer: Record<string, unknown>): void {
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        workspaces: [
          {
            id: WORKSPACE_ID,
            name: 'Remote',
            rootPath: workspaceRoot,
            createdAt: Date.now(),
            remoteServer,
          },
        ],
        activeWorkspaceId: WORKSPACE_ID,
        activeSessionId: null,
      },
      null,
      2,
    ),
    'utf-8',
  )
}

describe('remote-server token vault', () => {
  it('migrates a plaintext config token into the vault and strips config.json', async () => {
    writeRootConfig({ url: 'ws://host:9100', token: 'plaintext-secret', remoteWorkspaceId: 'remote-1' })

    expect(await storage.migrateRemoteServerTokens()).toBe(1)

    const persisted = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(persisted.workspaces[0].remoteServer).toEqual({
      url: 'ws://host:9100',
      remoteWorkspaceId: 'remote-1',
    })
    expect(persisted.workspaces[0].remoteServer.token).toBeUndefined()
    expect(await storage.getRemoteServerToken(WORKSPACE_ID)).toBe('plaintext-secret')
  })

  it('keeps the stored token when reconnect metadata omits it, then replaces it when provided', async () => {
    await storage.updateWorkspaceRemoteServer(WORKSPACE_ID, {
      url: 'ws://host:9200',
      remoteWorkspaceId: 'remote-1',
      allowInsecureTls: true,
    })

    expect(await storage.getRemoteServerToken(WORKSPACE_ID)).toBe('plaintext-secret')
    let persisted = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(persisted.workspaces[0].remoteServer).toEqual({
      url: 'ws://host:9200',
      remoteWorkspaceId: 'remote-1',
      allowInsecureTls: true,
    })

    await storage.updateWorkspaceRemoteServer(WORKSPACE_ID, {
      url: 'ws://host:9300',
      token: 'rotated-secret',
      remoteWorkspaceId: 'remote-1',
    })

    expect(await storage.getRemoteServerToken(WORKSPACE_ID)).toBe('rotated-secret')
    persisted = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(JSON.stringify(persisted)).not.toContain('rotated-secret')
  })

  it('deletes the vault entry when the workspace is removed', async () => {
    expect(await storage.removeWorkspace(WORKSPACE_ID)).toBe(true)
    expect(await storage.getRemoteServerToken(WORKSPACE_ID)).toBeNull()
  })
})

afterAll(() => {
  rmSync(configDir, { recursive: true, force: true })
  delete process.env.CRAFT_CONFIG_DIR
})
