/**
 * WorkbenchPanelButtons
 *
 * Flat top-bar buttons for the generic content workbench. Each DOM-panel kind
 * (sessions/board/calendar/diff/files/context/preview) and the browser get a
 * peer button (semantic decision #2).
 *
 * Button state is derived from the panel stack (front-stage) plus the hidden
 * panel set (Task 5, passed in as `hiddenKinds` so this component stays
 * decoupled from the persistence atom):
 * - open (present in foreground)       → normal brightness
 * - focused (the active panel)         → highlight (isActive)
 * - background (only in hidden set)    → dimmed + bottom dot
 * - collapsed (not open anywhere)      → dimmed
 *
 * Click semantics (decision #3): plain click = toggle (focus if open, otherwise
 * push). Shift/Alt click = replace the focused panel content. Browser click
 * reuses the focus-or-create behaviour supplied by AppShell.
 */

import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import {
  MessageSquare, LayoutGrid, CalendarDays, GitCompareArrows,
  FolderTree, ListFilter, FileText, Globe, List, Activity,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SquarePenRounded } from '../icons/SquarePenRounded'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { TopBarButton } from '@/components/ui/TopBarButton'
import { panelStackAtom, focusedPanelIdAtom } from '@/atoms/panel-stack'
import { hiddenPanelsAtom } from '@/atoms/hidden-panels'
import { browserInstancesAtom, filterInstancesForWorkspace } from '@/atoms/browser-pane'
import { useAppShellContext } from '@/context/AppShellContext'
import {
  WORKBENCH_PANEL_KINDS,
  workbenchPanelKindForRoute,
  type WorkbenchPanelKind,
} from '@/lib/workbench-panels'

export type PanelButtonState = 'closed' | 'open' | 'focused' | 'background'

/** Top-bar button order (left → right): New Session, the panel kinds, the
 * browser (focus-or-create; Shift/Alt = new window), and the session-list
 * toggle. All entries are always rendered tiled — no width truncation. */
const TOP_BAR_BUTTON_ORDER = ['newSession', ...WORKBENCH_PANEL_KINDS, 'browser', 'sessionList'] as const

interface WorkbenchPanelButtonsProps {
  /** Open/focus/replace a workbench panel (AppShell wires this) */
  onOpenPanel: (kind: WorkbenchPanelKind, options?: { replace?: boolean }) => void
  /** Focus an existing browser window or create a new one */
  onOpenBrowser: () => void
  /** Open a new session in a new panel (was the [+] menu item) */
  onNewSessionPanel: () => void
  /** Open a brand-new browser window (was the [+] menu item) */
  onNewBrowser: () => void
  /** Toggle the navigator (session list) column — decision #7 */
  onToggleSessionList?: () => void
}

export const WORKBENCH_ICONS: Record<WorkbenchPanelKind, LucideIcon> = {
  sessions: MessageSquare,
  board: LayoutGrid,
  calendar: CalendarDays,
  diff: GitCompareArrows,
  files: FolderTree,
  context: ListFilter,
  preview: FileText,
  trajectory: Activity,
}

export function WorkbenchPanelButtons({
  onOpenPanel,
  onOpenBrowser,
  onNewSessionPanel,
  onNewBrowser,
  onToggleSessionList,
}: WorkbenchPanelButtonsProps) {
  const { t } = useTranslation()
  const stack = useAtomValue(panelStackAtom)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  const hiddenPanels = useAtomValue(hiddenPanelsAtom)
  const { activeWorkspaceId, workspaces } = useAppShellContext()
  const allBrowserInstances = useAtomValue(browserInstancesAtom)

  // Background-set kinds → dimmed button with a bottom dot (three-state).
  const hiddenKinds = useMemo(() => {
    const kinds = new Set<WorkbenchPanelKind>()
    for (const entry of hiddenPanels) {
      const kind = workbenchPanelKindForRoute(entry.route)
      if (kind) kinds.add(kind)
    }
    return kinds
  }, [hiddenPanels])

  // Browser presence = a live window for the current workspace (local or the
  // remote-mirror workspace id, matching BrowserTabStrip's filter).
  const browserPresent = useMemo(() => {
    const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
    const remoteWorkspaceId = activeWorkspace?.remoteServer?.remoteWorkspaceId ?? null
    return filterInstancesForWorkspace(allBrowserInstances, activeWorkspaceId, remoteWorkspaceId).length > 0
  }, [allBrowserInstances, activeWorkspaceId, workspaces])

  // Derive the per-kind state from the front-stage stack + hidden set.
  const states = useMemo((): Record<WorkbenchPanelKind, PanelButtonState> => {
    const focusedEntry = stack.find((entry) => entry.id === focusedPanelId)
    const focusedKind = focusedEntry ? workbenchPanelKindForRoute(focusedEntry.route) : null

    const result = {} as Record<WorkbenchPanelKind, PanelButtonState>
    for (const kind of WORKBENCH_PANEL_KINDS) {
      const present = stack.some((entry) => workbenchPanelKindForRoute(entry.route) === kind)
      if (present) {
        result[kind] = focusedKind === kind ? 'focused' : 'open'
      } else if (hiddenKinds?.has(kind)) {
        result[kind] = 'background'
      } else {
        result[kind] = 'closed'
      }
    }
    return result
  }, [stack, focusedPanelId, hiddenKinds])

  const handleClick = useCallback((kind: WorkbenchPanelKind | 'browser', event: React.MouseEvent) => {
    if (kind === 'browser') {
      onOpenBrowser()
      return
    }
    onOpenPanel(kind, { replace: event.shiftKey || event.altKey })
  }, [onOpenBrowser, onOpenPanel])

  // All buttons render tiled (no width truncation — every entry stays
  // directly clickable).
  const allButtons = TOP_BAR_BUTTON_ORDER

  return (
    <div className="inline-flex items-center gap-0.5">
      {allButtons.map((kind) => {
        if (kind === 'sessionList') {
          if (!onToggleSessionList) return null
          return (
            <Tooltip key="sessionList">
              <TooltipTrigger asChild>
                <TopBarButton
                  aria-label={t('contentPanel.title.sessionsList')}
                  onClick={onToggleSessionList}
                  className="h-[22px] w-[22px] rounded-md text-foreground/35"
                >
                  <List className="h-3.5 w-3.5" strokeWidth={2} />
                </TopBarButton>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('contentPanel.title.sessionsList')}</TooltipContent>
            </Tooltip>
          )
        }

        if (kind === 'newSession') {
          return (
            <Tooltip key="newSession">
              <TooltipTrigger asChild>
                <TopBarButton
                  aria-label={t('session.newSessionInPanel')}
                  onClick={onNewSessionPanel}
                  className="h-[22px] w-[22px] rounded-md text-foreground/35"
                >
                  <SquarePenRounded className="h-3.5 w-3.5" strokeWidth={2} />
                </TopBarButton>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('session.newSessionInPanel')}</TooltipContent>
            </Tooltip>
          )
        }

        if (kind === 'browser') {
          return (
            <Tooltip key="browser">
              <TooltipTrigger asChild>
                <TopBarButton
                  aria-label={t('contentPanel.button.browser')}
                  isActive={browserPresent}
                  onClick={(event) => {
                    // Shift/Alt click = force a brand-new browser window
                    // (was the separate [+] menu action); plain click keeps
                    // the focus-or-create behaviour.
                    if (event.shiftKey || event.altKey) {
                      onNewBrowser()
                    } else {
                      onOpenBrowser()
                    }
                  }}
                  className={cn(
                    'h-[22px] w-[22px] rounded-md',
                    browserPresent ? 'text-foreground/60' : 'text-foreground/35',
                  )}
                >
                  <Globe className="h-3.5 w-3.5" strokeWidth={2} />
                </TopBarButton>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('contentPanel.button.browser')}</TooltipContent>
            </Tooltip>
          )
        }

        const Icon = WORKBENCH_ICONS[kind]
        const state = states[kind]
        return (
          <Tooltip key={kind}>
            <TooltipTrigger asChild>
              <TopBarButton
                aria-label={t(`contentPanel.button.${kind}`)}
                isActive={state === 'focused'}
                onClick={(event) => handleClick(kind, event)}
                className={cn(
                  'h-[22px] w-[22px] rounded-md',
                  state === 'focused' && 'text-foreground',
                  state === 'open' && 'text-foreground/60',
                  (state === 'closed' || state === 'background') && 'text-foreground/35',
                )}
              >
                <span className="relative flex items-center justify-center">
                  <Icon className="h-3.5 w-3.5" strokeWidth={state === 'focused' ? 2.25 : 2} />
                  {state === 'background' && (
                    <span className="absolute -bottom-[7px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-foreground/60" />
                  )}
                </span>
              </TopBarButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t(`contentPanel.button.${kind}`)}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
