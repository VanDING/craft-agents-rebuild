/**
 * BoundPanelContent - Central dispatcher for bound content-workbench panels.
 *
 * PanelSlot routes every panel by `entry.panelType`. Bound panels
 * (diff/files/context/preview) render here; all other panel types flow through
 * the existing MainContentPanel path.
 *
 * This is the single landing point for the per-panel branches (each bound
 * panel's render is added here). The active session binding is resolved inside
 * each panel via `activeSessionIdAtom`, so the route carries no session id.
 *
 * Defensive fallback (required for refresh safety): if the bound route fails to
 * parse — e.g. a hand-edited/obsolete URL whose first segment no longer maps to
 * a bound panel — we render a guidance empty state instead of letting
 * MainContentPanel fall back to the global navigation state.
 */

import { useTranslation } from 'react-i18next'
import { isOtherNavigation } from '../../../shared/types'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import type { PanelStackEntry } from '@/atoms/panel-stack'
import { PanelEmptyState } from './PanelEmptyState'
import { ReviewPanel } from './ReviewPanel'
import { FilesPanel } from './FilesPanel'
import { ContextPanel } from './ContextPanel'
import { PreviewPanel } from './PreviewPanel'
import { TrajectoryPanel } from './TrajectoryPanel'

/** True for panel types that are rendered by this dispatcher (bound panels). */
export function isBoundPanelType(panelType: PanelStackEntry['panelType']): boolean {
  return panelType === 'diff' || panelType === 'files' || panelType === 'context' || panelType === 'preview' || panelType === 'trajectory'
}

export function BoundPanelContent({ entry }: { entry: PanelStackEntry }) {
  const { t } = useTranslation()

  // Validate the route parses to a bound 'other' navigation state. A bound
  // panel whose route is unparseable must never render the global navigation.
  const navState = parseRouteToNavigationState(entry.route)
  if (!navState || !isOtherNavigation(navState)) {
    return <PanelEmptyState title={t('contentPanel.panelUnavailable')} />
  }

  switch (entry.panelType) {
    case 'diff':
      return <ReviewPanel />
    case 'files':
      return <FilesPanel />
    case 'context':
      return <ContextPanel />
    case 'preview':
      return <PreviewPanel />
    case 'trajectory':
      return <TrajectoryPanel />
    default:
      return <PanelEmptyState title={t('contentPanel.panelUnavailable')} />
  }
}
