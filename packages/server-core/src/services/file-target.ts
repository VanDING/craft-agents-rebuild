import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolveFileFormat } from '@craft-agent/shared/artifacts'
import type { ResolvedFileTarget } from '@craft-agent/shared/protocol'
import { validateFilePath } from '../handlers/utils'

/** Resolve the requested file exactly. Never substitute a nearby same-name file. */
export async function resolveFileTarget(
  input: string,
  options: { baseDirectory?: string; relativeTo?: string; allowedDirectories?: string[] },
): Promise<ResolvedFileTarget> {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0')) throw new Error('Invalid file path')
  let path = input.trim()
  if (/^file:/i.test(path)) path = fileURLToPath(path)
  else if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[A-Za-z]:[\\/]/.test(path)) {
    throw new Error('Unsupported file URI scheme')
  }
  if (path === '~' || path.startsWith('~/') || path.startsWith('~\\')) path = homedir() + path.slice(1)
  let base = options.baseDirectory
  if (!isAbsolute(path) && options.relativeTo) {
    const reference = await validateFilePath(options.relativeTo, options.allowedDirectories)
    base = dirname(reference)
  }
  if (!isAbsolute(path) && !base) throw new Error('A working directory is required to open a relative file path')
  const safePath = await validateFilePath(isAbsolute(path) ? path : resolve(base!, path), options.allowedDirectories)
  const info = await stat(safePath)
  if (!info.isFile() && !info.isDirectory()) throw new Error('Only regular files and directories can be opened')
  return { path: safePath, type: info.isDirectory() ? 'directory' : 'file', size: info.size, mimeType: resolveFileFormat(safePath).mimeType }
}
