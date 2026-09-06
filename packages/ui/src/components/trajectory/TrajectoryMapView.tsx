import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, GitBranch, LocateFixed, Maximize2, Minus, Plus, PanelRight, X } from 'lucide-react'
import type { TrajectoryTurnModel } from './trajectory-layout'
import { buildTrajectorySessionMapLayout, type TrajectoryMapEdge, type TrajectoryMapNode, type TrajectorySessionMap } from './trajectory-session-map'
import styles from './TrajectoryMapView.module.css'
import { resizeMapViewport, type MapViewportTransform } from './trajectory-map-viewport'

export interface TrajectoryMapViewProps {
  turns: readonly TrajectoryTurnModel[]
  sessionMap: TrajectorySessionMap
  onSelectRecord?: (index: number) => void
  onOpenSession?: (sessionId: string) => void
}

interface TurnSummary {
  turn: number
  question: string
  answer: string
  toolCount: number
  recordIndex?: number
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

function compactText(value: string | undefined, fallback: string): string {
  const text = value?.replace(/\s+/g, ' ').trim() || fallback
  return text.length > 120 ? `${text.slice(0, 119)}…` : text
}

function summarizeTurns(turns: readonly TrajectoryTurnModel[]): readonly TurnSummary[] {
  return turns.flatMap((turn, index) => {
    if (turn.turn === null) return []
    const cells = turn.groups.flatMap(group => group.cells)
    const user = cells.find(cell => cell.kind === 'user')
    const assistant = [...cells].reverse().find(cell => cell.kind === 'message')
    const tools = cells.filter(cell => cell.kind === 'tool' || cell.kind === 'subtool')
    return [{
      turn: turn.turn ?? index + 1,
      question: compactText(user?.text, 'Continuation'),
      answer: compactText(assistant?.text, tools.length > 0 ? 'Tool work' : 'No assistant response'),
      toolCount: tools.length,
      recordIndex: user?.index ?? assistant?.index,
    }]
  })
}

export function TrajectoryMapView({ turns, sessionMap, onSelectRecord, onOpenSession }: TrajectoryMapViewProps) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const inspectorCloseRef = useRef<HTMLButtonElement>(null)
  const inspectorTriggerRef = useRef<HTMLElement | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [isCompact, setIsCompact] = useState(true)
  const [animateViewport, setAnimateViewport] = useState(false)
  const fittedRef = useRef(false)
  const lastViewportSizeRef = useRef({ width: 0, height: 0 })
  const previousCurrentPositionRef = useRef<{ x: number, y: number } | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [selectedId, setSelectedId] = useState(`session:${sessionMap.currentSessionId}`)
  const [transform, setTransform] = useState<MapViewportTransform>({ x: 28, y: 28, scale: 0.9 })
  const dragRef = useRef<{ pointerId: number, x: number, y: number, originX: number, originY: number } | null>(null)

  const layout = useMemo(
    () => buildTrajectorySessionMapLayout(turns, sessionMap, collapsed),
    [collapsed, sessionMap, turns],
  )
  const nodes = useMemo(() => new Map(layout.nodes.map(node => [node.id, node])), [layout.nodes])
  const turnSummaries = useMemo(() => summarizeTurns(turns), [turns])
  const selectedNode = nodes.get(selectedId) ?? nodes.get(`session:${sessionMap.currentSessionId}`)
  const selectedNodeRef = useRef(selectedNode)
  selectedNodeRef.current = selectedNode

  const openInspector = (trigger: HTMLElement, nodeId = selectedId) => {
    inspectorTriggerRef.current = trigger
    setSelectedId(nodeId)
    setInspectorOpen(true)
  }
  const closeInspector = () => {
    setInspectorOpen(false)
    requestAnimationFrame(() => inspectorTriggerRef.current?.focus({ preventScroll: true }))
  }

  useEffect(() => {
    if (inspectorOpen) inspectorCloseRef.current?.focus({ preventScroll: true })
  }, [inspectorOpen])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver(() => setIsCompact(root.clientWidth <= 760))
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setSelectedId(`session:${sessionMap.currentSessionId}`)
  }, [sessionMap.currentSessionId])

  const fit = useCallback((minimumScale = MIN_SCALE) => {
    const viewport = viewportRef.current
    if (!viewport || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return false
    const padding = 32
    const scale = clampScale(Math.min(
      (viewport.clientWidth - padding * 2) / layout.width,
      (viewport.clientHeight - padding * 2) / layout.height,
      1,
    ))
    if (scale < minimumScale) return false
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
    // Start with a readable current node. Fitting the entire family is an
    // explicit action, especially when the workspace is a narrow split pane.
    const scale = clampScale(Math.min(1, (viewport.clientWidth - 48) / current.width))
    setTransform({
      scale,
      x: viewport.clientWidth / 2 - (current.x + current.width / 2) * scale,
      y: viewport.clientHeight / 2 - (current.y + current.height / 2) * scale,
    })
  }, [nodes, sessionMap.currentSessionId])

  useLayoutEffect(() => {
    if (fittedRef.current) return
    if (!viewportRef.current?.clientWidth) return
    if (!fit(0.82)) locateCurrent()
    fittedRef.current = true
  }, [fit, locateCurrent])

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
      // Hidden Run tabs retain their viewport, rather than fitting a zero box.
      if (width <= 0 || height <= 0) return
      const previous = lastViewportSizeRef.current
      lastViewportSizeRef.current = { width, height }
      if (!fittedRef.current) {
        fittedRef.current = fitRef.current()
        return
      }
      if (previous.width === 0 || previous.height === 0) return
      setAnimateViewport(false)
      setTransform(value => resizeMapViewport(value, previous, { width, height }, selectedNodeRef.current))
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const zoom = (factor: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    setAnimateViewport(true)
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
    <div ref={rootRef} className={styles.root} onKeyDown={event => {
      if (event.key === 'Escape' && inspectorOpen) {
        event.preventDefault()
        event.stopPropagation()
        closeInspector()
      }
    }}>
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
          <button type="button" onClick={() => { setAnimateViewport(true); locateCurrent() }} aria-label={t('trajectory.map.locate')}><LocateFixed /></button>
          <button type="button" onClick={() => { setAnimateViewport(true); fit() }} aria-label={t('trajectory.map.fit')}><Maximize2 /></button>
          <button type="button" aria-expanded={inspectorOpen} onClick={event => inspectorOpen ? closeInspector() : openInspector(event.currentTarget)} aria-label={t('trajectory.map.details')}><PanelRight /></button>
        </div>
      </div>

      <div className={styles.body}>
        <div
          ref={viewportRef}
          className={styles.viewport}
          inert={isCompact && inspectorOpen}
          onWheel={(event) => {
            event.preventDefault()
            setAnimateViewport(false)
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
            setAnimateViewport(false)
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
            data-animated={animateViewport}
            data-compact={transform.scale < 0.62 ? 'true' : 'false'}
            style={{ width: layout.width, height: layout.height, transform: `translate(${Math.round(transform.x)}px, ${Math.round(transform.y)}px) scale(${transform.scale})` }}
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
                className={`${styles.sessionCard} ${node.session.id === sessionMap.currentSessionId ? styles.activeSession : ''} ${selectedId === node.id ? styles.selectedSession : ''}`}
                data-relation={node.relation}
                style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
              >
                <button
                  type="button"
                  className={styles.sessionOpen}
                  aria-pressed={selectedId === node.id}
                  onClick={(event) => openInspector(event.currentTarget, node.id)}
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

        {selectedNode && inspectorOpen && (
          <aside className={styles.inspector} aria-label={selectedNode.session.title}>
            <div className={styles.inspectorHeader}>
              <div className={styles.inspectorTop}>
                <span className={styles.cardEyebrow}>
                  <GitBranch />{t(`trajectory.map.relation.${selectedNode.relation}`)}
                </span>
                <div className={styles.actions}>
                  <button ref={inspectorCloseRef} type="button" onClick={closeInspector} aria-label={t('common.close')}><X /></button>
                </div>
              </div>
              <h3>{selectedNode.session.title}</h3>
              <p>{selectedNode.session.preview || t('trajectory.map.noPreview')}</p>
              <div className={styles.inspectorMeta}>
                <span>{selectedNode.session.isProcessing ? t('trajectory.map.processing') : selectedNode.session.status || t('trajectory.map.ready')}</span>
                {selectedNode.turnCount !== undefined && <span>{t('trajectory.map.turn', { turn: selectedNode.turnCount })}</span>}
                {selectedNode.turnCount === undefined && selectedNode.session.messageCount !== undefined && (
                  <span>{t('trajectory.map.messages', { count: selectedNode.session.messageCount })}</span>
                )}
              </div>
            </div>

            {selectedNode.session.id === sessionMap.currentSessionId ? (
              <>
                <div className={styles.inspectorSectionTitle}>
                  <strong>{t('trajectory.views.trajectory')}</strong>
                  <span>{turnSummaries.length}</span>
                </div>
                <div className={styles.turnList}>
                  {turnSummaries.map(summary => (
                    <button
                      key={`${summary.turn}:${summary.recordIndex ?? 'empty'}`}
                      type="button"
                      className={styles.turnRow}
                      disabled={summary.recordIndex === undefined || !onSelectRecord}
                      onClick={() => summary.recordIndex !== undefined && onSelectRecord?.(summary.recordIndex)}
                      aria-label={t('trajectory.map.turn', { turn: summary.turn })}
                    >
                      <span className={styles.turnNumber}>{summary.turn}</span>
                      <span className={styles.turnCopy}>
                        <strong>{summary.question}</strong>
                        <small>{summary.answer}</small>
                      </span>
                      {summary.toolCount > 0 && (
                        <span className={styles.turnTools}>{t('trajectory.map.tools', { count: summary.toolCount })}</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.inspectorActions}>
                <button type="button" onClick={() => onOpenSession?.(selectedNode.session.id)}>
                  {t('common.open')}
                </button>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
