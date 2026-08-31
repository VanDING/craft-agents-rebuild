import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, GitBranch, LocateFixed, Maximize2, Minus, Plus } from 'lucide-react'
import type { TrajectoryTurnModel } from './trajectory-layout'
import { buildTrajectorySessionMapLayout, type TrajectoryMapEdge, type TrajectoryMapNode, type TrajectorySessionMap } from './trajectory-session-map'
import styles from './TrajectoryMapView.module.css'

export interface TrajectoryMapViewProps {
  turns: readonly TrajectoryTurnModel[]
  sessionMap: TrajectorySessionMap
  onOpenSession?: (sessionId: string) => void
}

interface ViewportTransform {
  x: number
  y: number
  scale: number
}

const MIN_SCALE = 0.05
const MAX_SCALE = 1.6

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

function edgePath(edge: TrajectoryMapEdge, nodes: ReadonlyMap<string, TrajectoryMapNode>): string {
  const source = nodes.get(edge.from)
  const target = nodes.get(edge.to)
  if (!source || !target) return ''
  const x1 = source.x + source.width
  const y1 = source.y + source.height / 2
  const x2 = target.x
  const y2 = target.y + target.height / 2
  const bend = Math.max(44, (x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

function edgeLabelPoint(edge: TrajectoryMapEdge, nodes: ReadonlyMap<string, TrajectoryMapNode>): { x: number, y: number } | null {
  const source = nodes.get(edge.from)
  const target = nodes.get(edge.to)
  if (!source || !target) return null
  return {
    x: (source.x + source.width + target.x) / 2,
    y: (source.y + source.height / 2 + target.y + target.height / 2) / 2 - 7,
  }
}

export function TrajectoryMapView({ turns, sessionMap, onOpenSession }: TrajectoryMapViewProps) {
  const { t } = useTranslation()
  const viewportRef = useRef<HTMLDivElement>(null)
  const fittedRef = useRef(false)
  const lastViewportSizeRef = useRef({ width: 0, height: 0 })
  const previousCurrentPositionRef = useRef<{ x: number, y: number } | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [selectedId, setSelectedId] = useState(`session:${sessionMap.currentSessionId}`)
  const [transform, setTransform] = useState<ViewportTransform>({ x: 28, y: 28, scale: 0.9 })
  const dragRef = useRef<{ pointerId: number, x: number, y: number, originX: number, originY: number } | null>(null)

  const layout = useMemo(
    () => buildTrajectorySessionMapLayout(turns, sessionMap, collapsed),
    [collapsed, sessionMap, turns],
  )
  const nodes = useMemo(() => new Map(layout.nodes.map(node => [node.id, node])), [layout.nodes])

  const fit = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return false
    const padding = 48
    const scale = clampScale(Math.min(
      (viewport.clientWidth - padding * 2) / layout.width,
      (viewport.clientHeight - padding * 2) / layout.height,
      1,
    ))
    setTransform({
      scale,
      x: (viewport.clientWidth - layout.width * scale) / 2,
      y: (viewport.clientHeight - layout.height * scale) / 2,
    })
    return true
  }, [layout.height, layout.width])
  const fitRef = useRef(fit)
  fitRef.current = fit

  const locateCurrent = useCallback(() => {
    const viewport = viewportRef.current
    const current = nodes.get(`session:${sessionMap.currentSessionId}`)
    if (!viewport || !current) return
    setSelectedId(current.id)
    setTransform(previous => {
      const scale = Math.max(previous.scale, 0.82)
      return {
        scale,
        x: viewport.clientWidth / 2 - (current.x + current.width / 2) * scale,
        y: viewport.clientHeight / 2 - (current.y + current.height / 2) * scale,
      }
    })
  }, [nodes, sessionMap.currentSessionId])

  useLayoutEffect(() => {
    if (fittedRef.current) return
    fittedRef.current = fit()
  }, [fit])

  useLayoutEffect(() => {
    const current = nodes.get(`session:${sessionMap.currentSessionId}`)
    if (!current) return
    const previous = previousCurrentPositionRef.current
    previousCurrentPositionRef.current = { x: current.x, y: current.y }
    if (!previous || !fittedRef.current) return
    if (previous.x === current.x && previous.y === current.y) return
    setTransform(value => ({
      ...value,
      x: value.x + (previous.x - current.x) * value.scale,
      y: value.y + (previous.y - current.y) * value.scale,
    }))
  }, [nodes, sessionMap.currentSessionId])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const width = entry.contentRect.width
      const height = entry.contentRect.height
      const previous = lastViewportSizeRef.current
      lastViewportSizeRef.current = { width, height }
      if (!fittedRef.current) {
        fittedRef.current = fitRef.current()
        return
      }
      if (previous.width === 0 || previous.height === 0) return
      const widthDelta = Math.abs(width - previous.width) / previous.width
      const heightDelta = Math.abs(height - previous.height) / previous.height
      if (widthDelta > 0.03 || heightDelta > 0.03) fitRef.current()
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const zoom = (factor: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    setTransform(previous => {
      const nextScale = clampScale(previous.scale * factor)
      const cx = viewport.clientWidth / 2
      const cy = viewport.clientHeight / 2
      const ratio = nextScale / previous.scale
      return {
        scale: nextScale,
        x: cx - (cx - previous.x) * ratio,
        y: cy - (cy - previous.y) * ratio,
      }
    })
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    delete event.currentTarget.dataset.dragging
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.legend} aria-label={t('trajectory.map.legend')}>
          <span><i className={styles.currentDot} />{t('trajectory.map.current')}</span>
          <span><i className={styles.branchDot} />{t('trajectory.map.branch')}</span>
          <span><i className={styles.subtaskDot} />{t('trajectory.map.subtask')}</span>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => zoom(0.84)} aria-label={t('trajectory.map.zoomOut')}><Minus /></button>
          <span className={styles.scale}>{Math.round(transform.scale * 100)}%</span>
          <button type="button" onClick={() => zoom(1.19)} aria-label={t('trajectory.map.zoomIn')}><Plus /></button>
          <span className={styles.separator} />
          <button type="button" onClick={locateCurrent} aria-label={t('trajectory.map.locate')}><LocateFixed /></button>
          <button type="button" onClick={fit} aria-label={t('trajectory.map.fit')}><Maximize2 /></button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={styles.viewport}
        onWheel={(event) => {
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          const cx = event.clientX - rect.left
          const cy = event.clientY - rect.top
          setTransform(previous => {
            const nextScale = clampScale(previous.scale * (event.deltaY > 0 ? 0.9 : 1.1))
            const ratio = nextScale / previous.scale
            return { scale: nextScale, x: cx - (cx - previous.x) * ratio, y: cy - (cy - previous.y) * ratio }
          })
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: transform.x, originY: transform.y }
          event.currentTarget.dataset.dragging = 'true'
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag || drag.pointerId !== event.pointerId) return
          setTransform(previous => ({ ...previous, x: drag.originX + event.clientX - drag.x, y: drag.originY + event.clientY - drag.y }))
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className={styles.canvas}
          data-compact={transform.scale < 0.62 ? 'true' : 'false'}
          style={{ width: layout.width, height: layout.height, transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
        >
          <svg className={styles.edges} width={layout.width} height={layout.height} aria-hidden="true">
            {layout.edges.map(edge => {
              const labelPoint = edge.sourceTurn !== undefined ? edgeLabelPoint(edge, nodes) : null
              return (
                <g key={edge.id}>
                  <path d={edgePath(edge, nodes)} className={styles[`${edge.kind}Edge`]} />
                  {labelPoint && (
                    <text x={labelPoint.x} y={labelPoint.y} className={styles.edgeLabel} textAnchor="middle">
                      {t('trajectory.map.turn', { turn: edge.sourceTurn })}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>

          {layout.nodes.map(node => (
            <div
              key={node.id}
              className={`${styles.sessionCard} ${styles[node.relation]} ${node.session.id === sessionMap.currentSessionId ? styles.activeSession : ''} ${selectedId === node.id ? styles.selectedSession : ''}`}
              style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
            >
              <button
                type="button"
                className={styles.sessionOpen}
                onClick={() => setSelectedId(node.id)}
                onDoubleClick={() => node.session.id !== sessionMap.currentSessionId && onOpenSession?.(node.session.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && node.session.id !== sessionMap.currentSessionId) onOpenSession?.(node.session.id)
                }}
              >
                <span className={styles.cardEyebrow}>
                  <GitBranch />{t(`trajectory.map.relation.${node.relation}`)}
                  {node.branchFromTurn !== undefined && ` · ${t('trajectory.map.turn', { turn: node.branchFromTurn })}`}
                </span>
                <strong>{node.session.title}</strong>
                <span className={styles.sessionPreview}>{node.session.preview || t('trajectory.map.noPreview')}</span>
                <span className={styles.cardMeta}>
                  {node.session.isProcessing ? t('trajectory.map.processing') : node.session.status || t('trajectory.map.ready')}
                  {node.turnCount !== undefined
                    ? ` · ${t('trajectory.map.turn', { turn: node.turnCount })}`
                    : node.session.messageCount !== undefined && ` · ${t('trajectory.map.messages', { count: node.session.messageCount })}`}
                </span>
              </button>
              {node.childCount > 0 && (
                <button
                  type="button"
                  className={styles.collapse}
                  aria-label={collapsed.has(node.session.id) ? t('trajectory.map.expand') : t('trajectory.map.collapse')}
                  onClick={() => setCollapsed(current => {
                    const next = new Set(current)
                    if (next.has(node.session.id)) next.delete(node.session.id)
                    else next.add(node.session.id)
                    return next
                  })}
                >
                  {collapsed.has(node.session.id) ? <ChevronRight /> : <ChevronDown />}
                  {node.childCount}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
