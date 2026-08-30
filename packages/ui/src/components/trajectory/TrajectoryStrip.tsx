import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrajectoryTurnModel } from './trajectory-layout'
import { deriveTrajectoryTimeline, type TrajectoryTimelineMode, type TrajectoryTimeRange } from './trajectory-timeline'
import css from './TrajectoryStrip.module.css'

export interface TrajectoryStripProps {
  turns: readonly TrajectoryTurnModel[]
  mode: TrajectoryTimelineMode
  range: TrajectoryTimeRange | null
  selectedIndex: number | null
  onRangeChange: (range: TrajectoryTimeRange | null) => void
  onRecordSelect: (index: number) => void
}

function displayLane(kind: string): number {
  if (kind === 'tool' || kind === 'subtool') return 2
  if (kind === 'message' || kind === 'compacted') return 1
  return 0
}

export function TrajectoryStrip({ turns, mode, range, selectedIndex, onRangeChange, onRecordSelect }: TrajectoryStripProps) {
  const { t } = useTranslation()
  const model = useMemo(() => deriveTrajectoryTimeline(turns, mode) ?? deriveTrajectoryTimeline(turns, 'sequence'), [mode, turns])
  if (!model) return null

  const domain = Math.max(1, model.end - model.start)
  const position = (value: number) => ((value - model.start) / domain) * 100

  return (
    <section className={css.root} aria-label={t('trajectory.timeline.overview')}>
      <div className={css.labels} aria-hidden="true">
        <span>{t('trajectory.strip.input')}</span>
        <span>{t('trajectory.strip.model')}</span>
        <span>{t('trajectory.strip.tools')}</span>
      </div>
      <div className={css.canvas}>
        {[0, 1, 2].map(lane => <span key={lane} className={css.lane} style={{ top: `${lane * 18}px` }} />)}
        {model.turnBoundaries.map(boundary => <span key={`${boundary.turn}-${boundary.time}`} className={css.turn} style={{ left: `${position(boundary.time)}%` }} />)}
        {model.spans.map(span => {
          const left = position(span.start)
          const width = Math.max(0.22, position(span.end) - left)
          const active = span.index === selectedIndex || !!(range && span.end >= range.start && span.start <= range.end)
          const lane = displayLane(span.kind)
          return (
            <button
              key={`${span.index}-${span.start}`}
              type="button"
              className={css.span}
              data-kind={span.kind}
              data-error={span.isError || undefined}
              data-active={active || undefined}
              style={{ left: `${left}%`, top: `${lane * 18 + 4}px`, width: `${width}%` }}
              title={span.label}
              onClick={() => {
                const end = span.end > span.start ? span.end - Math.min(0.001, (span.end - span.start) / 2) : span.end
                onRangeChange({ start: span.start, end })
                onRecordSelect(span.index)
              }}
            />
          )
        })}
      </div>
      {range && <button type="button" className={css.clear} onClick={() => onRangeChange(null)}>{t('trajectory.timeline.clearSelection')}</button>}
    </section>
  )
}
