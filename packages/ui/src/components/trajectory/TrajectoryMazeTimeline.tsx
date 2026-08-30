import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Clock3, Minus, Plus, RotateCcw, Wrench } from 'lucide-react'
import type { TrajectoryTurnModel } from './trajectory-layout'
import { formatDurationMillis } from './trajectory-layout'
import { buildTrajectoryMazeClusters } from './trajectory-maze'
import type { TrajectoryTimelineMode, TrajectoryTimeRange } from './trajectory-timeline'
import css from './TrajectoryMazeTimeline.module.css'

export interface TrajectoryMazeTimelineProps {
  turns: readonly TrajectoryTurnModel[]
  mode: TrajectoryTimelineMode
  range: TrajectoryTimeRange | null
  selectedIndex?: number | null
  onRangeChange: (range: TrajectoryTimeRange | null) => void
  onModeChange: (mode: TrajectoryTimelineMode) => void
  onOpenEventsForRange?: () => void
  onRecordSelect?: (index: number) => void
}

const MODES: readonly TrajectoryTimelineMode[] = ['sequence', 'duration', 'actual']

export function TrajectoryMazeTimeline({ turns, mode, range, selectedIndex = null, onRangeChange, onModeChange, onOpenEventsForRange, onRecordSelect }: TrajectoryMazeTimelineProps) {
  const { t } = useTranslation()
  const [detailLevel, setDetailLevel] = useState(1)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const clusters = useMemo(() => buildTrajectoryMazeClusters(turns, mode, detailLevel), [detailLevel, mode, turns])
  const overview = useMemo(() => buildTrajectoryMazeClusters(turns, mode, 1), [mode, turns])
  const hasTools = clusters.some(cluster => cluster.toolCount > 0)
  const hasTokens = clusters.some(cluster => cluster.totalTokens > 0)
  const maxTokens = Math.max(1, ...clusters.map(cluster => cluster.totalTokens))
  const errorCount = clusters.reduce((sum, cluster) => sum + cluster.errorCount, 0)
  const selectedClusters = range
    ? clusters.filter(cluster => cluster.end >= range.start && cluster.start <= range.end)
    : []
  const selectedDurationMs = selectedClusters.some(cluster => cluster.durationMs !== null)
    ? selectedClusters.reduce((sum, cluster) => sum + (cluster.durationMs ?? 0), 0)
    : null

  const focusCluster = (cluster: (typeof clusters)[number]) => {
    const end = cluster.end > cluster.start
      ? cluster.end - Math.min(0.001, (cluster.end - cluster.start) / 2)
      : cluster.end
    onRangeChange({ start: cluster.start, end })
    if (cluster.count === 1) onRecordSelect?.(cluster.indexes[0]!)
    else setDetailLevel(level => Math.min(4, level + 1))
  }

  const fit = () => {
    setDetailLevel(1)
    onRangeChange(null)
    scrollerRef.current?.scrollTo({ left: 0, behavior: 'smooth' })
  }

  if (clusters.length === 0) return <div className={css.empty}>{t('trajectory.timeline.empty')}</div>

  return (
    <section className={css.root} aria-label={t('trajectory.timeline.label')}>
      <div className={css.toolbar}>
        <div className={css.modes}>
          {MODES.map(value => <button key={value} type="button" data-active={mode === value || undefined} onClick={() => onModeChange(value)}>{t(`trajectory.timeline.mode.${value}`)}</button>)}
        </div>
        <span className={css.summary}><AlertTriangle aria-hidden="true" />{errorCount}</span>
        <div className={css.zoom} aria-label={t('trajectory.timeline.zoom')}>
          <button type="button" disabled={detailLevel <= 1} onClick={() => setDetailLevel(level => Math.max(1, level - 1))}><Minus /></button>
          <span>{detailLevel}×</span>
          <button type="button" disabled={detailLevel >= 4} onClick={() => setDetailLevel(level => Math.min(4, level + 1))}><Plus /></button>
        </div>
        <button type="button" className={css.fit} onClick={fit}><RotateCcw />{t('trajectory.timeline.fit')}</button>
      </div>

      <div className={css.scrubber} aria-label={t('trajectory.timeline.overview')}>
        {overview.map(cluster => <button key={cluster.id} type="button" data-error={cluster.errorCount > 0 || undefined} data-selected={range && cluster.end >= range.start && cluster.start <= range.end ? true : undefined} style={{ flexGrow: cluster.count }} onClick={() => focusCluster(cluster)} title={cluster.label} />)}
      </div>

      <div ref={scrollerRef} className={css.scroller}>
        <div className={css.wideMaze} style={{ width: `${Math.max(100, detailLevel * 100)}%` }}>
          <div className={css.turnBands} aria-hidden="true">{clusters.map(cluster => <span key={cluster.id} data-turn={cluster.turnStart ?? undefined} />)}</div>
          <div className={css.spine} aria-hidden="true" />
          <div className={css.nodes}>
            {clusters.map(cluster => {
              const selected = cluster.indexes.includes(selectedIndex ?? -1) || !!(range && cluster.end >= range.start && cluster.start <= range.end)
              const branch = cluster.errorCount > 0 ? 'error' : cluster.toolCount === cluster.count ? 'tool' : 'main'
              return (
                <button key={cluster.id} type="button" data-branch={branch} data-selected={selected || undefined} onClick={() => focusCluster(cluster)} onDoubleClick={() => { focusCluster(cluster); onOpenEventsForRange?.() }} title={`${cluster.label}\n${formatDurationMillis(cluster.durationMs)}`}>
                  <span className={css.nodeMarker}>{cluster.errorCount > 0 ? '!' : cluster.count > 1 ? `×${cluster.count}` : '•'}</span>
                  <span className={css.nodeLabel}>{cluster.label}</span>
                  <span className={css.nodeMeta}>{cluster.toolCount > 0 && <><Wrench />{cluster.toolCount}</>}{cluster.durationMs !== null && <><Clock3 />{formatDurationMillis(cluster.durationMs)}</>}</span>
                </button>
              )
            })}
          </div>
          {hasTools && <div className={css.track}><span>{t('trajectory.timeline.toolDensity')}</span><div>{clusters.map(cluster => <i key={cluster.id} style={{ opacity: cluster.toolCount ? Math.min(1, 0.25 + cluster.toolCount / 4) : 0.06 }} />)}</div></div>}
          {hasTokens && <div className={`${css.track} ${css.tokenTrack}`}><span>{t('trajectory.timeline.tokenPulse')}</span><div>{clusters.map(cluster => <i key={cluster.id} style={{ height: `${Math.max(3, cluster.totalTokens / maxTokens * 100)}%` }} />)}</div></div>}
        </div>

        <div className={css.verticalJourney}>
          {clusters.map(cluster => (
            <button key={cluster.id} type="button" data-error={cluster.errorCount > 0 || undefined} data-selected={cluster.indexes.includes(selectedIndex ?? -1) || undefined} onClick={() => focusCluster(cluster)}>
              <span className={css.verticalRail} aria-hidden="true" />
              <span className={css.verticalMarker}>{cluster.errorCount > 0 ? '!' : cluster.count > 1 ? `×${cluster.count}` : '•'}</span>
              <span className={css.verticalContent}><strong>{cluster.label}</strong><small>{cluster.toolCount} {t('trajectory.timeline.toolsShort')} · {formatDurationMillis(cluster.durationMs)}</small></span>
            </button>
          ))}
        </div>
      </div>

      {range && <div className={css.selection}><span>{t('trajectory.timeline.selectedSummary', { count: selectedClusters.reduce((sum, cluster) => sum + cluster.count, 0), errors: selectedClusters.reduce((sum, cluster) => sum + cluster.errorCount, 0), duration: formatDurationMillis(selectedDurationMs) })}</span><button type="button" onClick={onOpenEventsForRange}>{t('trajectory.timeline.openEvents')}</button><button type="button" onClick={() => onRangeChange(null)}>{t('trajectory.timeline.clearSelection')}</button></div>}
    </section>
  )
}
