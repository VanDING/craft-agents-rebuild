import type {
  WorkItem,
  WorkItemQuery,
  WorkItemSortField,
} from './types.ts';

/** The calendar day represented by a date-only or ISO date-time value. */
export function workItemDateKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const key = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : undefined;
}

function comparisonValue(item: WorkItem, field: WorkItemSortField): string | number {
  switch (field) {
    case 'title':
      return item.title.toLocaleLowerCase();
    case 'startAt':
      return item.startAt ?? '';
    case 'dueAt':
      return item.dueAt ?? '';
    case 'createdAt':
      return item.createdAt;
    case 'updatedAt':
      return item.updatedAt;
  }
}

function intersectsDateRange(item: WorkItem, range: NonNullable<WorkItemQuery['dateRange']>): boolean {
  const start = workItemDateKey(item.startAt) ?? workItemDateKey(item.dueAt);
  const end = workItemDateKey(item.dueAt) ?? workItemDateKey(item.startAt);
  if (!start || !end) return false;
  if (range.from && end < range.from) return false;
  if (range.to && start > range.to) return false;
  return true;
}

/** Pure, stable query shared by project-management projections. */
export function queryWorkItems(items: readonly WorkItem[], query: WorkItemQuery = {}): WorkItem[] {
  const projectIds = query.projectIds?.length ? new Set(query.projectIds) : undefined;
  const statusIds = query.statusIds?.length ? new Set(query.statusIds) : undefined;
  const columnIds = query.columnIds?.length ? new Set(query.columnIds) : undefined;
  const search = query.search?.trim().toLocaleLowerCase();

  const filtered = items.filter((item) => {
    if (!query.includeArchived && item.archivedAt !== undefined) return false;
    if (projectIds && (!item.projectId || !projectIds.has(item.projectId))) return false;
    if (statusIds && !statusIds.has(item.statusId)) return false;
    if (columnIds && (!item.columnId || !columnIds.has(item.columnId))) return false;
    if (query.sessionId && !item.sessionIds.includes(query.sessionId)) return false;
    if (search) {
      const haystack = `${item.title}\n${item.description ?? ''}`.toLocaleLowerCase();
      if (!haystack.includes(search)) return false;
    }

    const scheduled = item.startAt !== undefined || item.dueAt !== undefined;
    if (query.scheduled === 'scheduled' && !scheduled) return false;
    if (query.scheduled === 'unscheduled' && scheduled) return false;
    if (query.dateRange && !intersectsDateRange(item, query.dateRange)) return false;
    return true;
  });

  if (!query.sort) return filtered;
  const direction = query.sort.direction === 'desc' ? -1 : 1;
  return filtered
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const left = comparisonValue(a.item, query.sort!.field);
      const right = comparisonValue(b.item, query.sort!.field);
      const compared = left < right ? -1 : left > right ? 1 : 0;
      return compared === 0 ? a.index - b.index : compared * direction;
    })
    .map(({ item }) => item);
}

/** Remove ids that no longer exist while preserving user selection order. */
export function reconcileWorkItemSelection(
  selectedIds: readonly string[],
  items: readonly Pick<WorkItem, 'id'>[],
): string[] {
  const liveIds = new Set(items.map((item) => item.id));
  return selectedIds.filter((id, index) => liveIds.has(id) && selectedIds.indexOf(id) === index);
}
