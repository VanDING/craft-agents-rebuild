/**
 * RecordInspector — details panel for a selected trajectory record.
 *
 * Tab set (DSH-aligned, mapped to Craft data availability):
 * overview / input / output / usage / timing / schema / system-prompt /
 * source / raw / tools / options / diff / rendered.
 * Tabs without a data source for the selected record render an empty hint
 * rather than being hidden, preserving the original surface.
 */

import { useMemo, useState } from 'react'
import { cn } from '../../lib/utils'
import { Markdown } from '../markdown'
import type { TrajectoryCellProps, TrajectorySourceBlock, AssistantMetricDetail } from './trajectory-layout'

export interface RecordInspectorProps {
  cell: TrajectoryCellProps
  /** Previous request's prompt (for the diff tab). */
  previousPrompt?: string
  /** Session total usage (for the usage tab's cumulative section). */
  sessionTotal?: { input: number; output: number; cacheRead: number; cacheWrite: number }
  onClose?: () => void
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
  | 'tools'
  | 'options'
  | 'diff'
  | 'rendered'

const TABS: readonly { id: DetailTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'input', label: 'Input' },
  { id: 'output', label: 'Output' },
  { id: 'usage', label: 'Usage' },
  { id: 'timing', label: 'Timing' },
  { id: 'schema', label: 'Schema' },
  { id: 'system-prompt', label: 'System prompt' },
  { id: 'source', label: 'Source' },
  { id: 'raw', label: 'Raw' },
  { id: 'tools', label: 'Tools' },
  { id: 'options', label: 'Options' },
  { id: 'diff', label: 'Diff' },
  { id: 'rendered', label: 'Rendered' },
]

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="px-3 py-6 text-center text-xs text-muted-foreground/50">
      No {label} available for this record.
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">{title}</div>
      {children}
    </div>
  )
}

function KeyValue({ k, v }: { k: string; v: string | number | undefined | null }) {
  if (v === undefined || v === null || v === '') return null
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-muted-foreground/70">{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  )
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function SourceBlocksView({ blocks }: { blocks: readonly TrajectorySourceBlock[] }) {
  if (blocks.length === 0) return <EmptyHint label="source blocks" />
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => (
        <div key={i} className="rounded border p-2 text-xs">
          <div className="mb-1 text-[10px] uppercase text-muted-foreground/50">{block.type}</div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{block.content}</pre>
        </div>
      ))}
    </div>
  )
}

export function RecordInspector({ cell, previousPrompt, sessionTotal, onClose }: RecordInspectorProps) {
  const [tab, setTab] = useState<DetailTab>('overview')
  const sourceMessage = cell.sourceMessage
  const metrics: AssistantMetricDetail | undefined = cell.assistantMetrics

  const sourceBlocks = useMemo<readonly TrajectorySourceBlock[]>(() => {
    const blocks: TrajectorySourceBlock[] = []
    if (cell.inputDetail) blocks.push({ type: 'input', content: cell.inputDetail })
    if (cell.outputDetail) blocks.push({ type: 'output', content: cell.outputDetail })
    if (cell.thinkingDetail) blocks.push({ type: 'thinking', content: cell.thinkingDetail })
    return blocks
  }, [cell.inputDetail, cell.outputDetail, cell.thinkingDetail])

  return (
    <div className="flex h-full flex-col border-l bg-background/95">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium">Record #{cell.index}</span>
        {onClose && (
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-0.5 border-b px-2 py-1">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/70 hover:bg-accent hover:text-foreground',
              tab === id && 'bg-accent text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'overview' && (
          <div className="space-y-2">
            <Section title="Kind">
              <div className="text-xs">{cell.kind}</div>
            </Section>
            <Section title="Summary">
              <div className="text-xs">{cell.text}</div>
            </Section>
            <KeyValue k="Index" v={`#${cell.index}`} />
            <KeyValue k="Started at" v={cell.startedAt !== null && cell.startedAt !== undefined ? new Date(cell.startedAt).toLocaleTimeString() : undefined} />
            <KeyValue k="Duration" v={cell.timeSeconds !== null ? formatMs(cell.timeSeconds * 1000) : undefined} />
            {cell.isError !== undefined && <KeyValue k="Error" v={cell.isError ? 'yes' : 'no'} />}
          </div>
        )}

        {tab === 'input' && (
          cell.inputDetail
            ? <pre className="max-h-full overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs">{cell.inputDetail}</pre>
            : <EmptyHint label="input" />
        )}

        {tab === 'output' && (
          cell.outputDetail
            ? <pre className="max-h-full overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs">{cell.outputDetail}</pre>
            : <EmptyHint label="output" />
        )}

        {tab === 'usage' && (
          <div className="space-y-3">
            <Section title="This request">
              <KeyValue k="Input tokens" v={cell.input} />
              <KeyValue k="Cache read" v={cell.cacheRead} />
              <KeyValue k="Cache write" v={cell.cacheWrite} />
              <KeyValue k="Output tokens" v={cell.output} />
              <KeyValue k="Reasoning tokens" v={cell.think} />
            </Section>
            {sessionTotal && (
              <Section title="Session total">
                <KeyValue k="Input" v={sessionTotal.input} />
                <KeyValue k="Cache read" v={sessionTotal.cacheRead} />
                <KeyValue k="Cache write" v={sessionTotal.cacheWrite} />
                <KeyValue k="Output" v={sessionTotal.output} />
              </Section>
            )}
          </div>
        )}

        {tab === 'timing' && (
          <div className="space-y-3">
            {metrics && metrics.timingRecorded ? (
              <>
                <KeyValue k="Step start" v={metrics.stepStartTime !== null ? new Date(metrics.stepStartTime).toLocaleTimeString() : undefined} />
                <KeyValue k="First token" v={metrics.firstTokenTime !== null ? new Date(metrics.firstTokenTime).toLocaleTimeString() : undefined} />
                <KeyValue k="Completed" v={metrics.completedTime !== null ? new Date(metrics.completedTime).toLocaleTimeString() : undefined} />
                {metrics.firstTokenTime !== null && metrics.stepStartTime !== null && (
                  <KeyValue k="TTFT (approx)" v={formatMs(metrics.firstTokenTime - metrics.stepStartTime)} />
                )}
                {metrics.completedTime !== null && metrics.firstTokenTime !== null && (
                  <KeyValue k="Decode" v={formatMs(metrics.completedTime - metrics.firstTokenTime)} />
                )}
                {metrics.outputTokens !== null && metrics.completedTime !== null && metrics.firstTokenTime !== null && (
                  <KeyValue k="Throughput" v={`${Math.round(metrics.outputTokens / Math.max((metrics.completedTime - metrics.firstTokenTime) / 1000, 0.001))} tok/s`} />
                )}
              </>
            ) : (
              <EmptyHint label="timing (not recorded for this record)" />
            )}
          </div>
        )}

        {tab === 'schema' && (
          cell.schemaDetail
            ? <pre className="max-h-full overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs">{cell.schemaDetail}</pre>
            : <EmptyHint label="schema" />
        )}

        {tab === 'system-prompt' && (
          cell.promptDetail
            ? <pre className="max-h-full overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs">{cell.promptDetail}</pre>
            : <EmptyHint label="system prompt" />
        )}

        {tab === 'source' && (
          <SourceBlocksView blocks={sourceBlocks} />
        )}

        {tab === 'raw' && (
          sourceMessage
            ? <pre className="max-h-full overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs">{JSON.stringify(sourceMessage, null, 2)}</pre>
            : <EmptyHint label="raw message" />
        )}

        {tab === 'tools' && (
          <EmptyHint label="tool catalog (available on request-header records)" />
        )}

        {tab === 'options' && (
          <div className="space-y-1">
            <KeyValue k="Tool" v={sourceMessage?.toolName} />
            <KeyValue k="Turn" v={sourceMessage?.turnId} />
            <KeyValue k="Parent" v={sourceMessage?.parentToolUseId} />
            <KeyValue k="Message id" v={sourceMessage?.id} />
          </div>
        )}

        {tab === 'diff' && (
          previousPrompt !== undefined && cell.promptDetail !== undefined && previousPrompt !== cell.promptDetail
            ? (
              <div className="space-y-2">
                <Section title="Before">
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs">{previousPrompt}</pre>
                </Section>
                <Section title="After">
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs">{cell.promptDetail}</pre>
                </Section>
              </div>
            )
            : <EmptyHint label="prompt diff" />
        )}

        {tab === 'rendered' && (
          cell.previewMarkdown
            ? <Markdown>{cell.previewMarkdown}</Markdown>
            : <EmptyHint label="rendered markdown" />
        )}
      </div>
    </div>
  )
}
