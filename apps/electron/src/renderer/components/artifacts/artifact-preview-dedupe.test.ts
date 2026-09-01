import { describe, expect, it } from 'bun:test'
import type { ArtifactEventSnapshot, ResolvedArtifact } from '@craft-agent/shared/artifacts/browser'
import { dedupeArtifactPreviews } from './artifact-preview-dedupe'

const event: ArtifactEventSnapshot = {
  type: 'artifact_event',
  artifactId: 'artifact-1',
  sessionId: 'session-1',
  title: 'Generated image',
  kind: 'image',
  status: 'ready',
  revision: 'revision-1',
  sourcePath: 'E:\\workspace\\result.png',
  previewPath: 'E:\\managed\\revision-1.png',
  timestamp: 1,
}

describe('dedupeArtifactPreviews', () => {
  it('removes a native preview owned by the Artifact event', () => {
    const markdown = [
      'Finished.',
      '```image-preview',
      JSON.stringify({ src: 'E:/managed/revision-1.png', title: 'Result' }, null, 2),
      '```',
    ].join('\n')

    expect(dedupeArtifactPreviews(markdown, [event], [])).toBe('Finished.')
  })

  it('keeps unrelated gallery items while removing the Artifact item', () => {
    const markdown = [
      '```image-preview',
      JSON.stringify({
        title: 'Comparison',
        items: [
          { src: 'E:/workspace/before.png', label: 'Before' },
          { src: 'E:/workspace/result.png', label: 'After' },
        ],
      }, null, 2),
      '```',
    ].join('\n')

    const result = dedupeArtifactPreviews(markdown, [event], [])
    expect(result).toContain('before.png')
    expect(result).not.toContain('result.png')
  })

  it('also matches paths learned from the live Artifact projection', () => {
    const live = {
      artifact: { id: 'artifact-1', sourcePath: event.sourcePath, previews: [] },
      activePath: 'E:\\managed\\live.png',
      editablePath: null,
    } as unknown as ResolvedArtifact
    const markdown = `\`\`\`image-preview\n{"src":"E:\\\\managed\\\\live.png"}\n\`\`\``

    expect(dedupeArtifactPreviews(markdown, [event], [live])).toBe('')
  })

  it('leaves malformed and unrelated preview blocks unchanged', () => {
    const malformed = '```image-preview\nnot-json\n```'
    const unrelated = '\n\n```pdf-preview\n{"src":"E:/workspace/other.pdf"}\n```\n\n\n'
    expect(dedupeArtifactPreviews(malformed, [event], [])).toBe(malformed)
    expect(dedupeArtifactPreviews(unrelated, [event], [])).toBe(unrelated)
  })
})
