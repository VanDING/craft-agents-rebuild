/**
 * TrajectoryToolbar — timeline/ledger fold controls plus live search.
 * Ported from the VanDSH toolbar (the idle-compression switch is retained
 * in state but hidden, matching the original).
 */

import { Search } from 'lucide-react'
import css from './TrajectoryToolbar.module.css'

export interface TrajectoryToolbarProps {
  /** Whether timeline blocks use recorded durations instead of equal widths. */
  actualDuration: boolean
  onActualDurationChange: (actualDuration: boolean) => void
  /** Whether recorded timing retains idle gaps between operations. */
  actualTime: boolean
  onActualTimeChange: (actualTime: boolean) => void
  /** Whether every collapsible turn is currently folded. */
  allTurnsCollapsed: boolean
  onToggleAllTurns: () => void
  /** Whether every collapsible assistant's tool calls are currently folded. */
  allAssistantsCollapsed: boolean
  onToggleAllAssistants: () => void
  /** Current live ledger search query. */
  searchQuery: string
  onSearchQueryChange: (query: string) => void
}

export function TrajectoryToolbar({
  actualDuration,
  onActualDurationChange,
  actualTime,
  onActualTimeChange,
  allTurnsCollapsed,
  onToggleAllTurns,
  allAssistantsCollapsed,
  onToggleAllAssistants,
  searchQuery,
  onSearchQueryChange,
}: TrajectoryToolbarProps) {
  return (
    <div className={css.root} role="toolbar" aria-label="Trajectory controls">
      <div className={css.inner}>
        <div className={css.actions}>
          <button
            type="button"
            className={css.toggle}
            aria-label={actualDuration ? 'Use equal-width blocks' : 'Use recorded durations'}
            aria-pressed={actualDuration}
            title={actualDuration ? 'Use equal-width blocks' : 'Use recorded durations'}
            onClick={() => { onActualDurationChange(!actualDuration) }}
          >
            <svg
              className={css.toggleIcon}
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="5.25" />
              <path d="M8 4.75V8l2.25 1.5" />
            </svg>
            Duration
          </button>
          <button
            type="button"
            className={css.control}
            role="switch"
            aria-checked={actualTime}
            hidden
            onClick={() => { onActualTimeChange(!actualTime) }}
          >
            <span>Compress idle time</span>
            <span className={css.controlTrack} data-on={actualTime || undefined} aria-hidden="true">
              <span className={css.controlThumb} />
            </span>
          </button>
          <button
            type="button"
            className={css.action}
            aria-label={allTurnsCollapsed ? 'Expand turns' : 'Collapse turns'}
            aria-pressed={allTurnsCollapsed}
            title={allTurnsCollapsed ? 'Expand turns' : 'Collapse turns'}
            onClick={onToggleAllTurns}
          >
            <span className={css.actionIcon} aria-hidden="true">
              {allTurnsCollapsed ? '⊞' : '⊟'}
            </span>
            Turns
          </button>
          <button
            type="button"
            className={css.action}
            aria-label={allAssistantsCollapsed ? 'Expand calls' : 'Collapse calls'}
            aria-pressed={allAssistantsCollapsed}
            title={allAssistantsCollapsed ? 'Expand calls' : 'Collapse calls'}
            onClick={onToggleAllAssistants}
          >
            <span className={css.actionIcon} aria-hidden="true">
              {allAssistantsCollapsed ? '⊞' : '⊟'}
            </span>
            Calls
          </button>
        </div>
        <div className={css.search}>
          <Search size={11} className={css.searchIcon} aria-hidden="true" />
          <input
            type="search"
            className={css.searchInput}
            aria-label="Search trajectory"
            placeholder="Search…"
            value={searchQuery}
            onChange={(event) => { onSearchQueryChange(event.currentTarget.value) }}
          />
        </div>
      </div>
    </div>
  )
}
