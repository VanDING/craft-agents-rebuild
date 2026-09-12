import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { saveSession, type StoredSession } from '@craft-agent/shared/sessions'

export const workspaceId = 'performance-workspace'
export const profiles = {
  smoke: { sizes: [20, 100, 500], sessions: 6, repeats: 2, deltas: 30, soakSeconds: 3, writes: 3 },
  baseline: { sizes: [100, 1000, 5000], sessions: 24, repeats: 5, deltas: 200, soakSeconds: 60, writes: 10 },
} as const
export type ProfileName = keyof typeof profiles

export function fixtureSession(workspaceRootPath: string, index: number, messageCount: number): StoredSession {
  const id = `perf-${String(index).padStart(3, '0')}`
  const timestamp = Date.now() - messageCount * 1000
  return {
    id, name: `Performance ${index} (${messageCount} messages)`, workspaceRootPath,
    workingDirectory: workspaceRootPath, createdAt: timestamp, lastUsedAt: Date.now(),
    sessionStatus: 'todo', permissionMode: 'safe',
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
    messages: Array.from({ length: messageCount }, (_, i) => {
      const position = i % 4
      const content = position === 0
        ? `Investigate module ${i / 4}: describe the result and verify the change.`
        : position === 1
          ? `Read ${i}:\n${'export const result = { status: "verified", count: 42 };\n'.repeat(12)}`
          : `### Result ${i}\n\nThe measured operation completed successfully. ${'This deterministic fixture exercises Markdown rendering and transcript storage. '.repeat(5)}\n\n- Verify state\n- Record timing\n\n\`\`\`ts\nconst result = { count: ${i}, ok: true };\n\`\`\`\n\n${i === messageCount - 1 ? `PERF_END_${id}` : ''}`
      return {
        id: `${id}-message-${i}`, type: position === 0 ? 'user' : position === 1 ? 'tool' : 'assistant',
        content, timestamp: timestamp + i * 1000, turnId: `${id}-turn-${Math.floor(i / 4)}`,
        ...(position === 1 ? { toolName: 'Read', toolUseId: `${id}-tool-${i}`, toolStatus: 'completed' as const } : {}),
      }
    }),
  }
}

export async function seedFixtures(configDir: string, profile: ProfileName) {
  const workspaceRoot = join(configDir, 'workspaces', workspaceId)
  mkdirSync(workspaceRoot, { recursive: true })
  const workspace = { id: workspaceId, name: 'Performance', slug: 'performance', rootPath: workspaceRoot, createdAt: Date.now() }
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [workspace], activeWorkspaceId: workspaceId, activeSessionId: null,
    llmConnections: [], setupDeferred: true,
  }))
  writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({ ...workspace, updatedAt: Date.now() }))
  const sessions: { id: string; name: string; messageCount: number }[] = []
  const options = profiles[profile]
  for (let i = options.sessions - 1; i >= 0; i--) {
    const messageCount = options.sizes[i] ?? options.sizes[1]
    const session = fixtureSession(workspaceRoot, i, messageCount)
    await saveSession(session)
    sessions.unshift({ id: session.id, name: session.name!, messageCount })
  }
  return { workspaceRoot, sessions }
}
