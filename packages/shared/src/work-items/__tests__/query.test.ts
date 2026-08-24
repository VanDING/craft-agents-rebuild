import { describe, expect, it } from 'bun:test';
import {
  queryWorkItems,
  reconcileWorkItemSelection,
} from '../query.ts';
import type { WorkItem } from '../types.ts';

function item(id: string, patch: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    title: id,
    statusId: 'todo',
    dependencyIds: [],
    sessionIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

describe('queryWorkItems', () => {
  const items = [
    item('a', { projectId: 'p1', title: 'Ship release', startAt: '2026-08-20', dueAt: '2026-08-22' }),
    item('b', { projectId: 'p2', title: 'Write notes', statusId: 'done', archivedAt: 4 }),
    item('c', { projectId: 'p1', title: 'Review API', startAt: '2026-08-25T09:30:00' }),
  ];

  it('shares project, search, schedule and archive filtering', () => {
    expect(queryWorkItems(items, { projectIds: ['p1'], scheduled: 'scheduled' }).map((x) => x.id)).toEqual(['a', 'c']);
    expect(queryWorkItems(items, { search: 'release' }).map((x) => x.id)).toEqual(['a']);
    expect(queryWorkItems(items, { includeArchived: true }).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('matches tasks that intersect an inclusive calendar-day range', () => {
    expect(queryWorkItems(items, { dateRange: { from: '2026-08-22', to: '2026-08-24' } }).map((x) => x.id)).toEqual(['a']);
    expect(queryWorkItems(items, { dateRange: { from: '2026-08-25', to: '2026-08-25' } }).map((x) => x.id)).toEqual(['c']);
  });

  it('sorts stably', () => {
    const sorted = queryWorkItems(
      [item('a', { title: 'B' }), item('b', { title: 'A' }), item('c', { title: 'A' })],
      { sort: { field: 'title' } },
    );
    expect(sorted.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('WorkItem query helpers', () => {
  it('reconciles selection without reordering it', () => {
    expect(reconcileWorkItemSelection(['c', 'missing', 'a', 'c'], [item('a'), item('c')])).toEqual(['c', 'a']);
  });
});
