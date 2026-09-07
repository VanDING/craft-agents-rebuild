import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createViewer, officePlugin, type FileViewer } from '@open-file-viewer/core'
import viewerStyles from '@open-file-viewer/core/style.css?inline'
import { resolveFileFormat } from '@craft-agent/shared/artifacts/browser'

const FRAME_DOCUMENT = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data: blob:; base-uri 'none'; form-action 'none'"><body style="margin:0;height:100vh"><div id="viewer" style="height:100%"></div></body>`

/** Library code runs in Craft; document nodes live in a script-disabled frame. */
export default function OfficeFilePreview({ filePath, mimeType }: { filePath: string; mimeType?: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const { i18n, t } = useTranslation()
  const [loaded, setLoaded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!loaded) return
    const doc = frame.current?.contentDocument
    const host = doc?.getElementById('viewer')
    if (!doc || !host) return
    let stale = false
    let viewer: FileViewer | undefined
    const styles = doc.createElement('style')
    styles.textContent = viewerStyles
    doc.head.append(styles)
    // docx-preview writes its generated style container to the host document.
    // Mirror those rules into the frame; static library styles stay isolated.
    const documentStyles = doc.createElement('style')
    doc.head.append(documentStyles)
    const syncStyles = () => {
      documentStyles.textContent = Array.from(document.head.querySelectorAll('style.ofv-docx-style-container'))
        .map(node => node.textContent ?? '').join('\n')
    }
    const observer = new MutationObserver(syncStyles)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    const blockNavigation = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (target?.closest?.('a')) event.preventDefault()
    }
    doc.addEventListener('click', blockNavigation, true)
    setError(undefined)
    void window.electronAPI.readFileBinary(filePath).then(bytes => {
      if (stale) return
      const format = resolveFileFormat(filePath, mimeType)
      if (format.validation === 'ooxml' && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) {
        throw new Error(t('filePreview.decodeFailed'))
      }
      viewer = createViewer({
        container: host,
        file: new Blob([new Uint8Array(bytes)], { type: mimeType ?? format.mimeType }),
        fileName: `preview.${format.extensions[0] ?? 'bin'}`,
        mimeType: mimeType ?? format.mimeType,
        width: '100%', height: '100%', fit: 'width', theme: 'auto',
        locale: i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US',
        plugins: [officePlugin()],
        toolbar: { download: false, print: false, fullscreen: false, search: true },
        onError: cause => { if (!stale) setError(cause.message) },
      })
    }).catch(cause => { if (!stale) setError(String(cause)) })
    return () => {
      stale = true
      observer.disconnect()
      doc.removeEventListener('click', blockNavigation, true)
      viewer?.destroy()
      host.replaceChildren()
      styles.remove()
      documentStyles.remove()
    }
  }, [filePath, mimeType, i18n.language, loaded, attempt, t])
  return <div className="flex h-full min-h-0 flex-col">
    {error && <div role="alert" className="p-3 text-sm text-destructive"><p>{error}</p>
      <button type="button" className="mt-2 underline" onClick={() => setAttempt(value => value + 1)}>{t('filePreview.retry')}</button>
    </div>}
    <iframe ref={frame} title={t('filePreview.office')} sandbox="allow-same-origin" srcDoc={FRAME_DOCUMENT}
      onLoad={() => setLoaded(true)} className="min-h-0 w-full flex-1 border-0 bg-white" />
  </div>
}
