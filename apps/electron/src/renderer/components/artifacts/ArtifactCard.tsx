import * as React from 'react'
import { AlertTriangle, Archive, Check, ChevronDown, ChevronRight, FileArchive, FileAudio, FileImage, FileText, FileVideo, Maximize2, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ArtifactEventSnapshot, ResolvedArtifact } from '@craft-agent/shared/artifacts/browser'
import { MarkdownDocBlock, MarkdownHtmlBlock, MarkdownImageBlock, MarkdownPdfBlock } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { FilePreviewContent } from '@/components/content-panels/FilePreviewContent'

interface ArtifactCardProps {
  event: ArtifactEventSnapshot
  live?: ResolvedArtifact
  onOpen: () => void
  onAccept?: () => Promise<void> | void
  onDiscard?: () => Promise<void> | void
  onRevise?: () => Promise<void> | void
}

function ArtifactIcon({ kind }: { kind: ArtifactEventSnapshot['kind'] }) {
  if (kind === 'image') return <FileImage className="h-5 w-5" />
  if (kind === 'pdf') return <FileArchive className="h-5 w-5" />
  if (kind === 'audio') return <FileAudio className="h-5 w-5" />
  if (kind === 'video') return <FileVideo className="h-5 w-5" />
  if (kind === 'archive') return <Archive className="h-5 w-5" />
  return <FileText className="h-5 w-5" />
}

export function ArtifactCard({ event, live, onOpen, onAccept, onDiscard, onRevise }: ArtifactCardProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = React.useState(false)
  const [expanded, setExpanded] = React.useState(true)
  const current = live?.artifact
  // Tool results and workspace broadcasts travel independently. Never let an
  // older live projection overwrite the newer replayable event snapshot.
  const liveIsCurrent = Boolean(current && current.updatedAt >= event.timestamp)
  const status = liveIsCurrent && current ? current.status : event.status
  const validation = liveIsCurrent && current ? current.validation : event.validation
  const previewPath = liveIsCurrent ? (live?.activePath ?? event.previewPath) : (event.previewPath ?? live?.activePath)
  const mimeType = liveIsCurrent && current ? current.mimeType : (event.mimeType ?? current?.mimeType)
  const previewSpec = previewPath ? JSON.stringify({ src: previewPath, title: event.title }) : ''
  const isMarkdown = Boolean(previewPath && (/\.md(?:own)?$/i.test(previewPath) || mimeType === 'text/markdown'))

  const run = async (action: (() => Promise<void> | void) | undefined) => {
    if (!action || busy) return
    setBusy(true)
    try { await action() } finally { setBusy(false) }
  }

  return (
    <section data-artifact-id={event.artifactId} className="mt-3 border-t border-border/50 pt-2.5">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1.5 text-left hover:bg-foreground/[0.025]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ArtifactIcon kind={event.kind} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{event.title}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{event.sourcePath}</span>
            {event.provenance?.model && (
              <span className="block truncate text-[10px] text-muted-foreground" title={event.provenance.prompt}>
                {[event.provenance.provider, event.provenance.model].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          <span className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            status === 'ready' && 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
            status === 'accepted' && 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
            status === 'conflict' && 'bg-destructive/10 text-destructive',
            (status === 'draft' || status === 'current') && 'bg-primary/10 text-primary',
            status === 'discarded' && 'bg-foreground/8 text-muted-foreground',
          )}>
            {t(`artifact.status.${status}`)}
          </span>
          <Maximize2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
        <button
          type="button"
          aria-label={expanded ? t('contentPanel.collapse') : t('contentPanel.expand')}
          onClick={() => setExpanded((value) => !value)}
          className="ml-1 rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {expanded && previewPath && (
        <div className="mt-2 overflow-hidden rounded-lg bg-foreground/[0.025]">
          {event.kind === 'image' ? (
            <MarkdownImageBlock
              code={previewSpec}
              className="m-0"
            />
          ) : event.kind === 'pdf' || mimeType === 'application/pdf' ? (
            <MarkdownPdfBlock code={previewSpec} className="m-0" />
          ) : event.kind === 'html' || mimeType === 'text/html' ? (
            <MarkdownHtmlBlock code={previewSpec} className="m-0" />
          ) : isMarkdown ? (
            <MarkdownDocBlock code={previewSpec} className="m-0" />
          ) : (
            <div className="h-80">
              <FilePreviewContent
                filePath={previewPath}
                mimeType={mimeType}
                onFileClick={() => onOpen()}
              />
            </div>
          )}
        </div>
      )}

      {expanded && (validation || ['draft', 'ready', 'conflict'].includes(status)) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 px-1 py-1 text-[11px] text-muted-foreground">
          {validation && (
            <span className="inline-flex items-center gap-1">
              {validation.valid
                ? <Check className="h-3 w-3 text-emerald-600" />
                : <AlertTriangle className="h-3 w-3 text-destructive" />}
              {validation.summary}
            </span>
          )}
          <span className="ml-auto flex items-center gap-3">
            {status === 'ready' && onRevise && (
              <button type="button" disabled={busy} onClick={() => void run(onRevise)} className="inline-flex items-center gap-1 font-semibold hover:text-foreground disabled:opacity-50">
                <RotateCcw className="h-3 w-3" /> {t('artifact.revise')}
              </button>
            )}
            {['draft', 'ready', 'conflict'].includes(status) && onDiscard && (
              <button type="button" disabled={busy} onClick={() => void run(onDiscard)} className="inline-flex items-center gap-1 font-semibold text-destructive disabled:opacity-50">
                <Trash2 className="h-3 w-3" /> {t('artifact.discard')}
              </button>
            )}
            {status === 'ready' && onAccept && (
              <button type="button" disabled={busy} onClick={() => void run(onAccept)} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 font-semibold text-primary-foreground disabled:opacity-50">
                <Check className="h-3 w-3" /> {t('artifact.accept')}
              </button>
            )}
          </span>
        </div>
      )}
    </section>
  )
}
