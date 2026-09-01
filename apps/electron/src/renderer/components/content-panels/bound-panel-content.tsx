/**
 * BoundPanelContent - Central dispatcher for bound content-workbench panels.
 *
 * SurfaceSlot routes the active workbench item by `entry.panelType`. Bound items
 * (files/context/preview/trajectory/terminal/artifact) render here; all other panel types flow through
 * the existing MainContentPanel path.
 *
 * This is the single landing point for the per-panel branches (each bound
 * panel's render is added here). The active session binding is resolved inside
 * each panel from the Workbench binding; the route itself carries no session id.
 *
 * Defensive fallback (required for refresh safety): if the bound route fails to
 * parse — e.g. a hand-edited/obsolete URL whose first segment no longer maps to
 * a bound panel — we render a guidance empty state instead of letting
 * MainContentPanel fall back to the global navigation state.
 */

import { useTranslation } from 'react-i18next'
import { isOtherNavigation } from '../../../shared/types'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import type { SurfaceRenderEntry } from '@/atoms/workbench'
import { PanelEmptyState } from './PanelEmptyState'
import { FilesPanel } from './FilesPanel'
import { ContextPanel } from './ContextPanel'
import { PreviewPanel } from './PreviewPanel'
import { TrajectoryPanel } from './TrajectoryPanel'
import { ArtifactWorkbench } from './ArtifactWorkbench'
import { TerminalPanel } from './TerminalPanel'

/** True for panel types that are rendered by this dispatcher (bound panels). */
export function isBoundPanelType(panelType: SurfaceRenderEntry['panelType']): boolean {
  return panelType === 'files' || panelType === 'context' || panelType === 'preview' || panelType === 'trajectory' || panelType === 'terminal' || panelType === 'artifact'
}

export function BoundPanelContent({ entry }: { entry: SurfaceRenderEntry }) {
  const { t } = useTranslation()

  // Validate the route parses to a bound 'other' navigation state. A bound
  // panel whose route is unparseable must never render the global navigation.
  const navState = parseRouteToNavigationState(entry.route)
  if (!navState || !isOtherNavigation(navState)) {
    return <PanelEmptyState title={t('contentPanel.panelUnavailable')} />
  }

  switch (entry.panelType) {
    case 'files':
      return <FilesPanel sessionId={entry.sessionId} />
    case 'context':
      return <ContextPanel sessionId={entry.sessionId} />
    case 'preview':
      return <PreviewPanel sessionId={entry.sessionId} />
    case 'trajectory':
      return <TrajectoryPanel sessionId={entry.sessionId} />
    case 'terminal':
      return <TerminalPanel />
    case 'artifact':
      return navState.artifactId
        ? <ArtifactWorkbench artifactId={navState.artifactId} />
        : <PanelEmptyState title={t('contentPanel.panelUnavailable')} />
    default:
      return <PanelEmptyState title={t('contentPanel.panelUnavailable')} />
  }
}
