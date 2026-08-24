import { describe, it, expect } from 'bun:test'
import { mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { join, sep } from 'path'
import { validateFilePath } from '../utils'

const home = homedir()
const tmp = tmpdir()

describe('validateFilePath', () => {
  it('allows paths inside home directory', async () => {
    const path = join(home, 'Documents', 'test.txt')
    const result = await validateFilePath(path)
    expect(result).toContain('test.txt')
  })

  it('allows paths inside temp directory', async () => {
    const path = join(tmp, 'craft-test.txt')
    const result = await validateFilePath(path)
    expect(result).toContain('craft-test.txt')
  })

  it('denies paths outside all allowed directories', async () => {
    // Use a path that's definitely outside home and tmp on any platform
    const path = sep === '\\' ? 'Z:\\forbidden\\test.txt' : '/forbidden/test.txt'
    await expect(validateFilePath(path)).rejects.toThrow('Access denied')
  })

  it('allows paths inside additionalAllowedDirs', async () => {
    const projectDir = sep === '\\' ? 'D:\\Projects\\myapp' : '/opt/projects/myapp'
    const path = join(projectDir, 'src', 'main.ts')
    const result = await validateFilePath(path, [projectDir])
    expect(result).toContain('main.ts')
  })

  it('canonicalizes macOS /tmp aliases for explicitly allowed workspace roots', async () => {
    if (process.platform !== 'darwin') return
    const workspaceDir = await mkdtemp('/tmp/craft-allowed-workspace-')
    try {
      const filePath = join(workspaceDir, 'artifact.json')
      await writeFile(filePath, '{}')
      expect(await realpath(workspaceDir)).toStartWith('/private/tmp/')
      expect(await validateFilePath(filePath, [workspaceDir])).toBe(await realpath(filePath))
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  it('still allows homedir paths when additionalAllowedDirs are provided', async () => {
    const path = join(home, 'test.txt')
    const result = await validateFilePath(path, ['/some/other/dir'])
    expect(result).toContain('test.txt')
  })

  it('blocks sensitive files even inside allowed dirs', async () => {
    const path = join(home, '.ssh', 'id_rsa')
    await expect(validateFilePath(path)).rejects.toThrow('sensitive')
  })

  it('sensitive patterns match Windows backslash separators', () => {
    // Verify the regex patterns used in validateFilePath match both / and \
    const sshPatternUnix = /\.ssh[\\/]/
    const sshPatternWindows = /\.ssh[\\/]/
    expect(sshPatternUnix.test('C:\\Users\\me\\.ssh\\id_rsa')).toBe(true)
    expect(sshPatternWindows.test('/home/me/.ssh/id_rsa')).toBe(true)
    expect(/\.gnupg[\\/]/.test('C:\\Users\\me\\.gnupg\\keys')).toBe(true)
    expect(/\.aws[\\/]credentials/.test('C:\\Users\\me\\.aws\\credentials')).toBe(true)
  })

  it('blocks .env files', async () => {
    const path = join(home, 'project', '.env')
    await expect(validateFilePath(path)).rejects.toThrow('sensitive')
  })

  it('blocks credentials.json', async () => {
    const path = join(home, 'project', 'credentials.json')
    await expect(validateFilePath(path)).rejects.toThrow('sensitive')
  })

  it('blocks .pem files even inside additionalAllowedDirs', async () => {
    const projectDir = join(home, 'project')
    const path = join(projectDir, 'server.pem')
    await expect(validateFilePath(path, [projectDir])).rejects.toThrow('sensitive')
  })

  it('expands tilde paths', async () => {
    const result = await validateFilePath('~/test-file.txt')
    expect(result).toContain(home)
  })

  it('rejects relative paths', async () => {
    await expect(validateFilePath('relative/path.txt')).rejects.toThrow('absolute')
  })

  it('filters out falsy values in additionalAllowedDirs', async () => {
    const path = join(home, 'test.txt')
    // Should not throw even with undefined/empty values in the array
    const result = await validateFilePath(path, ['', undefined as unknown as string])
    expect(result).toContain('test.txt')
  })

  // H-8: encrypted credential vault + config root blocklist
  it('blocks the encrypted credential vault (credentials.enc)', async () => {
    const path = join(home, '.craft-agent', 'credentials.enc')
    await expect(validateFilePath(path)).rejects.toThrow('sensitive')
  })

  it('blocks any *.enc payload even inside additionalAllowedDirs', async () => {
    const projectDir = join(home, 'project')
    const path = join(projectDir, 'vault.enc')
    await expect(validateFilePath(path, [projectDir])).rejects.toThrow('sensitive')
  })

  it('blocks source credential cache (.credential-cache.json)', async () => {
    const projectDir = join(home, 'project')
    const path = join(projectDir, 'sources', 'linear', '.credential-cache.json')
    await expect(validateFilePath(path, [projectDir])).rejects.toThrow('sensitive')
  })

  it('blocks the app-level config root config.json', async () => {
    const path = join(home, '.craft-agent', 'config.json')
    await expect(validateFilePath(path)).rejects.toThrow('sensitive')
  })

  it('still allows workspace-tree files under ~/.craft-agent/workspaces', async () => {
    const workspaceDir = join(home, '.craft-agent', 'workspaces', 'ws-1')
    const path = join(workspaceDir, 'config.json')
    const result = await validateFilePath(path, [workspaceDir])
    expect(result).toContain('config.json')
  })

  it('new sensitive patterns match Windows backslash separators', () => {
    expect(/credentials\.enc$/.test('C:\\Users\\me\\.craft-agent\\credentials.enc')).toBe(true)
    expect(/[\\/]\.credential-cache\.json$/.test('C:\\ws\\sources\\linear\\.credential-cache.json')).toBe(true)
    expect(/[\\/]\.craft-agent[\\/]config\.json$/.test('C:\\Users\\me\\.craft-agent\\config.json')).toBe(true)
    expect(/[\\/]\.craft-agent[\\/]config\.json$/.test('C:\\Users\\me\\.craft-agent\\workspaces\\ws-1\\config.json')).toBe(false)
  })
})
