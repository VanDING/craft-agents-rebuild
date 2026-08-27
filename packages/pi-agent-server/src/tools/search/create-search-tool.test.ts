import { describe, expect, it } from 'bun:test';
import { createSearchTool } from './create-search-tool.ts';
import type { WebSearchProvider } from './types.ts';

describe('createSearchTool', () => {
  it('keeps canonical tool identity', () => {
    const provider: WebSearchProvider = {
      name: 'Mock',
      async search() {
        return [];
      },
    };

    const tool = createSearchTool(provider);

    expect(tool.name).toBe('web_search');
    expect(tool.label).toBe('Web Search');
    expect(tool.description).toContain('Search the web');
  });

  it('clamps count to [1, 10] and formats results', async () => {
    let capturedCount = 0;
    const provider: WebSearchProvider = {
      name: 'MockProvider',
      async search(query, count) {
        capturedCount = count;
        return [{ title: `Result for ${query}`, url: 'https://example.com', description: 'desc' }];
      },
    };

    const tool = createSearchTool(provider);
    const result = await tool.execute('tool-1', { query: 'craft', count: 99 });

    expect(capturedCount).toBe(10);
    expect(result.details?.isError).toBeUndefined();
    expect(result.content[0]?.type).toBe('text');
    expect((result.content[0] as any).text).toContain('(via MockProvider)');
  });

  it('automatically falls back when primary provider fails', async () => {
    const provider: WebSearchProvider = {
      name: 'OpenAI',
      async search() {
        throw new Error('401 missing scope');
      },
    };

    const fallbackProvider: WebSearchProvider = {
      name: 'DuckDuckGo',
      async search() {
        return [{ title: 'Fallback hit', url: 'https://fallback.example', description: 'ok' }];
      },
    };

    const tool = createSearchTool(provider, fallbackProvider);
    const result = await tool.execute('tool-2', { query: 'craft', count: 5 });

    expect(result.details?.isError).toBeUndefined();
    expect((result.content[0] as any).text).toContain('automatically fell back to DuckDuckGo');
    expect((result.content[0] as any).text).toContain('401 missing scope');
    expect((result.content[0] as any).text).toContain('https://fallback.example');
  });

  it('marks failures as errors when primary and fallback both fail', async () => {
    const provider: WebSearchProvider = {
      name: 'OpenAI',
      async search() {
        throw new Error('primary boom');
      },
    };

    const fallbackProvider: WebSearchProvider = {
      name: 'DuckDuckGo',
      async search() {
        throw new Error('fallback boom');
      },
    };

    const tool = createSearchTool(provider, fallbackProvider);
    await expect(tool.execute('tool-3', { query: 'craft', count: -1 })).rejects.toThrow(
      'primary (OpenAI) failed',
    );
    await expect(tool.execute('tool-3b', { query: 'craft', count: -1 })).rejects.toThrow(
      'fallback (DuckDuckGo) failed',
    );
  });

  it('truncates oversized provider errors in the tool result', async () => {
    const hugePrimary = `primary detail ${'x'.repeat(5_000)}`;
    const hugeFallback = `fallback detail ${'y'.repeat(5_000)}`;
    const provider: WebSearchProvider = {
      name: 'OpenAI',
      async search() {
        throw new Error(hugePrimary);
      },
    };

    const fallbackProvider: WebSearchProvider = {
      name: 'DuckDuckGo',
      async search() {
        throw new Error(hugeFallback);
      },
    };

    const tool = createSearchTool(provider, fallbackProvider);
    const error = await tool.execute('tool-5', { query: 'craft' }).catch((e: unknown) => e as Error);

    expect(error.message).toContain('primary detail');
    expect(error.message).toContain('fallback detail');
    expect(error.message).toContain('…');
    // Both snippets capped at 500 chars — the combined message stays compact.
    expect(error.message.length).toBeLessThan(1_300);
  });

  it('does not recurse fallback when provider is already fallback provider', async () => {
    const ddgProvider: WebSearchProvider = {
      name: 'DuckDuckGo',
      async search() {
        throw new Error('ddg boom');
      },
    };

    const tool = createSearchTool(ddgProvider, ddgProvider);
    await expect(tool.execute('tool-4', { query: 'craft' })).rejects.toThrow(
      'Search failed for "craft": ddg boom',
    );
  });

  it('routes explicit engine selection to the public provider and reports partial failures', async () => {
    let primaryCalls = 0;
    let capturedEngines: string[] | undefined;
    const provider: WebSearchProvider = {
      name: 'OpenAI',
      async search() {
        primaryCalls += 1;
        return [];
      },
    };
    const publicProvider: WebSearchProvider = {
      name: 'Public Web',
      async search(_query, _count, options) {
        capturedEngines = options?.engines;
        return {
          engines: options?.engines,
          results: [{
            title: 'Bing hit',
            url: 'https://example.com',
            description: 'ok',
            engine: 'bing',
          }],
          partialFailures: [{
            engine: 'sogou',
            code: 'engine_error',
            message: 'verification page',
          }],
        };
      },
    };

    const tool = createSearchTool(provider, publicProvider);
    const result = await tool.execute('tool-multi', {
      query: 'craft',
      count: 5,
      engines: ['bing', 'sogou'],
    });
    const text = (result.content[0] as any).text;

    expect(primaryCalls).toBe(0);
    expect(capturedEngines).toEqual(['bing', 'sogou']);
    expect(text).toContain('(via Public Web: bing, sogou)');
    expect(text).toContain('Partial engine failures: sogou (verification page).');
    expect(text).toContain('**Bing hit** [bing]');
  });

  it('redacts credentials from surfaced provider errors', async () => {
    const provider: WebSearchProvider = {
      name: 'OpenAI',
      async search() {
        throw new Error('Incorrect API key provided: sk-secretvalue123456');
      },
    };

    const tool = createSearchTool(provider, provider);
    try {
      await tool.execute('tool-5', { query: 'craft' });
      throw new Error('expected search failure');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('[REDACTED_API_KEY]');
      expect(message).not.toContain('sk-secretvalue123456');
    }
  });
});
