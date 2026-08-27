/**
 * Creates a `web_search` ToolDefinition backed by the given search provider.
 *
 * The tool name is always `web_search` regardless of the underlying provider,
 * so the model doesn't need to know which backend is used.
 */

import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import {
  PUBLIC_SEARCH_ENGINES,
  normalizeSearchOutput,
  type PublicSearchEngine,
  type WebSearchOutput,
  type WebSearchProvider,
  type WebSearchResult,
} from './types.ts';
import { PublicWebSearchProvider } from './providers/ddg.ts';

const schema = Type.Object({
  query: Type.String({ description: 'The search query' }),
  count: Type.Optional(
    Type.Number({
      description: 'Max results (1-10, default 5)',
      minimum: 1,
      maximum: 10,
    }),
  ),
  engines: Type.Optional(
    Type.Array(
      Type.Union(PUBLIC_SEARCH_ENGINES.map((engine) => Type.Literal(engine))),
      {
        description:
          'Public search engines to query concurrently. When set, bypasses the configured native provider and aggregates these engines.',
        minItems: 1,
        maxItems: PUBLIC_SEARCH_ENGINES.length,
        uniqueItems: true,
      },
    ),
  ),
});

function formatResults(
  query: string,
  providerName: string,
  results: WebSearchResult[],
  note?: string,
) {
  const formatted = results
    .map(
      (r, i) =>
        `${i + 1}. **${r.title}**${r.engine ? ` [${r.engine}]` : ''}\n   ${r.url}\n   ${r.description}`,
    )
    .join('\n\n');

  const noteText = note ? `${note}\n\n` : '';

  return {
    content: [
      {
        type: 'text' as const,
        text: `${noteText}Search results for "${query}" (via ${providerName}):\n\n${formatted}`,
      },
    ],
    details: {},
  };
}

function formatErrorSnippet(message: string, max = 180): string {
  const compact = sanitizeErrorMessage(message).replace(/\s+/g, ' ').trim();
  if (!compact) return 'unknown error';
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function formatSearchOutput(
  query: string,
  providerName: string,
  output: WebSearchOutput,
  note?: string,
) {
  const response = normalizeSearchOutput(output);
  const engineLabel = response.engines?.length
    ? `${providerName}: ${response.engines.join(', ')}`
    : providerName;
  const partialFailureNote = response.partialFailures?.length
    ? `Partial engine failures: ${response.partialFailures
      .map((failure) => `${failure.engine} (${formatErrorSnippet(failure.message)})`)
      .join('; ')}.`
    : undefined;
  const combinedNote = [note, partialFailureNote].filter(Boolean).join('\n');
  return formatResults(query, engineLabel, response.results, combinedNote || undefined);
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|token)\s*[=:]\s*)[^\s,;"']+/gi, '$1[REDACTED]');
}

export function createSearchTool(
  provider: WebSearchProvider,
  fallbackProvider: WebSearchProvider = new PublicWebSearchProvider(),
): ToolDefinition<typeof schema> {
  return {
    name: 'web_search',
    label: 'Web Search',
    description:
      'Search the web for current information. Returns titles, URLs, and snippets. Use for current information, documentation lookups, or fact-checking.',
    promptSnippet:
      'Use web_search for up-to-date information, documentation lookups, or fact-checking. Returns titles, URLs, and snippets. Accepts a query, optional count (1-10), and optional public engines (bing, duckduckgo, baidu, sogou, so360, brave, exa, startpage, csdn, juejin) for concurrent multi-engine search.',
    parameters: schema,
    async execute(toolCallId, params) {
      const { query } = params;
      const count = Math.max(1, Math.min(10, params.count ?? 5));
      const engines = params.engines as PublicSearchEngine[] | undefined;

      if (engines?.length) {
        try {
          const output = await fallbackProvider.search(query, count, { engines });
          return formatSearchOutput(query, fallbackProvider.name, output);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Search failed for "${query}": ${formatErrorSnippet(message, 800)}`);
        }
      }

      try {
        const output = await provider.search(query, count);
        return formatSearchOutput(query, provider.name, output);
      } catch (err) {
        const primaryMsg = err instanceof Error ? err.message : String(err);

        const canFallback = provider.name !== fallbackProvider.name;
        if (canFallback) {
          try {
            const fallbackOutput = await fallbackProvider.search(query, count);
            return formatSearchOutput(
              query,
              fallbackProvider.name,
              fallbackOutput,
              `Primary search provider (${provider.name}) failed (${formatErrorSnippet(primaryMsg)}), automatically fell back to ${fallbackProvider.name}.`,
            );
          } catch (fallbackErr) {
            const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            throw new Error(
              `Search failed for "${query}": primary (${provider.name}) failed with "${formatErrorSnippet(primaryMsg, 500)}"; fallback (${fallbackProvider.name}) failed with "${formatErrorSnippet(fallbackMsg, 500)}"`,
            );
          }
        }

        throw new Error(`Search failed for "${query}": ${formatErrorSnippet(primaryMsg, 800)}`);
      }
    },
  };
}
