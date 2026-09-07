import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, FileQuestion, RotateCcw } from 'lucide-react'
import { Document, Page, pdfjs } from 'react-pdf'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import JsonView from '@uiw/react-json-view'
import { Markdown, Spinner } from '@craft-agent/ui'
import { resolveFileFormat } from '@craft-agent/shared/artifacts/browser'
import { useTranslation } from 'react-i18next'
import { ShikiCodeViewer } from '@/components/shiki/ShikiCodeViewer'
import { getLanguageFromPath } from '@/lib/file-utils'
import { toast } from 'sonner'

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker

const OfficeFilePreview = lazy(() => import('./OfficeFilePreview'))
const TEXT_LIMIT = 1_000_000
const READ_LIMIT = 50 * 1024 * 1024
const MARKUP_POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'">`

interface FilePreviewContentProps {
  filePath: string
  onOpenUrl?: (url: string) => void
  onFileClick?: (path: string) => void
  mimeType?: string
  fileSize?: number
  /** Resolve links relative to the source document, not its immutable snapshot. */
  sourcePath?: string
}

function Loading() {
  return <div className="flex h-full items-center justify-center"><Spinner /></div>
}

export function FilePreviewContent(props: FilePreviewContentProps) {
  return <FilePreview key={`${props.filePath}:${props.mimeType ?? ''}`} {...props} />
}

function FilePreview(props: FilePreviewContentProps) {
  const { filePath, mimeType, fileSize } = props
  const { t } = useTranslation()
  const format = resolveFileFormat(filePath, mimeType)
  const office = format.preview === 'office-markdown' || ['csv', 'tsv'].includes(format.id)
  const markup = format.preview === 'html' || format.id === 'svg'
  const structured = format.preview === 'json' || format.id === 'mermaid'
  const canSwitch = format.preview === 'markdown' || markup || structured || ['csv', 'tsv'].includes(format.id)
  const media = format.artifactKind === 'audio' || format.artifactKind === 'video'
  const textFile = format.safeText && !office
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const [attempt, setAttempt] = useState(0)
  const [text, setText] = useState<string>()
  const [url, setUrl] = useState<string>()
  const [bytes, setBytes] = useState<Uint8Array>()
  const [error, setError] = useState<string>()
  const tooLarge = fileSize !== undefined && fileSize > READ_LIMIT
  const loadText = textFile || mode === 'source'

  useEffect(() => {
    if (tooLarge) return
    let stale = false
    let objectUrl: string | undefined
    setError(undefined)
    setText(undefined)
    setBytes(undefined)
    setUrl(undefined)
    const load = async () => {
      if (loadText) {
        const value = await window.electronAPI.readFile(filePath)
        if (value.slice(0, 8192).includes('\u0000')) throw new Error(t('filePreview.binary'))
        if (!stale) setText(value)
      } else if (media || format.preview === 'image') {
        const data = await window.electronAPI.readFileBinary(filePath)
        if (stale) return
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: mimeType ?? format.mimeType }))
        setUrl(objectUrl)
      } else if (format.preview === 'pdf') {
        const data = await window.electronAPI.readFileBinary(filePath)
        if (!stale) setBytes(data)
      }
    }
    void load().catch(cause => { if (!stale) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { stale = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [filePath, mimeType, loadText, media, format.mimeType, format.preview, attempt, tooLarge, t])

  const openExternal = async () => {
    try {
      // eslint-disable-next-line craft-links/no-direct-file-open -- explicit external-open action; never re-enters preview registration
      await window.electronAPI.openFile(filePath)
    } catch (cause) { toast.error(t('toast.failedToOpenFile'), { description: String(cause) }) }
  }
  const openLinkedFile = async (path: string) => {
    try {
      const resolved = await window.electronAPI.resolveFileTarget(path, undefined, props.sourcePath ?? filePath)
      props.onFileClick?.(resolved.path)
    } catch (cause) { toast.error(t('toast.failedToOpenFile'), { description: String(cause) }) }
  }
  const source = text === undefined ? <Loading /> : <div className="h-full overflow-auto">
    {text.length > TEXT_LIMIT && <p className="p-2 text-xs text-muted-foreground">{t('filePreview.truncated')}</p>}
    <ShikiCodeViewer code={text.slice(0, TEXT_LIMIT)} filePath={filePath} language={getLanguageFromPath(filePath)} startLine={1} />
  </div>
  let content
  if (tooLarge || error) {
    content = <div className="p-4 text-sm" role="alert">
      <p className="text-destructive">{tooLarge ? t('filePreview.tooLarge') : error}</p>
      {!tooLarge && <button type="button" className="mt-3 inline-flex items-center gap-1" onClick={() => setAttempt(value => value + 1)}><RotateCcw className="size-3" />{t('filePreview.retry')}</button>}
    </div>
  } else if (mode === 'source') content = source
  else if (office) content = <Suspense fallback={<Loading />}><OfficeFilePreview filePath={filePath} mimeType={mimeType} /></Suspense>
  else if (textFile) {
    if (text === undefined) content = <Loading />
    else if (text.length > TEXT_LIMIT) content = source
    else if (markup) content = <MarkupPreview text={text} sourcePath={props.sourcePath ?? filePath} />
    else if (format.preview === 'json') content = <JsonPreview text={text} />
    else if (format.preview === 'markdown' || format.id === 'mermaid') content = <div className="h-full overflow-auto p-4">
      <Markdown onUrlClick={props.onOpenUrl} onFileClick={path => void openLinkedFile(path)} collapsible={false}>
        {format.id === 'mermaid' ? `\`\`\`mermaid\n${text}\n\`\`\`` : text}
      </Markdown>
    </div>
    else content = source
  } else if (format.preview === 'pdf') content = bytes ? <PdfPreview bytes={bytes} onError={setError} /> : <Loading />
  else if (format.preview === 'image') content = url ? <div className="flex h-full items-center justify-center overflow-auto p-4"><img src={url} alt={filePath} className="max-h-full max-w-full object-contain" onError={() => setError(t('filePreview.decodeFailed'))} /></div> : <Loading />
  else if (media) content = url ? <div className="flex h-full items-center justify-center p-4">
    {format.artifactKind === 'audio'
      ? <audio controls preload="metadata" src={url} className="w-full" onError={() => setError(t('filePreview.decodeFailed'))} />
      : <video controls preload="metadata" src={url} className="max-h-full max-w-full" onError={() => setError(t('filePreview.decodeFailed'))} />}
  </div> : <Loading />
  else content = <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
    <FileQuestion className="size-9 text-muted-foreground" />
    <p className="break-all text-sm">{filePath.replaceAll('\\', '/').split('/').pop()}</p>
    <p className="text-xs text-muted-foreground">{mimeType ?? format.mimeType}{fileSize !== undefined ? ` · ${fileSize.toLocaleString()} B` : ''}</p>
    <p className="text-sm text-muted-foreground">{t('artifact.previewUnavailable')}</p>
  </div>

  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
      {canSwitch && <div role="group" aria-label={t('filePreview.viewMode')} className="flex gap-1">
        {(['preview', 'source'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value}
          className={`rounded px-2 py-1 text-xs ${mode === value ? 'bg-foreground/10' : 'hover:bg-foreground/5'}`}
          onClick={() => setMode(value)}>{t(`filePreview.${value}`)}</button>)}
      </div>}
      <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => void openExternal()}>
        <ExternalLink className="size-3" />{t('filePreview.openExternal')}
      </button>
    </div>
    <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
  </div>
}

function JsonPreview({ text }: { text: string }) {
  const value = useMemo(() => {
    try { return { data: JSON.parse(text) as unknown } } catch (cause) { return { error: String(cause) } }
  }, [text])
  return <div className="h-full overflow-auto p-4">
    {value.error ? <p role="alert" className="text-sm text-destructive">{value.error}</p>
      : value.data !== null && typeof value.data === 'object' ? <JsonView value={value.data} collapsed={2} style={{ background: 'transparent', color: 'inherit' }} />
        : <pre>{JSON.stringify(value.data)}</pre>}
  </div>
}

function MarkupPreview({ text, sourcePath }: { text: string; sourcePath: string }) {
  const { t } = useTranslation()
  const [html, setHtml] = useState<string>()
  useEffect(() => {
    let stale = false
    setHtml(undefined)
    const prepare = async () => {
      const doc = new DOMParser().parseFromString(text, 'text/html')
      doc.querySelectorAll('base, meta[http-equiv="refresh" i]').forEach(node => node.remove())
      const images = Array.from(doc.querySelectorAll('img[src], image[href], image[xlink\\:href]')).slice(0, 32)
      await Promise.all(images.map(async node => {
        const attribute = node.hasAttribute('src') ? 'src' : node.hasAttribute('href') ? 'href' : 'xlink:href'
        const path = node.getAttribute(attribute)!
        node.removeAttribute('srcset')
        if (/^(?:data:|blob:|https?:|\/\/|#)/i.test(path)) return
        try {
          const target = await window.electronAPI.resolveFileTarget(path, undefined, sourcePath)
          if (target.type !== 'file' || !target.mimeType.startsWith('image/') || target.size > 5 * 1024 * 1024) return
          const url = await window.electronAPI.readFileDataUrl(target.path)
          node.setAttribute(attribute, url)
        } catch { /* Missing assets remain blocked by frame CSP. */ }
      }))
      if (!stale) setHtml(MARKUP_POLICY + doc.documentElement.outerHTML)
    }
    void prepare().catch(() => { if (!stale) setHtml(MARKUP_POLICY + text) })
    return () => { stale = true }
  }, [text, sourcePath])
  return html === undefined ? <Loading /> : <iframe title={t('filePreview.preview')} sandbox="" srcDoc={html} className="h-full w-full border-0 bg-white" />
}

function PdfPreview({ bytes, onError }: { bytes: Uint8Array; onError: (error: string) => void }) {
  const { t } = useTranslation()
  const file = useMemo(() => ({ data: new Uint8Array(bytes) }), [bytes])
  const [pages, setPages] = useState(0)
  const [page, setPage] = useState(1)
  const [width, setWidth] = useState(660)
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(120, Math.min(1000, entries[0]!.contentRect.width - 32))))
    if (host.current) observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  return <div ref={host} className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center justify-center gap-3 border-b p-2 text-sm">
      <button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{t('filePreview.previous')}</button>
      <span>{page} / {pages || '…'}</span>
      <button type="button" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>{t('filePreview.next')}</button>
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-4"><Document file={file} onLoadSuccess={value => setPages(value.numPages)} onLoadError={cause => onError(cause.message)}>
      <Page pageNumber={page} width={width} />
    </Document></div>
  </div>
}
