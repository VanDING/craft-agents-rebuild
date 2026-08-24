import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acceptArtifact,
  acquireArtifactLease,
  applyArtifactDraft,
  createArtifactDraft,
  discardArtifact,
  getArtifact,
  inspectArtifact,
  listArtifacts,
  putArtifactTextPreview,
  releaseArtifactLease,
  registerCurrentArtifact,
  submitArtifact,
} from '../storage.ts';
import { parseArtifactEvent, serializeArtifactEvent } from '../events.ts';
import type { ArtifactStorageScope } from '../types.ts';

let workspaceRoot = '';
let contentRoot = '';
let scope: ArtifactStorageScope;

describe('artifact revision storage', () => {
  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'craft-artifact-workspace-'));
    contentRoot = mkdtempSync(join(tmpdir(), 'craft-artifact-content-'));
    scope = {
      workspaceRootPath: workspaceRoot,
      workspaceId: 'ws-test',
      contentRootPath: contentRoot,
      allowedRoots: [workspaceRoot, contentRoot],
    };
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(contentRoot, { recursive: true, force: true });
  });

  it('runs text draft → apply → inspect → ready → atomic accept', () => {
    const created = createArtifactDraft(scope, {
      sessionId: 'session-1',
      turnId: 'turn-1',
      kind: 'text',
      sourcePath: 'report.txt',
      initialText: 'first',
    });
    expect(created.artifact.status).toBe('draft');
    expect(created.artifact.baseRevision).toBeNull();
    expect(created.editablePath).not.toBeNull();

    const applied = applyArtifactDraft(scope, created.artifact.id, {
      expectedRevision: created.artifact.draftRevision!,
      operation: { type: 'replace_text', search: 'first', replacement: 'final' },
    }, 'session-1');
    expect(applied.artifact.draftRevision).not.toBe(created.artifact.draftRevision);
    const inspected = inspectArtifact(scope, created.artifact.id, { sessionId: 'session-1' });
    expect(inspected.artifact.validation).toMatchObject({ valid: true, summary: 'Validation passed' });
    const ready = submitArtifact(scope, created.artifact.id, {
      sessionId: 'session-1',
      expectedRevision: applied.artifact.draftRevision!,
    });
    expect(ready.artifact.status).toBe('ready');
    expect(ready.editablePath).toBeNull();

    const accepted = acceptArtifact(scope, created.artifact.id, 'session-1');
    expect(accepted.accepted).toBe(true);
    expect(accepted.artifact.artifact.status).toBe('accepted');
    expect(readFileSync(join(contentRoot, 'report.txt'), 'utf8')).toBe('final');
    expect(accepted.artifact.artifact.deliverables[0]?.path).toBe(accepted.artifact.artifact.sourcePath);
  });

  it('detects compare-and-swap conflicts without overwriting external changes', () => {
    const target = join(contentRoot, 'existing.txt');
    writeFileSync(target, 'base');
    const created = createArtifactDraft(scope, {
      sessionId: 'session-1',
      kind: 'text',
      sourcePath: target,
    });
    const applied = applyArtifactDraft(scope, created.artifact.id, {
      expectedRevision: created.artifact.draftRevision!,
      operation: { type: 'set_text', text: 'draft' },
    });
    submitArtifact(scope, created.artifact.id, { expectedRevision: applied.artifact.draftRevision! });
    writeFileSync(target, 'external');

    const result = acceptArtifact(scope, created.artifact.id);
    expect(result.accepted).toBe(false);
    expect(result.artifact.artifact.status).toBe('conflict');
    expect(result.conflict?.actualRevision).not.toBe(result.conflict?.expectedBaseRevision);
    expect(readFileSync(target, 'utf8')).toBe('external');
  });

  it('snapshots an externally edited managed checkout before submit and survives reload', () => {
    const created = createArtifactDraft(scope, {
      sessionId: 'session-1',
      kind: 'text',
      sourcePath: 'generated.txt',
      initialText: 'before',
    });
    writeFileSync(created.editablePath!, 'edited by a binary/tool adapter');
    const ready = submitArtifact(scope, created.artifact.id);
    expect(ready.artifact.draftRevision).not.toBe(created.artifact.draftRevision);
    expect(readFileSync(ready.activePath!, 'utf8')).toBe('edited by a binary/tool adapter');
    expect(listArtifacts({ workspaceRootPath: workspaceRoot }, { sessionId: 'session-1' })[0]?.artifact.id)
      .toBe(created.artifact.id);
  });

  it('fails invalid JSON validation and keeps the draft recoverable', () => {
    const created = createArtifactDraft(scope, {
      sessionId: 'session-1',
      kind: 'data',
      mimeType: 'application/json',
      sourcePath: 'data.json',
      initialText: '{bad',
    });
    expect(() => submitArtifact(scope, created.artifact.id)).toThrow('Artifact validation failed');
    const recovered = getArtifact({ workspaceRootPath: workspaceRoot }, created.artifact.id);
    expect(recovered.artifact.status).toBe('draft');
    expect(recovered.artifact.validation?.valid).toBe(false);
    expect(recovered.artifact.validation?.errors[0]).toContain('Invalid JSON');
  });

  it('validates image and PDF signatures before ready', () => {
    const png = createArtifactDraft(scope, {
      sessionId: 'session-1',
      kind: 'image',
      sourcePath: 'image.png',
      initialBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64'),
    });
    expect(png.activePath?.endsWith('.png')).toBe(true);
    expect(submitArtifact(scope, png.artifact.id).artifact.validation?.valid).toBe(true);

    const badPdf = createArtifactDraft(scope, {
      sessionId: 'session-1',
      kind: 'pdf',
      sourcePath: 'bad.pdf',
      initialText: 'not a pdf',
    });
    expect(badPdf.activePath?.endsWith('.pdf')).toBe(true);
    expect(() => submitArtifact(scope, badPdf.artifact.id)).toThrow('PDF content is missing');
  });

  it('enforces edit leases and revision compare-and-swap', () => {
    const created = createArtifactDraft(scope, {
      sessionId: 'session-1',
      kind: 'text',
      sourcePath: 'leased.txt',
      initialText: 'a',
    });
    const leased = acquireArtifactLease({ workspaceRootPath: workspaceRoot }, created.artifact.id, 'user', 60_000);
    expect(() => applyArtifactDraft(scope, created.artifact.id, {
      expectedRevision: created.artifact.draftRevision!,
      operation: { type: 'set_text', text: 'blocked' },
    })).toThrow('being edited by user');
    const applied = applyArtifactDraft(scope, created.artifact.id, {
      expectedRevision: created.artifact.draftRevision!,
      operation: { type: 'set_text', text: 'allowed' },
      leaseId: leased.artifact.lease!.id,
    });
    expect(() => applyArtifactDraft(scope, created.artifact.id, {
      expectedRevision: created.artifact.draftRevision!,
      operation: { type: 'set_text', text: 'stale' },
      leaseId: leased.artifact.lease!.id,
    })).toThrow('revision conflict');
    expect(releaseArtifactLease(
      { workspaceRootPath: workspaceRoot },
      created.artifact.id,
      leased.artifact.lease!.id,
    ).artifact.lease).toBeUndefined();
    expect(applied.artifact.status).toBe('draft');
  });

  it('discards without changing the source and keeps immutable replay metadata', () => {
    const target = join(contentRoot, 'keep.txt');
    writeFileSync(target, 'keep');
    const created = createArtifactDraft(scope, {
      sessionId: 'session-1',
      turnId: 'turn-1',
      title: 'Keep me',
      kind: 'text',
      sourcePath: target,
      initialText: 'discard this',
    });
    const discarded = discardArtifact(scope, created.artifact.id, 'session-1');
    expect(discarded.artifact.status).toBe('discarded');
    expect(readFileSync(target, 'utf8')).toBe('keep');
    const serialized = serializeArtifactEvent(discarded);
    expect(parseArtifactEvent(`tool output\n${serialized}`)).toMatchObject({
      artifactId: created.artifact.id,
      sessionId: 'session-1',
      turnId: 'turn-1',
      status: 'discarded',
    });
  });

  it('rejects target and initial paths outside the allowed roots', () => {
    expect(() => createArtifactDraft(scope, {
      sessionId: 'session-1',
      kind: 'text',
      sourcePath: join(tmpdir(), 'outside-artifact.txt'),
      initialText: 'blocked',
    })).toThrow('outside the session/workspace scope');
  });

  it('rejects a target that escapes through a symlinked parent', () => {
    const outside = mkdtempSync(join(tmpdir(), 'craft-artifact-outside-'));
    try {
      symlinkSync(outside, join(contentRoot, 'escape'));
      expect(() => createArtifactDraft(scope, {
        sessionId: 'session-1',
        kind: 'text',
        sourcePath: 'escape/escaped.txt',
        initialText: 'blocked',
      })).toThrow('outside the session/workspace scope');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('adapts an ordinary file preview to one durable current Artifact', () => {
    const target = join(contentRoot, 'notes.md');
    writeFileSync(target, '# First');
    const first = registerCurrentArtifact(scope, {
      sessionId: 'session-1',
      sourcePath: target,
    });
    expect(first.artifact.status).toBe('current');
    expect(first.artifact.kind).toBe('document');
    expect(readFileSync(first.activePath!, 'utf8')).toBe('# First');

    writeFileSync(target, '# Second');
    const refreshed = registerCurrentArtifact(scope, {
      sessionId: 'session-1',
      sourcePath: target,
    });
    expect(refreshed.artifact.id).toBe(first.artifact.id);
    expect(refreshed.artifact.currentRevision).not.toBe(first.artifact.currentRevision);
    expect(readFileSync(refreshed.activePath!, 'utf8')).toBe('# Second');
    expect(listArtifacts(scope, { sessionId: 'session-1' })).toHaveLength(1);
  });

  it('persists an immutable rendered preview bound to the reviewed revision', () => {
    const created = createArtifactDraft(scope, {
      sessionId: 'session-1',
      kind: 'document',
      sourcePath: 'report.docx',
      initialBase64: Buffer.from('office bytes').toString('base64'),
    });
    const rendered = putArtifactTextPreview(scope, created.artifact.id, {
      revision: created.artifact.draftRevision!,
      text: '# Rendered report',
      kind: 'markdown',
    });
    const preview = rendered.artifact.previews.find((candidate) => candidate.kind === 'markdown');
    expect(preview?.revision).toBe(created.artifact.draftRevision!);
    expect(preview?.path?.endsWith('.md')).toBe(true);
    expect(readFileSync(preview!.path!, 'utf8')).toBe('# Rendered report');
    expect(getArtifact(scope, created.artifact.id).artifact.previews).toContainEqual(preview!);
    expect(() => putArtifactTextPreview(scope, created.artifact.id, {
      revision: '0'.repeat(64),
      text: 'stale',
    })).toThrow('preview revision conflict');
  });
});
