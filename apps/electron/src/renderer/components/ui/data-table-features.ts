import {
  columnFilteringFeature,
  globalFilteringFeature,
  columnVisibilityFeature,
  columnSizingFeature,
  columnResizingFeature,
  rowSortingFeature,
  rowPaginationFeature,
  rowExpandingFeature,
  rowSelectionFeature,
  createFilteredRowModel,
  createSortedRowModel,
  createPaginatedRowModel,
  createExpandedRowModel,
  filterFn_includesString,
  sortFn_alphanumeric,
  sortFn_text,
  sortFn_basic,
  sortFn_datetime,
  tableFeatures,
} from '@tanstack/react-table'
import type {
  ColumnDef as TableColumnDef,
  Column as TableColumn,
  Row as TableRow,
  Table,
  RowData,
} from '@tanstack/react-table'

/** Shared feature contract for the settings and info tables. */
export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  columnVisibilityFeature,
  columnSizingFeature,
  columnResizingFeature,
  rowSortingFeature,
  rowPaginationFeature,
  rowExpandingFeature,
  rowSelectionFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
  },
})

export type ColumnDef<TData extends RowData, TValue = unknown> = TableColumnDef<typeof dataTableFeatures, TData, TValue>
export type Column<TData extends RowData, TValue = unknown> = TableColumn<typeof dataTableFeatures, TData, TValue>
export type Row<TData extends RowData> = TableRow<typeof dataTableFeatures, TData>
export type TableInstance<TData extends RowData> = Table<typeof dataTableFeatures, TData>
export type { RowData }
