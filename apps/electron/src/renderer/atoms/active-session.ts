/**
 * Active Session State
 *
 * Bound content-workbench panels (Files / Run / Terminal / Artifact) bind
 * their content to the *active* session, not merely the focused one.
 *
 * Semantics in the v2 Surface model:
 * - `activeSessionIdAtom` = Primary Session when Primary is a session,
 *   otherwise the last Primary Session (sticky while Primary shows project or
 *   management surfaces). Context Workbench focus can never change it.
 * - `lastActiveSessionIdAtom` is written by NavigationContext whenever
 *   `primarySessionIdAtom` becomes non-null (see the sync effect there).
 */

import { atom } from 'jotai'
import { primarySessionIdAtom } from './workbench'

/**
 * The last session id selected in Primary, regardless of the current surface.
 * Written by NavigationContext's sync effect — kept as an explicit writable atom
 * so it can be driven/tested independently of React.
 */
export const lastActiveSessionIdAtom = atom<string | null>(null)

/**
 * The session bound workbench items should follow: the Primary Session when
 * present, otherwise the last Primary Session (sticky).
 *
 * null when no session has ever been focused (e.g. app just launched on a
 * board-only layout) — panel-level empty states handle this.
 */
export const activeSessionIdAtom = atom<string | null>((get) => {
  return get(primarySessionIdAtom) ?? get(lastActiveSessionIdAtom)
})
