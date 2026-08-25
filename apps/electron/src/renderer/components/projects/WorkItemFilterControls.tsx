import * as React from 'react'
import { Filter } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WorkItemScheduledFilter } from '@craft-agent/shared/work-items/browser'
import type { SessionStatus } from '@/config/session-status-config'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ProjectSelectMenu } from './ProjectSelectMenu'

interface WorkItemFilterControlsProps {
  statusIds: string[]
  setStatusIds: (ids: string[]) => void
  scheduled: WorkItemScheduledFilter
  setScheduled: (value: WorkItemScheduledFilter) => void
  statuses: readonly SessionStatus[]
  className?: string
}

/** Transient query controls shared by List, Board and Calendar. */
export function WorkItemFilterControls({
  statusIds,
  setStatusIds,
  scheduled,
  setScheduled,
  statuses,
  className,
}: WorkItemFilterControlsProps) {
  const { t } = useTranslation()
  const scheduleOptions = React.useMemo(() => [
    { value: 'all', label: t('kanban.allTasks') },
    { value: 'scheduled', label: t('kanban.scheduledOnly') },
    { value: 'unscheduled', label: t('kanban.unscheduledOnly') },
  ], [t])

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('kanban.viewFilters')}
            className={cn(
              'relative grid h-8 w-8 place-items-center rounded-lg border border-border bg-background text-foreground/55 hover:text-foreground',
              (statusIds.length > 0 || scheduled !== 'all') && 'border-primary/40 text-primary',
            )}
          >
            <Filter className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          <div className="mb-2 text-xs font-semibold">{t('kanban.workItemStatus')}</div>
          <div className="max-h-40 space-y-1 overflow-auto">
            {statuses.map((status) => (
              <label key={status.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-foreground/[0.04]">
                <input
                  type="checkbox"
                  checked={statusIds.includes(status.id)}
                  onChange={(event) => setStatusIds(event.target.checked
                    ? [...statusIds, status.id]
                    : statusIds.filter((id) => id !== status.id))}
                />
                <span>{status.label}</span>
              </label>
            ))}
          </div>
          <div className="mb-1 mt-3 text-xs font-semibold">{t('kanban.scheduleFilter')}</div>
          <ProjectSelectMenu
            value={scheduled}
            options={scheduleOptions}
            onValueChange={(value) => setScheduled(value as WorkItemScheduledFilter)}
            ariaLabel={t('kanban.scheduleFilter')}
            className="w-full"
          />
          <button type="button" onClick={() => { setStatusIds([]); setScheduled('all') }} className="mt-3 text-xs font-semibold text-foreground/55 hover:text-foreground">
            {t('common.clear')}
          </button>
        </PopoverContent>
      </Popover>
    </div>
  )
}
