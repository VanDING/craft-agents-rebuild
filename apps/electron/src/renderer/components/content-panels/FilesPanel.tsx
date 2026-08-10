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
import { FolderTree, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { PanelHeader } from '../app-shell/PanelHeader'
import { PanelEmptyState } from './PanelEmptyState'
import { BoundSessionBadge } from './BoundSessionBadge'
import { SessionFilesSection } from '../right-sidebar/SessionFilesSection'
import { activeSessionIdAtom } from '@/atoms/active-session'
import { sessionMetaMapAtom } from '@/atoms/sessions'

export function FilesPanel() {
  const { t } = useTranslation()
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const [query, setQuery] = useState('')

  const meta = activeSessionId ? sessionMetaMap.get(activeSessionId) : undefined
  const sessionFolderPath = meta?.workingDirectory
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title={t('contentPanel.title.files')}
        badge={<BoundSessionBadge name={sessionName} sessionId={activeSessionId} />}
      />

      <div className="shrink-0 px-2 pb-2 pt-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('contentPanel.files.filterPlaceholder')}
            className="h-7 pl-8 text-[13px]"
            aria-label={t('contentPanel.files.filterPlaceholder')}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <SessionFilesSection
          sessionId={activeSessionId}
          sessionFolderPath={sessionFolderPath}
          hideHeader
          filterQuery={query}
        />
      </div>
    </div>
  )
}
