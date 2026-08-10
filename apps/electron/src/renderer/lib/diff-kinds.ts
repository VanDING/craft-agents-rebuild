/**
 * Diff kinds for the Review panel (add / del / mix).
 *
 * Pure-logic translation of opencode's review-diff-kinds.ts classification,
 * adapted to our FileChange model: a change is `add` when it only inserts
 * lines, `del` when it only removes them, and `mix` when it does both.
 * The diff math itself reuses @craft-agent/ui's computeChangeStats (same
 * numbers as MultiDiffPreviewOverlay) — no duplicated diff computation.
 */

import { computeChangeStats, type FileChange, type FileSection } from '@craft-agent/ui'

export type DiffKind = 'add' | 'del' | 'mix'

/** Classify a single change by its computed line statistics. */
export function diffKindForChange(change: FileChange): DiffKind {
  const { additions, deletions } = computeChangeStats(change)
  if (additions > 0 && deletions === 0) return 'add'
  if (deletions > 0 && additions === 0) return 'del'
  return 'mix'
}

/** Merge per-change kinds into a section-level kind (add + del anywhere → mix). */
export function mergeDiffKinds(kinds: DiffKind[]): DiffKind {
  let merged: DiffKind | undefined
  for (const kind of kinds) {
    if (merged === undefined) {
      merged = kind
      continue
    }
    if (merged === kind) continue
    merged = 'mix'
  }
  return merged ?? 'mix'
}

/** Section-level kind (a file touched by both additions and deletions → mix). */
export function diffKindForSection(section: FileSection): DiffKind {
  return mergeDiffKinds(section.changes.map(diffKindForChange))
}
