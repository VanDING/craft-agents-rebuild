/**
 * ContextPanel - workspace context + active session metadata.
 *
 * Sources/skills are workspace-level resources (LoadedSource carries no session
 * association), so they are listed here regardless of the active session; each
 * item navigates to its source/skill route. The active-session section shows
 * the metadata the renderer actually keeps (SessionMeta), and a guidance block
 * invites the user to focus a session for session-specific context.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { FolderKanban, Layers, Zap, ListFilter, FolderOpen, BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PanelHeader } from '../app-shell/PanelHeader'
import { PanelEmptyState } from './PanelEmptyState'
import { BoundSessionBadge } from './BoundSessionBadge'
import { useNavigation } from '@/contexts/NavigationContext'
import { activeSessionIdAtom } from '@/atoms/active-session'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { sourcesAtom } from '@/atoms/sources'
import { skillsAtom } from '@/atoms/skills'
import { routes, type ViewRoute } from '../../../shared/routes'
import { PERMISSION_MODE_CONFIG } from '@craft-agent/shared/agent/modes'
import { useLabels } from '@/hooks/useLabels'
import { useAppShellContext } from '@/context/AppShellContext'
import { findLabelById } from '@craft-agent/shared/labels'

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <h3 className="flex items-center gap-1.5 px-1 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
      {icon}
      <span className="truncate">{label}</span>
    </h3>
  )
}

function MetaRow({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className="flex items-start gap-2 px-1 py-1 text-[13px]">
      <span className="w-32 shrink-0 truncate text-muted-foreground/60">{label}</span>
      <span className="min-w-0 flex-1 break-words text-foreground/90">{value}</span>
    </div>
  )
}

export function ContextPanel() {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sources = useAtomValue(sourcesAtom)
  const skills = useAtomValue(skillsAtom)
  const { activeWorkspaceId } = useAppShellContext()
  const { labels: labelConfigs } = useLabels(activeWorkspaceId)

  const meta = activeSessionId ? sessionMetaMap.get(activeSessionId) : undefined
  const labelNames = useMemo(() => {
    if (!meta?.labels?.length) return []
    return meta.labels.map((id) => findLabelById(labelConfigs, id)?.name ?? id)
  }, [meta?.labels, labelConfigs])

  const navigateFromPanel = (route: ViewRoute) => {
    // Navigate the focused panel (same as clicking in the navigator would).
    navigate(route)
  }

  const visibleSources = sources.filter((source) => !source.isBuiltin)
  const permissionMode = meta?.permissionMode
  const modeConfig = permissionMode && permissionMode in PERMISSION_MODE_CONFIG
    ? PERMISSION_MODE_CONFIG[permissionMode as keyof typeof PERMISSION_MODE_CONFIG]
    : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title={t('contentPanel.title.context')}
        badge={activeSessionId ? (
          <BoundSessionBadge name={meta?.name} sessionId={activeSessionId} />
        ) : undefined}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 pb-6">
        {/* Active session metadata (only meaningful once a session is focused) */}
        {activeSessionId && meta ? (
          <section>
            <SectionTitle icon={<BadgeCheck className="h-3.5 w-3.5" />} label={t('contentPanel.context.sessionHeader')} />
            <div className="rounded-lg border border-border/60 bg-foreground/[0.02] px-2 py-2">
              <MetaRow label={t('contentPanel.context.name')} value={meta.name} />
              <MetaRow label={t('contentPanel.context.workingDirectory')} value={meta.workingDirectory} />
              <MetaRow label={t('contentPanel.context.permissionMode')} value={modeConfig?.displayName ?? meta.permissionMode} />
              <MetaRow label={t('contentPanel.context.status')} value={meta.sessionStatus} />
              <MetaRow label={t('contentPanel.context.model')} value={meta.model} />
              {labelNames.length > 0 && (
                <div className="flex items-start gap-2 px-1 py-1 text-[13px]">
                  <span className="w-32 shrink-0 truncate text-muted-foreground/60">{t('contentPanel.context.labels')}</span>
                  <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                    {labelNames.map((name) => (
                      <span key={name} className="rounded-full border border-border/60 bg-foreground/[0.03] px-2 py-0.5 text-[11px] text-muted-foreground">
                        {name}
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </div>
          </section>
        ) : (
          <PanelEmptyState
            title={t('contentPanel.context.noSessionContext')}
            hint={t('contentPanel.context.noSessionContextHint')}
            icon={<ListFilter className="h-6 w-6" />}
          />
        )}

        {/* Workspace sources — workspace-level, always available */}
        <section>
          <SectionTitle icon={<FolderKanban className="h-3.5 w-3.5" />} label={t('contentPanel.context.sourcesHeader')} />
          {visibleSources.length === 0 ? (
            <p className="px-1 py-1 text-[13px] text-muted-foreground/70">{t('contentPanel.context.sourcesEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {visibleSources.map((source) => (
                <li key={source.config.slug}>
                  <button
                    type="button"
                    onClick={() => navigateFromPanel(routes.view.sources({ sourceSlug: source.config.slug }))}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-foreground/[0.03]"
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{source.config.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Workspace skills — workspace-level, always available */}
        <section>
          <SectionTitle icon={<Layers className="h-3.5 w-3.5" />} label={t('contentPanel.context.skillsHeader')} />
          {skills.length === 0 ? (
            <p className="px-1 py-1 text-[13px] text-muted-foreground/70">{t('contentPanel.context.skillsEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {skills.map((skill) => (
                <li key={skill.slug}>
                  <button
                    type="button"
                    onClick={() => navigateFromPanel(routes.view.skills(skill.slug))}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-foreground/[0.03]',
                    )}
                  >
                    <Zap className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{skill.metadata.name ?? skill.slug}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
