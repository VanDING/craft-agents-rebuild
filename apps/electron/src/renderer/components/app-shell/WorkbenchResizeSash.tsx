import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import {
  DEFAULT_COMPANION_PRIMARY_WIDTH,
  MAX_COMPANION_PRIMARY_WIDTH,
  MIN_COMPANION_PRIMARY_WIDTH,
  setCompanionPrimaryWidthAtom,
} from '@/atoms/workbench'
import { useResizeGradient } from '@/hooks/useResizeGradient'
import {
  PANEL_SASH_FLEX_MARGIN,
  PANEL_SASH_HALF_HIT_WIDTH,
  PANEL_SASH_LINE_WIDTH,
  PANEL_STACK_VERTICAL_OVERFLOW,
} from './panel-constants'

interface WorkbenchResizeSashProps {
  primaryWidth: number
}

/** Divider between the reading-width Primary Surface and flexible Workbench. */
export function WorkbenchResizeSash({ primaryWidth }: WorkbenchResizeSashProps) {
  const { t } = useTranslation()
  const setWidth = useSetAtom(setCompanionPrimaryWidthAtom)
  const { ref, handlers, gradientStyle } = useResizeGradient()
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const resizeRafRef = useRef(0)
  const pendingWidthRef = useRef<number | null>(null)

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    handlers.onMouseDown()
    startXRef.current = event.clientX
    startWidthRef.current = primaryWidth

    const flush = () => {
      resizeRafRef.current = 0
      const next = pendingWidthRef.current
      pendingWidthRef.current = null
      if (next !== null) setWidth(next)
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      pendingWidthRef.current = startWidthRef.current + (moveEvent.clientX - startXRef.current)
      if (!resizeRafRef.current) resizeRafRef.current = requestAnimationFrame(flush)
    }

    const handleMouseUp = () => {
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current)
      flush()
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [handlers, primaryWidth, setWidth])

  return (
    <div
      ref={ref}
      className="relative h-full w-0 shrink-0 cursor-col-resize"
      style={{ margin: `0 ${PANEL_SASH_FLEX_MARGIN}px` }}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('contentPanel.resize')}
      aria-valuemin={MIN_COMPANION_PRIMARY_WIDTH}
      aria-valuemax={MAX_COMPANION_PRIMARY_WIDTH}
      aria-valuenow={primaryWidth}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onMouseMove={handlers.onMouseMove}
      onMouseLeave={handlers.onMouseLeave}
      onDoubleClick={() => setWidth(DEFAULT_COMPANION_PRIMARY_WIDTH)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') setWidth(primaryWidth - 16)
        else if (event.key === 'ArrowRight') setWidth(primaryWidth + 16)
        else if (event.key === 'Home') setWidth(MIN_COMPANION_PRIMARY_WIDTH)
        else if (event.key === 'End') setWidth(MAX_COMPANION_PRIMARY_WIDTH)
        else return
        event.preventDefault()
      }}
    >
      <div
        className="absolute inset-y-0 flex cursor-col-resize justify-center"
        style={{ left: -PANEL_SASH_HALF_HIT_WIDTH, right: -PANEL_SASH_HALF_HIT_WIDTH }}
      >
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{
            ...gradientStyle,
            width: PANEL_SASH_LINE_WIDTH,
            top: PANEL_STACK_VERTICAL_OVERFLOW,
            bottom: PANEL_STACK_VERTICAL_OVERFLOW,
          }}
        />
      </div>
    </div>
  )
}
