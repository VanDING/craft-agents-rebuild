/**
 * SurfaceLauncherButtons
 *
 * Top-bar launchers for Primary Surfaces and Context Workbench items. Kanban
 * and Calendar are direct primary launchers; Projects remains in the sidebar.
 *
 * Primary state comes from `primarySurfaceAtom`; bound item state comes from
 * `workbenchStateAtom`. A collapsed workbench retains its tab and shows the
 * former background dot, but no hidden/LRU panel set exists anymore.
 *
 * Bound-item click semantics: activate an existing tab or create it. Primary
 * launchers navigate the one Primary Surface. Browser keeps its own
 * focus-or-create behaviour.
 */

import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import {
  MessageSquare, Columns3, CalendarDays,
  FolderTree, ListFilter, FileText, Globe, Activity,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SquarePenRounded } from '../icons/SquarePenRounded'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { TopBarButton } from '@/components/ui/TopBarButton'
import { primarySurfaceAtom, workbenchStateAtom } from '@/atoms/workbench'
import { browserInstancesAtom, filterInstancesForWorkspace } from '@/atoms/browser-pane'
import { useAppShellContext } from '@/context/AppShellContext'
import {
  SURFACE_LAUNCHER_KINDS,
  isContextWorkbenchKind,
  surfaceLauncherLabelKey,
  surfaceLauncherKindForRoute,
  type SurfaceLauncherKind,
} from '@/lib/surface-launchers'

export type SurfaceLauncherState = 'closed' | 'open' | 'focused' | 'background'

/** Top-bar button order (left → right): New Session, surface/tool launchers,
 * and the browser (focus-or-create; Shift/Alt = new window). All entries are
 * always rendered tiled — no width truncation. */
const TOP_BAR_BUTTON_ORDER = ['newSession', ...SURFACE_LAUNCHER_KINDS, 'browser'] as const

interface SurfaceLauncherButtonsProps {
  /** Navigate a Primary launcher or activate/create a Workbench item. */
  onOpenLauncher: (kind: SurfaceLauncherKind) => void
  /** Focus an existing browser window or create a new one */
  onOpenBrowser: () => void
  /** Create a new session beside the active conversation. */
  onNewSession: () => void
  /** Open a brand-new browser window (was the [+] menu item) */
  onNewBrowser: () => void
}

export const SURFACE_LAUNCHER_ICONS: Record<SurfaceLauncherKind, LucideIcon> = {
  sessions: MessageSquare,
  kanban: Columns3,
  calendar: CalendarDays,
  files: FolderTree,
  context: ListFilter,
  preview: FileText,
  trajectory: Activity,
  terminal: SquareTerminal,
}

export function SurfaceLauncherButtons({
  onOpenLauncher,
  onOpenBrowser,
  onNewSession,
  onNewBrowser,
}: SurfaceLauncherButtonsProps) {
  const { t } = useTranslation()
  const primarySurface = useAtomValue(primarySurfaceAtom)
  const workbench = useAtomValue(workbenchStateAtom)
  const { activeWorkspaceId, workspaces } = useAppShellContext()
  const allBrowserInstances = useAtomValue(browserInstancesAtom)

  // Browser presence = a live window for the current workspace (local or the
  // remote-mirror workspace id, matching BrowserTabStrip's filter).
  const browserPresent = useMemo(() => {
    const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
    const remoteWorkspaceId = activeWorkspace?.remoteServer?.remoteWorkspaceId ?? null
    return filterInstancesForWorkspace(allBrowserInstances, activeWorkspaceId, remoteWorkspaceId).length > 0
  }, [allBrowserInstances, activeWorkspaceId, workspaces])

  // Derive Primary selection and Workbench tab/open state from explicit roles.
  const states = useMemo((): Record<SurfaceLauncherKind, SurfaceLauncherState> => {
    const primaryKind = surfaceLauncherKindForRoute(primarySurface.route)
    const activeItem = workbench.items.find((item) => item.id === workbench.activeItemId)

    const result = {} as Record<SurfaceLauncherKind, SurfaceLauncherState>
    for (const kind of SURFACE_LAUNCHER_KINDS) {
      if (!isContextWorkbenchKind(kind)) {
        result[kind] = primaryKind === kind ? 'focused' : 'closed'
        continue
      }

      const item = workbench.items.find((candidate) => candidate.kind === kind)
      if (!item) result[kind] = 'closed'
      else if (workbench.open && activeItem?.id === item.id) result[kind] = 'focused'
      else if (workbench.open) result[kind] = 'open'
      else result[kind] = 'background'
    }
    return result
  }, [primarySurface.route, workbench])

  const handleClick = useCallback((kind: SurfaceLauncherKind | 'browser') => {
    if (kind === 'browser') {
      onOpenBrowser()
      return
    }
    onOpenLauncher(kind)
  }, [onOpenBrowser, onOpenLauncher])

  // All buttons render tiled (no width truncation — every entry stays
  // directly clickable).
  const allButtons = TOP_BAR_BUTTON_ORDER

  return (
    <div className="inline-flex items-center gap-0.5">
      {allButtons.map((kind) => {
        if (kind === 'newSession') {
          return (
            <Tooltip key="newSession">
              <TooltipTrigger asChild>
                <TopBarButton
                  aria-label={t('session.newSessionInPanel')}
                  onClick={onNewSession}
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

        const Icon = SURFACE_LAUNCHER_ICONS[kind]
        const state = states[kind]
        const label = t(surfaceLauncherLabelKey(kind))
        return (
          <Tooltip key={kind}>
            <TooltipTrigger asChild>
              <TopBarButton
                aria-label={label}
                isActive={state === 'focused'}
                onClick={() => handleClick(kind)}
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
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
