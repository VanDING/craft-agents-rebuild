/** Consolidated session content workbench: explorer, opened previews, changes and attachments. */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { FileDiff, FileText, FolderOpen, FolderTree, Paperclip, Search } from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { Input } from '@/components/ui/input'
import { PanelEmptyState } from './PanelEmptyState'
import { PanelRow } from './PanelSection'
import { PreviewPanel } from './PreviewPanel'
import { SessionFilesSection } from '../right-sidebar/SessionFilesSection'
import { activeSessionIdAtom } from '@/atoms/active-session'
import { ensureSessionMessagesLoadedAtom, loadedSessionsAtom, sessionAtomFamily, sessionMetaMapAtom } from '@/atoms/sessions'
import { filesPanelViewAtom, type FilesPanelView } from '@/atoms/content-panel-ui'
import { getPathBasename } from '@/lib/platform'
import { useSessionActivities } from '@/lib/use-session-activities'
import { collectFileChangesFromActivities } from '@/lib/file-changes'
import { useAppShellContext } from '@/context/AppShellContext'

const FILE_VIEWS: ReadonlyArray<{ id: FilesPanelView; key: string }> = [
  { id: 'explorer', key: 'contentPanel.files.view.explorer' },
  { id: 'opened', key: 'contentPanel.files.view.opened' },
  { id: 'changed', key: 'contentPanel.files.view.changed' },
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
  const [loadError, setLoadError] = useState(false)
  const { onOpenFile } = useAppShellContext()

  const meta = activeSessionId ? sessionMetaMap.get(activeSessionId) : undefined
  const workingDirectory = meta?.workingDirectory
  const messagesLoaded = activeSessionId ? loadedSessions.has(activeSessionId) : false
  const needsMessages = view === 'changed' || view === 'attachments'
  const activities = useSessionActivities(session)
  const changes = useMemo(() => collectFileChangesFromActivities(activities), [activities])
  const changedPaths = useMemo(() => [...new Set(changes.map(change => change.filePath))], [changes])
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

        {view === 'changed' && messagesLoaded && (
          changedPaths.length > 0 ? (
            <div className="h-full overflow-y-auto bg-foreground/[0.012] p-2.5">
              <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-border/55 bg-background/70 p-1">
                {changedPaths.map(path => (
                  <PanelRow key={path} icon={<FileDiff className="h-3.5 w-3.5" />} title={getPathBasename(path) || path} titleAttribute={path} onClick={() => onOpenFile?.(path, activeSessionId)} />
                ))}
              </div>
            </div>
          ) : (
            <PanelEmptyState title={t('contentPanel.diff.noChanges')} hint={t('contentPanel.diff.noChangesHint')} icon={<FileDiff className="h-6 w-6" />} />
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
