import { describe, expect, it } from 'bun:test'
import type { ActivityItem } from '@craft-agent/ui'
import { collectFileActivity, resolveFileActivityPath } from '../file-activity'

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

describe('resolveFileActivityPath', () => {
  it('resolves relative paths against the session working directory', () => {
    expect(resolveFileActivityPath('./src/../index.ts', '/workspace/project')).toBe('/workspace/project/index.ts')
  })

  it('preserves absolute POSIX and Windows paths', () => {
    expect(resolveFileActivityPath('/tmp/a.txt', '/workspace')).toBe('/tmp/a.txt')
    expect(resolveFileActivityPath('C:\\work\\a.txt', 'D:\\root')).toBe('C:\\work\\a.txt')
  })

  it('normalizes relative paths against a UNC working directory', () => {
    expect(resolveFileActivityPath('src\\..\\a.txt', '\\\\server\\share\\project')).toBe('\\\\server\\share\\project\\a.txt')
  })

  it('does not fabricate an absolute path without a working directory', () => {
    expect(resolveFileActivityPath('a.txt')).toBeUndefined()
  })
})
