/**
 * Schedule derivation for the Gantt and Calendar views.
 *
 * v1 reads scheduling from the `start` / `due` date labels (e.g.
 * `start::2026-08-07`, `due::2026-08-10`); the label system already parses,
 * validates, and formats date values (`parseLabelEntry` / `formatLabelEntry`).
 * All view code goes through these pure functions so the storage can later
 * switch to native SessionConfig fields without touching the components.
 */

import { parseLabelEntry, type ParsedLabelEntry } from '@craft-agent/shared/labels'
import type { SessionMeta } from '@/atoms/sessions'
import { getSessionTitle } from '@/utils/session'

/** Reserved label ids carrying the schedule dates. */
export const SCHEDULE_LABEL_START = 'start'
export const SCHEDULE_LABEL_DUE = 'due'

/**
 * Reserved date labels the schedule views rely on (auto-created when missing).
 * The created label id derives from the name slug ('Start' → 'start'); when a
 * slug collision occurs createLabel appends -N, so both the bare id and its
 * suffixed duplicates are treated as schedule carriers (parsing is permissive;
 * writing always targets the bare id via updateTaskSchedule).
 */
export const SCHEDULE_LABELS = [
  { id: SCHEDULE_LABEL_START, name: 'Start', valueType: 'date' as const },
  { id: SCHEDULE_LABEL_DUE, name: 'Due', valueType: 'date' as const },
]

/** Matches `start`, `due`, and slug-collision duplicates like `start-2`. */
const SCHEDULE_LABEL_ID_RE = /^(start|due)(?:-\d+)?$/

/** Normalize any schedule label id (e.g. `start-2`) to its canonical id. */
export function normalizeScheduleLabelId(id: string): string | undefined {
  const match = SCHEDULE_LABEL_ID_RE.exec(id)
  if (!match) return undefined
  return match[1]
}

export interface TaskSchedule {
  /** Inclusive start date (local calendar day). */
  start?: Date
  /** Inclusive due date (local calendar day). */
  due?: Date
}

/**
 * Patch for {@link updateTaskSchedule}. `undefined` leaves the field
 * untouched, `null` clears it, a `Date` sets it.
 */
export interface SchedulePatch {
  start?: Date | null
  due?: Date | null
}

/**
 * Extract the schedule from a session's label entries.
 * Entries are `start::YYYY-MM-DD` / `due::YYYY-MM-DD`; unparseable or
 * non-date values are ignored (parseLabelEntry throws RangeError on
 * date-shaped-but-invalid values — malformed entries must never crash
 * the views that read user data).
 *
 * Label dates parse as UTC midnight; they are re-interpreted as *local*
 * calendar days so comparisons, formatting, and day-cell grouping match
 * the user's clock in every timezone.
 */
export function getTaskSchedule(labels: string[] | undefined): TaskSchedule {
  if (!labels?.length) return {}
  const schedule: TaskSchedule = {}
  for (const entry of labels) {
    let parsed: ParsedLabelEntry
    try {
      parsed = parseLabelEntry(entry)
    } catch {
      continue
    }
    if (!(parsed.value instanceof Date)) continue
    if (Number.isNaN(parsed.value.getTime())) continue
    const canonical = normalizeScheduleLabelId(parsed.id)
    if (canonical === SCHEDULE_LABEL_START) schedule.start = toLocalDay(parsed.value)
    else if (canonical === SCHEDULE_LABEL_DUE) schedule.due = toLocalDay(parsed.value)
  }
  return schedule
}

/**
 * Merge a schedule patch into a label list (read-modify-write for the
 * full-replace `setLabels` RPC): existing start/due entries are dropped,
 * then re-emitted with the patch applied — `undefined` keeps the old
 * value, `null` clears it, a `Date` sets it. Other labels are untouched.
 */
export function updateTaskSchedule(labels: string[] | undefined, patch: SchedulePatch): string[] {
  const old = getTaskSchedule(labels)
  const kept = (labels ?? []).filter((entry) => {
    const id = parseLabelEntry(entry).id
    return normalizeScheduleLabelId(id) === undefined
  })
  const start = patch.start !== undefined ? patch.start : old.start
  const due = patch.due !== undefined ? patch.due : old.due
  if (start) kept.push(`${SCHEDULE_LABEL_START}::${formatDateOnly(start)}`)
  if (due) kept.push(`${SCHEDULE_LABEL_DUE}::${formatDateOnly(due)}`)
  return kept
}

/**
 * Which reserved schedule labels are missing from a workspace's label tree.
 * A label only counts as present when both its display name AND its value
 * type match — a pre-existing boolean 'Due' label must not block the date
 * variant (which then lands on a suffixed slug and still parses).
 */
export function missingScheduleLabels(
  flatLabels: ReadonlyArray<{ id: string; name?: string; valueType?: string }>,
): typeof SCHEDULE_LABELS {
  return SCHEDULE_LABELS.filter(
    (def) => !flatLabels.some((l) => l.name === def.name && l.valueType === def.valueType),
  )
}

/** Whether a task carries any scheduling data at all. */
export function hasSchedule(schedule: TaskSchedule): boolean {
  return schedule.start !== undefined || schedule.due !== undefined
}

/** True when the task is done/archived and its due date is in the past. */
export function isOverdue(schedule: TaskSchedule, statusId: string, now: Date = new Date()): boolean {
  if (!schedule.due) return false
  if (statusId === 'done' || statusId === 'archived') return false
  return startOfDay(schedule.due) < startOfDay(now)
}

/** One row in the Gantt lane list / calendar day cell. */
export interface ScheduledTaskRow {
  id: string
  title: string
  parentSessionId?: string
  projectId?: string
  statusId: string
  schedule: TaskSchedule
  createdAt?: number
}

/**
 * Derive schedule rows from the session meta map: top-level tasks first
 * (sorted by start date, then creation), each followed by its direct child
 * rows so parent → child dependency arrows have stable lanes.
 */
export function deriveScheduledTaskRows(metas: Iterable<SessionMeta>): ScheduledTaskRow[] {
  const parents: ScheduledTaskRow[] = []
  const childrenByParent = new Map<string, ScheduledTaskRow[]>()

  for (const meta of metas) {
    if (meta.isArchived || meta.hidden || meta.taskDraft) continue
    const row: ScheduledTaskRow = {
      id: meta.id,
      title: getSessionTitle(meta),
      parentSessionId: meta.parentSessionId,
      projectId: meta.projectId,
      statusId: meta.sessionStatus ?? 'todo',
      schedule: getTaskSchedule(meta.labels),
      createdAt: meta.createdAt,
    }
    if (meta.parentSessionId) {
      const siblings = childrenByParent.get(meta.parentSessionId)
      if (siblings) siblings.push(row)
      else childrenByParent.set(meta.parentSessionId, [row])
    } else {
      parents.push(row)
    }
  }

  const byStart = (a: ScheduledTaskRow, b: ScheduledTaskRow) => {
    // Scheduled rows first (by start), then unscheduled by creation time.
    const aKey = a.schedule.start ? a.schedule.start.getTime() : Number.MAX_SAFE_INTEGER
    const bKey = b.schedule.start ? b.schedule.start.getTime() : Number.MAX_SAFE_INTEGER
    return aKey - bKey || (a.createdAt ?? 0) - (b.createdAt ?? 0)
  }
  parents.sort(byStart)
  for (const children of childrenByParent.values()) children.sort(byStart)

  const rows: ScheduledTaskRow[] = []
  for (const parent of parents) {
    rows.push(parent)
    rows.push(...(childrenByParent.get(parent.id) ?? []))
  }
  return rows
}

/** Start of the local calendar day for a Date. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * Re-interpret a UTC-midnight date (how label dates parse) as a local
 * calendar day, so day-level math follows the user's timezone.
 */
function toLocalDay(utcMidnight: Date): Date {
  return new Date(utcMidnight.getUTCFullYear(), utcMidnight.getUTCMonth(), utcMidnight.getUTCDate())
}

/** Local calendar-day label (YYYY-MM-DD) — the canonical stored format. */
export function formatDateOnly(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
