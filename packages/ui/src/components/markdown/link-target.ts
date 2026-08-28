import { isFilePathTarget } from './linkify'

export type ResolvedMarkdownLinkTarget =
  | { kind: 'file'; path: string }
  | { kind: 'url'; url: string }

function normalizeFileUrlPath(path: string): string {
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
}

/**
 * Percent-decode a bare file path so a link destination with %20 (the only
 * CommonMark-legal way to encode a space in a bare destination) resolves to the
 * real on-disk path. No-op when there's no '%'; falls back to the raw string if
 * the value isn't valid percent-encoding (#944).
 */
function decodeFilePath(path: string): string {
  if (!path.includes('%')) return path
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/** Remove editor-style source locations without confusing a Windows drive colon. */
function stripSourceLocation(target: string): string {
  return target
    .replace(/#L\d+(?:C\d+)?$/i, '')
    .replace(/:(\d+)(?::\d+)?$/, '')
}

/**
 * `isFilePathTarget` intentionally uses a conservative markdown-link regex.
 * Normalize platform syntax only for classification, while returning the
 * original path to Electron. This covers Windows drive/UNC paths, encoded or
 * literal spaces, and clickable `:line[:column]` source references.
 */
function resolveBareFilePath(target: string): string | null {
  const withoutLocation = stripSourceLocation(target)
  const windowsDrivePath = /^[A-Za-z]:[\\/]/.test(withoutLocation)

  let classificationTarget = withoutLocation
    .replace(/\\/g, '/')
    .replace(/ /g, '%20')

  // The shared classifier does not include `:` in its generic relative-path
  // branch. Treat the drive root as a POSIX root for classification only.
  if (windowsDrivePath) classificationTarget = classificationTarget.slice(2)

  if (!isFilePathTarget(classificationTarget)) return null
  return decodeFilePath(withoutLocation)
}

function resolveFileUrlPath(target: string): string | null {
  if (!/^file:/i.test(target)) return null

  try {
    const parsed = new URL(target)
    if (parsed.protocol !== 'file:') return null

    const pathname = decodeURIComponent(parsed.pathname || '')
    if (!pathname && !parsed.hostname) return null

    if (parsed.hostname) {
      const hostname = decodeURIComponent(parsed.hostname)
      return normalizeFileUrlPath(`//${hostname}${pathname}`)
    }

    return normalizeFileUrlPath(pathname)
  } catch {
    return null
  }
}

/**
 * Resolve markdown link targets for click dispatch.
 *
 * - Raw filesystem paths are routed through onFileClick
 * - Explicit file:// URLs are normalized to filesystem paths and also routed through onFileClick
 * - Everything else is treated as a URL and routed through onUrlClick
 */
export function resolveMarkdownLinkTarget(target: string): ResolvedMarkdownLinkTarget {
  const trimmed = target.trim()

  const fileUrlPath = resolveFileUrlPath(trimmed)
  if (fileUrlPath) {
    return { kind: 'file', path: fileUrlPath }
  }

  const bareFilePath = resolveBareFilePath(trimmed)
  if (bareFilePath) {
    return { kind: 'file', path: bareFilePath }
  }

  return { kind: 'url', url: trimmed }
}

/**
 * Backward-compatible classifier for tests and existing callers that only need the kind.
 */
export function classifyMarkdownLinkTarget(target: string): 'file' | 'url' {
  return resolveMarkdownLinkTarget(target).kind
}
