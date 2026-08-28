// A/B: A = one recursive watcher; B = two recursive watchers on sibling dirs.
const mode = process.argv[2] ?? 'B'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { watch } from 'fs'

const root = mkdtempSync(join(tmpdir(), `fsab-${mode}-`))
const dirA = join(root, 'dir-a')
const dirB = join(root, 'dir-b')
mkdirSync(dirA, { recursive: true })
mkdirSync(dirB, { recursive: true })

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

let hitsA = 0
let hitsB = 0
const wA = watch(dirA, { recursive: true }, () => { hitsA++ })
const wB = mode === 'B' ? watch(dirB, { recursive: true }, () => { hitsB++ }) : null

await delay(50)
writeFileSync(join(dirA, 'a.ts'), 'x')
writeFileSync(join(dirB, 'b.ts'), 'x')
await delay(1000)
console.log(`mode=${mode} hitsA=${hitsA} hitsB=${hitsB}`)
wA.close()
wB?.close()
rmSync(root, { recursive: true, force: true })
