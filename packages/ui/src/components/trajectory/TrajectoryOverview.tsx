import { Activity, AlertTriangle, Braces, Clock3, Coins, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TrajectorySnapshot } from './trajectory-contract'
import type { TrajectoryContextSummary } from './TrajectoryView'
import { formatDurationMillis, type TrajectoryRenderRecord, type TrajectoryTurnModel } from './trajectory-layout'
import { recordDisplayText } from './trajectory-search-index'
import { deriveRequestContexts } from './trajectory-context'

interface TrajectoryOverviewProps {
  snapshot: TrajectorySnapshot
  turns: readonly TrajectoryTurnModel[]
  records: readonly TrajectoryRenderRecord[]
  isProcessing?: boolean
  contextSummary?: TrajectoryContextSummary
  onOpenEvents: (index?: number) => void
  onOpenTimeline: () => void
  onOpenContext: (requestSeq?: number) => void
}

function formatTokens(value: number | undefined): string {
  if (value === undefined) return '—'
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

function formatCost(value: number | undefined): string {
  if (value === undefined) return '—'
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`
}

export function TrajectoryOverview({
  snapshot,
  turns,
  records,
  isProcessing,
  contextSummary,
  onOpenEvents,
  onOpenTimeline,
  onOpenContext,
}: TrajectoryOverviewProps) {
  const { t } = useTranslation()
  const contentRecords = records.filter(record => record.collapsedSummary === undefined)
  const errorRecords = contentRecords.filter(record => record.cell.isError)
  const toolRecords = contentRecords.filter(record => record.cell.kind === 'tool' || record.cell.kind === 'subtool')
  const failedToolRecords = toolRecords.filter(record => record.cell.isError)
  const promptChanges = [...snapshot.prompts.values()].reduce((count, prompt, index, prompts) => (
    index > 0 && prompt !== prompts[index - 1] ? count + 1 : count
  ), 0)
  const compactions = contentRecords.filter(record => record.cell.kind === 'compacted').length
  const slowestTool = toolRecords.reduce<TrajectoryRenderRecord | null>((slowest, record) => {
    if (record.cell.timeSeconds === null) return slowest
    if (slowest?.cell.timeSeconds === null || slowest === null) return record
    return record.cell.timeSeconds > slowest.cell.timeSeconds ? record : slowest
  }, null)
  const firstAssistant = contentRecords.find(record => record.cell.kind === 'message' && record.cell.assistantMetrics)
  const firstMetrics = firstAssistant?.cell.assistantMetrics
  const ttftMs = firstMetrics?.stepStartTime != null && firstMetrics.firstTokenTime != null
    ? firstMetrics.firstTokenTime - firstMetrics.stepStartTime
    : null
  const durationMs = snapshot.timeRange
    ? Math.max(0, snapshot.timeRange.end - snapshot.timeRange.start)
    : null
  const requestContexts = deriveRequestContexts(snapshot)
  const maxContextTokens = Math.max(1, ...requestContexts.map(context => context.inputTokens ?? context.estimatedTokens))
  const latestUserGoal = [...snapshot.messages].reverse().find(message => message.role === 'user' && message.content.trim())?.content.replace(/\s+/g, ' ').trim()
  const toolNames = [...new Set(toolRecords.map(record => record.cell.sourceMessage?.toolDisplayName ?? record.cell.sourceMessage?.toolName).filter(Boolean))] as string[]

  const findings = [
    ...errorRecords.slice(0, 3).map(record => ({
      icon: AlertTriangle,
      tone: 'text-destructive',
      label: recordDisplayText(record.cell),
      meta: record.cell.timeSeconds === null ? '—' : formatDurationMillis(record.cell.timeSeconds * 1000),
      index: record.cell.index,
    })),
    ...(slowestTool && !errorRecords.includes(slowestTool) ? [{
      icon: Clock3,
      tone: 'text-amber-600 dark:text-amber-400',
      label: t('trajectory.overview.slowestTool', { name: recordDisplayText(slowestTool.cell) }),
      meta: slowestTool.cell.timeSeconds === null ? '—' : formatDurationMillis(slowestTool.cell.timeSeconds * 1000),
      index: slowestTool.cell.index,
    }] : []),
  ]

  return (
    <div className="h-full overflow-y-auto bg-foreground/[0.012] px-3 py-3 pb-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex min-w-0 items-center gap-2 border-b border-border/50 pb-3">
          <span className={`h-2 w-2 shrink-0 rounded-full ${isProcessing ? 'animate-pulse bg-accent' : errorRecords.length > 0 ? 'bg-destructive' : 'bg-emerald-500'}`} />
          <span className="text-[13px] font-semibold">
            {isProcessing
              ? t('trajectory.overview.processing')
              : errorRecords.length > 0
                ? t('trajectory.overview.completedWithIssues')
                : t('trajectory.overview.completed')}
          </span>
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
            {t('trajectory.overview.turnsEvents', { turns: turns.filter(turn => turn.turn !== null).length, events: contentRecords.length })}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 @min-[760px]/trajectory:grid-cols-4">
          {[
            [Activity, t('trajectory.overview.duration'), formatDurationMillis(durationMs)],
            [Clock3, t('trajectory.overview.ttft'), formatDurationMillis(ttftMs)],
            [Coins, t('trajectory.overview.tokens'), formatTokens(snapshot.totalUsage?.totalTokens)],
            [Wrench, t('trajectory.overview.toolCalls'), `${toolRecords.length}${failedToolRecords.length ? ` · ${t('trajectory.overview.failedCount', { count: failedToolRecords.length })}` : ''}`],
          ].map(([Icon, label, value]) => {
            const StatIcon = Icon as typeof Activity
            return (
              <div key={String(label)} className="min-w-0 rounded-xl border border-border/55 bg-background/70 px-3 py-2.5 shadow-minimal">
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/65">
                  <StatIcon className="h-3.5 w-3.5" />{String(label)}
                </div>
                <div className="mt-1 truncate text-[16px] font-semibold tabular-nums">{String(value)}</div>
              </div>
            )
          })}
        </div>

        {contextSummary && (
          <section>
            <h3 className="mb-2 text-[12px] font-semibold">{t('trajectory.overview.environment')}</h3>
            <div className="grid gap-x-5 gap-y-2 border-y border-border/50 py-3 text-[12px] @min-[620px]/trajectory:grid-cols-2">
              {[
                [t('trajectory.overview.model'), contextSummary.model],
                [t('contentPanel.context.name'), contextSummary.name],
                [t('contentPanel.context.status'), contextSummary.status],
                [t('trajectory.overview.permissionMode'), contextSummary.permissionMode],
                [t('trajectory.overview.workingDirectory'), contextSummary.workingDirectory],
                [t('contentPanel.context.labels'), contextSummary.labels?.join(', ')],
                [t('contentPanel.context.messageCount'), contextSummary.messageCount?.toLocaleString()],
                [t('contentPanel.context.createdAt'), contextSummary.createdAt ? new Date(contextSummary.createdAt).toLocaleString() : undefined],
                [t('contentPanel.context.lastActivity'), contextSummary.lastActivityAt ? new Date(contextSummary.lastActivityAt).toLocaleString() : undefined],
                [t('contentPanel.context.tokenInput'), contextSummary.inputTokens?.toLocaleString()],
                [t('contentPanel.context.tokenOutput'), contextSummary.outputTokens?.toLocaleString()],
                [t('contentPanel.context.tokenTotal'), contextSummary.totalTokens?.toLocaleString()],
                [t('trajectory.overview.contextTokens'), contextSummary.contextTokens?.toLocaleString()],
                [t('contentPanel.context.cost'), contextSummary.costUsd === undefined ? undefined : formatCost(contextSummary.costUsd)],
              ].map(([label, value]) => (
                <div key={label} className="flex min-w-0 items-center gap-3">
                  <span className="shrink-0 text-muted-foreground">{label}</span>
                  <span className="ml-auto min-w-0 truncate text-right font-medium" title={value}>{value ?? '—'}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-[12px] font-semibold">{t('trajectory.overview.runShape')}</h3>
            <button type="button" className="ml-auto text-[11px] font-medium text-accent hover:underline" onClick={onOpenTimeline}>
              {t('trajectory.overview.openTimeline')}
            </button>
          </div>
          <button
            type="button"
            onClick={onOpenTimeline}
            className="flex h-12 w-full items-center gap-1 rounded-xl border border-border/55 bg-background/70 px-3 outline-none transition-colors hover:bg-foreground/[0.025] focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('trajectory.overview.openTimeline')}
          >
            {contentRecords.slice(0, 18).map((record, index) => (
              <span
                key={`${record.cell.index}-${index}`}
                className={`h-2 min-w-1 flex-1 rounded-sm ${record.cell.isError ? 'bg-destructive' : record.cell.kind === 'tool' || record.cell.kind === 'subtool' ? 'bg-amber-500/75' : 'bg-accent/65'}`}
              />
            ))}
          </button>
        </section>

        {requestContexts.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-[12px] font-semibold">{t('trajectory.overview.contextGrowth')}</h3>
              <span className="text-[10px] text-muted-foreground">{t('trajectory.overview.contextGrowthHint')}</span>
              <button type="button" className="ml-auto text-[11px] font-medium text-accent hover:underline" onClick={() => onOpenContext()}>
                {t('trajectory.overview.openContext')}
              </button>
            </div>
            <div className="flex h-28 items-end gap-1.5 rounded-xl border border-border/55 bg-background/70 px-3 pb-3 pt-5 shadow-minimal">
              {requestContexts.map(context => {
                const value = context.inputTokens ?? context.estimatedTokens
                return (
                  <button
                    key={context.requestSeq}
                    type="button"
                    onClick={() => onOpenContext(context.requestSeq)}
                    className="group flex h-full min-w-3 flex-1 flex-col items-center justify-end gap-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={t('trajectory.overview.contextRequestTitle', { seq: context.requestSeq, tokens: value })}
                  >
                    <span className="text-[8px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">{formatTokens(value)}</span>
                    <span className="w-full max-w-8 rounded-t-sm bg-accent/65 transition-colors group-hover:bg-accent" style={{ height: `${Math.max(4, (value / maxContextTokens) * 70)}%` }} />
                    <span className="text-[8px] tabular-nums text-muted-foreground">{context.requestSeq}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-[12px] font-semibold">{t('trajectory.overview.runBrief')}</h3>
          <div className="grid gap-2 @min-[620px]/trajectory:grid-cols-3">
            {[
              [t('trajectory.overview.goal'), latestUserGoal || t('trajectory.overview.notRecorded')],
              [t('trajectory.overview.workPerformed'), toolNames.length ? toolNames.slice(0, 5).join(', ') : t('trajectory.overview.noTools')],
              [t('trajectory.overview.outcome'), errorRecords.length ? t('trajectory.overview.issueSummary', { count: errorRecords.length }) : t('trajectory.overview.noIssues')],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-xl border border-border/55 bg-background/70 px-3 py-2.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">{label}</div>
                <div className="mt-1 line-clamp-3 text-[11px] leading-4">{value}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-[12px] font-semibold">{t('trajectory.overview.needsAttention')}</h3>
            <button type="button" className="ml-auto text-[11px] font-medium text-accent hover:underline" onClick={() => onOpenEvents()}>
              {t('trajectory.overview.viewAllEvents')}
            </button>
          </div>
          <div className="overflow-hidden rounded-xl border border-border/55 bg-background/70">
            {findings.length > 0 ? findings.map(({ icon: Icon, tone, label, meta, index }) => (
              <button
                key={`${index}-${label}`}
                type="button"
                onClick={() => onOpenEvents(index)}
                className="grid min-h-10 w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/45 px-3 text-left text-[12px] outline-none last:border-b-0 hover:bg-foreground/[0.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <Icon className={`h-3.5 w-3.5 ${tone}`} />
                <span className="truncate">{label}</span>
                <span className="tabular-nums text-muted-foreground">{meta}</span>
              </button>
            )) : (
              <div className="px-3 py-5 text-center text-[12px] text-muted-foreground">{t('trajectory.overview.noIssues')}</div>
            )}
          </div>
        </section>

        <div className="grid gap-2 @min-[620px]/trajectory:grid-cols-2">
          <button type="button" onClick={() => onOpenContext()} className="flex items-center gap-3 rounded-xl border border-border/55 bg-background/70 px-3 py-3 text-left outline-none hover:bg-foreground/[0.025] focus-visible:ring-2 focus-visible:ring-ring">
            <Braces className="h-4 w-4 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold">{t('trajectory.overview.promptChanges')}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{t('trajectory.overview.promptChangesMeta', { requests: snapshot.prompts.size, changes: promptChanges })}</span>
            </span>
          </button>
          <div className="flex items-center gap-3 rounded-xl border border-border/55 bg-background/70 px-3 py-3">
            <Coins className="h-4 w-4 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold">{t('trajectory.overview.costAndCompaction')}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{formatCost(snapshot.totalUsage?.cost.total)} · {t('trajectory.overview.compactions', { count: compactions })}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
