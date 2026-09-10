import { lazy, Suspense } from 'react'
import type { MarkdownPdfBlockProps } from './MarkdownPdfBlock.impl'
export type { MarkdownPdfBlockProps } from './MarkdownPdfBlock.impl'

const Content = lazy(() => import('./MarkdownPdfBlock.impl').then(module => ({ default: module.MarkdownPdfBlock })))

export function MarkdownPdfBlock(props: MarkdownPdfBlockProps) {
  return <Suspense fallback={<div className="min-h-32 animate-pulse bg-foreground/[0.02]" aria-busy="true" />}>
    <Content {...props} />
  </Suspense>
}
