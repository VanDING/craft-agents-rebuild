import * as React from 'react'
import { AlertTriangle, Check, Eye, FilePenLine, RotateCcw, Save, Send, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useAppShellContext } from '@/context/AppShellContext'
import { useArtifacts } from '@/hooks/useArtifacts'
import { Button } from '@/components/ui/button'
import { PanelHeader } from '../app-shell/PanelHeader'
import { PanelEmptyState } from './PanelEmptyState'
import { FilePreviewContent } from './FilePreviewContent'

export function ArtifactWorkbench({ artifactId }: { artifactId: string }) {
  const { t } = useTranslation()
  const { activeWorkspaceId, onOpenFile } = useAppShellContext()
  const artifactStore = useArtifacts(activeWorkspaceId ?? null)
  const resolved = artifactStore.artifacts.find(({ artifact }) => artifact.id === artifactId)
  const artifact = resolved?.artifact
  const activeRevision = artifact?.draftRevision ?? artifact?.currentRevision
  const activeRevisionSize = artifact?.revisions.find((revision) => revision.id === activeRevision)?.size
  const renderedPreviewPath = artifact?.previews.find((preview) => (
    preview.revision === activeRevision
    && preview.path
    && (preview.kind === 'markdown' || preview.kind === 'html' || preview.kind === 'text')
  ))?.path
  const [editing, setEditing] = React.useState(false)
  const [draftText, setDraftText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const leaseIdRef = React.useRef<string | null>(null)
  const draftRevisionRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    draftRevisionRef.current = artifact?.draftRevision ?? null
  }, [artifact?.draftRevision])

  const releaseLease = React.useCallback(async () => {
    const leaseId = leaseIdRef.current
    if (!leaseId || !activeWorkspaceId) return
    leaseIdRef.current = null
    try { await window.electronAPI.releaseArtifactLease(activeWorkspaceId, artifactId, leaseId) } catch {
      // Lease expiry is the recovery path if the window closes while disconnected.
    }
  }, [activeWorkspaceId, artifactId])

  React.useEffect(() => () => { void releaseLease() }, [releaseLease])

  const startEditing = async () => {
    if (!artifact?.capabilities.edit) return
    setBusy(true)
    try {
      const leased = await artifactStore.acquireLease(artifactId)
      const leaseId = leased.artifact.lease?.id
      leaseIdRef.current = leaseId ?? null
      if (!leaseId || !leased.editablePath) {
        throw new Error(t('artifact.editLeaseFailed'))
      }
      draftRevisionRef.current = leased.artifact.draftRevision
      setDraftText(await window.electronAPI.readFile(leased.editablePath))
      setEditing(true)
    } catch (cause) {
      await releaseLease()
      toast.error(cause instanceof Error ? cause.message : t('artifact.editLeaseFailed'))
    } finally {
      setBusy(false)
    }
  }

  const saveDraft = async () => {
    if (!draftRevisionRef.current || !leaseIdRef.current) throw new Error(t('artifact.editLeaseFailed'))
    const saved = await artifactStore.apply(artifactId, {
      expectedRevision: draftRevisionRef.current,
      leaseId: leaseIdRef.current,
      operation: { type: 'set_text', text: draftText },
    })
    if (saved?.artifact.draftRevision) draftRevisionRef.current = saved.artifact.draftRevision
    return saved
  }

  const save = async () => {
    setBusy(true)
    try {
      await saveDraft()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('artifact.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  const cancelEditing = async () => {
    setEditing(false)
    await releaseLease()
    await artifactStore.refresh()
  }

  const submit = async () => {
    setBusy(true)
    try {
      const saved = editing ? await saveDraft() : resolved
      if (!saved?.artifact.draftRevision) {
        throw new Error(t('artifact.submitFailed'))
      }
      await artifactStore.submit(
        artifactId,
        saved.artifact.draftRevision,
        leaseIdRef.current ?? undefined,
      )
      leaseIdRef.current = null
      setEditing(false)
      toast.success(t('artifact.readyForReview'))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('artifact.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  const accept = async () => {
    setBusy(true)
    try {
      const result = await artifactStore.accept(artifactId)
      if (!result.accepted) toast.error(t('artifact.conflictDetected'))
      else toast.success(t('artifact.accepted'))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('artifact.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  const discard = async () => {
    if (!window.confirm(t('artifact.discardConfirm'))) return
    setBusy(true)
    try {
      await artifactStore.discard(artifactId)
      leaseIdRef.current = null
      setEditing(false)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('artifact.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  const revise = async () => {
    setBusy(true)
    try {
      await artifactStore.revise(artifactId)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('artifact.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (artifactStore.isLoading && !resolved) {
    return <PanelEmptyState title={t('artifact.loading')} icon={<Eye className="h-6 w-6" />} />
  }
  if (!resolved || !artifact) {
    return <PanelEmptyState title={artifactStore.error ?? t('artifact.notFound')} icon={<AlertTriangle className="h-6 w-6" />} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="artifact-workbench">
      <PanelHeader title={artifact.title} centerTitleInPanel />
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
          {t(`artifact.status.${artifact.status}`)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={artifact.sourcePath}>
          {artifact.sourcePath}
        </span>
        {artifact.provenance?.model && (
          <span
            className="max-w-48 truncate rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] text-muted-foreground"
            title={artifact.provenance.prompt}
            data-testid="artifact-provenance"
          >
            {[artifact.provenance.provider, artifact.provenance.model].filter(Boolean).join(' · ')}
          </span>
        )}
        {artifact.status === 'draft' && artifact.capabilities.edit && !editing && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void startEditing()} data-testid="artifact-edit">
            <FilePenLine className="mr-1.5 h-3.5 w-3.5" /> {t('artifact.edit')}
          </Button>
        )}
        {editing && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void save()} data-testid="artifact-save">
              <Save className="mr-1.5 h-3.5 w-3.5" /> {t('common.save')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancelEditing()}>
              <X className="mr-1.5 h-3.5 w-3.5" /> {t('common.cancel')}
            </Button>
          </>
        )}
        {artifact.status === 'draft' && (
          <Button size="sm" disabled={busy} onClick={() => void submit()} data-testid="artifact-submit">
            <Send className="mr-1.5 h-3.5 w-3.5" /> {t('artifact.submit')}
          </Button>
        )}
        {artifact.status === 'ready' && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void revise()}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {t('artifact.revise')}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void accept()} data-testid="artifact-accept">
              <Check className="mr-1.5 h-3.5 w-3.5" /> {t('artifact.accept')}
            </Button>
          </>
        )}
        {['draft', 'ready', 'conflict'].includes(artifact.status) && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void discard()} className="text-destructive hover:text-destructive">
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> {t('artifact.discard')}
          </Button>
        )}
      </div>

      {artifact.validation && (
        <div className={`border-b border-border/50 px-3 py-2 text-xs ${artifact.validation.valid ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive'}`}>
          <span className="font-semibold">{artifact.validation.summary}</span>
          {artifact.validation.errors.map((error) => <div key={error}>{error}</div>)}
          {artifact.validation.warnings.map((warning) => <div key={warning}>{warning}</div>)}
        </div>
      )}
      {artifact.status === 'conflict' && (
        <div className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {t('artifact.conflictHelp')}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {editing ? (
          <textarea
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            spellCheck={false}
            className="h-full w-full resize-none bg-background p-4 font-mono text-xs leading-relaxed outline-none"
          />
        ) : (renderedPreviewPath || resolved.activePath) ? (
          <FilePreviewContent
            filePath={renderedPreviewPath ?? resolved.activePath!}
            onFileClick={onOpenFile}
            mimeType={renderedPreviewPath ? undefined : artifact.mimeType}
            fileSize={renderedPreviewPath ? undefined : activeRevisionSize}
          />
        ) : (
          <PanelEmptyState title={t('artifact.previewUnavailable')} />
        )}
      </div>
    </div>
  )
}
