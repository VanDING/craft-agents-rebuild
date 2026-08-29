import { describe, expect, it } from 'bun:test'
import type { ActivityItem } from '@craft-agent/ui'
import { collectFileActivity } from '../file-activity'

function activity(input: Partial<ActivityItem>): ActivityItem {
  return { id: 'a', type: 'tool', status: 'completed', timestamp: 1, ...input } as ActivityItem
}

describe('collectFileActivity', () => {
  it('normalizes read, search and multi-file edit tools', () => {
    const result = collectFileActivity([
      activity({ id: 'read', toolName: 'Read', toolInput: { file_path: 'a.ts' }, timestamp: 1 }),
      activity({ id: 'search', toolName: 'Grep', toolInput: { path: 'src' }, timestamp: 2 }),
      activity({ id: 'edit', toolName: 'Edit', toolInput: { changes: [{ path: 'b.ts' }, { path: 'c.ts' }] }, timestamp: 3 }),
    ])
    expect(result.map(record => record.operation)).toEqual(['edit', 'edit', 'search', 'read'])
    expect(result.map(record => record.path)).toContain('c.ts')
  })
})
