import type { RuntimeEvent } from '@craft-agent/shared/durable-runtime'
import { DurableRuntimeStore, type MaterializedProjection } from './store.js'

export interface ProjectionDefinition<TSnapshot> {
  /** Stable, version-independent storage name. Schema changes use schemaVersion. */
  name: string
  schemaVersion: number
  initial(): TSnapshot
  reduce(previous: TSnapshot, events: RuntimeEvent[]): TSnapshot
}

export class ProjectionCursorAheadError extends Error {}
export class ProjectionEventGapError extends Error {}
export class ProjectionSchemaMismatchError extends Error {}

/**
 * Incrementally reduces the immutable workspace event log into a rebuildable
 * snapshot. Snapshot replacement and cursor movement are one SQLite commit.
 */
export class DurableProjectionRunner<TSnapshot> {
  constructor(
    private readonly store: DurableRuntimeStore,
    readonly definition: ProjectionDefinition<TSnapshot>,
  ) {}

  current(): MaterializedProjection<TSnapshot> | undefined {
    return this.store.getMaterializedProjection<TSnapshot>(this.definition.name)
  }

  runOnce(limit = 1_000): MaterializedProjection<TSnapshot> {
    const current = this.current()
    const persistedCursor = this.store.getProjectionCursor(this.definition.name)
    if (!current && persistedCursor !== 0) {
      throw new ProjectionSchemaMismatchError(
        `Projection ${this.definition.name} has cursor ${persistedCursor} but no materialized snapshot`,
      )
    }
    if (current && current.schemaVersion !== this.definition.schemaVersion) {
      throw new ProjectionSchemaMismatchError(
        `Projection ${this.definition.name} schema ${current.schemaVersion} is incompatible with ${this.definition.schemaVersion}`,
      )
    }

    const cursor = current?.cursor ?? 0
    const latest = this.store.getLatestEventSeq()
    if (cursor > latest) {
      throw new ProjectionCursorAheadError(
        `Projection ${this.definition.name} cursor ${cursor} is ahead of event log ${latest}`,
      )
    }

    const events = this.store.listEvents({ afterSeq: cursor, limit })
    if (events.length === 0) {
      return current ?? {
        projection: this.definition.name,
        schemaVersion: this.definition.schemaVersion,
        cursor: 0,
        snapshot: this.definition.initial(),
        updatedAt: 0,
      }
    }
    const firstSeq = events[0]?.seq ?? 0
    if (firstSeq !== cursor + 1) {
      throw new ProjectionEventGapError(
        `Projection ${this.definition.name} expected event ${cursor + 1}, found ${firstSeq}`,
      )
    }
    for (const event of events) {
      if (event.schemaVersion !== 1) {
        throw new ProjectionSchemaMismatchError(
          `Projection ${this.definition.name} cannot consume runtime event schema ${event.schemaVersion}`,
        )
      }
    }

    const nextCursor = events.at(-1)?.seq ?? cursor
    const snapshot = this.definition.reduce(current?.snapshot ?? this.definition.initial(), events)
    this.store.commitMaterializedProjection({
      projection: this.definition.name,
      schemaVersion: this.definition.schemaVersion,
      expectedCursor: cursor,
      nextCursor,
      snapshot,
    })
    return this.current()!
  }

  runToEnd(limit = 1_000): MaterializedProjection<TSnapshot> {
    let projection = this.runOnce(limit)
    while (projection.cursor < this.store.getLatestEventSeq()) {
      projection = this.runOnce(limit)
    }
    return projection
  }

  rebuild(limit = 1_000): MaterializedProjection<TSnapshot> {
    this.store.resetMaterializedProjection(this.definition.name)
    return this.runToEnd(limit)
  }
}
