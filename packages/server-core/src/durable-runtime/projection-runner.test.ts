import { describe, expect, test } from 'bun:test'
import type { RuntimeEvent } from '@craft-agent/shared/durable-runtime'
import { DurableProjectionRunner, ProjectionSchemaMismatchError } from './projection-runner.js'
import { DurableRuntimeStore } from './store.js'

function event(seq: number): RuntimeEvent {
  return {
    eventId: `event-${seq}`,
    sessionId: 'session-1',
    operationId: 'run-1',
    type: 'user_message_committed',
    schemaVersion: 1,
    modelVisible: true,
    partial: false,
    payload: { content: `message-${seq}` },
    createdAt: seq,
  }
}

const definition = {
  name: 'test/messages',
  schemaVersion: 1,
  initial: () => [] as string[],
  reduce: (previous: string[], events: RuntimeEvent[]) => [
    ...previous,
    ...events.map(item => (item.payload as { content: string }).content),
  ],
}

describe('DurableProjectionRunner', () => {
  test('persists an incremental cursor and atomically materialized snapshot', () => {
    const store = new DurableRuntimeStore('unused', { databasePath: ':memory:' })
    store.appendEvents([event(1), event(2)])
    const runner = new DurableProjectionRunner(store, definition)

    const first = runner.runOnce(1)
    expect(first.cursor).toBe(1)
    expect(first.snapshot).toEqual(['message-1'])

    const second = runner.runToEnd(1)
    expect(second.cursor).toBe(2)
    expect(second.snapshot).toEqual(['message-1', 'message-2'])
    store.close()
  })

  test('rebuilds the same snapshot from seq zero', () => {
    const store = new DurableRuntimeStore('unused', { databasePath: ':memory:' })
    store.appendEvents([event(1), event(2)])
    const runner = new DurableProjectionRunner(store, definition)
    const original = runner.runToEnd()
    const rebuilt = runner.rebuild(1)

    expect(rebuilt.cursor).toBe(original.cursor)
    expect(rebuilt.snapshot).toEqual(original.snapshot)
    store.close()
  })

  test('fails closed on an incompatible persisted projection schema', () => {
    const store = new DurableRuntimeStore('unused', { databasePath: ':memory:' })
    store.appendEvents([event(1)])
    new DurableProjectionRunner(store, definition).runToEnd()
    const incompatible = new DurableProjectionRunner(store, { ...definition, schemaVersion: 2 })

    expect(() => incompatible.runOnce()).toThrow(ProjectionSchemaMismatchError)
    store.close()
  })

  test('CAS prevents two projection writers from advancing the same cursor', () => {
    const store = new DurableRuntimeStore('unused', { databasePath: ':memory:' })
    store.appendEvents([event(1), event(2)])
    store.commitMaterializedProjection({
      projection: definition.name,
      schemaVersion: 1,
      expectedCursor: 0,
      nextCursor: 1,
      snapshot: ['message-1'],
    })

    expect(() => store.commitMaterializedProjection({
      projection: definition.name,
      schemaVersion: 1,
      expectedCursor: 0,
      nextCursor: 2,
      snapshot: ['stale-writer'],
    })).toThrow('expected cursor 0, found 1')
    expect(store.getMaterializedProjection<string[]>(definition.name)?.snapshot).toEqual(['message-1'])
    store.close()
  })
})
