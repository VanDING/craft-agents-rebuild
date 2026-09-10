import { lazy, Suspense } from 'react'
import type { PDFPreviewOverlayProps } from './PDFPreviewOverlay.impl'
export type { PDFPreviewOverlayProps } from './PDFPreviewOverlay.impl'

const Content = lazy(() => import('./PDFPreviewOverlay.impl').then(module => ({ default: module.PDFPreviewOverlay })))

export function PDFPreviewOverlay(props: PDFPreviewOverlayProps) {
  if (!props.isOpen) return null
  return <Suspense fallback={<div className="min-h-32 animate-pulse bg-foreground/[0.02]" aria-busy="true" />}>
    <Content {...props} />
  </Suspense>
}
