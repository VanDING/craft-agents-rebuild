import { describe, expect, it } from 'bun:test';
import { createWebFetchTool } from './web-fetch.ts';

describe('createWebFetchTool error contract', () => {
  it('throws for blocked URLs so Pi records an actual tool error', async () => {
    const tool = createWebFetchTool(() => null);

    await expect(tool.execute('fetch-1', { url: 'file:///etc/passwd' })).rejects.toThrow(
      'Refused to fetch',
    );
  });
});
