import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts';
import type {
  CreateWorkItemInput,
  CreateWorkItemViewInput,
  DetachSessionWorkItemsResult,
  EnsureSessionWorkItemResult,
  LegacySessionWorkItemMigrationResult,
  LegacySessionWorkItemSource,
  PrimaryWorkItemSyncResult,
  UpdateWorkItemInput,
  UpdateWorkItemViewInput,
  WorkItem,
  WorkItemEvent,
  WorkItemEventAction,
  WorkItemEventChange,
  WorkItemMutationContext,
  WorkItemQuery,
  WorkItemViewDefinition,
} from './types.ts';

const WORK_ITEMS_DIR = 'work-items';
const WORK_ITEMS_FILE = 'work-items/items.json';
const WORK_ITEMS_VERSION = 2;

interface WorkItemsFile {
  version: typeof WORK_ITEMS_VERSION;
  items: WorkItem[];
  views: WorkItemViewDefinition[];
  events: WorkItemEvent[];
  migrations?: {
    /** All Board-visible sessions that existed before WorkItem became authoritative. */
    legacySessionBoardV1CompletedAt?: number;
  };
}

interface LegacyWorkItemsFileV1 {
  version: 1;
  items: WorkItem[];
  migrations?: WorkItemsFile['migrations'];
}

const SYSTEM_MUTATION: WorkItemMutationContext = { actor: { type: 'system' } };
const EVENT_FIELDS: readonly (keyof Omit<WorkItem, 'createdAt' | 'updatedAt'>)[] = [
  'projectId',
  'title',
  'description',
  'statusId',
  'columnId',
  'startAt',
  'dueAt',
  'progress',
  'dependencyIds',
  'parentId',
  'sessionIds',
  'primarySessionId',
  'isMilestone',
  'archivedAt',
];

function filePath(workspaceRootPath: string): string {
  return join(workspaceRootPath, WORK_ITEMS_FILE);
}

function optionalText(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Work item ${field} must not be empty`);
  return normalized;
}

function uniqueIds(values: readonly string[] | undefined): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values ?? []) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function temporalValue(value: string | null | undefined, field: string): string | undefined {
  const normalized = optionalText(value);
  if (!normalized) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|([+-])(\d{2}):(\d{2}))?)?$/.exec(normalized);
  if (!match) {
    throw new Error(`Work item ${field} must be YYYY-MM-DD or an ISO date-time`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Work item ${field} contains an invalid calendar date`);
  }
  if (hourText !== undefined) {
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText ?? 0);
    const offsetHour = Number(offsetHourText ?? 0);
    const offsetMinute = Number(offsetMinuteText ?? 0);
    if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
      throw new Error(`Work item ${field} contains an invalid clock time`);
    }
  }
  return normalized;
}

function progressValue(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error('Work item progress must be an integer from 0 to 100');
  }
  return value;
}

function assertItemShape(item: WorkItem): void {
  if (!item || typeof item !== 'object') throw new Error('Invalid work item entry');
  requiredText(item.id, 'id');
  requiredText(item.title, 'title');
  requiredText(item.statusId, 'statusId');
  if (!Array.isArray(item.dependencyIds) || !Array.isArray(item.sessionIds)) {
    throw new Error(`Invalid work item relationships: ${item.id}`);
  }
  if ([...item.dependencyIds, ...item.sessionIds].some((id) => typeof id !== 'string' || !id.trim())) {
    throw new Error(`Invalid work item relationship id: ${item.id}`);
  }
  if (new Set(item.dependencyIds).size !== item.dependencyIds.length || new Set(item.sessionIds).size !== item.sessionIds.length) {
    throw new Error(`Duplicate work item relationship id: ${item.id}`);
  }
  if (item.primarySessionId && !item.sessionIds.includes(item.primarySessionId)) {
    throw new Error(`Primary session is not linked to work item: ${item.id}`);
  }
  if (!Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt)) {
    throw new Error(`Invalid work item timestamps: ${item.id}`);
  }
  if (item.archivedAt !== undefined && !Number.isFinite(item.archivedAt)) {
    throw new Error(`Invalid work item archive timestamp: ${item.id}`);
  }
  temporalValue(item.startAt, 'startAt');
  temporalValue(item.dueAt, 'dueAt');
  progressValue(item.progress);
}

function assertRelationships(items: readonly WorkItem[]): void {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (byId.size !== items.length) throw new Error('Work item ids must be unique');

  const primaryOwners = new Map<string, string>();
  for (const item of items) {
    if (!item.primarySessionId) continue;
    const existingOwner = primaryOwners.get(item.primarySessionId);
    if (existingOwner) {
      throw new Error(
        `Session ${item.primarySessionId} cannot be primary for multiple work items: ${existingOwner}, ${item.id}`,
      );
    }
    primaryOwners.set(item.primarySessionId, item.id);
  }

  const visit = (id: string, relation: 'parent' | 'dependency', visiting: Set<string>, visited: Set<string>) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Work item ${relation} cycle detected at ${id}`);
    visiting.add(id);
    const item = byId.get(id);
    const related = relation === 'parent' ? (item?.parentId ? [item.parentId] : []) : (item?.dependencyIds ?? []);
    for (const relatedId of related) {
      if (relatedId === id) throw new Error(`Work item cannot ${relation === 'parent' ? 'parent' : 'depend on'} itself: ${id}`);
      if (byId.has(relatedId)) visit(relatedId, relation, visiting, visited);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const relation of ['parent', 'dependency'] as const) {
    const visited = new Set<string>();
    for (const item of items) visit(item.id, relation, new Set(), visited);
  }
}

function cloneQuery(query: WorkItemQuery = {}): WorkItemQuery {
  return {
    ...query,
    projectIds: query.projectIds ? [...query.projectIds] : undefined,
    statusIds: query.statusIds ? [...query.statusIds] : undefined,
    columnIds: query.columnIds ? [...query.columnIds] : undefined,
    dateRange: query.dateRange ? { ...query.dateRange } : undefined,
    sort: query.sort ? { ...query.sort } : undefined,
  };
}

function normalizedQuery(query: WorkItemQuery = {}): WorkItemQuery {
  const normalized: WorkItemQuery = cloneQuery(query);
  normalized.projectIds = uniqueIds(normalized.projectIds);
  normalized.statusIds = uniqueIds(normalized.statusIds);
  normalized.columnIds = uniqueIds(normalized.columnIds);
  normalized.sessionId = optionalText(normalized.sessionId);
  normalized.search = optionalText(normalized.search);
  if (normalized.scheduled && !['all', 'scheduled', 'unscheduled'].includes(normalized.scheduled)) {
    throw new Error(`Invalid work item scheduled filter: ${normalized.scheduled}`);
  }
  if (normalized.dateRange) {
    normalized.dateRange = {
      from: temporalValue(normalized.dateRange.from, 'view dateRange.from')?.slice(0, 10),
      to: temporalValue(normalized.dateRange.to, 'view dateRange.to')?.slice(0, 10),
    };
    if (normalized.dateRange.from && normalized.dateRange.to && normalized.dateRange.from > normalized.dateRange.to) {
      throw new Error('Work item view date range must be ordered');
    }
  }
  if (normalized.sort) {
    if (!['createdAt', 'updatedAt', 'title', 'startAt', 'dueAt'].includes(normalized.sort.field)) {
      throw new Error(`Invalid work item sort field: ${normalized.sort.field}`);
    }
    if (normalized.sort.direction && !['asc', 'desc'].includes(normalized.sort.direction)) {
      throw new Error(`Invalid work item sort direction: ${normalized.sort.direction}`);
    }
  }
  return normalized;
}

function assertViewShape(view: WorkItemViewDefinition): void {
  requiredText(view.id, 'view id');
  requiredText(view.name, 'view name');
  if (!['list', 'board', 'calendar'].includes(view.layout)) {
    throw new Error(`Invalid work item view layout: ${view.layout}`);
  }
  normalizedQuery(view.query);
  if (!view.display || !['none', 'project', 'status', 'column', 'dueDate'].includes(view.display.groupBy)) {
    throw new Error(`Invalid work item view grouping: ${view.id}`);
  }
  if (typeof view.display.showSubtasks !== 'boolean') throw new Error(`Invalid work item view display: ${view.id}`);
  if (!Number.isFinite(view.createdAt) || !Number.isFinite(view.updatedAt)) {
    throw new Error(`Invalid work item view timestamps: ${view.id}`);
  }
}

function assertEventShape(event: WorkItemEvent): void {
  requiredText(event.id, 'event id');
  requiredText(event.workItemId, 'event workItemId');
  if (!['created', 'updated', 'transitioned', 'linked', 'unlinked', 'deleted'].includes(event.action)) {
    throw new Error(`Invalid work item event action: ${event.id}`);
  }
  if (!event.actor || !['user', 'agent', 'automation', 'system'].includes(event.actor.type)) {
    throw new Error(`Invalid work item event actor: ${event.id}`);
  }
  if (!Array.isArray(event.changes) || !Number.isFinite(event.occurredAt)) {
    throw new Error(`Invalid work item event: ${event.id}`);
  }
}

function cloneView(view: WorkItemViewDefinition): WorkItemViewDefinition {
  return { ...view, query: cloneQuery(view.query), display: { ...view.display } };
}

function cloneEvent(event: WorkItemEvent): WorkItemEvent {
  return {
    ...event,
    actor: { ...event.actor },
    context: event.context ? { ...event.context } : undefined,
    changes: event.changes.map((change) => ({ ...change })),
    snapshot: event.snapshot ? cloneItem(event.snapshot) : undefined,
  };
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changesBetween(before: WorkItem, after: WorkItem): WorkItemEventChange[] {
  return EVENT_FIELDS.flatMap((field) => {
    if (equalJson(before[field], after[field])) return [];
    return [{ field, before: before[field], after: after[field] }];
  });
}

function eventAction(changes: readonly WorkItemEventChange[]): WorkItemEventAction {
  if (changes.length === 1 && changes[0]?.field === 'statusId') return 'transitioned';
  const fields = new Set(changes.map(({ field }) => field));
  if ([...fields].every((field) => field === 'sessionIds' || field === 'primarySessionId')) {
    const removed = changes.some(({ before, after }) => Array.isArray(before) && Array.isArray(after) && after.length < before.length);
    return removed ? 'unlinked' : 'linked';
  }
  return 'updated';
}

function appendEvent(
  data: WorkItemsFile,
  item: WorkItem,
  action: WorkItemEventAction,
  mutation: WorkItemMutationContext = SYSTEM_MUTATION,
  changes: WorkItemEventChange[] = [],
  snapshot?: WorkItem,
): void {
  const occurredAt = Math.max(Date.now(), (data.events.at(-1)?.occurredAt ?? 0) + 1);
  data.events.push({
    id: randomUUID(),
    workItemId: item.id,
    action,
    actor: { ...mutation.actor },
    context: mutation.context ? { ...mutation.context } : undefined,
    changes,
    snapshot: snapshot ? cloneItem(snapshot) : undefined,
    occurredAt,
  });
}

function readFile(workspaceRootPath: string): WorkItemsFile {
  const path = filePath(workspaceRootPath);
  if (!existsSync(path)) return { version: WORK_ITEMS_VERSION, items: [], views: [], events: [] };

  let raw: WorkItemsFile | LegacyWorkItemsFileV1;
  try {
    raw = readJsonFileSync<WorkItemsFile | LegacyWorkItemsFileV1>(path);
  } catch (error) {
    throw new Error(`Unable to read work item store: ${path}`, { cause: error });
  }
  if (!raw || !Array.isArray(raw.items) || (raw.version !== 1 && raw.version !== WORK_ITEMS_VERSION)) {
    throw new Error(`Unsupported work item store format: ${path}`);
  }
  const parsed: WorkItemsFile = raw.version === 1
    ? { version: WORK_ITEMS_VERSION, items: raw.items, views: [], events: [], migrations: raw.migrations }
    : raw;
  if (!Array.isArray(parsed.views) || !Array.isArray(parsed.events)) {
    throw new Error(`Unsupported work item store format: ${path}`);
  }
  for (const item of parsed.items) assertItemShape(item);
  for (const view of parsed.views) assertViewShape(view);
  for (const event of parsed.events) assertEventShape(event);
  if (new Set(parsed.views.map(({ id }) => id)).size !== parsed.views.length) {
    throw new Error('Work item view ids must be unique');
  }
  if (parsed.views.filter(({ isDefault }) => isDefault).length > 1) {
    throw new Error('Only one default work item view is allowed');
  }
  assertRelationships(parsed.items);
  return parsed;
}

function save(workspaceRootPath: string, data: WorkItemsFile): void {
  for (const item of data.items) assertItemShape(item);
  for (const view of data.views) assertViewShape(view);
  for (const event of data.events) assertEventShape(event);
  assertRelationships(data.items);
  const dir = join(workspaceRootPath, WORK_ITEMS_DIR);
  mkdirSync(dir, { recursive: true });
  atomicWriteFileSync(filePath(workspaceRootPath), JSON.stringify(data, null, 2));
}

function cloneItem(item: WorkItem): WorkItem {
  return {
    ...item,
    dependencyIds: [...item.dependencyIds],
    sessionIds: [...item.sessionIds],
  };
}

function buildWorkItem(input: CreateWorkItemInput, now = Date.now()): WorkItem {
  const sessionIds = uniqueIds(input.sessionIds);
  const primarySessionId = optionalText(input.primarySessionId);
  if (primarySessionId && !sessionIds.includes(primarySessionId)) sessionIds.unshift(primarySessionId);

  const item: WorkItem = {
    id: randomUUID(),
    projectId: optionalText(input.projectId),
    title: requiredText(input.title, 'title'),
    description: optionalText(input.description),
    statusId: requiredText(input.statusId ?? 'todo', 'statusId'),
    columnId: optionalText(input.columnId),
    startAt: temporalValue(input.startAt, 'startAt'),
    dueAt: temporalValue(input.dueAt, 'dueAt'),
    progress: progressValue(input.progress),
    dependencyIds: uniqueIds(input.dependencyIds),
    parentId: optionalText(input.parentId),
    sessionIds,
    primarySessionId,
    isMilestone: input.isMilestone || undefined,
    createdAt: now,
    updatedAt: now,
  };
  item.dependencyIds = item.dependencyIds.filter((id) => id !== item.id);
  if (item.parentId === item.id) throw new Error(`Work item cannot parent itself: ${item.id}`);
  return item;
}

/** Read durable WorkItems. Missing storage is an empty collection; corrupt storage fails closed. */
export function listWorkItems(workspaceRootPath: string): WorkItem[] {
  return readFile(workspaceRootPath).items.map(cloneItem);
}

export function listWorkItemViews(workspaceRootPath: string): WorkItemViewDefinition[] {
  return readFile(workspaceRootPath).views
    .map(cloneView)
    .sort((left, right) => Number(Boolean(right.isDefault)) - Number(Boolean(left.isDefault)) || left.name.localeCompare(right.name));
}

export function createWorkItemView(
  workspaceRootPath: string,
  input: CreateWorkItemViewInput,
): WorkItemViewDefinition {
  const data = readFile(workspaceRootPath);
  const now = Date.now();
  const view: WorkItemViewDefinition = {
    id: randomUUID(),
    name: requiredText(input.name, 'view name'),
    layout: input.layout,
    query: normalizedQuery(input.query),
    display: {
      groupBy: input.display?.groupBy ?? 'none',
      showSubtasks: input.display?.showSubtasks ?? true,
    },
    isDefault: input.isDefault || undefined,
    createdAt: now,
    updatedAt: now,
  };
  assertViewShape(view);
  if (view.isDefault) data.views = data.views.map((candidate) => ({ ...candidate, isDefault: undefined }));
  data.views.push(view);
  save(workspaceRootPath, data);
  return cloneView(view);
}

export function updateWorkItemView(
  workspaceRootPath: string,
  viewId: string,
  patch: UpdateWorkItemViewInput,
): WorkItemViewDefinition {
  const data = readFile(workspaceRootPath);
  const index = data.views.findIndex(({ id }) => id === viewId);
  if (index < 0) throw new Error(`Work item view not found: ${viewId}`);
  const existing = data.views[index]!;
  const updated: WorkItemViewDefinition = {
    ...existing,
    name: patch.name === undefined ? existing.name : requiredText(patch.name, 'view name'),
    layout: patch.layout ?? existing.layout,
    query: patch.query === undefined ? cloneQuery(existing.query) : normalizedQuery(patch.query),
    display: patch.display === undefined ? { ...existing.display } : { ...existing.display, ...patch.display },
    isDefault: patch.isDefault === undefined ? existing.isDefault : patch.isDefault || undefined,
    updatedAt: Math.max(Date.now(), existing.updatedAt + 1),
  };
  assertViewShape(updated);
  if (updated.isDefault) data.views = data.views.map((candidate) => ({ ...candidate, isDefault: undefined }));
  data.views[index] = updated;
  save(workspaceRootPath, data);
  return cloneView(updated);
}

export function deleteWorkItemView(workspaceRootPath: string, viewId: string): void {
  const data = readFile(workspaceRootPath);
  const next = data.views.filter(({ id }) => id !== viewId);
  if (next.length === data.views.length) return;
  data.views = next;
  save(workspaceRootPath, data);
}

export function listWorkItemEvents(
  workspaceRootPath: string,
  workItemId: string,
  limit = 200,
): WorkItemEvent[] {
  const normalizedId = requiredText(workItemId, 'event workItemId');
  const normalizedLimit = Math.max(1, Math.min(1_000, Math.trunc(limit)));
  return readFile(workspaceRootPath).events
    .filter((event) => event.workItemId === normalizedId)
    .sort((left, right) => right.occurredAt - left.occurredAt)
    .slice(0, normalizedLimit)
    .map(cloneEvent);
}

export function createWorkItem(
  workspaceRootPath: string,
  input: CreateWorkItemInput,
  mutation: WorkItemMutationContext = SYSTEM_MUTATION,
): WorkItem {
  const data = readFile(workspaceRootPath);
  const item = buildWorkItem(input);
  data.items.push(item);
  appendEvent(data, item, 'created', mutation, [], item);
  save(workspaceRootPath, data);
  return cloneItem(item);
}

export function updateWorkItem(
  workspaceRootPath: string,
  itemId: string,
  patch: UpdateWorkItemInput,
  mutation: WorkItemMutationContext = SYSTEM_MUTATION,
): WorkItem {
  const data = readFile(workspaceRootPath);
  const index = data.items.findIndex((item) => item.id === itemId);
  if (index < 0) throw new Error(`Work item not found: ${itemId}`);
  const existing = data.items[index]!;
  const updated: WorkItem = { ...existing, updatedAt: Math.max(Date.now(), existing.updatedAt + 1) };

  if ('projectId' in patch) updated.projectId = optionalText(patch.projectId);
  if (patch.title !== undefined) updated.title = requiredText(patch.title, 'title');
  if ('description' in patch) updated.description = optionalText(patch.description);
  if (patch.statusId !== undefined) updated.statusId = requiredText(patch.statusId, 'statusId');
  if ('columnId' in patch) updated.columnId = optionalText(patch.columnId);
  if ('startAt' in patch) updated.startAt = temporalValue(patch.startAt, 'startAt');
  if ('dueAt' in patch) updated.dueAt = temporalValue(patch.dueAt, 'dueAt');
  if ('progress' in patch) updated.progress = progressValue(patch.progress);
  if (patch.dependencyIds !== undefined) updated.dependencyIds = uniqueIds(patch.dependencyIds);
  if ('parentId' in patch) updated.parentId = optionalText(patch.parentId);
  if (patch.sessionIds !== undefined) updated.sessionIds = uniqueIds(patch.sessionIds);
  if ('primarySessionId' in patch) updated.primarySessionId = optionalText(patch.primarySessionId);
  if (patch.isMilestone !== undefined) updated.isMilestone = patch.isMilestone || undefined;
  if ('archivedAt' in patch) updated.archivedAt = patch.archivedAt ?? undefined;

  if (updated.primarySessionId && !updated.sessionIds.includes(updated.primarySessionId)) {
    updated.sessionIds.unshift(updated.primarySessionId);
  }
  if (updated.dependencyIds.includes(itemId)) throw new Error(`Work item cannot depend on itself: ${itemId}`);
  if (updated.parentId === itemId) throw new Error(`Work item cannot parent itself: ${itemId}`);

  const changes = changesBetween(existing, updated);
  if (changes.length === 0) return cloneItem(existing);
  data.items[index] = updated;
  appendEvent(data, updated, eventAction(changes), mutation, changes);
  save(workspaceRootPath, data);
  return cloneItem(updated);
}

/** Delete an item and detach references to it from surviving items. */
export function deleteWorkItem(
  workspaceRootPath: string,
  itemId: string,
  mutation: WorkItemMutationContext = SYSTEM_MUTATION,
): void {
  const data = readFile(workspaceRootPath);
  const deleted = data.items.find((item) => item.id === itemId);
  if (!deleted) return;
  const now = Date.now();
  data.items = data.items
    .filter((item) => item.id !== itemId)
    .map((item) => {
      const affected = item.parentId === itemId || item.dependencyIds.includes(itemId);
      if (!affected) return item;
      const updated: WorkItem = {
        ...item,
        dependencyIds: item.dependencyIds.filter((id) => id !== itemId),
        parentId: item.parentId === itemId ? undefined : item.parentId,
        updatedAt: Math.max(now, item.updatedAt + 1),
      };
      const changes = changesBetween(item, updated);
      appendEvent(data, updated, eventAction(changes), mutation, changes);
      return updated;
    });
  appendEvent(data, deleted, 'deleted', mutation, [], deleted);
  save(workspaceRootPath, data);
}

/**
 * Persist the legacy Board projection exactly once. Sessions created after the
 * marker is written remain conversations unless a task flow explicitly links
 * them to a WorkItem.
 */
export function migrateLegacySessionWorkItems(
  workspaceRootPath: string,
  sources: readonly LegacySessionWorkItemSource[],
): LegacySessionWorkItemMigrationResult {
  const data = readFile(workspaceRootPath);
  const completedAt = data.migrations?.legacySessionBoardV1CompletedAt;
  if (completedAt !== undefined) {
    return {
      items: data.items.map(cloneItem),
      createdCount: 0,
      alreadyCompleted: true,
      completedAt,
    };
  }

  const linkedSessionIds = new Set(data.items.flatMap((item) => item.sessionIds));
  let createdCount = 0;
  for (const source of sources) {
    const sessionId = source.id.trim();
    if (!sessionId || linkedSessionIds.has(sessionId)) continue;
    const now = Number.isFinite(source.createdAt) && (source.createdAt ?? 0) > 0
      ? source.createdAt!
      : Date.now();
    const item = buildWorkItem({
      title: source.title,
      projectId: source.projectId,
      statusId: source.statusId,
      columnId: source.columnId,
      sessionIds: [sessionId],
      primarySessionId: sessionId,
    }, now);
    if (Number.isFinite(source.updatedAt) && (source.updatedAt ?? 0) > item.updatedAt) {
      item.updatedAt = source.updatedAt!;
    }
    data.items.push(item);
    linkedSessionIds.add(sessionId);
    createdCount += 1;
  }

  const migrationCompletedAt = Date.now();
  data.migrations = {
    ...data.migrations,
    legacySessionBoardV1CompletedAt: migrationCompletedAt,
  };
  save(workspaceRootPath, data);
  return {
    items: data.items.map(cloneItem),
    createdCount,
    alreadyCompleted: false,
    completedAt: migrationCompletedAt,
  };
}

/** Explicitly register a top-level task session without affecting the legacy migration marker. */
export function ensureWorkItemForSession(
  workspaceRootPath: string,
  source: LegacySessionWorkItemSource,
  mutation: WorkItemMutationContext = SYSTEM_MUTATION,
): EnsureSessionWorkItemResult {
  const sessionId = requiredText(source.id, 'session id');
  const data = readFile(workspaceRootPath);
  const existing = data.items.find((candidate) => candidate.primarySessionId === sessionId);
  if (existing) return { item: cloneItem(existing), created: false };

  const createdAt = Number.isFinite(source.createdAt) && (source.createdAt ?? 0) > 0
    ? source.createdAt!
    : Date.now();
  const item = buildWorkItem({
    title: source.title,
    projectId: source.projectId,
    statusId: source.statusId,
    columnId: source.columnId,
    sessionIds: [sessionId],
    primarySessionId: sessionId,
  }, createdAt);
  if (Number.isFinite(source.updatedAt) && (source.updatedAt ?? 0) > item.updatedAt) {
    item.updatedAt = source.updatedAt!;
  }
  data.items.push(item);
  appendEvent(data, item, 'created', mutation, [], item);
  save(workspaceRootPath, data);
  return { item: cloneItem(item), created: true };
}

/** Return the unique WorkItem for which this conversation is the primary execution. */
export function findPrimaryWorkItemBySessionId(
  workspaceRootPath: string,
  sessionId: string,
): WorkItem | undefined {
  const item = readFile(workspaceRootPath).items.find((candidate) => candidate.primarySessionId === sessionId);
  return item ? cloneItem(item) : undefined;
}

/**
 * Apply a Session-originated projection update without creating a task. This
 * keeps TaskRunner and external session metadata writes consistent while the
 * WorkItem remains the durable Board/List/Calendar source.
 */
export function updatePrimaryWorkItemForSession(
  workspaceRootPath: string,
  sessionId: string,
  patch: Pick<UpdateWorkItemInput, 'title' | 'projectId' | 'statusId' | 'columnId'>,
  mutation: WorkItemMutationContext = SYSTEM_MUTATION,
): PrimaryWorkItemSyncResult | undefined {
  const data = readFile(workspaceRootPath);
  const index = data.items.findIndex((candidate) => candidate.primarySessionId === sessionId);
  if (index < 0) return undefined;
  const existing = data.items[index]!;

  const normalized = {
    title: patch.title === undefined ? existing.title : requiredText(patch.title, 'title'),
    projectId: 'projectId' in patch ? optionalText(patch.projectId) : existing.projectId,
    statusId: patch.statusId === undefined ? existing.statusId : requiredText(patch.statusId, 'statusId'),
    columnId: 'columnId' in patch ? optionalText(patch.columnId) : existing.columnId,
  };
  if (
    normalized.title === existing.title
    && normalized.projectId === existing.projectId
    && normalized.statusId === existing.statusId
    && normalized.columnId === existing.columnId
  ) {
    return { item: cloneItem(existing), changed: false };
  }

  const updated: WorkItem = {
    ...existing,
    ...normalized,
    updatedAt: Math.max(Date.now(), existing.updatedAt + 1),
  };
  data.items[index] = updated;
  const changes = changesBetween(existing, updated);
  appendEvent(data, updated, eventAction(changes), mutation, changes);
  save(workspaceRootPath, data);
  return { item: cloneItem(updated), changed: true };
}

/** Detach a deleted conversation while retaining the task itself. */
export function detachSessionFromWorkItems(
  workspaceRootPath: string,
  sessionId: string,
  mutation: WorkItemMutationContext = SYSTEM_MUTATION,
): DetachSessionWorkItemsResult {
  const data = readFile(workspaceRootPath);
  const now = Date.now();
  let changed = false;
  data.items = data.items.map((item) => {
    if (!item.sessionIds.includes(sessionId)) return item;
    changed = true;
    const updated: WorkItem = {
      ...item,
      sessionIds: item.sessionIds.filter((id) => id !== sessionId),
      primarySessionId: item.primarySessionId === sessionId ? undefined : item.primarySessionId,
      updatedAt: Math.max(now, item.updatedAt + 1),
    };
    appendEvent(data, updated, 'unlinked', mutation, changesBetween(item, updated));
    return updated;
  });
  if (changed) save(workspaceRootPath, data);
  return { items: data.items.map(cloneItem), changed };
}
