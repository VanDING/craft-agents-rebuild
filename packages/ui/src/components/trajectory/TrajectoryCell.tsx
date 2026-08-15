/**
 * Trajectory step cell — 38px row: index · kind tag · text · optional
 * message metrics · elapsed time. Ported from the VanDSH standalone cell.
 */

import { memo } from 'react'
import type { TrajectoryCellKind, TrajectoryCellProps } from './trajectory-layout'
import { formatElapsedSeconds } from './trajectory-layout'
import css from './TrajectoryCell.module.css'

/** Display label per kind (matches the design tags). */
const KIND_LABEL: Record<TrajectoryCellKind, string> = {
  system: 'System',
  user: 'User',
  context: 'Context',
  compacted: 'Compacted',
  message: 'Message',
  tool: 'Tool',
  subtool: 'Sub',
}

const TAG_CLASS: Record<TrajectoryCellKind, string | undefined> = {
  system: css.tagSystem,
  user: css.tagUser,
  context: css.tagContext,
  compacted: css.tagSystem,
  message: css.tagMessage,
  tool: css.tagTool,
  subtool: css.tagSubtool,
}

export const TrajectoryCell = memo(function TrajectoryCell({
  index,
  kind,
  text,
  timeSeconds,
  input,
  output,
  think,
  selected = false,
  onSelect,
  title,
}: TrajectoryCellProps & { onSelect?: () => void; title?: string }) {
  const rootClass = [
    css.root,
    selected ? css.selected : undefined,
  ].filter((c): c is string => c !== undefined).join(' ')
  const showMetrics = kind === 'message'
  return (
    <div
      className={rootClass}
      data-kind={kind}
      data-selected={selected || undefined}
      role="row"
      tabIndex={0}
      title={title}
      onClick={() => onSelect?.()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect?.()
        }
      }}
    >
      <span className={css.index}>#{index}</span>
      <span className={css.tagSlot}>
        <span className={[css.tag, TAG_CLASS[kind]].filter((c): c is string => c !== undefined).join(' ')}>
          {KIND_LABEL[kind]}
        </span>
      </span>
      <span className={css.text}>{text}</span>
      <span className={css.trailing}>
        {showMetrics ? (
          <>
            <span className={css.metric}>{input ?? ''}</span>
            <span className={css.metric}>{output ?? ''}</span>
            <span className={css.metric}>{think ?? ''}</span>
          </>
        ) : null}
        <span className={css.time}>{formatElapsedSeconds(timeSeconds)}</span>
      </span>
    </div>
  )
})
