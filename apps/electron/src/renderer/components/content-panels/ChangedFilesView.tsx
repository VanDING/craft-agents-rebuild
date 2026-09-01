/**
 * ChangedFilesView - the Files panel's changed-files subview.
 *
 * Renders the session's file changes (Edit/Write activities) as a list grouped
 * by file, colored by diff kind (add / del / mix), with ±N line stats. Clicking
 * a file expands an embedded ShikiDiffViewer / UnifiedDiffViewer in the panel
 * (no overlay). Message loading is owned by the parent Files panel, so this
 * view only handles loaded changes and their empty state.
 *
 * Selected-file and scroll-focus state live in global atoms (content-panel-ui)
 * so the panel keeps identical state when expanded to fullscreen (Task 11).
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { ChevronRight, ChevronDown, FilePlus, Files, PencilLine, GitCompareArrows, ChevronsUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlatform, UnifiedDiffViewer, type FileChange } from '@craft-agent/ui'
import { ShikiDiffViewer } from '@/components/shiki/ShikiDiffViewer'
import { useTheme } from '@/hooks/useTheme'
import { PanelEmptyState } from './PanelEmptyState'
import { computeChangeStats, createFileSections } from '@craft-agent/ui'
import { diffKindForSection, type DiffKind } from '@/lib/diff-kinds'
import { useDiffViewerSettings } from '@/lib/use-diff-viewer-settings'
import { changedFilesSelectedKeyBySessionAtom, filesPanelFocusRequestAtom, updateWorkbenchFocusAtom } from '@/atoms/content-panel-ui'
import { motionSpring, motionTween } from '@craft-agent/ui/motion'

const KIND_DOTS: Record<DiffKind, string> = {
  add: 'bg-emerald-500',
  del: 'bg-rose-500',
  mix: 'bg-amber-500',
}

/** Localized label for a diff kind — used as the dot's tooltip (the visual
 *  encoding is the dot color; a text label was a third redundant channel). */
function diffKindLabel(kind: DiffKind, t: (key: string) => string): string {
  const key = kind === 'add' ? 'contentPanel.diff.add' : kind === 'del' ? 'contentPanel.diff.del' : 'contentPanel.diff.mix'
  return t(key)
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

export function ChangedFilesView({ sessionId, changes }: { sessionId: string; changes: FileChange[] }) {
  const { t } = useTranslation()
  const { onOpenFileExternal } = usePlatform()
  const { isDark } = useTheme()
  const [viewerSettings, setViewerSettings] = useDiffViewerSettings()
  const reduceMotion = useReducedMotion()

  const selectedKeyBySession = useAtomValue(changedFilesSelectedKeyBySessionAtom)
  const setSelectedKeyBySession = useSetAtom(changedFilesSelectedKeyBySessionAtom)
  const selectedKey = selectedKeyBySession[sessionId] ?? null
  const setSelectedKey = useCallback((key: string | null) => {
    setSelectedKeyBySession(current => ({ ...current, [sessionId]: key }))
  }, [sessionId, setSelectedKeyBySession])
  const updateWorkbenchFocus = useSetAtom(updateWorkbenchFocusAtom)
  const focusRequest = useAtomValue(filesPanelFocusRequestAtom)
  const setFocusRequest = useSetAtom(filesPanelFocusRequestAtom)
  const changeRefs = useRef(new Map<string, HTMLDivElement>())
  const sections = useMemo(() => createFileSections(changes, true), [changes])
  const totalStats = useMemo(() => {
    let additions = 0
    let deletions = 0
    for (const change of changes) {
      if (change.error) continue
      const stats = computeChangeStats(change)
      additions += stats.additions
      deletions += stats.deletions
    }
    return { additions, deletions }
  }, [changes])

  const setChangeRef = useCallback((changeId: string, el: HTMLDivElement | null) => {
    if (el) changeRefs.current.set(changeId, el)
    else changeRefs.current.delete(changeId)
  }, [])

  // Consume a scroll-to-change request from ChatDisplay: open the containing
  // section, then scroll the change into view once rendered.
  useEffect(() => {
    if (!focusRequest || focusRequest.sessionId !== sessionId || focusRequest.view !== 'changed' || !focusRequest.changeId) return
    const { changeId } = focusRequest
    const matchingChange = sections
      .flatMap((section) => section.changes)
      .find((change) => (
        change.id === changeId
        || change.id.startsWith(`${changeId}:`)
        || change.id.startsWith(`${changeId}-`)
      ))
    const resolvedChangeId = matchingChange?.id ?? changeId
    const containing = sections.find((section) => section.changes.some((c) => c.id === resolvedChangeId))
    if (containing && selectedKey !== containing.key) {
      setSelectedKey(containing.key)
    }
    updateWorkbenchFocus({ sessionId, source: 'files', changeId: resolvedChangeId, filePath: containing?.filePath })
    const timer = setTimeout(() => {
      changeRefs.current.get(resolvedChangeId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 120)
    setFocusRequest(null)
    return () => clearTimeout(timer)
  }, [sessionId, focusRequest, sections, selectedKey, setSelectedKey, setFocusRequest, updateWorkbenchFocus])

  // Review-specific controls live below the shared panel header so its centered
  // title and bound-session subtitle keep the same geometry as every other panel.
  const toolbarActions = useMemo(() => {
    const styleButtons = (['unified', 'split'] as const).map((style) => (
      <button
        key={style}
        type="button"
        aria-pressed={viewerSettings.diffStyle === style}
        onClick={() => setViewerSettings({ diffStyle: style, disableBackground: viewerSettings.disableBackground })}
        className={cn(
          'relative isolate h-7 rounded-md px-2 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
          viewerSettings.diffStyle === style
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {viewerSettings.diffStyle === style && (
          <motion.span
            layoutId="changed-files-diff-style"
            className="pointer-events-none absolute inset-0 z-0 rounded-md border border-border/55 bg-background shadow-minimal"
            transition={motionSpring(reduceMotion, 'responsive')}
          />
        )}
        <span className="relative z-[1]">{t(`contentPanel.diff.style${style === 'unified' ? 'Unified' : 'Split'}`)}</span>
      </button>
    ))
    return (
      <div className="flex items-center gap-1.5">
        <LayoutGroup id="changed-files-diff-style">
          <div className="flex items-center rounded-lg border border-border/60 bg-foreground/[0.025] p-0.5">{styleButtons}</div>
        </LayoutGroup>
        <div className="border-l border-border/55 pl-1.5">
          <button
            type="button"
            aria-label={t('contentPanel.diff.collapseAll')}
            title={t('contentPanel.diff.collapseAll')}
            onClick={() => setSelectedKey(null)}
            disabled={!selectedKey}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"
          >
            <ChevronsUp className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }, [viewerSettings, setViewerSettings, selectedKey, setSelectedKey, t, reduceMotion])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {changes.length > 0 && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 bg-background/55 px-2.5 backdrop-blur-sm">
          <div
            className="flex min-w-0 items-center gap-2 text-[11px] font-medium tabular-nums text-muted-foreground @max-[420px]/panel:hidden"
            aria-label={`${t('contentPanel.files.view.changed')}: ${sections.length}`}
          >
            <span className="inline-flex items-center gap-1">
              <Files className="h-3.5 w-3.5" />
              {sections.length}
            </span>
            {(totalStats.additions > 0 || totalStats.deletions > 0) && (
              <span className="inline-flex items-center gap-1.5">
                <span className="text-emerald-600 dark:text-emerald-400">+{totalStats.additions}</span>
                <span className="text-rose-600 dark:text-rose-400">-{totalStats.deletions}</span>
              </span>
            )}
          </div>
          <div className="ml-auto shrink-0">{toolbarActions}</div>
        </div>
      )}

      {changes.length === 0 ? (
        <PanelEmptyState
          title={t('contentPanel.diff.noChanges')}
          hint={t('contentPanel.diff.noChangesHint')}
          icon={<GitCompareArrows className="h-6 w-6" />}
        />
      ) : (
        <nav className="min-h-0 flex-1 overflow-y-auto bg-foreground/[0.012] p-2.5" aria-label={t('contentPanel.files.view.changed')}>
          <ul className="flex flex-col gap-2">
            {sections.map((section) => {
              const key = section.key
              const isOpen = selectedKey === key
              const kind = diffKindForSection(section)
              return (
                <li key={key} className={cn('break-inside-avoid overflow-hidden rounded-xl border border-border/60 bg-background/60 shadow-minimal', isOpen && 'border-border/80 bg-background/80')}>
                  <button
                    type="button"
                    onClick={() => setSelectedKey(isOpen ? null : key)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      isOpen && 'bg-foreground/[0.025]',
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
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', KIND_DOTS[kind])} title={diffKindLabel(kind, t)} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium" title={section.filePath}>{fileBaseName(section.filePath)}</span>
                    </span>
                    <SectionStats changes={section.changes} />
                  </button>

                  <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                      transition={motionTween(reduceMotion, 'standard', 'move')}
                      className="overflow-hidden border-t border-border/50"
                    >
                    <div className="flex flex-col gap-3 p-2">
                      {section.changes.map((change) => (
                        <div
                          key={change.id}
                          ref={(el) => setChangeRef(change.id, el)}
                          className="overflow-hidden rounded-lg border border-border/60 bg-background"
                          style={{
                            // Skip layout/highlight work for off-screen diffs;
                            // 600px intrinsic estimate keeps scrollbar stable.
                            contentVisibility: 'auto',
                            containIntrinsicSize: 'auto 600px',
                            minHeight: change.error ? undefined : 200,
                          }}
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
                    </motion.div>
                  )}
                  </AnimatePresence>
                </li>
              )
            })}
          </ul>
        </nav>
      )}
    </div>
  )
}
