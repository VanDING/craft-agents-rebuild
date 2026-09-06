import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

// Matches the published HTML limit. Keep large bundles out of tool messages.
const MAX_CONTENT_FILE_BYTES = 5 * 1024 * 1024

/** Import a built artifact, never execute a workspace build inside the server. */
export async function resolvePageContentInput(
  workspaceRootPath: string,
  input: { content?: string; contentFile?: string },
): Promise<string | undefined> {
  if (input.contentFile === undefined) return input.content
  if (input.content !== undefined) throw new Error('Provide content or contentFile, not both')
  if (!input.contentFile.trim()) throw new Error('contentFile must be a path to an HTML file')
  const root = await realpath(workspaceRootPath)
  const file = await realpath(resolve(root, input.contentFile))
  const rel = relative(root, file)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('contentFile must be inside the workspace (including symlink targets)')
  }
  if (!['.html', '.htm'].includes(extname(file).toLowerCase())) {
    throw new Error('contentFile must be an .html or .htm file')
  }
  // Nonblocking open lets stat reject special files without waiting on a FIFO.
  // Do not follow a final symlink substituted after realpath().
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('contentFile must be a regular file')
    if (stat.size > MAX_CONTENT_FILE_BYTES) throw new Error('contentFile exceeds the 5 MiB HTML limit')
    // Bound the read even if another process grows the file after stat().
    const bytes = Buffer.alloc(MAX_CONTENT_FILE_BYTES + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > MAX_CONTENT_FILE_BYTES) throw new Error('contentFile exceeds the 5 MiB HTML limit')
    const html = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length))
    if (!html.trim()) throw new Error('contentFile is empty')
    return html
  } finally {
    await handle.close()
  }
}
