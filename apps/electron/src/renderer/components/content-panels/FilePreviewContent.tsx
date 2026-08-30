/**
 * FilePreviewContent - panel-embedded file preview (image / pdf / code / json / markdown).
 *
 * Same extension dispatch as App.tsx's FilePreviewRenderer, rendered WITHOUT the
 * overlay chrome so it fits inside the Preview panel (and later, panelless
 * contexts). Local reads go through window.electronAPI (readFile / dataUrl /
 * binary), matching the link interceptor's loaders.
 */

import { useEffect, useState } from 'react'
import { ExternalLink, FileQuestion } from 'lucide-react'
import { Document, Page } from 'react-pdf'
import { classifyFile, Markdown, Spinner } from '@craft-agent/ui'
import { resolveFileFormat } from '@craft-agent/shared/artifacts/browser'
import { useTranslation } from 'react-i18next'
import { ShikiCodeViewer } from '@/components/shiki/ShikiCodeViewer'
import { getLanguageFromPath } from '@/lib/file-utils'

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  )
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-sm whitespace-pre-wrap break-words text-destructive">{message}</p>
    </div>
  )
}

interface FilePreviewContentProps {
  /** Absolute file path to preview */
  filePath: string
  /** Markdown link clicks (e.g. open in app / browser) */
  onOpenUrl?: (url: string) => void
  /** Markdown file-path clicks (routes through the link interceptor) */
  onFileClick?: (path: string) => void
  /** Known Artifact MIME type, used by the safe fallback view. */
  mimeType?: string
  /** Active Artifact revision size, when this preview is opened from Workbench. */
  fileSize?: number
}
/** Cap on rendered text — beyond this the DOM/Shiki cost is prohibitive. */
const TEXT_PREVIEW_MAX_CHARS = 1_000_000
/** Probe window for NUL-byte binary detection. */
const BINARY_SNIFF_CHARS = 8_192

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`
  return `${(size / 1024 ** 3).toFixed(1)} GB`
}

export function FilePreviewContent({ filePath, onOpenUrl, onFileClick, mimeType, fileSize }: FilePreviewContentProps) {
  const { t } = useTranslation()
  const classification = classifyFile(filePath, mimeType)
  const type = classification.canPreview ? classification.type : null
  const definition = resolveFileFormat(filePath, mimeType)

  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [textContent, setTextContent] = useState<string | null>(null)
  const [textTruncated, setTextTruncated] = useState(false)
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null)
  const [loadError, setLoadError] = useState<string | undefined>()
  const [numPages, setNumPages] = useState(0)
  useEffect(() => {
    let stale = false
    setDataUrl(null)
    setTextContent(null)
    setTextTruncated(false)
    setPdfData(null)
    setNumPages(0)
    setLoadError(undefined)

    if (!type) return () => { stale = true }
    if (type === 'image') {
      window.electronAPI.readFileDataUrl(filePath)
        .then((url) => { if (!stale) setDataUrl(url) })
        .catch((err) => { if (!stale) setLoadError(err instanceof Error ? err.message : 'Failed to read image') })
    } else if (type === 'pdf') {
      window.electronAPI.readFileBinary(filePath)
        .then((data) => { if (!stale) setPdfData(data) })
        .catch((err) => { if (!stale) setLoadError(err instanceof Error ? err.message : 'Failed to read PDF') })
    } else {
      window.electronAPI.readFile(filePath)
        .then((content) => {
          if (stale) return
          if (content.slice(0, BINARY_SNIFF_CHARS).includes('\u0000')) {
            setLoadError('This file is binary and cannot be previewed as text. Open it externally instead.')
            return
          }
          setTextTruncated(content.length > TEXT_PREVIEW_MAX_CHARS)
          setTextContent(content.slice(0, TEXT_PREVIEW_MAX_CHARS))
        })
        .catch((err) => { if (!stale) setLoadError(err instanceof Error ? err.message : 'Failed to read file') })
    }
    return () => { stale = true }
  }, [filePath, type])

  if (loadError) {
    return <ErrorBlock message={loadError} />
  }

  if (!type) {
    const name = filePath.replaceAll('\\', '/').split('/').pop() || filePath
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md text-center">
          <FileQuestion className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
          <p className="truncate text-sm font-semibold" title={name}>{name}</p>
          <p className="mt-1 text-xs text-muted-foreground">{mimeType ?? definition.mimeType}</p>
          {fileSize !== undefined && <p className="mt-0.5 text-xs text-muted-foreground">{formatBytes(fileSize)}</p>}
          <p className="mt-3 text-sm text-muted-foreground">{t('artifact.previewUnavailable')}</p>
          {onFileClick && (
            <button
              type="button"
              className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-foreground/5"
              onClick={() => onFileClick(filePath)}
            >
              <ExternalLink className="h-3.5 w-3.5" /> {t('common.open')}
            </button>
          )}
        </div>
      </div>
    )
  }

  switch (type) {
    case 'image':
      return dataUrl
        ? (
            <div className="flex h-full items-center justify-center overflow-auto p-4">
              <img src={dataUrl} alt={filePath} className="max-h-full max-w-full object-contain" />
            </div>
          )
        : <Loading />

    case 'pdf':
      return pdfData ? (
        <div className="h-full overflow-auto p-4">
          <Document
            file={{ data: pdfData }}
            onLoadSuccess={({ numPages: pages }) => setNumPages(pages)}
            onLoadError={(err) => setLoadError(err instanceof Error ? err.message : 'Failed to load PDF')}
            className="m-auto"
          >
            {Array.from({ length: numPages }, (_, index) => (
              <Page key={index + 1} pageNumber={index + 1} width={660} className="mb-3 shadow-minimal" />
            ))}
          </Document>
        </div>
      ) : <Loading />
    case 'markdown':
      return textContent !== null ? (
        <div className="flex h-full min-h-0 flex-col">
          {textTruncated && (
            <div className="shrink-0 border-b border-border/50 px-4 py-1.5 text-[12px] text-muted-foreground">
              Preview truncated to the first {(TEXT_PREVIEW_MAX_CHARS / 1_000_000).toFixed(1).replace(/\.0$/, '')} MB — open externally for the full file.
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            <Markdown
              children={textContent}
              onUrlClick={onOpenUrl}
              onFileClick={onFileClick}
              collapsible={false}
            />
          </div>
        </div>
      ) : <Loading />

    default:
      // code / text / json — syntax-highlighted code view
      return textContent !== null ? (
        <div className="flex h-full min-h-0 flex-col">
          {textTruncated && (
            <div className="shrink-0 border-b border-border/50 px-4 py-1.5 text-[12px] text-muted-foreground">
              Preview truncated to the first {(TEXT_PREVIEW_MAX_CHARS / 1_000_000).toFixed(1).replace(/\.0$/, '')} MB — open externally for the full file.
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto py-2">
            <ShikiCodeViewer
              code={textContent}
              filePath={filePath}
              language={type === 'text' ? 'plaintext' : getLanguageFromPath(filePath)}
              startLine={1}
              className="min-w-full"
            />
          </div>
        </div>
      ) : <Loading />
  }
}
