import { CalendarDays, FolderKanban, LayoutGrid, ListTodo, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { routes, useNavigation } from '@/contexts/NavigationContext'
import { cn } from '@/lib/utils'
import { PROJECT_MANAGEMENT_VIEWS, type ProjectManagementView } from '../../../shared/types'

interface ProjectManagementViewMetadata {
  icon: LucideIcon
  labelKey: string
}

/**
 * Enabled Project Management projections.
 *
 * This is intentionally a closed registry. Gantt/timeline are not added until
 * they have a WorkItem-backed implementation, so reserving the architecture
 * never produces dead navigation or placeholder screens.
 */
const PROJECT_MANAGEMENT_VIEW_METADATA: Record<ProjectManagementView, ProjectManagementViewMetadata> = {
  overview: { icon: FolderKanban, labelKey: 'sidebar.projects' },
  list: { icon: ListTodo, labelKey: 'kanban.list' },
  board: { icon: LayoutGrid, labelKey: 'contentPanel.button.board' },
  calendar: { icon: CalendarDays, labelKey: 'contentPanel.button.calendar' },
}

export interface ProjectManagementViewTabsProps {
  value: ProjectManagementView
  className?: string
}

export function ProjectManagementViewTabs({ value, className }: ProjectManagementViewTabsProps) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()

  return (
    <div
      role="tablist"
      aria-label={t('sidebar.projects')}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-border/70 bg-foreground/[0.02] p-0.5',
        className,
      )}
    >
      {PROJECT_MANAGEMENT_VIEWS.map((id) => {
        const { icon: Icon, labelKey } = PROJECT_MANAGEMENT_VIEW_METADATA[id]
        const label = t(labelKey)
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={value === id}
            aria-label={label}
            title={label}
            onClick={() => {
              if (value !== id) navigate(routes.view.projectManagement(id))
            }}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
              value === id
                ? 'bg-card text-foreground shadow-minimal'
                : 'text-foreground/50 hover:text-foreground/80',
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            <span className="hidden @min-[720px]/panel:inline">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
