/**
 * Surface layout container.
 *
 * Desktop: Global sidebar → navigator → one flexible Primary Surface → one
 * fixed-width Context Workbench. The workbench keeps many lightweight tabs but
 * only its active item is present in this render tree.
 *
 * Compact: navigator, Primary and Workbench use replacement navigation. An
 * open workbench replaces Primary; its back action collapses the dock without
 * deleting the tab.
 */

import { useCallback } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import {
  collapseWorkbenchAtom,
  focusedSurfaceEntryIdAtom,
  primarySurfaceAtom,
  renderedSurfaceEntriesAtom,
  workbenchStateAtom,
} from '@/atoms/workbench'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { buildNavigatorRootRoute, isDetailNavState } from '@/lib/nav-helpers'
import { navigate } from '@/lib/navigate'
import { SurfaceSlot } from './SurfaceSlot'
import { WorkbenchResizeSash } from './WorkbenchResizeSash'
import { ContextWorkbenchTabs } from './ContextWorkbenchTabs'
import { CompactPanelTransition } from './CompactPanelTransition'
import {
  PANEL_GAP,
  PANEL_EDGE_INSET,
  PANEL_STACK_VERTICAL_OVERFLOW,
  RADIUS_EDGE,
  RADIUS_INNER,
} from './panel-constants'

const PANEL_SPRING = { type: 'spring' as const, stiffness: 600, damping: 49 }
const COMPACT_PANEL_TOP_GAP = 8

interface SurfaceContainerProps {
  sidebarSlot: React.ReactNode
  sidebarWidth: number
  navigatorSlot: React.ReactNode
  navigatorWidth: number
  isSidebarAndNavigatorHidden: boolean
  isCompact?: boolean
  isResizing?: boolean
}

export function SurfaceContainer({
  sidebarSlot,
  sidebarWidth,
  navigatorSlot,
  navigatorWidth,
  isSidebarAndNavigatorHidden,
  isCompact = false,
  isResizing,
}: SurfaceContainerProps) {
  const surfaceEntries = useAtomValue(renderedSurfaceEntriesAtom)
  const focusedSurfaceId = useAtomValue(focusedSurfaceEntryIdAtom)
  const primarySurface = useAtomValue(primarySurfaceAtom)
  const workbench = useAtomValue(workbenchStateAtom)
  const collapseWorkbench = useSetAtom(collapseWorkbenchAtom)

  const primaryEntry = surfaceEntries.find((entry) => entry.surfaceRole === 'primary')
  const workbenchEntry = surfaceEntries.find((entry) => entry.surfaceRole === 'workbench')
  const primaryNavState = parseRouteToNavigationState(primarySurface.route)
  const primaryDetailActive = isDetailNavState(primaryNavState)
  const compactWorkbenchActive = workbench.open && !!workbenchEntry
  const hasSelectedContent = isCompact && (compactWorkbenchActive || primaryDetailActive)

  const hasSidebar = sidebarWidth > 0
  const hasNavigator = navigatorWidth > 0
  const isLeftEdge = !hasSidebar && !hasNavigator
  const transition = (isResizing || isCompact) ? { duration: 0 } : PANEL_SPRING

  const handleCompactPrimaryBack = useCallback(() => {
    if (!primaryNavState) return
    const rootRoute = buildNavigatorRootRoute(primaryNavState)
    if (rootRoute) navigate(rootRoute, { skipAutoSelect: true })
  }, [primaryNavState])

  if (isCompact) {
    const visibleEntry = compactWorkbenchActive ? workbenchEntry : primaryEntry
    return (
      <div
        data-mobile-menu-root="true"
        className="relative min-w-0 flex-1 panel-scroll @container/shell"
        style={{
          paddingBlock: PANEL_STACK_VERTICAL_OVERFLOW,
          marginBlock: -PANEL_STACK_VERTICAL_OVERFLOW,
          marginBottom: -6,
          paddingBottom: 6,
          '--compact-panel-stack-top': `${PANEL_STACK_VERTICAL_OVERFLOW + COMPACT_PANEL_TOP_GAP}px`,
        } as React.CSSProperties}
      >
        {hasNavigator && (
          <CompactPanelTransition role="navigator" isDetailActive={hasSelectedContent}>
            <div
              data-panel-role="navigator"
              className={cn('relative h-full w-full overflow-hidden bg-paper shadow-middle')}
              style={{
                borderTopLeftRadius: RADIUS_INNER,
                borderBottomLeftRadius: 0,
                borderTopRightRadius: RADIUS_INNER,
                borderBottomRightRadius: 0,
              }}
            >
              {navigatorSlot}
            </div>
          </CompactPanelTransition>
        )}

        {visibleEntry && (
          <CompactPanelTransition role="detail" isDetailActive={hasSelectedContent}>
            <div className="flex h-full w-full">
              <SurfaceSlot
                key={visibleEntry.id}
                entry={visibleEntry}
                isOnly
                isFocusedPanel
                isSidebarAndNavigatorHidden={isSidebarAndNavigatorHidden}
                isAtLeftEdge={isLeftEdge}
                isAtRightEdge
                isCompact
                onCompactBack={compactWorkbenchActive ? () => collapseWorkbench() : handleCompactPrimaryBack}
                topSlot={compactWorkbenchActive ? <ContextWorkbenchTabs state={workbench} /> : undefined}
              />
            </div>
          </CompactPanelTransition>
        )}
      </div>
    )
  }

  const isMultiSurface = !!primaryEntry && !!workbenchEntry

  return (
    <div
      data-mobile-menu-root="true"
      className="relative z-panel flex min-w-0 flex-1 panel-scroll @container/shell"
      style={{
        overflowX: 'auto',
        overflowY: 'hidden',
        paddingBlock: PANEL_STACK_VERTICAL_OVERFLOW,
        marginBlock: -PANEL_STACK_VERTICAL_OVERFLOW,
        marginBottom: -6,
        paddingBottom: 6,
        paddingRight: 8,
        marginRight: -8,
      }}
    >
      <motion.div
        className="flex h-full"
        initial={false}
        animate={{ paddingLeft: !hasSidebar ? PANEL_EDGE_INSET : 0 }}
        transition={transition}
        style={{ gap: PANEL_GAP, flexGrow: 1, minWidth: 0 }}
      >
        <motion.div
          data-panel-role="sidebar"
          initial={false}
          animate={{
            width: hasSidebar ? sidebarWidth : 0,
            marginRight: hasSidebar ? 0 : -PANEL_GAP,
            opacity: hasSidebar ? 1 : 0,
          }}
          transition={transition}
          className="relative h-full shrink-0"
          style={{ overflowX: 'clip', overflowY: 'visible' }}
        >
          <div className="h-full" style={{ width: sidebarWidth }}>{sidebarSlot}</div>
        </motion.div>

        <motion.div
          data-panel-role="navigator"
          initial={false}
          animate={{
            width: hasNavigator ? navigatorWidth : 0,
            marginRight: hasNavigator ? 0 : -PANEL_GAP,
            opacity: hasNavigator ? 1 : 0,
          }}
          transition={transition}
          className={cn('relative z-[2] h-full shrink-0 overflow-hidden bg-paper shadow-middle')}
          style={{
            borderTopLeftRadius: RADIUS_INNER,
            borderBottomLeftRadius: !hasSidebar ? RADIUS_EDGE : RADIUS_INNER,
            borderTopRightRadius: RADIUS_INNER,
            borderBottomRightRadius: RADIUS_INNER,
          }}
        >
          <div className="h-full" style={{ width: navigatorWidth }}>{navigatorSlot}</div>
        </motion.div>

        {primaryEntry ? (
          <SurfaceSlot
            key={primaryEntry.id}
            entry={primaryEntry}
            isOnly={!isMultiSurface}
            isFocusedPanel={!isMultiSurface || focusedSurfaceId === primaryEntry.id}
            isSidebarAndNavigatorHidden={isSidebarAndNavigatorHidden}
            isAtLeftEdge={isLeftEdge}
            isAtRightEdge={!workbenchEntry}
          />
        ) : (
          <div className="flex-1" />
        )}

        {workbenchEntry && (
          <SurfaceSlot
            key={workbenchEntry.id}
            entry={workbenchEntry}
            isOnly={false}
            isFocusedPanel={focusedSurfaceId === workbenchEntry.id}
            isSidebarAndNavigatorHidden={isSidebarAndNavigatorHidden}
            isAtLeftEdge={false}
            isAtRightEdge
            workbenchWidth={workbench.width}
            sash={<WorkbenchResizeSash width={workbench.width} />}
            topSlot={<ContextWorkbenchTabs state={workbench} />}
          />
        )}
      </motion.div>
    </div>
  )
}
