import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import type { KeyboardEvent } from 'react'
import { ChevronRight, PackageOpen, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import {
  activateWorkbenchItemAtom,
  closeWorkbenchItemAtom,
  collapseWorkbenchAtom,
  type WorkbenchState,
} from '@/atoms/workbench'
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
    if (focusTarget) focusTab(focusTarget.id)
  }

  return (
    <div
      data-workbench-tabs
      role="tablist"
      aria-label={t('contentPanel.workbench')}
      className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border/60 bg-background/65 px-1.5"
    >
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
                'group flex h-7 max-w-40 shrink-0 items-center rounded-md text-xs transition-colors',
                active
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
              )}
              role="presentation"
            >
              <button
                id={`workbench-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => activate(item.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                <span className="truncate">{label}</span>
              </button>
              <button
                type="button"
                aria-label={`${t('common.close')} ${label}`}
                onClick={() => handleClose(item.id, index)}
                className={cn(
                  'mr-1 rounded-sm p-0.5 opacity-0 transition-opacity hover:bg-foreground/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100',
                  active && 'opacity-60',
                )}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => collapse()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label={t('contentPanel.collapse')}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('contentPanel.collapse')}</TooltipContent>
      </Tooltip>
    </div>
  )
}
