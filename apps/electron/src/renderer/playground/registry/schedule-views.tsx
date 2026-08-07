/**
 * Playground entry for the Calendar schedule view.
 *
 * Renders the full container against mocked calendar entries via the mock
 * electronAPI (listCalendarEntries / create / update / delete), inside the
 * provider stack the mobile-webui demos use.
 */

import * as React from 'react'
import { Provider as JotaiProvider, createStore } from 'jotai'
import { AppShellProvider, useOptionalAppShellContext } from '@/context/AppShellContext'
import { FocusProvider } from '@/context/FocusContext'
import { ModalProvider } from '@/context/ModalContext'
import { DismissibleLayerProvider } from '@/context/DismissibleLayerContext'
import { EscapeInterruptProvider } from '@/context/EscapeInterruptContext'
import { ActionRegistryProvider } from '@/actions/registry'
import { NavigationProvider } from '@/contexts/NavigationContext'
import { ensureMockElectronAPI } from '../mock-utils'
import type { ComponentEntry } from './types'
import { CalendarView } from '@/components/app-shell/kanban/CalendarView'

ensureMockElectronAPI()

const WORKSPACE_ID = 'ws-playground-schedule'

/** AppShell override: seeded workspace id, no-op session creation. */
function ScheduleAppShell({ children }: { children: React.ReactNode }) {
  const parent = useOptionalAppShellContext()
  const value = React.useMemo(
    () => ({
      ...parent,
      activeWorkspaceId: WORKSPACE_ID,
      activeWorkspaceSlug: 'schedule',
      onCreateSession: async () => ({ id: 'mock-session', name: 'Mock' }),
    }),
    [parent],
  )
  return <AppShellProvider value={value as never}>{children}</AppShellProvider>
}

function CalendarViewPreview() {
  const store = React.useMemo(() => createStore(), [])
  return (
    <JotaiProvider store={store}>
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
                      <CalendarView />
                    </div>
                  </ScheduleAppShell>
                </NavigationProvider>
              </FocusProvider>
            </EscapeInterruptProvider>
          </ModalProvider>
        </DismissibleLayerProvider>
      </ActionRegistryProvider>
    </JotaiProvider>
  )
}

export const scheduleViewComponents: ComponentEntry[] = [
  {
    category: 'Kanban',
    id: 'calendar-view',
    name: 'Calendar View',
    description: 'Full calendar container: Day / Week / Month views over standalone schedule entries.',
    component: () => <CalendarViewPreview />,
    props: [],
    variants: [{ name: 'Calendar', props: {} }],
  },
]
