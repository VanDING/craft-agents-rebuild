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
 * Esc / the floating restore button close the overlay and refocus the panel.
 */

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { Minimize2 } from 'lucide-react'
import { panelStackAtom, focusedPanelIdAtom } from '@/atoms/panel-stack'
import { expandedPanelIdAtom } from '@/atoms/overlay'
import { touchPanelActivity } from '@/atoms/hidden-panels'
import { BoundPanelContent, isBoundPanelType } from '@/components/content-panels/bound-panel-content'
import { MainContentPanel } from './MainContentPanel'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { TopBarButton } from '@/components/ui/TopBarButton'

export function ExpandedPanelOverlay() {
  const { t } = useTranslation()
  const expandedPanelId = useAtomValue(expandedPanelIdAtom)
  const panelStack = useAtomValue(panelStackAtom)
  const setExpandedPanelId = useSetAtom(expandedPanelIdAtom)
  const setFocusedPanel = useSetAtom(focusedPanelIdAtom)

  const entry = panelStack.find((panel) => panel.id === expandedPanelId) ?? null

  // Esc restores the panel and refocuses it.
  useEffect(() => {
    if (!expandedPanelId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpandedPanelId(null)
        setFocusedPanel(expandedPanelId)
        touchPanelActivity(expandedPanelId)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [expandedPanelId, setExpandedPanelId, setFocusedPanel])

  if (!entry) return null

  const restore = () => {
    setExpandedPanelId(null)
    setFocusedPanel(entry.id)
    touchPanelActivity(entry.id)
  }

  return (
    <div className="fixed inset-0 z-[999] flex flex-col bg-background" data-expanded-panel-overlay>
      {/* Floating restore control (content headers also carry the panel's own
          close/expand buttons — the panel content renders its own header). */}
      <div className="pointer-events-none absolute right-3 top-2 z-10 flex items-center gap-1">
        <div className="pointer-events-auto">
          <TopBarButton onClick={restore} aria-label={t('contentPanel.restore')}>
            <Minimize2 className="h-4 w-4" />
          </TopBarButton>
        </div>
      </div>

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
