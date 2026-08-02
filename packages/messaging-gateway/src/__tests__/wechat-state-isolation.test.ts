import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  setStateDir,
  resolveStateDirForWorkspace,
  ensureStateDirForWorkspace,
} from '../adapters/wechat/ilink/storage/state-dir'
import {
  getSyncBufFilePath,
  saveGetUpdatesBuf,
  loadGetUpdatesBuf,
  clearSyncBuf,
} from '../adapters/wechat/ilink/storage/sync-buf'
import {
  saveWeixinAccount,
  loadWeixinAccount,
  clearWeixinAccount,
  listIndexedWeixinAccountIds,
  unregisterWeixinAccountId,
} from '../adapters/wechat/ilink/auth/accounts'
import {
  setContextToken,
  getContextToken,
  clearContextTokensForAccount,
} from '../adapters/wechat/ilink/messaging/inbound'

let stateDir: string
const WS_A = 'ws-alpha'
const WS_B = 'ws-beta'
const ACCOUNT = 'wxid-user-1'

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'wechat-state-isolation-'))
  setStateDir(stateDir)
})

afterEach(() => {
  setStateDir(undefined)
  rmSync(stateDir, { recursive: true, force: true })
})

describe('wechat workspace state isolation (M-6)', () => {
  it('resolveStateDirForWorkspace nests each workspace under the state dir', () => {
    const rootA = resolveStateDirForWorkspace(WS_A)
    const rootB = resolveStateDirForWorkspace(WS_B)
    expect(rootA).toBe(join(stateDir, WS_A))
    expect(rootB).toBe(join(stateDir, WS_B))
    expect(rootA).not.toBe(rootB)
  })

  it('ensureStateDirForWorkspace creates the workspace dir 0700', () => {
    const dir = ensureStateDirForWorkspace(WS_A)
    expect(existsSync(dir)).toBe(true)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
  })

  it('creates the missing parent state root 0700 first (fresh-machine ENOENT regression)', () => {
    // Simulate a machine where ~/.craft-agent/wechat has never been created:
    // the parent of the workspace dir is absent entirely.
    const missingRoot = join(tmpdir(), `wechat-missing-${Math.random().toString(36).slice(2)}`)
    setStateDir(missingRoot)
    try {
      const dir = ensureStateDirForWorkspace(WS_A)
      expect(existsSync(dir)).toBe(true)
      expect(statSync(dir).mode & 0o777).toBe(0o700)
      expect(statSync(missingRoot).mode & 0o777).toBe(0o700)
    } finally {
      setStateDir(stateDir)
      rmSync(missingRoot, { recursive: true, force: true })
    }
  })

  it('produces distinct sync-buf paths per workspace for the same account', () => {
    const rootA = resolveStateDirForWorkspace(WS_A)
    const rootB = resolveStateDirForWorkspace(WS_B)
    const pathA = getSyncBufFilePath(ACCOUNT, rootA)
    const pathB = getSyncBufFilePath(ACCOUNT, rootB)
    expect(pathA).not.toBe(pathB)
    expect(pathA.startsWith(rootA)).toBe(true)
    expect(pathB.startsWith(rootB)).toBe(true)
  })

  it('sync-buf writes/reads/clears are scoped to the workspace root', () => {
    const rootA = resolveStateDirForWorkspace(WS_A)
    const rootB = resolveStateDirForWorkspace(WS_B)
    const pathA = getSyncBufFilePath(ACCOUNT, rootA)
    const pathB = getSyncBufFilePath(ACCOUNT, rootB)

    saveGetUpdatesBuf(pathA, 'cursor-a', rootA)
    saveGetUpdatesBuf(pathB, 'cursor-b', rootB)

    expect(loadGetUpdatesBuf(pathA)).toBe('cursor-a')
    expect(loadGetUpdatesBuf(pathB)).toBe('cursor-b')

    clearSyncBuf(ACCOUNT, rootA)
    expect(existsSync(pathA)).toBe(false)
    expect(existsSync(pathB)).toBe(true)
    expect(loadGetUpdatesBuf(pathB)).toBe('cursor-b')
  })

  it('account credentials and the index are scoped per workspace', () => {
    const rootA = resolveStateDirForWorkspace(WS_A)
    const rootB = resolveStateDirForWorkspace(WS_B)

    saveWeixinAccount(ACCOUNT, { token: 'tok-a' }, rootA)

    expect(loadWeixinAccount(ACCOUNT, rootA)?.token).toBe('tok-a')
    expect(loadWeixinAccount(ACCOUNT, rootB)).toBeNull()
    expect(listIndexedWeixinAccountIds(rootA)).toEqual([ACCOUNT])
    expect(listIndexedWeixinAccountIds(rootB)).toEqual([])

    // Per-account file exists under A only.
    const accountFileA = join(rootA, 'openclaw-weixin', 'accounts', `${ACCOUNT}.json`)
    const accountFileB = join(rootB, 'openclaw-weixin', 'accounts', `${ACCOUNT}.json`)
    expect(existsSync(accountFileA)).toBe(true)
    expect(existsSync(accountFileB)).toBe(false)
    // The workspace root is 0700 even when created by the persistence helper.
    expect(statSync(rootA).mode & 0o777).toBe(0o700)

    clearWeixinAccount(ACCOUNT, rootA)
    unregisterWeixinAccountId(ACCOUNT, rootA)
    expect(existsSync(accountFileA)).toBe(false)
    expect(listIndexedWeixinAccountIds(rootA)).toEqual([])
  })

  it('context tokens are namespaced in memory per workspace', () => {
    const rootA = resolveStateDirForWorkspace(WS_A)
    const rootB = resolveStateDirForWorkspace(WS_B)

    setContextToken(ACCOUNT, 'user-1', 'token-from-a', rootA)
    setContextToken(ACCOUNT, 'user-1', 'token-from-b', rootB)

    expect(getContextToken(ACCOUNT, 'user-1', rootA)).toBe('token-from-a')
    expect(getContextToken(ACCOUNT, 'user-1', rootB)).toBe('token-from-b')
    // Non-scoped reads never see workspace tokens.
    expect(getContextToken(ACCOUNT, 'user-1')).toBeUndefined()

    clearContextTokensForAccount(ACCOUNT, rootA)
    expect(getContextToken(ACCOUNT, 'user-1', rootA)).toBeUndefined()
    expect(getContextToken(ACCOUNT, 'user-1', rootB)).toBe('token-from-b')
  })
})
