import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { localScriptTargets } from './check-environment'

test('resolves script targets after cd without flagging workspace-relative assets as missing', () => {
  const root = resolve('/example')
  expect(localScriptTargets({
    assets: 'cd apps/electron && bun run scripts/copy-assets.ts',
    build: 'bun run vite build --config apps/webui/vite.config.ts',
    staged: 'bash scripts/typecheck-staged.sh',
    external: 'bun run tsc --noEmit',
  }, root)).toEqual([
    resolve(root, 'apps/electron/scripts/copy-assets.ts'),
    resolve(root, 'apps/webui/vite.config.ts'),
    resolve(root, 'scripts/typecheck-staged.sh'),
  ])
})

