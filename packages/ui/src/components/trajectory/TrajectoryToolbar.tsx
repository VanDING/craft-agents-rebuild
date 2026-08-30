/**
 * TrajectoryToolbar — timeline/ledger fold controls plus live search.
 * Ported from the VanDSH toolbar (the idle-compression switch is retained
 * in state but hidden, matching the original).
 */

import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  searchMatchCount?: number
  showTimelineControls?: boolean
  /** Whether the session is currently processing (live indicator only). */
  isProcessing?: boolean
  eventFilter?: 'all' | 'conversation' | 'tools' | 'errors'
  onEventFilterChange?: (filter: 'all' | 'conversation' | 'tools' | 'errors') => void
  eventCount?: number
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
  searchMatchCount,
  showTimelineControls = true,
  isProcessing,
  eventFilter,
  onEventFilterChange,
  eventCount,
}: TrajectoryToolbarProps) {
  const { t } = useTranslation()
  return (
    <div className={css.root} role="toolbar" aria-label={t('trajectory.toolbar.label')}>
      <div className={css.inner}>
        <div className={css.actions}>
          {showTimelineControls && <button
            type="button"
            className={css.toggle}
            aria-label={t(actualDuration ? 'trajectory.toolbar.equalWidth' : 'trajectory.toolbar.duration')}
            aria-pressed={actualDuration}
            title={t(actualDuration ? 'trajectory.toolbar.equalWidth' : 'trajectory.toolbar.duration')}
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
            <span className={css.buttonLabel}>{t('trajectory.toolbar.durationLabel')}</span>
          </button>}
          <button
            type="button"
            className={css.control}
            role="switch"
            aria-checked={actualTime}
            hidden
            onClick={() => { onActualTimeChange(!actualTime) }}
          >
            <span>{t('trajectory.toolbar.compressIdle')}</span>
            <span className={css.controlTrack} data-on={actualTime || undefined} aria-hidden="true">
              <span className={css.controlThumb} />
            </span>
          </button>
          <button
            type="button"
            className={css.action}
            aria-label={t(allTurnsCollapsed ? 'trajectory.toolbar.expandTurns' : 'trajectory.toolbar.collapseTurns')}
            aria-pressed={allTurnsCollapsed}
            title={t(allTurnsCollapsed ? 'trajectory.toolbar.expandTurns' : 'trajectory.toolbar.collapseTurns')}
            onClick={onToggleAllTurns}
          >
            <span className={css.actionIcon} aria-hidden="true">
              {allTurnsCollapsed ? '⊞' : '⊟'}
            </span>
            <span className={css.buttonLabel}>{t('trajectory.toolbar.turns')}</span>
          </button>
          <button
            type="button"
            className={css.action}
            aria-label={t(allAssistantsCollapsed ? 'trajectory.toolbar.expandCalls' : 'trajectory.toolbar.collapseCalls')}
            aria-pressed={allAssistantsCollapsed}
            title={t(allAssistantsCollapsed ? 'trajectory.toolbar.expandCalls' : 'trajectory.toolbar.collapseCalls')}
            onClick={onToggleAllAssistants}
          >
            <span className={css.actionIcon} aria-hidden="true">
              {allAssistantsCollapsed ? '⊞' : '⊟'}
            </span>
            <span className={css.buttonLabel}>{t('trajectory.toolbar.calls')}</span>
          </button>
        </div>
        {eventFilter && onEventFilterChange && (
          <div className={css.filters} aria-label={t('trajectory.events.filters')}>
            <span className={css.divider} aria-hidden="true" />
            {(['all', 'conversation', 'tools', 'errors'] as const).map(filter => (
              <button key={filter} type="button" aria-pressed={eventFilter === filter} onClick={() => onEventFilterChange(filter)} className={css.filter}>
                {t(`trajectory.events.${filter}`)}
              </button>
            ))}
            <span className={css.eventCount}>{eventCount ?? 0}</span>
          </div>
        )}
        <div className={css.search}>
          <Search size={11} className={css.searchIcon} aria-hidden="true" />
          <input
            type="search"
            className={css.searchInput}
            aria-label={t('trajectory.toolbar.search')}
            placeholder={t('trajectory.toolbar.searchPlaceholder')}
            value={searchQuery}
            onChange={(event) => { onSearchQueryChange(event.currentTarget.value) }}
          />
          {searchQuery.trim() !== '' && (
            <span className={css.searchCount} aria-live="polite">{searchMatchCount ?? 0}</span>
          )}
        </div>
        {isProcessing && (
          <span className={css.live} role="status" aria-label="Processing" />
        )}
      </div>
    </div>
  )
}
