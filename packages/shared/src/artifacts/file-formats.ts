import type { ArtifactKind } from './types.ts';

/** Rendering policy shared by Artifact storage and browser UI adapters. */
export type ArtifactPreviewStrategy =
  | 'text'
  | 'markdown'
  | 'json'
  | 'image'
  | 'pdf'
  | 'html'
  | 'office-markdown'
  | 'external';

/** Lightweight validation family. Complex document lint remains in doc-tools. */
export type ArtifactValidationFamily =
  | 'text'
  | 'json'
  | 'image'
  | 'pdf'
  | 'ooxml'
  | 'media'
  | 'archive'
  | 'generic';

export interface FileFormatDefinition {
  id: string;
  extensions: readonly string[];
  mimeType: string;
  artifactKind: ArtifactKind;
  preview: ArtifactPreviewStrategy;
  validation: ArtifactValidationFamily;
  /** True only when reading the complete file as UTF-8 is an intended operation. */
  safeText: boolean;
}

const format = (
  id: string,
  extensions: readonly string[],
  mimeType: string,
  artifactKind: ArtifactKind,
  preview: ArtifactPreviewStrategy,
  validation: ArtifactValidationFamily,
  safeText = false,
): FileFormatDefinition => ({
  id,
  extensions,
  mimeType,
  artifactKind,
  preview,
  validation,
  safeText,
});

/**
 * Canonical, browser-safe file format registry.
 *
 * Keep entries semantic rather than exhaustive per MIME alias: one entry may own
 * a family of extensions whose Artifact lifecycle and preview policy are equal.
 */
export const FILE_FORMAT_REGISTRY: readonly FileFormatDefinition[] = [
  format('plain-text', ['txt', 'log', 'cfg', 'ini', 'conf', 'rtf'], 'text/plain', 'text', 'text', 'text', true),
  format('markdown', ['md', 'mdx'], 'text/markdown', 'document', 'markdown', 'text', true),
  format('source-code', [
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'rs', 'go', 'java', 'kt', 'swift',
    'c', 'cpp', 'h', 'hpp', 'cs', 'css', 'scss', 'less', 'xml', 'yaml', 'yml', 'toml',
    'sh', 'bash', 'zsh', 'fish', 'sql', 'graphql', 'r', 'lua', 'pl', 'php', 'vue', 'svelte',
    'astro', 'prisma', 'dockerfile', 'makefile', 'gitignore', 'gitattributes', 'editorconfig',
    'npmrc', 'nvmrc', 'env', 'env.local', 'env.development', 'env.production',
  ], 'text/plain', 'text', 'text', 'text', true),
  format('html', ['html', 'htm'], 'text/html', 'html', 'html', 'text', true),
  format('json', ['json'], 'application/json', 'data', 'json', 'json', true),
  format('json-compatible', ['jsonc', 'json5'], 'application/json', 'data', 'text', 'text', true),
  format('notebook', ['ipynb'], 'application/x-ipynb+json', 'data', 'json', 'json', true),
  format('csv', ['csv'], 'text/csv', 'spreadsheet', 'text', 'text', true),
  format('tsv', ['tsv'], 'text/tab-separated-values', 'spreadsheet', 'text', 'text', true),
  format('calendar', ['ics'], 'text/calendar', 'data', 'text', 'text', true),

  format('png', ['png'], 'image/png', 'image', 'image', 'image'),
  format('jpeg', ['jpg', 'jpeg'], 'image/jpeg', 'image', 'image', 'image'),
  format('gif', ['gif'], 'image/gif', 'image', 'image', 'image'),
  format('webp', ['webp'], 'image/webp', 'image', 'image', 'image'),
  format('svg', ['svg'], 'image/svg+xml', 'image', 'image', 'image', true),
  format('bmp', ['bmp'], 'image/bmp', 'image', 'image', 'image'),
  format('icon', ['ico'], 'image/x-icon', 'image', 'image', 'image'),
  format('avif', ['avif'], 'image/avif', 'image', 'image', 'image'),
  format('heic', ['heic', 'heif'], 'image/heic', 'image', 'external', 'image'),
  format('tiff', ['tif', 'tiff'], 'image/tiff', 'image', 'external', 'image'),
  format('pdf', ['pdf'], 'application/pdf', 'pdf', 'pdf', 'pdf'),

  format('xlsx', ['xlsx'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'spreadsheet', 'office-markdown', 'ooxml'),
  format('xlsm', ['xlsm'], 'application/vnd.ms-excel.sheet.macroEnabled.12', 'spreadsheet', 'office-markdown', 'ooxml'),
  format('xls', ['xls'], 'application/vnd.ms-excel', 'spreadsheet', 'office-markdown', 'generic'),
  format('ods', ['ods'], 'application/vnd.oasis.opendocument.spreadsheet', 'spreadsheet', 'office-markdown', 'generic'),
  format('docx', ['docx'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document', 'office-markdown', 'ooxml'),
  format('doc', ['doc'], 'application/msword', 'document', 'office-markdown', 'generic'),
  format('odt', ['odt'], 'application/vnd.oasis.opendocument.text', 'document', 'office-markdown', 'generic'),
  format('pptx', ['pptx'], 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'presentation', 'office-markdown', 'ooxml'),
  format('ppt', ['ppt'], 'application/vnd.ms-powerpoint', 'presentation', 'office-markdown', 'generic'),
  format('odp', ['odp'], 'application/vnd.oasis.opendocument.presentation', 'presentation', 'office-markdown', 'generic'),

  format('audio-mpeg', ['mp3'], 'audio/mpeg', 'audio', 'external', 'media'),
  format('audio-wave', ['wav'], 'audio/wav', 'audio', 'external', 'media'),
  format('audio-flac', ['flac'], 'audio/flac', 'audio', 'external', 'media'),
  format('audio-aac', ['aac'], 'audio/aac', 'audio', 'external', 'media'),
  format('audio-mp4', ['m4a'], 'audio/mp4', 'audio', 'external', 'media'),
  format('audio-ogg', ['ogg', 'oga'], 'audio/ogg', 'audio', 'external', 'media'),
  format('video-mp4', ['mp4', 'm4v'], 'video/mp4', 'video', 'external', 'media'),
  format('video-webm', ['webm'], 'video/webm', 'video', 'external', 'media'),
  format('video-quicktime', ['mov'], 'video/quicktime', 'video', 'external', 'media'),
  format('video-avi', ['avi'], 'video/x-msvideo', 'video', 'external', 'media'),
  format('video-matroska', ['mkv'], 'video/x-matroska', 'video', 'external', 'media'),
  format('video-wmv', ['wmv'], 'video/x-ms-wmv', 'video', 'external', 'media'),

  format('zip', ['zip'], 'application/zip', 'archive', 'external', 'archive'),
  format('tar', ['tar'], 'application/x-tar', 'archive', 'external', 'archive'),
  format('compressed-archive', ['gz', 'tgz', 'bz2', 'xz', 'rar', '7z'], 'application/octet-stream', 'archive', 'external', 'archive'),
  format('installer', ['dmg', 'pkg', 'exe', 'msi'], 'application/octet-stream', 'file', 'external', 'generic'),
] as const;

export const UNKNOWN_FILE_FORMAT: FileFormatDefinition = Object.freeze({
  id: 'unknown',
  extensions: [],
  mimeType: 'application/octet-stream',
  artifactKind: 'file',
  preview: 'external',
  validation: 'generic',
  safeText: false,
});

const byExtension = new Map<string, FileFormatDefinition>();
const byMimeType = new Map<string, FileFormatDefinition>();
for (const definition of FILE_FORMAT_REGISTRY) {
  for (const extension of definition.extensions) byExtension.set(extension.toLowerCase(), definition);
  if (!definition.mimeType.endsWith('/*') && definition.mimeType !== 'application/octet-stream') {
    const normalizedMime = definition.mimeType.toLowerCase();
    if (!byMimeType.has(normalizedMime)) byMimeType.set(normalizedMime, definition);
  }
}

/** Returns the longest registered suffix, allowing names such as `.env.local`. */
export function getRegisteredExtension(filePath: string): string {
  const fileName = filePath.replaceAll('\\', '/').split('/').pop()?.toLowerCase() ?? '';
  if (!fileName) return '';
  const directName = fileName.startsWith('.') ? fileName.slice(1) : fileName;
  if (byExtension.has(directName)) return directName;
  const segments = fileName.split('.');
  for (let index = 1; index < segments.length; index += 1) {
    const suffix = segments.slice(index).join('.');
    if (byExtension.has(suffix)) return suffix;
  }
  return segments.length > 1 ? segments.at(-1) ?? '' : directName;
}

export function resolveFileFormat(filePath: string, explicitMimeType?: string): FileFormatDefinition {
  const extensionMatch = byExtension.get(getRegisteredExtension(filePath));
  if (extensionMatch) return extensionMatch;
  const normalizedMime = explicitMimeType?.split(';', 1)[0]?.trim().toLowerCase();
  if (normalizedMime) {
    const exact = byMimeType.get(normalizedMime);
    if (exact) return exact;
    const family = FILE_FORMAT_REGISTRY.find(({ mimeType }) => (
      mimeType.endsWith('/*') && normalizedMime.startsWith(mimeType.slice(0, -1))
    ));
    if (family) return family;
  }
  return UNKNOWN_FILE_FORMAT;
}

export function registeredFileExtensions(): string[] {
  return [...byExtension.keys()].sort();
}
