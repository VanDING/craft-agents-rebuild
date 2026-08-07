/**
 * ScheduleDatePopover — inline start/due date editor for schedule views.
 *
 * Reads the task's schedule (from labels), lets the user pick/clear the start
 * and due dates, and applies the change through `onApply(nextLabels)` — the
 * parent wires that to the optimistic meta update + `setLabels` RPC, keeping
 * the label merge semantics (`updateTaskSchedule`) in one place.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, CalendarX2, CalendarPlus } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import {
  getTaskSchedule,
  updateTaskSchedule,
  startOfDay,
  type SchedulePatch,
  type TaskSchedule,
} from './schedule'

interface ScheduleDatePopoverProps {
  /** Task title shown in the popover header. */
  title: string
  /** Current label entries (source of truth for the merge). */
  labels: string[] | undefined
  /** Apply the merged label list (optimistic meta + setLabels RPC). */
  onApply: (nextLabels: string[]) => void
  className?: string
}

/** Field row: label + current value + mini calendar + clear. */
function DateField({
  labelKey,
  value,
  onSelect,
  onClear,
}: {
  labelKey: string
  value: Date | null
  onSelect: (date: Date) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="w-14 shrink-0 text-[11px] font-medium text-foreground/60">{t(labelKey)}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs text-foreground transition-colors hover:bg-foreground/[0.03]',
              !value && 'text-foreground/45'
            )}
          >
            <CalendarDays className="h-3 w-3 shrink-0 opacity-60" />
            <span className="truncate">{value ? format(value, 'yyyy-MM-dd') : t('schedule.notSet')}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" side="right">
          <Calendar
            mode="single"
            selected={value ?? undefined}
            onSelect={(date) => {
              if (date) onSelect(date)
            }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {value && (
        <button
          type="button"
          onClick={onClear}
          title={t('schedule.clear')}
          className="rounded-md p-1 text-foreground/45 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
        >
          <CalendarX2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

interface ScheduleDraft {
  start: Date | null
  due: Date | null
}

function toDraft(schedule: TaskSchedule): ScheduleDraft {
  return { start: schedule.start ?? null, due: schedule.due ?? null }
}

export function ScheduleDatePopover({ title, labels, onApply, className }: ScheduleDatePopoverProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<ScheduleDraft>(() => toDraft(getTaskSchedule(labels)))

  // Reset the draft whenever the popover reopens with (potentially) fresh data.
  React.useEffect(() => {
    if (open) setDraft(toDraft(getTaskSchedule(labels)))
  }, [open, labels])

  const patch: SchedulePatch = {
    start: draft.start,
    due: draft.due,
  }

  const handleApply = () => {
    onApply(updateTaskSchedule(labels, patch))
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t('schedule.editSchedule')}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-foreground/50 transition-colors hover:bg-foreground/[0.05] hover:text-foreground',
            className
          )}
        >
          <CalendarPlus className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="mb-2 truncate text-xs font-semibold text-foreground">{title}</div>
        <div className="flex flex-col gap-2.5">
          <DateField
            labelKey="schedule.start"
            value={draft.start ?? null}
            onSelect={(date) => setDraft((prev) => ({ ...prev, start: startOfDay(date) }))}
            onClear={() => setDraft((prev) => ({ ...prev, start: null }))}
          />
          <DateField
            labelKey="schedule.due"
            value={draft.due ?? null}
            onSelect={(date) => setDraft((prev) => ({ ...prev, due: startOfDay(date) }))}
            onClear={() => setDraft((prev) => ({ ...prev, due: null }))}
          />
        </div>
        <div className="mt-3 flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={handleApply}>
            {t('common.save')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
