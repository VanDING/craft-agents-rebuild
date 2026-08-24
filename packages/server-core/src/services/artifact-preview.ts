import { MarkItDown } from 'markitdown-js'
import { extname } from 'node:path'
import {
  putArtifactTextPreview,
  type ArtifactStorageScope,
  type ResolvedArtifact,
} from '@craft-agent/shared/artifacts'

const OFFICE_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsm', '.docx', '.doc', '.pptx', '.ppt'])

/**
 * Create a distributable, dependency-local human preview for standard Office
 * artifacts. MarkItDown is already shipped with CraftAgent and does not require
 * LibreOffice/ONLYOFFICE or a network service.
 */
export async function renderOfficeArtifactPreview(
  scope: ArtifactStorageScope,
  resolved: ResolvedArtifact,
): Promise<ResolvedArtifact> {
  const isOfficeBinary = resolved.artifact.mimeType.includes('officedocument')
    || OFFICE_EXTENSIONS.has(extname(resolved.artifact.sourcePath).toLowerCase())
  if (!isOfficeBinary) return resolved
  const revision = resolved.artifact.draftRevision ?? resolved.artifact.currentRevision
  if (!revision || !resolved.activePath) {
    throw new Error(`Office artifact ${resolved.artifact.id} has no renderable revision`)
  }
  const converter = new MarkItDown()
  const result = await converter.convert(resolved.activePath)
  const markdown = result?.textContent?.trim() || '_No previewable text content._'
  return putArtifactTextPreview(scope, resolved.artifact.id, {
    revision,
    text: `${markdown}\n`,
    kind: 'markdown',
  })
}
