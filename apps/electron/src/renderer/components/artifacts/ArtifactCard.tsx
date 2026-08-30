import * as React from 'react'
import { AlertTriangle, Archive, Check, ChevronDown, ChevronRight, FileArchive, FileAudio, FileImage, FileText, FileVideo, Maximize2, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ArtifactEventSnapshot, ResolvedArtifact } from '@craft-agent/shared/artifacts/browser'
import { cn } from '@/lib/utils'

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
  const [thumbnail, setThumbnail] = React.useState<string | null>(null)
  const current = live?.artifact

  React.useEffect(() => {
    let stale = false
    if (event.kind !== 'image' || !live?.activePath) {
      setThumbnail(null)
      return
    }
    window.electronAPI.readFilePreviewDataUrl(live.activePath, 720)
      .then((value) => { if (!stale) setThumbnail(value) })
      .catch(() => { if (!stale) setThumbnail(null) })
    return () => { stale = true }
  }, [event.kind, live?.activePath])

  const run = async (action: (() => Promise<void> | void) | undefined) => {
    if (!action || busy) return
    setBusy(true)
    try { await action() } finally { setBusy(false) }
  }

  return (
    <section className="mt-2 overflow-hidden rounded-xl border border-border/70 bg-card shadow-minimal">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-foreground/[0.025]"
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
            event.status === 'ready' && 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
            event.status === 'accepted' && 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
            event.status === 'conflict' && 'bg-destructive/10 text-destructive',
            (event.status === 'draft' || event.status === 'current') && 'bg-primary/10 text-primary',
            event.status === 'discarded' && 'bg-foreground/8 text-muted-foreground',
          )}>
            {t(`artifact.status.${event.status}`)}
          </span>
          <Maximize2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
        <button
          type="button"
          aria-label={expanded ? t('contentPanel.collapse') : t('contentPanel.expand')}
          onClick={() => setExpanded((value) => !value)}
          className="mr-2 rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {expanded && thumbnail && (
        <button type="button" onClick={onOpen} className="block max-h-48 w-full overflow-hidden border-t border-border/50 bg-foreground/[0.02]">
          <img src={thumbnail} alt={event.title} className="mx-auto max-h-48 object-contain" />
        </button>
      )}

      {expanded && (event.validation || (current && current.status !== event.status) || (current && ['draft', 'ready', 'conflict'].includes(current.status))) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-3 py-2 text-[11px] text-muted-foreground">
          {event.validation && (
            <span className="inline-flex items-center gap-1">
              {event.validation.valid
                ? <Check className="h-3 w-3 text-emerald-600" />
                : <AlertTriangle className="h-3 w-3 text-destructive" />}
              {event.validation.summary}
            </span>
          )}
          {current && current.status !== event.status && (
            <span>{t('artifact.currentStatus', { status: t(`artifact.status.${current.status}`) })}</span>
          )}
          <span className="ml-auto flex items-center gap-3">
            {current?.status === 'ready' && onRevise && (
              <button type="button" disabled={busy} onClick={() => void run(onRevise)} className="inline-flex items-center gap-1 font-semibold hover:text-foreground disabled:opacity-50">
                <RotateCcw className="h-3 w-3" /> {t('artifact.revise')}
              </button>
            )}
            {current && ['draft', 'ready', 'conflict'].includes(current.status) && onDiscard && (
              <button type="button" disabled={busy} onClick={() => void run(onDiscard)} className="inline-flex items-center gap-1 font-semibold text-destructive disabled:opacity-50">
                <Trash2 className="h-3 w-3" /> {t('artifact.discard')}
              </button>
            )}
            {current?.status === 'ready' && onAccept && (
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
