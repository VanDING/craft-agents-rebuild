/**
 * ToolDefinition — 通用工具定义类型
 *
 * 替代 @anthropic-ai/claude-agent-sdk 的 `tool()` 和 `SdkMcpToolDefinition`。
 * 与 Pi SDK 的 ToolDefinition<any, any> 兼容。
 */
import type { ZodRawShape } from 'zod/v4';

// 兼容 Claude SDK tool() 返回的 CallToolResult
export interface ToolResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any[];
  isError?: boolean;
}

export interface ToolDefinition<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  inputSchema: Shape;
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<ToolResult>;
  annotations?: { readOnlyHint?: boolean };
}

/**
 * 创建工具定义的工厂函数。
 * 与 Claude SDK `tool(name, desc, schema, handler, extras?)` 签名兼容。
 */
export function defineTool<Shape extends ZodRawShape>(
  name: string,
  description: string,
  inputSchema: Shape,
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<ToolResult>,
  extras?: { annotations?: { readOnlyHint?: boolean } },
): ToolDefinition<Shape> {
  return { name, description, inputSchema, handler, ...extras };
}
