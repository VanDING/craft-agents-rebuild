/**
 * Content panel UI state lifted to global atoms.
 *
 * Per plan Task 11 (panel → fullscreen expansion must keep panel-local state,
 * e.g. the opened diff / current preview entry) selections live here so the
 * same component instance renders identical state whether docked or expanded.
 */

import { atom } from 'jotai'

/** ReviewPanel: currently expanded file section key. */
export const reviewPanelSelectedKeyAtom = atom<string | null>(null)

/**
 * ChatDisplay → ReviewPanel scroll-to-change request.
 * `nonce` lets repeated requests for the same change re-fire; the panel
 * consumes (and clears) the request via an effect.
 */
export interface ReviewPanelFocusRequest {
  changeId: string
  nonce: number
}
export const reviewPanelFocusRequestAtom = atom<ReviewPanelFocusRequest | null>(null)

/** PreviewPanel: currently selected preview entry key per session. */
export const previewPanelSelectedKeyAtom = atom<string | null>(null)
