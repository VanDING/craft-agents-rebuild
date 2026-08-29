import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import type { KeyboardEvent } from 'react'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { ChevronRight, Link2, Maximize2, Minimize2, PackageOpen, Pin, PinOff, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { motionSpring } from '@craft-agent/ui/motion'
import {
  activateWorkbenchItemAtom,
  closeWorkbenchItemAtom,
  collapseWorkbenchAtom,
  setWorkbenchItemBindingAtom,
  type WorkbenchState,
} from '@/atoms/workbench'
import { expandedWorkbenchItemIdAtom } from '@/atoms/overlay'
import { activeSessionIdAtom } from '@/atoms/active-session'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { SURFACE_LAUNCHER_ICONS } from './SurfaceLauncherButtons'
import { surfaceLauncherLabelKey } from '@/lib/surface-launchers'

interface ContextWorkbenchTabsProps {
  state: WorkbenchState
}

/**
 * Persistent tab strip for Context Workbench items.
 *
 * Tabs stay mounted as lightweight state, while SurfaceContainer renders
 * only `activeItemId`. Closing the dock keeps the tab set for fast restore;
 * closing a tab removes that item completely.
 */
export function ContextWorkbenchTabs({ state }: ContextWorkbenchTabsProps) {
  const { t } = useTranslation()
  const activate = useSetAtom(activateWorkbenchItemAtom)
  const close = useSetAtom(closeWorkbenchItemAtom)
  const collapse = useSetAtom(collapseWorkbenchAtom)
  const setBinding = useSetAtom(setWorkbenchItemBindingAtom)
  const expandedItemId = useAtomValue(expandedWorkbenchItemIdAtom)
  const setExpandedItemId = useSetAtom(expandedWorkbenchItemIdAtom)
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const reduceMotion = useReducedMotion()
  const activeItem = state.items.find((item) => item.id === state.activeItemId) ?? null
  const boundSessionId = activeItem?.binding.type === 'session'
    ? activeItem.binding.sessionId
    : activeSessionId
  const activeSessionName = boundSessionId
    ? sessionMetaMap.get(boundSessionId)?.name ?? boundSessionId
    : null
  const isPinned = activeItem?.binding.type === 'session'
  const expanded = activeItem?.id === expandedItemId

  const focusTab = (itemId: string) => {
    requestAnimationFrame(() => {
      document.getElementById(`workbench-tab-${itemId}`)?.focus()
    })
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + state.items.length) % state.items.length
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % state.items.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = state.items.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const next = state.items[nextIndex]
    if (!next) return
    activate(next.id)
    focusTab(next.id)
  }

  const handleClose = (itemId: string, index: number) => {
    const focusTarget = itemId === state.activeItemId
      ? state.items[index + 1] ?? state.items[index - 1]
      : state.items.find((item) => item.id === state.activeItemId)
    close(itemId)
    if (expandedItemId === itemId) setExpandedItemId(null)
    if (focusTarget) focusTab(focusTarget.id)
  }

  return (
    <div
      data-workbench-tabs
      role="tablist"
      aria-label={t('contentPanel.workbench')}
      className="flex h-10 shrink-0 items-center gap-1 border-b border-border/50 bg-background/75 px-1.5 backdrop-blur-sm"
    >
      <LayoutGroup id="context-workbench-tabs">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {state.items.map((item, index) => {
          const Icon = item.kind === 'artifact' ? PackageOpen : SURFACE_LAUNCHER_ICONS[item.kind]
          const active = item.id === state.activeItemId
          const label = item.kind === 'artifact'
            ? t('artifact.workbench')
            : t(surfaceLauncherLabelKey(item.kind))
          return (
            <div
              key={item.id}
              className={cn(
                'group relative isolate flex h-7 max-w-40 shrink-0 items-center rounded-lg text-xs transition-colors',
                active
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/45 hover:text-foreground',
              )}
              role="presentation"
            >
              {active && (
                <motion.div
                  layoutId="workbench-active-tab"
                  className="pointer-events-none absolute inset-0 z-0 rounded-lg border border-border/50 bg-background/90"
                  transition={motionSpring(reduceMotion, 'responsive')}
                />
              )}
              <button
                id={`workbench-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => activate(item.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className="relative z-[1] flex min-w-0 flex-1 items-center gap-1.5 rounded-l-lg py-1 pl-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                <span className="truncate">{label}</span>
              </button>
              <button
                type="button"
                aria-label={`${t('common.close')} ${label}`}
                onClick={() => handleClose(item.id, index)}
                className={cn(
                  'relative z-[1] mr-1 rounded-sm p-0.5 opacity-0 transition-opacity hover:bg-foreground/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100',
                  active && 'opacity-60',
                )}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>
      </LayoutGroup>

      {activeSessionName && activeItem?.kind !== 'artifact' && (
        <span
          className="@max-[700px]/panel:hidden flex min-w-0 max-w-44 shrink items-center gap-1 rounded-full border border-border/50 bg-foreground/[0.025] px-2 py-0.5 text-[11px] text-muted-foreground"
          title={activeSessionName}
        >
          <Link2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{activeSessionName}</span>
        </span>
      )}

      {activeItem && activeItem.kind !== 'artifact' && activeSessionId && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setBinding({
                id: activeItem.id,
                binding: isPinned
                  ? { type: 'follow-primary' }
                  : { type: 'session', sessionId: activeSessionId },
              })}
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                isPinned ? 'text-accent' : 'text-muted-foreground',
              )}
              aria-label={t(isPinned ? 'contentPanel.followSession' : 'contentPanel.pinSession')}
            >
              {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t(isPinned ? 'contentPanel.followSession' : 'contentPanel.pinSession')}</TooltipContent>
        </Tooltip>
      )}

      {activeItem && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setExpandedItemId(expanded ? null : activeItem.id)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t(expanded ? 'contentPanel.restore' : 'contentPanel.expand')}
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t(expanded ? 'contentPanel.restore' : 'contentPanel.expand')}</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => expanded ? setExpandedItemId(null) : collapse()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t(expanded ? 'contentPanel.restore' : 'contentPanel.collapse')}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t(expanded ? 'contentPanel.restore' : 'contentPanel.collapse')}</TooltipContent>
      </Tooltip>
    </div>
  )
}
