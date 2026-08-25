import * as React from 'react'
import { ArrowLeft, ExternalLink, MessageSquarePlus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { UpdateWorkItemInput, WorkItem } from '@craft-agent/shared/work-items/browser'
import type { SessionStatus } from '@/config/session-status-config'
import { cn } from '@/lib/utils'
import { ProjectSelectMenu } from '@/components/projects/ProjectSelectMenu'

interface WorkItemEditorProps {
  item: WorkItem
  mode?: 'create' | 'edit'
  projects: readonly { id: string; name: string }[]
  statuses: readonly SessionStatus[]
  workItems?: readonly WorkItem[]
  history?: React.ReactNode
  closeAfterSave?: boolean
  onClose: () => void
  onSave: (patch: UpdateWorkItemInput) => Promise<boolean>
  onDelete?: () => Promise<void>
  onOpenSession?: () => void
  onCreateSession?: () => Promise<void>
  onEditDefinition?: () => void
}

const fieldClass =
  'h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-ring/60 focus:ring-2 focus:ring-ring/15'

/** Engine-independent metadata editor shared by standalone and session-linked tasks. */
export function WorkItemEditor({
  item,
  mode = 'edit',
  projects,
  statuses,
  workItems = [],
  history,
  closeAfterSave = true,
  onClose,
  onSave,
  onDelete,
  onOpenSession,
  onCreateSession,
  onEditDefinition,
}: WorkItemEditorProps) {
  const { t } = useTranslation()
  const [title, setTitle] = React.useState(item.title)
  const [description, setDescription] = React.useState(item.description ?? '')
  const [projectId, setProjectId] = React.useState(item.projectId ?? '')
  const [statusId, setStatusId] = React.useState(item.statusId)
  const [startAt, setStartAt] = React.useState(item.startAt?.slice(0, 10) ?? '')
  const [dueAt, setDueAt] = React.useState(item.dueAt?.slice(0, 10) ?? '')
  const [progress, setProgress] = React.useState(item.progress === undefined ? '' : String(item.progress))
  const [isMilestone, setIsMilestone] = React.useState(Boolean(item.isMilestone))
  const [parentId, setParentId] = React.useState(item.parentId ?? '')
  const [dependencyIds, setDependencyIds] = React.useState(item.dependencyIds)
  const [saving, setSaving] = React.useState(false)
  const [creatingSession, setCreatingSession] = React.useState(false)

  const save = React.useCallback(async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    const ok = await onSave({
      title: title.trim(),
      description: description.trim() || null,
      projectId: projectId || null,
      statusId,
      startAt: startAt || null,
      dueAt: dueAt || null,
      progress: progress === '' ? null : Number(progress),
      isMilestone,
      parentId: parentId || null,
      dependencyIds,
    })
    setSaving(false)
    if (ok && closeAfterSave) onClose()
  }, [closeAfterSave, dependencyIds, description, dueAt, isMilestone, onClose, onSave, parentId, progress, projectId, saving, startAt, statusId, title])

  const createSession = React.useCallback(async () => {
    if (!onCreateSession || creatingSession) return
    setCreatingSession(true)
    try {
      await onCreateSession()
    } finally {
      setCreatingSession(false)
    }
  }, [creatingSession, onCreateSession])

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="relative flex h-12 flex-none items-center justify-between border-b border-border/60 px-4">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.back')}
          className="z-10 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t('common.back')}
        </button>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold">
          {mode === 'create' ? t('kanban.newTask') : t('kanban.workItemDetails')}
        </div>
        <div className="w-16" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          <section className="space-y-5 rounded-2xl border border-border/70 bg-card p-6 shadow-minimal">
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-foreground/65">
              {t('kanban.workItemTitle')}
              <input className={fieldClass} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
            </label>

            <label className="flex flex-col gap-1.5 text-xs font-semibold text-foreground/65">
              {t('kanban.workItemDescription')}
              <textarea
                className="min-h-28 w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-ring/60 focus:ring-2 focus:ring-ring/15"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-foreground/65">
              {t('kanban.workItemProject')}
              <ProjectSelectMenu value={projectId} options={[{ value: '', label: t('kanban.workItemNoProject') }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} onValueChange={setProjectId} ariaLabel={t('kanban.workItemProject')} className="h-9 w-full justify-between" />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-foreground/65">
              {t('kanban.workItemStatus')}
              <ProjectSelectMenu value={statusId} options={statuses.map((status) => ({ value: status.id, label: status.label }))} onValueChange={setStatusId} ariaLabel={t('kanban.workItemStatus')} className="h-9 w-full justify-between" />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-foreground/65">
              {t('kanban.workItemStart')}
              <input type="date" className={fieldClass} value={startAt} onChange={(event) => setStartAt(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-foreground/65">
              {t('kanban.workItemDue')}
              <input type="date" className={fieldClass} value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-foreground/65">
              {t('kanban.workItemProgress')}
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                className={fieldClass}
                value={progress}
                onChange={(event) => setProgress(event.target.value)}
              />
            </label>
            <label className="flex h-9 items-center gap-2 self-end rounded-lg border border-border px-3 text-xs font-semibold text-foreground/65">
              <input type="checkbox" checked={isMilestone} onChange={(event) => setIsMilestone(event.target.checked)} />
              {t('kanban.workItemMilestone')}
            </label>
          </div>
          </section>

          {(onOpenSession || onCreateSession || onEditDefinition) && <div className="rounded-xl border border-border/70 bg-card p-3">
            <div className="mb-2 text-xs font-semibold text-foreground/65">{t('kanban.workItemExecution')}</div>
            <div className="flex flex-wrap gap-2">
              {onOpenSession ? (
                <button type="button" onClick={onOpenSession} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-foreground/[0.04]">
                  <ExternalLink className="h-3.5 w-3.5" /> {t('kanban.workItemOpenSession')}
                </button>
              ) : onCreateSession ? (
                <button type="button" onClick={() => void createSession()} disabled={creatingSession} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-foreground/[0.04] disabled:opacity-50">
                  <MessageSquarePlus className="h-3.5 w-3.5" /> {t('kanban.workItemCreateSession')}
                </button>
              ) : null}
              {onEditDefinition && (
                <button type="button" onClick={onEditDefinition} className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-foreground/[0.04]">
                  {t('kanban.workItemEditDefinition')}
                </button>
              )}
            </div>
          </div>}

          {workItems.length > 1 && (
            <div className="rounded-xl border border-border/70 bg-card p-3">
              <div className="mb-3 text-xs font-semibold text-foreground/65">{t('kanban.workItemRelationships')}</div>
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-foreground/65">
                {t('kanban.workItemParent')}
                <ProjectSelectMenu value={parentId} options={[{ value: '', label: t('kanban.workItemNoParent') }, ...workItems.filter(({ id }) => id !== item.id).map((candidate) => ({ value: candidate.id, label: candidate.title }))]} onValueChange={setParentId} ariaLabel={t('kanban.workItemParent')} className="h-9 w-full justify-between" />
              </label>
              <div className="mt-3 text-xs font-semibold text-foreground/65">{t('kanban.workItemDependencies')}</div>
              <div className="mt-1 max-h-36 space-y-1 overflow-y-auto">
                {workItems.filter(({ id }) => id !== item.id).map((candidate) => (
                  <label key={candidate.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-xs font-normal hover:bg-foreground/[0.04]">
                    <input
                      type="checkbox"
                      checked={dependencyIds.includes(candidate.id)}
                      onChange={(event) => setDependencyIds((previous) => event.target.checked
                        ? [...previous, candidate.id]
                        : previous.filter((id) => id !== candidate.id))}
                    />
                    <span className="truncate">{candidate.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {history}
        </div>
      </div>

      <div className="flex flex-none items-center justify-between border-t border-border/60 px-4 py-3">
        {onDelete ? (
          <button
            type="button"
            onClick={() => void onDelete()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> {t('kanban.workItemDelete')}
          </button>
        ) : <div />}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="h-8 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-foreground/[0.04]">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!title.trim() || saving || (progress !== '' && (Number(progress) < 0 || Number(progress) > 100 || !Number.isInteger(Number(progress))))}
            className={cn('h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground', 'disabled:opacity-50')}
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
