import { describe, expect, it } from 'bun:test';
import type { ArtifactToolResult, SessionToolContext } from '../context.ts';
import {
  handleArtifactApply,
  handleArtifactCreate,
  handleArtifactInspect,
  handleArtifactRender,
  handleArtifactStatus,
  handleArtifactSubmit,
} from './artifact.ts';

const success: ArtifactToolResult = {
  text: 'CRAFT_ARTIFACT_EVENT:{"artifactId":"a"}',
  structuredContent: { artifact: { id: 'a' } },
};

describe('Artifact canonical handlers', () => {
  it('passes typed operations through callbacks and preserves replayable output', async () => {
    const calls: unknown[] = [];
    const ctx = {
      artifactStatus: async (id?: string) => { calls.push(['status', id]); return success; },
      artifactCreate: async (input: unknown) => { calls.push(['create', input]); return success; },
      artifactApply: async (id: string, input: unknown) => { calls.push(['apply', id, input]); return success; },
      artifactInspect: async (id: string, range?: string) => { calls.push(['inspect', id, range]); return success; },
      artifactRender: async (id: string) => { calls.push(['render', id]); return success; },
      artifactSubmit: async (id: string, revision?: string) => { calls.push(['submit', id, revision]); return success; },
    } as unknown as SessionToolContext;

    const results = await Promise.all([
      handleArtifactStatus(ctx, { artifactId: 'a' }),
      handleArtifactCreate(ctx, { kind: 'text', sourcePath: 'report.txt', initialText: 'draft' }),
      handleArtifactApply(ctx, {
        artifactId: 'a',
        expectedRevision: 'r1',
        operation: { type: 'set_json', value: { ok: true } },
      }),
      handleArtifactApply(ctx, {
        artifactId: 'a',
        expectedRevision: 'r2',
        operation: { type: 'sheet_set_formula', range: 'Data!C1', formula: '=SUM(B2:B3)' },
      }),
      handleArtifactInspect(ctx, { artifactId: 'a' }),
      handleArtifactInspect(ctx, { artifactId: 'a', range: 'Data!A1:C3' }),
      handleArtifactRender(ctx, { artifactId: 'a' }),
      handleArtifactSubmit(ctx, { artifactId: 'a', expectedRevision: 'r3' }),
    ]);

    expect(results.every((result) => result.isError === false)).toBe(true);
    expect(results[0]?.content[0]?.text).toStartWith('CRAFT_ARTIFACT_EVENT:');
    expect(results[0]?.structuredContent).toEqual(success.structuredContent);
    expect(calls).toHaveLength(8);
    expect(calls[2]).toEqual(['apply', 'a', {
      expectedRevision: 'r1',
      operation: { type: 'set_json', value: { ok: true } },
    }]);
    expect(calls[3]).toEqual(['apply', 'a', {
      expectedRevision: 'r2',
      operation: { type: 'sheet_set_formula', range: 'Data!C1', formula: '=SUM(B2:B3)' },
    }]);
    expect(calls[5]).toEqual(['inspect', 'a', 'Data!A1:C3']);
  });

  it('fails closed when the backend callback is unavailable', async () => {
    const result = await handleArtifactCreate({} as SessionToolContext, {
      kind: 'text',
      sourcePath: 'report.txt',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('artifact_create is not available');
  });
});
