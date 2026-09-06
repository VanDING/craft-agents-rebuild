import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { scaffoldPage } from '../../../resources/docs/pages-scaffold.mjs'

// Real compiler integration, using installed repository dependencies; no network.
describe('Pages React single-file build', () => {
  let temporary
  let project
  function build() {
    return spawnSync(process.execPath, ['build.mjs'], { cwd: project, encoding: 'utf8', timeout: 30000 })
  }
  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'pages-react-build-'))
    project = await scaffoldPage(join(temporary, 'project'))
    const repoModules = fileURLToPath(new URL('../../../../../node_modules', import.meta.url))
    await symlink(repoModules, resolve(project, 'node_modules'), 'junction')
  })
  afterAll(async () => { await rm(temporary, { recursive: true, force: true }) })

  it('does not overwrite an existing authoring project', async () => {
    await expect(scaffoldPage(project)).rejects.toThrow()
  })

  it('bundles React, component dependencies, Tailwind and imported assets with safe HTML delimiters', async () => {
    await writeFile(join(project, 'src/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')
    const app = await readFile(join(project, 'src/App.tsx'), 'utf8')
    await writeFile(join(project, 'src/App.tsx'), 'import icon from "./icon.svg"\n' + app.replace('<header', '<img src={icon} alt="test" /><header'))
    const main = join(project, 'src/main.tsx')
    await writeFile(main, await readFile(main, 'utf8') + '\nconsole.log("</ScRiPt><script>bad()</script><!--")\n')
    const result = build()
    expect(result.status, result.stdout + result.stderr).toBe(0)
    const html = await readFile(join(project, 'dist/index.html'), 'utf8')
    expect(html).toContain('data:image/svg+xml')
    expect(html).toContain('.text-3xl')
    expect(html).toContain('craft-pages/v1')
    expect(html.match(/<\/script\s*>/gi)).toHaveLength(1)
    expect(html).not.toMatch(/<script[^>]+src=/i)
    expect(html).not.toMatch(/<link\b/i)
    expect(Buffer.byteLength(html)).toBeLessThan(5 * 1024 * 1024)
  }, 30000)

  it('fails on external CSS assets and removes the previous artifact', async () => {
    const styles = join(project, 'src/styles.css')
    await writeFile(styles, await readFile(styles, 'utf8') + '\nbody { background-image: url(https://example.com/image.png) }\n')
    const result = build()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('CSS must not reference external files')
    await expect(readFile(join(project, 'dist/index.html'))).rejects.toThrow()
  }, 30000)
})
