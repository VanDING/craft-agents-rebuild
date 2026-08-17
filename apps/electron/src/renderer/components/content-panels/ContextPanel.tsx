/**
 * ContextPanel - active-session context, opencode-style stats grid.
 *
 * Answers "what environment is this session in, what has it consumed, what is
 * it carrying": a two-column stat grid (label above value, missing values show
 * an em dash), then attachments / recently opened files / the workspace
 * resources section. Sources/skills are workspace-level and duplicated by the
 * left sidebar, so they sit in a collapsed section by default.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { FolderKanban, Layers, ListFilter, Paperclip, History, ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PanelHeader } from '../app-shell/PanelHeader'
import { PanelEmptyState } from './PanelEmptyState'
import { BoundSessionBadge } from './BoundSessionBadge'
import { useNavigation } from '@/contexts/NavigationContext'
import { activeSessionIdAtom } from '@/atoms/active-session'
import { sessionMetaMapAtom, sessionAtomFamily, loadedSessionsAtom } from '@/atoms/sessions'
import { previewEntriesForSessionAtom } from '@/atoms/preview'
import { sourcesAtom } from '@/atoms/sources'
import { skillsAtom } from '@/atoms/skills'
import { routes, type ViewRoute } from '../../../shared/routes'
import { PERMISSION_MODE_CONFIG } from '@craft-agent/shared/agent/modes'
import { useLabels } from '@/hooks/useLabels'
import { useAppShellContext } from '@/context/AppShellContext'
import { findLabelById } from '@craft-agent/shared/labels'
import type { SourceConnectionStatus } from '@craft-agent/shared/sources'

/** Status dot colors for source connection states (Task 6, decision #5). */
const CONNECTION_STATUS_DOT: Record<SourceConnectionStatus, string> = {
  connected: 'bg-emerald-500',
  needs_auth: 'bg-amber-500',
  failed: 'bg-red-500',
  untested: 'bg-foreground/30',
  local_disabled: 'bg-foreground/30',
}

/** Last path segment of a file path (macOS + Windows separators). */
function fileBasename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Stat cell — label above value, em dash placeholder (opencode pattern). */
function Stat({ label, value, span }: { label: string; value?: React.ReactNode; span?: boolean }) {
  return (
    <div className={cn(
      'flex min-w-0 flex-col gap-0.5 rounded-lg border border-border/60 bg-foreground/[0.02] px-2 py-1.5',
      span && 'col-span-2',
    )}>
      <span className="text-[11px] text-muted-foreground/70">{label}</span>
      <span
        className="min-w-0 truncate text-[13px] font-medium text-foreground/90"
        title={typeof value === 'string' ? value : undefined}
      >
        {value ?? '—'}
      </span>
    </div>
  )
}

function SectionTitle({ icon, label, collapsed, onToggle }: {
  icon: React.ReactNode
  label: string
  collapsed?: boolean
  onToggle?: () => void
}) {
  const content = (
    <h3 className="flex items-center gap-1.5 px-1 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
      {collapsed !== undefined && onToggle && (
        <span className="-ml-1 text-muted-foreground/60">
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </span>
      )}
      {icon}
      <span className="truncate">{label}</span>
    </h3>
  )
  if (collapsed === undefined || !onToggle) return content
  return (
    <button type="button" onClick={onToggle} className="w-full text-left" aria-expanded={!collapsed}>
      {content}
    </button>
  )
}

export function ContextPanel() {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sources = useAtomValue(sourcesAtom)
  const skills = useAtomValue(skillsAtom)
  const { activeWorkspaceId, onOpenFile } = useAppShellContext()
  const { labels: labelConfigs } = useLabels(activeWorkspaceId)
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false)

  const meta = activeSessionId ? sessionMetaMap.get(activeSessionId) : undefined
  // Full session (messages included once loaded) — used for the attachment
  // list. Subscribing never forces a load: sessionAtomFamily only reflects
  // what ChatPage has already fetched.
  const activeSession = useAtomValue(sessionAtomFamily(activeSessionId ?? ''))
  const loadedSessions = useAtomValue(loadedSessionsAtom)
  const sessionLoaded = activeSessionId ? loadedSessions.has(activeSessionId) : false
  const previewEntries = useAtomValue(previewEntriesForSessionAtom)(activeSessionId ?? '')

  const attachmentNames = useMemo(() => {
    const seen = new Set<string>()
    const names: string[] = []
    for (const message of activeSession?.messages ?? []) {
      for (const attachment of message.attachments ?? []) {
        if (!seen.has(attachment.id)) {
          seen.add(attachment.id)
          names.push(attachment.name)
        }
      }
    }
    return names
  }, [activeSession])

  const recentFiles = useMemo(() => {
    return previewEntries.filter((entry): entry is Extract<typeof entry, { type: 'file' }> => entry.type === 'file')
  }, [previewEntries])

  const labelNames = useMemo(() => {
    if (!meta?.labels?.length) return []
    return meta.labels.map((id) => findLabelById(labelConfigs, id)?.name ?? id)
  }, [meta?.labels, labelConfigs])

  const navigateFromPanel = (route: ViewRoute) => {
    // Navigate the focused panel (same as clicking in the navigator would).
    navigate(route)
  }

  const visibleSources = sources
  const permissionMode = meta?.permissionMode
  const modeConfig = permissionMode && permissionMode in PERMISSION_MODE_CONFIG
    ? PERMISSION_MODE_CONFIG[permissionMode as keyof typeof PERMISSION_MODE_CONFIG]
    : undefined

  const tokens = meta?.tokenUsage

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title={t('contentPanel.title.context')}
        badge={activeSessionId ? (
          <BoundSessionBadge name={meta?.name} sessionId={activeSessionId} />
        ) : undefined}
      />

      {!activeSessionId || !meta ? (
        <PanelEmptyState
          title={t('contentPanel.context.noSessionContext')}
          hint={t('contentPanel.context.noSessionContextHint')}
          icon={<ListFilter className="h-6 w-6" />}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 pb-6">
          {/* Session + token stats (opencode-style grid, em dash for missing) */}
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label={t('contentPanel.context.name')} value={meta.name} />
            <Stat
              label={t('contentPanel.context.status')}
              value={meta.isProcessing ? t('contentPanel.context.status.processing') : meta.sessionStatus}
            />
            <Stat label={t('contentPanel.context.model')} value={meta.model} />
            <Stat
              label={t('contentPanel.context.permissionMode')}
              value={modeConfig?.displayName ?? meta.permissionMode}
            />
            <Stat label={t('contentPanel.context.workingDirectory')} value={meta.workingDirectory} span />
            {labelNames.length > 0 && (
              <div className="col-span-2 flex min-w-0 flex-col gap-1 rounded-lg border border-border/60 bg-foreground/[0.02] px-2 py-1.5">
                <span className="text-[11px] text-muted-foreground/70">{t('contentPanel.context.labels')}</span>
                <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {labelNames.map((name) => (
                    <span key={name} className="rounded-full border border-border/60 bg-foreground/[0.03] px-2 py-0.5 text-[11px] text-muted-foreground">
                      {name}
                    </span>
                  ))}
                </span>
              </div>
            )}
            <Stat
              label={t('contentPanel.context.messageCount')}
              value={meta.messageCount?.toLocaleString()}
            />
            <Stat
              label={t('contentPanel.context.createdAt')}
              value={meta.createdAt ? new Date(meta.createdAt).toLocaleString() : undefined}
            />
            <Stat
              label={t('contentPanel.context.lastActivity')}
              value={meta.lastMessageAt ? new Date(meta.lastMessageAt).toLocaleString() : undefined}
            />
            <Stat
              label={t('contentPanel.context.tokenTotal')}
              value={typeof tokens?.totalTokens === 'number' ? tokens.totalTokens.toLocaleString() : undefined}
            />
            <Stat
              label={t('contentPanel.context.contextTokens')}
              value={typeof tokens?.contextTokens === 'number' ? tokens.contextTokens.toLocaleString() : undefined}
            />
            <Stat
              label={t('contentPanel.context.tokenInput')}
              value={typeof tokens?.inputTokens === 'number' ? tokens.inputTokens.toLocaleString() : undefined}
            />
            <Stat
              label={t('contentPanel.context.tokenOutput')}
              value={typeof tokens?.outputTokens === 'number' ? tokens.outputTokens.toLocaleString() : undefined}
            />
            <Stat
              label={t('contentPanel.context.cost')}
              value={typeof tokens?.costUsd === 'number' ? `$${tokens.costUsd.toFixed(4)}` : undefined}
            />
          </div>

          {/* Attachments — aggregated from loaded messages (no forced load) */}
          {activeSessionId && sessionLoaded && (
            <section>
              <SectionTitle icon={<Paperclip className="h-3.5 w-3.5" />} label={t('contentPanel.context.attachmentsHeader')} />
              {attachmentNames.length === 0 ? (
                <p className="px-1 py-1 text-[13px] text-muted-foreground/70">{t('contentPanel.context.attachmentsEmpty')}</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {attachmentNames.map((name) => (
                    <li key={name} className="truncate rounded-lg px-2 py-1 text-[13px] text-foreground/90">
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Recently opened files — clickable, routes through the interceptor */}
          {activeSessionId && (
            <section>
              <SectionTitle icon={<History className="h-3.5 w-3.5" />} label={t('contentPanel.context.recentFilesHeader')} />
              {recentFiles.length === 0 ? (
                <p className="px-1 py-1 text-[13px] text-muted-foreground/70">{t('contentPanel.context.recentFilesEmpty')}</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {recentFiles.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        onClick={() => onOpenFile?.(entry.path)}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] text-foreground/90 transition-colors hover:bg-foreground/[0.03]"
                        title={entry.path}
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{fileBasename(entry.path)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Workspace resources — duplicated by the left sidebar, collapsed */}
          <section>
            <SectionTitle
              icon={<FolderKanban className="h-3.5 w-3.5" />}
              label={t('contentPanel.context.workspaceHeader')}
              collapsed={!workspaceExpanded}
              onToggle={() => setWorkspaceExpanded((prev) => !prev)}
            />
            {workspaceExpanded && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/50">
                    {t('contentPanel.context.sourcesHeader')}
                  </p>
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
                            <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            {source.config.connectionStatus && (
                              <span
                                title={t(`contentPanel.context.status.${source.config.connectionStatus}`)}
                                className={cn('h-2 w-2 shrink-0 rounded-full', CONNECTION_STATUS_DOT[source.config.connectionStatus])}
                              />
                            )}
                            <span className="min-w-0 flex-1 truncate">{source.config.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/50">
                    {t('contentPanel.context.skillsHeader')}
                  </p>
                  {skills.length === 0 ? (
                    <p className="px-1 py-1 text-[13px] text-muted-foreground/70">{t('contentPanel.context.skillsEmpty')}</p>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {skills.map((skill) => (
                        <li key={skill.slug}>
                          <button
                            type="button"
                            onClick={() => navigateFromPanel(routes.view.skills(skill.slug))}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-foreground/[0.03]"
                          >
                            <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">{skill.metadata.name ?? skill.slug}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
