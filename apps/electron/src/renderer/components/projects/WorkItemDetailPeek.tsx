import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Bot, Clock3, History, UserRound, Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WorkItemEvent, WorkItemEventChange } from '@craft-agent/shared/work-items/browser'
import type { ProjectManagementView } from '../../../shared/types'
import { projectsAtom } from '@/atoms/projects'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { kanbanEditorTargetAtom, workItemDetailIdAtom } from '@/atoms/kanban'
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
    <section className="rounded-xl border border-border/70 bg-card p-3">
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

/** Responsive in-surface detail peek. The underlying projection stays mounted. */
export function WorkItemDetailPeek({ view }: { view: ProjectManagementView }) {
  const { t } = useTranslation()
  const { activeWorkspaceId, sessionStatuses, onCreateSession } = useAppShellContext()
  const projects = useAtomValue(projectsAtom)
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const [detailId, setDetailId] = useAtom(workItemDetailIdAtom)
  const setTaskEditorTarget = useSetAtom(kanbanEditorTargetAtom)
  const { navigate, navigateToSession } = useNavigation()
  const { items, update, remove } = useWorkItems(activeWorkspaceId ?? null)
  const item = detailId ? items.find(({ id }) => id === detailId) : undefined
  const { events, isLoading } = useWorkItemEvents(activeWorkspaceId ?? null, item?.id ?? null)
  const closeDetail = React.useCallback(() => {
    setDetailId(null)
    navigate(routes.view.projectManagement(view))
  }, [navigate, setDetailId, view])

  React.useEffect(() => {
    if (detailId && !item && items.length > 0) closeDetail()
  }, [closeDetail, detailId, item, items.length])

  React.useEffect(() => {
    if (!item) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetail()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeDetail, item])

  if (!item) return null
  const sessionId = item.primarySessionId
  const meta = sessionId ? metaMap.get(sessionId) : undefined
  const projectOptions = projects.map((project) => ({ id: project.config.id, name: project.config.name }))

  const ensureSession = async () => {
    if (!activeWorkspaceId) return
    const session = await onCreateSession(activeWorkspaceId, {
      name: item.title,
      sessionStatus: item.statusId,
      ...(item.projectId ? { projectId: item.projectId } : {}),
    })
    const linked = await update(item.id, {
      sessionIds: [...item.sessionIds, session.id],
      primarySessionId: session.id,
    })
    if (linked) {
      setDetailId(null)
      navigateToSession(session.id)
    }
  }

  return (
    <aside
      aria-label={t('kanban.workItemDetails')}
      className="absolute inset-y-0 right-0 z-30 w-full border-l border-border/70 bg-background shadow-strong @min-[760px]/panel:w-[min(460px,46%)]"
    >
      <WorkItemEditor
        key={item.id}
        item={item}
        projects={projectOptions}
        statuses={sessionStatuses ?? []}
        workItems={items}
        closeAfterSave={false}
        history={<WorkItemHistory events={events} loading={isLoading} />}
        onClose={closeDetail}
        onSave={async (patch) => Boolean(await update(item.id, patch))}
        onDelete={async () => {
          if (!window.confirm(t('kanban.workItemDeleteConfirm'))) return
          await remove(item.id)
          closeDetail()
        }}
        onOpenSession={sessionId ? () => {
          setDetailId(null)
          navigateToSession(sessionId)
        } : undefined}
        onCreateSession={!sessionId ? ensureSession : undefined}
        onEditDefinition={sessionId ? () => {
          setTaskEditorTarget({
            mode: 'edit',
            sessionId,
            taskSlug: meta?.taskSlug,
            initialTitle: item.title,
          })
          setDetailId(null)
          navigate(routes.view.projectManagement('board'))
        } : undefined}
      />
    </aside>
  )
}
