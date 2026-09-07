import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveFileTarget } from './file-target'

let root: string
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'craft-file-target-')))
  await mkdir(join(root, 'docs'))
  await writeFile(join(root, 'docs', '报告 100%.md'), '# report')
  await writeFile(join(root, 'same.md'), 'nearby file')
  await writeFile(join(root, '.env'), 'sensitive fixture')
  await symlink(join(root, '.env'), join(root, 'public.txt'))
})
afterAll(() => rm(root, { recursive: true, force: true }))

describe('exact file target resolution', () => {
  it('resolves Unicode and literal percent characters relative to the session directory', async () => {
    const file = await resolveFileTarget('./docs/报告 100%.md', { baseDirectory: root })
    expect(file).toMatchObject({ path: join(root, 'docs', '报告 100%.md'), type: 'file', mimeType: 'text/markdown' })
    expect(file.size).toBe(8)
  })
  it('resolves links relative to the source document rather than workspace or revision storage', async () => {
    const file = await resolveFileTarget('../same.md', { baseDirectory: '/', relativeTo: join(root, 'docs', '报告 100%.md') })
    expect(file.path).toBe(join(root, 'same.md'))
  })
  it('decodes file URLs exactly once', async () => {
    const path = join(root, 'docs', '报告 100%.md')
    expect((await resolveFileTarget(pathToFileURL(path).href, {})).path).toBe(path)
  })
  it('recognizes home and directory targets', async () => {
    expect((await resolveFileTarget('~', {})).path).toBe(await realpath(homedir()))
    expect((await resolveFileTarget(root, {})).type).toBe('directory')
  })
  it('does not replace a missing requested file with a nearby same-name file', async () => {
    await expect(resolveFileTarget('docs/same.md', { baseDirectory: root })).rejects.toThrow()
  })
  it('requires context for relative paths and rejects URI schemes', async () => {
    await expect(resolveFileTarget('same.md', {})).rejects.toThrow('working directory')
    await expect(resolveFileTarget('https://example.com/file.pdf', {})).rejects.toThrow('scheme')
    await expect(resolveFileTarget('x\0.md', {})).rejects.toThrow('Invalid')
  })
  it('applies path permissions including symlink destinations', async () => {
    await expect(resolveFileTarget(join(root, '.env'), {})).rejects.toThrow('sensitive')
    await expect(resolveFileTarget(join(root, 'public.txt'), {})).rejects.toThrow('sensitive')
    await expect(resolveFileTarget('/etc/passwd', {})).rejects.toThrow('outside allowed')
  })
})
