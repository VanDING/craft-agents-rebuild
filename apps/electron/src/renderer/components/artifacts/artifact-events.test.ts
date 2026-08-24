import { describe, expect, it } from 'bun:test'
import type { ActivityItem } from '@craft-agent/ui'
import { ARTIFACT_EVENT_PREFIX, type ArtifactEventSnapshot } from '@craft-agent/shared/artifacts/browser'
import { artifactEventsForTurn } from './artifact-events'

function event(overrides: Partial<ArtifactEventSnapshot> = {}): ArtifactEventSnapshot {
  return {
    type: 'artifact_event',
    artifactId: 'artifact-1',
    sessionId: 'session-1',
    title: 'Report',
    kind: 'text',
    status: 'draft',
    revision: 'revision-1',
    sourcePath: '/workspace/report.txt',
    timestamp: 1,
    ...overrides,
  }
}

function activity(toolName: string, snapshot: ArtifactEventSnapshot, id = toolName): ActivityItem {
  return {
    id,
    type: 'tool',
    status: 'completed',
    timestamp: snapshot.timestamp,
    toolName,
    content: `${ARTIFACT_EVENT_PREFIX}${JSON.stringify(snapshot)}\nmodel-facing detail`,
  }
}

describe('artifactEventsForTurn', () => {
  it('accepts canonical and MCP-prefixed Artifact tools but ignores arbitrary prose', () => {
    const snapshot = event()
    const result = artifactEventsForTurn([
      activity('Write', snapshot, 'ignored'),
      activity('mcp__session__artifact_create', snapshot),
    ])

    expect(result).toEqual([snapshot])
  })

  it('keeps the latest event and ordering for each artifact in one turn', () => {
    const first = event({ artifactId: 'a', timestamp: 1, status: 'draft' })
    const second = event({ artifactId: 'b', timestamp: 2 })
    const final = event({ artifactId: 'a', timestamp: 3, status: 'ready' })

    expect(artifactEventsForTurn([
      activity('artifact_create', first, '1'),
      activity('artifact_create', second, '2'),
      activity('artifact_submit', final, '3'),
    ])).toEqual([second, final])
  })
})
