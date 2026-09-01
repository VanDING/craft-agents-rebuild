import type { ArtifactEventSnapshot, ResolvedArtifact } from '@craft-agent/shared/artifacts/browser'

const PREVIEW_FENCE = /```(image-preview|pdf-preview|html-preview|markdown-preview)[^\S\r\n]*\r?\n([\s\S]*?)```/g

function normalizePath(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/').replace(/\/+$/, '')
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}

function artifactPaths(
  events: readonly ArtifactEventSnapshot[],
  artifacts: readonly ResolvedArtifact[],
): Set<string> {
  const liveById = new Map(artifacts.map((artifact) => [artifact.artifact.id, artifact]))
  const paths = new Set<string>()
  for (const event of events) {
    const live = liveById.get(event.artifactId)
    for (const path of [
      event.sourcePath,
      event.previewPath,
      live?.artifact.sourcePath,
      live?.activePath,
      live?.editablePath,
      ...((live?.artifact.previews ?? []).map((preview) => preview.path)),
    ]) {
      if (path) paths.add(normalizePath(path))
    }
  }
  return paths
}

function isArtifactPath(src: unknown, paths: ReadonlySet<string>): src is string {
  return typeof src === 'string' && paths.has(normalizePath(src))
}

/**
 * Remove native preview blocks already owned by an Artifact presentation.
 * Mixed galleries retain unrelated items; malformed blocks are left untouched.
 */
export function dedupeArtifactPreviews(
  markdown: string,
  events: readonly ArtifactEventSnapshot[],
  artifacts: readonly ResolvedArtifact[],
): string {
  if (!markdown || events.length === 0) return markdown
  const paths = artifactPaths(events, artifacts)
  if (paths.size === 0) return markdown

  let changed = false
  const deduped = markdown.replace(PREVIEW_FENCE, (original, language: string, payload: string) => {
    try {
      const spec = JSON.parse(payload) as { src?: unknown; items?: unknown; title?: unknown }
      if (isArtifactPath(spec.src, paths)) {
        changed = true
        return ''
      }
      if (!Array.isArray(spec.items)) return original

      const retained = spec.items.filter((item) => {
        if (!item || typeof item !== 'object') return true
        return !isArtifactPath((item as { src?: unknown }).src, paths)
      })
      if (retained.length === spec.items.length) return original
      changed = true
      if (retained.length === 0) return ''
      return `\`\`\`${language}\n${JSON.stringify({ ...spec, items: retained }, null, 2)}\n\`\`\``
    } catch {
      return original
    }
  })
  return changed ? deduped.replace(/\n{3,}/g, '\n\n').trim() : markdown
}
