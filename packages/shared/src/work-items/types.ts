/**
 * Canonical project-management task.
 *
 * A WorkItem describes work independently from the agent conversations that
 * execute it. `sessionIds` is therefore allowed to be empty or contain many
 * sessions; `primarySessionId` only identifies the preferred conversation to
 * open from task-oriented UI.
 */
export interface WorkItem {
  id: string;
  projectId?: string;
  title: string;
  description?: string;
  /** Workspace status id (for example `todo` or `needs-review`). */
  statusId: string;
  /** Physical board placement. Deliberately independent from `statusId`. */
  columnId?: string;
  /**
   * A calendar date (`YYYY-MM-DD`) or local/offset ISO date-time. Date-only
   * values remain date-only so all-day work never shifts across time zones.
   */
  startAt?: string;
  /** Same temporal representation as `startAt`. */
  dueAt?: string;
  /** Integer completion percentage in the inclusive range 0..100. */
  progress?: number;
  /** Work-item ids that must finish before this item. */
  dependencyIds: string[];
  parentId?: string;
  /** Agent conversations and executions associated with this task. */
  sessionIds: string[];
  /** Preferred session when task UI needs to open a conversation. */
  primarySessionId?: string;
  /** A zero-duration marker for future timeline/Gantt projections. */
  isMilestone?: boolean;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

export interface CreateWorkItemInput {
  projectId?: string;
  title: string;
  description?: string;
  statusId?: string;
  columnId?: string;
  startAt?: string;
  dueAt?: string;
  progress?: number;
  dependencyIds?: string[];
  parentId?: string;
  sessionIds?: string[];
  primarySessionId?: string;
  isMilestone?: boolean;
}

/** `null` clears an optional scalar field; omitted fields are unchanged. */
export interface UpdateWorkItemInput {
  projectId?: string | null;
  title?: string;
  description?: string | null;
  statusId?: string;
  columnId?: string | null;
  startAt?: string | null;
  dueAt?: string | null;
  progress?: number | null;
  dependencyIds?: string[];
  parentId?: string | null;
  sessionIds?: string[];
  primarySessionId?: string | null;
  isMilestone?: boolean;
  archivedAt?: number | null;
}

export type WorkItemScheduledFilter = 'all' | 'scheduled' | 'unscheduled';
export type WorkItemSortField = 'createdAt' | 'updatedAt' | 'title' | 'startAt' | 'dueAt';
export type WorkItemSortDirection = 'asc' | 'desc';

export type WorkItemViewLayout = 'list' | 'board' | 'calendar';
export type WorkItemViewGroupBy = 'none' | 'project' | 'status' | 'column' | 'dueDate';

/** Shared query contract used by List, Board and Calendar projections. */
export interface WorkItemQuery {
  projectIds?: readonly string[];
  statusIds?: readonly string[];
  columnIds?: readonly string[];
  sessionId?: string;
  search?: string;
  scheduled?: WorkItemScheduledFilter;
  /** Inclusive local calendar-day range (`YYYY-MM-DD`). */
  dateRange?: { from?: string; to?: string };
  includeArchived?: boolean;
  sort?: {
    field: WorkItemSortField;
    direction?: WorkItemSortDirection;
  };
}

/** A durable, named lens shared by every WorkItem projection. */
export interface WorkItemViewDefinition {
  id: string;
  name: string;
  /** Preferred projection when the view is opened. Its query works in every layout. */
  layout: WorkItemViewLayout;
  query: WorkItemQuery;
  display: {
    groupBy: WorkItemViewGroupBy;
    showSubtasks: boolean;
  };
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateWorkItemViewInput {
  name: string;
  layout: WorkItemViewLayout;
  query?: WorkItemQuery;
  display?: Partial<WorkItemViewDefinition['display']>;
  isDefault?: boolean;
}

export interface UpdateWorkItemViewInput {
  name?: string;
  layout?: WorkItemViewLayout;
  query?: WorkItemQuery;
  display?: Partial<WorkItemViewDefinition['display']>;
  isDefault?: boolean;
}

export type WorkItemActorType = 'user' | 'agent' | 'automation' | 'system';

export interface WorkItemEventActor {
  type: WorkItemActorType;
  id?: string;
  label?: string;
}

export interface WorkItemEventContext {
  sessionId?: string;
  agentRunId?: string;
  automationId?: string;
  artifactId?: string;
}

export type WorkItemEventAction =
  | 'created'
  | 'updated'
  | 'transitioned'
  | 'linked'
  | 'unlinked'
  | 'deleted';

export interface WorkItemEventChange {
  field: keyof Omit<WorkItem, 'createdAt' | 'updatedAt'>;
  before?: unknown;
  after?: unknown;
}

/** Append-only audit event. No event is synthesized for pre-event-store history. */
export interface WorkItemEvent {
  id: string;
  workItemId: string;
  action: WorkItemEventAction;
  actor: WorkItemEventActor;
  context?: WorkItemEventContext;
  changes: WorkItemEventChange[];
  /** Snapshot is retained for created/deleted events and future history rendering. */
  snapshot?: WorkItem;
  occurredAt: number;
}

export interface WorkItemMutationContext {
  actor: WorkItemEventActor;
  context?: WorkItemEventContext;
}

/** Minimal session metadata needed by the temporary M1.5 compatibility adapter. */
export interface LegacySessionWorkItemSource {
  id: string;
  title: string;
  projectId?: string;
  statusId?: string;
  columnId?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** Result of the one-time pre-WorkItem Board migration for a workspace. */
export interface LegacySessionWorkItemMigrationResult {
  items: WorkItem[];
  createdCount: number;
  alreadyCompleted: boolean;
  completedAt: number;
}

export interface PrimaryWorkItemSyncResult {
  item: WorkItem;
  changed: boolean;
}

export interface DetachSessionWorkItemsResult {
  items: WorkItem[];
  changed: boolean;
}

export interface EnsureSessionWorkItemResult {
  item: WorkItem;
  created: boolean;
}
