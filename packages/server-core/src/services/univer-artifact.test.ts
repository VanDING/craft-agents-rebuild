import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createBlankUniverSheetSnapshot,
  UNIVER_SHEET_ENGINE_ID,
  UNIVER_SHEET_MIME_TYPE,
} from '@craft-agent/artifact-engine-univer'
import {
  acquireArtifactLease,
  createArtifactDraft,
  inspectArtifact,
  type ArtifactStorageScope,
} from '@craft-agent/shared/artifacts'
import { inspectUniverSheetRange, mutateUniverSheetArtifact } from './univer-artifact'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Univer Sheet Artifact service', () => {
  it('persists typed headless edits as CAS-protected Artifact revisions', async () => {
    const workspaceRootPath = mkdtempSync(join(tmpdir(), 'craft-univer-artifact-'))
    roots.push(workspaceRootPath)
    const contentRootPath = join(workspaceRootPath, 'content')
    mkdirSync(contentRootPath)
    const sourcePath = join(contentRootPath, 'scores.univer.json')
    const scope: ArtifactStorageScope = {
      workspaceRootPath,
      workspaceId: 'ws-univer-artifact',
      contentRootPath,
      allowedRoots: [workspaceRootPath],
    }
    const created = createArtifactDraft(scope, {
      sessionId: 'session-univer-artifact',
      kind: 'spreadsheet',
      engineId: UNIVER_SHEET_ENGINE_ID,
      mimeType: UNIVER_SHEET_MIME_TYPE,
      sourcePath,
      initialText: `${JSON.stringify(createBlankUniverSheetSnapshot({
        workbookId: 'book-artifact',
        workbookName: 'Scores',
        sheetId: 'sheet-data',
        sheetName: 'Data',
      }), null, 2)}\n`,
    })
    const leased = acquireArtifactLease(
      scope,
      created.artifact.id,
      'agent',
      undefined,
      'session-univer-artifact',
    )
    const access = {
      sessionId: 'session-univer-artifact',
      leaseId: leased.artifact.lease!.id,
    }

    const values = await mutateUniverSheetArtifact(
      scope,
      created.artifact.id,
      created.artifact.draftRevision!,
      {
        type: 'set-range-values',
        range: 'Data!A1:B3',
        values: [['Name', 'Score'], ['Ada', 10], ['Lin', 15]],
      },
      access,
    )
    expect(values.sheetInspection?.values).toEqual([
      ['Name', 'Score'],
      ['Ada', 10],
      ['Lin', 15],
    ])

    const formula = await mutateUniverSheetArtifact(
      scope,
      created.artifact.id,
      values.resolved.artifact.draftRevision!,
      { type: 'set-formula', range: 'Data!C1', formula: '=SUM(B2:B3)' },
      access,
    )
    expect(formula.sheetInspection?.values).toEqual([[25]])
    expect(formula.resolved.artifact.revisions).toHaveLength(3)
    expect(existsSync(sourcePath)).toBe(false)

    const inspected = inspectArtifact(scope, created.artifact.id, access)
    await expect(inspectUniverSheetRange(inspected, 'Data!A1:C3')).resolves.toEqual({
      range: 'Data!A1:C3',
      values: [
        ['Name', 'Score', 25],
        ['Ada', 10, null],
        ['Lin', 15, null],
      ],
      formulas: [
        [null, null, '=SUM(B2:B3)'],
        [null, null, null],
        [null, null, null],
      ],
    })

    await expect(mutateUniverSheetArtifact(
      scope,
      created.artifact.id,
      created.artifact.draftRevision!,
      { type: 'clear-range', range: 'Data!A1' },
      access,
    )).rejects.toThrow('revision conflict')
  })
})
