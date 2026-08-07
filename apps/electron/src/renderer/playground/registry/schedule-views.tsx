/**
 * Playground entries for the Gantt and Calendar schedule views.
 *
 * Renders the full containers (atom-driven) against a seeded session meta
 * map — scheduled + unscheduled tasks, subtask lanes, multiple statuses and
 * projects — using the same provider stack the mobile-webui demos use.
 */

import * as React from 'react'
import { Provider as JotaiProvider, createStore, useSetAtom } from 'jotai'
import { AppShellProvider, useOptionalAppShellContext } from '@/context/AppShellContext'
import { FocusProvider } from '@/context/FocusContext'
import { ModalProvider } from '@/context/ModalContext'
import { DismissibleLayerProvider } from '@/context/DismissibleLayerContext'
import { EscapeInterruptProvider } from '@/context/EscapeInterruptContext'
import { ActionRegistryProvider } from '@/actions/registry'
import { NavigationProvider } from '@/contexts/NavigationContext'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { projectsAtom } from '@/atoms/projects'
import { ensureMockElectronAPI } from '../mock-utils'
import type { ComponentEntry } from './types'
import { GanttView } from '@/components/app-shell/kanban/GanttView'
import { CalendarView } from '@/components/app-shell/kanban/CalendarView'

ensureMockElectronAPI()

const WORKSPACE_ID = 'ws-playground-schedule'

// Relative timestamps resolved once at import (calendar days in the past/future).
const DAY = 86_400_000
const NOW = Date.now()

function meta(overrides: Partial<SessionMeta>): SessionMeta {
  return {
    id: 's0',
    name: 'Task',
    sessionStatus: 'todo',
    labels: [],
    createdAt: NOW - 30 * DAY,
    workspaceId: WORKSPACE_ID,
    isArchived: false,
    hidden: false,
    taskDraft: false,
    ...overrides,
  } as SessionMeta
}

const MOCK_SESSIONS: SessionMeta[] = [
  // Scheduled top-level tasks across statuses/projects/dates.
  meta({
    id: 't1', name: 'Redesign onboarding flow', sessionStatus: 'in-progress', projectId: 'p-eng',
    labels: ['start::2026-08-03', 'due::2026-08-10'], createdAt: NOW - 20 * DAY,
  }),
  meta({
    id: 't2', name: 'Draft Q3 launch announcement', sessionStatus: 'todo', projectId: 'p-growth',
    labels: ['start::2026-08-12', 'due::2026-08-15'], createdAt: NOW - 6 * DAY,
  }),
  meta({
    id: 't3', name: 'Synthesize user interviews', sessionStatus: 'needs-review', projectId: 'p-research',
    labels: ['due::2026-08-08'], createdAt: NOW - 45 * DAY,
  }),
  meta({
    id: 't4', name: 'Migrate auth to new session model', sessionStatus: 'in-progress', projectId: 'p-eng',
    labels: ['start::2026-07-28', 'due::2026-08-05'], createdAt: NOW - 60 * DAY,
  }),
  // Completed task with a past window (spans months).
  meta({
    id: 't5', name: 'Ship v0.11 release notes', sessionStatus: 'done', projectId: 'p-growth',
    labels: ['start::2026-06-01', 'due::2026-06-15'], createdAt: NOW - 90 * DAY,
  }),
  // Unscheduled — calendar falls back to creation date.
  meta({
    id: 't6', name: 'Investigate flaky CI on Windows runners', sessionStatus: 'todo',
    createdAt: NOW - 3 * DAY,
  }),
  meta({
    id: 't7', name: 'Prepare investor update', sessionStatus: 'todo', projectId: 'p-research',
    createdAt: NOW - 12 * DAY,
  }),
  // Subtask lane of t4 (dependency arrow).
  meta({
    id: 't4-1', name: 'Audit current auth middleware', sessionStatus: 'done', projectId: 'p-eng',
    parentSessionId: 't4', labels: ['start::2026-07-28', 'due::2026-07-30'], createdAt: NOW - 59 * DAY,
  }),
  meta({
    id: 't4-2', name: 'Draft migration plan', sessionStatus: 'in-progress', projectId: 'p-eng',
    parentSessionId: 't4', labels: ['due::2026-08-05'], createdAt: NOW - 58 * DAY,
  }),
]

const MOCK_STATUSES = [
  { id: 'todo', label: 'Todo', resolvedColor: 'var(--muted-foreground)', category: 'open' },
  { id: 'in-progress', label: 'In Progress', resolvedColor: 'var(--info)', category: 'open' },
  { id: 'needs-review', label: 'Needs Review', resolvedColor: 'var(--warning)', category: 'open' },
  { id: 'done', label: 'Done', resolvedColor: 'var(--success)', category: 'closed' },
  { id: 'cancelled', label: 'Cancelled', resolvedColor: 'var(--muted-foreground)', category: 'closed' },
]

/** Hydrate the isolated jotai store with the seeded session metas. */
function HydrateSessions({ children }: { children: React.ReactNode }) {
  const setMetaMap = useSetAtom(sessionMetaMapAtom)
  const setProjects = useSetAtom(projectsAtom)
  React.useEffect(() => {
    const map = new Map<string, SessionMeta>()
    for (const m of MOCK_SESSIONS) map.set(m.id, m)
    setMetaMap(map)
    setProjects([
      {
        config: { id: 'p-eng', slug: 'engineering', name: 'Engineering', color: '#6366f1', createdAt: 1, updatedAt: 1 },
        workspaceId: WORKSPACE_ID,
        folderPath: '',
        assetsPath: '',
        workspaceRootPath: '',
      },
      {
        config: { id: 'p-growth', slug: 'growth', name: 'Growth', color: '#10b981', createdAt: 1, updatedAt: 1 },
        workspaceId: WORKSPACE_ID,
        folderPath: '',
        assetsPath: '',
        workspaceRootPath: '',
      },
      {
        config: { id: 'p-research', slug: 'research', name: 'Research', color: '#f59e0b', createdAt: 1, updatedAt: 1 },
        workspaceId: WORKSPACE_ID,
        folderPath: '',
        assetsPath: '',
        workspaceRootPath: '',
      },
    ])
  }, [setMetaMap, setProjects])
  return <>{children}</>
}

/** AppShell override: seeded workspace id, statuses, and no-op jumps. */
function ScheduleAppShell({ children }: { children: React.ReactNode }) {
  const parent = useOptionalAppShellContext()
  const value = React.useMemo(
    () => ({
      ...parent,
      activeWorkspaceId: WORKSPACE_ID,
      activeWorkspaceSlug: 'schedule',
      sessionStatuses: MOCK_STATUSES,
      llmConnections: [],
      onJumpToTaskSessions: () => {},
    }),
    [parent],
  )
  return <AppShellProvider value={value as never}>{children}</AppShellProvider>
}

function ScheduleViewPreview({ view }: { view: 'gantt' | 'calendar' }) {
  const store = React.useMemo(() => createStore(), [])
  return (
    <JotaiProvider store={store}>
      <HydrateSessions>
        <ActionRegistryProvider>
          <DismissibleLayerProvider>
            <ModalProvider>
              <EscapeInterruptProvider>
                <FocusProvider>
                  <NavigationProvider
                    workspaceId={WORKSPACE_ID}
                    workspaceSlug="schedule"
                    onCreateSession={async () => ({}) as never}
                    isReady
                    isSessionsReady
                  >
                    <ScheduleAppShell>
                      <div className="h-full w-full bg-background">
                        {view === 'gantt' ? <GanttView /> : <CalendarView />}
                      </div>
                    </ScheduleAppShell>
                  </NavigationProvider>
                </FocusProvider>
              </EscapeInterruptProvider>
            </ModalProvider>
          </DismissibleLayerProvider>
        </ActionRegistryProvider>
      </HydrateSessions>
    </JotaiProvider>
  )
}

export const scheduleViewComponents: ComponentEntry[] = [
  {
    category: 'Kanban',
    id: 'gantt-view',
    name: 'Gantt View',
    description: 'Full Gantt container: zoom scales, lanes, dependency arrows, today line, schedule editor.',
    component: () => <ScheduleViewPreview view="gantt" />,
    props: [],
    variants: [{ name: 'Gantt', props: {} }],
  },
  {
    category: 'Kanban',
    id: 'calendar-view',
    name: 'Calendar View',
    description: 'Full calendar container: all sessions by due-or-created date, status colors.',
    component: () => <ScheduleViewPreview view="calendar" />,
    props: [],
    variants: [{ name: 'Calendar', props: {} }],
  },
]
