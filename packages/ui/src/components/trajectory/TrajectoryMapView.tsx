import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronDown, ChevronRight, GitBranch, LocateFixed, Maximize2, MessageSquare, Minus, Plus, Wrench } from 'lucide-react'
import type { TrajectoryTurnModel } from './trajectory-layout'
import { buildTrajectorySessionMapLayout, type TrajectoryMapEdge, type TrajectoryMapNode, type TrajectorySessionMap } from './trajectory-session-map'
import styles from './TrajectoryMapView.module.css'

export interface TrajectoryMapViewProps {
  turns: readonly TrajectoryTurnModel[]
  sessionMap: TrajectorySessionMap
  onSelectRecord?: (index: number) => void
  onOpenSession?: (sessionId: string) => void
}

interface ViewportTransform {
  x: number
  y: number
  scale: number
}

const MIN_SCALE = 0.45
const MAX_SCALE = 1.5

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

function edgePath(edge: TrajectoryMapEdge, nodes: ReadonlyMap<string, TrajectoryMapNode>): string {
  const source = nodes.get(edge.from)
  const target = nodes.get(edge.to)
  if (!source || !target) return ''
  const vertical = target.y > source.y + source.height / 2
  if (vertical) {
    const x1 = source.x + source.width / 2
    const y1 = source.y + source.height
    const x2 = target.x + target.width / 2
    const y2 = target.y
    const bend = Math.max(36, (y2 - y1) / 2)
    return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`
  }
  const x1 = source.x + source.width
  const y1 = source.y + source.height / 2
  const x2 = target.x
  const y2 = target.y + target.height / 2
  const bend = Math.max(42, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

export function TrajectoryMapView({ turns, sessionMap, onSelectRecord, onOpenSession }: TrajectoryMapViewProps) {
  const { t } = useTranslation()
  const viewportRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [transform, setTransform] = useState<ViewportTransform>({ x: 28, y: 28, scale: 0.8 })
  const dragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null)

  const layout = useMemo(
    () => buildTrajectorySessionMapLayout(turns, sessionMap, collapsed),
    [collapsed, sessionMap, turns],
  )
  const nodes = useMemo(() => new Map(layout.nodes.map(node => [node.id, node])), [layout.nodes])

  const fit = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const padding = 56
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
  }, [layout.height, layout.width])

  const locateCurrent = useCallback(() => {
    const viewport = viewportRef.current
    const current = nodes.get(`session:${sessionMap.currentSessionId}`)
    if (!viewport || !current) return
    setTransform(previous => ({
      ...previous,
      x: viewport.clientWidth / 2 - (current.x + current.width / 2) * previous.scale,
      y: viewport.clientHeight / 2 - (current.y + current.height / 2) * previous.scale,
    }))
  }, [nodes, sessionMap.currentSessionId])

  useLayoutEffect(() => {
    fit()
  }, [fit])

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
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return
          dragRef.current = null
          delete event.currentTarget.dataset.dragging
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
      >
        <div
          className={styles.canvas}
          style={{ width: layout.width, height: layout.height, transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
        >
          <svg className={styles.edges} width={layout.width} height={layout.height} aria-hidden="true">
            {layout.edges.map(edge => (
              <path key={edge.id} d={edgePath(edge, nodes)} className={styles[`${edge.kind}Edge`]} />
            ))}
          </svg>

          {layout.nodes.map(node => node.type === 'turn' ? (
            <button
              key={node.id}
              type="button"
              className={styles.turnCard}
              style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
              onClick={() => node.recordIndex !== undefined && onSelectRecord?.(node.recordIndex)}
            >
              <span className={styles.cardEyebrow}>{t('trajectory.map.turn', { turn: node.turn })}</span>
              <span className={styles.question}><MessageSquare />{node.question}</span>
              <span className={styles.answer}><Bot />{node.answer}</span>
              <span className={styles.cardMeta}>
                <span><Wrench />{t('trajectory.map.tools', { count: node.toolCount })}</span>
                {node.errorCount > 0 && <span className={styles.error}>{t('trajectory.map.errors', { count: node.errorCount })}</span>}
              </span>
            </button>
          ) : (
            <div
              key={node.id}
              className={`${styles.sessionCard} ${styles[node.relation]} ${node.session.id === sessionMap.currentSessionId ? styles.activeSession : ''}`}
              style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
            >
              <button
                type="button"
                className={styles.sessionOpen}
                disabled={node.session.id === sessionMap.currentSessionId}
                onClick={() => node.session.id !== sessionMap.currentSessionId && onOpenSession?.(node.session.id)}
              >
                <span className={styles.cardEyebrow}>
                  <GitBranch />{t(`trajectory.map.relation.${node.relation}`)}
                </span>
                <strong>{node.session.title}</strong>
                <span className={styles.sessionPreview}>{node.session.preview || t('trajectory.map.noPreview')}</span>
                <span className={styles.cardMeta}>
                  {node.session.isProcessing ? t('trajectory.map.processing') : node.session.status || t('trajectory.map.ready')}
                  {node.session.messageCount !== undefined && ` · ${t('trajectory.map.messages', { count: node.session.messageCount })}`}
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
