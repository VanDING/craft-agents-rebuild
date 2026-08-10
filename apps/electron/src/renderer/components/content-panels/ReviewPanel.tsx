/**
 * ReviewPanel - Review & Diff panel bound to the active session.
 *
 * Renders the session's file changes (Edit/Write activities) as a list grouped
 * by file, colored by diff kind (add / del / mix), with ±N line stats. Clicking
 * a file expands an embedded ShikiDiffViewer / UnifiedDiffViewer in the panel
 * (no overlay). Empty states guide the user when there is no active session or
 * no changes yet; while messages are still loading a placeholder is shown so
 * "no changes" is never a false positive.
 *
 * Selected-file and scroll-focus state live in global atoms (content-panel-ui)
 * so the panel keeps identical state when expanded to fullscreen (Task 11).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { ChevronRight, ChevronDown, FilePlus, PencilLine, GitCompareArrows } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlatform, UnifiedDiffViewer, Spinner } from '@craft-agent/ui'
import { ShikiDiffViewer } from '@/components/shiki/ShikiDiffViewer'
import { useTheme } from '@/hooks/useTheme'
import { PanelHeader } from '../app-shell/PanelHeader'
import { PanelEmptyState } from './PanelEmptyState'
import { activeSessionIdAtom } from '@/atoms/active-session'
import { sessionAtomFamily, sessionMetaMapAtom, ensureSessionMessagesLoadedAtom } from '@/atoms/sessions'
import { useSessionActivities } from '@/lib/use-session-activities'
import { collectFileChangesFromActivities } from '@/lib/file-changes'
import { computeChangeStats, createFileSections } from '@craft-agent/ui'
import { diffKindForSection, type DiffKind } from '@/lib/diff-kinds'
import { useDiffViewerSettings } from '@/lib/use-diff-viewer-settings'
import { reviewPanelSelectedKeyAtom, reviewPanelFocusRequestAtom } from '@/atoms/content-panel-ui'
import { getSessionTitle } from '@/utils/session'

const KIND_DOTS: Record<DiffKind, string> = {
  add: 'bg-emerald-500',
  del: 'bg-rose-500',
  mix: 'bg-amber-500',
}

function DiffKindLabel({ kind }: { kind: DiffKind }) {
  const { t } = useTranslation()
  const key = kind === 'add' ? 'contentPanel.diff.add' : kind === 'del' ? 'contentPanel.diff.del' : 'contentPanel.diff.mix'
  return (
    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/60">
      {t(key)}
    </span>
  )
}

function SectionStats({ changes }: { changes: import('@craft-agent/ui').FileChange[] }) {
  let additions = 0
  let deletions = 0
  for (const change of changes) {
    if (change.error) continue
    const stats = computeChangeStats(change)
    additions += stats.additions
    deletions += stats.deletions
  }
  if (additions === 0 && deletions === 0) return null
  return (
    <span className="shrink-0 text-[11px] font-medium tabular-nums">
      <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>
      <span className="mx-0.5 text-muted-foreground/40">/</span>
      <span className="text-rose-600 dark:text-rose-400">-{deletions}</span>
    </span>
  )
}

const fileBaseName = (path: string): string => {
  const normalized = path.replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || path
}

export function ReviewPanel() {
  const { t } = useTranslation()
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const session = useAtomValue(sessionAtomFamily(activeSessionId ?? 'missing'))
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)
  const { onOpenFileExternal } = usePlatform()
  const { isDark } = useTheme()
  const [viewerSettings, setViewerSettings] = useDiffViewerSettings()

  const selectedKey = useAtomValue(reviewPanelSelectedKeyAtom)
  const setSelectedKey = useSetAtom(reviewPanelSelectedKeyAtom)
  const focusRequest = useAtomValue(reviewPanelFocusRequestAtom)
  const setFocusRequest = useSetAtom(reviewPanelFocusRequestAtom)

  const [messagesLoading, setMessagesLoading] = useState(false)
  const changeRefs = useRef(new Map<string, HTMLDivElement>())

  // Load conversation messages (async) so "no changes" is never a false positive.
  useEffect(() => {
    if (!activeSessionId) return
    let stale = false
    setMessagesLoading(true)
    ensureMessagesLoaded(activeSessionId).finally(() => {
      if (!stale) setMessagesLoading(false)
    })
    return () => { stale = true }
  }, [activeSessionId, ensureMessagesLoaded])

  const activities = useSessionActivities(session)
  const changes = useMemo(() => collectFileChangesFromActivities(activities), [activities])
  const sections = useMemo(() => createFileSections(changes, true), [changes])

  const setChangeRef = useCallback((changeId: string, el: HTMLDivElement | null) => {
    if (el) changeRefs.current.set(changeId, el)
    else changeRefs.current.delete(changeId)
  }, [])

  // Consume a scroll-to-change request from ChatDisplay: open the containing
  // section, then scroll the change into view once rendered.
  useEffect(() => {
    if (!focusRequest) return
    const { changeId } = focusRequest
    const containing = sections.find((section) => section.changes.some((c) => c.id === changeId))
    if (containing && selectedKey !== containing.key) {
      setSelectedKey(containing.key)
    }
    const timer = setTimeout(() => {
      changeRefs.current.get(changeId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 120)
    setFocusRequest(null)
    return () => clearTimeout(timer)
  }, [focusRequest, sections, selectedKey, setSelectedKey, setFocusRequest])

  const sessionName = activeSessionId
    ? sessionMetaMap.get(activeSessionId)?.name
      ?? (session ? getSessionTitle(session) : undefined)
    : undefined

  const headerBadge = activeSessionId ? (
    <span
      className="inline-flex max-w-[24ch] items-center gap-1 truncate rounded-full border border-border/60 bg-foreground/[0.03] px-2 py-0.5 text-[11px] text-muted-foreground"
      title={sessionName ?? activeSessionId}
    >
      <GitCompareArrows className="h-3 w-3 shrink-0" />
      <span className="truncate">{sessionName ?? activeSessionId}</span>
    </span>
  ) : undefined

  if (!activeSessionId) {
    return (
      <>
        <PanelHeader title={t('contentPanel.title.review')} />
        <PanelEmptyState
          title={t('contentPanel.noActiveSession')}
          icon={<GitCompareArrows className="h-6 w-6" />}
        />
      </>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title={t('contentPanel.title.review')} badge={headerBadge} />

      {messagesLoading || (session == null && changes.length === 0) ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : changes.length === 0 ? (
        <PanelEmptyState
          title={t('contentPanel.diff.noChanges')}
          hint={t('contentPanel.diff.noChangesHint')}
          icon={<GitCompareArrows className="h-6 w-6" />}
        />
      ) : (
        <nav className="flex-1 min-h-0 overflow-y-auto px-2 py-2" aria-label={t('contentPanel.title.review')}>
          <ul className="flex flex-col gap-1">
            {sections.map((section) => {
              const key = section.key
              const isOpen = selectedKey === key
              const kind = diffKindForSection(section)
              return (
                <li key={key} className="break-inside-avoid">
                  <button
                    type="button"
                    onClick={() => setSelectedKey(isOpen ? null : key)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-foreground/[0.03]',
                      isOpen && 'bg-foreground/[0.03]',
                    )}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    {section.changes.some((c) => c.toolType === 'Write') ? (
                      <FilePlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <PencilLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', KIND_DOTS[kind])} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium" title={section.filePath}>{fileBaseName(section.filePath)}</span>
                    </span>
                    <DiffKindLabel kind={kind} />
                    <SectionStats changes={section.changes} />
                  </button>

                  {isOpen && (
                    <div className="mt-1 flex flex-col gap-3 rounded-xl overflow-hidden bg-background shadow-minimal pl-6">
                      {section.changes.map((change) => (
                        <div
                          key={change.id}
                          ref={(el) => setChangeRef(change.id, el)}
                          className="overflow-hidden rounded-xl border border-border/60"
                          style={{ minHeight: change.error ? undefined : 200 }}
                        >
                          {change.error ? (
                            <div className="px-4 py-4">
                              <p className="text-sm whitespace-pre-wrap break-words text-destructive">
                                {change.toolType} failed: {change.error}
                              </p>
                            </div>
                          ) : change.unifiedDiff ? (
                            <UnifiedDiffViewer
                              unifiedDiff={change.unifiedDiff}
                              filePath={change.filePath}
                              diffStyle={viewerSettings.diffStyle}
                              disableBackground={viewerSettings.disableBackground}
                              disableFileHeader={false}
                              onFileHeaderClick={onOpenFileExternal}
                              theme={isDark ? 'dark' : 'light'}
                            />
                          ) : (
                            <ShikiDiffViewer
                              original={change.original}
                              modified={change.modified}
                              filePath={change.filePath}
                              diffStyle={viewerSettings.diffStyle}
                              disableBackground={viewerSettings.disableBackground}
                              disableFileHeader={false}
                              onFileHeaderClick={onOpenFileExternal}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </nav>
      )}
    </div>
  )
}
