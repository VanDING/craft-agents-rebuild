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
import { PanelEmptyState } from './PanelEmptyState'
import { activeSessionIdAtom } from '@/atoms/active-session'
import { sessionAtomFamily, sessionMetaMapAtom, ensureSessionMessagesLoadedAtom } from '@/atoms/sessions'
import { chatFocusRequestAtom, reviewPanelFocusRequestAtom, updateWorkbenchFocusAtom, workbenchFocusBySessionAtom } from '@/atoms/content-panel-ui'
import { collapseWorkbenchAtom, openWorkbenchItemAtom, setWorkbenchItemBindingAtom } from '@/atoms/workbench'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { useLabels } from '@/hooks/useLabels'
import { findLabelById } from '@craft-agent/shared/labels'

export function TrajectoryPanel({ sessionId }: { sessionId?: string }) {
  const { t } = useTranslation()
  const currentActiveSessionId = useAtomValue(activeSessionIdAtom)
  const activeSessionId = sessionId ?? currentActiveSessionId
  const session = useAtomValue(sessionAtomFamily(activeSessionId ?? 'missing'))
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)
  const setChatFocusRequest = useSetAtom(chatFocusRequestAtom)
  const setReviewFocusRequest = useSetAtom(reviewPanelFocusRequestAtom)
  const focusBySession = useAtomValue(workbenchFocusBySessionAtom)
  const updateWorkbenchFocus = useSetAtom(updateWorkbenchFocusAtom)
  const openWorkbenchItem = useSetAtom(openWorkbenchItemAtom)
  const setWorkbenchItemBinding = useSetAtom(setWorkbenchItemBindingAtom)
  const collapseWorkbench = useSetAtom(collapseWorkbenchAtom)
  const { activeWorkspaceId, onOpenFile } = useAppShellContext()
  const { navigateToSession } = useNavigation()
  const { labels: labelConfigs } = useLabels(activeWorkspaceId)

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
  const meta = activeSessionId ? sessionMetaMap.get(activeSessionId) : undefined
  const labelNames = useMemo(() => (
    meta?.labels?.map((id) => findLabelById(labelConfigs, id)?.name ?? id) ?? []
  ), [labelConfigs, meta?.labels])

  if (!activeSessionId) {
    return (
      <div className="flex h-full flex-col">
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
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col">
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
      <div className="min-h-0 flex-1 bg-background">
        <div className="h-full min-h-0 overflow-hidden bg-background">
          <TrajectoryView
            key={activeSessionId}
            snapshot={snapshot}
            sessionTotal={snapshot.totalUsage}
            isProcessing={session?.isProcessing}
            contextSummary={{
              name: meta?.name,
              status: meta?.isProcessing ? t('contentPanel.context.status.processing') : meta?.sessionStatus,
              model: meta?.model,
              permissionMode: meta?.permissionMode,
              workingDirectory: meta?.workingDirectory,
              labels: labelNames,
              messageCount: meta?.messageCount,
              createdAt: meta?.createdAt,
              lastActivityAt: meta?.lastMessageAt,
              inputTokens: meta?.tokenUsage?.inputTokens,
              outputTokens: meta?.tokenUsage?.outputTokens,
              totalTokens: meta?.tokenUsage?.totalTokens,
              contextTokens: meta?.tokenUsage?.contextTokens,
              costUsd: meta?.tokenUsage?.costUsd,
            }}
            focus={focusBySession[activeSessionId]}
            onFocusChange={(focus) => updateWorkbenchFocus({
              ...focus,
              sessionId: activeSessionId,
            })}
            onOpenChat={(messageId) => {
              navigateToSession(activeSessionId)
              setChatFocusRequest({ sessionId: activeSessionId, messageId, nonce: Date.now() })
              collapseWorkbench()
            }}
            onOpenReview={(changeId) => {
              setReviewFocusRequest({ sessionId: activeSessionId, changeId, nonce: Date.now() })
              const reviewItemId = openWorkbenchItem('diff')
              if (reviewItemId) {
                setWorkbenchItemBinding({
                  id: reviewItemId,
                  binding: { type: 'session', sessionId: activeSessionId },
                })
              }
            }}
            onOpenFile={(path) => onOpenFile?.(path, activeSessionId)}
          />
        </div>
      </div>
    </div>
  )
}
