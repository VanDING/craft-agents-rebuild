import { useState, useCallback, useRef, useEffect } from 'react'

/** All fallback files use the same panel as Artifact Workbench. No eager reads. */
export interface FilePreviewState {
  filePath: string
  mimeType?: string
  fileSize?: number
}

interface LinkInterceptorOptions {
  openFileExternal: (path: string) => Promise<void>
  openUrl: (url: string) => Promise<void>
}

export function useLinkInterceptor(options: LinkInterceptorOptions) {
  const [previewState, setPreviewState] = useState<FilePreviewState | null>(null)
  const optionsRef = useRef(options)
  useEffect(() => { optionsRef.current = options }, [options])
  const handleOpenFile = useCallback((filePath: string, mimeType?: string, fileSize?: number) => {
    setPreviewState({ filePath, mimeType, fileSize })
  }, [])
  const openFileExternal = useCallback((path: string) => { void optionsRef.current.openFileExternal(path) }, [])
  const handleOpenUrl = useCallback((url: string) => { void optionsRef.current.openUrl(url) }, [])
  const closePreview = useCallback(() => setPreviewState(null), [])
  return { handleOpenFile, openFileExternal, handleOpenUrl, closePreview, previewState }
}
