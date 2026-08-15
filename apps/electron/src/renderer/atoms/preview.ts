/**
 * Preview panel state (per session).
 *
 * The Preview panel collects two kinds of content per session (decision #7):
 * - opened files (link-interceptor previews converge here, Task 10)
 * - document pop-outs / turn details / activity expansions from the chat
 *   (ChatDisplay's markdown overlays converge here, Task 10)
 *
 * Bound panels follow the active session, so this is keyed by session id.
 */

import { atom } from 'jotai'

export type PreviewEntry =
  | { type: 'file'; path: string }
  /** `id` must be stable per source (message id / turn key / activity id) —
   *  two pop-outs sharing a title are distinct entries, same source re-opened
   *  replaces its entry and lands at the end (re-selected by PreviewPanel). */
  | { type: 'markdown'; content: string; title: string; id: string }

/** Per-session preview entry stacks. */
export const previewStateBySessionAtom = atom<Map<string, PreviewEntry[]>>(new Map())

/** Identity used for de-duplication (file path / stable source id). */
function previewIdentity(entry: PreviewEntry): string {
  return entry.type === 'file' ? `file:${entry.path}` : `md:${entry.id}`
}

/** Preview entries for a session (derived). */
export const previewEntriesForSessionAtom = atom((get) => (sessionId: string): PreviewEntry[] => {
  return get(previewStateBySessionAtom).get(sessionId) ?? []
})

/** Add an entry to a session's preview stack (de-dupe by file path / title). */
export const addPreviewEntryAtom = atom(
  null,
  (get, set, { sessionId, entry }: { sessionId: string; entry: PreviewEntry }) => {
    const map = new Map(get(previewStateBySessionAtom))
    const current = map.get(sessionId) ?? []
    const identity = previewIdentity(entry)
    const rest = current.filter((item) => previewIdentity(item) !== identity)
    map.set(sessionId, [...rest, entry])
    set(previewStateBySessionAtom, map)
  },
)

/** Remove an entry by its identity (tab close). Deletes the session bucket
 *  when it empties so the Map never accumulates dead session keys. */
export const removePreviewEntryAtom = atom(
  null,
  (get, set, { sessionId, identity }: { sessionId: string; identity: string }) => {
    const map = new Map(get(previewStateBySessionAtom))
    const current = map.get(sessionId)
    if (!current) return
    const next = current.filter((item) => previewIdentity(item) !== identity)
    if (next.length === 0) map.delete(sessionId)
    else map.set(sessionId, next)
    set(previewStateBySessionAtom, map)
  },
)
