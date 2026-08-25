import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWorkItem,
  deleteWorkItem,
  detachSessionFromWorkItems,
  ensureWorkItemForSession,
  findPrimaryWorkItemBySessionId,
  listWorkItems,
  listWorkItemEvents,
  migrateLegacySessionWorkItems,
  updatePrimaryWorkItemForSession,
  updateWorkItem,
} from '../storage.ts';

const roots: string[] = [];

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'work-items-test-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('work item storage', () => {
  it('roundtrips a task with zero or many linked sessions', () => {
    const root = freshRoot();
    const standalone = createWorkItem(root, { title: '  Plan launch  ' });
    expect(standalone).toMatchObject({ title: 'Plan launch', statusId: 'todo', sessionIds: [] });

    const linked = createWorkItem(root, {
      title: 'Run launch',
      sessionIds: ['s2', 's1', 's2'],
      primarySessionId: 's1',
    });
    expect(linked.sessionIds).toEqual(['s2', 's1']);
    expect(listWorkItems(root)).toHaveLength(2);
  });

  it('updates and clears optional fields while keeping the primary session linked', () => {
    const root = freshRoot();
    const created = createWorkItem(root, { title: 'Task', projectId: 'p1', startAt: '2026-08-22' });
    const updated = updateWorkItem(root, created.id, {
      projectId: null,
      startAt: null,
      dueAt: '2026-08-24T15:30:00+08:00',
      progress: 40,
      primarySessionId: 's1',
      sessionIds: [],
    });
    expect(updated.projectId).toBeUndefined();
    expect(updated.startAt).toBeUndefined();
    expect(updated.dueAt).toBe('2026-08-24T15:30:00+08:00');
    expect(updated.sessionIds).toEqual(['s1']);
  });

  it('rejects invalid progress, temporal values and relationship cycles', () => {
    const root = freshRoot();
    expect(() => createWorkItem(root, { title: 'Bad', progress: 101 })).toThrow('progress');
    expect(() => createWorkItem(root, { title: 'Bad', startAt: 'tomorrow' })).toThrow('startAt');
    expect(() => createWorkItem(root, { title: 'Bad', startAt: '2026-02-31' })).toThrow('calendar date');
    expect(() => createWorkItem(root, { title: 'Bad', startAt: '2026-08-22T25:00' })).toThrow('clock time');

    const a = createWorkItem(root, { title: 'A' });
    const b = createWorkItem(root, { title: 'B', dependencyIds: [a.id] });
    expect(() => updateWorkItem(root, a.id, { dependencyIds: [b.id] })).toThrow('cycle');
    expect(() => updateWorkItem(root, a.id, { parentId: a.id })).toThrow('parent itself');
  });

  it('deleting an item detaches parent and dependency references', () => {
    const root = freshRoot();
    const parent = createWorkItem(root, { title: 'Parent' });
    const child = createWorkItem(root, { title: 'Child', parentId: parent.id, dependencyIds: [parent.id] });
    deleteWorkItem(root, parent.id);
    const remaining = listWorkItems(root);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(child.id);
    expect(remaining[0]?.parentId).toBeUndefined();
    expect(remaining[0]?.dependencyIds).toEqual([]);
  });

  it('writes versioned JSON atomically and refuses to overwrite corrupt storage', () => {
    const root = freshRoot();
    createWorkItem(root, { title: 'Persisted' });
    const path = join(root, 'work-items', 'items.json');
    expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(3);

    writeFileSync(path, 'not-json');
    expect(() => listWorkItems(root)).toThrow('Unable to read work item store');
    expect(() => createWorkItem(root, { title: 'Must not overwrite' })).toThrow('Unable to read work item store');
    expect(readFileSync(path, 'utf8')).toBe('not-json');
  });

  it('rejects unsupported storage versions', () => {
    const root = freshRoot();
    mkdirSync(join(root, 'work-items'), { recursive: true });
    writeFileSync(join(root, 'work-items', 'items.json'), JSON.stringify({ version: 99, items: [] }));
    expect(() => listWorkItems(root)).toThrow('Unsupported work item store format');
  });

  it('upgrades a v1 store without inventing historical events', () => {
    const root = freshRoot();
    mkdirSync(join(root, 'work-items'), { recursive: true });
    const legacyItem = {
      id: 'legacy-item',
      title: 'Legacy',
      statusId: 'todo',
      dependencyIds: [],
      sessionIds: [],
      createdAt: 1,
      updatedAt: 1,
    };
    writeFileSync(join(root, 'work-items', 'items.json'), JSON.stringify({ version: 1, items: [legacyItem] }));

    expect(listWorkItems(root)).toEqual([legacyItem]);
    expect(listWorkItemEvents(root, legacyItem.id)).toEqual([]);
    updateWorkItem(root, legacyItem.id, { statusId: 'done' }, { actor: { type: 'user', id: 'client-1' } });

    const persisted = JSON.parse(readFileSync(join(root, 'work-items', 'items.json'), 'utf8'));
    expect(persisted.version).toBe(3);
    expect(listWorkItemEvents(root, legacyItem.id)).toHaveLength(1);
  });

  it('upgrades a v2 store while dropping retired saved views only', () => {
    const root = freshRoot();
    const item = createWorkItem(root, { title: 'Keep this task' });
    const path = join(root, 'work-items', 'items.json');
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    raw.version = 2;
    raw.views = [{ id: 'legacy-view', name: 'Old view' }];
    writeFileSync(path, JSON.stringify(raw));

    expect(listWorkItems(root).map(({ id }) => id)).toEqual([item.id]);
    updateWorkItem(root, item.id, { description: 'Migrated' });

    const migrated = JSON.parse(readFileSync(path, 'utf8'));
    expect(migrated.version).toBe(3);
    expect(migrated.views).toBeUndefined();
    expect(migrated.items[0]).toMatchObject({ id: item.id, description: 'Migrated' });
  });

  it('records append-only actor-aware create, transition, link and delete events', () => {
    const root = freshRoot();
    const created = createWorkItem(root, { title: 'Audited' }, { actor: { type: 'agent', id: 'agent-1' } });
    updateWorkItem(root, created.id, { statusId: 'done' }, { actor: { type: 'user', id: 'client-1' } });
    updateWorkItem(root, created.id, { sessionIds: ['s1'], primarySessionId: 's1' }, {
      actor: { type: 'automation', id: 'automation-1' },
      context: { sessionId: 's1', automationId: 'automation-1' },
    });
    deleteWorkItem(root, created.id, { actor: { type: 'user', id: 'client-1' } });

    const events = listWorkItemEvents(root, created.id).reverse();
    expect(events.map(({ action }) => action)).toEqual(['created', 'transitioned', 'linked', 'deleted']);
    expect(events.map(({ actor }) => actor.type)).toEqual(['agent', 'user', 'automation', 'user']);
    expect(events[2]?.context).toEqual({ sessionId: 's1', automationId: 'automation-1' });
    expect(events[3]?.snapshot?.title).toBe('Audited');
  });

  it('migrates the legacy Board once and never converts later chats implicitly', () => {
    const root = freshRoot();
    const first = migrateLegacySessionWorkItems(root, [{
      id: 's1',
      title: 'Existing board card',
      projectId: 'p1',
      statusId: 'in-progress',
      columnId: 'doing',
      createdAt: 10,
      updatedAt: 20,
    }]);
    expect(first).toMatchObject({ createdCount: 1, alreadyCompleted: false });
    expect(first.items[0]).toMatchObject({
      title: 'Existing board card',
      primarySessionId: 's1',
      sessionIds: ['s1'],
      createdAt: 10,
      updatedAt: 20,
    });

    const second = migrateLegacySessionWorkItems(root, [
      { id: 's1', title: 'Existing board card' },
      { id: 's2', title: 'A later plain conversation' },
    ]);
    expect(second).toMatchObject({ createdCount: 0, alreadyCompleted: true });
    expect(second.items).toHaveLength(1);
  });

  it('syncs primary-session metadata and detaches a deleted conversation', () => {
    const root = freshRoot();
    const created = createWorkItem(root, {
      title: 'Task',
      primarySessionId: 's1',
      sessionIds: ['s1', 's2'],
    });
    const synced = updatePrimaryWorkItemForSession(root, 's1', {
      title: 'Renamed',
      projectId: 'p1',
      statusId: 'done',
      columnId: 'complete',
    });
    expect(synced).toMatchObject({
      changed: true,
      item: {
        id: created.id,
        title: 'Renamed',
        projectId: 'p1',
        statusId: 'done',
        columnId: 'complete',
      },
    });
    expect(findPrimaryWorkItemBySessionId(root, 's1')?.id).toBe(created.id);

    expect(detachSessionFromWorkItems(root, 's1').changed).toBe(true);
    expect(listWorkItems(root)[0]).toMatchObject({ sessionIds: ['s2'] });
    expect(listWorkItems(root)[0]?.primarySessionId).toBeUndefined();
  });

  it('explicitly registers a task session idempotently after legacy migration', () => {
    const root = freshRoot();
    migrateLegacySessionWorkItems(root, []);
    const first = ensureWorkItemForSession(root, { id: 's1', title: 'Task session' });
    const second = ensureWorkItemForSession(root, { id: 's1', title: 'Ignored duplicate' });
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, item: { id: first.item.id, title: 'Task session' } });
    expect(listWorkItems(root)).toHaveLength(1);
  });

  it('rejects ambiguous primary-session ownership', () => {
    const root = freshRoot();
    createWorkItem(root, { title: 'A', primarySessionId: 's1' });
    expect(() => createWorkItem(root, { title: 'B', primarySessionId: 's1' })).toThrow(
      'cannot be primary for multiple work items',
    );
  });
});
