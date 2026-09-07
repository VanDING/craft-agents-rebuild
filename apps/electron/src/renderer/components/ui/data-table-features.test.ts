import { describe, expect, test } from 'bun:test'
import { constructTable, tableFeatures } from '@tanstack/react-table'
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings'
import { dataTableFeatures } from './data-table-features'

type Item = { name: string; children?: Item[] }
const features = tableFeatures({
  ...dataTableFeatures,
  coreReactivityFeature: storeReactivityBindings(),
})

function makeTable(data: Item[], pagination = false) {
  return constructTable({
    features,
    data,
    columns: [{ accessorKey: 'name' }],
    getSubRows: (row) => row.children,
    globalFilterFn: 'includesString',
    manualPagination: !pagination,
    initialState: { pagination: { pageIndex: 0, pageSize: 2 } },
  })
}

const names = (table: ReturnType<typeof makeTable>) => table.getRowModel().rows.map((row) => row.original.name)

describe('data table v9 interactions', () => {
  test('sorts naturally and applies global and column filters', () => {
    const table = makeTable([{ name: 'Tool 10' }, { name: 'Other' }, { name: 'Tool 2' }])
    table.setSorting([{ id: 'name', desc: false }])
    expect(names(table)).toEqual(['Other', 'Tool 2', 'Tool 10'])
    table.setGlobalFilter('TOOL')
    expect(names(table)).toEqual(['Tool 2', 'Tool 10'])
    table.setColumnFilters([{ id: 'name', value: '10' }])
    expect(names(table)).toEqual(['Tool 10'])
  })

  test('paginates only when enabled and supports next/previous page', () => {
    const data = [{ name: 'A' }, { name: 'B' }, { name: 'C' }]
    expect(names(makeTable(data))).toEqual(['A', 'B', 'C'])
    const table = makeTable(data, true)
    expect(names(table)).toEqual(['A', 'B'])
    table.nextPage()
    expect(names(table)).toEqual(['C'])
    expect(table.getCanNextPage()).toBe(false)
    table.previousPage()
    expect(names(table)).toEqual(['A', 'B'])
  })

  test('expands and collapses hierarchical labels', () => {
    const table = makeTable([{ name: 'Parent', children: [{ name: 'Child' }] }])
    expect(names(table)).toEqual(['Parent'])
    table.setExpanded(true)
    expect(names(table)).toEqual(['Parent', 'Child'])
    table.getRowModel().rows[0]!.toggleExpanded(false)
    expect(names(table)).toEqual(['Parent'])
  })

  test('preserves column sizing, visibility, and row selection APIs', () => {
    const table = makeTable([{ name: 'A' }])
    table.setColumnSizing({ name: 240 })
    expect(table.getColumn('name')!.getSize()).toBe(240)
    expect(table.getColumn('name')!.getCanResize()).toBe(true)
    table.getRowModel().rows[0]!.toggleSelected(true)
    expect(table.getRowModel().rows[0]!.getIsSelected()).toBe(true)
    table.getColumn('name')!.toggleVisibility(false)
    expect(table.getRowModel().rows[0]!.getVisibleCells()).toHaveLength(0)
  })
})
