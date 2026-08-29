/**
 * ExpandedWorkbenchOverlay - fullscreen rendering of the active workbench item.
 *
 * Mounts inside AppShellProvider, locates the active Workbench item and renders
 * the same bound-content dispatch as SurfaceSlot. The docked slot is hidden
 * with `display:none` (not unmounted), so lifted per-item UI state stays stable.
 *
 * The shared Workbench tab strip remains the single place for restore, scope,
 * tab-close and collapse controls, so fullscreen and docked layouts keep the
 * same hierarchy. Esc also restores the panel and refocuses it.
 */

import { useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  focusedSurfaceEntryIdAtom,
  renderedSurfaceEntriesAtom,
  workbenchStateAtom,
} from '@/atoms/workbench'
import { expandedWorkbenchItemIdAtom } from '@/atoms/overlay'
import { BoundPanelContent, isBoundPanelType } from '@/components/content-panels/bound-panel-content'
import { MainContentPanel } from './MainContentPanel'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { ContextWorkbenchTabs } from './ContextWorkbenchTabs'

export function ExpandedWorkbenchOverlay() {
  const expandedItemId = useAtomValue(expandedWorkbenchItemIdAtom)
  const surfaceEntries = useAtomValue(renderedSurfaceEntriesAtom)
  const workbench = useAtomValue(workbenchStateAtom)
  const setExpandedItemId = useSetAtom(expandedWorkbenchItemIdAtom)
  const setFocusedSurface = useSetAtom(focusedSurfaceEntryIdAtom)

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

  if (!entry) return null

  return (
    <div className="fixed inset-0 z-[999] flex flex-col bg-background" data-expanded-panel-overlay>
      <ContextWorkbenchTabs state={workbench} />
      <div className="min-h-0 flex-1">
        {isBoundPanelType(entry.panelType) ? (
          <BoundPanelContent entry={entry} />
        ) : (
          <MainContentPanel
            navStateOverride={parseRouteToNavigationState(entry.route)}
            isSidebarAndNavigatorHidden
          />
        )}
      </div>
    </div>
  )
}
