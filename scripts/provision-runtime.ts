import { join } from 'node:path'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { $ } from 'bun'
import { downloadBun, downloadUv, type Arch, type Platform } from './build/common'

const platform = process.argv[2] ?? process.platform
const arch = process.argv[3] ?? process.arch
if (!['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
  throw new Error(`Unsupported runtime target: ${platform}-${arch}`)
}
const rootDir = join(import.meta.dir, '..')
const config = {
  platform: platform as Platform,
  arch: arch as Arch,
  rootDir,
  electronDir: join(rootDir, 'apps', 'electron'),
  upload: false,
  uploadLatest: false,
  uploadScript: false,
}
await downloadBun(config)
await downloadUv(config)

// Stage ripgrep's wrapper and target-specific binary for electron-builder.
const rgSource = join(rootDir, 'node_modules', '@vscode', 'ripgrep')
const rgVersion = JSON.parse(readFileSync(join(rgSource, 'package.json'), 'utf8')).version as string
const targetPackage = `@vscode/ripgrep-${platform}-${arch}`
let binarySource = join(rootDir, 'node_modules', targetPackage)
let scratchDir: string | undefined
try {
  if (!existsSync(join(binarySource, 'package.json')) ||
      JSON.parse(readFileSync(join(binarySource, 'package.json'), 'utf8')).version !== rgVersion) {
    scratchDir = mkdtempSync(join(tmpdir(), 'craft-ripgrep-'))
    await $`bun install --cwd ${scratchDir} --ignore-scripts --no-save --os ${platform} --cpu ${arch} ${`${targetPackage}@${rgVersion}`}`
    binarySource = join(scratchDir, 'node_modules', targetPackage)
  }
  for (const [name, source] of [['@vscode/ripgrep', rgSource], [targetPackage, binarySource]] as const) {
    const destination = join(config.electronDir, 'node_modules', name)
    rmSync(destination, { recursive: true, force: true })
    mkdirSync(destination, { recursive: true })
    cpSync(source, destination, { recursive: true, dereference: true })
  }
} finally {
  if (scratchDir) rmSync(scratchDir, { recursive: true, force: true })
}
