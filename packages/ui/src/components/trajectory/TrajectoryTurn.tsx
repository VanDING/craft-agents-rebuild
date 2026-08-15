/**
 * TrajectoryTurn — sticky Turn header plus the padded body.
 */

import type { ReactNode } from 'react'
import { TrajectoryTurnHeader } from './TrajectoryTurnHeader'
import css from './TrajectoryTurn.module.css'

export interface TrajectoryTurnProps {
  /** 1-based turn index for the sticky header. */
  turn: number
  /** Message / Step headers and TrajectoryCell rows. */
  children?: ReactNode
}

export function TrajectoryTurn({ turn, children }: TrajectoryTurnProps) {
  return (
    <section className={css.root} data-turn={turn}>
      <TrajectoryTurnHeader turn={turn} />
      <div className={css.body}>{children}</div>
    </section>
  )
}
