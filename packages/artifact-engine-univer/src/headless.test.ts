import { describe, expect, it } from 'bun:test'
import { createBlankUniverSheetSnapshot } from './index'
import { createHeadlessUniverSheet } from './headless'

describe('Univer Sheet headless adapter', () => {
  it('round-trips one snapshot, applies typed range mutations, and calculates formulas', async () => {
    const initial = createBlankUniverSheetSnapshot({
      workbookId: 'book-test',
      workbookName: 'Scores',
      sheetId: 'sheet-data',
      sheetName: 'Data',
      rows: 20,
      columns: 10,
    })
    const first = createHeadlessUniverSheet(initial)
    await first.applyMutation({
      type: 'set-range-values',
      range: 'Data!A1:B3',
      values: [
        ['Name', 'Score'],
        ['Ada', 10],
        ['Lin', 15],
      ],
    })
    await first.applyMutation({
      type: 'set-formula',
      range: 'Data!C1',
      formula: '=SUM(B2:B3)',
    })
    const inspected = first.inspectRange('Data!A1:C3')
    expect(inspected.values).toEqual([
      ['Name', 'Score', 25],
      ['Ada', 10, null],
      ['Lin', 15, null],
    ])
    expect(inspected.formulas[0]).toEqual([null, null, '=SUM(B2:B3)'])
    const saved = first.save()
    first.dispose()

    const reopened = createHeadlessUniverSheet(saved)
    await reopened.recalculate()
    expect(reopened.inspectRange('Data!A1:C3')).toEqual(inspected)
    const roundTripped = reopened.save()
    reopened.dispose()
    expect(roundTripped).toEqual(saved)
  })

  it('rejects malformed typed mutations and use-after-dispose', async () => {
    const sheet = createHeadlessUniverSheet(createBlankUniverSheetSnapshot({
      workbookId: 'book-errors',
      sheetId: 'sheet-errors',
    }))
    await expect(sheet.applyMutation({
      type: 'set-range-values',
      range: 'A1:B2',
      values: [[1]],
    })).rejects.toThrow('2x2')
    await expect(sheet.applyMutation({
      type: 'set-formula',
      range: 'A1:A2',
      formula: '=SUM(B1:B2)',
    })).rejects.toThrow('single-cell')
    sheet.dispose()
    expect(() => sheet.save()).toThrow('disposed')
  })
})
