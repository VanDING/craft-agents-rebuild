import { describe, expect, it } from 'bun:test';
import type { LlmConnection } from '@craft-agent/shared/config';
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  generateImageWithOpenAI,
  resolveImageGenerationConnection,
  supportsNativeImageGeneration,
  type ImageApiClient,
} from './image-generation';

const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00,
]);

describe('native image generation provider', () => {
  it('generates one inline image with bounded native defaults', async () => {
    let received: Record<string, unknown> | undefined;
    const client: ImageApiClient = {
      images: {
        generate: async (params) => {
          received = params as unknown as Record<string, unknown>;
          return {
            created: 42,
            output_format: 'png',
            data: [{ b64_json: pngBytes.toString('base64') }],
          };
        },
      },
    };
    const generated = await generateImageWithOpenAI({ apiKey: 'test-key' }, {
      prompt: '  a precise line drawing  ',
    }, client);

    expect(received).toMatchObject({
      prompt: 'a precise line drawing',
      model: DEFAULT_IMAGE_GENERATION_MODEL,
      n: 1,
      output_format: 'png',
      stream: false,
    });
    expect(generated.bytes).toEqual(pngBytes);
    expect(generated.providerCreatedAt).toBe(42);
  });

  it('rejects invalid format combinations and provider payloads before Artifact creation', async () => {
    const neverClient: ImageApiClient = {
      images: { generate: async () => { throw new Error('must not call provider'); } },
    };
    await expect(generateImageWithOpenAI({ apiKey: 'test-key' }, {
      prompt: 'transparent mark',
      model: 'gpt-image-1',
      background: 'transparent',
      outputFormat: 'jpeg',
    }, neverClient)).rejects.toThrow('require PNG or WebP');

    await expect(generateImageWithOpenAI({ apiKey: 'test-key' }, {
      prompt: 'legacy image',
      model: 'dall-e-3',
    }, neverClient)).rejects.toThrow('Legacy DALL-E');

    const invalidClient: ImageApiClient = {
      images: {
        generate: async () => ({
          created: 42,
          output_format: 'png',
          data: [{ b64_json: Buffer.from('not a png').toString('base64') }],
        }),
      },
    };
    await expect(generateImageWithOpenAI({ apiKey: 'test-key' }, {
      prompt: 'invalid response',
    }, invalidClient)).rejects.toThrow('does not match the declared PNG');
  });

  it('only advertises standard OpenAI API-key connections', () => {
    const base: LlmConnection = {
      slug: 'openai-api',
      name: 'OpenAI',
      providerType: 'pi',
      piAuthProvider: 'openai',
      authType: 'api_key',
      createdAt: 1,
    };
    expect(supportsNativeImageGeneration(base)).toBe(true);
    expect(supportsNativeImageGeneration({ ...base, piAuthProvider: 'openai-codex', authType: 'oauth' })).toBe(false);
    expect(supportsNativeImageGeneration({ ...base, providerType: 'pi_compat' })).toBe(false);
  });

  it('resolves the preferred or explicit credential without using OAuth as an Images API key', async () => {
    const openai: LlmConnection = {
      slug: 'openai-api',
      name: 'OpenAI',
      providerType: 'pi',
      piAuthProvider: 'openai',
      authType: 'api_key',
      createdAt: 1,
    };
    const oauth: LlmConnection = {
      ...openai,
      slug: 'chatgpt-oauth',
      piAuthProvider: 'openai-codex',
      authType: 'oauth',
    };
    const resolved = await resolveImageGenerationConnection({
      preferredConnection: oauth,
      connections: [oauth, openai],
      getApiKey: async (slug) => slug === openai.slug ? 'image-key' : null,
    });
    expect(resolved).toEqual({ connection: openai, apiKey: 'image-key' });

    await expect(resolveImageGenerationConnection({
      explicitSlug: oauth.slug,
      connections: [oauth, openai],
      getApiKey: async () => 'oauth-token',
    })).rejects.toThrow('No image-capable OpenAI API-key connection');
    await expect(resolveImageGenerationConnection({
      explicitSlug: 'missing',
      connections: [openai],
      getApiKey: async () => null,
    })).rejects.toThrow('was not found');
  });
});
