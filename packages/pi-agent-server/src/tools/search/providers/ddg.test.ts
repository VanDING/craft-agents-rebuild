import { afterEach, describe, expect, it } from 'bun:test';
import { DDGSearchProvider } from './ddg.ts';
import { normalizeSearchOutput } from '../types.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('DDGSearchProvider public fallback', () => {
  it('uses 360 Search when DuckDuckGo endpoints are unreachable', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('so.com')) {
        return new Response(`
          <html><body><ul>
            <li class="res-list">
              <h3><a href="https://www.so.com/link?m=abc">Craft Agents</a></h3>
              <p class="res-desc">Open-source agent workspace</p>
            </li>
          </ul></body></html>
        `, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      throw new Error('endpoint unavailable');
    }) as typeof fetch;

    const response = normalizeSearchOutput(await new DDGSearchProvider().search('craft agents', 5));

    expect(response.engines).toEqual(['so360']);
    expect(response.results).toEqual([{
      title: 'Craft Agents',
      url: 'https://www.so.com/link?m=abc',
      description: 'Open-source agent workspace',
      engine: 'so360',
      source: 'so.com',
    }]);
  });

  it('aggregates selected engines, de-duplicates URLs, and preserves partial failures', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('bing.com')) {
        return new Response(`
          <ol><li class="b_algo"><h2><a href="https://example.com/story?utm_source=bing">Example</a></h2>
          <div class="b_caption"><p>Bing description</p></div></li></ol>
        `);
      }
      if (url.includes('baidu.com')) {
        return new Response(`
          <div id="content_left"><div><h3><a href="https://example.com/story">Example duplicate</a></h3>
          <div class="cos-row">Baidu description</div></div></div>
        `);
      }
      throw new Error('sogou offline');
    }) as typeof fetch;

    const response = normalizeSearchOutput(await new DDGSearchProvider().search(
      'example',
      5,
      { engines: ['bing', 'baidu', 'sogou'] },
    ));

    expect(response.engines).toEqual(['bing', 'baidu', 'sogou']);
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.engine).toBe('bing');
    expect(response.partialFailures).toEqual([{
      engine: 'sogou',
      code: 'engine_error',
      message: 'sogou offline',
    }]);
  });

  it('supports the CSDN and Juejin engines exposed by the former MCP source', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('so.csdn.net')) {
        return Response.json({
          result_vos: [{
            title: '<em>Craft</em> on CSDN',
            url_location: 'https://blog.csdn.net/example/article/details/1',
            digest: '<em>Agent</em> article',
            nickname: 'Author A',
          }],
        });
      }
      if (url.includes('api.juejin.cn')) {
        return Response.json({
          err_no: 0,
          data: [{
            title_highlight: '<em>Craft</em> on Juejin',
            content_highlight: 'Agent article',
            result_model: {
              article_id: '123',
              author_user_info: { user_name: 'Author B' },
            },
          }],
        });
      }
      throw new Error(`unexpected endpoint: ${url}`);
    }) as typeof fetch;

    const response = normalizeSearchOutput(await new DDGSearchProvider().search(
      'craft',
      4,
      { engines: ['csdn', 'juejin'] },
    ));

    expect(response.results.map((result) => result.engine)).toEqual(['csdn', 'juejin']);
    expect(response.results[0]?.title).toBe('Craft on CSDN');
    expect(response.results[1]?.url).toBe('https://juejin.cn/post/123');
    expect(response.partialFailures).toEqual([]);
  });

  it('surfaces an error when every public endpoint fails', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;

    await expect(new DDGSearchProvider().search('craft agents', 5)).rejects.toThrow(
      'All public search endpoints failed',
    );
  });
});
