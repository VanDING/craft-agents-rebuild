/**
 * ExpandedPanelOverlay - fullscreen rendering of an expanded panel (decision #6).
 *
 * Mounts inside AppShellProvider. Reads expandedPanelIdAtom, locates the panel
 * entry, and renders the SAME content dispatch the panel slot uses (bound
 * panels → BoundPanelContent, everything else → MainContentPanel with a nav
 * override). The panel slot itself is hidden with `display:none` (not
 * unmounted), and per-panel UI state lives in global atoms, so the two
 * renderings stay consistent.
 *
 * Restore/close controls are injected into the panel's own header through a
 * context override — the exact same mechanism PanelSlot uses when docked —
 * so they sit in the normal header row instead of floating over (and
 * colliding with) the panel's own header actions like Share.
 * Esc also restores the panel and refocuses it.
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { Minimize2, X } from 'lucide-react'
import { closePanelAtom, panelStackAtom, focusedPanelIdAtom } from '@/atoms/panel-stack'
import { expandedPanelIdAtom } from '@/atoms/overlay'
import { BoundPanelContent, isBoundPanelType } from '@/components/content-panels/bound-panel-content'
import { MainContentPanel } from './MainContentPanel'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { AppShellProvider, useAppShellContext } from '@/context/AppShellContext'

export function ExpandedPanelOverlay() {
  const { t } = useTranslation()
  const expandedPanelId = useAtomValue(expandedPanelIdAtom)
  const panelStack = useAtomValue(panelStackAtom)
  const setExpandedPanelId = useSetAtom(expandedPanelIdAtom)
  const setFocusedPanel = useSetAtom(focusedPanelIdAtom)
  const closePanel = useSetAtom(closePanelAtom)
  const parentContext = useAppShellContext()

  const entry = panelStack.find((panel) => panel.id === expandedPanelId) ?? null

  // Esc restores the panel and refocuses it.
  useEffect(() => {
    if (!expandedPanelId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpandedPanelId(null)
        setFocusedPanel(expandedPanelId)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [expandedPanelId, setExpandedPanelId, setFocusedPanel])

  const restore = useCallback(() => {
    if (!entry) return
    setExpandedPanelId(null)
    setFocusedPanel(entry.id)
  }, [entry, setExpandedPanelId, setFocusedPanel])

  const close = useCallback(() => {
    if (!entry) return
    setExpandedPanelId(null)
    closePanel(entry.id)
  }, [entry, setExpandedPanelId, closePanel])

  // Same contract PanelSlot uses when docked: expandButton toggles fullscreen,
  // rightSidebarButton closes the panel. Inside the overlay, "expand" becomes
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
    rightSidebarButton: (
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
