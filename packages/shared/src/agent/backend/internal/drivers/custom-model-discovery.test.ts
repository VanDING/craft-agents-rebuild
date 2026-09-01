import { afterEach, describe, expect, it, mock } from 'bun:test';
import { discoverCustomEndpointModels, parseDiscoveredModels } from './custom-model-discovery.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('custom endpoint model discovery', () => {
  it('parses OpenAI metadata and preserves reported capabilities', () => {
    const [model] = parseDiscoveredModels({
      data: [{
        id: 'reasoner',
        display_name: 'Reasoner',
        context_window: 262_144,
        max_output_tokens: 32_768,
        input_modalities: ['text', 'image'],
        supported_reasoning_efforts: ['low', 'high'],
      }],
    });

    expect(model).toMatchObject({
      id: 'reasoner',
      name: 'Reasoner',
      contextWindow: 262_144,
      maxTokens: 32_768,
      supportsImages: true,
      supportsThinking: true,
      supportedThinkingLevels: ['off', 'low', 'high'],
    });
  });

  it('enriches a discovered ID with Pi capability metadata', () => {
    const [model] = parseDiscoveredModels(
      { models: [{ name: 'gpt-test' }] },
      [{
        id: 'pi/gpt-test',
        name: 'GPT Test',
        shortName: 'GPT',
        description: 'Known by Pi',
        provider: 'pi',
        contextWindow: 400_000,
        maxTokens: 64_000,
        supportsThinking: true,
        supportedThinkingLevels: ['off', 'low', 'xhigh'],
        thinkingLevelMap: { xhigh: 'xhigh' },
        supportsImages: true,
      }],
    );

    expect(model).toMatchObject({
      id: 'gpt-test',
      contextWindow: 400_000,
      maxTokens: 64_000,
      supportsThinking: true,
      supportedThinkingLevels: ['off', 'low', 'xhigh'],
      thinkingLevelMap: { xhigh: 'xhigh' },
      supportsImages: true,
    });
  });

  it('falls back from /models to /v1/models and sends bearer auth', async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
      });
      return url.endsWith('/models') && !url.endsWith('/v1/models')
        ? new Response('missing', { status: 404 })
        : Response.json({ data: [{ id: 'listed-model' }] });
    }) as unknown as typeof fetch;

    const models = await discoverCustomEndpointModels({
      baseUrl: 'https://example.test',
      api: 'openai-responses',
      apiKey: 'secret',
      timeoutMs: 1_000,
    });

    expect(calls.map(call => call.url)).toEqual([
      'https://example.test/models',
      'https://example.test/v1/models',
    ]);
    expect(calls[0]?.authorization).toBe('Bearer secret');
    expect(models[0]?.id).toBe('listed-model');
  });

  it('never sends a real provider key to a loopback model server', async () => {
    let authorization: string | undefined;
    globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      return Response.json({ models: [{ name: 'local-model' }] });
    }) as unknown as typeof fetch;

    await discoverCustomEndpointModels({
      baseUrl: 'http://127.0.0.1:11434',
      api: 'openai-completions',
      apiKey: 'must-not-leak',
      timeoutMs: 1_000,
    });

    expect(authorization).toBeUndefined();
  });
});
