import { useTranslation } from 'react-i18next'
import * as React from 'react'
import type { ProjectsNavigationState } from '../../../shared/types'
import ProjectInfoPage from '@/pages/ProjectInfoPage'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { CalendarView } from '@/components/app-shell/kanban/CalendarView'
import { KanbanBoardContainer } from '@/components/app-shell/kanban/KanbanBoardContainer'
import { WorkItemListView } from '@/components/app-shell/kanban/WorkItemListView'
import { TaskPage } from './TaskPage'
import { SchedulePage } from './SchedulePage'

export interface ProjectManagementSurfaceProps {
  state: ProjectsNavigationState
}

function assertNeverProjectManagementView(view: never): never {
  throw new Error(`Unsupported Project Management view: ${String(view)}`)
}

/**
 * The single Primary Surface for project-oriented work.
 *
 * Overview, Kanban and Calendar are projections within this component. Future
 * projections must be added to the shared registry and handled exhaustively
 * here; they do not become new top-level panel kinds.
 */
export function ProjectManagementSurface({ state }: ProjectManagementSurfaceProps) {
  const { t } = useTranslation()
  let content: React.ReactNode
  if (state.details?.type === 'workItem' && state.view !== 'overview') {
    content = <TaskPage workItemId={state.details.workItemId} sourceView={state.view} />
  } else if (state.details?.type === 'calendarEntry' && state.view === 'calendar') {
    content = <SchedulePage calendarEntryId={state.details.calendarEntryId} />
  } else switch (state.view) {
    case 'list':
      content = <WorkItemListView />
      break
    case 'board':
      content = <KanbanBoardContainer />
      break
    case 'calendar':
      content = <CalendarView />
      break
    case 'overview':
      if (state.details?.type === 'project') {
        content = <ProjectInfoPage projectSlug={state.details.projectSlug} />
        break
      }
      content = (
        <div className="flex h-full flex-col">
          <PanelHeader
            title={t('sidebar.projects')}
            centerTitleInPanel
          />
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <p className="text-sm">{t('projectsList.noProjectSelected')}</p>
          </div>
        </div>
      )
      break
    default:
      return assertNeverProjectManagementView(state.view)
  }

  return (
    <div className="@container/panel relative h-full min-h-0 overflow-hidden">
      <div className="h-full min-h-0">{content}</div>
    </div>
  )
}
