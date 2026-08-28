/**
 * TrajectoryPanel — trajectory ledger bound to the active session.
 *
 * Builds a trajectory snapshot from the session's enriched messages
 * (timestamp / usage / requestSeq / promptSnapshot / parentToolUseId /
 * compaction added by the Pi event pipeline) and renders the trajectory view.
 * Empty states cover no-active-session and no-messages; while messages are
 * still loading a placeholder is shown so "no records" is never a false
 * positive.
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { Activity } from 'lucide-react'
import { TrajectoryView, buildTrajectorySnapshot, Spinner } from '@craft-agent/ui'
import { PanelHeader } from '../app-shell/PanelHeader'
import { PanelEmptyState } from './PanelEmptyState'
import { BoundSessionBadge } from './BoundSessionBadge'
import { activeSessionIdAtom } from '@/atoms/active-session'
import { sessionAtomFamily, ensureSessionMessagesLoadedAtom } from '@/atoms/sessions'

export function TrajectoryPanel() {
  const { t } = useTranslation()
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const session = useAtomValue(sessionAtomFamily(activeSessionId ?? 'missing'))
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)

  const [messagesLoading, setMessagesLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!activeSessionId) {
      setMessagesLoading(false)
      setLoadError(false)
      return
    }
    let cancelled = false
    setMessagesLoading(true)
    setLoadError(false)
    void ensureMessagesLoaded(activeSessionId)
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeSessionId, ensureMessagesLoaded])

  const snapshot = useMemo(() => {
    if (!session) return null
    return buildTrajectorySnapshot({
      messages: session.messages,
      isProcessing: session.isProcessing,
      tokenUsage: session.tokenUsage,
      lastFullUsage: session.lastFullUsage,
    })
  }, [session])

  if (!activeSessionId) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title={t('contentPanel.title.trajectory')} />
        <PanelEmptyState
          icon={<Activity className="h-8 w-8" />}
          title={t('contentPanel.trajectory.noSession')}
          hint={t('contentPanel.trajectory.noSessionHint')}
        />
      </div>
    )
  }

  if (messagesLoading) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title={t('contentPanel.title.trajectory')} actions={<BoundSessionBadge sessionId={activeSessionId} />} />
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title={t('contentPanel.title.trajectory')} actions={<BoundSessionBadge sessionId={activeSessionId} />} />
        <PanelEmptyState
          icon={<Activity className="h-8 w-8" />}
          title={t('errors.failedToLoadSession')}
          hint={t('errors.pleaseReload')}
        />
      </div>
    )
  }

  if (!snapshot || snapshot.contributions.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title={t('contentPanel.title.trajectory')} actions={<BoundSessionBadge sessionId={activeSessionId} />} />
        <PanelEmptyState
          icon={<Activity className="h-8 w-8" />}
          title={t('contentPanel.trajectory.noRecords')}
          hint={t('contentPanel.trajectory.noRecordsHint')}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t('contentPanel.title.trajectory')} actions={<BoundSessionBadge sessionId={activeSessionId} />} />
      <div className="min-h-0 flex-1 bg-foreground/[0.012] p-2.5">
        <div className="h-full min-h-0 overflow-hidden rounded-xl border border-border/60 bg-background/60 shadow-minimal">
          <TrajectoryView
            snapshot={snapshot}
            sessionTotal={snapshot.totalUsage}
            isProcessing={session?.isProcessing}
          />
        </div>
      </div>
    </div>
  )
}
