/**
 * FilePreviewContent - panel-embedded file preview (image / pdf / code / json / markdown).
 *
 * Same extension dispatch as App.tsx's FilePreviewRenderer, rendered WITHOUT the
 * overlay chrome so it fits inside the Preview panel (and later, panelless
 * contexts). Local reads go through window.electronAPI (readFile / dataUrl /
 * binary), matching the link interceptor's loaders.
 */

import { useEffect, useState } from 'react'
import { Document, Page } from 'react-pdf'
import { classifyFile, Markdown, Spinner } from '@craft-agent/ui'
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
}

export function FilePreviewContent({ filePath, onOpenUrl, onFileClick }: FilePreviewContentProps) {
  const classification = classifyFile(filePath)
  const type = classification.canPreview ? (classification.type ?? 'text') : 'text'

  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [textContent, setTextContent] = useState<string | null>(null)
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null)
  const [loadError, setLoadError] = useState<string | undefined>()
  const [numPages, setNumPages] = useState(0)

  useEffect(() => {
    let stale = false
    setDataUrl(null)
    setTextContent(null)
    setPdfData(null)
    setNumPages(0)
    setLoadError(undefined)

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
        .then((content) => { if (!stale) setTextContent(content) })
        .catch((err) => { if (!stale) setLoadError(err instanceof Error ? err.message : 'Failed to read file') })
    }
    return () => { stale = true }
  }, [filePath, type])

  if (loadError) {
    return <ErrorBlock message={loadError} />
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
        <div className="h-full overflow-auto px-4 py-3">
          <Markdown
            children={textContent}
            onUrlClick={onOpenUrl}
            onFileClick={onFileClick}
            collapsible={false}
          />
        </div>
      ) : <Loading />

    default:
      // code / text / json — syntax-highlighted code view
      return textContent !== null ? (
        <div className="h-full overflow-auto py-2">
          <ShikiCodeViewer
            code={textContent}
            filePath={filePath}
            language={type === 'text' ? 'plaintext' : getLanguageFromPath(filePath)}
            startLine={1}
            className="min-w-full"
          />
        </div>
      ) : <Loading />
  }
}
