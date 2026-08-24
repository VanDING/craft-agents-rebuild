import {
  createUniver,
  LocaleType,
  mergeLocales,
  type IWorkbookData,
} from '@univerjs/presets'
import {
  UniverSheetsCorePreset,
  type FRange,
  type FWorkbook,
} from '@univerjs/preset-sheets-core'
import sheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import sheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN'
import '@univerjs/preset-sheets-core/lib/index.css'
import {
  canonicalizeUniverSheetSnapshot,
  type UniverSheetMutation,
  type UniverSheetRangeInspection,
} from './index'

export interface MountUniverSheetOptions {
  container: HTMLElement
  snapshot: Partial<IWorkbookData>
  locale?: 'en-US' | 'zh-CN'
  editable?: boolean
  darkMode?: boolean
  onChange?: (snapshot: IWorkbookData) => void
}

export interface MountedUniverSheet {
  inspectRange(range: string): UniverSheetRangeInspection
  applyMutation(mutation: UniverSheetMutation): Promise<IWorkbookData>
  save(): IWorkbookData
  focus(): void
  dispose(): void
}

function splitRangeNotation(notation: string): { sheetName?: string; address: string } {
  const normalized = notation.trim()
  if (!normalized) throw new Error('Sheet range must not be empty')
  const separator = normalized.lastIndexOf('!')
  if (separator < 0) return { address: normalized }
  let sheetName = normalized.slice(0, separator).trim()
  const address = normalized.slice(separator + 1).trim()
  if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
    sheetName = sheetName.slice(1, -1).replaceAll("''", "'")
  }
  if (!sheetName || !address) throw new Error(`Invalid sheet range: ${notation}`)
  return { sheetName, address }
}

function resolveRange(workbook: FWorkbook, notation: string): FRange {
  const { sheetName, address } = splitRangeNotation(notation)
  const worksheet = sheetName ? workbook.getSheetByName(sheetName) : workbook.getActiveSheet()
  if (!worksheet) throw new Error(`Worksheet not found for range: ${notation}`)
  try {
    return worksheet.getRange(address)
  } catch (error) {
    throw new Error(`Invalid sheet range: ${notation}`, { cause: error })
  }
}

function inspect(workbook: FWorkbook, notation: string): UniverSheetRangeInspection {
  const range = resolveRange(workbook, notation)
  return {
    range: notation,
    values: range.getValues(),
    formulas: range.getFormulas().map((row) => row.map((formula) => formula || null)),
  }
}

function assertValueMatrix(range: FRange, values: unknown[][]): void {
  const bounds = range.getRange()
  const expectedRows = bounds.endRow - bounds.startRow + 1
  const expectedColumns = bounds.endColumn - bounds.startColumn + 1
  if (
    values.length !== expectedRows
    || values.length === 0
    || values.some((row) => !Array.isArray(row) || row.length !== expectedColumns)
  ) {
    throw new Error(`Range expects a ${expectedRows}x${expectedColumns} values matrix`)
  }
}

/** Mount the optional heavy renderer. Callers should dynamically import this subpath. */
export async function mountUniverSheet(options: MountUniverSheetOptions): Promise<MountedUniverSheet> {
  const editable = options.editable ?? false
  const locale = options.locale === 'zh-CN' ? LocaleType.ZH_CN : LocaleType.EN_US
  const localePack = locale === LocaleType.ZH_CN ? sheetsCoreZhCN : sheetsCoreEnUS
  const { univer, univerAPI } = createUniver({
    locale,
    locales: { [locale]: mergeLocales(localePack) },
    presets: [UniverSheetsCorePreset({
      container: options.container,
      header: true,
      toolbar: true,
      formulaBar: true,
      footer: {},
    })],
  })
  const workbook = univerAPI.createWorkbook(options.snapshot)
  univerAPI.toggleDarkMode(options.darkMode ?? false)
  try {
    const formula = univerAPI.getFormula()
    formula.executeCalculation()
    await formula.onCalculationResultApplied(5_000)
    if (!editable) {
      // Use Univer's permission model so preview mode still supports safe
      // navigation while every workbook mutation remains blocked.
      const permission = workbook.getWorkbookPermission()
      await permission.setReadOnly()
      await permission.setPoint(univerAPI.Enum.WorkbookPermissionPoint.CopyContent, true)
    }
  } catch (error) {
    univer.dispose()
    throw error
  }

  let disposed = false
  let changeTimer: ReturnType<typeof setTimeout> | undefined
  let lastSnapshot = JSON.stringify(canonicalizeUniverSheetSnapshot(workbook.save()))
  const disposables = [
    univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => {
      if (!editable || !options.onChange || disposed) return
      if (changeTimer) clearTimeout(changeTimer)
      changeTimer = setTimeout(() => {
        changeTimer = undefined
        if (disposed) return
        const snapshot = canonicalizeUniverSheetSnapshot(workbook.save())
        const serialized = JSON.stringify(snapshot)
        if (serialized === lastSnapshot) return
        lastSnapshot = serialized
        options.onChange?.(snapshot)
      }, 100)
    }),
  ]

  const assertOpen = () => {
    if (disposed) throw new Error('Mounted Univer Sheet is disposed')
  }

  const save = (): IWorkbookData => {
    assertOpen()
    return canonicalizeUniverSheetSnapshot(workbook.save())
  }

  return {
    inspectRange(notation) {
      assertOpen()
      return inspect(workbook, notation)
    },
    async applyMutation(mutation) {
      assertOpen()
      if (!editable) throw new Error('Mounted Univer Sheet is read-only')
      const range = resolveRange(workbook, mutation.range)
      switch (mutation.type) {
        case 'set-range-values':
          assertValueMatrix(range, mutation.values)
          range.setValues(mutation.values as Parameters<FRange['setValues']>[0])
          break
        case 'set-formula': {
          const bounds = range.getRange()
          if (bounds.startRow !== bounds.endRow || bounds.startColumn !== bounds.endColumn) {
            throw new Error('set-formula requires a single-cell range')
          }
          if (!mutation.formula.trim().startsWith('=')) throw new Error('Formula must start with =')
          range.setFormula(mutation.formula)
          break
        }
        case 'clear-range':
          range.clear({ contentsOnly: mutation.contentsOnly ?? true })
          break
      }
      const formula = univerAPI.getFormula()
      formula.executeCalculation()
      await formula.onCalculationResultApplied(5_000)
      const snapshot = save()
      lastSnapshot = JSON.stringify(snapshot)
      options.onChange?.(snapshot)
      return snapshot
    },
    save,
    focus() {
      assertOpen()
      options.container.focus()
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (changeTimer) clearTimeout(changeTimer)
      for (const disposable of disposables) disposable.dispose()
      univer.dispose()
    },
  }
}
