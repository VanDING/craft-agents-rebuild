/**
 * Active Session State
 *
 * Bound content-workbench panels (Review-Diff / Files / Context / Preview) bind
 * their content to the *active* session, not merely the focused one.
 *
 * Semantics (decision #4 in the workbench plan):
 * - `activeSessionIdAtom` = focused session when the focused panel is a session,
 *   otherwise the last session that was focused (sticky — never drifts while the
 *   user focuses a board/calendar/diff panel).
 * - `lastActiveSessionIdAtom` is written by NavigationContext whenever
 *   `focusedSessionIdAtom` becomes non-null (see the sync effect there).
 */

import { atom } from 'jotai'
import { focusedSessionIdAtom } from './panel-stack'

/**
 * The last session id that was focused, regardless of the current focused panel.
 * Written by NavigationContext's sync effect — kept as an explicit writable atom
 * so it can be driven/tested independently of React.
 */
export const lastActiveSessionIdAtom = atom<string | null>(null)

/**
 * The session bound panels should follow: the focused session if the focused
 * panel is a session, otherwise the last focused session (sticky).
 *
 * null when no session has ever been focused (e.g. app just launched on a
 * board-only layout) — panel-level empty states handle this.
 */
export const activeSessionIdAtom = atom<string | null>((get) => {
  return get(focusedSessionIdAtom) ?? get(lastActiveSessionIdAtom)
})
