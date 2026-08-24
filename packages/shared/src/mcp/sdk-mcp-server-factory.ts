/**
 * In-process MCP Server 工厂
 *
 * 使用 @modelcontextprotocol/sdk 的 McpServer 高層 API。
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

export function createInProcessMcpServer(options: {
  name: string;
  version: string;
  tools: SdkMcpToolEntry[];
}): McpServer {
  const server = new McpServer(
    { name: options.name, version: options.version },
    { capabilities: { tools: {} } },
  );

  for (const tool of options.tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema as any,
        ...(tool.annotations?.readOnlyHint ? { annotations: { readOnlyHint: true } } : {}),
      },
      tool.handler,
    );
  }

  return server;
}
