import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolvePageContentInput } from './content-input'
import { buildPagesToolCallbacks } from './tool-callbacks'

describe('Pages compiled HTML import', () => {
  let parent: string
  let workspace: string
  const html = '<!doctype html><html><body><script>window.example = 1</script></body></html>'
  beforeAll(() => {
    parent = mkdtempSync(join(tmpdir(), 'page-content-'))
    workspace = join(parent, 'workspace')
    mkdirSync(join(workspace, 'page-src', 'dist'), { recursive: true })
    writeFileSync(join(workspace, 'page-src/dist/index.html'), html)
    writeFileSync(join(parent, 'outside.html'), html)
    symlinkSync(join(parent, 'outside.html'), join(workspace, 'escape.html'))
    writeFileSync(join(workspace, 'empty.html'), '')
    writeFileSync(join(workspace, 'large.html'), Buffer.alloc(5 * 1024 * 1024 + 1))
    writeFileSync(join(workspace, 'bad.html'), Buffer.from([0xff]))
    writeFileSync(join(workspace, 'secret.txt'), 'not HTML')
  })
  afterAll(() => rmSync(parent, { recursive: true, force: true }))

  it('accepts workspace-relative/absolute HTML and keeps inline content compatible', async () => {
    expect(await resolvePageContentInput(workspace, { contentFile: 'page-src/dist/index.html' })).toBe(html)
    expect(await resolvePageContentInput(workspace, { contentFile: join(workspace, 'page-src/dist/index.html') })).toBe(html)
    expect(await resolvePageContentInput(workspace, { content: '<p>old API</p>' })).toBe('<p>old API</p>')
    expect(await resolvePageContentInput(workspace, {})).toBeUndefined()
  })

  it('rejects ambiguous inputs, escape paths, invalid UTF-8 and oversized files', async () => {
    await expect(resolvePageContentInput(workspace, { content: html, contentFile: 'empty.html' })).rejects.toThrow('not both')
    for (const contentFile of ['../outside.html', join(parent, 'outside.html'), 'escape.html']) {
      await expect(resolvePageContentInput(workspace, { contentFile })).rejects.toThrow('inside the workspace')
    }
    await expect(resolvePageContentInput(workspace, { contentFile: 'empty.html' })).rejects.toThrow('empty')
    await expect(resolvePageContentInput(workspace, { contentFile: 'large.html' })).rejects.toThrow('5 MiB')
    await expect(resolvePageContentInput(workspace, { contentFile: 'bad.html' })).rejects.toThrow()
    await expect(resolvePageContentInput(workspace, { contentFile: 'secret.txt' })).rejects.toThrow('.html')
  })

  it('imports through managed storage, updates digests/notifications, and fails before metadata changes', async () => {
    const notifications: string[] = []
    const thumbnails: string[] = []
    const callbacks = buildPagesToolCallbacks({
      workspaceId: 'test', workspaceRootPath: workspace,
      onPagesMutated: slug => { notifications.push(slug) },
      onContentChanged: slug => { thumbnails.push(slug) },
    })
    const created = await callbacks.createPage({ name: 'React Page', kind: 'live', contentFile: 'page-src/dist/index.html' })
    expect((await callbacks.getPage(created.slug, { includeContent: true }))?.content).toBe(html)
    writeFileSync(join(workspace, 'page-src/dist/index.html'), html.replace('= 1', '= 2'))
    const updated = await callbacks.updatePage(created.slug, { contentFile: 'page-src/dist/index.html' })
    expect(updated.contentDigest).not.toBe(created.contentDigest)
    expect(notifications).toEqual([created.slug, created.slug])
    expect(thumbnails).toEqual(notifications)
    await expect(callbacks.updatePage(created.slug, { name: 'Bad update', contentFile: 'missing.html' })).rejects.toThrow()
    expect((await callbacks.getPage(created.slug))?.name).toBe('React Page')
    expect(notifications.length).toBe(2)
  })
})
