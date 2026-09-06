/** Bundled authoring helper; synced with docs so it also works in packaged installs.
 * Run: bun ~/.craft-agent/docs/pages-scaffold.mjs <new-project-directory>
 * Only creates source files. Dependency installation and builds are explicit commands.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const json = (value) => JSON.stringify(value, null, 2) + '\n'

export const templateFiles = {
  'package.json': json({
    name: 'craft-page', private: true, version: '1.0.0', type: 'module',
    scripts: { build: 'node build.mjs', typecheck: 'tsc --noEmit' },
    dependencies: {
      react: '19.2.7', 'react-dom': '19.2.7',
      '@radix-ui/react-slot': '1.3.0', 'class-variance-authority': '0.7.1',
      clsx: '2.1.1', 'tailwind-merge': '3.6.0', 'lucide-react': '1.0.0',
    },
    devDependencies: {
      vite: '8.1.5', '@vitejs/plugin-react': '5.2.0',
      tailwindcss: '4.3.3', '@tailwindcss/vite': '4.3.3',
      typescript: '^5.9.3', '@types/react': '19.0.0', '@types/react-dom': '19.0.0',
    },
  }),
  '.gitignore': 'node_modules/\ndist/\n',
  'tsconfig.json': json({ compilerOptions: {
    target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
    strict: true, skipLibCheck: true, noEmit: true, esModuleInterop: true, types: ['vite/client'],
    baseUrl: '.', paths: { '@/*': ['./src/*'] },
  }, include: ['src'] }),
  'components.json': json({
    $schema: 'https://ui.shadcn.com/schema.json', style: 'new-york', rsc: false, tsx: true,
    tailwind: { config: '', css: 'src/styles.css', baseColor: 'neutral', cssVariables: true },
    iconLibrary: 'lucide',
    aliases: { components: '@/components', utils: '@/lib/utils', ui: '@/components/ui', lib: '@/lib', hooks: '@/hooks' },
  }),
  'page.json': json({ title: 'My Page', lang: 'en' }),
  'build.mjs': String.raw`import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const output = resolve(root, 'dist/index.html')
// A failed build must not leave an old artifact that could be imported by mistake.
await rm(output, { force: true })
const metadata = JSON.parse(await readFile(resolve(root, 'page.json'), 'utf8'))
const result = await build({
  root, configFile: false, envDir: false, publicDir: false,
  plugins: [react(), tailwind(), {
    name: 'pages-no-external-modules', enforce: 'pre',
    resolveId(id) {
      if (/^(?:https?:|\/\/|node:)/i.test(id)) {
        throw new Error('Pages dependencies must be bundled locally: ' + id)
      }
    },
  }],
  resolve: { alias: { '@': resolve(root, 'src') } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    write: false, sourcemap: false, cssCodeSplit: false,
    lib: { entry: resolve(root, 'src/main.tsx'), name: 'CraftPage', formats: ['iife'] },
    rolldownOptions: { output: { codeSplitting: false } },
  },
})
const outputs = (Array.isArray(result) ? result : [result]).flatMap(r => r.output)
const chunks = outputs.filter(o => o.type === 'chunk')
if (chunks.length !== 1 || chunks[0].imports.length || chunks[0].dynamicImports.length) {
  throw new Error('Pages requires one bundled script with no external imports')
}
const assets = outputs.filter(o => o.type === 'asset')
if (assets.some(o => !o.fileName.endsWith('.css'))) {
  throw new Error('Unbundled assets: import assets from src so Vite can inline them; workers are unsupported')
}
const css = assets.map(o => String(o.source)).join('\n')
// Reject remaining CSS imports and non-inline URLs. This is an artifact check,
// not a security sandbox; arbitrary JS network calls still belong in the bridge.
if (/@import\b/i.test(css) || /url\(\s*['"]?(?!data:|#)[^\s'")]/i.test(css)) {
  throw new Error('Pages CSS must not reference external files; import local assets for inlining')
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c])
// Raw-text HTML elements must not be terminated by strings in bundled code/CSS.
const js = chunks[0].code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '\\x3c!--')
const styles = css.replace(/<\/style/gi, '\\3c /style')
const html = '<!doctype html>\n<html lang="' + escapeHtml(metadata.lang ?? 'en') + '"><head>'
  + '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>' + escapeHtml(metadata.title ?? 'Craft Page') + '</title><style>' + styles + '</style>'
  + '</head><body><div id="root"></div><script>' + js + '</script></body></html>\n'
if (Buffer.byteLength(html) > 5 * 1024 * 1024) throw new Error('Built page exceeds the 5 MiB HTML limit')
await mkdir(dirname(output), { recursive: true })
await writeFile(output + '.tmp', html)
await rename(output + '.tmp', output)
console.log('Built ' + output + ' (' + Buffer.byteLength(html) + ' bytes). Import with contentFile; use kind interactive or live.')
`,
  'src/main.tsx': String.raw`import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)
`,
  'src/lib/utils.ts': String.raw`import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
`,
  'src/components/ui/button.tsx': String.raw`import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  { variants: {
    variant: {
      default: 'bg-primary text-primary-foreground hover:bg-primary/90',
      outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
      secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      ghost: 'hover:bg-accent hover:text-accent-foreground',
      destructive: 'bg-destructive text-white hover:bg-destructive/90',
      link: 'text-primary underline-offset-4 hover:underline',
    },
    size: {
      default: 'h-10 px-4 py-2', xs: 'h-7 rounded-md px-2', sm: 'h-9 rounded-md px-3', lg: 'h-11 rounded-md px-8',
      icon: 'size-10', 'icon-xs': 'size-7', 'icon-sm': 'size-9', 'icon-lg': 'size-11',
    },
  }, defaultVariants: { variant: 'default', size: 'default' } },
)

function Button({ className, variant, size, asChild = false, ...props }:
  React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}
export { Button, buttonVariants }
`,
  'src/hooks/use-page.ts': String.raw`import { useSyncExternalStore } from 'react'

export interface PageSnapshot {
  version: 1
  generatedAt: number
  kv: Record<string, unknown>
  series: Record<string, Array<{ t: number; v: number }>>
}

let snapshot: PageSnapshot | null = null
let nonce: string | null = null
const listeners = new Set<() => void>()
// Register before React renders and ask for init immediately: no effect timing race.
window.addEventListener('message', event => {
  if (event.source !== window.parent) return
  const msg = event.data
  if (!msg || msg.protocol !== 'craft-pages/v1') return
  if (msg.type === 'init' && typeof msg.payload?.nonce === 'string') {
    nonce = msg.payload.nonce
    snapshot = msg.payload.snapshot ?? null
  } else if (msg.type === 'data' && nonce !== null) {
    snapshot = msg.payload?.snapshot ?? null
  } else return
  listeners.forEach(listener => listener())
})
window.parent.postMessage({ protocol: 'craft-pages/v1', type: 'ready' }, '*')

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function usePageSnapshot() {
  return useSyncExternalStore(subscribe, () => snapshot, () => null)
}
// Call inside a click handler. Source actions/grant requests follow pages.md;
// keeping this send synchronous preserves the host's user-activation check.
export function postPageMessage(message: Record<string, unknown>) {
  if (!nonce) throw new Error('Page bridge is not ready')
  window.parent.postMessage({ ...message, protocol: 'craft-pages/v1', nonce }, '*')
}
`,
  'src/App.tsx': String.raw`import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePageSnapshot } from '@/hooks/use-page'

export function App() {
  const [count, setCount] = useState(0)
  const snapshot = usePageSnapshot()
  return <main className="mx-auto max-w-2xl space-y-6 p-8">
    <header className="space-y-2">
      <p className="text-sm text-muted-foreground">Craft Pages</p>
      <h1 className="text-3xl font-semibold tracking-tight">My Page</h1>
      <p className="text-muted-foreground">Build something useful with React and reusable components.</p>
    </header>
    <section className="rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
      <Button onClick={() => setCount(value => value + 1)}><Plus size={16} /> Count: {count}</Button>
      <p className="mt-4 text-sm text-muted-foreground" data-testid="snapshot-status">
        {snapshot ? 'Data updated: ' + new Date(snapshot.generatedAt).toLocaleString() : 'Waiting for page data…'}
      </p>
      {snapshot && <pre className="mt-3 overflow-auto text-xs">{JSON.stringify(snapshot.kv, null, 2)}</pre>}
    </section>
  </main>
}
`,
  'src/styles.css': String.raw`@import "tailwindcss";
@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(1 0 0); --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0); --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0); --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0); --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0); --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0); --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0); --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0); --input: oklch(0.922 0 0); --ring: oklch(0.708 0 0);
  --radius: 0.625rem;
}
@theme inline {
  --color-background: var(--background); --color-foreground: var(--foreground);
  --color-card: var(--card); --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover); --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary); --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted); --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent); --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border); --color-input: var(--input); --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px); --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius); --radius-xl: calc(var(--radius) + 4px);
}
@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground; margin: 0; font-family: system-ui, sans-serif; }
}
`,
}

export async function scaffoldPage(directory) {
  const target = resolve(directory)
  await mkdir(dirname(target), { recursive: true })
  // Fail on an existing directory, including an existing symlink. Never overwrite work.
  await mkdir(target)
  for (const [name, content] of Object.entries(templateFiles)) {
    const file = resolve(target, name)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content, { flag: 'wx' })
  }
  return target
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error('Usage: bun pages-scaffold.mjs <new-project-directory>')
    process.exitCode = 1
  } else {
    try {
      console.log('Created ' + await scaffoldPage(process.argv[2]))
      console.log('Next: cd into the project, bun install, bun run build; import dist/index.html with contentFile.')
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}
