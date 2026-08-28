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
import { FolderKanban, Layers, ListFilter, Paperclip, History, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PanelHeader } from '../app-shell/PanelHeader'
import { PanelEmptyState } from './PanelEmptyState'
import { BoundSessionBadge } from './BoundSessionBadge'
import { PanelRow, PanelSection } from './PanelSection'
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
      'flex min-w-0 flex-col gap-1 rounded-lg bg-foreground/[0.025] px-2.5 py-2 ring-1 ring-inset ring-border/35',
      span && 'col-span-2',
    )}>
      <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground/60">{label}</span>
      <span
        className="min-w-0 truncate text-[13px] font-semibold text-foreground/85"
        title={typeof value === 'string' ? value : undefined}
      >
        {value ?? '—'}
      </span>
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
        <div className="min-h-0 flex-1 overflow-y-auto bg-foreground/[0.012] px-2.5 py-2.5 pb-6">
          {/* Session + token stats (opencode-style grid, em dash for missing) */}
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-border/60 bg-background/55 p-2 shadow-minimal">
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
              <div className="col-span-2 flex min-w-0 flex-col gap-1.5 rounded-lg bg-foreground/[0.025] px-2.5 py-2 ring-1 ring-inset ring-border/35">
                <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground/60">{t('contentPanel.context.labels')}</span>
                <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {labelNames.map((name) => (
                    <span key={name} className="rounded-full border border-border/55 bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground">
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
            <PanelSection
              className="mt-2"
              icon={<Paperclip className="h-3.5 w-3.5" />}
              title={t('contentPanel.context.attachmentsHeader')}
              meta={attachmentNames.length}
            >
              {attachmentNames.length === 0 ? (
                <p className="px-2 py-1 text-xs text-muted-foreground/65">{t('contentPanel.context.attachmentsEmpty')}</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {attachmentNames.map((name) => (
                    <li key={name}><PanelRow icon={<Paperclip className="h-3.5 w-3.5" />} title={name} titleAttribute={name} /></li>
                  ))}
                </ul>
              )}
            </PanelSection>
          )}

          {/* Recently opened files — clickable, routes through the interceptor */}
          {activeSessionId && (
            <PanelSection
              className="mt-2"
              icon={<History className="h-3.5 w-3.5" />}
              title={t('contentPanel.context.recentFilesHeader')}
              meta={recentFiles.length}
            >
              {recentFiles.length === 0 ? (
                <p className="px-2 py-1 text-xs text-muted-foreground/65">{t('contentPanel.context.recentFilesEmpty')}</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {recentFiles.map((entry) => (
                    <li key={entry.path}>
                      <PanelRow
                        icon={<FileText className="h-3.5 w-3.5" />}
                        title={fileBasename(entry.path)}
                        titleAttribute={entry.path}
                        onClick={() => onOpenFile?.(entry.path)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </PanelSection>
          )}

          {/* Workspace resources — duplicated by the left sidebar, collapsed */}
          <PanelSection
              className="mt-2"
              icon={<FolderKanban className="h-3.5 w-3.5" />}
              title={t('contentPanel.context.workspaceHeader')}
              meta={visibleSources.length + skills.length}
              collapsible
              expanded={workspaceExpanded}
              onExpandedChange={setWorkspaceExpanded}
            >
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
                          <PanelRow
                            icon={<FolderKanban className="h-3.5 w-3.5" />}
                            title={source.config.name}
                            onClick={() => navigateFromPanel(routes.view.sources({ sourceSlug: source.config.slug }))}
                            trailing={source.config.connectionStatus && (
                              <span
                                title={t(`contentPanel.context.status.${source.config.connectionStatus}`)}
                                className={cn('h-2 w-2 shrink-0 rounded-full', CONNECTION_STATUS_DOT[source.config.connectionStatus])}
                              />
                            )}
                          />
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
                          <PanelRow
                            icon={<Layers className="h-3.5 w-3.5" />}
                            title={skill.metadata.name ?? skill.slug}
                            onClick={() => navigateFromPanel(routes.view.skills(skill.slug))}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
          </PanelSection>
        </div>
      )}
    </div>
  )
}
