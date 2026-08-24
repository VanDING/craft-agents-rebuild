/**
 * ExpandedWorkbenchOverlay - fullscreen rendering of the active workbench item.
 *
 * Mounts inside AppShellProvider, locates the active Workbench item and renders
 * the same bound-content dispatch as SurfaceSlot. The docked slot is hidden
 * with `display:none` (not unmounted), so lifted per-item UI state stays stable.
 *
 * Restore/close controls are injected into the panel's own header through a
 * context override — the exact same mechanism SurfaceSlot uses when docked —
 * so they sit in the normal header row instead of floating over (and
 * colliding with) the panel's own header actions like Share.
 * Esc also restores the panel and refocuses it.
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { Minimize2, X } from 'lucide-react'
import {
  closeWorkbenchItemAtom,
  focusedSurfaceEntryIdAtom,
  renderedSurfaceEntriesAtom,
} from '@/atoms/workbench'
import { expandedWorkbenchItemIdAtom } from '@/atoms/overlay'
import { BoundPanelContent, isBoundPanelType } from '@/components/content-panels/bound-panel-content'
import { MainContentPanel } from './MainContentPanel'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { AppShellProvider, useAppShellContext } from '@/context/AppShellContext'

export function ExpandedWorkbenchOverlay() {
  const { t } = useTranslation()
  const expandedItemId = useAtomValue(expandedWorkbenchItemIdAtom)
  const surfaceEntries = useAtomValue(renderedSurfaceEntriesAtom)
  const setExpandedItemId = useSetAtom(expandedWorkbenchItemIdAtom)
  const setFocusedSurface = useSetAtom(focusedSurfaceEntryIdAtom)
  const closeWorkbenchItem = useSetAtom(closeWorkbenchItemAtom)
  const parentContext = useAppShellContext()

  const entry = surfaceEntries.find((surface) => surface.id === expandedItemId) ?? null

  // Esc restores the panel and refocuses it.
  useEffect(() => {
    if (!expandedItemId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpandedItemId(null)
        setFocusedSurface(expandedItemId)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [expandedItemId, setExpandedItemId, setFocusedSurface])

  const restore = useCallback(() => {
    if (!entry) return
    setExpandedItemId(null)
    setFocusedSurface(entry.id)
  }, [entry, setExpandedItemId, setFocusedSurface])

  const close = useCallback(() => {
    if (!entry) return
    setExpandedItemId(null)
    closeWorkbenchItem(entry.id)
  }, [entry, setExpandedItemId, closeWorkbenchItem])

  // Same contract SurfaceSlot uses when docked: expandButton toggles fullscreen,
  // trailingAction closes the item. Inside the overlay, "expand" becomes
  // "restore"; both land in the panel header's standard button row.
  const contextOverride = useMemo(() => ({
    ...parentContext,
    expandButton: (
      <PanelHeaderCenterButton
        icon={<Minimize2 className="h-4 w-4" />}
        onClick={restore}
        tooltip={t('contentPanel.restore')}
      />
    ),
    trailingAction: (
      <PanelHeaderCenterButton
        icon={<X className="h-4 w-4" />}
        onClick={close}
        tooltip={t('common.close')}
      />
    ),
  }), [parentContext, restore, close, t])

  if (!entry) return null

  return (
    <div className="fixed inset-0 z-[999] flex flex-col bg-background" data-expanded-panel-overlay>
      <div className="min-h-0 flex-1">
        <AppShellProvider value={contextOverride}>
          {isBoundPanelType(entry.panelType) ? (
            <BoundPanelContent entry={entry} />
          ) : (
            <MainContentPanel
              navStateOverride={parseRouteToNavigationState(entry.route)}
              // Fullscreen overlay: sidebar + navigator are hidden, so children
              // must compensate for the macOS traffic lights (StoplightProvider).
              isSidebarAndNavigatorHidden
            />
          )}
        </AppShellProvider>
      </div>
    </div>
  )
}
