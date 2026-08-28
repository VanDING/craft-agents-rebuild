/**
 * FilesPanel - session file tree bound to the active session.
 *
 * Wraps the shared SessionFilesSection (hidden header) with a workbench header
 * and a filename filter bar (opencode session-file-list filtering adapted to
 * the existing tree). Clicking a file still routes through the link interceptor
 * (in-app previews), exactly like the sidebar tree.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { FolderOpen, FolderTree, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { PanelHeader } from '../app-shell/PanelHeader'
import { PanelEmptyState } from './PanelEmptyState'
import { BoundSessionBadge } from './BoundSessionBadge'
import { SessionFilesSection } from '../right-sidebar/SessionFilesSection'
import { activeSessionIdAtom } from '@/atoms/active-session'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { getPathBasename } from '@/lib/platform'

export function FilesPanel() {
  const { t } = useTranslation()
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const [query, setQuery] = useState('')

  const meta = activeSessionId ? sessionMetaMap.get(activeSessionId) : undefined
  const workingDirectory = meta?.workingDirectory
  const sessionName = meta?.name

  if (!activeSessionId) {
    return (
      <>
        <PanelHeader title={t('contentPanel.title.files')} />
        <PanelEmptyState
          title={t('contentPanel.noActiveSession')}
          icon={<FolderTree className="h-6 w-6" />}
        />
      </>
    )
  }

  if (!workingDirectory) {
    return (
      <>
        <PanelHeader
          title={t('contentPanel.title.files')}
          badge={<BoundSessionBadge name={sessionName} sessionId={activeSessionId} />}
        />
        <PanelEmptyState
          title={t('workspace.noFolderSelected')}
          hint={t('chat.chooseWorkingDirectory')}
          icon={<FolderTree className="h-6 w-6" />}
        />
      </>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title={t('contentPanel.title.files')}
        badge={<BoundSessionBadge name={sessionName} sessionId={activeSessionId} />}
      />

      <div className="shrink-0 border-b border-border/50 bg-background/60 px-2.5 pb-2.5 pt-1.5">
        <div
          className="mb-2 flex min-w-0 items-center gap-1.5 px-1 text-[11px] font-medium text-muted-foreground"
          title={workingDirectory}
        >
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
        <SessionFilesSection
          sessionId={activeSessionId}
          fileScope="working"
          rootPath={workingDirectory}
          hideHeader
          filterQuery={query}
        />
      </div>
    </div>
  )
}
