import { describe, expect, it } from 'bun:test';
import type { ImageGenerateInput, SessionToolContext } from '../context.ts';
import { handleImageGenerate } from './image-generate.ts';

describe('image_generate canonical handler', () => {
  it('passes validated input through and preserves the Artifact event', async () => {
    let received: unknown;
    const result = await handleImageGenerate({
      imageGenerate: async (input: ImageGenerateInput) => {
        received = input;
        return {
          text: 'CRAFT_ARTIFACT_EVENT:{"artifactId":"image-1"}',
          structuredContent: { artifact: { id: 'image-1', status: 'ready' } },
        };
      },
    } as unknown as SessionToolContext, {
      prompt: 'A quiet harbor at dawn',
      outputFormat: 'webp',
    });
    expect(received).toEqual({ prompt: 'A quiet harbor at dawn', outputFormat: 'webp' });
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toStartWith('CRAFT_ARTIFACT_EVENT:');
  });

  it('fails closed without a host callback', async () => {
    const result = await handleImageGenerate({} as SessionToolContext, { prompt: 'test' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('image_generate is not available');
  });
});
