/** Consolidated session content workbench: explorer, opened previews, changes and attachments. */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Eye, FileDiff, FilePenLine, FileText, FolderOpen, FolderTree, Paperclip, Search } from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { Input } from '@/components/ui/input'
import { PanelEmptyState } from './PanelEmptyState'
import { PanelRow } from './PanelSection'
import { PreviewPanel } from './PreviewPanel'
import { SessionFilesSection } from '../right-sidebar/SessionFilesSection'
import { activeSessionIdAtom } from '@/atoms/active-session'
import { ensureSessionMessagesLoadedAtom, loadedSessionsAtom, sessionAtomFamily, sessionMetaMapAtom } from '@/atoms/sessions'
import { filesPanelViewAtom, reviewPanelFocusRequestAtom, updateWorkbenchFocusAtom, type FilesPanelView } from '@/atoms/content-panel-ui'
import { getPathBasename } from '@/lib/platform'
import { useSessionActivities } from '@/lib/use-session-activities'
import { collectFileChangesFromActivities, getFirstFileChangeIdForActivity } from '@/lib/file-changes'
import { collectFileActivity, type FileActivityOperation } from '@/lib/file-activity'
import { useAppShellContext } from '@/context/AppShellContext'
import { openWorkbenchItemAtom, setWorkbenchItemBindingAtom } from '@/atoms/workbench'

const FILE_VIEWS: ReadonlyArray<{ id: FilesPanelView; key: string }> = [
  { id: 'explorer', key: 'contentPanel.files.view.explorer' },
  { id: 'opened', key: 'contentPanel.files.view.opened' },
  { id: 'activity', key: 'contentPanel.files.view.activity' },
  { id: 'attachments', key: 'contentPanel.files.view.attachments' },
]

export function FilesPanel({ sessionId }: { sessionId?: string }) {
  const { t } = useTranslation()
  const currentActiveSessionId = useAtomValue(activeSessionIdAtom)
  const activeSessionId = sessionId ?? currentActiveSessionId
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const loadedSessions = useAtomValue(loadedSessionsAtom)
  const session = useAtomValue(sessionAtomFamily(activeSessionId ?? 'missing'))
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)
  const [view, setView] = useAtom(filesPanelViewAtom)
  const [query, setQuery] = useState('')
  const [activityFilter, setActivityFilter] = useState<'all' | FileActivityOperation>('all')
  const [loadError, setLoadError] = useState(false)
  const { onOpenFile } = useAppShellContext()
  const updateWorkbenchFocus = useSetAtom(updateWorkbenchFocusAtom)
  const setReviewFocusRequest = useSetAtom(reviewPanelFocusRequestAtom)
  const openWorkbenchItem = useSetAtom(openWorkbenchItemAtom)
  const setWorkbenchItemBinding = useSetAtom(setWorkbenchItemBindingAtom)

  const meta = activeSessionId ? sessionMetaMap.get(activeSessionId) : undefined
  const workingDirectory = meta?.workingDirectory
  const messagesLoaded = activeSessionId ? loadedSessions.has(activeSessionId) : false
  const needsMessages = view === 'activity' || view === 'attachments'
  const activities = useSessionActivities(session)
  const changes = useMemo(() => collectFileChangesFromActivities(activities), [activities])
  const fileActivity = useMemo(() => collectFileActivity(activities), [activities])
  const filteredActivity = useMemo(() => activityFilter === 'all' ? fileActivity : fileActivity.filter(record => record.operation === activityFilter), [activityFilter, fileActivity])
  const attachments = useMemo(() => {
    const seen = new Set<string>()
    return (session?.messages ?? []).flatMap(message => message.attachments ?? []).filter(attachment => {
      if (seen.has(attachment.id)) return false
      seen.add(attachment.id)
      return true
    })
  }, [session])

  useEffect(() => {
    if (!activeSessionId || view === 'explorer' || view === 'opened') return
    let cancelled = false
    setLoadError(false)
    void ensureMessagesLoaded(activeSessionId).catch(() => {
      if (!cancelled) setLoadError(true)
    })
    return () => { cancelled = true }
  }, [activeSessionId, ensureMessagesLoaded, view])

  if (!activeSessionId) {
    return <PanelEmptyState title={t('contentPanel.noActiveSession')} icon={<FolderTree className="h-6 w-6" />} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col @container/files">
      <div className="flex h-10 shrink-0 items-end gap-5 overflow-x-auto border-b border-border/50 bg-background/80 px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label={t('contentPanel.files.views')}>
        {FILE_VIEWS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            onClick={() => setView(item.id)}
            className={`relative h-10 shrink-0 px-0.5 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === item.id ? 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-t after:bg-accent' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t(item.key)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {needsMessages && !messagesLoaded && !loadError && (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        )}
        {needsMessages && loadError && (
          <PanelEmptyState title={t('errors.failedToLoadSession')} hint={t('errors.pleaseReload')} />
        )}
        {view === 'explorer' && (
          workingDirectory ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 border-b border-border/50 bg-background/60 px-2.5 pb-2.5 pt-1.5">
                <div className="mb-2 flex min-w-0 items-center gap-1.5 px-1 text-[11px] font-medium text-muted-foreground" title={workingDirectory}>
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 truncate">{getPathBasename(workingDirectory) || workingDirectory}</span>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('contentPanel.files.filterPlaceholder')}
                    className="h-8 rounded-lg border-border/60 bg-foreground/[0.02] pl-8 text-[13px] shadow-none focus-visible:bg-background"
                    aria-label={t('contentPanel.files.filterPlaceholder')}
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 bg-foreground/[0.012] pt-1">
                <SessionFilesSection sessionId={activeSessionId} fileScope="working" rootPath={workingDirectory} hideHeader filterQuery={query} />
              </div>
            </div>
          ) : (
            <PanelEmptyState title={t('workspace.noFolderSelected')} hint={t('chat.chooseWorkingDirectory')} icon={<FolderTree className="h-6 w-6" />} />
          )
        )}

        {view === 'opened' && <PreviewPanel sessionId={activeSessionId} />}

        {view === 'activity' && messagesLoaded && (
          fileActivity.length > 0 ? (
            <div className="flex h-full min-h-0 flex-col bg-foreground/[0.012]">
              <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/50 bg-background/60 px-2.5">
                {(['all', 'read', 'search', 'edit', 'write'] as const).map(filter => (
                  <button key={filter} type="button" aria-pressed={activityFilter === filter} onClick={() => setActivityFilter(filter)} className={`h-6 rounded-md px-2 text-[10px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${activityFilter === filter ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:bg-foreground/[0.035]'}`}>
                    {t(`contentPanel.files.activity.${filter}`)}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
                <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-border/55 bg-background/70">
                  {filteredActivity.map(record => {
                    const changeId = getFirstFileChangeIdForActivity(record.activityId, changes)
                    const Icon = record.operation === 'read' ? Eye : record.operation === 'search' ? Search : FilePenLine
                    return (
                      <div key={record.id} className="grid min-h-11 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/45 px-3 last:border-b-0 hover:bg-foreground/[0.025]" style={{ paddingLeft: `${12 + Math.min(record.depth, 3) * 10}px` }}>
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        <button type="button" className="min-w-0 text-left outline-none focus-visible:underline" onClick={() => {
                          updateWorkbenchFocus({ sessionId: activeSessionId, source: 'files', filePath: record.path, callId: record.activityId })
                          onOpenFile?.(record.path, activeSessionId)
                        }}>
                          <span className="block truncate text-[12px] font-medium" title={record.path}>{getPathBasename(record.path) || record.path}</span>
                          <span className="block truncate text-[9px] text-muted-foreground">{t(`contentPanel.files.activity.${record.operation}`)} · {record.toolName} · {new Date(record.timestamp).toLocaleTimeString()}</span>
                        </button>
                        {changeId && (
                          <button type="button" className="rounded px-1.5 py-1 text-[10px] font-medium text-accent hover:bg-accent/10" onClick={() => {
                            updateWorkbenchFocus({ sessionId: activeSessionId, source: 'files', filePath: record.path, callId: record.activityId, changeId })
                            setReviewFocusRequest({ sessionId: activeSessionId, changeId, nonce: Date.now() })
                            const reviewItemId = openWorkbenchItem('diff')
                            if (reviewItemId) setWorkbenchItemBinding({ id: reviewItemId, binding: { type: 'session', sessionId: activeSessionId } })
                          }}>{t('contentPanel.files.activity.review')}</button>
                        )}
                      </div>
                    )
                  })}
                  {filteredActivity.length === 0 && <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">{t('contentPanel.files.activity.noMatches')}</div>}
                </div>
              </div>
            </div>
          ) : (
            <PanelEmptyState title={t('contentPanel.files.activity.empty')} hint={t('contentPanel.files.activity.emptyHint')} icon={<FileDiff className="h-6 w-6" />} />
          )
        )}

        {view === 'attachments' && messagesLoaded && (
          attachments.length > 0 ? (
            <div className="h-full overflow-y-auto bg-foreground/[0.012] p-2.5">
              <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-border/55 bg-background/70 p-1">
                {attachments.map(attachment => (
                  <PanelRow key={attachment.id} icon={attachment.name ? <FileText className="h-3.5 w-3.5" /> : <Paperclip className="h-3.5 w-3.5" />} title={attachment.name} titleAttribute={attachment.name} onClick={() => onOpenFile?.(attachment.storedPath, activeSessionId)} />
                ))}
              </div>
            </div>
          ) : (
            <PanelEmptyState title={t('contentPanel.context.attachmentsEmpty')} icon={<Paperclip className="h-6 w-6" />} />
          )
        )}
      </div>
    </div>
  )
}
