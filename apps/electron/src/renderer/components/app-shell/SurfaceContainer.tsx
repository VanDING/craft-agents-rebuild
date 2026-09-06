/**
 * Surface layout container.
 *
 * Desktop: Global sidebar → navigator → one to three equal conversations, or
 * one reading-width conversation → a Context Workbench that fills the rest.
 *
 * Compact: navigator, Primary and Workbench use replacement navigation. An
 * open workbench replaces Primary; its back action collapses the dock without
 * deleting the tab.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { motion, useReducedMotion } from 'motion/react'
import { motionSpring } from '@craft-agent/ui/motion'
import { cn } from '@/lib/utils'
import {
  collapseWorkbenchAtom,
  focusedSurfaceEntryIdAtom,
  primarySurfaceAtom,
  renderedSurfaceEntriesAtom,
  workbenchStateAtom,
  workbenchFullWidthAtom,
  setExpandedWorkbenchItemAtom,
} from '@/atoms/workbench'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { buildNavigatorRootRoute, isDetailNavState } from '@/lib/nav-helpers'
import { navigate } from '@/lib/navigate'
import { hasOpenOverlay } from '@/lib/overlay-detection'
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
  const fullWidth = useAtomValue(workbenchFullWidthAtom)
  const restoreWorkbench = useSetAtom(setExpandedWorkbenchItemAtom)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastFocusedElement = useRef<HTMLElement | null>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (!fullWidth) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // Inner editors and dismissable layers own Escape before layout restore.
      if (hasOpenOverlay({ ignoreWorkbenchExpansion: true })) return
      event.preventDefault()
      event.stopPropagation()
      restoreWorkbench(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fullWidth, restoreWorkbench])

  const primaryEntries = surfaceEntries.filter((entry) => entry.surfaceRole === 'primary')
  const primaryEntry = primaryEntries.find((entry) => entry.id === focusedSurfaceId) ?? primaryEntries[0]
  const workbenchEntry = surfaceEntries.find((entry) => entry.surfaceRole === 'workbench')
  const workbenchEntryId = workbenchEntry?.id
  const primaryNavState = parseRouteToNavigationState(primarySurface.route)
  const primaryDetailActive = isDetailNavState(primaryNavState)
  const compactWorkbenchActive = workbench.open && !!workbenchEntry
  const hasSelectedContent = isCompact && (compactWorkbenchActive || primaryDetailActive)

  const hasSidebar = sidebarWidth > 0
  const hasNavigator = navigatorWidth > 0 && (!fullWidth || isCompact)
  const isLeftEdge = !hasSidebar && !hasNavigator
  const transition = (isResizing || isCompact) ? { duration: 0 } : motionSpring(reduceMotion, 'responsive')

  const handleCompactPrimaryBack = useCallback(() => {
    if (!primaryNavState) return
    const rootRoute = buildNavigatorRootRoute(primaryNavState)
    if (rootRoute) navigate(rootRoute, { skipAutoSelect: true })
  }, [primaryNavState])

  const wasFullWidth = useRef(fullWidth)
  useEffect(() => {
    const active = document.activeElement === document.body ? lastFocusedElement.current : document.activeElement as HTMLElement | null
    const hiddenFocus = active?.closest('[inert], [aria-hidden="true"]')
    if (hiddenFocus || wasFullWidth.current !== fullWidth) {
      const root = containerRef.current
      const panel = workbenchEntryId
        ? root?.querySelector(`[data-surface-id="${workbenchEntryId}"]`)
        : root?.querySelector('[data-panel-role="content"]:not([inert])')
      const target = panel?.querySelector<HTMLElement>('button:not([disabled]), textarea, [tabindex="0"]')
      target?.focus({ preventScroll: true })
    }
    wasFullWidth.current = fullWidth
  }, [fullWidth, hasSidebar, hasNavigator, workbenchEntryId])

  if (isCompact) {
    const visibleEntry = compactWorkbenchActive ? workbenchEntry : primaryEntry
    return (
      <div
        ref={containerRef}
        data-workbench-full-width={fullWidth || undefined}
        onFocusCapture={event => { lastFocusedElement.current = event.target as HTMLElement }}
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

  const isMultiSurface = !fullWidth && surfaceEntries.length > 1

  return (
    <div
      ref={containerRef}
      data-workbench-full-width={fullWidth || undefined}
      onFocusCapture={event => { lastFocusedElement.current = event.target as HTMLElement }}
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
          inert={!hasSidebar}
          aria-hidden={!hasSidebar || undefined}
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
          inert={!hasNavigator}
          aria-hidden={!hasNavigator || undefined}
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

        {primaryEntries.length > 0 ? (
          primaryEntries.map((entry, index) => (
            <SurfaceSlot
              key={entry.id}
              entry={entry}
              hidden={fullWidth}
              isOnly={!isMultiSurface}
              isFocusedPanel={!isMultiSurface || focusedSurfaceId === entry.id}
              isConversationGroup={primaryEntries.length > 1}
              isWorkbenchCompanion={!!workbenchEntry}
              companionPrimaryWidth={workbench.primaryWidth}
              isSidebarAndNavigatorHidden={isSidebarAndNavigatorHidden}
              isAtLeftEdge={index === 0 && isLeftEdge}
              isAtRightEdge={index === primaryEntries.length - 1 && !workbenchEntry}
            />
          ))
        ) : (
          <div className="flex-1" />
        )}

        {workbenchEntry && (
          <SurfaceSlot
            key={workbenchEntry.id}
            entry={workbenchEntry}
            isOnly={fullWidth}
            isFocusedPanel={focusedSurfaceId === workbenchEntry.id}
            isSidebarAndNavigatorHidden={isSidebarAndNavigatorHidden}
            isAtLeftEdge={isLeftEdge}
            isAtRightEdge
            sash={fullWidth ? undefined : <WorkbenchResizeSash primaryWidth={workbench.primaryWidth} />}
            topSlot={<ContextWorkbenchTabs state={workbench} />}
          />
        )}
      </motion.div>
    </div>
  )
}
