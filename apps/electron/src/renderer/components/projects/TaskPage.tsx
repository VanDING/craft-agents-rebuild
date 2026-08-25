import * as React from 'react'
import { Bot, Clock3, History, UserRound, Workflow } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import type {
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItem,
  WorkItemEvent,
  WorkItemEventChange,
} from '@craft-agent/shared/work-items/browser'
import type { ProjectManagementView } from '../../../shared/types'
import { projectsAtom } from '@/atoms/projects'
import { kanbanEditorTargetAtom, kanbanProjectFilterAtom } from '@/atoms/kanban'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useAppShellContext } from '@/context/AppShellContext'
import { routes, useNavigation } from '@/contexts/NavigationContext'
import { useWorkItemEvents } from '@/hooks/useWorkItemEvents'
import { useWorkItems } from '@/hooks/useWorkItems'
import { WorkItemEditor } from '@/components/app-shell/kanban/WorkItemEditor'

function valueText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function changeText(change: WorkItemEventChange): string {
  return `${change.field}: ${valueText(change.before)} → ${valueText(change.after)}`
}

function actorIcon(type: WorkItemEvent['actor']['type']) {
  if (type === 'user') return UserRound
  if (type === 'agent') return Bot
  return Workflow
}

function WorkItemHistory({ events, loading }: { events: WorkItemEvent[]; loading: boolean }) {
  const { t } = useTranslation()
  return (
    <section className="rounded-xl border border-border/70 bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-foreground/65">
        <History className="h-3.5 w-3.5" /> {t('kanban.workItemHistory')}
      </div>
      {loading ? (
        <div className="py-4 text-center text-xs text-foreground/40">{t('common.loading')}</div>
      ) : events.length === 0 ? (
        <div className="py-4 text-center text-xs text-foreground/40">{t('kanban.workItemHistoryEmpty')}</div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => {
            const ActorIcon = actorIcon(event.actor.type)
            return (
              <div key={event.id} className="relative pl-6 text-xs before:absolute before:bottom-[-14px] before:left-[7px] before:top-4 before:w-px before:bg-border last:before:hidden">
                <ActorIcon className="absolute left-0 top-0.5 h-3.5 w-3.5 text-foreground/45" />
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="font-semibold text-foreground/75">
                    {t(`kanban.workItemEvent.${event.action}`)} · {t(`kanban.workItemActor.${event.actor.type}`)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-foreground/40">
                    <Clock3 className="h-3 w-3" />
                    {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(event.occurredAt)}
                  </span>
                </div>
                {event.changes.length > 0 && (
                  <div className="mt-1 space-y-0.5 text-[11px] text-foreground/50">
                    {event.changes.map((change, index) => <div key={`${change.field}-${index}`}>{changeText(change)}</div>)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function createInput(patch: UpdateWorkItemInput): CreateWorkItemInput {
  return {
    title: patch.title ?? '',
    description: patch.description ?? undefined,
    projectId: patch.projectId ?? undefined,
    statusId: patch.statusId,
    startAt: patch.startAt ?? undefined,
    dueAt: patch.dueAt ?? undefined,
    progress: patch.progress ?? undefined,
    dependencyIds: patch.dependencyIds,
    parentId: patch.parentId ?? undefined,
    isMilestone: patch.isMilestone,
  }
}

export function TaskPage({ workItemId, sourceView }: { workItemId: string; sourceView: Exclude<ProjectManagementView, 'overview'> }) {
  const { t } = useTranslation()
  const { activeWorkspaceId, sessionStatuses, onCreateSession } = useAppShellContext()
  const projects = useAtomValue(projectsAtom)
  const projectFilter = useAtomValue(kanbanProjectFilterAtom)
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const setTaskEditorTarget = useSetAtom(kanbanEditorTargetAtom)
  const { navigate, navigateToSession } = useNavigation()
  const { items, create, update, remove } = useWorkItems(activeWorkspaceId ?? null)
  const isCreate = workItemId === 'new'
  const item = isCreate ? undefined : items.find(({ id }) => id === workItemId)
  const { events, isLoading } = useWorkItemEvents(activeWorkspaceId ?? null, item?.id ?? null)

  const close = React.useCallback(() => {
    navigate(routes.view.projectManagement(sourceView))
  }, [navigate, sourceView])

  React.useEffect(() => {
    if (!isCreate && items.length > 0 && !item) close()
  }, [close, isCreate, item, items.length])

  const draft = React.useMemo<WorkItem>(() => ({
    id: 'new',
    title: '',
    description: undefined,
    projectId: projectFilter[0],
    statusId: 'todo',
    dependencyIds: [],
    sessionIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }), [projectFilter])

  if (!isCreate && !item) {
    return <div className="flex h-full items-center justify-center text-sm text-foreground/45">{t('common.loading')}</div>
  }

  const activeItem = item ?? draft
  const sessionId = item?.primarySessionId
  const meta = sessionId ? metaMap.get(sessionId) : undefined
  const projectOptions = projects.map((project) => ({ id: project.config.id, name: project.config.name }))

  const ensureSession = async () => {
    if (!activeWorkspaceId || !item) return
    const session = await onCreateSession(activeWorkspaceId, {
      name: item.title,
      sessionStatus: item.statusId,
      ...(item.projectId ? { projectId: item.projectId } : {}),
    })
    const linked = await update(item.id, {
      sessionIds: [...item.sessionIds, session.id],
      primarySessionId: session.id,
    })
    if (linked) navigateToSession(session.id)
  }

  return (
    <WorkItemEditor
      key={activeItem.id}
      item={activeItem}
      mode={isCreate ? 'create' : 'edit'}
      projects={projectOptions}
      statuses={sessionStatuses ?? []}
      workItems={items}
      closeAfterSave={false}
      history={!isCreate ? <WorkItemHistory events={events} loading={isLoading} /> : undefined}
      onClose={close}
      onSave={async (patch) => {
        if (isCreate) {
          const created = await create(createInput(patch))
          if (!created) return false
          navigate(routes.view.projectManagement(sourceView))
          return true
        }
        return Boolean(await update(activeItem.id, patch))
      }}
      onDelete={!isCreate ? async () => {
        if (!window.confirm(t('kanban.workItemDeleteConfirm'))) return
        await remove(activeItem.id)
        close()
      } : undefined}
      onOpenSession={sessionId ? () => navigateToSession(sessionId) : undefined}
      onCreateSession={!sessionId && !isCreate ? ensureSession : undefined}
      onEditDefinition={sessionId ? () => {
        setTaskEditorTarget({
          mode: 'edit',
          sessionId,
          taskSlug: meta?.taskSlug,
          initialTitle: activeItem.title,
        })
        navigate(routes.view.projectManagement('board'))
      } : undefined}
    />
  )
}
