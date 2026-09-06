/**
 * RecordInspector — type-aware details panel for a selected trajectory
 * record. Tab sets follow the VanDSH detail tabs mapped to Craft data:
 * - system → System prompt / Diff
 * - compacted → Summary / Raw Output
 * - markdown-bearing → Summary / Preview / Raw (+ Source when available)
 * - other → Summary / Payload / Result / Schema / Timing
 * Assistant records additionally get Usage and TTFT timing.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { FolderOpen, GitCompareArrows, MessageSquare, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { Markdown } from '../markdown'
import type { AssistantMetricDetail, TrajectoryCellProps, TrajectorySourceBlock } from './trajectory-layout'
import { formatDurationMillis } from './trajectory-layout'
import { motionSpring } from '../../lib/motion'

export interface RecordInspectorProps {
  cell: TrajectoryCellProps
  /** Previous request's prompt (for the diff tab). */
  previousPrompt?: string
  /** Session total usage (for the usage tab's cumulative section). */
  sessionTotal?: { input: number; output: number; totalTokens: number }
  onOpenChat?: (messageId: string) => void
  onOpenReview?: (changeId: string) => void
  onOpenFile?: (path: string) => void
  onClose: () => void
}

type DetailTab =
  | 'overview'
  | 'input'
  | 'output'
  | 'usage'
  | 'timing'
  | 'schema'
  | 'system-prompt'
  | 'source'
  | 'raw'
  | 'diff'
  | 'rendered'

interface TabItem {
  id: DetailTab
  label: string
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
      {label}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-3 py-2">
      <h4 className="mb-1 text-[11px] font-medium text-muted-foreground">
        {title}
      </h4>
      <div className="text-[12px] leading-5">{children}</div>
    </section>
  )
}

function KeyValue({ k, v }: { k: string; v: string | number | undefined | null }) {
  if (v === undefined || v === null || v === '') return null
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 truncate text-right tabular-nums">{v}</span>
    </div>
  )
}

function formatMs(ms: number | null): string {
  return formatDurationMillis(ms)
}

function SourceBlocksView({ blocks }: { blocks: readonly TrajectorySourceBlock[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => (
        <div key={i} className="rounded border border-border/60 bg-foreground/[0.02] px-2 py-1.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{block.type}</div>
          {block.imageSrc !== undefined ? (
            <img src={block.imageSrc} alt={block.imageAlt ?? 'image'} className="mt-1 max-h-40 rounded" />
          ) : null}
          {block.content !== undefined && block.content !== '' ? (
            <div className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[12px]">{block.content}</div>
          ) : null}
          {block.callId !== undefined ? (
            <div className="mt-1 text-[11px] text-muted-foreground">{block.toolName ?? 'call'} {block.callId}</div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

// ============================================================
// TTFT / decoding / throughput (DSH AssistantTimingPanel)
// ============================================================

function totalTime(metrics: AssistantMetricDetail): string {
  const start = metrics.stepStartTime
  const completed = metrics.completedTime
  if (typeof start !== 'number' || typeof completed !== 'number') return '—'
  return formatMs(completed - start)
}

function ttft(metrics: AssistantMetricDetail): string {
  const start = metrics.stepStartTime
  const first = metrics.firstTokenTime
  if (typeof start !== 'number' || typeof first !== 'number') return '—'
  return formatMs(first - start)
}

function generationTime(metrics: AssistantMetricDetail): string {
  const first = metrics.firstTokenTime
  const completed = metrics.completedTime
  if (typeof first !== 'number' || typeof completed !== 'number') return '—'
  return formatMs(completed - first)
}

function throughput(metrics: AssistantMetricDetail): string {
  const tokens = metrics.outputTokens
  const first = metrics.firstTokenTime
  const completed = metrics.completedTime
  if (typeof tokens !== 'number' || typeof first !== 'number' || typeof completed !== 'number') return '—'
  const seconds = (completed - first) / 1000
  if (seconds <= 0) return '—'
  return `${(tokens / seconds).toFixed(1)} tok/s`
}

function AssistantTimingPanel({ metrics }: { metrics: AssistantMetricDetail }) {
  const items: Array<[string, string]> = [
    ['Total', totalTime(metrics)],
    ['TTFT', ttft(metrics)],
    ['Generation', generationTime(metrics)],
    ['Throughput', throughput(metrics)],
  ]
  return (
    <Section title="Timing">
      {metrics.timingRecorded
        ? items.map(([k, v]) => <KeyValue key={k} k={k} v={v} />)
        : <p className="text-muted-foreground">No wall-clock timing recorded for this record (historical session).</p>}
      {metrics.stepStartTime !== null && metrics.completedTime !== null ? (
        <div className="mt-1 border-t border-border/50 pt-1">
          <KeyValue k="Started" v={new Date(metrics.stepStartTime).toLocaleTimeString()} />
          <KeyValue k="Completed" v={new Date(metrics.completedTime).toLocaleTimeString()} />
        </div>
      ) : null}
    </Section>
  )
}

// ============================================================
// Record-type-aware tab sets (DSH detailTabs)
// ============================================================

function detailTabs(cell: TrajectoryCellProps): readonly TabItem[] {
  if (cell.kind === 'system') {
    return [
      { id: 'system-prompt', label: 'System prompt' },
      { id: 'diff', label: 'Diff' },
    ]
  }
  if (cell.kind === 'compacted') {
    return [
      { id: 'overview', label: 'Summary' },
      { id: 'raw', label: 'Raw Output' },
    ]
  }
  if (cell.kind === 'user' || cell.kind === 'message') {
    return [
      { id: 'overview', label: 'Summary' },
      ...(cell.kind === 'message' ? [{ id: 'usage', label: 'Usage' } as const] : []),
      ...(cell.kind === 'message' ? [{ id: 'timing', label: 'Timing' } as const] : []),
      { id: 'rendered', label: 'Preview' },
      { id: 'raw', label: 'Raw' },
      { id: 'diff', label: 'Diff' },
    ]
  }
  return [
    { id: 'overview', label: 'Summary' },
    ...(cell.inputDetail ? [{ id: 'input', label: 'Payload' } as const] : []),
    ...(cell.outputDetail ? [{ id: 'output', label: 'Result' } as const] : []),
    { id: 'schema', label: 'Schema' },
    { id: 'timing', label: 'Timing' },
  ]
}

const DETAILS_MIN_WIDTH = 320
const DETAILS_MAX_WIDTH = 720
const DETAILS_RESIZE_STEP = 16

function clampDetailsWidth(width: number): number {
  return Math.min(DETAILS_MAX_WIDTH, Math.max(DETAILS_MIN_WIDTH, width))
}

function recordFilePath(cell: TrajectoryCellProps): string | undefined {
  const input = cell.sourceMessage?.toolInput
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const record = input as Record<string, unknown>
  const path = record.path ?? record.file_path
  if (typeof path === 'string') return path
  const firstChange = Array.isArray(record.changes) ? record.changes[0] : undefined
  if (firstChange && typeof firstChange === 'object') {
    const changedPath = (firstChange as { path?: unknown }).path
    if (typeof changedPath === 'string') return changedPath
  }
  return undefined
}

export function RecordInspector({ cell, previousPrompt, sessionTotal, onOpenChat, onOpenReview, onOpenFile, onClose }: RecordInspectorProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<DetailTab>('overview')
  const [detailsWidth, setDetailsWidth] = useState<number | null>(null)
  const resizeDrag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const tabs = useMemo(() => detailTabs(cell), [cell])
  const reduceMotion = useReducedMotion()
  const markdownSource = cell.kind === 'message' ? cell.outputDetail ?? cell.thinkingDetail : undefined
  const sourceMessageId = cell.sourceMessage?.id ?? cell.sourceSeq
  const filePath = recordFilePath(cell)

  useEffect(() => {
    if (!tabs.some(({ id }) => id === tab)) setTab(tabs[0]?.id ?? 'overview')
  }, [cell.index, tab, tabs])

  return (
    <aside
      className="motion-view-enter relative flex h-full w-80 min-w-[300px] max-w-[70%] shrink-0 flex-col border-l border-border/60 bg-background @max-[760px]/trajectory:absolute @max-[760px]/trajectory:inset-0 @max-[760px]/trajectory:z-20 @max-[760px]/trajectory:!w-full @max-[760px]/trajectory:min-w-0 @max-[760px]/trajectory:max-w-none @max-[760px]/trajectory:border-l-0"
      aria-label="Event details"
      style={detailsWidth === null ? undefined : { width: detailsWidth }}
    >
      <div
        className="group absolute -left-1 top-0 bottom-0 z-10 w-2 cursor-col-resize"
        role="separator"
        aria-label="Resize event details"
        aria-orientation="vertical"
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        onDoubleClick={() => setDetailsWidth(null)}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          resizeDrag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: detailsWidth ?? 320,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
          event.preventDefault()
        }}
        onPointerMove={(event) => {
          const drag = resizeDrag.current
          if (drag === null || drag.pointerId !== event.pointerId) return
          setDetailsWidth(clampDetailsWidth(drag.startWidth + drag.startX - event.clientX))
        }}
        onPointerUp={(event) => {
          if (resizeDrag.current?.pointerId !== event.pointerId) return
          resizeDrag.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => { resizeDrag.current = null }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          const direction = event.key === 'ArrowLeft' ? 1 : -1
          setDetailsWidth(clampDetailsWidth((detailsWidth ?? 320) + direction * DETAILS_RESIZE_STEP))
          event.preventDefault()
        }}
      />
      <div className="flex min-h-12 items-center justify-between border-b border-border/50 bg-foreground/[0.018] px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold">#{cell.index} {cell.kind}</div>
          <div className="truncate text-[11px] text-muted-foreground">{cell.text}</div>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-0.5">
          {onOpenChat && sourceMessageId && (
            <button type="button" aria-label={t('trajectory.inspector.openChat')} title={t('trajectory.inspector.openChat')} className="rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenChat(sourceMessageId)}>
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
          )}
          {onOpenReview && cell.callId && (
            <button type="button" aria-label={t('trajectory.inspector.openReview')} title={t('trajectory.inspector.openReview')} className="rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenReview(cell.callId!)}>
              <GitCompareArrows className="h-3.5 w-3.5" />
            </button>
          )}
          {onOpenFile && filePath && (
            <button type="button" aria-label={t('trajectory.inspector.openFile')} title={t('trajectory.inspector.openFile')} className="rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenFile(filePath)}>
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          )}
          <button type="button" aria-label={t('trajectory.inspector.close')} className="rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <LayoutGroup id="trajectory-inspector-tabs">
      <div className="flex gap-1 overflow-x-auto border-b border-border/50 bg-background/80 px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Event details">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cn(
              'relative isolate shrink-0 rounded-md px-2 py-1 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              tab === id ? 'text-foreground' : 'text-muted-foreground hover:bg-accent/40',
            )}
            onClick={() => setTab(id)}
          >
            {tab === id && (
              <motion.span
                layoutId="trajectory-inspector-active-tab"
                className="absolute inset-0 -z-10 rounded-md border border-border/55 bg-background shadow-minimal"
                transition={motionSpring(reduceMotion, 'responsive')}
              />
            )}
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>
      </LayoutGroup>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <>
            <Section title="Summary">
              <p className="whitespace-pre-wrap">{cell.text || '—'}</p>
            </Section>
            {cell.isError ? (
              <Section title="Error">
                <p className="text-rose-500">{cell.result}</p>
              </Section>
            ) : cell.result ? (
              <Section title="Result">
                <p className="whitespace-pre-wrap">{cell.result}</p>
              </Section>
            ) : null}
            {cell.assistantMetrics !== undefined && cell.kind === 'message' ? (
              <AssistantTimingPanel metrics={cell.assistantMetrics} />
            ) : null}
          </>
        )}
        {tab === 'usage' && cell.kind === 'message' && (
          <Section title="Usage">
            <KeyValue k="Input" v={cell.input} />
            <KeyValue k="Cache read" v={cell.cacheRead} />
            <KeyValue k="Cache write" v={cell.cacheWrite} />
            <KeyValue k="Output" v={cell.output} />
            <KeyValue k="Thinking" v={cell.think} />
            {sessionTotal !== undefined ? (
              <div className="mt-1 border-t border-border/50 pt-1">
                <KeyValue k="Session input" v={sessionTotal.input} />
                <KeyValue k="Session output" v={sessionTotal.output} />
                <KeyValue k="Session total" v={sessionTotal.totalTokens} />
              </div>
            ) : null}
          </Section>
        )}
        {tab === 'timing' && cell.assistantMetrics !== undefined && cell.kind === 'message' ? (
          <AssistantTimingPanel metrics={cell.assistantMetrics} />
        ) : tab === 'timing' ? (
          <EmptyHint label="No timing data for this record." />
        ) : null}
        {tab === 'input' && (
          cell.inputDetail
            ? <Section title="Payload"><pre className="whitespace-pre-wrap text-[11px]">{cell.inputDetail}</pre></Section>
            : <EmptyHint label="No payload." />
        )}
        {tab === 'output' && (
          cell.outputDetail
            ? <Section title="Result"><pre className="whitespace-pre-wrap text-[11px]">{cell.outputDetail}</pre></Section>
            : <EmptyHint label="No result." />
        )}
        {tab === 'schema' && (
          cell.schemaDetail
            ? <Section title="Schema"><pre className="whitespace-pre-wrap text-[11px]">{cell.schemaDetail}</pre></Section>
            : <EmptyHint label="No schema captured." />
        )}
        {tab === 'system-prompt' && (
          cell.inputDetail
            ? <Section title="System prompt"><pre className="whitespace-pre-wrap text-[11px]">{cell.inputDetail}</pre></Section>
            : <EmptyHint label="No prompt snapshot." />
        )}
        {tab === 'source' && (
          cell.outputBlocks !== undefined
            ? <Section title="Source blocks"><SourceBlocksView blocks={cell.outputBlocks} /></Section>
            : <EmptyHint label="No source blocks." />
        )}
        {tab === 'raw' && (
          cell.sourceMessage !== undefined
            ? <Section title="Raw"><pre className="whitespace-pre-wrap text-[11px]">{JSON.stringify(cell.sourceMessage, null, 2)}</pre></Section>
            : <EmptyHint label="No raw message." />
        )}
        {tab === 'rendered' && (
          markdownSource !== undefined
            ? <Section title="Preview"><Markdown>{markdownSource}</Markdown></Section>
            : <EmptyHint label="Nothing to render." />
        )}
        {tab === 'diff' && (
          <Section title="Prompt diff">
            {previousPrompt !== undefined && cell.inputDetail !== undefined
              ? (
                <pre className="whitespace-pre-wrap text-[11px]">
                  {previousPrompt === cell.inputDetail
                    ? 'Prompt unchanged'
                    : `— previous (${previousPrompt.length} chars)\n${previousPrompt}\n\n+ current (${cell.inputDetail.length} chars)\n${cell.inputDetail}`}
                </pre>
              )
              : <EmptyHint label="No previous prompt snapshot." />}
          </Section>
        )}
      </div>
    </aside>
  )
}
