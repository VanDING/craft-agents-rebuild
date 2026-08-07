/**
 * Calendar entries storage.
 *
 * Standalone schedule items (title / date / optional time / optional note),
 * independent of sessions. Stored per workspace at
 * `{workspaceRootPath}/calendar/entries.json`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CalendarEntry, CalendarEntryInput } from '../protocol/dto';

const CALENDAR_DIR = 'calendar';
const CALENDAR_FILE = 'calendar/entries.json';

interface CalendarFile {
  version: 1;
  entries: CalendarEntry[];
}

function filePath(workspaceRootPath: string): string {
  return join(workspaceRootPath, CALENDAR_FILE);
}

/** Read all calendar entries for a workspace (missing/corrupt file = empty list). */
export function listCalendarEntries(workspaceRootPath: string): CalendarEntry[] {
  const path = filePath(workspaceRootPath);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as CalendarFile;
    if (!Array.isArray(parsed?.entries)) return [];
    return parsed.entries;
  } catch {
    return [];
  }
}

function save(workspaceRootPath: string, entries: CalendarEntry[]): void {
  const dir = join(workspaceRootPath, CALENDAR_DIR);
  mkdirSync(dir, { recursive: true });
  const data: CalendarFile = { version: 1, entries };
  writeFileSync(filePath(workspaceRootPath), JSON.stringify(data, null, 2), 'utf-8');
}

/** Create a calendar entry. */
export function createCalendarEntry(
  workspaceRootPath: string,
  input: CalendarEntryInput,
): CalendarEntry {
  const now = Date.now();
  const entry: CalendarEntry = {
    id: randomUUID(),
    title: input.title.trim(),
    date: input.date,
    time: input.time?.trim() || undefined,
    note: input.note?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  const entries = listCalendarEntries(workspaceRootPath);
  entries.push(entry);
  save(workspaceRootPath, entries);
  return entry;
}

/** Update a calendar entry (title/date/time/note). */
export function updateCalendarEntry(
  workspaceRootPath: string,
  entryId: string,
  input: CalendarEntryInput,
): CalendarEntry {
  const entries = listCalendarEntries(workspaceRootPath);
  const existing = entries.find((e) => e.id === entryId);
  if (!existing) throw new Error(`Calendar entry not found: ${entryId}`);
  const updated: CalendarEntry = {
    ...existing,
    title: input.title.trim(),
    date: input.date,
    time: input.time?.trim() || undefined,
    note: input.note?.trim() || undefined,
    updatedAt: Date.now(),
  };
  const index = entries.findIndex((e) => e.id === entryId);
  entries[index] = updated;
  save(workspaceRootPath, entries);
  return updated;
}

/** Delete a calendar entry. */
export function deleteCalendarEntry(workspaceRootPath: string, entryId: string): void {
  const entries = listCalendarEntries(workspaceRootPath);
  const next = entries.filter((e) => e.id !== entryId);
  if (next.length === entries.length) return;
  save(workspaceRootPath, next);
}
