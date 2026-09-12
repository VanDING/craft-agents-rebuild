#!/usr/bin/env bun
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkEnvironment, root, run } from './check-environment'

checkEnvironment()
// Separate package processes preserve Bun mock isolation. No provider credentials required.
const groups: [string, string[]][] = [
  ['.', ['scripts/check-environment.test.ts']],
  ['packages/server-core', [
    'src/durable-runtime/coordinator.test.ts',
    'src/durable-runtime/process-crash.test.ts',
    'src/durable-runtime/projection-runner.test.ts',
    'src/sessions/idle-session-cache.test.ts',
    'src/tasks/TaskRunner.test.ts',
    'src/transport/__tests__/server-lifecycle.test.ts',
  ]],
  ['packages/shared', [
    'src/sessions/__tests__/persistence-queue.test.ts',
    'src/durable-runtime/recovery.test.ts',
    'src/config/__tests__/theme.test.ts',
  ]],
  ['packages/pi-agent-server', [
    'src/transport-delta.test.ts',
    'src/request-diagnostics.test.ts',
    'src/durable-model-stream.test.ts',
    'src/length-continuation.test.ts',
  ]],
  ['packages/ui', [
    'src/components/chat/__tests__/streaming-projection.test.ts',
    'src/components/chat/__tests__/turn-utils-grouping.test.ts',
  ]],
  ['apps/electron', [
    'src/renderer/atoms/__tests__/sessions.isolated.ts',
    'src/renderer/lib/__tests__/reconnect-recovery.test.ts',
  ]],
]

// Bun treats positional arguments as path filters, so a renamed or deleted file
// silently narrows the run and still exits 0. Resolve every entry up front.
const missing = groups.flatMap(([cwd, files]) =>
  files.map(file => resolve(root, cwd, file)).filter(absolute => !existsSync(absolute)))
if (missing.length) throw new Error(`Missing critical test files:\n${missing.join('\n')}`)

for (const [cwd, files] of groups) {
  // Global-mutating suites are `.isolated.ts` and must not share a process.
  const isolated = files.filter(file => file.includes('.isolated.'))
  const shared = files.filter(file => !file.includes('.isolated.'))
  const groupCwd = resolve(root, cwd)
  if (shared.length) await run(['test', ...shared.map(file => './' + file)], groupCwd)
  for (const file of isolated) await run(['test', './' + file], groupCwd)
}
