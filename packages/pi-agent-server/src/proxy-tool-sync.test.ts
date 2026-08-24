import { describe, expect, it } from 'bun:test';
import { proxyToolDefinitionsChanged } from './proxy-tool-sync.ts';

const tool = (name: string, description = name) => ({
  name,
  description,
  inputSchema: { type: 'object', properties: {} },
});

describe('proxyToolDefinitionsChanged', () => {
  it('ignores an identical per-turn synchronization', () => {
    expect(proxyToolDefinitionsChanged([tool('read_source')], [tool('read_source')])).toBe(false);
  });

  it('detects additions, removals and schema metadata changes', () => {
    expect(proxyToolDefinitionsChanged([], [tool('read_source')])).toBe(true);
    expect(proxyToolDefinitionsChanged([tool('read_source')], [])).toBe(true);
    expect(proxyToolDefinitionsChanged([tool('read_source')], [tool('read_source', 'updated')])).toBe(true);
  });
});
