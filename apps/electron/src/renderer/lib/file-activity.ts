import type { ActivityItem } from '@craft-agent/ui'

export type FileActivityOperation = 'read' | 'search' | 'edit' | 'write'

export interface FileActivityRecord {
  id: string
  activityId: string
  operation: FileActivityOperation
  path: string
  timestamp: number
  status: ActivityItem['status']
  toolName: string
  parentId?: string
  depth: number
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

/** Resolve tool-reported relative paths against the session working directory. */
export function resolveFileActivityPath(path: string, workingDirectory?: string): string | undefined {
  const trimmed = path.trim()
  if (!trimmed) return undefined
  if (isAbsoluteFilePath(trimmed)) return trimmed
  if (!workingDirectory || !isAbsoluteFilePath(workingDirectory)) return undefined

  const windows = /^[a-zA-Z]:[\\/]/.test(workingDirectory) || workingDirectory.startsWith('\\\\')
  const slashPath = `${workingDirectory.replace(/\\/g, '/')}/${trimmed.replace(/\\/g, '/')}`
  const prefix = slashPath.startsWith('//') ? '//' : slashPath.match(/^[a-zA-Z]:/)?.[0] ?? '/'
  const body = prefix === '/' ? slashPath.slice(1) : slashPath.slice(prefix.length).replace(/^\/+/, '')
  const segments: string[] = []
  for (const segment of body.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  const resolved = prefix === '/'
    ? `/${segments.join('/')}`
    : prefix === '//'
      ? `//${segments.join('/')}`
      : `${prefix}/${segments.join('/')}`
  return windows ? resolved.replace(/\//g, '\\') : resolved
}

function operationFor(toolName: string): FileActivityOperation | undefined {
  const name = toolName.toLowerCase()
  if (name === 'edit' || name.includes('apply_patch')) return 'edit'
  if (name === 'write' || name.includes('write_file')) return 'write'
  if (name.includes('grep') || name.includes('glob') || name.includes('search') || name === 'find') return 'search'
  if (name === 'read' || name.includes('read_file') || name.includes('view')) return 'read'
  return undefined
}

function pathsFor(input: Record<string, unknown>): string[] {
  const paths = [input.file_path, input.path, input.directory, input.cwd]
    .map(stringValue)
    .filter((path): path is string => path !== undefined)
  if (Array.isArray(input.changes)) {
    for (const change of input.changes) {
      const path = stringValue((change as { path?: unknown })?.path)
      if (path) paths.push(path)
    }
  }
  return [...new Set(paths)]
}

export function collectFileActivity(activities: readonly ActivityItem[]): FileActivityRecord[] {
  return activities.flatMap(activity => {
    const toolName = activity.toolName ?? activity.displayName ?? ''
    const operation = operationFor(toolName)
    if (!operation || !activity.toolInput) return []
    return pathsFor(activity.toolInput).map((path, index) => ({
      id: `${activity.id}:${index}:${path}`,
      activityId: activity.id,
      operation,
      path,
      timestamp: activity.timestamp,
      status: activity.status,
      toolName,
      parentId: activity.parentId,
      depth: activity.depth ?? 0,
    }))
  }).sort((a, b) => b.timestamp - a.timestamp)
}
