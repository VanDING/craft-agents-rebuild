import * as React from 'react'
import {
  createBlankUniverSheetSnapshot,
  type IWorkbookData,
} from '@craft-agent/artifact-engine-univer'
import {
  mountUniverSheet,
  type MountedUniverSheet,
} from '@craft-agent/artifact-engine-univer/renderer'
import type { ComponentEntry } from './types'

function sampleWorkbook(): IWorkbookData {
  const snapshot = createBlankUniverSheetSnapshot({
    workbookId: 'playground-workbook',
    workbookName: 'Class scores',
    sheetId: 'playground-sheet',
    sheetName: 'Scores',
    rows: 40,
    columns: 12,
  })
  snapshot.sheets['playground-sheet']!.cellData = {
    0: {
      0: { v: 'Name' },
      1: { v: 'Score' },
      2: { v: 'Result' },
    },
    1: {
      0: { v: 'Ada' },
      1: { v: 98 },
      2: { f: '=IF(B2>=60,"Pass","Review")' },
    },
    2: {
      0: { v: 'Lin' },
      1: { v: 57 },
      2: { f: '=IF(B3>=60,"Pass","Review")' },
    },
  }
  return snapshot
}

function UniverSheetPlayground({ editable }: { editable: boolean }) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const mountedRef = React.useRef<MountedUniverSheet | null>(null)
  const [status, setStatus] = React.useState('Loading…')

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let cancelled = false
    setStatus('Loading…')
    void mountUniverSheet({
      container,
      snapshot: sampleWorkbook(),
      editable,
      locale: 'en-US',
      onChange: () => setStatus('Unsaved changes'),
    }).then((mounted) => {
      if (cancelled) {
        mounted.dispose()
        return
      }
      mountedRef.current = mounted
      setStatus(editable ? 'Editable' : 'Read-only')
    }).catch((error) => {
      if (!cancelled) setStatus(error instanceof Error ? error.message : String(error))
    })
    return () => {
      cancelled = true
      mountedRef.current?.dispose()
      mountedRef.current = null
    }
  }, [editable])

  const inspect = () => {
    try {
      const range = mountedRef.current?.inspectRange('Scores!A1:C3')
      setStatus(range ? `C2=${String(range.values[1]?.[2])}; C3=${String(range.values[2]?.[2])}` : 'Not ready')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  const addRow = async () => {
    try {
      await mountedRef.current?.applyMutation({
        type: 'set-range-values',
        range: 'Scores!A4:B4',
        values: [['Grace', 91]],
      })
      setStatus('Added Grace=91')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background" data-testid="univer-sheet-demo">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <span className="font-medium" data-testid="univer-status">{status}</span>
        <span className="flex-1" />
        <button type="button" className="rounded border border-border px-2 py-1" onClick={inspect}>Inspect A1:C3</button>
        <button type="button" className="rounded border border-border px-2 py-1" onClick={() => void addRow()}>Add sample row</button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  )
}

export const artifactComponents: ComponentEntry[] = [{
  id: 'univer-sheet-engine',
  name: 'Univer Sheet Engine',
  category: 'Artifacts',
  description: 'Real browser renderer adapter with formula inspection and editable/read-only modes.',
  component: UniverSheetPlayground,
  props: [{
    name: 'editable',
    description: 'Allow workbook mutations',
    control: { type: 'boolean' },
    defaultValue: true,
  }],
  variants: [
    { name: 'Editable', props: { editable: true } },
    { name: 'Read-only', props: { editable: false } },
  ],
  layout: 'full',
  previewOverflow: 'hidden',
}]
