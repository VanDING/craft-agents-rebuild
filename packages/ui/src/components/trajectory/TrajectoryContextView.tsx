import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, FileText, MessagesSquare, Paperclip, Sparkles, TerminalSquare, UserRound } from 'lucide-react'
import type { TrajectorySnapshot } from './trajectory-contract'
import { deriveRequestContexts, requestContextDelta, type TrajectoryContextCategory } from './trajectory-context'

interface TrajectoryContextViewProps {
  snapshot: TrajectorySnapshot
  focusedRequestSeq?: number
  onRequestFocus?: (requestSeq: number) => void
  onOpenChat?: (messageId: string) => void
  onOpenFile?: (path: string) => void
}

const CATEGORY_ICON = {
  system: Sparkles,
  user: UserRound,
  assistant: MessagesSquare,
  tools: TerminalSquare,
  attachments: Paperclip,
  injected: FileText,
} satisfies Record<TrajectoryContextCategory, typeof Sparkles>

const CATEGORY_TONE: Record<TrajectoryContextCategory, string> = {
  system: 'bg-violet-500',
  user: 'bg-sky-500',
  assistant: 'bg-emerald-500',
  tools: 'bg-amber-500',
  attachments: 'bg-cyan-500',
  injected: 'bg-slate-500',
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

export function TrajectoryContextView({ snapshot, focusedRequestSeq, onRequestFocus, onOpenChat, onOpenFile }: TrajectoryContextViewProps) {
  const { t } = useTranslation()
  const contexts = useMemo(() => deriveRequestContexts(snapshot), [snapshot])
  const [selectedSeq, setSelectedSeq] = useState<number | null>(() => focusedRequestSeq ?? contexts.at(-1)?.requestSeq ?? null)
  const [expanded, setExpanded] = useState<ReadonlySet<TrajectoryContextCategory>>(() => new Set(['system', 'user', 'tools']))
  const [requestMenuOpen, setRequestMenuOpen] = useState(false)
  const [requestFilter, setRequestFilter] = useState('')
  const requestMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focusedRequestSeq !== undefined && contexts.some(context => context.requestSeq === focusedRequestSeq)) {
      setSelectedSeq(focusedRequestSeq)
    }
  }, [contexts, focusedRequestSeq])

  useEffect(() => {
    if (!requestMenuOpen) return
    const close = (event: PointerEvent) => {
      if (!requestMenuRef.current?.contains(event.target as Node)) setRequestMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [requestMenuOpen])

  const selectedIndex = Math.max(0, contexts.findIndex(context => context.requestSeq === selectedSeq))
  const current = contexts[selectedIndex] ?? contexts.at(-1)
  const previous = current ? contexts.findLast(context => context.requestSeq < current.requestSeq) : undefined
  const delta = current ? requestContextDelta(current, previous) : undefined

  if (!current) {
    return <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-muted-foreground">{t('trajectory.context.empty')}</div>
  }

  const currentTotal = current.inputTokens ?? current.estimatedTokens
  const exactTotal = current.inputTokens !== undefined
  const maxRequestTokens = Math.max(1, ...contexts.map(context => context.inputTokens ?? context.estimatedTokens))
  const normalizedRequestFilter = requestFilter.trim().toLowerCase()
  const filteredContexts = contexts.filter(context =>
    String(context.requestSeq).includes(normalizedRequestFilter)
    || t('trajectory.context.request', { seq: context.requestSeq }).toLowerCase().includes(normalizedRequestFilter),
  )

  const selectRequest = (requestSeq: number) => {
    setSelectedSeq(requestSeq)
    onRequestFocus?.(requestSeq)
    setRequestMenuOpen(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-foreground/[0.012]">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border/50 bg-background/75 px-2.5">
        <button type="button" disabled={selectedIndex <= 0} onClick={() => selectRequest(contexts[selectedIndex - 1]!.requestSeq)} aria-label={t('trajectory.context.previousRequest')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.04] disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <div ref={requestMenuRef} className="relative">
          <button type="button" aria-haspopup="listbox" aria-expanded={requestMenuOpen} onClick={() => { setRequestFilter(''); setRequestMenuOpen(open => !open) }} className="flex h-7 min-w-36 items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-2.5 text-[12px] font-medium shadow-minimal outline-none hover:bg-foreground/[0.025] focus-visible:ring-2 focus-visible:ring-ring">
            <span>{t('trajectory.context.requestPosition', { seq: current.requestSeq, total: contexts.length })}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          {requestMenuOpen && (
            <div className="absolute left-0 top-9 z-30 w-72 overflow-hidden rounded-lg border border-border/60 bg-background shadow-modal-small">
              <div className="border-b border-border/50 p-2">
                <input autoFocus value={requestFilter} onChange={event => setRequestFilter(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setRequestMenuOpen(false) }} placeholder={t('trajectory.context.searchRequests')} className="h-7 w-full rounded-md bg-foreground/[0.035] px-2 text-[12px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
              </div>
              <div className="max-h-64 overflow-y-auto p-1" role="listbox">
                {filteredContexts.map((context) => {
                  const requestDelta = requestContextDelta(context, contexts.findLast(candidate => candidate.requestSeq < context.requestSeq))
                  return (
                    <button key={context.requestSeq} type="button" role="option" aria-selected={context.requestSeq === current.requestSeq} onClick={() => selectRequest(context.requestSeq)} className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-md px-2.5 py-2 text-left outline-none hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.04] ${context.requestSeq === current.requestSeq ? 'bg-accent/8' : ''}`}>
                      <span className="text-[12px] font-medium">{t('trajectory.context.request', { seq: context.requestSeq })}</span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">{formatNumber(context.inputTokens ?? context.estimatedTokens)}</span>
                      <span className="text-[11px] text-muted-foreground">{context.captured ? t('trajectory.context.captured') : t('trajectory.context.estimated')}</span>
                      <span className={`text-[11px] tabular-nums ${requestDelta && requestDelta > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>{requestDelta === undefined ? '—' : `${requestDelta > 0 ? '+' : ''}${formatNumber(requestDelta)}`}</span>
                    </button>
                  )
                })}
                {filteredContexts.length === 0 && <div className="px-3 py-5 text-center text-[12px] text-muted-foreground">{t('trajectory.context.noMatchingRequests')}</div>}
              </div>
            </div>
          )}
        </div>
        <button type="button" disabled={selectedIndex >= contexts.length - 1} onClick={() => selectRequest(contexts[selectedIndex + 1]!.requestSeq)} aria-label={t('trajectory.context.nextRequest')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.04] disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button type="button" disabled={selectedIndex === contexts.length - 1} onClick={() => selectRequest(contexts.at(-1)!.requestSeq)} className="h-7 shrink-0 rounded-md px-2 text-[11px] font-medium text-muted-foreground outline-none hover:bg-foreground/[0.04] disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-ring">{t('trajectory.context.latest')}</button>
        <div className="ml-auto hidden h-7 min-w-28 max-w-72 flex-1 items-end gap-px rounded-md bg-foreground/[0.025] px-1.5 py-1 @min-[620px]/trajectory:flex" aria-label={t('trajectory.context.requestTrend')}>
          {contexts.map(context => {
            const tokens = context.inputTokens ?? context.estimatedTokens
            return <button key={context.requestSeq} type="button" onClick={() => selectRequest(context.requestSeq)} title={`${t('trajectory.context.request', { seq: context.requestSeq })} · ${formatNumber(tokens)}`} className={`min-w-px flex-1 rounded-[1px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring ${context.requestSeq === current.requestSeq ? 'bg-accent' : 'bg-accent/30 hover:bg-accent/55'}`} style={{ height: `${Math.max(14, (tokens / maxRequestTokens) * 100)}%` }} />
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-8">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
          <header className="rounded-xl border border-border/55 bg-background/75 p-3 shadow-minimal">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-[13px] font-semibold">{t('trajectory.context.title', { seq: current.requestSeq })}</h2>
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${current.captured ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>
                    {current.captured ? t('trajectory.context.captured') : t('trajectory.context.estimated')}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{t('trajectory.context.subtitle')}</p>
              </div>
              <div className="text-right">
                <div className="text-[17px] font-semibold tabular-nums">{formatNumber(currentTotal)}</div>
                <div className="text-[10px] text-muted-foreground">{exactTotal ? t('trajectory.context.tokens') : t('trajectory.context.estimatedTokens')}</div>
              </div>
              {delta !== undefined && (
                <div className={`rounded-md px-2 py-1 text-[11px] font-medium tabular-nums ${delta > 0 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : delta < 0 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
                  {delta > 0 ? '+' : ''}{formatNumber(delta)} {t('trajectory.context.fromPrevious')}
                </div>
              )}
            </div>

            <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-muted/70" aria-label={t('trajectory.context.composition')}>
              {current.groups.map(group => (
                <span
                  key={group.category}
                  className={`${CATEGORY_TONE[group.category]} min-w-px opacity-80`}
                  style={{ width: `${Math.max(1, (group.estimatedTokens / Math.max(1, current.estimatedTokens)) * 100)}%` }}
                  title={`${t(`trajectory.context.category.${group.category}`)} · ${formatNumber(group.estimatedTokens)}`}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {current.groups.map(group => (
                <span key={group.category} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className={`h-1.5 w-1.5 rounded-full ${CATEGORY_TONE[group.category]}`} />
                  {t(`trajectory.context.category.${group.category}`)} {formatNumber(group.estimatedTokens)}
                </span>
              ))}
            </div>
          </header>

          <div className="overflow-hidden rounded-xl border border-border/55 bg-background/75 shadow-minimal">
            {current.groups.map(group => {
              const Icon = CATEGORY_ICON[group.category]
              const isExpanded = expanded.has(group.category)
              return (
                <section key={group.category} className="border-b border-border/45 last:border-b-0">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpanded(currentExpanded => {
                      const next = new Set(currentExpanded)
                      if (next.has(group.category)) next.delete(group.category)
                      else next.add(group.category)
                      return next
                    })}
                    className="grid min-h-11 w-full grid-cols-[18px_minmax(0,1fr)_auto_16px] items-center gap-2 px-3 text-left outline-none hover:bg-foreground/[0.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[12px] font-semibold">{t(`trajectory.context.category.${group.category}`)}</span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">{group.items.length} · ~{formatNumber(group.estimatedTokens)}</span>
                    <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>
                  {isExpanded && (
                    <div className="border-t border-border/40 bg-foreground/[0.012]">
                      {group.items.map(entry => (
                        <article key={entry.id} className="border-b border-border/35 px-3 py-2.5 last:border-b-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-[11px] font-medium">{entry.label}</span>
                            <span className="ml-auto shrink-0 text-[9px] tabular-nums text-muted-foreground">{formatNumber(entry.chars)} {t('trajectory.context.characters')}</span>
                            {entry.messageId && onOpenChat && (
                              <button type="button" onClick={() => onOpenChat(entry.messageId!)} className="shrink-0 text-[10px] font-medium text-accent hover:underline">{t('trajectory.context.openChat')}</button>
                            )}
                            {entry.filePath && onOpenFile && (
                              <button type="button" onClick={() => onOpenFile(entry.filePath!)} className="shrink-0 text-[10px] font-medium text-accent hover:underline">{t('trajectory.context.openFile')}</button>
                            )}
                          </div>
                          {entry.content ? <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-foreground/[0.025] px-2 py-1.5 text-[10px] leading-4 text-muted-foreground">{entry.content}</pre> : null}
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
          <p className="px-1 text-[10px] leading-4 text-muted-foreground">{t(current.captured ? 'trajectory.context.capturedNote' : 'trajectory.context.estimateNote')}</p>
        </div>
      </div>
    </div>
  )
}
