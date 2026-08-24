import * as React from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { IWorkbookData } from '@craft-agent/artifact-engine-univer'
import type { MountedUniverSheet } from '@craft-agent/artifact-engine-univer/renderer'
import { useTheme } from '@/context/ThemeContext'

export interface UniverSheetEditorHandle {
  saveSnapshot(): IWorkbookData | null
}

interface UniverSheetEditorProps {
  snapshotPath: string
  editable: boolean
  onDirtyChange?: (dirty: boolean) => void
}

export const UniverSheetEditor = React.forwardRef<UniverSheetEditorHandle, UniverSheetEditorProps>(
  function UniverSheetEditor({ snapshotPath, editable, onDirtyChange }, ref) {
    const { i18n, t } = useTranslation()
    const { isDark } = useTheme()
    const containerRef = React.useRef<HTMLDivElement>(null)
    const mountedRef = React.useRef<MountedUniverSheet | null>(null)
    const dirtyCallbackRef = React.useRef(onDirtyChange)
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const [mountedMode, setMountedMode] = React.useState<'editable' | 'read-only' | null>(null)

    React.useEffect(() => {
      dirtyCallbackRef.current = onDirtyChange
    }, [onDirtyChange])

    React.useImperativeHandle(ref, () => ({
      saveSnapshot: () => mountedRef.current?.save() ?? null,
    }), [])

    React.useEffect(() => {
      const container = containerRef.current
      if (!container) return
      let cancelled = false
      setLoading(true)
      setError(null)
      setMountedMode(null)
      dirtyCallbackRef.current?.(false)

      void (async () => {
        try {
          const [serialized, renderer] = await Promise.all([
            window.electronAPI.readFile(snapshotPath),
            import('@craft-agent/artifact-engine-univer/renderer'),
          ])
          const snapshot = JSON.parse(serialized) as IWorkbookData
          if (cancelled) return
          const mounted = await renderer.mountUniverSheet({
            container,
            snapshot,
            locale: i18n.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US',
            editable,
            darkMode: isDark,
            onChange: () => dirtyCallbackRef.current?.(true),
          })
          if (cancelled) {
            mounted.dispose()
            return
          }
          mountedRef.current = mounted
          setMountedMode(editable ? 'editable' : 'read-only')
          setLoading(false)
        } catch (cause) {
          if (cancelled) return
          setLoading(false)
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })()

      return () => {
        cancelled = true
        mountedRef.current?.dispose()
        mountedRef.current = null
      }
    }, [editable, i18n.language, isDark, snapshotPath])

    return (
      <div
        className="relative h-full min-h-0 w-full overflow-hidden bg-background"
        data-testid="univer-sheet-editor"
        data-mounted-mode={mountedMode ?? undefined}
      >
        <div ref={containerRef} tabIndex={-1} className="h-full w-full outline-none" data-testid="univer-sheet-canvas" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/90 text-sm text-muted-foreground" data-testid="univer-loading">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('artifact.univerLoading')}
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background p-6 text-center text-sm text-destructive" data-testid="univer-error">
            <span><AlertTriangle className="mx-auto mb-2 h-5 w-5" />{t('artifact.univerLoadFailed', { error })}</span>
          </div>
        )}
      </div>
    )
  },
)
