import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Document, Page, pdfjs } from 'react-pdf'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker

export default function PdfPreview({ bytes, onError }: { bytes: Uint8Array; onError: (error: string) => void }) {
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
