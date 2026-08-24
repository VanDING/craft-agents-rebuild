import {
  createUniver,
  LocaleType,
  mergeLocales,
  type IWorkbookData,
} from '@univerjs/presets'
import {
  UniverSheetsNodeCorePreset,
  type FRange,
  type FWorkbook,
} from '@univerjs/preset-sheets-node-core'
import sheetsNodeCoreEnUS from '@univerjs/preset-sheets-node-core/locales/en-US'
import sheetsNodeCoreZhCN from '@univerjs/preset-sheets-node-core/locales/zh-CN'
import type {
  UniverSheetMutation,
  UniverSheetMutationResult,
  UniverSheetRangeInspection,
} from './index'
import { canonicalizeUniverSheetSnapshot } from './index'

export interface HeadlessUniverSheet {
  inspectRange(range: string): UniverSheetRangeInspection
  applyMutation(mutation: UniverSheetMutation): Promise<UniverSheetMutationResult>
  recalculate(timeoutMs?: number): Promise<void>
  save(): IWorkbookData
  dispose(): void
}

function localeFor(snapshot: Partial<IWorkbookData>): LocaleType {
  return snapshot.locale === LocaleType.ZH_CN ? LocaleType.ZH_CN : LocaleType.EN_US
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
  const worksheet = sheetName
    ? workbook.getSheetByName(sheetName)
    : workbook.getActiveSheet()
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
  if (values.length === 0 || values.some((row) => !Array.isArray(row))) {
    throw new Error('set-range-values requires a non-empty two-dimensional values array')
  }
  const bounds = range.getRange()
  const expectedRows = bounds.endRow - bounds.startRow + 1
  const expectedColumns = bounds.endColumn - bounds.startColumn + 1
  if (values.length !== expectedRows || values.some((row) => row.length !== expectedColumns)) {
    throw new Error(`Range expects a ${expectedRows}x${expectedColumns} values matrix`)
  }
}

export function createHeadlessUniverSheet(snapshot: Partial<IWorkbookData>): HeadlessUniverSheet {
  const locale = localeFor(snapshot)
  const localePack = locale === LocaleType.ZH_CN ? sheetsNodeCoreZhCN : sheetsNodeCoreEnUS
  const { univer, univerAPI } = createUniver({
    locale,
    locales: { [locale]: mergeLocales(localePack) },
    presets: [UniverSheetsNodeCorePreset()],
  })
  const workbook = univerAPI.createWorkbook(snapshot)
  let disposed = false

  const assertOpen = () => {
    if (disposed) throw new Error('Headless Univer Sheet is disposed')
  }

  const recalculate = async (timeoutMs = 5_000): Promise<void> => {
    assertOpen()
    const formula = univerAPI.getFormula()
    formula.executeCalculation()
    await formula.onCalculationResultApplied(timeoutMs)
  }

  return {
    inspectRange(notation) {
      assertOpen()
      return inspect(workbook, notation)
    },
    async applyMutation(mutation) {
      assertOpen()
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
          if (!mutation.formula.trim().startsWith('=')) {
            throw new Error('Formula must start with =')
          }
          range.setFormula(mutation.formula)
          break
        }
        case 'clear-range':
          range.clear({ contentsOnly: mutation.contentsOnly ?? true })
          break
      }
      await recalculate()
      return {
        snapshot: canonicalizeUniverSheetSnapshot(workbook.save()),
        inspectedRange: inspect(workbook, mutation.range),
      }
    },
    recalculate,
    save() {
      assertOpen()
      return canonicalizeUniverSheetSnapshot(workbook.save())
    },
    dispose() {
      if (disposed) return
      disposed = true
      univer.dispose()
    },
  }
}
