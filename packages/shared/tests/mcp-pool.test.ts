/**
 * Tests for McpClientPool — config change detection during sync().
 *
 * Verifies that when a source's OAuth token is refreshed, sync() reconnects
 * the source with fresh credentials instead of keeping a stale connection.
 * This was the root cause of MCP connection drops every 30-60 minutes:
 * tokens were refreshed but never applied to existing transports.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { McpClientPool } from '../src/mcp/mcp-pool.ts';
import { createInProcessMcpServer } from '../src/mcp/sdk-mcp-server-factory.ts';
import type { AgentMcpServerConfig } from '../src/agent/backend/types.ts';
import type { PoolClient } from '../src/mcp/client.ts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// ============================================================
// Helpers
// ============================================================

const mockTools: Tool[] = [
  {
    name: 'test-tool',
    description: 'A test tool',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

function makeMockClient(): PoolClient {
  return {
    listTools: async () => mockTools,
    callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    close: async () => {},
  };
}

function httpConfig(token: string, url = 'https://mcp.example.com'): AgentMcpServerConfig {
  return { type: 'http', url, headers: { Authorization: `Bearer ${token}` } };
}

/**
 * Subclass that intercepts connect/disconnect to avoid real MCP connections
 * while letting sync()'s config-change detection logic run against real state.
 */
class TestablePool extends McpClientPool {
  public connectCalls: Array<{ slug: string; config: AgentMcpServerConfig }> = [];
  public disconnectCalls: string[] = [];

  async connect(slug: string, config: AgentMcpServerConfig): Promise<void> {
    this.connectCalls.push({ slug, config });
    await this.registerClient(slug, makeMockClient());
    this.activeConfigs.set(slug, config);
  }

  async disconnect(slug: string): Promise<void> {
    this.disconnectCalls.push(slug);
    await super.disconnect(slug);
  }

  /** Reset tracking arrays between sync phases within a single test */
  resetTracking(): void {
    this.connectCalls = [];
    this.disconnectCalls = [];
  }
}

// ============================================================
// Tests
// ============================================================

describe('McpClientPool.sync — config change detection', () => {
  let pool: TestablePool;

  beforeEach(() => {
    pool = new TestablePool();
  });

  it('reconnects when Authorization header changes (token refresh)', async () => {
    await pool.sync({ craft: httpConfig('old-token') });
    expect(pool.isConnected('craft')).toBe(true);
    pool.resetTracking();

    await pool.sync({ craft: httpConfig('new-token') });

    expect(pool.disconnectCalls).toEqual(['craft']);
    expect(pool.connectCalls).toHaveLength(1);
    expect(pool.connectCalls[0].config.headers?.Authorization).toBe('Bearer new-token');
    expect(pool.isConnected('craft')).toBe(true);
  });

  it('does not reconnect when config is unchanged', async () => {
    const config = httpConfig('token-1');
    await pool.sync({ craft: config });
    pool.resetTracking();

    await pool.sync({ craft: config });

    expect(pool.connectCalls).toHaveLength(0);
    expect(pool.disconnectCalls).toHaveLength(0);
  });

  it('reconnects when URL changes', async () => {
    await pool.sync({ craft: httpConfig('token', 'https://old.example.com') });
    pool.resetTracking();

    await pool.sync({ craft: httpConfig('token', 'https://new.example.com') });

    expect(pool.disconnectCalls).toEqual(['craft']);
    expect(pool.connectCalls).toHaveLength(1);
  });

  it('does not reconnect when only non-auth headers change', async () => {
    // Only Authorization and URL should trigger reconnect — other header
    // changes (tracing, versioning) should not cause connection churn.
    const config1: AgentMcpServerConfig = {
      type: 'http',
      url: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer same', 'X-Request-Id': 'aaa' },
    };
    const config2: AgentMcpServerConfig = {
      type: 'http',
      url: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer same', 'X-Request-Id': 'bbb' },
    };

    await pool.sync({ craft: config1 });
    pool.resetTracking();

    await pool.sync({ craft: config2 });

    expect(pool.connectCalls).toHaveLength(0);
    expect(pool.disconnectCalls).toHaveLength(0);
  });

  it('disconnects sources removed from config', async () => {
    const config = httpConfig('token');
    await pool.sync({ craft: config, linear: config });
    pool.resetTracking();

    await pool.sync({ craft: config });

    expect(pool.disconnectCalls).toEqual(['linear']);
    expect(pool.isConnected('craft')).toBe(true);
    expect(pool.isConnected('linear')).toBe(false);
  });

  it('handles add + remove + refresh in a single sync', async () => {
    await pool.sync({
      craft: httpConfig('old-craft-token'),
      linear: httpConfig('linear-token', 'https://linear.example.com'),
    });
    pool.resetTracking();

    // craft: token refreshed, linear: removed, github: added
    await pool.sync({
      craft: httpConfig('new-craft-token'),
      github: httpConfig('gh-token', 'https://github.example.com'),
    });

    expect(pool.disconnectCalls).toContain('linear');
    expect(pool.disconnectCalls).toContain('craft');
    expect(pool.connectCalls.find(c => c.slug === 'craft')?.config.headers?.Authorization).toBe('Bearer new-craft-token');
    expect(pool.connectCalls.find(c => c.slug === 'github')).toBeDefined();
    expect(pool.isConnected('craft')).toBe(true);
    expect(pool.isConnected('linear')).toBe(false);
    expect(pool.isConnected('github')).toBe(true);
  });

  it('reports failure when reconnect fails after token refresh', async () => {
    let connectAttempts = 0;
    const failPool = new TestablePool();
    const origConnect = failPool.connect.bind(failPool);
    failPool.connect = async (slug: string, config: AgentMcpServerConfig) => {
      connectAttempts++;
      if (connectAttempts > 1) throw new Error('Server unavailable');
      return origConnect(slug, config);
    };

    await failPool.sync({ craft: httpConfig('old-token') });
    expect(failPool.isConnected('craft')).toBe(true);

    // Token refresh — disconnect succeeds but reconnect throws
    const failures = await failPool.sync({ craft: httpConfig('new-token') });

    expect(failures).toContain('craft');
    expect(failPool.isConnected('craft')).toBe(false);
  });

  it('connects in-process API servers keyed by slug', async () => {
    const apiServer = createInProcessMcpServer({
      name: 'test-api',
      version: '1.0.0',
      tools: [
        {
          name: 'ping',
          description: 'A ping tool',
          inputSchema: {},
          handler: async () => ({ content: [{ type: 'text', text: 'pong' }] }),
        },
      ],
    });

    await pool.sync({}, { 'my-api': apiServer });

    expect(pool.isConnected('my-api')).toBe(true);
    expect(pool.getTools('my-api').map(t => t.name)).toContain('ping');

    const result = await pool.callTool('mcp__my-api__ping', {});
    expect(result.isError).toBe(false);
    expect(result.content).toBe('pong');
  });
});
