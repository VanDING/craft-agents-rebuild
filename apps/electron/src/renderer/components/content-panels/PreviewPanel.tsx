/**
 * PreviewPanel - per-session previews (opened files + doc pop-outs).
 *
 * Collects, per active session:
 * - files opened through the link interceptor (Task 10 routes those here)
 * - markdown pop-outs / turn details / activity expansions from the chat
 *
 * Renders a tab list of entries with a content area below; the selected entry
 * lives in a global atom (content-panel-ui) so the panel keeps its selection
 * when expanded to fullscreen (Task 11).
 */

import { useMemo } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { FileText, Eye, MessageSquare, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Markdown } from '@craft-agent/ui'
import { PanelEmptyState } from './PanelEmptyState'
import { FilePreviewContent } from './FilePreviewContent'
import { activeSessionIdAtom } from '@/atoms/active-session'
import { previewEntriesForSessionAtom, removePreviewEntryAtom, type PreviewEntry } from '@/atoms/preview'
import { previewPanelSelectedKeyAtom } from '@/atoms/content-panel-ui'
import { useAppShellContext } from '@/context/AppShellContext'
import { motionSpring, motionTween } from '@craft-agent/ui/motion'

const entryKey = (entry: PreviewEntry): string =>
  entry.type === 'file' ? `file:${entry.path}` : `md:${entry.id}`

export function PreviewPanel({ sessionId }: { sessionId?: string }) {
  const { t } = useTranslation()
  const currentActiveSessionId = useAtomValue(activeSessionIdAtom)
  const activeSessionId = sessionId ?? currentActiveSessionId
  const entries = useAtomValue(previewEntriesForSessionAtom)(activeSessionId ?? '')
  const selectedKey = useAtomValue(previewPanelSelectedKeyAtom)
  const setSelectedKey = useSetAtom(previewPanelSelectedKeyAtom)
  const removeEntry = useSetAtom(removePreviewEntryAtom)
  const { onOpenFile, onOpenUrl } = useAppShellContext()
  const reduceMotion = useReducedMotion()

  // Keep the selection valid: default to the most recent entry.
  const effectiveKey = useMemo(() => {
    if (entries.some((entry) => entryKey(entry) === selectedKey)) return selectedKey
    return entries.length > 0 ? entryKey(entries[entries.length - 1]) : null
  }, [entries, selectedKey])

  const selected = entries.find((entry) => entryKey(entry) === effectiveKey) ?? null

  if (!activeSessionId) {
    return (
      <>
        <PanelEmptyState
          title={t('contentPanel.noActiveSession')}
          icon={<Eye className="h-6 w-6" />}
        />
      </>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {entries.length === 0 ? (
        <PanelEmptyState
          title={t('contentPanel.preview.empty')}
          hint={t('contentPanel.preview.emptyHint')}
          icon={<Eye className="h-6 w-6" />}
        />
      ) : (
        <>
          {/* Entry tabs */}
          <LayoutGroup id="preview-entry-tabs">
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/50 bg-background/65 px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
            {entries.map((entry) => {
              const key = entryKey(entry)
              const isActive = key === effectiveKey
              const label = entry.type === 'file'
                ? entry.path.split(/[/\\]/).pop() || entry.path
                : entry.title
              const Icon = entry.type === 'file' ? FileText : MessageSquare
              return (
                <div
                  key={key}
                  ref={isActive ? (el) => el?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) : undefined}
                  className={cn(
                    'group relative isolate flex h-7 max-w-[16rem] shrink-0 items-center gap-0.5 rounded-lg px-1.5 text-[12px] transition-colors',
                    isActive
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:bg-foreground/[0.035]',
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="preview-active-entry"
                      className="absolute inset-0 -z-10 rounded-lg border border-border/60 bg-background shadow-minimal"
                      transition={motionSpring(reduceMotion, 'responsive')}
                    />
                  )}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    title={entry.type === 'file' ? entry.path : entry.title}
                    onClick={() => { if (!isActive) setSelectedKey(key) }}
                    className="flex h-full min-w-0 flex-1 items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Icon className="h-3 w-3 shrink-0" />
                    <span className="truncate">{label}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={t('common.close')}
                    onClick={() => removeEntry({ sessionId: activeSessionId, identity: key })}
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground',
                      isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                    )}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
          </LayoutGroup>

          {/* Content area */}
          <div className="min-h-0 flex-1 bg-foreground/[0.012] p-2.5">
            <div className="h-full min-h-0 overflow-hidden rounded-xl border border-border/60 bg-background/65 shadow-minimal">
            <AnimatePresence mode="wait" initial={false}>
            {selected ? (
              <motion.div
                key={entryKey(selected)}
                className="h-full min-h-0"
                initial={reduceMotion ? false : { opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -2 }}
                transition={motionTween(reduceMotion, 'standard', 'enter')}
              >
              {selected.type === 'file' ? (
                <FilePreviewContent
                  filePath={selected.path}
                  onOpenUrl={onOpenUrl}
                  onFileClick={(path) => onOpenFile(path, activeSessionId)}
                />
              ) : (
                <div className="h-full overflow-auto px-4 py-3">
                  <Markdown
                    children={selected.content}
                    onUrlClick={onOpenUrl}
                    onFileClick={(path) => onOpenFile(path, activeSessionId)}
                  />
                </div>
              )}
              </motion.div>
            ) : (
              <PanelEmptyState title={t('contentPanel.preview.empty')} />
            )}
            </AnimatePresence>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
