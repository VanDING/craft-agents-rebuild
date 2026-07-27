/**
 * In-process MCP Server 工厂
 *
 * 替代 @anthropic-ai/claude-agent-sdk 的 createSdkMcpServer()。
 * 使用 @modelcontextprotocol/sdk 的 McpServer 高層 API。
 *
 * 返回类型与 createSdkMcpServer 兼容: { type: 'sdk', instance: McpServer }
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShape } from 'zod/v4';


export interface SdkMcpToolEntry {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }>;
  annotations?: { readOnlyHint?: boolean };
}

export interface InProcessMcpServerResult {
  type: 'sdk';
  instance: McpServer;
}

export function createInProcessMcpServer(options: {
  name: string;
  version: string;
  tools: SdkMcpToolEntry[];
}): InProcessMcpServerResult {
  const server = new McpServer(
    { name: options.name, version: options.version },
    { capabilities: { tools: {} } },
  );

  for (const tool of options.tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputSchema: tool.inputSchema as any,
        ...(tool.annotations?.readOnlyHint ? { annotations: { readOnlyHint: true } } : {}),
      },
      tool.handler,
    );
  }

  return {
    type: 'sdk',
    instance: server,
  };
}
