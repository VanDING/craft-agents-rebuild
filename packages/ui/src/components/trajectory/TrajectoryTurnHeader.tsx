/**
 * TrajectoryTurnHeader — sticky per-turn bar with Input/Output/Think/Time
 * column labels matching the cell trailing metrics.
 */

import css from './TrajectoryTurnHeader.module.css'

const COLUMN_LABELS = ['Input', 'Output', 'Think', 'Time'] as const

export interface TrajectoryTurnHeaderProps {
  /** 1-based turn index shown as `Turn N`. */
  turn: number
  /** Collapsed indicator (▸ / ▾). */
  collapsed?: boolean
  /** Summary line when the turn is folded. */
  summary?: string
  /** Folding click target. */
  onToggle?: () => void
}

export function TrajectoryTurnHeader({ turn, collapsed, summary, onToggle }: TrajectoryTurnHeaderProps) {
  const title = (
    <>
      <span className={css.title}>
        {collapsed !== undefined ? <span aria-hidden="true">{collapsed ? '▸ ' : '▾ '}</span> : null}
        Turn {turn}
      </span>
      {summary !== undefined && summary !== ''
        ? <span className={css.summary}>{summary}</span>
        : null}
    </>
  )
  return (
    <div className={css.root}>
      <div className={css.inner} role={onToggle ? 'button' : undefined} tabIndex={onToggle ? 0 : undefined} onClick={onToggle} onKeyDown={onToggle ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      } : undefined}>
        {title}
        <div className={css.columns} aria-hidden="true">
          {COLUMN_LABELS.map(label => (
            <span key={label} className={css.column}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
