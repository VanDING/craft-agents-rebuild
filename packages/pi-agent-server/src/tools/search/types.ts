export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  /** Public engine that produced the result, when available. */
  engine?: string;
  /** Human-readable source/domain supplied by the engine, when available. */
  source?: string;
}

export const PUBLIC_SEARCH_ENGINES = [
  'bing',
  'duckduckgo',
  'baidu',
  'sogou',
  'so360',
  'brave',
  'exa',
  'startpage',
  'csdn',
  'juejin',
] as const;

export type PublicSearchEngine = (typeof PUBLIC_SEARCH_ENGINES)[number];

export interface WebSearchOptions {
  /** Explicit public engines to aggregate. Omit to use the provider default. */
  engines?: PublicSearchEngine[];
}

export interface WebSearchFailure {
  engine: string;
  code: 'engine_error' | 'unsupported_engine';
  message: string;
}

export interface WebSearchResponse {
  results: WebSearchResult[];
  engines?: string[];
  partialFailures?: WebSearchFailure[];
}

export type WebSearchOutput = WebSearchResult[] | WebSearchResponse;

export interface WebSearchProvider {
  /** Display name shown in search results attribution (e.g. "Google", "OpenAI") */
  name: string;
  /** Execute a web search and return structured results. */
  search(query: string, count: number, options?: WebSearchOptions): Promise<WebSearchOutput>;
}

export function normalizeSearchOutput(output: WebSearchOutput): WebSearchResponse {
  return Array.isArray(output) ? { results: output } : output;
}
