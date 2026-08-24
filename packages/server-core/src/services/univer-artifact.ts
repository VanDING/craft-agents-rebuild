import type {
  IWorkbookData,
  UniverSheetMutation,
  UniverSheetRangeInspection,
} from '@craft-agent/artifact-engine-univer'
import {
  UNIVER_SHEET_ENGINE_ID,
  UNIVER_SHEET_MIME_TYPE,
} from '@craft-agent/artifact-engine-univer'
import { createHeadlessUniverSheet } from '@craft-agent/artifact-engine-univer/headless'
import {
  applyArtifactDraft,
  inspectArtifact,
  type ArtifactStorageScope,
  type ResolvedArtifact,
} from '@craft-agent/shared/artifacts'
import { readJsonFileSync } from '@craft-agent/shared/utils'

export interface UniverArtifactAccess {
  sessionId?: string
  leaseId?: string
}

export interface UniverArtifactMutationResult {
  resolved: ResolvedArtifact
  sheetInspection?: UniverSheetRangeInspection
}

function assertUniverSheet(resolved: ResolvedArtifact): void {
  if (
    resolved.artifact.kind !== 'spreadsheet'
    || resolved.artifact.engineId !== UNIVER_SHEET_ENGINE_ID
    || resolved.artifact.mimeType !== UNIVER_SHEET_MIME_TYPE
  ) {
    throw new Error(`Artifact ${resolved.artifact.id} is not a Univer Sheet`)
  }
}

/**
 * Apply a schema-checked spreadsheet mutation through Univer's isomorphic API,
 * then persist the canonical workbook snapshot as a regular Artifact revision.
 */
export async function mutateUniverSheetArtifact(
  scope: ArtifactStorageScope,
  artifactId: string,
  expectedRevision: string,
  mutation: UniverSheetMutation,
  access: UniverArtifactAccess = {},
): Promise<UniverArtifactMutationResult> {
  const synchronized = inspectArtifact(scope, artifactId, access)
  assertUniverSheet(synchronized)
  if (synchronized.artifact.status !== 'draft' || !synchronized.editablePath) {
    throw new Error(`Artifact ${artifactId} must be an editable draft`)
  }
  if (synchronized.artifact.draftRevision !== expectedRevision) {
    throw new Error(
      `Artifact revision conflict: expected ${expectedRevision}, found ${synchronized.artifact.draftRevision}`,
    )
  }

  const runtime = createHeadlessUniverSheet(
    readJsonFileSync<IWorkbookData>(synchronized.editablePath),
  )
  try {
    const result = await runtime.applyMutation(mutation)
    const resolved = applyArtifactDraft(scope, artifactId, {
      expectedRevision,
      leaseId: access.leaseId,
      operation: { type: 'set_json', value: result.snapshot },
    }, access.sessionId)
    return { resolved, sheetInspection: result.inspectedRange }
  } finally {
    runtime.dispose()
  }
}

/** Calculate formulas and return values/formulas for one A1 range. */
export async function inspectUniverSheetRange(
  resolved: ResolvedArtifact,
  range: string,
): Promise<UniverSheetRangeInspection> {
  assertUniverSheet(resolved)
  if (!resolved.activePath) {
    throw new Error(`Artifact ${resolved.artifact.id} has no inspectable revision`)
  }
  const runtime = createHeadlessUniverSheet(readJsonFileSync<IWorkbookData>(resolved.activePath))
  try {
    await runtime.recalculate()
    return runtime.inspectRange(range)
  } finally {
    runtime.dispose()
  }
}
