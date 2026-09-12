#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { checkEnvironment, root, run } from './check-environment'

checkEnvironment()
// Real production bundlers, without signing, publishing, OAuth or model requests.
for (const script of [
  'electron:build:main', 'electron:build:preload', 'electron:build:renderer',
  'webui:build', 'viewer:build',
]) await run(['run', script])

// Exercise the actual server distribution assembly, then resolve its imports
// outside the source tree. Native runtime downloads/installers are release checks.
const cache = join(root, '.cache')
mkdirSync(cache, { recursive: true })
const output = mkdtempSync(join(cache, 'server-build-smoke-'))
try {
  await run(['run', 'scripts/build-server.ts', '--skip-download', '--output=' + relative(root, output)])
  const entry = join(output, 'packages/server/src/index.ts')
  if (!existsSync(entry)) throw new Error(`Missing assembled server entry: ${entry}`)
  const child = Bun.spawn([process.execPath, 'run', entry, '--generate-token'], {
    cwd: output, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, CRAFT_CONFIG_DIR: join(output, 'config') },
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  if (code !== 0 || !/^[a-zA-Z0-9_-]{32,}\s*$/.test(stdout)) {
    throw new Error(`Server distribution import smoke failed (${code}): ${stderr.slice(-2000)}`)
  }
  console.log('Server distribution entry point resolved successfully.')
} finally {
  rmSync(output, { recursive: true, force: true })
}
