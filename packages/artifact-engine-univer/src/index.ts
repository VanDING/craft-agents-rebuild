/** Stable engine identifier persisted in Artifact manifests. */
export const UNIVER_SHEET_ENGINE_ID = 'univer-sheet' as const

/** MIME type for the versioned Univer workbook snapshot used as source. */
export const UNIVER_SHEET_MIME_TYPE = 'application/vnd.craft-agent.univer-sheet+json' as const

export type { IWorkbookData } from '@univerjs/presets'
import type { IWorkbookData } from '@univerjs/presets'

export interface UniverSheetRangeMutation {
  type: 'set-range-values'
  /** A1 notation, optionally prefixed with a sheet name (for example `Data!A1:B2`). */
  range: string
  values: unknown[][]
}

export interface UniverSheetFormulaMutation {
  type: 'set-formula'
  /** A single A1 cell, optionally prefixed with a sheet name. */
  range: string
  formula: string
}

export interface UniverSheetClearMutation {
  type: 'clear-range'
  range: string
  contentsOnly?: boolean
}

export type UniverSheetMutation =
  | UniverSheetRangeMutation
  | UniverSheetFormulaMutation
  | UniverSheetClearMutation

export interface UniverSheetRangeInspection {
  range: string
  values: unknown[][]
  formulas: Array<Array<string | null>>
}

export interface UniverSheetMutationResult {
  snapshot: IWorkbookData
  inspectedRange?: UniverSheetRangeInspection
}

export interface BlankUniverSheetOptions {
  workbookId?: string
  workbookName?: string
  sheetId?: string
  sheetName?: string
  rows?: number
  columns?: number
  locale?: IWorkbookData['locale']
}

/** Build a small, portable IWorkbookData source without loading a Univer runtime. */
export function createBlankUniverSheetSnapshot(options: BlankUniverSheetOptions = {}): IWorkbookData {
  const workbookId = options.workbookId ?? globalThis.crypto.randomUUID()
  const sheetId = options.sheetId ?? globalThis.crypto.randomUUID()
  return {
    id: workbookId,
    name: options.workbookName ?? 'Workbook',
    appVersion: '0.25.1',
    locale: options.locale ?? ('enUS' as IWorkbookData['locale']),
    styles: {},
    sheetOrder: [sheetId],
    sheets: {
      [sheetId]: {
        id: sheetId,
        name: options.sheetName ?? 'Sheet1',
        rowCount: options.rows ?? 200,
        columnCount: options.columns ?? 50,
        cellData: {},
      },
    },
    resources: [],
  }
}

function omitEmptyResourceValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(omitEmptyResourceValues).filter((item) => item !== undefined)
    return items.length ? items : undefined
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, omitEmptyResourceValues(item)] as const)
      .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined)
    return entries.length ? Object.fromEntries(entries) : undefined
  }
  return value
}

/**
 * Normalize known empty plugin resources so opening and saving the same source
 * does not create a meaningless Artifact revision.
 */
export function canonicalizeUniverSheetSnapshot(snapshot: IWorkbookData): IWorkbookData {
  const canonical = structuredClone(snapshot)
  canonical.resources = canonical.resources?.map((resource) => {
    if (resource.name === 'SHEET_DEFINED_NAME_PLUGIN' && (!resource.data || resource.data === '{}')) {
      return { ...resource, data: '{}' }
    }
    if (resource.name === 'SHEET_DATA_VALIDATION_PLUGIN' && resource.data) {
      try {
        const parsed = omitEmptyResourceValues(JSON.parse(resource.data))
        return { ...resource, data: JSON.stringify(parsed ?? {}) }
      } catch {
        return resource
      }
    }
    return resource
  })
  return canonical
}
