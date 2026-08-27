/**
 * Multi-engine public web search provider requiring no API key.
 *
 * With no explicit engine selection it keeps the low-latency automatic race
 * used by the built-in fallback. When engines are supplied it searches them
 * concurrently, merges and de-duplicates results, and reports per-engine
 * failures without discarding successful results.
 */

import { parse as parseHtml } from 'node-html-parser';
import type {
  PublicSearchEngine,
  WebSearchFailure,
  WebSearchOptions,
  WebSearchProvider,
  WebSearchResponse,
  WebSearchResult,
} from '../types.ts';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
} as const;

const PUBLIC_SEARCH_TIMEOUT_MS = 10_000;

type EngineSearch = (
  query: string,
  count: number,
  signal: AbortSignal,
) => Promise<WebSearchResult[]>;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function snippet(text: string): string {
  return normalizeWhitespace(text).slice(0, 280);
}

function toAbsoluteHttpUrl(rawUrl: string, base?: string): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function sourceFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function extractUrlFromDuckDuckGoHref(href: string): string | null {
  const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
  if (uddgMatch) {
    try {
      return decodeURIComponent(uddgMatch[1]!);
    } catch {
      return null;
    }
  }
  return toAbsoluteHttpUrl(href.startsWith('//') ? `https:${href}` : href);
}

async function fetchSearchHtml(
  url: string,
  endpointName: string,
  signal: AbortSignal,
  headers: Record<string, string> = {},
): Promise<string> {
  const response = await fetchSearchResponse(url, endpointName, signal, { headers });
  return response.text();
}

async function fetchSearchResponse(
  url: string,
  endpointName: string,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { ...DEFAULT_HEADERS, ...init.headers },
    signal: AbortSignal.any([signal, AbortSignal.timeout(PUBLIC_SEARCH_TIMEOUT_MS)]),
  });
  if (!response.ok) throw new Error(`${endpointName} returned HTTP ${response.status}`);
  return response;
}

function extractResultsFromDuckDuckGoHtml(html: string, count: number): WebSearchResult[] {
  const root = parseHtml(html);
  const results: WebSearchResult[] = [];
  const seenUrls = new Set<string>();

  for (const anchor of root.querySelectorAll('a')) {
    if (results.length >= count) break;
    const url = extractUrlFromDuckDuckGoHref(anchor.getAttribute('href') || '');
    const title = normalizeWhitespace(anchor.textContent || '');
    if (!url || !title || seenUrls.has(url)) continue;

    const containerText = anchor.parentNode?.parentNode?.textContent || anchor.parentNode?.textContent || '';
    const description = snippet(normalizeWhitespace(containerText).replace(title, ''));
    seenUrls.add(url);
    results.push({ title, url, description, engine: 'duckduckgo', source: sourceFromUrl(url) });
  }
  return results;
}

async function searchDDGEndpoint(
  endpoint: 'html' | 'lite',
  query: string,
  count: number,
  signal: AbortSignal,
): Promise<WebSearchResult[]> {
  const host = endpoint === 'html' ? 'html.duckduckgo.com/html/' : 'lite.duckduckgo.com/lite/';
  const html = await fetchSearchHtml(
    `https://${host}?q=${encodeURIComponent(query)}`,
    `DDG ${endpoint}`,
    signal,
  );
  const results = extractResultsFromDuckDuckGoHtml(html, count);
  if (results.length === 0) throw new Error(`No results parsed from DDG ${endpoint}`);
  return results;
}

async function searchDuckDuckGo(query: string, count: number, signal: AbortSignal): Promise<WebSearchResult[]> {
  const controllers = [new AbortController(), new AbortController()];
  const combined = controllers.map((controller) => AbortSignal.any([signal, controller.signal]));
  try {
    try {
      return await Promise.any([
        searchDDGEndpoint('html', query, count, combined[0]!),
        searchDDGEndpoint('lite', query, count, combined[1]!),
      ]);
    } catch (error) {
      const causes = error instanceof AggregateError
        ? error.errors.map(errorMessage).filter(Boolean).join('; ')
        : errorMessage(error);
      throw new Error(`DuckDuckGo HTML and Lite endpoints failed${causes ? `: ${causes}` : ''}`);
    }
  } finally {
    for (const controller of controllers) controller.abort();
  }
}

function extractResultsFromBingHtml(html: string, count: number): WebSearchResult[] {
  const root = parseHtml(html);
  const results: WebSearchResult[] = [];
  const seenUrls = new Set<string>();
  for (const item of root.querySelectorAll('li.b_algo')) {
    if (results.length >= count) break;
    const anchor = item.querySelector('h2 a');
    const url = toAbsoluteHttpUrl(anchor?.getAttribute('href') || '');
    const title = normalizeWhitespace(anchor?.textContent || '');
    if (!url || !title || seenUrls.has(url)) continue;
    seenUrls.add(url);
    results.push({
      title,
      url,
      description: snippet(item.querySelector('.b_caption p')?.textContent || ''),
      engine: 'bing',
      source: sourceFromUrl(url),
    });
  }
  return results;
}

async function searchBing(query: string, count: number, signal: AbortSignal): Promise<WebSearchResult[]> {
  const html = await fetchSearchHtml(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${count}`,
    'Bing HTML',
    signal,
  );
  const results = extractResultsFromBingHtml(html, count);
  if (results.length === 0) throw new Error('No results parsed from Bing HTML');
  return results;
}

function extractResultsFromBaiduHtml(html: string, count: number): WebSearchResult[] {
  if (/wappass|百度安全验证|请输入验证码|antispider/i.test(html)) {
    throw new Error('Baidu returned a security verification page');
  }
  const root = parseHtml(html);
  const results: WebSearchResult[] = [];
  const seenUrls = new Set<string>();
  for (const item of root.querySelectorAll('#content_left > div')) {
    if (results.length >= count) break;
    const anchor = item.querySelector('h3 a') || item.querySelector('a');
    const url = toAbsoluteHttpUrl(anchor?.getAttribute('href') || '');
    const title = normalizeWhitespace(anchor?.textContent || '');
    if (!url || !title || seenUrls.has(url)) continue;
    seenUrls.add(url);
    results.push({
      title,
      url,
      description: snippet(
        item.querySelector('.c-font-normal.c-color-text')?.getAttribute('aria-label') ||
        item.querySelector('.cos-row, .c-abstract, .content-right_8Zs40')?.textContent || '',
      ),
      engine: 'baidu',
      source: snippet(item.querySelector('.cosc-source, .c-showurl')?.textContent || sourceFromUrl(url)),
    });
  }
  return results;
}

async function searchBaidu(query: string, count: number, signal: AbortSignal): Promise<WebSearchResult[]> {
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&tn=88093251_62_hao_pg&ie=utf-8&rn=${count}`;
  const html = await fetchSearchHtml(url, 'Baidu HTML', signal);
  const results = extractResultsFromBaiduHtml(html, count);
  if (results.length === 0) throw new Error('No results parsed from Baidu HTML');
  return results;
}

function extractResultsFromSogouHtml(html: string, count: number): WebSearchResult[] {
  if (/antispider|请输入验证码|访问过于频繁|搜狗搜索验证/i.test(html)) {
    throw new Error('Sogou returned a verification page');
  }
  const root = parseHtml(html);
  const results: WebSearchResult[] = [];
  const seenUrls = new Set<string>();
  const selector = '#main .vrwrap, #main .rb, #main .result, #results .vrwrap, .results .vrwrap, .results .rb';
  for (const item of root.querySelectorAll(selector)) {
    if (results.length >= count) break;
    const anchor = item.querySelector('h3 a, h2 a, .vr-title a, .pt a');
    const rawUrl = anchor?.getAttribute('href') || '';
    const url = toAbsoluteHttpUrl(rawUrl, 'https://www.sogou.com/web');
    const title = normalizeWhitespace(anchor?.textContent || '');
    if (!url || !title || seenUrls.has(url)) continue;
    seenUrls.add(url);
    results.push({
      title,
      url,
      description: snippet(item.querySelector('.str_info, .ft, .text-layout, .fz-mid, p')?.textContent || ''),
      engine: 'sogou',
      source: snippet(item.querySelector('cite, .citeurl, .g, .url')?.textContent || sourceFromUrl(url)),
    });
  }
  return results;
}

async function searchSogou(query: string, count: number, signal: AbortSignal): Promise<WebSearchResult[]> {
  const html = await fetchSearchHtml(
    `https://www.sogou.com/web?query=${encodeURIComponent(query)}&ie=utf8`,
    'Sogou HTML',
    signal,
    { Referer: 'https://www.sogou.com/' },
  );
  const results = extractResultsFromSogouHtml(html, count);
  if (results.length === 0) throw new Error('No results parsed from Sogou HTML');
  return results;
}

function extractResultsFromSoHtml(html: string, count: number): WebSearchResult[] {
  const root = parseHtml(html);
  const results: WebSearchResult[] = [];
  const seenUrls = new Set<string>();
  const items = root.querySelectorAll('li.res-list, li.result');
  const anchors = items.length > 0
    ? items.map((item) => item.querySelector('h3 a')).filter(Boolean)
    : root.querySelectorAll('h3 a');

  for (const anchor of anchors) {
    if (results.length >= count) break;
    const url = toAbsoluteHttpUrl(anchor?.getAttribute('href') || '');
    const title = normalizeWhitespace(anchor?.textContent || '');
    if (!url || !title || seenUrls.has(url)) continue;
    const item = anchor?.parentNode?.parentNode;
    seenUrls.add(url);
    results.push({
      title,
      url,
      description: snippet(item?.querySelector?.('.res-desc, .summary, .content')?.textContent || ''),
      engine: 'so360',
      source: sourceFromUrl(url),
    });
  }
  return results;
}

async function searchSo360(query: string, count: number, signal: AbortSignal): Promise<WebSearchResult[]> {
  const html = await fetchSearchHtml(
    `https://www.so.com/s?q=${encodeURIComponent(query)}`,
    '360 Search HTML',
    signal,
  );
  const results = extractResultsFromSoHtml(html, count);
  if (results.length === 0) throw new Error('No results parsed from 360 Search HTML');
  return results;
}

function extractResultsFromBraveHtml(html: string, count: number): WebSearchResult[] {
  const root = parseHtml(html);
  const results: WebSearchResult[] = [];
  const seenUrls = new Set<string>();
  for (const item of root.querySelectorAll('#results .snippet')) {
    if (results.length >= count) break;
    const content = item.querySelector('.result-content');
    const anchor = content?.querySelector('a');
    const url = toAbsoluteHttpUrl(anchor?.getAttribute('href') || '');
    const title = normalizeWhitespace(anchor?.querySelector('.search-snippet-title')?.textContent || '');
    if (!url || !title || seenUrls.has(url)) continue;
    seenUrls.add(url);
    results.push({
      title,
      url,
      description: snippet(content?.querySelector('.generic-snippet')?.textContent || ''),
      engine: 'brave',
      source: snippet(anchor?.querySelector('.site-name-wrapper')?.textContent || sourceFromUrl(url)),
    });
  }
  return results;
}

async function searchBrave(query: string, count: number, signal: AbortSignal): Promise<WebSearchResult[]> {
  const html = await fetchSearchHtml(
    `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`,
    'Brave HTML',
    signal,
    { Referer: 'https://duckduckgo.com/' },
  );
  const results = extractResultsFromBraveHtml(html, count);
  if (results.length === 0) throw new Error('No results parsed from Brave HTML');
  return results;
}

async function searchExa(query: string, count: number, signal: AbortSignal): Promise<WebSearchResult[]> {
  const response = await fetchSearchResponse(
    'https://exa.ai/search/api/search-fast',
    'Exa search API',
    signal,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        Origin: 'https://exa.ai',
      },
      body: JSON.stringify({
        numResults: count,
        query,
        type: 'auto',
        useAutoprompt: true,
        text: true,
        density: 'compact',
        resolvedSearchType: 'neural',
        moderation: true,
      }),
    },
  );
  const payload = await response.json() as {
    results?: Array<{ title?: string; url?: string; author?: string; publishedDate?: string }>;
  };
  const results = (payload.results || []).flatMap((item) => {
    const url = toAbsoluteHttpUrl(item.url || '');
    if (!url) return [];
    const details = [
      item.author ? `Author: ${item.author}` : '',
      item.publishedDate ? `Published: ${item.publishedDate}` : '',
    ].filter(Boolean).join('. ');
    return [{
      title: normalizeWhitespace(item.title || 'Untitled result'),
      url,
      description: details,
      engine: 'exa',
      source: sourceFromUrl(url),
    }];
  }).slice(0, count);
  if (results.length === 0) throw new Error('No results returned from Exa search API');
  return results;
}

function isStartpageChallenge(html: string): boolean {
  return /\/sp\/captcha|verify you are human|human verification|security check/i.test(html);
}

function extractResultsFromStartpageHtml(html: string, count: number): WebSearchResult[] {
  if (isStartpageChallenge(html)) throw new Error('Startpage returned a verification page');
  const root = parseHtml(html);
  const results: WebSearchResult[] = [];
  const seenUrls = new Set<string>();
  for (const anchor of root.querySelectorAll('a.result-title.result-link')) {
    if (results.length >= count) break;
    const url = toAbsoluteHttpUrl(anchor.getAttribute('href') || '');
    const title = normalizeWhitespace(anchor.querySelector('h2')?.textContent || anchor.textContent || '');
    if (!url || !title || seenUrls.has(url)) continue;
    const parent = anchor.parentNode;
    seenUrls.add(url);
    results.push({
      title,
      url,
      description: snippet(parent?.querySelector?.('p.description')?.textContent || ''),
      engine: 'startpage',
      source: sourceFromUrl(url),
    });
  }
  return results;
}

async function searchStartpage(query: string, count: number, signal: AbortSignal): Promise<WebSearchResult[]> {
  const home = await fetchSearchHtml('https://www.startpage.com/', 'Startpage token page', signal);
  if (isStartpageChallenge(home)) throw new Error('Startpage returned a verification page');
  const token = parseHtml(home).querySelector('form[action="/sp/search"] input[name="sc"]')?.getAttribute('value');
  if (!token) throw new Error('Failed to extract Startpage search token');
  const body = new URLSearchParams({ query, cat: 'web', t: 'device', sc: token, abp: '1', abd: '1', abe: '1' });
  const response = await fetchSearchResponse(
    'https://www.startpage.com/sp/search',
    'Startpage search',
    signal,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://www.startpage.com',
        Referer: 'https://www.startpage.com/',
      },
      body: body.toString(),
    },
  );
  const results = extractResultsFromStartpageHtml(await response.text(), count);
  if (results.length === 0) throw new Error('No results parsed from Startpage HTML');
  return results;
}

function stripHighlightHtml(text: string): string {
  return normalizeWhitespace(text.replace(/<\/?(?:em|b)>/gi, ''));
}

async function searchCsdn(query: string, count: number, signal: AbortSignal): Promise<WebSearchResult[]> {
  const response = await fetchSearchResponse(
    `https://so.csdn.net/api/v3/search?q=${encodeURIComponent(query)}&p=1`,
    'CSDN search API',
    signal,
    { headers: { Accept: 'application/json' } },
  );
  const payload = await response.json() as {
    result_vos?: Array<{ digest?: string; title?: string; url_location?: string; nickname?: string }>;
  };
  const results = (payload.result_vos || []).flatMap((item) => {
    const url = toAbsoluteHttpUrl(item.url_location || '');
    if (!url) return [];
    return [{
      title: stripHighlightHtml(item.title || 'Untitled result'),
      url,
      description: stripHighlightHtml(item.digest || ''),
      engine: 'csdn',
      source: normalizeWhitespace(item.nickname || sourceFromUrl(url)),
    }];
  }).slice(0, count);
  if (results.length === 0) throw new Error('No results returned from CSDN search API');
  return results;
}

async function searchJuejin(query: string, count: number, signal: AbortSignal): Promise<WebSearchResult[]> {
  const params = new URLSearchParams({
    aid: '2608',
    spider: '0',
    query,
    id_type: '0',
    cursor: '0',
    limit: String(Math.min(20, count)),
    search_type: '0',
    sort_type: '0',
    version: '1',
  });
  const response = await fetchSearchResponse(
    `https://api.juejin.cn/search_api/v1/search?${params}`,
    'Juejin search API',
    signal,
    { headers: { Accept: 'application/json' } },
  );
  const payload = await response.json() as {
    err_no?: number;
    err_msg?: string;
    data?: Array<{
      title_highlight?: string;
      content_highlight?: string;
      result_model?: {
        article_id?: string;
        article_info?: { title?: string; brief_content?: string };
        author_user_info?: { user_name?: string };
      };
    }>;
  };
  if (payload.err_no && payload.err_no !== 0) throw new Error(`Juejin API error: ${payload.err_msg || payload.err_no}`);
  const results = (payload.data || []).flatMap((item) => {
    const articleId = item.result_model?.article_id;
    if (!articleId) return [];
    return [{
      title: stripHighlightHtml(item.title_highlight || item.result_model?.article_info?.title || 'Untitled result'),
      url: `https://juejin.cn/post/${articleId}`,
      description: stripHighlightHtml(item.content_highlight || item.result_model?.article_info?.brief_content || ''),
      engine: 'juejin',
      source: normalizeWhitespace(item.result_model?.author_user_info?.user_name || 'juejin.cn'),
    }];
  }).slice(0, count);
  if (results.length === 0) throw new Error('No results returned from Juejin search API');
  return results;
}

const ENGINE_SEARCHERS: Record<PublicSearchEngine, EngineSearch> = {
  bing: searchBing,
  duckduckgo: searchDuckDuckGo,
  baidu: searchBaidu,
  sogou: searchSogou,
  so360: searchSo360,
  brave: searchBrave,
  exa: searchExa,
  startpage: searchStartpage,
  csdn: searchCsdn,
  juejin: searchJuejin,
};

function canonicalResultUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return rawUrl;
  }
}

function mergeRoundRobin(groups: WebSearchResult[][], count: number): WebSearchResult[] {
  const merged: WebSearchResult[] = [];
  const seenUrls = new Set<string>();
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < longest && merged.length < count; index += 1) {
    for (const group of groups) {
      const result = group[index];
      if (!result) continue;
      const key = canonicalResultUrl(result.url);
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
      merged.push(result);
      if (merged.length >= count) break;
    }
  }
  return merged;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PublicWebSearchProvider implements WebSearchProvider {
  name = 'Public Web';

  async search(query: string, count: number, options?: WebSearchOptions): Promise<WebSearchResponse> {
    const requestedEngines = [...new Set(options?.engines || [])];
    if (requestedEngines.length > 0) return this.searchMultiple(query, count, requestedEngines);
    return this.searchAutomatic(query, count);
  }

  private async searchMultiple(
    query: string,
    count: number,
    engines: PublicSearchEngine[],
  ): Promise<WebSearchResponse> {
    const perEngineCount = Math.max(1, Math.ceil(count / engines.length));
    const attempts = await Promise.all(engines.map(async (engine) => {
      const controller = new AbortController();
      try {
        const results = await ENGINE_SEARCHERS[engine](query, perEngineCount, controller.signal);
        return { engine, results };
      } catch (error) {
        return {
          engine,
          results: [] as WebSearchResult[],
          failure: { engine, code: 'engine_error', message: errorMessage(error) } satisfies WebSearchFailure,
        };
      } finally {
        controller.abort();
      }
    }));

    const partialFailures = attempts.flatMap((attempt) => attempt.failure ? [attempt.failure] : []);
    const results = mergeRoundRobin(attempts.map((attempt) => attempt.results), count);
    if (results.length === 0) {
      const details = partialFailures.map((failure) => `${failure.engine}:${failure.message}`).join('; ');
      throw new Error(`All requested public search engines failed: ${details || 'no results'}`);
    }
    return { results, engines, partialFailures };
  }

  private async searchAutomatic(query: string, count: number): Promise<WebSearchResponse> {
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    const attempts = [
      ['duckduckgo', () => searchDDGEndpoint('html', query, count, controllers[0]!.signal)],
      ['duckduckgo', () => searchDDGEndpoint('lite', query, count, controllers[1]!.signal)],
      ['so360', () => searchSo360(query, count, controllers[2]!.signal)],
    ] as const;
    const failures: string[] = [];

    try {
      try {
        const winner = await Promise.any(attempts.map(async ([engine, run]) => {
          try {
            return { engine, results: await run() };
          } catch (error) {
            failures.push(`${engine}:${errorMessage(error)}`);
            throw error;
          }
        }));
        return { results: winner.results, engines: [winner.engine] };
      } catch {
        const controller = new AbortController();
        try {
          return { results: await searchBing(query, count, controller.signal), engines: ['bing'] };
        } catch (error) {
          failures.push(`bing:${errorMessage(error)}`);
          throw new Error(`All public search endpoints failed: ${failures.join('; ')}`);
        } finally {
          controller.abort();
        }
      }
    } finally {
      for (const controller of controllers) controller.abort();
    }
  }
}

/** @deprecated Use PublicWebSearchProvider. Kept for source compatibility. */
export { PublicWebSearchProvider as DDGSearchProvider };
