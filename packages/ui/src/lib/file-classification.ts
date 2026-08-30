/**
 * File type classification for the link interceptor.
 *
 * Classifies file paths by extension to determine whether the app can show
 * an in-app preview overlay, and if so, which type of preview to use.
 * Used by useLinkInterceptor to decide between in-app preview vs. opening externally.
 */

import {
  registeredFileExtensions,
  resolveFileFormat,
} from '@craft-agent/shared/artifacts/browser'

/** Preview types that map to specific overlay components */
export type FilePreviewType = 'image' | 'code' | 'markdown' | 'json' | 'text' | 'pdf'

export interface FileClassification {
  /** The preview type, or null if no in-app preview is available */
  type: FilePreviewType | null
  /** Whether the file can be previewed in-app */
  canPreview: boolean
}

/**
 * Image formats — rendered in ImagePreviewOverlay via data URL.
 * Only includes formats Chromium can natively decode.
 * HEIC/HEIF and TIFF are excluded — Chromium has no codec for these,
 * so they fall through to system open (external app).
 */
/**
 * Classify a file path by extension to determine preview capability.
 *
 * Priority order when an extension matches multiple sets (e.g. svg):
 * image > code > markdown > json > text > pdf
 */
export function classifyFile(filePath: string, mimeType?: string): FileClassification {
  const definition = resolveFileFormat(filePath, mimeType)
  if (definition.id === 'unknown') return { type: null, canPreview: false }
  if (definition.preview === 'image') return { type: 'image', canPreview: true }
  if (definition.preview === 'markdown') return { type: 'markdown', canPreview: true }
  if (definition.preview === 'json') return { type: 'json', canPreview: true }
  if (definition.preview === 'pdf') return { type: 'pdf', canPreview: true }
  if (definition.preview === 'text' || definition.preview === 'html') {
    return { type: definition.id === 'source-code' || definition.preview === 'html' ? 'code' : 'text', canPreview: true }
  }
  return { type: null, canPreview: false }
}

/**
 * Regex alternation of all known file extensions (e.g. "ts|tsx|js|...").
 * Derived from the classification sets above so link detection stays in sync
 * with preview support automatically.
 */
export const FILE_EXTENSIONS_PATTERN = [
  ...registeredFileExtensions(),
].map((extension) => extension.replaceAll('.', '\\.')).join('|')
