import * as React from 'react'
import { ArrowLeft, CalendarDays, Clock3, Trash2 } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import type { CalendarEntryInput } from '@craft-agent/shared/protocol'
import { projectsAtom } from '@/atoms/projects'
import { kanbanProjectFilterAtom } from '@/atoms/kanban'
import { routes, useNavigation } from '@/contexts/NavigationContext'
import { useAppShellContext } from '@/context/AppShellContext'
import { useCalendarEntries } from '@/hooks/useCalendarEntries'
import { ProjectSelectMenu } from './ProjectSelectMenu'

const fieldClass = 'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-ring/60 focus:ring-2 focus:ring-ring/15'

function todayKey(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function initialDate(id: string): string {
  return id.startsWith('new:') ? id.slice(4).split('@')[0] || todayKey() : todayKey()
}

function initialTime(id: string): string {
  return id.startsWith('new:') ? id.split('@')[1] ?? '' : ''
}

function oneHourAfter(time: string): string {
  if (!time) return ''
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  return `${String(Math.min(23, hour + 1)).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function SchedulePage({ calendarEntryId }: { calendarEntryId: string }) {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const { navigate } = useNavigation()
  const projects = useAtomValue(projectsAtom)
  const projectFilter = useAtomValue(kanbanProjectFilterAtom)
  const { entries, create, update, remove } = useCalendarEntries(activeWorkspaceId ?? null)
  const isCreate = calendarEntryId === 'new' || calendarEntryId.startsWith('new:')
  const entry = isCreate ? undefined : entries.find(({ id }) => id === calendarEntryId)
  const [title, setTitle] = React.useState(entry?.title ?? '')
  const [date, setDate] = React.useState(entry?.date ?? initialDate(calendarEntryId))
  const seededTime = entry?.time ?? initialTime(calendarEntryId)
  const [allDay, setAllDay] = React.useState(entry?.allDay ?? !seededTime)
  const [time, setTime] = React.useState(seededTime)
  const [endTime, setEndTime] = React.useState(entry?.endTime ?? oneHourAfter(seededTime))
  const [projectId, setProjectId] = React.useState(entry?.projectId ?? projectFilter[0] ?? '')
  const [note, setNote] = React.useState(entry?.note ?? '')
  const [saving, setSaving] = React.useState(false)

  const close = React.useCallback(() => {
    navigate(routes.view.projectManagement('calendar'))
  }, [navigate])

  React.useEffect(() => {
    if (!isCreate && entries.length > 0 && !entry) close()
  }, [close, entries.length, entry, isCreate])

  React.useEffect(() => {
    if (!entry) return
    setTitle(entry.title)
    setDate(entry.date)
    setAllDay(entry.allDay ?? !entry.time)
    setTime(entry.time ?? '')
    setEndTime(entry.endTime ?? oneHourAfter(entry.time ?? ''))
    setProjectId(entry.projectId ?? '')
    setNote(entry.note ?? '')
  }, [entry])

  const save = React.useCallback(async () => {
    if (!title.trim() || !date || saving) return
    setSaving(true)
    const input: CalendarEntryInput = {
      title: title.trim(),
      date,
      allDay,
      time: allDay ? undefined : time || undefined,
      endTime: allDay ? undefined : endTime || undefined,
      projectId: projectId || undefined,
      note: note.trim() || undefined,
    }
    const saved = isCreate ? await create(input) : await update(calendarEntryId, input)
    setSaving(false)
    if (saved) close()
  }, [allDay, calendarEntryId, close, create, date, endTime, isCreate, note, projectId, saving, time, title, update])

  const projectOptions = React.useMemo(() => [
    { value: '', label: t('kanban.workItemNoProject') },
    ...projects.map((project) => ({ value: project.config.id, label: project.config.name })),
  ], [projects, t])

  if (!isCreate && !entry) {
    return <div className="flex h-full items-center justify-center text-sm text-foreground/45">{t('common.loading')}</div>
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="relative flex h-12 flex-none items-center justify-between border-b border-border/60 px-4">
        <button type="button" onClick={close} className="z-10 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {t('common.back')}
        </button>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold">
          {isCreate ? t('schedule.newEntry') : t('schedule.editEntry')}
        </div>
        <div className="w-16" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-minimal">
            <div className="mb-5 flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="h-4 w-4" /></div>
              <div>
                <h2 className="text-sm font-semibold">{isCreate ? t('schedule.newEntry') : t('schedule.editEntry')}</h2>
                <p className="mt-0.5 text-xs text-foreground/45">{date}{time ? ` · ${time}` : ''}</p>
              </div>
            </div>

            <div className="space-y-5">
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-foreground/65">
                {t('schedule.entryTitle')}
                <input className={fieldClass} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('schedule.entryTitlePlaceholder')} autoFocus />
              </label>

              <label className="flex flex-col gap-1.5 text-xs font-semibold text-foreground/65">
                {t('kanban.workItemProject')}
                <ProjectSelectMenu value={projectId} options={projectOptions} onValueChange={setProjectId} ariaLabel={t('kanban.workItemProject')} className="h-10 w-full justify-between" />
              </label>

              <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground/65">
                <input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />
                {t('schedule.allDay')}
              </label>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-foreground/65">
                  {t('schedule.entryDate')}
                  <input type="date" className={fieldClass} value={date} onChange={(event) => setDate(event.target.value)} />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-foreground/65">
                  {t('schedule.entryTime')}
                  <div className="relative">
                    <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/35" />
                    <input type="time" disabled={allDay} className={`${fieldClass} pl-9 disabled:opacity-45`} value={time} onChange={(event) => {
                      const next = event.target.value
                      setTime(next)
                      if (!endTime || endTime <= next) setEndTime(oneHourAfter(next))
                    }} />
                  </div>
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-foreground/65">
                  {t('schedule.entryEndTime')}
                  <input type="time" disabled={allDay} className={`${fieldClass} disabled:opacity-45`} value={endTime} min={time || undefined} onChange={(event) => setEndTime(event.target.value)} />
                </label>
              </div>

              <label className="flex flex-col gap-1.5 text-xs font-semibold text-foreground/65">
                {t('schedule.entryNote')}
                <textarea className="min-h-36 w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-ring/60 focus:ring-2 focus:ring-ring/15" value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
            </div>
          </section>
        </div>
      </div>

      <div className="flex flex-none items-center justify-between border-t border-border/60 px-4 py-3">
        {!isCreate ? (
          <button type="button" onClick={() => {
            if (!window.confirm(t('schedule.delete'))) return
            void remove(calendarEntryId).then(close)
          }} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-destructive hover:bg-destructive/10">
            <Trash2 className="h-3.5 w-3.5" /> {t('common.delete')}
          </button>
        ) : <div />}
        <div className="flex gap-2">
          <button type="button" onClick={close} className="h-8 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-foreground/[0.04]">{t('common.cancel')}</button>
          <button type="button" onClick={() => void save()} disabled={!title.trim() || !date || saving} className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
